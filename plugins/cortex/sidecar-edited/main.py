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

from fastapi import FastAPI
from pydantic import BaseModel

from .config import (
    CORTEX_DEBUG,
    DATA_DIR,
    DEFAULT_TOKEN_BUDGET,
    RECENCY_HALF_LIFE_DAYS,
    RERANK_W_RECENCY,
    RERANK_W_RELEVANCE,
    RERANK_W_SALIENCE,
    RETRIEVAL_CANDIDATES,
    SALIENCE_FLOOR,
)
from .models import LLMConfig

logger = logging.getLogger("cortex.sidecar")

GROUP_ID = "cortex"


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


class RetrieveResponse(BaseModel):
    context: str = ""
    facts_used: int = 0
    entities_used: int = 0
    latency_ms: float = 0.0
    profile_included: bool = False


class ExtractRequest(BaseModel):
    user_message: str
    assistant_response: str
    llm_config: LLMConfig
    session_id: str | None = None


class ExtractionResult(BaseModel):
    entities_created: int = 0
    entities_updated: int = 0
    relationships_created: int = 0
    facts_stored: int = 0
    profile_updates_queued: int = 0


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


class StatsResponse(BaseModel):
    entities: int = 0
    edges: int = 0
    facts: int = 0
    episodes: int = 0
    pending_updates: int = 0


# ── Priority reranker (relevance x recency x salience) ───────────


def _edge_salience(edge) -> float:
    attrs = getattr(edge, "attributes", None) or {}
    raw = attrs.get("salience")
    if raw is None:
        return 0.5
    try:
        return min(1.0, max(SALIENCE_FLOOR, float(raw)))
    except (TypeError, ValueError):
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


def rerank(edges: list) -> list:
    """Blend Graphiti's hybrid-search rank with recency and salience.

    relevance: 1.0 for Graphiti's top result, decaying linearly with rank —
    Graphiti's RRF output is ordinal, so rank position is the honest signal."""
    if not edges:
        return edges
    now = datetime.now(timezone.utc)
    n = len(edges)
    scored = []
    for i, edge in enumerate(edges):
        relevance = 1.0 - (i / n)
        score = (
            RERANK_W_RELEVANCE * relevance
            + RERANK_W_RECENCY * _edge_recency(edge, now)
            + RERANK_W_SALIENCE * _edge_salience(edge)
        )
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
        from .embeddings import query_mode
        from .graph import get_graphiti

        graphiti = get_graphiti()
        if not graphiti:
            return RetrieveResponse(latency_ms=(time.time() - start) * 1000)

        with query_mode():  # FIX #5: search_query: prefix on the query embedding
            edges = await graphiti.search(
                query=request.query,
                num_results=RETRIEVAL_CANDIDATES,
                group_ids=[GROUP_ID],
            )

        edges = rerank(edges)

        facts_budget = request.token_budget
        profile_context = ""
        profile_included = False

        if request.include_profile:
            try:
                from .profile import get_profile_manager
                profile_context = get_profile_manager().get_profile_context(
                    request.token_budget
                )
                if profile_context:
                    profile_included = True
                    facts_budget = request.token_budget - len(profile_context) // 4
            except Exception as e:
                logger.debug(f"Profile context error: {e}")
                if CORTEX_DEBUG:
                    raise

        context_parts = []
        token_count = 0
        facts_used = 0
        entities_seen = set()

        if profile_context:
            context_parts.append(profile_context)

        for edge in edges:
            fact_text = getattr(edge, "fact", "") or getattr(edge, "name", "")
            if not fact_text:
                continue
            tokens = len(fact_text) // 4
            if token_count + tokens > facts_budget:
                break
            context_parts.append(f"- {fact_text}")
            token_count += tokens
            facts_used += 1
            for attr in ("source_node_uuid", "target_node_uuid"):
                uuid = getattr(edge, attr, None)
                if uuid:
                    entities_seen.add(uuid)

        context = ""
        if context_parts:
            context = "[Memory Context]\n" + "\n".join(context_parts) + "\n[End Memory Context]"

        latency_ms = (time.time() - start) * 1000
        logger.info(f"Retrieval: {facts_used} facts, {len(entities_seen)} entities, {latency_ms:.0f}ms")

        return RetrieveResponse(
            context=context,
            facts_used=facts_used,
            entities_used=len(entities_seen),
            latency_ms=latency_ms,
            profile_included=profile_included,
        )
    except Exception as e:
        logger.error(f"Retrieval endpoint error: {e}")
        if CORTEX_DEBUG:
            raise
        return RetrieveResponse(latency_ms=(time.time() - start) * 1000)


@app.post("/extract", response_model=ExtractionResult)
async def extract(request: ExtractRequest):
    try:
        from .extraction import run_extraction

        result = await run_extraction(
            user_message=request.user_message,
            assistant_response=request.assistant_response,
            llm_config=request.llm_config,
            session_id=request.session_id,
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
        from .embeddings import query_mode
        from .graph import get_graphiti

        graphiti = get_graphiti()
        if not graphiti:
            return {"results": []}

        with query_mode():
            edges = await graphiti.search(
                query=request.query,
                num_results=request.limit,
                group_ids=[GROUP_ID],
            )
        edges = rerank(edges)

        return {
            "results": [
                {
                    "fact": getattr(e, "fact", "") or getattr(e, "name", ""),
                    "uuid": getattr(e, "uuid", ""),
                    "salience": (getattr(e, "attributes", None) or {}).get("salience"),
                    "source_node": getattr(e, "source_node_uuid", ""),
                    "target_node": getattr(e, "target_node_uuid", ""),
                    "created_at": str(getattr(e, "created_at", "")),
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
        from .profile import get_profile_manager

        await clear_all()
        get_profile_manager().reset()
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
    return {"success": get_profile_manager().approve_update(update_id)}


@app.post("/pending-updates/{update_id}/reject")
async def reject_update(update_id: str):
    from .profile import get_profile_manager
    return {"success": get_profile_manager().reject_update(update_id)}
