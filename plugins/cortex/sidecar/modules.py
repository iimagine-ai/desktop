"""SCOPED module store — goal modules as first-class sidecar objects.

Sibling of profile.py. Modules are SCOPED-structured goal records
(Status, Challenges, Objective, Priority, Enablers, Deadline) persisted to
~/.iimagine/memory/modules.json. Phase 1: created/updated via API endpoints
(and the eval harness). Phase 2 adds extraction-driven proposals through the
existing pending/approval flow.
"""

import json
import logging
import math
from datetime import date, datetime, timezone
from typing import List, Optional
from uuid import uuid4

from pydantic import BaseModel, Field

from .config import DATA_DIR

logger = logging.getLogger("cortex.modules")

MODULES_PATH = DATA_DIR / "modules.json"

MATCH_THRESHOLD = 0.52   # load-bearing: prefer a miss over a false match. Must clearly be about THIS goal.
MATCH_TOP_K = 2

W_EMBED = 0.7
W_ENTITY = 0.3


def _now() -> datetime:
    return datetime.now(timezone.utc)


class ModuleFact(BaseModel):
    """One S/C/E entry, with graph provenance for compile-time refresh."""

    text: str
    fact_uuid: Optional[str] = None   # graph edge uuid; enables invalid_at check
    as_of: Optional[str] = None       # ISO date the fact was last confirmed


class Module(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    title: str
    objective: str                                   # O
    measurable_target: Optional[str] = None
    status: List[ModuleFact] = []                    # S
    challenges: List[ModuleFact] = []                # C
    enablers: List[ModuleFact] = []                  # E
    priority: int = Field(default=5, ge=1, le=10)    # P
    priority_source: str = "declared"                # "declared" | "inferred"
    deadline: Optional[str] = None                   # D — ISO date or null
    state: str = "active"                            # active|achieved|abandoned|expired
    embedding: Optional[List[float]] = None          # title+objective, storage prefix
    linked_entity_uuids: List[str] = []
    created_at: datetime = Field(default_factory=_now)
    last_updated: datetime = Field(default_factory=_now)


class ModuleStore:
    def __init__(self):
        self._modules: List[Module] = []
        self._load()

    # ── CRUD ────────────────────────────────────────────────────

    def list(self, active_only: bool = False) -> List[Module]:
        if active_only:
            return [m for m in self._modules if m.state == "active"]
        return list(self._modules)

    def get(self, module_id: str) -> Optional[Module]:
        return next((m for m in self._modules if m.id == module_id), None)

    async def create(self, data: dict, embedder=None) -> Module:
        module = Module(**data)
        if embedder is not None:
            try:
                # Same model, same storage prefix, same invariants as all
                # other stored embeddings. Computed once per create/update.
                module.embedding = await embedder.create(
                    f"{module.title}. {module.objective}"
                )
            except Exception as e:
                logger.warning(
                    f"Module embedding failed (matcher will use "
                    f"entity overlap only): {e}"
                )
        self._modules.append(module)
        self._save()
        logger.info(
            f"Module created: {module.title} (P{module.priority}, "
            f"deadline {module.deadline})"
        )
        return module

    def update(self, module_id: str, patch: dict) -> Optional[Module]:
        module = self.get(module_id)
        if not module:
            return None
        for k, v in patch.items():
            if hasattr(module, k) and k not in ("id", "created_at", "embedding"):
                setattr(module, k, v)
        module.last_updated = _now()
        self._save()
        return module

    def delete(self, module_id: str) -> bool:
        module = self.get(module_id)
        if not module:
            return False
        self._modules = [m for m in self._modules if m.id != module_id]
        self._save()
        return True

    def reset(self):
        self._modules = []
        self._save()

    # ── Matching (query → relevant modules) ─────────────────────

    def match(
        self,
        query_embedding: Optional[List[float]],
        top_fact_entity_uuids: set,
        k: int = MATCH_TOP_K,
        threshold: float = MATCH_THRESHOLD,
    ) -> List[Module]:
        """Score = 0.7·cosine(query, module) + 0.3·entity_overlap.

        Reuses the query embedding already computed for graph search — no
        extra embed call. Entity overlap uses the top reranked facts'
        source/target uuids, also already in hand.
        """
        scored: List[tuple] = []
        for m in self._modules:
            if m.state not in ("active", "expired"):
                continue

            emb_score = 0.0
            if query_embedding is not None and m.embedding:
                emb_score = _cosine(query_embedding, m.embedding)

            ent_score = 0.0
            if m.linked_entity_uuids and top_fact_entity_uuids:
                linked = set(m.linked_entity_uuids)
                ent_score = len(linked & top_fact_entity_uuids) / max(
                    len(top_fact_entity_uuids), 1
                )

            score = W_EMBED * emb_score + W_ENTITY * ent_score
            if score >= threshold:
                scored.append((score, m))

        scored.sort(key=lambda t: -t[0])
        matched = [m for _, m in scored[:k]]
        if matched:
            logger.info(
                "Module match: "
                + ", ".join(
                    f"{m.title[:40]} ({s:.2f})" for s, m in scored[:k]
                )
            )
        return matched

    # ── Lifecycle housekeeping ──────────────────────────────────

    def flag_expired(self) -> int:
        """Mark active modules whose deadline has passed as 'expired'.

        (Digest surfacing of 'achieved / extended / abandoned?' is Phase 2.)
        """
        today = date.today().isoformat()
        n = 0
        for m in self._modules:
            if m.state == "active" and m.deadline and m.deadline < today:
                m.state = "expired"
                n += 1
        if n:
            self._save()
            logger.info(f"{n} module(s) past deadline flagged expired")
        return n

    # ── Persistence ─────────────────────────────────────────────

    def _load(self):
        if MODULES_PATH.exists():
            try:
                data = json.loads(MODULES_PATH.read_text())
                self._modules = [Module(**m) for m in data.get("modules", [])]
            except Exception as e:
                logger.warning(f"Failed to load modules: {e}")
                self._modules = []
        else:
            self._modules = []

    def _save(self):
        try:
            MODULES_PATH.write_text(
                json.dumps(
                    {"modules": [m.model_dump(mode="json") for m in self._modules]},
                    indent=2,
                    default=str,
                )
            )
        except Exception as e:
            logger.error(f"Failed to save modules: {e}")


def _cosine(a: List[float], b: List[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


_store: Optional[ModuleStore] = None


def get_module_store() -> ModuleStore:
    global _store
    if _store is None:
        _store = ModuleStore()
    return _store
