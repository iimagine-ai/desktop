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

    # Entity dedup sweep — runs after reflection to catch alias drift.
    dedup_count = await run_entity_dedup(llm_config)
    if dedup_count:
        result["entities_merged"] = dedup_count

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

    graphiti = None  # No longer needed — adapter handles storage
    from .graph import get_adapter
    adapter = get_adapter()
    if not adapter or not adapter.is_ready():
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

    from .graph import get_adapter

    for insight in parsed.get("insights", []):
        content = (insight.get("content") or "").strip()
        if len(content) < 10:
            continue
        try:
            adapter = get_adapter()
            if adapter:
                # FIX #3.1: stored where retrieval actually looks.
                await adapter.add_reflection_episode(
                    name=f"reflection-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S%f')}",
                    body=f"Derived pattern from past conversations: {content}",
                    source_description=REFLECTION_SOURCE,
                    reference_time=datetime.now(timezone.utc),
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
    """Most recent facts by created_at via the graph adapter's typed methods."""
    from .graph import get_adapter

    adapter = get_adapter()
    if not adapter:
        return []

    try:
        if fact_ids:
            rows = await adapter.get_facts_by_ids(fact_ids)
        else:
            rows = await adapter.get_recent_facts(GROUP_ID, limit=50)

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


# ── Entity Dedup Sweep ───────────────────────────────────────────

DEDUP_PROMPT = """You are maintaining a knowledge graph for a business advisory system.

These entity nodes may be duplicates (one might be a shortened name or alias of another):

{entities_json}

For each PAIR, decide: are these the SAME real-world entity?
- "Sarah" and "Sarah Chen" → SAME (one is a shortened name)
- "Sarah Chen" and "Sarah Kim" → DIFFERENT (different last names)
- "IIMAGINE" and "Cortexa" → need context (could be a rename)

Output ONLY valid JSON:
{"merge_pairs": [["<name_to_keep>", "<name_to_merge_into_it>"], ...]}

Rules:
- Only merge when you're confident they're the same entity
- Keep the more specific/complete name (e.g. keep "Sarah Chen", merge "Sarah" into it)
- If unsure, do NOT merge
- Return empty merge_pairs if nothing should merge"""


async def run_entity_dedup(llm_config: LLMConfig) -> int:
    """LLM-assisted entity dedup sweep. Finds candidate pairs and merges confirmed duplicates.
    
    Returns the number of merges performed."""
    from .graph import get_adapter

    adapter = get_adapter()
    if not adapter or not adapter.is_ready():
        return 0

    try:
        # Find entity nodes that share a partial name (candidate pairs)
        rows = await adapter.find_dedup_candidates(GROUP_ID, limit=20)

        if not rows:
            logger.debug("Entity dedup: no candidate pairs found")
            return 0

        # Deduplicate pairs (a,b) and (b,a) are the same check
        seen = set()
        unique_pairs = []
        for row in rows:
            pair_key = tuple(sorted([row["name_a"], row["name_b"]]))
            if pair_key not in seen:
                seen.add(pair_key)
                unique_pairs.append(row)

        if not unique_pairs:
            return 0

        entities_json = json.dumps(
            [{"name_a": r["name_a"], "name_b": r["name_b"]} for r in unique_pairs],
            indent=2,
        )
        prompt = DEDUP_PROMPT.replace("{entities_json}", entities_json)

        raw = await call_llm(prompt, llm_config, max_tokens=500)
        if not raw:
            logger.warning("Entity dedup: LLM unavailable")
            return 0

        parsed = _parse_reflection_response(raw)
        if not parsed or not isinstance(parsed.get("merge_pairs"), list):
            return 0

        merged = 0
        for pair in parsed["merge_pairs"]:
            if not isinstance(pair, list) or len(pair) != 2:
                continue
            keep_name, merge_name = pair[0], pair[1]

            # Find the UUIDs from our candidate list
            keep_uuid = merge_uuid = None
            for row in unique_pairs:
                if row["name_a"] == keep_name:
                    keep_uuid = row["uuid_a"]
                elif row["name_b"] == keep_name:
                    keep_uuid = row["uuid_b"]
                if row["name_a"] == merge_name:
                    merge_uuid = row["uuid_a"]
                elif row["name_b"] == merge_name:
                    merge_uuid = row["uuid_b"]

            if not keep_uuid or not merge_uuid:
                logger.debug(f"Entity dedup: couldn't find UUIDs for {keep_name}/{merge_name}")
                continue

            success = await adapter.merge_entities(keep_uuid, merge_uuid)
            if success:
                merged += 1
                logger.info(f"Entity dedup: merged '{merge_name}' into '{keep_name}'")

        return merged

    except Exception as e:
        logger.warning(f"Entity dedup sweep failed: {e}")
        if CORTEX_DEBUG:
            raise
        return 0
