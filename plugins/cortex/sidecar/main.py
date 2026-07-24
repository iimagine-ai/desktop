"""Cortex Memory Sidecar — FastAPI application.

Changes in this revision:
- /health reports "degraded" + the init error when Graphiti failed to start,
  so the Electron side can surface it (smaller-notes fix).
- Retrieval wraps graphiti.search() in embeddings.query_mode() so the query
  gets Nomic's search_query: prefix (FIX #5 wiring).
- The relevance x recency x salience reranker is now implemented on top of
  Graphiti's hybrid results, using the config constants that previously lied.
- CORTEX_DEBUG=1 re-raises exceptions instead of silent degradation.
- LLMConfig now imported from models.py (circular-import fix).
"""

import logging
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import BackgroundTasks, FastAPI
from pydantic import BaseModel

from .config import (
    CORTEX_DEBUG,
    DATA_DIR,
    DEFAULT_TOKEN_BUDGET,
    BRIEFS_BUDGET_RATIO,
    RECENCY_HALF_LIFE_DAYS,
    RERANK_W_RECENCY,
    RERANK_W_RELEVANCE,
    RERANK_W_SALIENCE,
    RETRIEVAL_CANDIDATES,
    SALIENCE_FLOOR,
)
from .models import LLMConfig

logger = logging.getLogger("cortex.sidecar")

# Last-used LLM config — stored on /extract or /reflect so approve can consolidate.
_last_llm_config: LLMConfig | None = None

GROUP_ID = "cortex"


def _cosine_sim(a: list[float], b: list[float]) -> float:
    """Fast cosine similarity for MMR diversity check."""
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(x * x for x in b) ** 0.5
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"Cortex sidecar starting — data dir: {DATA_DIR}")
    try:
        from .graph import initialize as init_graph
        await init_graph()
    except Exception as e:
        logger.critical(f"Graphiti initialization failed — running degraded: {e}")
        if CORTEX_DEBUG:
            raise

    # Prune old telemetry snapshots on startup
    try:
        from .telemetry import prune_snapshots
        prune_snapshots()
    except Exception:
        pass
    yield
    try:
        from .graph import close as close_graph
        await close_graph()
    except Exception:
        pass
    logger.info("Cortex sidecar shutting down")


app = FastAPI(title="Cortex Memory Sidecar", version="2.1.0", lifespan=lifespan)


# ── Models ───────────────────────────────────────────────────────


class HealthResponse(BaseModel):
    status: str = "ok"  # "ok" | "degraded"
    version: str = "2.1.0"
    entities: int = 0
    edges: int = 0
    error: str | None = None


class RetrieveRequest(BaseModel):
    query: str
    token_budget: int = DEFAULT_TOKEN_BUDGET
    include_profile: bool = True
    group_id: str = "business"
    cite_sources: bool = False
    scoped: bool = True
    exchange_id: str | None = None
    session_id: str | None = None


class RetrieveResponse(BaseModel):
    context: str = ""
    facts_used: int = 0
    entities_used: int = 0
    latency_ms: float = 0.0
    profile_included: bool = False
    briefs_included: int = 0
    brief_modules: list[str] = []


class ExtractRequest(BaseModel):
    user_message: str
    assistant_response: str
    llm_config: LLMConfig
    session_id: str | None = None
    group_id: str = "business"


class ExtractionResult(BaseModel):
    entities_created: int = 0
    entities_updated: int = 0
    relationships_created: int = 0
    facts_stored: int = 0
    profile_updates_queued: int = 0
    modules_created: list = []


class ReflectRequest(BaseModel):
    fact_ids: list[str] | None = None
    llm_config: LLMConfig


class ReflectionResult(BaseModel):
    insights_created: int = 0
    contradictions_found: int = 0
    patterns_identified: list[str] = []


class SearchRequest(BaseModel):
    query: str
    limit: int = 10
    group_id: str = "business"


class StatsResponse(BaseModel):
    entities: int = 0
    edges: int = 0
    facts: int = 0
    episodes: int = 0
    pending_updates: int = 0


# ── Priority reranker (relevance x recency x salience) ───────────


def _edge_salience(edge) -> float:
    from .salience import get_salience
    uuid = getattr(edge, "uuid", None)
    if uuid:
        raw = get_salience(uuid)
        if raw is not None:
            return min(1.0, max(SALIENCE_FLOOR, raw))
    return 0.5


def _edge_recency(edge, now: datetime) -> float:
    """Exponential decay with configurable half-life; valid_at preferred."""
    ts = getattr(edge, "valid_at", None) or getattr(edge, "created_at", None)
    if ts is None:
        return 0.5
    if isinstance(ts, str):
        try:
            ts = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        except ValueError:
            return 0.5
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    age_days = max(0.0, (now - ts).total_seconds() / 86400.0)
    return 0.5 ** (age_days / RECENCY_HALF_LIFE_DAYS)


def rerank(edges: list, history_mode: bool = False) -> list:
    """Blend Graphiti's hybrid-search rank with recency and salience.

    relevance: 1.0 for Graphiti's top result, decaying linearly with rank —
    Graphiti's RRF output is ordinal, so rank position is the honest signal.
    
    SESSION-2 FIX: Edges with invalid_at set are penalized hard (0.15x) so
    superseded facts don't outrank current ones. They remain findable for
    history queries but won't dominate current-state answers.
    
    SESSION-4 FIX: history_mode=True disables the invalid_at penalty and
    includes superseded edges with chronological ordering. This surfaces
    the full transition trajectory for queries about change/evolution."""
    if not edges:
        return edges
    now = datetime.now(timezone.utc)
    n = len(edges)
    scored = []
    for i, edge in enumerate(edges):
        relevance = 1.0 - (i / n)
        
        # Penalize superseded (invalidated) edges — unless in history mode
        invalid_at = getattr(edge, "invalid_at", None)
        if history_mode:
            invalidity_penalty = 1.0  # No penalty in history mode
        else:
            invalidity_penalty = 0.15 if invalid_at is not None else 1.0
        
        score = (
            RERANK_W_RELEVANCE * relevance
            + RERANK_W_RECENCY * _edge_recency(edge, now)
            + RERANK_W_SALIENCE * _edge_salience(edge)
        ) * invalidity_penalty
        scored.append((score, i, edge))
    scored.sort(key=lambda t: (-t[0], t[1]))
    return [edge for _, _, edge in scored]


# ── Endpoints ────────────────────────────────────────────────────


@app.get("/health", response_model=HealthResponse)
async def health():
    """Readiness check — honest about degraded mode."""
    from .graph import get_init_error, get_stats as graph_stats

    init_error = get_init_error()
    if init_error:
        return HealthResponse(status="degraded", error=init_error)

    try:
        stats = await graph_stats()

        # Opportunistic staleness check (cheap — just date math, no LLM)
        try:
            from .facts import get_facts_store
            get_facts_store().check_staleness()
        except Exception:
            pass

        return HealthResponse(
            status="ok",
            entities=stats.get("entities", 0),
            edges=stats.get("edges", 0),
        )
    except Exception as e:
        return HealthResponse(status="degraded", error=str(e))


@app.post("/retrieve", response_model=RetrieveResponse)
async def retrieve(request: RetrieveRequest):
    """Graphiti hybrid search (query-prefixed) -> priority rerank -> budget."""
    start = time.time()
    try:
        from .graph import get_adapter

        adapter = get_adapter()
        if not adapter or not adapter.is_ready():
            return RetrieveResponse(latency_ms=(time.time() - start) * 1000)

        # History-mode detection: queries about change/evolution/trajectory
        # surface superseded edges without the invalid_at penalty.
        import re
        _HISTORY_KEYWORDS = re.compile(
            r'\b(change[ds]?|changed|evolution|evolve[ds]?|history|since|over time|'
            r'transition|grew|growth|trajectory|progress|how has|what happened)\b',
            re.IGNORECASE
        )
        history_mode = bool(_HISTORY_KEYWORDS.search(request.query))

        # Client contexts also include business facts (user's own prefs/constraints)
        group_ids = [request.group_id]
        if request.group_id != "business" and request.group_id != "off":
            group_ids.append("business")

        edges = await adapter.search(
            query=request.query,
            num_results=RETRIEVAL_CANDIDATES,
            group_ids=group_ids,
        )

        # In history mode, supplement with superseded edges via typed method
        if history_mode:
            try:
                superseded = await adapter.get_superseded_facts(group_ids, limit=15)
                existing_uuids = {e.uuid for e in edges}
                for edge in superseded:
                    if edge.uuid and edge.uuid not in existing_uuids:
                        edges.append(edge)
                        existing_uuids.add(edge.uuid)
                if superseded:
                    logger.info(f"History mode: added {len(superseded)} superseded edges")
            except Exception as e:
                logger.debug(f"History-mode supplementary fetch failed: {e}")

        edges = rerank(edges, history_mode=history_mode)

        # ── SCOPED briefs (reuses step-1/2 work; no extra embed call) ──
        briefs: list[str] = []
        brief_fact_uuids: set[str] = set()
        brief_modules_names: list[str] = []

        if request.scoped:
            try:
                from .modules import get_module_store
                from .scoped import compile_briefs

                store = get_module_store()
                store.flag_expired()

                # Collect top entity uuids from reranked facts
                top_entities = set()
                for e in edges[:10]:
                    for attr in ("source_node_uuid", "target_node_uuid"):
                        u = getattr(e, attr, None)
                        if u:
                            top_entities.add(u)

                # Embed the query via adapter (reuses same model/prefix as search)
                q_emb = await adapter.embed_query(request.query)

                matched = store.match(q_emb, top_entities)
                if matched:
                    brief_modules_names = [m.title for m in matched]
                    # Pass adapter which has check_invalidated typed method
                    briefs, brief_fact_uuids = await compile_briefs(
                        matched, adapter
                    )
            except Exception as e:
                logger.warning(f"SCOPED assembly skipped: {e}")
                if CORTEX_DEBUG:
                    raise

        facts_budget = request.token_budget
        profile_context = ""
        profile_included = False

        # Compute briefs budget
        briefs_text = ""
        briefs_tokens = 0
        if briefs:
            briefs_text = "\n\n".join(briefs)
            briefs_tokens = len(briefs_text) // 4
            briefs_cap = int(request.token_budget * BRIEFS_BUDGET_RATIO)
            if briefs_tokens > briefs_cap and len(briefs) > 1:
                briefs = briefs[:1]  # keep the urgent/top brief
                briefs_text = briefs[0]
                briefs_tokens = len(briefs_text) // 4

        facts_budget = request.token_budget - briefs_tokens

        if request.include_profile:
            try:
                from .profile import get_profile_manager
                profile_context = get_profile_manager().get_profile_context(
                    request.token_budget
                )
                if profile_context:
                    profile_included = True
                    facts_budget = facts_budget - len(profile_context) // 4
            except Exception as e:
                logger.debug(f"Profile context error: {e}")
                if CORTEX_DEBUG:
                    raise

        context_parts = []
        token_count = 0
        facts_used = 0
        entities_seen = set()

        # ── Position 1: User-declared Facts (always-on, verbatim) ────
        facts_context = ""
        injected_fact_texts = set()
        try:
            from .facts import get_facts_store
            facts_store = get_facts_store()

            # Always-on: injected unconditionally
            facts_context = facts_store.get_always_on_context(request.token_budget)
            if facts_context:
                context_parts.append(facts_context)
                token_count += len(facts_context) // 4
                # Track for dedup
                for f in facts_store.get_always_on():
                    injected_fact_texts.add(f.display_text().lower().strip())

            # Pinned: semantically matched (reuse query embedding from adapter)
            if adapter:
                q_emb_for_facts = await adapter.embed_query(request.query)
                if q_emb_for_facts:
                    matched_pinned = facts_store.match_pinned(q_emb_for_facts)
                    if matched_pinned:
                        pinned_lines = []
                        for pf in matched_pinned:
                            text = pf.display_text()
                            tokens = len(text) // 4
                            if token_count + tokens > request.token_budget * 0.25:
                                break
                            pinned_lines.append(f"• {text}")
                            token_count += tokens
                            injected_fact_texts.add(text.lower().strip())
                        if pinned_lines:
                            context_parts.append(
                                "[Relevant Facts]\n" + "\n".join(pinned_lines) + "\n[End Relevant Facts]"
                            )
        except Exception as e:
            logger.debug(f"Facts injection error: {e}")
            if CORTEX_DEBUG:
                raise

        # Assembly order: briefs (decision frame), then profile, then memory facts
        if briefs_text:
            context_parts.append(briefs_text)

        if profile_context:
            context_parts.append(profile_context)

        # MMR (Maximal Marginal Relevance): greedily select facts that are
        # relevant to the query but DIVERSE from each other. This prevents
        # 5 near-duplicate "IIMAGINE is an AI company" edges from spending
        # the token budget that a specific runway figure needs.
        # DISABLED for small graphs (< 15 edges) where there's no redundancy to prune.
        selected_embeddings: list[list[float]] = []
        use_mmr = len(edges) >= 15

        for edge in edges:
            fact_text = getattr(edge, "fact", "") or getattr(edge, "name", "")
            if not fact_text:
                continue

            # Skip facts already rendered inside a brief (no token spent twice)
            edge_uuid = getattr(edge, "uuid", None)
            if edge_uuid and edge_uuid in brief_fact_uuids:
                continue

            # Dedup: skip if this memory fact duplicates an injected user Fact
            if injected_fact_texts:
                fact_lower = fact_text.lower().strip()
                if any(ft in fact_lower or fact_lower in ft
                       for ft in injected_fact_texts):
                    continue

            tokens = len(fact_text) // 4
            if token_count + tokens > facts_budget:
                break

            # MMR diversity check: skip if too similar to already-selected facts
            # Only active for larger graphs where redundancy exists.
            edge_embedding = getattr(edge, "fact_embedding", None)
            if use_mmr and edge_embedding and selected_embeddings:
                max_sim = max(
                    _cosine_sim(edge_embedding, sel)
                    for sel in selected_embeddings
                )
                if max_sim > 0.85 and facts_used >= 3:
                    continue

            # Annotate superseded facts so the advisory model sees trajectory
            invalid_at = getattr(edge, "invalid_at", None)
            created_at = getattr(edge, "created_at", None)
            
            # Build citation suffix if enabled
            citation = ""
            if request.cite_sources and created_at:
                ts_str = str(created_at)[:10] if created_at else ""
                if ts_str:
                    citation = f" [learned: {ts_str}]"
            
            if invalid_at is not None:
                context_parts.append(f"- [superseded] {fact_text}{citation}")
            else:
                context_parts.append(f"- {fact_text}{citation}")
            token_count += tokens
            facts_used += 1
            if use_mmr:
                edge_embedding = getattr(edge, "fact_embedding", None)
                if edge_embedding:
                    selected_embeddings.append(edge_embedding)
            for attr in ("source_node_uuid", "target_node_uuid"):
                uuid = getattr(edge, attr, None)
                if uuid:
                    entities_seen.add(uuid)

        context = ""
        if context_parts:
            # Precedence instruction: Facts are authoritative
            precedence = (
                "[Advisory Rule: User-declared Facts are authoritative. "
                "Where memory or profile conflicts with a Fact, the Fact wins. "
                "Do not assert a contradicting value back to the user.]\n"
            )
            context = precedence + "[Memory Context]\n" + "\n".join(context_parts) + "\n[End Memory Context]"

        # Inline contradiction flag: if there's an unacknowledged contradiction,
        # add a one-time instruction for the AI to mention it gracefully.
        contradiction_flag = None
        try:
            from .facts import get_facts_store
            flag = get_facts_store().get_inline_flag()
            if flag:
                contradiction_flag = (
                    f"\n[Fact Contradiction — mention once, briefly]\n"
                    f"Your Facts say: \"{flag['stored_fact']}\"\n"
                    f"Recent conversation suggests: \"{flag['new_fact']}\"\n"
                    f"Tell the user: \"Quick flag: you mentioned {flag['new_fact']}, but your Facts list "
                    f"{flag['stored_fact']}. I'll keep using your Facts until you update them — "
                    f"want me to change it?\" Then continue with your normal response. "
                    f"Do not repeat this flag in subsequent messages.\n"
                    f"[End Fact Contradiction]"
                )
                context += contradiction_flag
                # Mark as acknowledged so it doesn't repeat next turn
                get_facts_store().acknowledge_contradiction(flag["fact_id"])
        except Exception as e:
            logger.debug(f"Contradiction flag error: {e}")

        latency_ms = (time.time() - start) * 1000
        logger.info(f"Retrieval: {facts_used} facts, {len(entities_seen)} entities, {latency_ms:.0f}ms")

        # Telemetry: log retrieval event + context snapshot
        try:
            from .telemetry import log_event, save_context_snapshot
            log_event("retrieve", request.exchange_id, request.session_id,
                      query=request.query,
                      facts_used=facts_used,
                      briefs_included=len(briefs),
                      brief_modules=brief_modules_names,
                      profile_included=profile_included,
                      latency_ms=round(latency_ms, 1),
                      scoped=request.scoped)
            if request.exchange_id:
                save_context_snapshot(request.exchange_id, context)
        except Exception:
            pass  # telemetry must never break the request

        return RetrieveResponse(
            context=context,
            facts_used=facts_used,
            entities_used=len(entities_seen),
            latency_ms=latency_ms,
            profile_included=profile_included,
            briefs_included=len(briefs),
            brief_modules=brief_modules_names,
        )
    except Exception as e:
        logger.error(f"Retrieval endpoint error: {e}")
        if CORTEX_DEBUG:
            raise
        return RetrieveResponse(latency_ms=(time.time() - start) * 1000)


@app.post("/extract", response_model=ExtractionResult)
async def extract(request: ExtractRequest):
    global _last_llm_config
    try:
        from .extraction import run_extraction

        # Skip extraction if memory is off
        if request.group_id == "off":
            return ExtractionResult()

        _last_llm_config = request.llm_config
        result = await run_extraction(
            user_message=request.user_message,
            assistant_response=request.assistant_response,
            llm_config=request.llm_config,
            session_id=request.session_id,
            group_id=request.group_id,
        )
        return ExtractionResult(**result)
    except Exception as e:
        logger.error(f"Extraction endpoint error: {e}")
        if CORTEX_DEBUG:
            raise
        return ExtractionResult()


@app.post("/reflect", response_model=ReflectionResult)
async def reflect(request: ReflectRequest):
    try:
        from .reflection import run_reflection

        result = await run_reflection(
            llm_config=request.llm_config, fact_ids=request.fact_ids
        )
        return ReflectionResult(**result)
    except Exception as e:
        logger.error(f"Reflection endpoint error: {e}")
        if CORTEX_DEBUG:
            raise
        return ReflectionResult()


@app.get("/profile")
async def get_profile():
    from .profile import get_profile_manager
    return get_profile_manager().get_profile().model_dump()


@app.patch("/profile")
async def update_profile(update: dict):
    try:
        from .profile import get_profile_manager
        section = update.get("section", "business")
        fact = update.get("fact", "")
        if fact:
            get_profile_manager().apply_update(section, fact)
        return {"success": True}
    except Exception as e:
        logger.error(f"Profile update error: {e}")
        return {"success": False, "error": str(e)}


@app.get("/stats", response_model=StatsResponse)
async def get_stats():
    try:
        from .graph import get_stats as graph_stats
        from .profile import get_profile_manager

        stats = await graph_stats()
        pending = get_profile_manager().get_pending_updates()
        return StatsResponse(
            entities=stats.get("entities", 0),
            edges=stats.get("edges", 0),
            facts=stats.get("facts", 0),
            episodes=stats.get("episodes", 0),
            pending_updates=len(pending),
        )
    except Exception as e:
        logger.error(f"Stats endpoint error: {e}")
        return StatsResponse()


@app.post("/search")
async def search(request: SearchRequest):
    try:
        from .graph import get_adapter

        adapter = get_adapter()
        if not adapter or not adapter.is_ready():
            return {"results": []}

        edges = await adapter.search(
            query=request.query,
            num_results=request.limit,
            group_ids=[request.group_id],
        )
        edges = rerank(edges)

        return {
            "results": [
                {
                    "fact": e.fact or e.name,
                    "uuid": e.uuid,
                    "salience": _edge_salience(e),
                    "source_node": e.source_node_uuid,
                    "target_node": e.target_node_uuid,
                    "created_at": str(e.created_at or ""),
                }
                for e in edges
            ]
        }
    except Exception as e:
        logger.error(f"Search endpoint error: {e}")
        if CORTEX_DEBUG:
            raise
        return {"results": []}


@app.delete("/clear")
async def clear():
    try:
        from .graph import clear_all
        from .facts import get_facts_store
        from .modules import get_module_store
        from .profile import get_profile_manager
        from .salience import clear as clear_salience

        await clear_all()
        get_profile_manager().reset()
        get_module_store().reset()
        get_facts_store().reset()
        clear_salience()
        return {"success": True, "message": "All memory cleared"}
    except Exception as e:
        logger.error(f"Clear error: {e}")
        return {"success": False, "message": str(e)}


@app.get("/pending-updates")
async def get_pending_updates():
    from .profile import get_profile_manager
    return {"updates": get_profile_manager().get_pending_updates()}


@app.post("/pending-updates/{update_id}/approve")
async def approve_update(update_id: str):
    from .profile import get_profile_manager
    from .module_updater import apply_module_proposal_if_exists
    mgr = get_profile_manager()
    success = mgr.approve_update(update_id)
    if success:
        # Check if this was a module update proposal and apply it
        apply_module_proposal_if_exists(update_id)
        # Trigger consolidation after approval if LLM config is available.
        if _last_llm_config:
            await mgr.consolidate_if_needed(_last_llm_config)
    return {"success": success}


@app.post("/pending-updates/{update_id}/reject")
async def reject_update(update_id: str):
    from .profile import get_profile_manager
    from .module_updater import reject_module_proposal_if_exists
    success = get_profile_manager().reject_update(update_id)
    if success:
        reject_module_proposal_if_exists(update_id)
    return {"success": success}


# ── Module (SCOPED objectives) endpoints ─────────────────────────


@app.get("/modules")
async def list_modules():
    from .modules import get_module_store
    return {"modules": [m.model_dump(mode="json") for m in get_module_store().list()]}


@app.post("/modules")
async def create_module(body: dict):
    from .modules import get_module_store
    from .graph import get_adapter

    adapter = get_adapter()
    # The module store needs an embedder-like object; adapter provides embed_storage
    module = await get_module_store().create(body, embedder=adapter)
    return module.model_dump(mode="json")


@app.patch("/modules/{module_id}")
async def update_module(module_id: str, patch: dict):
    from .modules import get_module_store
    m = get_module_store().update(module_id, patch)
    return m.model_dump(mode="json") if m else {"error": "not found"}


@app.delete("/modules/{module_id}")
async def delete_module(module_id: str):
    from .modules import get_module_store
    success = get_module_store().delete(module_id)
    return {"success": success}


# ── Facts endpoints (user-declared ground truth) ─────────────────


class FactCreateRequest(BaseModel):
    tier: str = "always_on"  # "always_on" | "pinned"
    key: str = ""
    value: str


class FactUpdateRequest(BaseModel):
    key: str | None = None
    value: str | None = None


@app.get("/facts")
async def get_facts():
    from .facts import get_facts_store
    store = get_facts_store()
    return store.get_all()


@app.get("/facts/budget")
async def get_facts_budget():
    """Return budget usage for always-on tier."""
    from .facts import get_facts_store
    store = get_facts_store()
    return store.get_always_on_budget_usage(DEFAULT_TOKEN_BUDGET)


@app.post("/facts")
async def create_fact(request: FactCreateRequest):
    """Add a new fact. Pinned facts get embedded automatically."""
    from .facts import get_facts_store
    from .graph import get_adapter

    store = get_facts_store()
    embedding = None

    # Embed pinned facts for semantic matching
    if request.tier == "pinned":
        adapter = get_adapter()
        if adapter:
            text_to_embed = f"{request.key}: {request.value}" if request.key else request.value
            embedding = await adapter.embed_storage(text_to_embed)

    fact = store.add(
        tier=request.tier,
        key=request.key,
        value=request.value,
        embedding=embedding,
    )
    return fact.to_dict()


@app.patch("/facts/{fact_id}")
async def update_fact(fact_id: str, request: FactUpdateRequest):
    """Update a fact. Re-embeds if value changes and fact is pinned."""
    from .facts import get_facts_store
    from .graph import get_adapter

    store = get_facts_store()
    embedding = None

    # Re-embed if value changed and fact is in pinned tier
    if request.value is not None:
        fact = store._find(fact_id)
        if fact and fact in store._pinned:
            adapter = get_adapter()
            if adapter:
                key = request.key if request.key is not None else fact.key
                text_to_embed = f"{key}: {request.value}" if key else request.value
                embedding = await adapter.embed_storage(text_to_embed)

    result = store.update(
        fact_id=fact_id,
        key=request.key,
        value=request.value,
        embedding=embedding,
    )
    if result:
        return result.to_dict()
    return {"error": "Fact not found"}


@app.delete("/facts/{fact_id}")
async def delete_fact(fact_id: str):
    from .facts import get_facts_store
    success = get_facts_store().delete(fact_id)
    return {"success": success}


@app.post("/facts/{fact_id}/confirm")
async def confirm_fact(fact_id: str):
    """Mark a fact as 'still true' — suppresses contradiction re-flagging."""
    from .facts import get_facts_store
    success = get_facts_store().confirm(fact_id)
    return {"success": success}


@app.get("/facts/contradictions")
async def get_contradictions():
    """Return active (unresolved) contradictions for the digest UI."""
    from .facts import get_facts_store
    return {"contradictions": get_facts_store().get_active_contradictions()}


@app.post("/facts/{fact_id}/acknowledge")
async def acknowledge_contradiction(fact_id: str):
    """Mark a contradiction as seen (stops inline re-flagging)."""
    from .facts import get_facts_store
    success = get_facts_store().acknowledge_contradiction(fact_id)
    return {"success": success}


@app.get("/facts/stale")
async def get_stale_facts():
    """Run staleness check and return facts that need user review."""
    from .facts import get_facts_store
    store = get_facts_store()
    # Run the sweep (idempotent — won't re-flag already-flagged facts)
    new_stale = store.check_staleness()
    # Return all currently stale facts (including previously flagged)
    all_stale = store.get_stale_facts()
    return {"stale": all_stale, "newly_flagged": len(new_stale)}


@app.post("/facts/{fact_id}/resolve-stale")
async def resolve_stale_fact(fact_id: str):
    """Mark a stale fact as reviewed (user confirmed or will update separately)."""
    from .facts import get_facts_store
    get_facts_store().resolve_staleness(fact_id)
    return {"success": True}


# ── Telemetry & Signals endpoints ────────────────────────────────


class LogResponseRequest(BaseModel):
    exchange_id: str | None = None
    session_id: str | None = None
    user_message: str = ""
    assistant_response: str = ""


@app.post("/log/response")
async def log_response(req: LogResponseRequest, background_tasks: BackgroundTasks):
    """Log the assistant's response and trigger proxy signals (async)."""
    from .telemetry import log_event
    from .signals import check_correction, extract_questions

    log_event("response", req.exchange_id, req.session_id,
              response_len=len(req.assistant_response),
              response_text=req.assistant_response[:4000],
              question_count=len(extract_questions(req.assistant_response)))

    # Correction detector (synchronous — cheap pattern match)
    check_correction(req.exchange_id, req.session_id, req.user_message)

    # Redundant-question detector (background — local embeds only)
    async def _bg():
        try:
            from .graph import get_adapter
            adapter = get_adapter()
            if not adapter or not adapter.is_ready():
                return

            async def search_fn(q: str, limit: int):
                edges = await adapter.search(query=q, group_ids=[GROUP_ID], num_results=limit)
                return [{"fact": e.fact} for e in edges if e.invalid_at is None]

            async def embed_q(text: str):
                return await adapter.embed_query(text)

            async def embed_d(text: str):
                return await adapter.embed_storage(text)

            from .signals import check_redundant_questions
            await check_redundant_questions(req.exchange_id, req.session_id,
                                           req.assistant_response,
                                           search_fn, embed_q, embed_d)
        except Exception as e:
            logger.debug(f"redundant-question bg check failed: {e}")

    background_tasks.add_task(_bg)
    return {"success": True}


@app.post("/memory-miss")
async def memory_miss(body: dict):
    """Log a user-reported memory failure (the failure journal)."""
    from .telemetry import flag_exchange, log_event
    xid = body.get("exchange_id")
    log_event("miss", xid, body.get("session_id"), note=body.get("note", ""))
    if xid:
        flag_exchange(xid, "miss")
    return {"success": True, "message": "Logged — this exchange is kept for review"}


@app.get("/metrics")
async def metrics():
    """Rolling 7-day KPIs from the event log."""
    from .telemetry import aggregate
    return aggregate(7)


@app.get("/metrics/history")
async def metrics_history():
    """Weekly KPI history (dashboard sparklines)."""
    from .telemetry import KPI_HISTORY_PATH
    import json as _json
    if KPI_HISTORY_PATH.exists():
        return {"history": _json.loads(KPI_HISTORY_PATH.read_text())}
    return {"history": []}


@app.get("/metrics/failures")
async def metrics_failures():
    """Recent misses + signal hits for the dashboard failures panel."""
    from .telemetry import recent_failures
    return {"failures": recent_failures(20)}


# ── Debug endpoints (CORTEX_DEBUG only) ──────────────────────────


class CypherRequest(BaseModel):
    query: str


@app.post("/debug/cypher")
async def debug_cypher(request: CypherRequest):
    """Execute raw Cypher against the graph. CORTEX_DEBUG only.
    
    Required for eval suite bi-temporal assertions (checking invalid_at,
    node counts, edge properties directly)."""
    if not CORTEX_DEBUG:
        return {"error": "Only available in debug mode (CORTEX_DEBUG=1)"}

    from .graph import get_adapter
    adapter = get_adapter()
    if not adapter:
        return {"error": "Adapter not initialized", "rows": []}

    try:
        rows = await adapter.execute_raw_query(request.query)
        return {"rows": rows, "count": len(rows)}
    except Exception as e:
        return {"error": str(e), "rows": []}
