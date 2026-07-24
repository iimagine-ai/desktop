"""Phase 2: Extraction-driven module update proposals.

After extraction routes facts to the profile, this module matches new edges
against existing SCOPED modules and queues field-level update proposals through
the pending-updates flow.

Routing rules:
- Numeric status facts (customer counts, MRR, etc.) → Status (S) — LOW tier, auto-applies
- Constraint/obstacle mentions → Challenges (C) — MEDIUM tier
- Resource/skill/enabler mentions → Enablers (E) — MEDIUM tier
- Deadline mentions → Deadline (D) — HIGH tier, always needs approval
- Priority changes → Priority (P) — HIGH tier, always needs approval
- Objective entity with measurable target + no matching module → propose new module (HIGH)

Matching: embedding similarity between the fact text and each module's
title+objective embedding, plus entity-overlap with linked_entity_uuids.
"""

import logging
import re
from datetime import date, datetime, timezone
from typing import List, Optional, Tuple

from .modules import Module, ModuleFact, ModuleStore, get_module_store

logger = logging.getLogger("cortex.module_updater")

# Thresholds
FACT_MODULE_THRESHOLD = 0.60  # High bar: must be clearly about THIS specific goal
DATE_PATTERN = re.compile(
    r'\b(\d{4}-\d{2}-\d{2})\b|'
    r'\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|'
    r'jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
    r'\s+\d{1,2}(?:,?\s*\d{4})?\b|'
    r'\bq[1-4]\s*\d{4}\b',
    re.IGNORECASE
)
PRIORITY_PATTERN = re.compile(
    r'\b(?:priority|importance)\s*(?:is\s*)?(?:now\s*)?(\d{1,2})(?:\s*/\s*10)?\b|'
    r'\b(?:number\s*)?#?(\d)\s*priority\b',
    re.IGNORECASE
)
NUMERIC_PATTERN = re.compile(
    r'\$?\d{1,3}(?:,\d{3})+|\$?\d+(?:\.\d+)?(?:\s*[kKmM])?\b'
)

# Keywords that signal a fact is about status/progress
STATUS_KEYWORDS = re.compile(
    r'\b(now|currently|reached|crossed|hit|at|updated?|grew to|dropped to|'
    r'increased to|decreased to|moved to|up to|down to)\b',
    re.IGNORECASE
)
CHALLENGE_KEYWORDS = re.compile(
    r'\b(challenge|obstacle|blocker|constraint|limitation|problem|issue|'
    r'bottleneck|risk|struggle|difficulty|can\'t|cannot|no\s+\w+\s+capacity|'
    r'at\s+capacity|fully\s+allocated|lacking|missing)\b',
    re.IGNORECASE
)
ENABLER_KEYWORDS = re.compile(
    r'\b(resource|asset|strength|advantage|opportunity|hired|onboarded|'
    r'partnership|new\s+tool|launched|acquired|built|developed|access\s+to)\b',
    re.IGNORECASE
)
DEADLINE_KEYWORDS = re.compile(
    r'\b(deadline|due\s+date|target\s+date|by\s+\w+\s+\d|push(?:ed)?\s+(?:to|back)|'
    r'extend(?:ed)?|moved\s+(?:to|the\s+deadline)|postpone[d]?|'
    r'new\s+deadline|revised\s+(?:deadline|date|timeline))\b',
    re.IGNORECASE
)


class ModuleUpdateProposal:
    """A proposed change to a module field."""

    def __init__(self, module_id: str, module_title: str, field: str,
                 action: str, value, tier: str, fact_text: str):
        self.module_id = module_id
        self.module_title = module_title
        self.field = field        # "status" | "challenges" | "enablers" | "deadline" | "priority"
        self.action = action      # "replace" | "append" | "set"
        self.value = value        # The new value
        self.tier = tier          # "low" | "medium" | "high"
        self.fact_text = fact_text


async def match_fact_to_modules(
    fact_text: str,
    edge_uuid: str,
    embedder,
    store: Optional[ModuleStore] = None,
) -> Optional[Module]:
    """Match a single extracted fact to the most relevant module.

    Returns the matched module or None if below threshold.
    Uses embedding similarity + keyword overlap validation to prevent
    cross-matching between different goals that share structural similarity.
    """
    if store is None:
        store = get_module_store()

    modules = store.list(active_only=True)
    if not modules:
        return None

    # Embed the fact
    try:
        fact_emb = await embedder.create(fact_text)
    except Exception as e:
        logger.debug(f"Fact embedding failed: {e}")
        return None

    if not fact_emb:
        return None

    from .modules import _cosine

    best_score = 0.0
    best_module = None
    for m in modules:
        if not m.embedding:
            continue
        score = _cosine(fact_emb, m.embedding)
        if score > best_score:
            best_score = score
            best_module = m

    if best_score < FACT_MODULE_THRESHOLD or not best_module:
        return None

    # Second gate: keyword overlap validation.
    # Embedding similarity alone can't distinguish "grow YouTube subs" from
    # "grow paying customers" — both are numeric growth targets. Require at
    # least one meaningful keyword from the module's title/objective to appear
    # in the fact text (or vice versa).
    module_words = set(
        w.lower() for w in re.split(r'\W+', f"{best_module.title} {best_module.objective}")
        if len(w) > 3 and w.lower() not in _STOP_WORDS
    )
    fact_words = set(
        w.lower() for w in re.split(r'\W+', fact_text)
        if len(w) > 3 and w.lower() not in _STOP_WORDS
    )
    overlap = module_words & fact_words
    if not overlap:
        logger.debug(
            f"Fact-module match rejected (no keyword overlap): "
            f"'{fact_text[:40]}' vs '{best_module.title}' (cosine={best_score:.2f})"
        )
        return None

    return best_module


_STOP_WORDS = {
    "that", "this", "with", "from", "have", "will", "been", "were", "they",
    "their", "about", "would", "there", "which", "could", "other", "than",
    "then", "them", "these", "some", "when", "what", "your", "more", "very",
    "want", "goal", "objective", "target", "reach", "achieve", "increase",
    "grow", "getting", "make", "currently", "reported", "business", "user",
}


def classify_fact_field(fact_text: str, module: Module) -> Optional[Tuple[str, str, str]]:
    """Determine which module field a fact should update.

    Returns (field, action, tier) or None if the fact doesn't map to any field.
    """
    text_lower = fact_text.lower()

    # Priority change (HIGH — always needs approval)
    priority_match = PRIORITY_PATTERN.search(fact_text)
    if priority_match:
        val = priority_match.group(1) or priority_match.group(2)
        if val and val.isdigit():
            p = int(val)
            if 1 <= p <= 10:
                return ("priority", "set", "high")

    # Deadline change (HIGH — always needs approval)
    if DEADLINE_KEYWORDS.search(fact_text):
        return ("deadline", "set", "high")

    # Status update — numeric figure with status-indicating language
    if STATUS_KEYWORDS.search(fact_text) and NUMERIC_PATTERN.search(fact_text):
        return ("status", "replace", "low")

    # Challenge/obstacle
    if CHALLENGE_KEYWORDS.search(fact_text):
        return ("challenges", "append", "medium")

    # Enabler/resource
    if ENABLER_KEYWORDS.search(fact_text):
        return ("enablers", "append", "medium")

    # Numeric fact that's clearly a progress metric (has a number, relates to the objective)
    if NUMERIC_PATTERN.search(fact_text):
        # Check if the number's unit matches the module's objective
        obj_lower = (module.measurable_target or module.objective or "").lower()
        # Simple heuristic: if both contain $ or both contain "customer" etc.
        fact_has_dollar = "$" in fact_text
        obj_has_dollar = "$" in obj_lower
        fact_has_count_word = any(w in text_lower for w in ["customer", "user", "subscriber", "client", "member"])
        obj_has_count_word = any(w in obj_lower for w in ["customer", "user", "subscriber", "client", "member"])
        if (fact_has_dollar and obj_has_dollar) or (fact_has_count_word and obj_has_count_word):
            return ("status", "replace", "low")

    return None


def extract_deadline_value(fact_text: str) -> Optional[str]:
    """Try to parse a date from a deadline-related fact. Returns ISO date or None."""
    # Try ISO format first
    iso_match = re.search(r'\b(\d{4}-\d{2}-\d{2})\b', fact_text)
    if iso_match:
        return iso_match.group(1)

    # Try "Month Day, Year" or "Month Day Year"
    month_names = {
        'jan': 1, 'january': 1, 'feb': 2, 'february': 2, 'mar': 3, 'march': 3,
        'apr': 4, 'april': 4, 'may': 5, 'jun': 6, 'june': 6, 'jul': 7, 'july': 7,
        'aug': 8, 'august': 8, 'sep': 9, 'sept': 9, 'september': 9,
        'oct': 10, 'october': 10, 'nov': 11, 'november': 11, 'dec': 12, 'december': 12,
    }
    month_match = re.search(
        r'\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|'
        r'jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
        r'\s+(\d{1,2})(?:,?\s*(\d{4}))?\b',
        fact_text, re.IGNORECASE
    )
    if month_match:
        month = month_names.get(month_match.group(1).lower()[:3])
        day = int(month_match.group(2))
        year = int(month_match.group(3)) if month_match.group(3) else date.today().year
        if month and 1 <= day <= 31:
            try:
                return f"{year}-{month:02d}-{day:02d}"
            except ValueError:
                pass

    # Try Q1-Q4 format
    q_match = re.search(r'\bq([1-4])\s*(\d{4})\b', fact_text, re.IGNORECASE)
    if q_match:
        q = int(q_match.group(1))
        year = int(q_match.group(2))
        # End of quarter
        month = q * 3
        day = 30 if month in (6, 9, 11) else 31
        if month == 2:
            day = 28
        return f"{year}-{month:02d}-{day:02d}"

    return None


def extract_priority_value(fact_text: str) -> Optional[int]:
    """Try to parse a priority number from a fact."""
    m = PRIORITY_PATTERN.search(fact_text)
    if m:
        val = m.group(1) or m.group(2)
        if val and val.isdigit():
            p = int(val)
            if 1 <= p <= 10:
                return p
    return None


_OBJECTIVE_CLASSIFY_PROMPT = """Below are facts extracted from a user's conversation. Identify which facts (if any) represent a NEW goal or objective the user has stated — something they want to achieve in the future.

Rules:
- A goal must be forward-looking (something they WANT to do, not something they already did)
- It should be specific enough to track progress on
- Preferences, constraints, and status updates are NOT goals
- "I want to reach 10K followers" = goal
- "I have 3K followers" = status update (NOT a goal)
- "I lost 10kg last year" = historical fact (NOT a goal)
- "I want to lose 10kg" = goal

Facts:
{facts}

Return ONLY the facts that are goals, one per line. If none are goals, return "NONE".
Do not add commentary or explanation. Just the goal facts, verbatim from the list above."""


async def _llm_classify_objectives(edges: list, llm_config) -> list:
    """Use the LLM to classify which extracted facts represent new goals."""
    if not llm_config:
        return []

    facts = []
    for edge in edges:
        fact = getattr(edge, "fact", "") or ""
        if fact and len(fact) >= 10:
            facts.append(fact)

    if not facts:
        return []

    prompt = _OBJECTIVE_CLASSIFY_PROMPT.replace("{facts}", "\n".join(f"- {f}" for f in facts))

    try:
        from .llm_adapter import call_llm
        response = await call_llm(prompt, llm_config, max_tokens=300)
        logger.info(f"LLM objective classify response: {repr(response[:200]) if response else 'None'}")
        if not response or "NONE" in response.strip().upper():
            return []

        # Parse the response — each line is a goal fact
        goals = []
        for line in response.strip().split("\n"):
            line = line.strip().lstrip("- ").strip()
            if line and len(line) >= 10 and line.upper() != "NONE":
                # Match back to original facts (LLM might paraphrase slightly)
                # Use exact substring match first, then fuzzy
                for original in facts:
                    if line.lower() in original.lower() or original.lower() in line.lower():
                        goals.append(original)
                        break
                else:
                    # Use the LLM's version if no match
                    goals.append(line)
        return goals
    except Exception as e:
        logger.debug(f"LLM objective classification failed: {e}")
        return []


async def _detect_and_create_modules(
    nodes: list, edges: list, store, embedder, llm_config=None
) -> list:
    """Detect Objective-typed nodes from extraction and auto-create modules.

    Detection triggers:
    1. Node has an 'Objective' label (typed schema classification)
    2. Edge has 'HasObjective' type name
    3. Edge fact contains goal-indicating language with a measurable target

    Only creates if no existing module already covers this objective (embedding sim < 0.55).
    Returns list of created module titles (for signaling to chat).
    """
    from .modules import Module, _cosine

    created = []
    existing_modules = store.list()

    # Collect candidate objectives from multiple signals
    candidates = []  # list of (title, fact_text)

    # Signal 1: Objective-labeled nodes
    for node in nodes:
        labels = getattr(node, "labels", None) or []
        if "Objective" in labels:
            node_name = getattr(node, "name", "") or ""
            node_uuid = getattr(node, "uuid", "") or ""
            if node_name and len(node_name) >= 5:
                # Find associated edge fact
                fact_text = ""
                for edge in edges:
                    target = getattr(edge, "target_node_uuid", "")
                    if target == node_uuid:
                        candidate = getattr(edge, "fact", "") or ""
                        if candidate and len(candidate) > len(fact_text):
                            fact_text = candidate
                candidates.append((node_name, fact_text or node_name))

    # Signal 2: HasObjective edges (even when node isn't labeled Objective)
    for edge in edges:
        edge_name = getattr(edge, "name", "") or ""
        if edge_name == "HasObjective":
            fact = getattr(edge, "fact", "") or ""
            if fact and len(fact) >= 10:
                # Use the fact as both title and objective
                title = fact[:80].strip()
                if title not in [c[0] for c in candidates]:
                    candidates.append((title, fact))

    # Signal 3: LLM classification — ask the model if any edge facts
    # represent a new goal/objective the user has stated
    if not candidates and edges:
        logger.info(f"Module detection: Signals 1-2 found nothing, trying LLM classification on {len(edges)} edges")
        objective_facts = await _llm_classify_objectives(edges, llm_config)
        if objective_facts:
            logger.info(f"Module detection: LLM identified {len(objective_facts)} objective(s): {objective_facts}")
        for fact in objective_facts:
            title = fact[:80].strip()
            if title not in [c[0] for c in candidates]:
                candidates.append((title, fact))

    if not candidates:
        return created

    for title, fact_text in candidates:
        # Check if a module already covers this objective
        try:
            obj_embedding = await embedder.create(f"{title}. {fact_text}")
        except Exception:
            continue

        is_duplicate = False
        for existing in existing_modules:
            if existing.embedding:
                sim = _cosine(obj_embedding, existing.embedding)
                if sim > 0.75:  # Very high bar — must be clearly the SAME goal
                    is_duplicate = True
                    break

        if is_duplicate:
            continue

        # Create the module with whatever we have
        module_data = {
            "title": title,
            "objective": fact_text or title,
            "measurable_target": fact_text if fact_text != title else None,
            "priority": 5,  # Default — user can adjust
            "priority_source": "inferred",
            "state": "active",
            "linked_entity_uuids": [],
        }

        module = await store.create(module_data, embedder=embedder)
        created.append(module.title)
        # Add to existing list so subsequent candidates in the same
        # extraction batch check against it (prevent double-create)
        existing_modules.append(module)
        logger.info(f"Auto-created module from chat: '{module.title}'")

    return created


async def process_extraction_for_modules(
    edges: list,
    llm_config,
    nodes: list = None,
) -> dict:
    """Post-extraction hook: match edges to modules and queue update proposals.
    Also detects new objectives from nodes and auto-creates modules.

    Called from extraction.py after profile routing.
    Returns dict with 'updates' count and 'modules_created' list.
    """
    from .modules import get_module_store
    from .graph import get_adapter

    result = {"updates": 0, "modules_created": []}

    store = get_module_store()

    adapter = get_adapter()
    logger.info(f"Module updater called: {len(edges)} edges, {len(nodes or [])} nodes, adapter={'yes' if adapter else 'no'}")
    if not adapter or not adapter.is_ready():
        return result

    # --- Detect new objectives from nodes and create modules ---
    # This runs FIRST — if the extraction found a new Objective node that
    # doesn't match any existing module, we create a new module rather than
    # incorrectly attaching the fact to an unrelated existing module.
    new_objective_uuids = set()
    if nodes:
        created = await _detect_and_create_modules(nodes, edges, store, adapter, llm_config)
        result["modules_created"] = created
        # Track which node uuids were just created as new modules
        # so we don't also try to match their facts to other modules
        for node in nodes:
            labels = getattr(node, "labels", None) or []
            if "Objective" in labels:
                new_objective_uuids.add(getattr(node, "uuid", ""))

    # --- Match edges to existing modules ---
    modules = store.list(active_only=True)
    if not modules:
        return result

    # Check if auto-approve is enabled (all updates apply immediately)
    auto_approve = False
    try:
        from .config import DATA_DIR
        import json
        # The electron store setting is passed via a sidecar config file
        # For now, check if there's a setting in the store
        settings_path = DATA_DIR / "settings.json"
        if settings_path.exists():
            settings = json.loads(settings_path.read_text())
            auto_approve = settings.get("autoApprove", False)
    except Exception:
        pass

    proposals_queued = 0

    for edge in edges:
        fact_text = getattr(edge, "fact", "") or getattr(edge, "name", "")
        if not fact_text or len(fact_text) < 10:
            continue

        edge_uuid = getattr(edge, "uuid", "")

        # Skip edges connected to a newly-created objective node —
        # these belong to the new module, not an existing one
        target_uuid = getattr(edge, "target_node_uuid", "")
        source_uuid = getattr(edge, "source_node_uuid", "")
        if target_uuid in new_objective_uuids or source_uuid in new_objective_uuids:
            continue

        # Match fact to a module
        matched = await match_fact_to_modules(
            fact_text, edge_uuid, adapter, store
        )
        if not matched:
            continue

        # Classify which field this fact updates
        classification = classify_fact_field(fact_text, matched)
        if not classification:
            continue

        field, action, tier = classification

        # Override: only deadline and priority need approval.
        # Status, challenges, enablers all auto-apply (LOW tier).
        if field in ("status", "challenges", "enablers"):
            tier = "low"
        # If auto-approve is enabled, everything auto-applies
        if auto_approve:
            tier = "low"

        # Build the update value
        if field == "deadline":
            new_deadline = extract_deadline_value(fact_text)
            if not new_deadline:
                continue  # Can't parse a date — skip
            value = new_deadline
        elif field == "priority":
            new_priority = extract_priority_value(fact_text)
            if not new_priority:
                continue
            value = new_priority
        elif field == "status":
            value = ModuleFact(
                text=fact_text,
                fact_uuid=edge_uuid,
                as_of=date.today().isoformat(),
            )
        else:
            # challenges, enablers — append
            value = ModuleFact(text=fact_text, fact_uuid=edge_uuid)

        # Apply or queue based on tier
        if tier == "low":
            # Auto-apply: status updates are factual, not judgmental
            _apply_module_update(store, matched, field, action, value)
            proposals_queued += 1
            logger.info(
                f"Module auto-update [{field}]: '{fact_text[:50]}' → {matched.title[:30]}"
            )
        else:
            # Queue for approval via the pending-updates system
            _queue_module_proposal(store, matched, field, action, value, fact_text, tier)
            proposals_queued += 1
            logger.info(
                f"Module proposal queued [{tier}/{field}]: '{fact_text[:50]}' → {matched.title[:30]}"
            )

    result["updates"] = proposals_queued
    return result


def _apply_module_update(
    store: ModuleStore, module: Module, field: str, action: str, value
):
    """Directly apply a low-tier update to a module."""
    patch = {}

    if field == "status" and action == "replace":
        # Replace status list with new single entry (consolidation)
        patch["status"] = [value.model_dump() if hasattr(value, 'model_dump') else value]
    elif field == "challenges" and action == "append":
        current = [c.model_dump() for c in module.challenges] if module.challenges else []
        new_entry = value.model_dump() if hasattr(value, 'model_dump') else value
        # Dedup: don't append if very similar text already exists
        if not any(new_entry.get("text", "").lower()[:30] in c.get("text", "").lower() for c in current):
            current.append(new_entry)
        patch["challenges"] = current
    elif field == "enablers" and action == "append":
        current = [e.model_dump() for e in module.enablers] if module.enablers else []
        new_entry = value.model_dump() if hasattr(value, 'model_dump') else value
        if not any(new_entry.get("text", "").lower()[:30] in e.get("text", "").lower() for e in current):
            current.append(new_entry)
        patch["enablers"] = current
    elif field == "deadline" and action == "set":
        patch["deadline"] = value
    elif field == "priority" and action == "set":
        patch["priority"] = value
        patch["priority_source"] = "declared"

    if patch:
        store.update(module.id, patch)


def _queue_module_proposal(
    store: ModuleStore, module: Module, field: str, action: str,
    value, fact_text: str, tier: str,
):
    """Queue a module update proposal through the pending-updates system.

    Uses a sidecar file (module_pending.json) to store the structured metadata
    that links a pending-update ID to the module action. When approved, the
    approve handler checks this file and applies the module change.
    """
    import json
    from .profile import get_profile_manager
    from .models import ProfileUpdateTier
    from .config import DATA_DIR

    tier_map = {
        "low": ProfileUpdateTier.LOW,
        "medium": ProfileUpdateTier.MEDIUM,
        "high": ProfileUpdateTier.HIGH,
    }

    # Format the proposal as a human-readable pending update
    if field == "deadline":
        content = f"[Module: {module.title}] Update deadline to {value}"
    elif field == "priority":
        content = f"[Module: {module.title}] Update priority to {value}/10"
    elif field == "challenges":
        text = value.text if hasattr(value, 'text') else str(value)
        content = f"[Module: {module.title}] Add challenge: {text}"
    elif field == "enablers":
        text = value.text if hasattr(value, 'text') else str(value)
        content = f"[Module: {module.title}] Add enabler: {text}"
    elif field == "status":
        text = value.text if hasattr(value, 'text') else str(value)
        content = f"[Module: {module.title}] Update status: {text}"
    else:
        content = f"[Module: {module.title}] Update {field}: {value}"

    profile_mgr = get_profile_manager()
    update_id = profile_mgr.queue_update(
        section_name="objectives",  # Module updates show in objectives section
        proposed_change=content,
        tier=tier_map.get(tier, ProfileUpdateTier.MEDIUM),
        source_fact_ids=[getattr(value, 'fact_uuid', '') or ''],
    )

    # Store structured module proposal metadata in sidecar file
    proposals_path = DATA_DIR / "module_pending.json"
    try:
        existing = json.loads(proposals_path.read_text()) if proposals_path.exists() else {}
    except Exception:
        existing = {}

    serialized_value = value.model_dump() if hasattr(value, 'model_dump') else value
    existing[update_id] = {
        "module_id": module.id,
        "field": field,
        "action": action,
        "value": serialized_value,
    }
    proposals_path.write_text(json.dumps(existing, indent=2, default=str))


def apply_module_proposal_if_exists(update_id: str) -> bool:
    """Called when a pending update is approved. If this update has module
    metadata in module_pending.json, apply the change to the module.

    Returns True if a module update was applied, False otherwise.
    """
    import json
    from .config import DATA_DIR
    from .modules import get_module_store, ModuleFact

    proposals_path = DATA_DIR / "module_pending.json"
    if not proposals_path.exists():
        return False

    try:
        proposals = json.loads(proposals_path.read_text())
    except Exception:
        return False

    if update_id not in proposals:
        return False

    proposal = proposals[update_id]
    module_id = proposal.get("module_id")
    field = proposal.get("field")
    action = proposal.get("action")
    value = proposal.get("value")

    if not module_id or not field:
        return False

    store = get_module_store()
    module = store.get(module_id)
    if not module:
        # Module was deleted since proposal was queued — clean up
        del proposals[update_id]
        proposals_path.write_text(json.dumps(proposals, indent=2, default=str))
        return False

    # Apply the update
    if field == "status" and action == "replace":
        if isinstance(value, dict):
            value = ModuleFact(**value)
        _apply_module_update(store, module, field, action, value)
    elif field in ("challenges", "enablers") and action == "append":
        if isinstance(value, dict):
            value = ModuleFact(**value)
        _apply_module_update(store, module, field, action, value)
    elif field == "deadline" and action == "set":
        _apply_module_update(store, module, field, action, value)
    elif field == "priority" and action == "set":
        _apply_module_update(store, module, field, action, value)

    # Clean up the proposal
    del proposals[update_id]
    proposals_path.write_text(json.dumps(proposals, indent=2, default=str))

    logger.info(f"Module proposal applied: {module.title} [{field}]")
    return True


def reject_module_proposal_if_exists(update_id: str) -> bool:
    """Called when a pending update is rejected. Clean up module metadata."""
    import json
    from .config import DATA_DIR

    proposals_path = DATA_DIR / "module_pending.json"
    if not proposals_path.exists():
        return False

    try:
        proposals = json.loads(proposals_path.read_text())
    except Exception:
        return False

    if update_id not in proposals:
        return False

    del proposals[update_id]
    proposals_path.write_text(json.dumps(proposals, indent=2, default=str))
    return True
