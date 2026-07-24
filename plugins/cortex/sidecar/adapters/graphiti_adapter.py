"""Graphiti + FalkorDB Lite adapter — implements GraphPort.

This is the ONLY file that imports graphiti_core or falkordblite.
Schema, ontology, extraction prompts, and LLM client config all live here
because they're calibrated to how THIS engine phrases its extraction task.

The ModernOpenAIClient override is intentionally minimal: it only renames
max_tokens → max_completion_tokens and delegates everything else to super().
"""

import logging
from datetime import datetime, timezone
from typing import List, Optional

from graphiti_core import Graphiti
from graphiti_core.llm_client.config import LLMConfig as GraphitiLLMConfig
from graphiti_core.llm_client.openai_generic_client import OpenAIGenericClient
from graphiti_core.nodes import EpisodeType

from ..config import DATA_DIR, DEFAULT_ENGINE_PORT
from ..embeddings import NomicLocalEmbedder, query_mode
from ..ports import (
    EpisodeRecord,
    ExtractionResult,
    ExtractedEdge,
    ExtractedNode,
    GraphPort,
)
from ..schema import ENTITY_TYPES, EDGE_TYPES, EDGE_TYPE_MAP

logger = logging.getLogger("cortex.adapters.graphiti")


# ── Extraction instructions (adapter config, not port surface) ───
# These are calibrated to graphiti-core's extraction pipeline and the
# eval-certified v5-final baseline. Changing them requires re-running
# the eval suite.

CUSTOM_EXTRACTION_INSTRUCTIONS = """
ENTITY CATEGORIES for this business advisory knowledge graph:
Owner, Business, Objective, Strategy, Resource, TeamMember, Skill, Product, Segment, Opportunity, Preference, Constraint.

RELATIONSHIP GUIDELINES:
- Keep facts atomic: one clear idea per relationship
- Assign high confidence only to explicitly stated information
- Capture: who owns what, who works where, what targets what, what constrains what
- For financial facts, always include the figure in the relationship name
- When the user reports evaluating an opportunity, ALWAYS extract one fact stating the outcome ("declined X", "proceeded with Y", "passed on Z") in addition to any reasons or constraints. The decision itself is a distinct fact from the rationale.
- ALWAYS extract each stated operational figure (headcount, revenue, runway, customer count, pricing) as its own fact, even when several appear in one sentence. "7 people, $85k MRR, 14 months runway" = three separate facts.
- When a user corrects a figure ("actually it's $80k, not $180k"), extract the CORRECTED figure as the current fact, AND extract the correction as a retraction event ("user corrected the marketing budget from $180k to $80k"). NEVER extract the old figure as a bare standalone fact — it must only appear in the context of the correction.

IMPORTANT: Extract ALL distinct entities mentioned. People, companies, products, goals, resources, constraints — each gets its own node. Create relationships between them.

CRITICAL — DO NOT EXTRACT AS FACTS:
- Hypotheticals or conditionals about FUTURE actions ("if we hired...", "that would cost...", "could be worth...")
- The assistant's suggestions, speculative advice, or brainstorming proposals
- Questions the user is asking (not statements of fact)
- Rejected options or things explicitly NOT chosen (unless recording the rejection itself)
- Numbers or scenarios preceded by "what if", "imagine", "let's say", "hypothetically"

DO extract, even when phrased conditionally or comparatively:
- Stated preferences ("I'd rather X than Y", "I prefer", "non-negotiable for me")
- Role/status changes including negations ("no longer lead developer", "not with us anymore")
- Confirmed decisions regardless of phrasing ("we decided", "going with", "committed to")
- Lifestyle/work-style boundaries ("I want weekends free", "won't work seven days")
- Comparative choices that reveal current truth ("I'd rather grow slower than burn out")

The test: is the USER asserting something true about themselves or the business RIGHT NOW — or are they (or the assistant) speculating about what MIGHT happen? Extract the former. Reject the latter.
"""


# ── ModernOpenAIClient (minimal override) ────────────────────────


class _ModernOpenAIClient(OpenAIGenericClient):
    """Patches max_tokens → max_completion_tokens for gpt-5.x models.

    Minimal override: wraps the completion call to rename the kwarg,
    delegates everything else to base class. If upstream fixes this
    (check on version bumps), this class can be deleted.
    """

    async def _generate_response(self, messages, response_model=None,
                                 max_tokens=None, model_size=None):
        """Override to rename the kwarg, then delegate to super() internals."""
        # Import what we need from the base class module
        from graphiti_core.llm_client.openai_generic_client import DEFAULT_MAX_TOKENS
        from graphiti_core.llm_client.config import ModelSize
        import json
        import openai

        if max_tokens is None:
            max_tokens = DEFAULT_MAX_TOKENS
        if model_size is None:
            model_size = ModelSize.medium

        from openai.types.chat import ChatCompletionMessageParam
        openai_messages: list[ChatCompletionMessageParam] = []
        for m in messages:
            m.content = self._clean_input(m.content)
            if m.role == 'user':
                openai_messages.append({'role': 'user', 'content': m.content})
            elif m.role == 'system':
                openai_messages.append({'role': 'system', 'content': m.content})

        try:
            kwargs = dict(
                model=self.model,
                messages=openai_messages,
                temperature=self.temperature,
                max_completion_tokens=max_tokens,  # THE FIX
                response_format=self._build_response_format(response_model),
            )
            response = await self.client.chat.completions.create(**kwargs)
            result = response.choices[0].message.content or ''
            if not result:
                from graphiti_core.llm_client.errors import EmptyResponseError
                raise EmptyResponseError('LLM returned an empty response')
            return json.loads(self._strip_code_fences(result))
        except openai.RateLimitError as e:
            from graphiti_core.llm_client.errors import RateLimitError
            raise RateLimitError from e
        except Exception as e:
            logger.error(f'Error in LLM response: {e}')
            raise


# ── Driver construction ──────────────────────────────────────────


def _get_db_path() -> str:
    return str(DATA_DIR / "graph.db")


def _build_driver():
    """Try embedded-FalkorDB paths in order."""
    db_path = _get_db_path()

    # Path 1: dedicated Lite driver (newer graphiti-core).
    try:
        from graphiti_core.driver.falkordb_lite_driver import FalkorLiteDriver
        logger.info("Using graphiti_core FalkorLiteDriver")
        return FalkorLiteDriver(path=db_path)
    except ImportError:
        logger.info("FalkorLiteDriver not in this graphiti-core; trying falkordblite")

    # Path 2: official falkordblite client.
    try:
        from falkordblite import FalkorDB
        from graphiti_core.driver.falkordb_driver import FalkorDriver
        client = FalkorDB(db_path)
        logger.info("Using falkordblite.FalkorDB wrapped in FalkorDriver")
        return FalkorDriver(falkor_db=client, database="cortex")
    except ImportError:
        logger.info("falkordblite not available; trying redislite AsyncFalkorDB")

    # Path 3: graphiti-core[falkordblite] ships redislite with AsyncFalkorDB.
    try:
        from redislite.async_falkordb_client import AsyncFalkorDB
        from graphiti_core.driver.falkordb_driver import FalkorDriver
        client = AsyncFalkorDB(dbfilename=db_path)
        logger.info("Using redislite.AsyncFalkorDB wrapped in FalkorDriver")
        return FalkorDriver(falkor_db=client, database="cortex")
    except ImportError as e:
        raise ImportError(
            "No embedded FalkorDB available. Install with: "
            "pip install 'graphiti-core[falkordblite]' "
            f"(original error: {e})"
        ) from e


async def _verify_roundtrip(driver) -> None:
    """Write/read/delete probe node. Fails loudly if graph is broken."""
    await driver.execute_query("CREATE (p:CortexProbe {k: 'probe', v: 1})")
    result = await driver.execute_query(
        "MATCH (p:CortexProbe {k: 'probe'}) RETURN p.v AS v"
    )
    rows = result[0] if result else []
    if not rows or rows[0].get("v") != 1:
        raise RuntimeError("FalkorDB roundtrip failed: probe node not readable")
    await driver.execute_query("MATCH (p:CortexProbe) DELETE p")
    logger.info("FalkorDB roundtrip smoke test PASSED")


def _make_llm_client(api_key: str, model: str, base_url: Optional[str] = None):
    return _ModernOpenAIClient(
        config=GraphitiLLMConfig(
            api_key=api_key,
            model=model,
            small_model=model,
            base_url=base_url,
            temperature=0.1,
        )
    )


# ── Adapter Implementation ───────────────────────────────────────


class GraphitiAdapter:
    """Implements GraphPort using graphiti-core + FalkorDB Lite.

    All graphiti_core imports are contained within this file.
    Schema (ENTITY_TYPES, EDGE_TYPES, EDGE_TYPE_MAP) and extraction
    instructions are construction-time config — they travel with the adapter,
    not through the port interface.
    """

    def __init__(self, engine_port: int = DEFAULT_ENGINE_PORT):
        self._graphiti: Optional[Graphiti] = None
        self._driver = None
        self._init_error: Optional[str] = None
        self._engine_port = engine_port

    # ── Lifecycle ────────────────────────────────────────────────

    async def initialize(self) -> None:
        self._init_error = None
        try:
            self._driver = _build_driver()
            embedder = NomicLocalEmbedder(engine_port=self._engine_port)

            llm_client = OpenAIGenericClient(
                config=GraphitiLLMConfig(
                    api_key="placeholder",
                    model="placeholder",
                    small_model="placeholder",
                    base_url=f"http://127.0.0.1:{self._engine_port}/v1",
                    temperature=0.1,
                )
            )

            from graphiti_core.cross_encoder.openai_reranker_client import (
                OpenAIRerankerClient,
            )
            cross_encoder = OpenAIRerankerClient(
                config=GraphitiLLMConfig(
                    api_key="placeholder",
                    model="placeholder",
                    base_url=f"http://127.0.0.1:{self._engine_port}/v1",
                )
            )

            self._graphiti = Graphiti(
                graph_driver=self._driver,
                embedder=embedder,
                llm_client=llm_client,
                cross_encoder=cross_encoder,
                store_raw_episode_content=True,
            )

            await self._graphiti.build_indices_and_constraints()
            await _verify_roundtrip(self._driver)

            logger.info(f"Graphiti adapter initialized — db at {_get_db_path()}")

        except Exception as e:
            self._init_error = f"{type(e).__name__}: {e}"
            self._graphiti = None
            self._driver = None
            logger.critical(f"Graphiti init FAILED: {self._init_error}")
            raise

    async def close(self) -> None:
        if self._driver:
            try:
                await self._driver.close()
            except Exception as e:
                logger.debug(f"Driver close error: {e}")
        self._graphiti = None
        self._driver = None

    def is_ready(self) -> bool:
        return self._graphiti is not None

    def get_init_error(self) -> Optional[str]:
        return self._init_error

    # ── Extraction ───────────────────────────────────────────────

    async def add_episode(
        self,
        body: str,
        group_id: str,
        reference_time: datetime,
        name: str = "",
        source_description: str = "",
    ) -> ExtractionResult:
        if not self._graphiti:
            return ExtractionResult()

        if not name:
            name = f"exchange-{reference_time.strftime('%Y%m%d-%H%M%S')}"

        result = await self._graphiti.add_episode(
            name=name,
            episode_body=body,
            source_description=source_description or "Desktop companion conversation",
            reference_time=reference_time,
            source=EpisodeType.message,
            group_id=group_id,
            entity_types=ENTITY_TYPES,
            edge_types=EDGE_TYPES,
            edge_type_map=EDGE_TYPE_MAP,
            custom_extraction_instructions=CUSTOM_EXTRACTION_INSTRUCTIONS,
        )

        if not result:
            return ExtractionResult()

        nodes = [
            ExtractedNode(
                uuid=getattr(n, "uuid", ""),
                name=getattr(n, "name", ""),
                labels=getattr(n, "labels", []) or [],
            )
            for n in (result.nodes or [])
        ]
        edges = [
            ExtractedEdge(
                uuid=getattr(e, "uuid", ""),
                source_node_uuid=getattr(e, "source_node_uuid", ""),
                target_node_uuid=getattr(e, "target_node_uuid", ""),
                name=getattr(e, "name", ""),
                fact=getattr(e, "fact", "") or getattr(e, "name", ""),
                group_id=group_id,
                created_at=getattr(e, "created_at", None),
                valid_at=getattr(e, "valid_at", None),
                invalid_at=getattr(e, "invalid_at", None),
                fact_embedding=getattr(e, "fact_embedding", None),
            )
            for e in (result.edges or [])
        ]

        return ExtractionResult(nodes=nodes, edges=edges)

    # ── Search & Retrieval ───────────────────────────────────────

    async def search(
        self,
        query: str,
        group_ids: List[str],
        num_results: int = 30,
    ) -> List[ExtractedEdge]:
        if not self._graphiti:
            return []

        with query_mode():
            raw_edges = await self._graphiti.search(
                query=query,
                num_results=num_results,
                group_ids=group_ids,
            )

        return [
            ExtractedEdge(
                uuid=getattr(e, "uuid", ""),
                source_node_uuid=getattr(e, "source_node_uuid", ""),
                target_node_uuid=getattr(e, "target_node_uuid", ""),
                name=getattr(e, "name", ""),
                fact=getattr(e, "fact", "") or getattr(e, "name", ""),
                group_id=getattr(e, "group_id", ""),
                created_at=getattr(e, "created_at", None),
                valid_at=getattr(e, "valid_at", None),
                invalid_at=getattr(e, "invalid_at", None),
                fact_embedding=getattr(e, "fact_embedding", None),
            )
            for e in (raw_edges or [])
        ]

    # ── Typed Queries ────────────────────────────────────────────

    async def get_recent_facts(self, group_id: str, limit: int = 50) -> List[dict]:
        if not self._driver:
            return []
        result = await self._driver.execute_query(
            "MATCH ()-[r:RELATES_TO]->() "
            "WHERE r.group_id = $gid AND r.invalid_at IS NULL "
            "RETURN r.uuid AS uuid, r.fact AS fact, r.created_at AS created_at "
            "ORDER BY r.created_at DESC LIMIT $lim",
            gid=group_id, lim=limit,
        )
        rows = result[0] if result else []
        return [dict(r) for r in rows]

    async def get_facts_by_ids(self, fact_ids: List[str]) -> List[dict]:
        if not self._driver or not fact_ids:
            return []
        result = await self._driver.execute_query(
            "MATCH ()-[r:RELATES_TO]->() WHERE r.uuid IN $ids "
            "RETURN r.uuid AS uuid, r.fact AS fact, r.created_at AS created_at",
            ids=fact_ids,
        )
        rows = result[0] if result else []
        return [dict(r) for r in rows]

    async def get_superseded_facts(
        self, group_ids: List[str], limit: int = 15
    ) -> List[ExtractedEdge]:
        if not self._driver:
            return []
        result = await self._driver.execute_query(
            "MATCH ()-[r:RELATES_TO]->() "
            "WHERE r.group_id IN $group_ids AND r.invalid_at IS NOT NULL "
            "RETURN r.uuid AS uuid, r.fact AS fact, r.invalid_at AS invalid_at, "
            "r.valid_at AS valid_at, r.created_at AS created_at, "
            "r.source_node_uuid AS source_node_uuid, "
            "r.target_node_uuid AS target_node_uuid "
            "ORDER BY r.valid_at ASC LIMIT $lim",
            group_ids=group_ids, lim=limit,
        )
        rows = result[0] if result else []
        return [
            ExtractedEdge(
                uuid=row.get("uuid", ""),
                source_node_uuid=row.get("source_node_uuid", ""),
                target_node_uuid=row.get("target_node_uuid", ""),
                name="",
                fact=row.get("fact", ""),
                group_id=group_ids[0] if group_ids else "",
                created_at=row.get("created_at"),
                valid_at=row.get("valid_at"),
                invalid_at=row.get("invalid_at"),
            )
            for row in rows if row.get("fact")
        ]

    async def check_invalidated(self, uuids: List[str]) -> set[str]:
        if not self._driver or not uuids:
            return set()
        result = await self._driver.execute_query(
            "MATCH ()-[r:RELATES_TO]->() WHERE r.uuid IN $ids "
            "RETURN r.uuid AS uuid, r.invalid_at AS invalid_at",
            ids=uuids,
        )
        rows = result[0] if result else []
        return {row["uuid"] for row in rows if row.get("invalid_at") is not None}

    async def find_dedup_candidates(self, group_id: str, limit: int = 20) -> List[dict]:
        if not self._driver:
            return []
        result = await self._driver.execute_query(
            "MATCH (a:Entity), (b:Entity) "
            "WHERE a.name <> b.name "
            "  AND a.group_id = $gid AND b.group_id = $gid "
            "  AND (toLower(a.name) CONTAINS toLower(b.name) "
            "       OR toLower(b.name) CONTAINS toLower(a.name)) "
            "RETURN DISTINCT a.name AS name_a, a.uuid AS uuid_a, "
            "                b.name AS name_b, b.uuid AS uuid_b "
            "LIMIT $lim",
            gid=group_id, lim=limit,
        )
        rows = result[0] if result else []
        return [dict(r) for r in rows]

    async def merge_entities(self, keep_uuid: str, merge_uuid: str) -> bool:
        if not self._driver:
            return False
        try:
            await self._driver.execute_query(
                "MATCH (merge:Entity {uuid: $merge_uuid}) "
                "MATCH (keep:Entity {uuid: $keep_uuid}) "
                "OPTIONAL MATCH (merge)-[r_out]->() "
                "OPTIONAL MATCH ()-[r_in]->(merge) "
                "WITH merge, keep, collect(r_out) AS outs, collect(r_in) AS ins "
                "FOREACH (r IN outs | DELETE r) "
                "FOREACH (r IN ins | DELETE r) "
                "DELETE merge "
                "RETURN count(merge) AS deleted",
                merge_uuid=merge_uuid, keep_uuid=keep_uuid,
            )
            return True
        except Exception as e:
            logger.warning(f"Entity merge failed: {e}")
            return False

    async def get_unscored_edges(self, group_id: str, limit: int = 25) -> List[dict]:
        if not self._driver:
            return []
        result = await self._driver.execute_query(
            "MATCH ()-[r:RELATES_TO]->() WHERE r.group_id = $gid "
            "RETURN r.uuid AS uuid, r.fact AS fact "
            "ORDER BY r.created_at DESC LIMIT $lim",
            gid=group_id, lim=limit,
        )
        rows = result[0] if result else []
        return [dict(r) for r in rows]

    async def get_stats(self) -> dict:
        if not self._driver:
            return {"entities": 0, "edges": 0, "facts": 0, "episodes": 0}
        try:
            async def _count(q: str) -> int:
                res = await self._driver.execute_query(q)
                rows = res[0] if res else []
                return rows[0]["c"] if rows else 0

            entities = await _count("MATCH (e:Entity) RETURN count(e) AS c")
            edges = await _count("MATCH ()-[r:RELATES_TO]->() RETURN count(r) AS c")
            episodes = await _count("MATCH (ep:Episodic) RETURN count(ep) AS c")
            return {"entities": entities, "edges": edges, "facts": edges, "episodes": episodes}
        except Exception as e:
            logger.debug(f"Stats query failed: {e}")
            return {"entities": 0, "edges": 0, "facts": 0, "episodes": 0}

    async def clear_all(self) -> None:
        if not self._driver:
            return
        await self._driver.execute_query("MATCH (n) DETACH DELETE n")
        logger.info("All graph data cleared")

    # ── Episode Export ───────────────────────────────────────────

    async def export_episodes(self, group_id: str) -> List[EpisodeRecord]:
        if not self._driver:
            return []
        result = await self._driver.execute_query(
            "MATCH (ep:Episodic) WHERE ep.group_id = $gid "
            "RETURN ep.name AS name, ep.content AS body, "
            "ep.source_description AS source_description, "
            "ep.valid_at AS reference_time "
            "ORDER BY ep.valid_at ASC",
            gid=group_id,
        )
        rows = result[0] if result else []
        return [
            EpisodeRecord(
                name=row.get("name", ""),
                body=row.get("body", ""),
                source_description=row.get("source_description", ""),
                reference_time=row.get("reference_time") or datetime.now(timezone.utc),
                group_id=group_id,
            )
            for row in rows
        ]

    # ── Embedding ────────────────────────────────────────────────

    async def embed_query(self, text: str) -> Optional[List[float]]:
        if not self._graphiti or not self._graphiti.embedder:
            return None
        with query_mode():
            return await self._graphiti.embedder.create(text)

    async def embed_storage(self, text: str) -> Optional[List[float]]:
        if not self._graphiti or not self._graphiti.embedder:
            return None
        return await self._graphiti.embedder.create(text)

    async def create(self, text: str) -> Optional[List[float]]:
        """Alias for embed_storage — satisfies the embedder interface
        expected by ModuleStore.create() and module_updater."""
        return await self.embed_storage(text)

    # ── LLM Reconfiguration ─────────────────────────────────────

    async def reconfigure_llm(
        self,
        api_key: str,
        model: str,
        base_url: Optional[str] = None,
        provider: str = "openai",
    ) -> None:
        if not self._graphiti:
            return

        if provider == "anthropic":
            try:
                from graphiti_core.llm_client.anthropic_client import AnthropicClient
                new_llm = AnthropicClient(
                    config=GraphitiLLMConfig(api_key=api_key, model=model)
                )
            except ImportError:
                new_llm = _make_llm_client(api_key, model, base_url)
        else:
            new_llm = _make_llm_client(api_key, model, base_url)

        from graphiti_core.cross_encoder.openai_reranker_client import OpenAIRerankerClient
        new_cross_encoder = OpenAIRerankerClient(
            config=GraphitiLLMConfig(api_key=api_key, model=model, base_url=base_url)
        )

        self._graphiti.llm_client = new_llm
        self._graphiti.cross_encoder = new_cross_encoder
        self._graphiti.clients.llm_client = new_llm
        self._graphiti.clients.cross_encoder = new_cross_encoder
        logger.info(f"LLM reconfigured: {provider}/{model}")

    # ── Debug Escape Hatch ───────────────────────────────────────

    async def execute_raw_query(self, query: str, **params) -> List[dict]:
        """For eval harness /debug/cypher only. Not for production paths."""
        if not self._driver:
            return []
        result = await self._driver.execute_query(query, **params)
        rows = result[0] if result else []
        return [dict(r) for r in rows]

    # ── Reflection (add_episode for insights) ────────────────────

    async def add_reflection_episode(
        self,
        body: str,
        group_id: str,
        reference_time: datetime,
        name: str = "",
        source_description: str = "",
    ) -> ExtractionResult:
        """Store a reflection insight. No schema/ontology — plain text episode."""
        if not self._graphiti:
            return ExtractionResult()

        result = await self._graphiti.add_episode(
            name=name or f"reflection-{reference_time.strftime('%Y%m%d-%H%M%S%f')}",
            episode_body=body,
            source_description=source_description,
            reference_time=reference_time,
            source=EpisodeType.text,
            group_id=group_id,
        )

        if not result:
            return ExtractionResult()

        nodes = [
            ExtractedNode(
                uuid=getattr(n, "uuid", ""),
                name=getattr(n, "name", ""),
                labels=getattr(n, "labels", []) or [],
            )
            for n in (result.nodes or [])
        ]
        edges = [
            ExtractedEdge(
                uuid=getattr(e, "uuid", ""),
                source_node_uuid=getattr(e, "source_node_uuid", ""),
                target_node_uuid=getattr(e, "target_node_uuid", ""),
                name=getattr(e, "name", ""),
                fact=getattr(e, "fact", "") or getattr(e, "name", ""),
                group_id=group_id,
                created_at=getattr(e, "created_at", None),
                valid_at=getattr(e, "valid_at", None),
                invalid_at=getattr(e, "invalid_at", None),
            )
            for e in (result.edges or [])
        ]

        return ExtractionResult(nodes=nodes, edges=edges)
