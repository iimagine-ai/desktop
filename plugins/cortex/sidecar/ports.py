"""Cortex Graph Port — the interface YOUR code depends on.

This protocol defines what the sidecar needs from a graph engine. The ONLY
file that imports graphiti_core (or any future engine) is the adapter that
implements this protocol.

Design principles (per architecture review 2026-07-15):
- No raw Cypher on the protocol. Every real need is a typed method.
- Schema/ontology/prompts are adapter construction config, not port args.
- Episode replay is the portability story: graph = cache, episodes = truth.
- The eval suite gates upgrades: bump on a branch, run the suite, merge on green.

Swapping adapters preserves your code. Extraction quality is
adapter+prompt-specific and would need re-tuning (which the suite measures).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Optional, Protocol, runtime_checkable

logger = logging.getLogger("cortex.ports")


# ── Data Types (YOUR types, not Graphiti's) ──────────────────────


@dataclass
class ExtractedNode:
    """A node returned from extraction. Adapter maps engine-specific types here."""
    uuid: str
    name: str
    labels: List[str] = field(default_factory=list)


@dataclass
class ExtractedEdge:
    """An edge/fact returned from extraction or search."""
    uuid: str
    source_node_uuid: str
    target_node_uuid: str
    name: str  # edge type name (e.g. "Prefers", "HasObjective")
    fact: str
    group_id: str = ""
    created_at: Optional[datetime] = None
    valid_at: Optional[datetime] = None
    invalid_at: Optional[datetime] = None
    fact_embedding: Optional[List[float]] = None


@dataclass
class ExtractionResult:
    """Result from ingesting one episode."""
    nodes: List[ExtractedNode] = field(default_factory=list)
    edges: List[ExtractedEdge] = field(default_factory=list)


@dataclass
class EpisodeRecord:
    """A raw episode for export/replay."""
    name: str
    body: str
    source_description: str
    reference_time: datetime
    group_id: str


# ── The Port (Protocol) ──────────────────────────────────────────


@runtime_checkable
class GraphPort(Protocol):
    """Interface the sidecar code programs against.

    One adapter implements this. All Cypher, all engine imports, all
    schema config live inside that adapter — nowhere else.
    """

    # ── Lifecycle ────────────────────────────────────────────────

    async def initialize(self) -> None:
        """Start the graph engine. Raises on failure."""
        ...

    async def close(self) -> None:
        """Gracefully shut down."""
        ...

    def is_ready(self) -> bool:
        """True if initialized and usable."""
        ...

    def get_init_error(self) -> Optional[str]:
        """Non-None means degraded mode."""
        ...

    # ── Extraction ───────────────────────────────────────────────

    async def add_episode(
        self,
        body: str,
        group_id: str,
        reference_time: datetime,
        name: str = "",
        source_description: str = "",
    ) -> ExtractionResult:
        """Ingest one episode. Schema/ontology/prompts are adapter config."""
        ...

    # ── Search & Retrieval ───────────────────────────────────────

    async def search(
        self,
        query: str,
        group_ids: List[str],
        num_results: int = 30,
    ) -> List[ExtractedEdge]:
        """Hybrid search (semantic + keyword + graph). Returns ranked edges."""
        ...

    # ── Typed Queries (replaces raw Cypher) ──────────────────────

    async def get_recent_facts(
        self,
        group_id: str,
        limit: int = 50,
    ) -> List[dict]:
        """Most recent valid facts by created_at.
        Returns [{uuid, fact, created_at}]."""
        ...

    async def get_facts_by_ids(
        self,
        fact_ids: List[str],
    ) -> List[dict]:
        """Fetch specific facts by UUID.
        Returns [{uuid, fact, created_at}]."""
        ...

    async def get_superseded_facts(
        self,
        group_ids: List[str],
        limit: int = 15,
    ) -> List[ExtractedEdge]:
        """Fetch recently invalidated edges for history-mode retrieval."""
        ...

    async def check_invalidated(
        self,
        uuids: List[str],
    ) -> set[str]:
        """Given a list of edge UUIDs, return the subset that have invalid_at set."""
        ...

    async def find_dedup_candidates(
        self,
        group_id: str,
        limit: int = 20,
    ) -> List[dict]:
        """Find entity pairs that share partial names (dedup candidates).
        Returns [{name_a, uuid_a, name_b, uuid_b}]."""
        ...

    async def merge_entities(
        self,
        keep_uuid: str,
        merge_uuid: str,
    ) -> bool:
        """Merge one entity into another (move edges, delete source)."""
        ...

    async def get_unscored_edges(
        self,
        group_id: str,
        limit: int = 25,
    ) -> List[dict]:
        """Recent edges for salience reconciliation.
        Returns [{uuid, fact}]."""
        ...

    async def get_stats(self) -> dict:
        """Returns {entities, edges, facts, episodes}."""
        ...

    async def clear_all(self) -> None:
        """Delete all graph data."""
        ...

    # ── Episode Export (the real portability layer) ───────────────

    async def export_episodes(
        self,
        group_id: str,
    ) -> List[EpisodeRecord]:
        """Export all raw episodes. Graph = cache, episodes = truth."""
        ...

    # ── Embedding (delegated to adapter's configured embedder) ───

    async def embed_query(self, text: str) -> Optional[List[float]]:
        """Embed text in query mode. Returns None if embedder unavailable."""
        ...

    async def embed_storage(self, text: str) -> Optional[List[float]]:
        """Embed text in storage mode. Returns None if embedder unavailable."""
        ...

    # ── LLM Reconfiguration ─────────────────────────────────────

    async def reconfigure_llm(
        self,
        api_key: str,
        model: str,
        base_url: Optional[str] = None,
        provider: str = "openai",
    ) -> None:
        """Hot-swap the LLM client without reinitializing the graph."""
        ...

    # ── Debug (escape hatch — on the adapter, NOT on the protocol,
    #    but we expose it here for the eval harness /debug/cypher) ──

    async def execute_raw_query(self, query: str, **params) -> List[dict]:
        """Escape hatch for eval harness. NOT for production code paths."""
        ...
