"""Cortex salience scoring — sidecar-owned, stored outside the graph.

Salience lives in a local JSON map (uuid -> float) rather than as FalkorDB
properties. This sidesteps the FalkorDB Lite non-primitive property limitation
and works identically regardless of backend (Lite today, server tomorrow).

One cheap LLM call per extraction exchange scores all new edges.

SESSION-2 FIX: Added reconcile() — a sweep that catches any edges left
unscored by the primary path (episode_result.edges can be empty for resolved
entities). Called after every extraction. Also: batches capped at 10 facts
per LLM call to avoid truncated JSON, and one retry on parse failure.
"""

import json
import logging
from pathlib import Path
from typing import Optional

from .config import DATA_DIR
from .llm_adapter import call_llm

logger = logging.getLogger("cortex.salience")

SALIENCE_PATH = DATA_DIR / "salience.json"

# Max facts per LLM scoring call — avoids truncated JSON at max_tokens 500.
BATCH_SIZE = 10

SCORING_PROMPT = """Score each fact for importance to future business advice, 0.0-1.0.

Scoring rubric:
0.8-1.0: decisions, commitments, financial figures, strategic pivots, funding rounds
0.5-0.7: objectives, preferences, team changes, product details, operational figures (headcount, customer count, pricing), market positioning/branding statements, standing operational commitments (SLAs, support hours, response times)
0.2-0.4: background context, general observations, routine status updates
0.0-0.1: greetings, small talk (should not appear — already filtered)

Examples:
- "Signed a 2-year office lease at $8k/month" → 0.85 (financial commitment)
- "Killed the mobile app, all resources to desktop" → 0.90 (strategic pivot)
- "$310k cash in the bank" → 0.85 (financial figure)
- "Our SLA is 24 hours" → 0.6 (standing operational commitment, not a new decision)
- "We market ourselves as the friendly AI for main-street businesses" → 0.55 (positioning statement)
- "Team has 7 people" → 0.6 (operational figure)
- "500 paying customers is our goal this year" → 0.7 (objective)
- "Priya moved from support to QA" → 0.55 (team change)
- "I prefer email over meetings" → 0.55 (working preference)
- "Coffee machine broke again" → 0.15 (trivia)

Facts to score:
{facts_json}

Output ONLY valid JSON: {"scores": {"<uuid>": <float>}}"""


def _load() -> dict[str, float]:
    try:
        if SALIENCE_PATH.exists():
            return json.loads(SALIENCE_PATH.read_text())
    except Exception:
        pass
    return {}


def _save(store: dict[str, float]) -> None:
    try:
        SALIENCE_PATH.write_text(json.dumps(store))
    except Exception as e:
        logger.warning(f"Failed to persist salience scores: {e}")


def clear() -> None:
    """Delete salience store. Called by /clear to avoid orphaned UUIDs."""
    try:
        if SALIENCE_PATH.exists():
            SALIENCE_PATH.unlink()
            logger.info("Salience store cleared")
    except Exception as e:
        logger.warning(f"Failed to clear salience store: {e}")


def get_salience(uuid: str) -> Optional[float]:
    """Look up a single edge's salience. Returns None if unscored."""
    return _load().get(uuid)


def get_salience_batch(uuids: list[str]) -> dict[str, float]:
    """Look up multiple edges. Returns {uuid: score} for found entries."""
    store = _load()
    return {u: store[u] for u in uuids if u in store}


async def _score_batch(facts: dict[str, str], llm_config, retry: bool = True) -> dict[str, float]:
    """Score a batch of {uuid: fact_text} via one LLM call.

    Retries once on parse failure. Returns {uuid: float} for scored entries."""
    if not facts:
        return {}

    prompt = SCORING_PROMPT.replace("{facts_json}", json.dumps(facts, indent=2))
    raw = await call_llm(prompt, llm_config, max_tokens=500)
    if not raw:
        logger.debug("Salience scoring: LLM unavailable")
        return {}

    try:
        text = raw.strip()
        first, last = text.find("{"), text.rfind("}")
        if first == -1 or last == -1:
            if retry:
                logger.debug("Salience scoring: no JSON found, retrying once")
                return await _score_batch(facts, llm_config, retry=False)
            return {}
        parsed = json.loads(text[first : last + 1])
        scores_raw = parsed.get("scores", {})

        clean = {}
        for uuid, score in scores_raw.items():
            if uuid in facts:
                clean[uuid] = min(1.0, max(0.0, float(score)))

        return clean

    except Exception as e:
        if retry:
            logger.debug(f"Salience scoring parse failed ({e}), retrying once")
            return await _score_batch(facts, llm_config, retry=False)
        logger.warning(f"Salience scoring parse failed after retry: {e}")
        return {}


async def score_edges(edges, llm_config) -> dict[str, float]:
    """Score extracted edges via LLM call(s). Non-blocking to the user.

    Args:
        edges: list of Graphiti EntityEdge objects from add_episode result
        llm_config: active LLMConfig for the scoring call

    Returns:
        {uuid: salience_float} for all successfully scored edges
    """
    facts = {}
    for e in edges:
        uuid = getattr(e, "uuid", None)
        fact = getattr(e, "fact", "") or getattr(e, "name", "")
        if uuid and fact and len(fact) >= 5:
            facts[uuid] = fact

    if not facts:
        return {}

    # Score in batches of BATCH_SIZE to avoid truncated JSON
    all_scores = {}
    items = list(facts.items())
    for i in range(0, len(items), BATCH_SIZE):
        batch = dict(items[i : i + BATCH_SIZE])
        scores = await _score_batch(batch, llm_config)
        all_scores.update(scores)

    # Persist
    if all_scores:
        store = _load()
        store.update(all_scores)
        _save(store)
        logger.info(f"Salience scored {len(all_scores)} edges")

    return all_scores


async def reconcile(llm_config, limit: int = 25) -> dict[str, float]:
    """Score any recent edges that were missed by the primary scoring path.

    This catches the case where Graphiti resolves to existing entities and
    episode_result.edges is empty — the primary score_edges() call has nothing
    to score, but the edges exist in the graph. Idempotent and self-healing.

    Called after every extraction. Also callable standalone for catch-up.
    """
    from .graph import get_adapter

    adapter = get_adapter()
    if not adapter:
        return {}

    store = _load()

    try:
        rows = await adapter.get_unscored_edges("cortex", limit=limit)
    except Exception as e:
        logger.debug(f"Salience reconcile query failed: {e}")
        return {}

    # Find unscored edges
    unscored = {}
    for row in rows:
        uuid = row.get("uuid")
        fact = row.get("fact") or ""
        if uuid and fact and len(fact) >= 5 and uuid not in store:
            unscored[uuid] = fact

    if not unscored:
        return {}

    logger.info(f"Salience reconcile: {len(unscored)} unscored edges found")

    # Score in batches
    all_scores = {}
    items = list(unscored.items())
    for i in range(0, len(items), BATCH_SIZE):
        batch = dict(items[i : i + BATCH_SIZE])
        scores = await _score_batch(batch, llm_config)
        all_scores.update(scores)

    # Persist
    if all_scores:
        store = _load()
        store.update(all_scores)
        _save(store)
        logger.info(f"Salience reconcile scored {len(all_scores)} edges")

    return all_scores
