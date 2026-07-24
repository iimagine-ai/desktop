"""Cortex reflection pass — derives higher-order patterns from recent facts.

FIX #3 (three parts):
1. Insights are now stored in group_id='cortex' — the SAME partition retrieval
   searches — tagged via source_description so they remain distinguishable.
   (Previously written to group_id='reflection', which nothing ever read.)
2. Fact gathering is genuinely recency-based: a Cypher query over RELATES_TO
   edges ordered by created_at, not a semantic search for the word 'recent'.
3. The deferred queue actually re-runs reflection instead of discarding items.
"""

import json
import logging
from datetime import datetime, timezone
from typing import Optional

from .config import CORTEX_DEBUG, MAX_DEFERRED_REFLECTIONS
from .graph import get_driver, get_graphiti
from .llm_adapter import call_llm
from .models import LLMConfig

logger = logging.getLogger("cortex.reflection")

GROUP_ID = "cortex"  # FIX #3.1: same partition as extraction & retrieval
REFLECTION_SOURCE = "cortex-reflection-pass"

_deferred_queue: list[dict] = []

REFLECTION_PROMPT = """You are analyzing recent facts from a business advisory knowledge graph to identify higher-order patterns.

Recent facts extracted from conversations:
{facts_json}

Tasks:
1. PATTERNS: Identify recurring themes, behavioral patterns, or strategic tendencies across these facts
2. INSIGHTS: Derive actionable insights that weren't explicitly stated but emerge from combining multiple facts
3. CONTRADICTIONS: Flag any facts that conflict with each other or suggest a change in direction

Rules:
- Each insight should be a single clear statement that synthesizes multiple facts
- Contradictions should identify specifically what conflicts and why it matters
- Only include genuine patterns (3+ related facts), not restatements of individual facts
- If no meaningful patterns emerge, return empty arrays

Output ONLY valid JSON:
{
  "insights": [
    {"content": "<insight statement>", "contributing_fact_ids": ["id1", "id2"], "salience": 0.0-1.0}
  ],
  "contradictions": [
    {"new_fact_id": "id", "conflicting_entity_id": "id", "description": "<what conflicts>"}
  ]
}"""


async def run_reflection(
    llm_config: LLMConfig,
    fact_ids: Optional[list[str]] = None,
) -> dict:
    result = await _reflect_once(llm_config, fact_ids)
    # FIX #3.3: drain deferred work now that the LLM is evidently reachable.
    while _deferred_queue:
        deferred = _deferred_queue.pop(0)
        logger.info(f"Processing deferred reflection from {deferred['deferred_at']}")
        deferred_result = await _reflect_once(llm_config, deferred.get("fact_ids"))
        if deferred_result.get("_llm_unavailable"):
            # LLM died mid-drain; stop and requeue.
            _defer_reflection(deferred.get("fact_ids"))
            break
        result["insights_created"] += deferred_result["insights_created"]
        result["contradictions_found"] += deferred_result["contradictions_found"]
        result["patterns_identified"].extend(deferred_result["patterns_identified"])

    result.pop("_llm_unavailable", None)
    return result


async def _reflect_once(
    llm_config: LLMConfig,
    fact_ids: Optional[list[str]] = None,
) -> dict:
    result = {
        "insights_created": 0,
        "contradictions_found": 0,
        "patterns_identified": [],
        "_llm_unavailable": False,
    }

    graphiti = get_graphiti()
    if not graphiti:
        logger.warning("Graph not available for reflection")
        _defer_reflection(fact_ids)
        return result

    facts = await _gather_recent_facts(fact_ids)
    if len(facts) < 3:  # Prompt requires 3+ related facts for a pattern
        logger.debug("Not enough facts to reflect on")
        return result

    prompt = REFLECTION_PROMPT.replace("{facts_json}", json.dumps(facts, indent=2))

    raw_response = await call_llm(prompt, llm_config, max_tokens=2000)
    if not raw_response:
        logger.warning("LLM unavailable for reflection — deferring")
        _defer_reflection(fact_ids)
        result["_llm_unavailable"] = True
        return result

    parsed = _parse_reflection_response(raw_response)
    if not parsed:
        return result

    from graphiti_core.nodes import EpisodeType

    for insight in parsed.get("insights", []):
        content = (insight.get("content") or "").strip()
        if len(content) < 10:
            continue
        try:
            # FIX #3.1: stored where retrieval actually looks.
            await graphiti.add_episode(
                name=f"reflection-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S%f')}",
                episode_body=f"Derived pattern from past conversations: {content}",
                source_description=REFLECTION_SOURCE,
                reference_time=datetime.now(timezone.utc),
                source=EpisodeType.text,
                group_id=GROUP_ID,
            )
            result["insights_created"] += 1
            result["patterns_identified"].append(content)
        except Exception as e:
            logger.warning(f"Failed to store insight: {e}")
            if CORTEX_DEBUG:
                raise

    for contradiction in parsed.get("contradictions", []):
        if contradiction.get("description"):
            result["contradictions_found"] += 1
            # Surfacing disputed facts in the approval sidebar is tracked work;
            # counting them keeps the API contract honest meanwhile.

    logger.info(
        f"Reflection: {result['insights_created']} insights, "
        f"{result['contradictions_found']} contradictions"
    )
    return result


# ── Fact Gathering (FIX #3.2) ────────────────────────────────────


async def _gather_recent_facts(fact_ids: Optional[list[str]] = None) -> list[dict]:
    """Most recent facts by created_at via direct Cypher — real recency,
    not a semantic search for the word 'recent'."""
    driver = get_driver()
    if not driver:
        return []

    try:
        if fact_ids:
            query = (
                "MATCH ()-[r:RELATES_TO]->() WHERE r.uuid IN $ids "
                "RETURN r.uuid AS uuid, r.fact AS fact, r.created_at AS created_at"
            )
            result = await driver.execute_query(query, ids=fact_ids)
        else:
            query = (
                "MATCH ()-[r:RELATES_TO]->() "
                "WHERE r.group_id = $gid AND r.invalid_at IS NULL "
                "RETURN r.uuid AS uuid, r.fact AS fact, r.created_at AS created_at "
                "ORDER BY r.created_at DESC LIMIT 50"
            )
            result = await driver.execute_query(query, gid=GROUP_ID)

        rows = result[0] if result else []
        return [
            {
                "id": row.get("uuid", ""),
                "fact": row.get("fact", ""),
                "timestamp": str(row.get("created_at", "")),
            }
            for row in rows
            if row.get("fact")
        ]
    except Exception as e:
        logger.warning(f"Fact gathering failed: {e}")
        if CORTEX_DEBUG:
            raise
        return []


# ── Deferred queue ───────────────────────────────────────────────


def _defer_reflection(fact_ids: Optional[list[str]]):
    global _deferred_queue
    _deferred_queue.append(
        {"fact_ids": fact_ids, "deferred_at": datetime.now(timezone.utc).isoformat()}
    )
    if len(_deferred_queue) > MAX_DEFERRED_REFLECTIONS:
        _deferred_queue = _deferred_queue[-MAX_DEFERRED_REFLECTIONS:]
    logger.debug(f"Deferred reflection queued ({len(_deferred_queue)} in queue)")


# ── Response Parsing ─────────────────────────────────────────────


def _parse_reflection_response(raw: str) -> Optional[dict]:
    if not raw:
        return None
    text = raw.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1] if "\n" in text else text[3:]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()

    first_brace = text.find("{")
    last_brace = text.rfind("}")
    if first_brace == -1 or last_brace == -1:
        return None
    try:
        data = json.loads(text[first_brace : last_brace + 1])
        return data if isinstance(data, dict) else None
    except json.JSONDecodeError as e:
        logger.warning(f"Reflection JSON parse error: {e}")
        return None
