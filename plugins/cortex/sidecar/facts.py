"""Facts store — user-declared ground truth, immune to AI modification.

Two tiers:
- always_on: injected verbatim every time (identity-level context)
- pinned: embedded on save, semantically matched at retrieval time

Facts are NOT in the graph. NOT subject to extraction, consolidation,
invalidation, or reflection. Only the user edits them.

Contradiction detection: after extraction, cosine new facts against this
index. High similarity → LLM confirm → digest item. Sub-millisecond local
math for the common case (no contradiction).
"""

import json
import logging
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional
from uuid import uuid4

from .config import DATA_DIR

logger = logging.getLogger("cortex.facts")

FACTS_PATH = DATA_DIR / "facts.json"

# Budget: always-on tier should not exceed this fraction of total token budget
ALWAYS_ON_BUDGET_RATIO = 0.15

# Contradiction detection thresholds
CONTRADICTION_COSINE_THRESHOLD = 0.80
PINNED_MATCH_THRESHOLD = 0.55
PINNED_MATCH_TOP_K = 8

# Staleness: facts untouched for this many days get a "still true?" prompt
STALENESS_DAYS = 180  # 6 months
# Only flag facts that contain numbers or date-like patterns
STALENESS_NUMERIC_ONLY = True

# Active contradictions: {fact_id: {new_fact, detected_at, acknowledged}}
# Persisted alongside facts. One flag per contradiction; acknowledged = silent.
CONTRADICTIONS_PATH = DATA_DIR / "fact_contradictions.json"
STALENESS_PATH = DATA_DIR / "fact_staleness.json"


# ── Data Model ───────────────────────────────────────────────────


class Fact:
    def __init__(self, id: str = None, key: str = "", value: str = "",
                 embedding: Optional[List[float]] = None,
                 created_at: str = None, last_confirmed_at: str = None):
        self.id = id or str(uuid4())
        self.key = key
        self.value = value
        self.embedding = embedding
        self.created_at = created_at or datetime.now(timezone.utc).isoformat()
        self.last_confirmed_at = last_confirmed_at or self.created_at

    def to_dict(self) -> dict:
        d = {
            "id": self.id,
            "key": self.key,
            "value": self.value,
            "created_at": self.created_at,
            "last_confirmed_at": self.last_confirmed_at,
        }
        if self.embedding:
            d["embedding"] = self.embedding
        return d

    @classmethod
    def from_dict(cls, data: dict) -> "Fact":
        return cls(
            id=data.get("id"),
            key=data.get("key", ""),
            value=data.get("value", ""),
            embedding=data.get("embedding"),
            created_at=data.get("created_at"),
            last_confirmed_at=data.get("last_confirmed_at"),
        )

    def display_text(self) -> str:
        """Render for context injection."""
        if self.key:
            return f"{self.key}: {self.value}"
        return self.value


# ── Store ────────────────────────────────────────────────────────


class FactsStore:
    def __init__(self):
        self._always_on: List[Fact] = []
        self._pinned: List[Fact] = []
        self._load()

    # ── CRUD ─────────────────────────────────────────────────────

    def get_always_on(self) -> List[Fact]:
        return list(self._always_on)

    def get_pinned(self) -> List[Fact]:
        return list(self._pinned)

    def get_all(self) -> dict:
        return {
            "always_on": [f.to_dict() for f in self._always_on],
            "pinned": [f.to_dict() for f in self._pinned],
        }

    def add(self, tier: str, key: str, value: str,
            embedding: Optional[List[float]] = None) -> Fact:
        """Add a new fact. Embedding required for pinned tier."""
        fact = Fact(key=key, value=value, embedding=embedding)
        if tier == "always_on":
            self._always_on.append(fact)
        else:
            self._pinned.append(fact)
        self._save()
        logger.info(f"Fact added [{tier}]: {fact.display_text()[:60]}")
        return fact

    def update(self, fact_id: str, key: str = None, value: str = None,
               embedding: Optional[List[float]] = None) -> Optional[Fact]:
        """Update an existing fact. Re-embed if value changes (for pinned)."""
        fact = self._find(fact_id)
        if not fact:
            return None
        if key is not None:
            fact.key = key
        if value is not None:
            fact.value = value
        if embedding is not None:
            fact.embedding = embedding
        fact.last_confirmed_at = datetime.now(timezone.utc).isoformat()
        self._save()
        # Resolve any active contradiction and staleness (user has updated the fact)
        self.resolve_contradiction(fact_id)
        self.resolve_staleness(fact_id)
        return fact

    def delete(self, fact_id: str) -> bool:
        before = len(self._always_on) + len(self._pinned)
        self._always_on = [f for f in self._always_on if f.id != fact_id]
        self._pinned = [f for f in self._pinned if f.id != fact_id]
        after = len(self._always_on) + len(self._pinned)
        if after < before:
            self._save()
            # Resolve any active contradiction for this fact
            self.resolve_contradiction(fact_id)
            return True
        return False

    def confirm(self, fact_id: str) -> bool:
        """Mark a fact as 'still true' — refreshes last_confirmed_at,
        suppresses re-flagging of the same contradiction."""
        fact = self._find(fact_id)
        if not fact:
            return False
        fact.last_confirmed_at = datetime.now(timezone.utc).isoformat()
        self._save()
        # Resolve any active contradiction and staleness for this fact
        self.resolve_contradiction(fact_id)
        self.resolve_staleness(fact_id)
        return True

    def reset(self):
        """Clear all facts (called by /clear)."""
        self._always_on = []
        self._pinned = []
        self._save()

    # ── Context Assembly ─────────────────────────────────────────

    def get_always_on_context(self, token_budget: int) -> str:
        """Render always-on facts as context string, respecting budget cap."""
        if not self._always_on:
            return ""
        cap = int(token_budget * ALWAYS_ON_BUDGET_RATIO)
        lines = []
        token_count = 0
        for fact in self._always_on:
            text = fact.display_text()
            tokens = len(text) // 4
            if token_count + tokens > cap:
                break
            lines.append(f"• {text}")
            token_count += tokens
        if not lines:
            return ""
        return "[User Facts — always true]\n" + "\n".join(lines) + "\n[End User Facts]"

    def get_always_on_budget_usage(self, token_budget: int) -> dict:
        """Return budget usage info for the UI."""
        cap = int(token_budget * ALWAYS_ON_BUDGET_RATIO)
        total_tokens = sum(len(f.display_text()) // 4 for f in self._always_on)
        return {
            "tokens_used": total_tokens,
            "tokens_cap": cap,
            "percent": round((total_tokens / cap) * 100, 1) if cap > 0 else 0,
            "over_budget": total_tokens > cap,
        }

    def match_pinned(self, query_embedding: List[float],
                     top_k: int = PINNED_MATCH_TOP_K,
                     threshold: float = PINNED_MATCH_THRESHOLD) -> List[Fact]:
        """Return pinned facts whose embeddings are closest to the query."""
        if not query_embedding or not self._pinned:
            return []
        scored = []
        for fact in self._pinned:
            if not fact.embedding:
                continue
            sim = _cosine(query_embedding, fact.embedding)
            if sim >= threshold:
                scored.append((sim, fact))
        scored.sort(key=lambda t: -t[0])
        return [f for _, f in scored[:top_k]]

    # ── Contradiction Detection ──────────────────────────────────

    def find_contradictions(self, new_fact_embeddings: List[tuple]) -> List[dict]:
        """Check new extracted facts against the Facts store.

        Args:
            new_fact_embeddings: [(fact_text, embedding), ...]

        Returns list of potential contradictions:
            [{ "new_fact": str, "stored_fact": Fact, "similarity": float, "match_type": "key"|"cosine" }]
        """
        candidates = []
        all_facts = self._always_on + self._pinned

        for new_text, new_emb in new_fact_embeddings:
            if not new_text:
                continue

            # Fast path: key match (exact substring on key field)
            new_lower = new_text.lower()
            for fact in all_facts:
                if fact.key:
                    key_lower = fact.key.lower()
                    if key_lower in new_lower or new_lower.startswith(key_lower):
                        candidates.append({
                            "new_fact": new_text,
                            "stored_fact_id": fact.id,
                            "stored_fact_text": fact.display_text(),
                            "similarity": 1.0,
                            "match_type": "key",
                        })
                        break

            # Cosine path: embedding similarity
            if new_emb:
                for fact in all_facts:
                    emb = fact.embedding
                    if not emb:
                        # Always-on facts without embeddings: skip cosine
                        continue
                    sim = _cosine(new_emb, emb)
                    if sim >= CONTRADICTION_COSINE_THRESHOLD:
                        # Don't duplicate key-match candidates
                        already = any(
                            c["stored_fact_id"] == fact.id and c["new_fact"] == new_text
                            for c in candidates
                        )
                        if not already:
                            candidates.append({
                                "new_fact": new_text,
                                "stored_fact_id": fact.id,
                                "stored_fact_text": fact.display_text(),
                                "similarity": sim,
                                "match_type": "cosine",
                            })

        return candidates

    # ── Contradiction State ─────────────────────────────────────────

    def get_active_contradictions(self) -> List[dict]:
        """Return unacknowledged contradictions for inline flagging."""
        contras = self._load_contradictions()
        return [c for c in contras.values() if not c.get("acknowledged")]

    def flag_contradiction(self, fact_id: str, new_fact_text: str) -> bool:
        """Record a detected contradiction. Returns False if already flagged."""
        contras = self._load_contradictions()
        if fact_id in contras and not contras[fact_id].get("resolved"):
            return False  # Already flagged, don't repeat
        contras[fact_id] = {
            "fact_id": fact_id,
            "new_fact": new_fact_text,
            "detected_at": datetime.now(timezone.utc).isoformat(),
            "acknowledged": False,
            "resolved": False,
        }
        self._save_contradictions(contras)
        return True

    def acknowledge_contradiction(self, fact_id: str) -> bool:
        """Mark contradiction as seen (stops inline re-flagging)."""
        contras = self._load_contradictions()
        if fact_id in contras:
            contras[fact_id]["acknowledged"] = True
            self._save_contradictions(contras)
            return True
        return False

    def resolve_contradiction(self, fact_id: str) -> bool:
        """Mark as resolved (user updated, confirmed, or removed the fact)."""
        contras = self._load_contradictions()
        if fact_id in contras:
            contras[fact_id]["resolved"] = True
            contras[fact_id]["acknowledged"] = True
            self._save_contradictions(contras)
            return True
        return False

    def get_inline_flag(self) -> Optional[dict]:
        """Return ONE unacknowledged contradiction for inline chat flagging.
        Returns None if nothing to flag. Only surfaces one at a time."""
        contras = self._load_contradictions()
        for fact_id, c in contras.items():
            if not c.get("acknowledged") and not c.get("resolved"):
                # Include the stored fact text for the message
                fact = self._find(fact_id)
                if fact:
                    return {
                        "fact_id": fact_id,
                        "stored_fact": fact.display_text(),
                        "new_fact": c["new_fact"],
                    }
        return None

    def _load_contradictions(self) -> dict:
        try:
            if CONTRADICTIONS_PATH.exists():
                return json.loads(CONTRADICTIONS_PATH.read_text())
        except Exception:
            pass
        return {}

    def _save_contradictions(self, data: dict):
        try:
            CONTRADICTIONS_PATH.write_text(json.dumps(data, indent=2))
        except Exception as e:
            logger.warning(f"Failed to save contradictions: {e}")

    # ── Staleness Sweep ──────────────────────────────────────────

    def check_staleness(self) -> List[dict]:
        """Find facts that haven't been confirmed in STALENESS_DAYS and contain
        numbers or dates. Returns list of stale fact summaries for the digest.

        Only surfaces facts not already flagged as stale (one prompt per cycle).
        """
        import re
        now = datetime.now(timezone.utc)
        threshold = STALENESS_DAYS * 86400  # seconds

        # Patterns that suggest a fact may become outdated
        _DATE_PATTERN = re.compile(
            r'\b\d{4}[-/]\d{2}[-/]\d{2}\b|'  # ISO dates
            r'\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{4}\b|'  # Month Year
            r'\bq[1-4]\s*\d{4}\b|'  # Q1 2026
            r'\b\d{1,3}(?:,\d{3})+\b|'  # Large numbers (1,000+)
            r'\b\d+\s*(k|m|years?|months?|weeks?|people|employees|customers?)\b',  # Quantities
            re.IGNORECASE
        )

        staleness_state = self._load_staleness()
        stale_facts = []

        for fact in self._always_on + self._pinned:
            # Skip if already flagged and not yet resolved
            if fact.id in staleness_state:
                entry = staleness_state[fact.id]
                if not entry.get("resolved"):
                    continue

            # Check age
            confirmed = fact.last_confirmed_at or fact.created_at
            try:
                confirmed_dt = datetime.fromisoformat(confirmed.replace("Z", "+00:00"))
            except (ValueError, TypeError):
                continue

            age_seconds = (now - confirmed_dt).total_seconds()
            if age_seconds < threshold:
                continue

            # Check if contains numbers/dates (skip purely qualitative facts)
            text = fact.display_text()
            if STALENESS_NUMERIC_ONLY and not _DATE_PATTERN.search(text):
                continue

            # Flag as stale
            staleness_state[fact.id] = {
                "fact_id": fact.id,
                "fact_text": text,
                "last_confirmed": confirmed,
                "flagged_at": now.isoformat(),
                "resolved": False,
            }
            stale_facts.append({
                "fact_id": fact.id,
                "fact_text": text,
                "last_confirmed": confirmed,
                "age_days": int(age_seconds / 86400),
            })

        if stale_facts:
            self._save_staleness(staleness_state)
            logger.info(f"Staleness sweep: {len(stale_facts)} fact(s) flagged for review")

        return stale_facts

    def resolve_staleness(self, fact_id: str):
        """Mark a stale fact as resolved (user confirmed or updated it)."""
        state = self._load_staleness()
        if fact_id in state:
            state[fact_id]["resolved"] = True
            self._save_staleness(state)

    def get_stale_facts(self) -> List[dict]:
        """Return currently stale (unresolved) facts for the digest."""
        state = self._load_staleness()
        return [v for v in state.values() if not v.get("resolved")]

    def _load_staleness(self) -> dict:
        try:
            if STALENESS_PATH.exists():
                return json.loads(STALENESS_PATH.read_text())
        except Exception:
            pass
        return {}

    def _save_staleness(self, data: dict):
        try:
            STALENESS_PATH.write_text(json.dumps(data, indent=2))
        except Exception as e:
            logger.warning(f"Failed to save staleness state: {e}")

    # ── Deduplication Helper ─────────────────────────────────────

    def is_duplicate_of_fact(self, text: str, threshold: float = 0.85) -> bool:
        """Check if a profile/memory line duplicates an injected Fact.
        Used by context assembly to skip redundant lines."""
        text_lower = text.lower().strip()
        for fact in self._always_on:
            if fact.display_text().lower().strip() in text_lower:
                return True
            if text_lower in fact.display_text().lower().strip():
                return True
        # For pinned facts that were matched and injected, check exact overlap
        # (caller handles this by passing the matched set)
        return False

    # ── Persistence ──────────────────────────────────────────────

    def _load(self):
        if FACTS_PATH.exists():
            try:
                data = json.loads(FACTS_PATH.read_text())
                self._always_on = [Fact.from_dict(f) for f in data.get("always_on", [])]
                self._pinned = [Fact.from_dict(f) for f in data.get("pinned", [])]
            except Exception as e:
                logger.warning(f"Failed to load facts: {e}")
                self._always_on = []
                self._pinned = []
        else:
            self._always_on = []
            self._pinned = []

    def _save(self):
        try:
            FACTS_PATH.write_text(json.dumps(self.get_all(), indent=2))
        except Exception as e:
            logger.error(f"Failed to save facts: {e}")

    # ── Internal ─────────────────────────────────────────────────

    def _find(self, fact_id: str) -> Optional[Fact]:
        for fact in self._always_on + self._pinned:
            if fact.id == fact_id:
                return fact
        return None


# ── Utilities ────────────────────────────────────────────────────


def _cosine(a: List[float], b: List[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


# ── Singleton ────────────────────────────────────────────────────


_store: Optional[FactsStore] = None


def get_facts_store() -> FactsStore:
    global _store
    if _store is None:
        _store = FactsStore()
    return _store
