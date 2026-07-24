"""Cortex extraction pipeline — orchestrates episode ingestion via the adapter.

The adapter (adapters/graphiti_adapter.py) owns the schema, ontology config,
and extraction instructions. This file owns the business logic around what
gets extracted (user-only body, speculative content filtering) and what
happens with the result (salience scoring, profile routing, module updates).
"""

import logging
import os
from datetime import datetime, timezone
from typing import Optional

from .config import CORTEX_DEBUG
from .graph import get_adapter, reconfigure_llm
from .schema import LABEL_TO_PROFILE_SECTION

logger = logging.getLogger("cortex.extraction")

GROUP_ID = "cortex"  # Single fixed partition for the desktop app's memory

# Episode counter for periodic maintenance (dedup sweep every N episodes).
_episode_count: int = 0
DEDUP_SWEEP_INTERVAL = 25  # Run entity dedup every 25 episodes

# Edge type name → profile section. Primary routing signal — structural,
# model-independent, and designed to encode where a fact belongs.
EDGE_TO_PROFILE_SECTION: dict[str, str] = {
    "Prefers": "preferences",
    "Evaluated": "opportunities",
    "HasObjective": "objectives",
    "Pursues": "strategies",
    "Supports": "strategies",
    "HoldsResource": "resources",
    "Employs": "team",
    "HasSkill": "skills",
    "Offers": "products",
    "Targets": "segments",
    "Requires": "opportunities",
    "ConstrainedBy": "constraints",
}

async def run_extraction(
    user_message: str,
    assistant_response: str,
    llm_config,  # models.LLMConfig
    session_id: Optional[str] = None,
    group_id: str = "business",
) -> dict:
    """Ingest one conversation exchange via Graphiti. Returns count summary."""
    result = {
        "entities_created": 0,
        "entities_updated": 0,
        "relationships_created": 0,
        "facts_stored": 0,
        "profile_updates_queued": 0,
    }

    if not user_message or len(user_message.strip()) < 5:
        return result

    adapter = get_adapter()
    if not adapter or not adapter.is_ready():
        logger.warning("Graph adapter not ready — skipping extraction")
        return result

    await _ensure_llm_configured(llm_config)

    # SESSION-4 FIX: The assistant's speculative content is the primary contamination
    # source (scenarios 30's $50k pricing, acquisition suggestion). The user is ground
    # truth; the assistant's words rarely add extractable facts and frequently inject
    # hypotheticals. Use user message only for extraction; include a minimal assistant
    # ack ONLY if it's genuinely just an acknowledgment (no numbers, no suggestions).
    episode_body = f"User: {user_message}"
    if assistant_response:
        # Only include assistant response if it's a short ack without speculative content
        ack = assistant_response.split('.')[0].strip()
        is_speculative = any(w in ack.lower() for w in [
            'could', 'consider', 'maybe', 'might', 'perhaps', 'would', 'suggest',
            '$', '€', '¥', '%', 'pricing', 'acquire', 'hire'
        ])
        if len(ack) <= 60 and not is_speculative:
            episode_body += f"\nAssistant: {ack}."

    try:
        episode_result = await adapter.add_episode(
            body=episode_body,
            group_id=group_id,
            reference_time=datetime.now(timezone.utc),
            source_description="Desktop companion business advisory conversation",
        )

        if episode_result and (episode_result.nodes or episode_result.edges):
            nodes = episode_result.nodes or []
            edges = episode_result.edges or []
            result["entities_created"] = len(nodes)
            result["relationships_created"] = len(edges)
            result["facts_stored"] = len(edges)

            # Score edges for salience (one cheap LLM call)
            from .salience import score_edges, reconcile
            salience_map = await score_edges(edges, llm_config)

            # Reconcile: catch any edges that episode_result.edges missed
            # (resolved entities, updated edges, etc.)
            reconcile_scores = await reconcile(llm_config, limit=25)
            salience_map.update(reconcile_scores)

            result["profile_updates_queued"] = await _route_to_profile(
                nodes, edges, llm_config, salience_map
            )

            # Phase 2: Match extracted facts to SCOPED modules and propose updates
            try:
                from .module_updater import process_extraction_for_modules
                logger.debug(f"Calling process_extraction_for_modules with {len(edges)} edges, {len(nodes)} nodes")
                module_result = await process_extraction_for_modules(edges, llm_config, nodes)
                module_updates = module_result.get("updates", 0)
                modules_created = module_result.get("modules_created", [])
                if module_updates:
                    logger.info(f"Module updater: {module_updates} proposal(s) queued/applied")
                if modules_created:
                    logger.info(f"Module updater: created {len(modules_created)} new module(s): {modules_created}")
                    result["modules_created"] = modules_created
            except Exception as e:
                logger.error(f"Module updater FAILED: {type(e).__name__}: {e}")
                import traceback
                logger.error(traceback.format_exc())
                if CORTEX_DEBUG:
                    raise

            # Phase 3: Contradiction detection against user Facts
            try:
                from .facts import get_facts_store
                facts_store = get_facts_store()
                # Build (text, embedding) pairs from extracted edges
                new_fact_pairs = []
                for edge in edges:
                    fact_text = edge.fact or edge.name
                    emb = edge.fact_embedding
                    if fact_text and len(fact_text) >= 5:
                        new_fact_pairs.append((fact_text, emb))

                if new_fact_pairs:
                    candidates = facts_store.find_contradictions(new_fact_pairs)
                    for candidate in candidates:
                        # LLM confirmation would go here (Phase 2 — for now,
                        # key-match contradictions flag immediately; cosine-only
                        # contradictions flag with high threshold as proxy)
                        flagged = facts_store.flag_contradiction(
                            candidate["stored_fact_id"],
                            candidate["new_fact"],
                        )
                        if flagged:
                            logger.info(
                                f"Fact contradiction detected: "
                                f"'{candidate['new_fact'][:40]}' vs "
                                f"'{candidate['stored_fact_text'][:40]}'"
                            )
                            result["contradictions_flagged"] = result.get("contradictions_flagged", 0) + 1
            except Exception as e:
                logger.debug(f"Fact contradiction check failed: {e}")
                if CORTEX_DEBUG:
                    raise

        logger.info(
            f"Extraction: {result['entities_created']} entities, "
            f"{result['relationships_created']} edges, "
            f"{result['profile_updates_queued']} profile updates"
        )

        # Periodic entity dedup sweep (independent of reflection)
        global _episode_count
        _episode_count += 1
        if _episode_count % DEDUP_SWEEP_INTERVAL == 0:
            try:
                from .reflection import run_entity_dedup
                merged = await run_entity_dedup(llm_config)
                if merged:
                    logger.info(f"Periodic dedup sweep: merged {merged} entities")
            except Exception as e:
                logger.warning(f"Periodic dedup sweep failed: {e}")
                if CORTEX_DEBUG:
                    raise

    except Exception as e:
        logger.error(f"Graphiti add_episode failed: {e}")
        if CORTEX_DEBUG:
            raise  # Smaller-notes fix: don't hide bugs in development

    return result


# ── Profile Routing (FIX #2) ─────────────────────────────────────


def _node_type_label(node) -> Optional[str]:
    """Return the schema type label of a node ('Owner', 'Objective', ...).

    Graphiti EntityNodes carry labels: ['Entity', '<TypeName>'] when typed."""
    labels = getattr(node, "labels", None) or []
    for label in labels:
        if label in LABEL_TO_PROFILE_SECTION:
            return label
    return None


async def _route_to_profile(nodes, edges, llm_config, salience_map: dict = None) -> int:
    """Route extracted facts to profile sections.
    
    Routing priority:
    1. Edge type name (Prefers→preferences, Targets→segments, etc.)
    2. Target node type label (fallback when edge is untyped RELATES_TO)
    3. Source node type label
    4. "business" default
    """
    queued = 0
    if salience_map is None:
        salience_map = {}
    try:
        from .profile import get_profile_manager

        profile_mgr = get_profile_manager()

        # uuid -> type label, from THIS episode's nodes.
        node_types = {n.uuid: _node_type_label(n) for n in nodes}

        for edge in edges:
            fact_text = getattr(edge, "fact", "") or getattr(edge, "name", "")
            if not fact_text or len(fact_text) < 5:
                continue

            # Use sidecar-owned salience score
            edge_uuid = getattr(edge, "uuid", "")
            salience = salience_map.get(edge_uuid, 0.5)
            if salience < 0.1:
                continue

            # Route by edge type first — structural signal, model-independent
            edge_name = getattr(edge, "name", "") or ""
            section = EDGE_TO_PROFILE_SECTION.get(edge_name)

            if section is None:
                # Fallback: node type labels
                target_label = node_types.get(getattr(edge, "target_node_uuid", None))
                source_label = node_types.get(getattr(edge, "source_node_uuid", None))
                label = target_label or source_label
                section = LABEL_TO_PROFILE_SECTION.get(label, "business")

            profile_mgr.classify_and_route(
                fact_text=fact_text,
                salience=salience,
                section_name=section,
                source_fact_ids=[edge_uuid],
            )
            queued += 1

        # Consolidate any sections that have grown noisy.
        await profile_mgr.consolidate_if_needed(llm_config)

    except Exception as e:
        logger.warning(f"Profile routing error: {e}")
        if CORTEX_DEBUG:
            raise

    return queued


# ── LLM Configuration ────────────────────────────────────────────


async def _ensure_llm_configured(llm_config) -> None:
    adapter = get_adapter()
    if not adapter or not llm_config:
        return
    if not llm_config.api_key and llm_config.provider != "local":
        return

    base_url = llm_config.base_url
    if llm_config.provider == "local":
        base_url = base_url or f"http://127.0.0.1:{llm_config.engine_port}/v1"
    elif llm_config.provider == "openrouter":
        base_url = "https://openrouter.ai/api/v1"
    elif llm_config.provider == "openai":
        base_url = None

    await reconfigure_llm(
        api_key=llm_config.api_key or "local",
        model=llm_config.model,
        base_url=base_url,
        provider=llm_config.provider,
    )
