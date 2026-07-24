"""SCOPED assembler — compiles matched modules into per-goal advisory briefs.

Called from /retrieve after search+rerank, before context assembly. For each
matched module:

1. Refresh S/C/E against the graph (drop facts with invalid_at set)
2. Compute derived lines in Python — Gap, Time remaining, Urgency.
   NEVER LLM-computed: a wrong number confidently framed is worse than
   no number, so Gap only renders on an unambiguous parse.
3. Render a ≤BRIEF_TOKEN_CAP brief.

The SCOPED symmetry does the advisory work: Status↔Objective = gap analysis,
Challenges↔Enablers = feasibility ledger, Priority↔Deadline = urgency triage.
"""

import logging
import re
from datetime import date
from typing import List, Optional, Tuple

from .modules import Module, ModuleFact

logger = logging.getLogger("cortex.scoped")

BRIEF_TOKEN_CAP = 200          # hard cap per brief (≈4 chars/token)
MAX_LIST_ITEMS = 3             # C/E items rendered per brief
URGENT_PRIORITY = 7
URGENT_DAYS = 90


# ── Graph refresh ────────────────────────────────────────────────


async def refresh_module_facts(
    module: Module, driver
) -> "dict[str, List[ModuleFact]]":
    """Return S/C/E lists with superseded facts dropped.

    Uses the adapter's check_invalidated() typed method. A brief must never
    assert a fact the graph knows is invalid.
    """
    fields = {
        "status": list(module.status),
        "challenges": list(module.challenges),
        "enablers": list(module.enablers),
    }

    uuids = [
        f.fact_uuid for lst in fields.values() for f in lst if f.fact_uuid
    ]

    if not uuids or driver is None:
        return fields

    try:
        # driver here is either the raw driver (transition) or adapter
        # Support both: if it has check_invalidated, use it; else raw query
        if hasattr(driver, 'check_invalidated'):
            invalid = await driver.check_invalidated(uuids)
        else:
            result = await driver.execute_query(
                "MATCH ()-[r:RELATES_TO]->() WHERE r.uuid IN $ids "
                "RETURN r.uuid AS uuid, r.invalid_at AS invalid_at",
                ids=uuids,
            )
            rows = result[0] if result else []
            invalid = {
                row["uuid"] for row in rows if row.get("invalid_at") is not None
            }

        if invalid:
            for key, lst in fields.items():
                kept = [f for f in lst if f.fact_uuid not in invalid]
                if len(kept) != len(lst):
                    logger.info(
                        f"Brief refresh: dropped "
                        f"{len(lst) - len(kept)} superseded {key} "
                        f"fact(s) for module '{module.title[:40]}'"
                    )
                fields[key] = kept
    except Exception as e:
        logger.warning(
            f"Module provenance refresh failed (rendering stored "
            f"facts with as_of dates): {e}"
        )

    return fields


# ── Deterministic derivations ────────────────────────────────────


_NUM = re.compile(
    r"(?<![\w.])\$?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k|m|thousand|million|%)?",
    re.IGNORECASE,
)


def _parse_single_number(text: str) -> Optional[tuple[float, str]]:
    """Return (value, unit_class) ONLY if exactly one number parses.

    unit_class ∈ {'currency','percent','count'}. Ambiguity → None.
    """
    matches = _NUM.findall(text or "")
    if len(matches) != 1:
        return None

    raw, suffix = matches[0]
    value = float(raw.replace(",", ""))
    suffix = (suffix or "").lower()

    if suffix in ("k", "thousand"):
        value *= 1_000
    elif suffix in ("m", "million"):
        value *= 1_000_000

    if "$" in text and text.index("$") <= text.find(raw.split(".")[0]):
        unit = "currency"
    elif suffix == "%":
        unit = "percent"
    else:
        unit = "count"

    return value, unit


def derive_gap(
    status_facts: List[ModuleFact],
    objective: str,
    weeks_remaining: Optional[float],
) -> Optional[str]:
    """Emit a Gap line only on an unambiguous numeric parse of BOTH sides
    with compatible units. Otherwise return None — omit rather than guess.
    """
    target = _parse_single_number(objective)
    if not target:
        return None

    for fact in status_facts:
        current = _parse_single_number(fact.text)
        if not current or current[1] != target[1]:
            continue

        gap = target[0] - current[0]
        if gap <= 0:
            return "Gap: target met or exceeded on current figures"

        unit = {"currency": "$", "percent": "pp", "count": ""}[target[1]]
        gap_str = f"{unit}{gap:,.0f}".replace("$-", "-$")
        line = f"Gap: {gap_str} to target"

        if weeks_remaining and weeks_remaining > 0:
            rate = gap / weeks_remaining
            line += f" in {weeks_remaining:.0f} weeks (~{unit}{rate:,.0f}/week needed)"
        return line

    return None


def time_remaining(
    deadline: Optional[str],
) -> Tuple[Optional[str], Optional[float]]:
    """('11 weeks away', 11.0) — or ('deadline passed', negative weeks)."""
    if not deadline:
        return None, None
    try:
        d = date.fromisoformat(deadline)
    except ValueError:
        return None, None

    days = (d - date.today()).days
    weeks = days / 7.0

    if days < 0:
        return "deadline passed", weeks
    if days < 112:  # <16 weeks → weeks; else months
        return f"{max(weeks, 0):.0f} weeks away", weeks
    return f"{days / 30.4:.0f} months away", weeks


# ── Rendering ────────────────────────────────────────────────────


def render_brief(module: Module, refreshed: "dict[str, List[ModuleFact]]") -> str:
    tr_text, tr_weeks = time_remaining(module.deadline)
    urgent = (
        module.priority >= URGENT_PRIORITY
        and tr_weeks is not None
        and 0 <= tr_weeks * 7 < URGENT_DAYS
    )

    lines = [f"[Goal Brief: {module.title}]" + (" ⚠ URGENT" if urgent else "")]

    p_src = "" if module.priority_source == "declared" else " (inferred)"
    header = f"Priority: {module.priority}/10{p_src}"
    if module.deadline:
        d = module.deadline
        header += f" | Deadline: {d}" + (f" ({tr_text})" if tr_text else "")
        if module.state == "expired" or tr_text == "deadline passed":
            header += " ⚠ deadline passed"
    lines.append(header)

    lines.append(f"Objective: {module.measurable_target or module.objective}")

    status = refreshed["status"]
    if status:
        parts = []
        for f in status[:MAX_LIST_ITEMS]:
            parts.append(f"{f.text}" + (f" (as of {f.as_of})" if f.as_of else ""))
        lines.append("Status: " + "; ".join(parts))

    gap = derive_gap(
        status, module.measurable_target or module.objective, tr_weeks
    )
    if gap:
        lines.append(gap)

    if refreshed["challenges"]:
        lines.append(
            "Challenges: "
            + "; ".join(f.text for f in refreshed["challenges"][:MAX_LIST_ITEMS])
        )

    if refreshed["enablers"]:
        lines.append(
            "Enablers: "
            + "; ".join(f.text for f in refreshed["enablers"][:MAX_LIST_ITEMS])
        )

    lines.append("[End Goal Brief]")
    text = "\n".join(lines)

    # Hard token cap: trim E then C items before ever touching S/O/P/D.
    while len(text) // 4 > BRIEF_TOKEN_CAP:
        trimmed = False
        for key in ("enablers", "challenges"):
            if len(refreshed[key]) > 1:
                refreshed[key] = refreshed[key][:-1]
                trimmed = True
                break
        if not trimmed:
            break
        return render_brief(module, refreshed)

    text = text[: BRIEF_TOKEN_CAP * 4]  # last resort
    return text


async def compile_briefs(
    matched: List[Module], driver
) -> Tuple[List[str], set]:
    """Returns (rendered briefs, fact_uuids used) — the uuid set lets the
    caller skip those facts in the memory-facts block (no token spent twice).

    Urgent briefs sort first.
    """
    rendered: List[tuple] = []
    used_uuids: set = set()

    for module in matched:
        refreshed = await refresh_module_facts(module, driver)
        for lst in refreshed.values():
            used_uuids.update(f.fact_uuid for f in lst if f.fact_uuid)
        brief = render_brief(module, refreshed)
        rendered.append(("URGENT" in brief.splitlines()[0], brief))

    rendered.sort(key=lambda t: not t[0])
    return [b for _, b in rendered], used_uuids
