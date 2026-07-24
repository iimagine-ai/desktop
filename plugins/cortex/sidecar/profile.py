"""Cortex profile manager — auto-maintained business state summary.

FIX #4: Staleness no longer inverts the approval design. On expiry:
  - MEDIUM updates auto-apply (defensible: routine facts, silence = consent)
  - HIGH updates NEVER auto-apply — they stay pending and are flagged
    escalated=True so the UI can re-notify. Financials and strategic pivots
    always require an explicit human decision.

FIX #6: The profile no longer grows append-only:
  - apply_update() dedupes (exact/substring) before appending
  - consolidate_if_needed() runs an LLM rewrite of any section whose
    key_facts exceed a threshold, merging duplicates and dropping facts
    superseded by newer ones ("runway $150k" + "runway $90k" -> latest wins)

Also: datetime.utcnow() (deprecated) replaced with datetime.now(timezone.utc).
"""

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from .config import (
    CONSOLIDATION_THRESHOLD,
    HIGH_SALIENCE_THRESHOLD,
    LOW_SALIENCE_THRESHOLD,
    PENDING_UPDATES_PATH,
    PROFILE_BUDGET_RATIO,
    PROFILE_PATH,
    STALE_UPDATE_DAYS,
)
from .models import (
    PendingProfileUpdate,
    ProfileDocument,
    ProfileSection,
    ProfileUpdateTier,
)

logger = logging.getLogger("cortex.profile")

SECTION_NAMES = [
    "owner", "business", "objectives", "strategies", "resources",
    "team", "skills", "products", "segments", "opportunities",
    "preferences", "constraints",
]

CONSOLIDATION_PROMPT = """You maintain one section of a business profile document.

Section: {section}
Current facts (oldest first):
{facts_json}

Rewrite this section:
1. MERGE near-duplicate facts into one statement
2. When facts conflict (e.g. two different runway figures), KEEP ONLY the most recent (later in the list)
3. DROP trivial or outdated facts
4. Keep each numeric figure (headcount, revenue, runway, pricing, customer count) as its OWN separate fact line — do NOT merge multiple figures into one composite sentence
5. Write a 1-2 sentence summary that MUST include any critical numeric figures from the section verbatim (e.g. "7-person team", "$85k MRR", "14 months runway", "500 customer target"). The summary is rendered even when fact detail is trimmed for space.

Output ONLY valid JSON:
{"summary": "<1-2 sentence summary WITH key figures>", "key_facts": ["<fact>", "..."]}"""


def _now() -> datetime:
    return datetime.now(timezone.utc)


class ProfileManager:
    def __init__(self):
        self._profile: Optional[ProfileDocument] = None
        self._pending: list[PendingProfileUpdate] = []
        self._load()

    # ── Public API ──────────────────────────────────────────────

    def get_profile(self) -> ProfileDocument:
        return self._profile

    def get_profile_context(self, token_budget: int) -> str:
        max_tokens = int(token_budget * PROFILE_BUDGET_RATIO)
        sections = []
        for section_name in SECTION_NAMES:
            section: ProfileSection = getattr(self._profile, section_name)
            if section.summary or section.key_facts:
                label = section_name.replace("_", " ").title()
                parts = []
                if section.summary:
                    parts.append(section.summary)
                for fact in section.key_facts:
                    parts.append(f"  - {fact}")
                sections.append((section_name, f"**{label}:**\n" + "\n".join(parts)))

        if not sections:
            return ""

        full_text = "[Business Profile]\n" + "\n\n".join(s[1] for s in sections) + "\n[End Profile]"
        tokens = len(full_text) // 4

        # Degradation strategy (two phases):
        # Phase 1: Drop key_facts from lowest-priority sections, keeping summaries.
        #   This converts the profile into a dense executive brief at scale.
        # Phase 2: Only drop entire sections (summary included) as last resort.
        # The contract: every section's summary is ALWAYS rendered if it exists.

        DROP_ORDER = [
            "segments", "products", "skills", "opportunities",
            "resources", "strategies", "team", "business",
            "owner", "objectives", "preferences", "constraints",
        ]

        # Phase 1: strip key_facts detail, keep summaries
        if tokens > max_tokens:
            for drop_name in DROP_ORDER:
                if tokens <= max_tokens:
                    break
                for i, (name, _) in enumerate(sections):
                    if name == drop_name:
                        section_obj: ProfileSection = getattr(self._profile, name)
                        label = name.replace("_", " ").title()
                        # Keep only summary (no key_facts bullet points)
                        if section_obj.summary:
                            sections[i] = (name, f"**{label}:**\n{section_obj.summary}")
                        else:
                            # No summary — drop entirely
                            sections.pop(i)
                        full_text = "[Business Profile]\n" + "\n\n".join(s[1] for s in sections) + "\n[End Profile]"
                        tokens = len(full_text) // 4
                        break

        # Phase 2: if still over budget, drop entire sections (last resort)
        while tokens > max_tokens and sections:
            dropped = False
            for drop_name in DROP_ORDER:
                for i, (name, _) in enumerate(sections):
                    if name == drop_name:
                        sections.pop(i)
                        dropped = True
                        break
                if dropped:
                    break
            if not dropped:
                sections.pop()
            full_text = "[Business Profile]\n" + "\n\n".join(s[1] for s in sections) + "\n[End Profile]"
            tokens = len(full_text) // 4
        return full_text

    def apply_update(self, section_name: str, fact: str, source_fact_ids: list[str] = None):
        section: ProfileSection = getattr(self._profile, section_name, None)
        if not section:
            logger.warning(f"Invalid profile section: {section_name}")
            return

        # FIX #6a: cheap dedup before append.
        normalized = fact.strip().lower()
        for existing in section.key_facts:
            e = existing.strip().lower()
            if normalized == e or normalized in e or e in normalized:
                logger.debug(f"Skipped duplicate profile fact: {fact[:50]}...")
                return

        section.key_facts.append(fact)
        section.last_updated = _now()
        self._profile.version += 1
        self._profile.last_updated = _now()
        self._save()
        logger.debug(f"Applied to profile/{section_name}: {fact[:50]}...")

    def queue_update(
        self,
        section_name: str,
        proposed_change: str,
        tier: ProfileUpdateTier,
        source_fact_ids: list[str] = None,
    ) -> str:
        # Dedup: don't queue if an identical or near-identical pending update exists
        normalized = proposed_change.strip().lower()
        for existing in self._pending:
            if existing.status != "pending":
                continue
            e = existing.proposed_change.strip().lower()
            if normalized == e or normalized in e or e in normalized:
                logger.debug(f"Skipped duplicate queue entry: {proposed_change[:50]}...")
                return existing.id

        update = PendingProfileUpdate(
            section=section_name,
            proposed_change=proposed_change,
            tier=tier,
            source_fact_ids=source_fact_ids or [],
            expires_at=_now() + timedelta(days=STALE_UPDATE_DAYS),
        )
        self._pending.append(update)
        self._save_pending()
        logger.info(f"Queued {tier.value} update for {section_name}: {proposed_change[:50]}...")
        return update.id

    def get_pending_updates(self) -> list[dict]:
        self._handle_stale_updates()
        return [
            {
                "id": u.id,
                "section": u.section,
                "proposed_change": u.proposed_change,
                "tier": u.tier.value,
                "created_at": u.created_at.isoformat(),
                "status": u.status,
                "escalated": getattr(u, "escalated", False),
            }
            for u in self._pending
            if u.status == "pending"
        ]

    def approve_update(self, update_id: str) -> bool:
        for update in self._pending:
            if update.id == update_id and update.status == "pending":
                update.status = "approved"
                self.apply_update(update.section, update.proposed_change, update.source_fact_ids)
                self._save_pending()
                return True
        return False

    def reject_update(self, update_id: str) -> bool:
        for update in self._pending:
            if update.id == update_id and update.status == "pending":
                update.status = "rejected"
                self._save_pending()
                return True
        return False

    def reset(self):
        self._profile = ProfileDocument()
        self._pending = []
        self._save()
        self._save_pending()
        logger.info("Profile reset to empty")

    # ── Classification ──────────────────────────────────────────

    def classify_and_route(
        self,
        fact_text: str,
        salience: float,
        section_name: str,
        source_fact_ids: list[str] = None,
    ):
        """Route by salience tier. Section is now resolved upstream from real
        node type labels (extraction.py), so no entity_type mapping here.
        
        SESSION-3 FIX: Added a "graph-only" zone (0.3-0.5 salience) where facts
        stay retrievable in the graph but don't queue for profile. The profile
        is the durable strategic picture — not everything true. A weekly digest
        holds ~10-15 items; at production rates that means only HIGH + upper-MEDIUM
        should queue. Target: <0.3 pending/episode."""
        if section_name not in SECTION_NAMES:
            section_name = "business"

        if salience < LOW_SALIENCE_THRESHOLD:
            # Very low salience: auto-apply (trivial context, silence = consent)
            self.apply_update(section_name, fact_text, source_fact_ids)
        elif salience < 0.5:
            # Graph-only zone: fact lives in the graph, retrievable via search,
            # but not important enough for the profile digest. No queue entry.
            logger.debug(f"Graph-only (salience {salience:.2f}): {fact_text[:50]}...")
            pass
        elif salience < HIGH_SALIENCE_THRESHOLD:
            # Upper-MEDIUM: queue for review
            self.queue_update(section_name, fact_text, ProfileUpdateTier.MEDIUM, source_fact_ids)
        else:
            # HIGH: queue (never auto-applies)
            self.queue_update(section_name, fact_text, ProfileUpdateTier.HIGH, source_fact_ids)

    # ── Consolidation (FIX #6b) ─────────────────────────────────

    async def consolidate_if_needed(self, llm_config) -> int:
        """LLM-rewrite any section whose key_facts exceed the threshold.

        Merges duplicates, keeps the most recent of conflicting facts, and
        refreshes the section summary. Called after extraction routing."""
        from .llm_adapter import call_llm

        consolidated = 0
        for section_name in SECTION_NAMES:
            section: ProfileSection = getattr(self._profile, section_name)
            if len(section.key_facts) <= CONSOLIDATION_THRESHOLD:
                continue

            prompt = CONSOLIDATION_PROMPT.replace("{section}", section_name).replace(
                "{facts_json}", json.dumps(section.key_facts, indent=2)
            )
            raw = await call_llm(prompt, llm_config, max_tokens=1000)
            if not raw:
                continue  # LLM unavailable; try again next time

            parsed = self._parse_json_block(raw)
            if not parsed or not isinstance(parsed.get("key_facts"), list):
                continue

            new_facts = [f for f in parsed["key_facts"] if isinstance(f, str) and f.strip()]
            if not new_facts:
                continue  # Never let a bad LLM response wipe a section

            section.key_facts = new_facts
            section.summary = str(parsed.get("summary", section.summary or ""))
            section.last_updated = _now()
            self._profile.version += 1
            consolidated += 1
            logger.info(
                f"Consolidated profile/{section_name}: -> {len(new_facts)} facts"
            )

        if consolidated:
            self._profile.last_updated = _now()
            self._save()
        return consolidated

    @staticmethod
    def _parse_json_block(raw: str) -> Optional[dict]:
        text = raw.strip()
        first, last = text.find("{"), text.rfind("}")
        if first == -1 or last == -1:
            return None
        try:
            data = json.loads(text[first : last + 1])
            return data if isinstance(data, dict) else None
        except json.JSONDecodeError:
            return None

    # ── Staleness (FIX #4) ──────────────────────────────────────

    def _handle_stale_updates(self):
        """MEDIUM: auto-apply on expiry. HIGH: never auto-apply — escalate."""
        now = _now()
        changed = 0

        for update in self._pending:
            if update.status != "pending" or not update.expires_at:
                continue
            expires = update.expires_at
            if expires.tzinfo is None:  # Tolerate old naive timestamps on disk
                expires = expires.replace(tzinfo=timezone.utc)
            if now <= expires:
                continue

            if update.tier == ProfileUpdateTier.MEDIUM:
                update.status = "stale-applied"
                self.apply_update(update.section, update.proposed_change, update.source_fact_ids)
                changed += 1
            elif update.tier == ProfileUpdateTier.HIGH:
                if not getattr(update, "escalated", False):
                    update.escalated = True  # Stays pending; UI re-notifies
                    changed += 1

        if changed:
            self._save_pending()
            logger.info(f"Stale handling: {changed} updates processed (HIGH never auto-applies)")

    # ── Persistence ─────────────────────────────────────────────

    def _load(self):
        if PROFILE_PATH.exists():
            try:
                self._profile = ProfileDocument(**json.loads(PROFILE_PATH.read_text()))
            except Exception as e:
                logger.warning(f"Failed to load profile: {e}")
                self._profile = ProfileDocument()
        else:
            self._profile = ProfileDocument()

        if PENDING_UPDATES_PATH.exists():
            try:
                data = json.loads(PENDING_UPDATES_PATH.read_text())
                self._pending = [PendingProfileUpdate(**u) for u in data]
            except Exception as e:
                logger.warning(f"Failed to load pending updates: {e}")
                self._pending = []
        else:
            self._pending = []

    def _save(self):
        try:
            PROFILE_PATH.write_text(self._profile.model_dump_json(indent=2))
        except Exception as e:
            logger.error(f"Failed to save profile: {e}")

    def _save_pending(self):
        try:
            data = [u.model_dump() for u in self._pending]
            PENDING_UPDATES_PATH.write_text(json.dumps(data, indent=2, default=str))
        except Exception as e:
            logger.error(f"Failed to save pending updates: {e}")


_manager: Optional[ProfileManager] = None


def get_profile_manager() -> ProfileManager:
    global _manager
    if _manager is None:
        _manager = ProfileManager()
    return _manager
