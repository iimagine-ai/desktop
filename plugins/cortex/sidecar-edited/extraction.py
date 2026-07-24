"""Cortex extraction pipeline — delegates to Graphiti's add_episode().

FIX #1: The nonexistent `custom_extraction_instructions` kwarg is gone.
The typed schema (schema.py) is passed via entity_types / edge_types /
edge_type_map — Graphiti's real customization mechanism.

FIX #2: Salience is read from edge.attributes (populated by Graphiti's
attribute extraction because every edge type declares a `salience` field),
and profile-section routing uses the actual node type labels from the
episode result instead of a hardcoded fallback to "business".
"""

import logging
import os
from datetime import datetime, timezone
from typing import Optional

from graphiti_core.nodes import EpisodeType

from .config import CORTEX_DEBUG
from .graph import get_graphiti, reconfigure_llm
from .schema import EDGE_TYPE_MAP, EDGE_TYPES, ENTITY_TYPES, LABEL_TO_PROFILE_SECTION

logger = logging.getLogger("cortex.extraction")

GROUP_ID = "cortex"  # Single fixed partition for the desktop app's memory


async def run_extraction(
    user_message: str,
    assistant_response: str,
    llm_config,  # models.LLMConfig
    session_id: Optional[str] = None,
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

    graphiti = get_graphiti()
    if not graphiti:
        logger.warning("Graphiti not initialized — skipping extraction")
        return result

    await _ensure_llm_configured(llm_config)

    episode_body = f"User: {user_message}\nAssistant: {assistant_response}"

    try:
        episode_result = await graphiti.add_episode(
            name=f"exchange-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}",
            episode_body=episode_body,
            source_description="Desktop companion business advisory conversation",
            reference_time=datetime.now(timezone.utc),
            source=EpisodeType.message,
            group_id=GROUP_ID,
            # FIX #1: the real schema mechanism.
            entity_types=ENTITY_TYPES,
            edge_types=EDGE_TYPES,
            edge_type_map=EDGE_TYPE_MAP,
        )

        if episode_result:
            nodes = episode_result.nodes or []
            edges = episode_result.edges or []
            result["entities_created"] = len(nodes)
            result["relationships_created"] = len(edges)
            result["facts_stored"] = len(edges)
            result["profile_updates_queued"] = await _route_to_profile(
                nodes, edges, llm_config
            )

        logger.info(
            f"Extraction: {result['entities_created']} entities, "
            f"{result['relationships_created']} edges, "
            f"{result['profile_updates_queued']} profile updates"
        )

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


def _edge_salience(edge) -> float:
    """Read the LLM-assigned salience from the typed edge attributes."""
    attrs = getattr(edge, "attributes", None) or {}
    raw = attrs.get("salience")
    if raw is None:
        return 0.5  # Untyped/fallback edges only
    try:
        return min(1.0, max(0.0, float(raw)))
    except (TypeError, ValueError):
        return 0.5


async def _route_to_profile(nodes, edges, llm_config) -> int:
    """Route extracted facts to profile sections using real node types."""
    queued = 0
    try:
        from .profile import get_profile_manager

        profile_mgr = get_profile_manager()

        # uuid -> type label, from THIS episode's nodes.
        node_types = {n.uuid: _node_type_label(n) for n in nodes}

        for edge in edges:
            fact_text = getattr(edge, "fact", "") or getattr(edge, "name", "")
            if not fact_text or len(fact_text) < 5:
                continue

            salience = _edge_salience(edge)
            if salience < 0.1:
                continue

            # Prefer the TARGET node's type: for Owner->Preference the fact
            # belongs in 'preferences'; for Business->Objective in 'objectives'.
            target_label = node_types.get(getattr(edge, "target_node_uuid", None))
            source_label = node_types.get(getattr(edge, "source_node_uuid", None))
            label = target_label or source_label
            section = LABEL_TO_PROFILE_SECTION.get(label, "business")

            profile_mgr.classify_and_route(
                fact_text=fact_text,
                salience=salience,
                section_name=section,
                source_fact_ids=[getattr(edge, "uuid", "")],
            )
            queued += 1

        # FIX #6 hook: consolidate any sections that have grown noisy.
        await profile_mgr.consolidate_if_needed(llm_config)

    except Exception as e:
        logger.warning(f"Profile routing error: {e}")
        if CORTEX_DEBUG:
            raise

    return queued


# ── LLM Configuration ────────────────────────────────────────────


async def _ensure_llm_configured(llm_config) -> None:
    graphiti = get_graphiti()
    if not graphiti or not llm_config:
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
