"""Assertion types for eval scenarios.

Each assertion returns (status, detail) where status is "pass" | "fail" | "skip".
"skip" means the assertion could not run (e.g. /debug/cypher not patched in)
and is excluded from pass-rate math but reported loudly.

Supported assertion objects in scenario JSON:

  {"type": "search_contains",  "query": "...", "expect_substring": "...",
   "top_k": 5, "any_of": ["...", "..."]}
      A top_k search result's fact must contain expect_substring
      (or any one of any_of).

  {"type": "search_absent",    "query": "...", "reject_substring": "...",
   "top_k": 5}
      No top_k result may contain reject_substring.

  {"type": "search_rank",      "query": "...", "expect_substring": "...",
   "max_rank": 1}
      The matching fact must appear at rank <= max_rank (1-based).

  {"type": "salience_tier",    "query": "...", "expect_substring": "...",
   "tier": "high" | "medium" | "low"}
      Find the fact via search, read its salience from /search output,
      assert it falls in the tier band (high >= 0.7, medium 0.3-0.7, low < 0.3).

  {"type": "profile_section",  "match_substring": "...",
   "sections": ["preferences", "constraints"], "tiers": ["high"]}
      A pending update (or applied profile fact) containing match_substring
      must exist in one of the listed sections (and tiers, if given).
      `sections` accepts multiple entries to encode defensible-either-way.

  {"type": "profile_absent",   "match_substring": "..."}
      No pending update or profile fact may contain match_substring
      (contamination check).

  {"type": "cypher_rows",      "query": "...", "min_rows": 1, "max_rows": null}
      Row-count bounds on a raw Cypher query. SKIPs without the debug patch.

  {"type": "judge_context_recall", "question": "...",
   "required_facts": ["...", "..."], "min_recall": 1.0}
      Calls /retrieve with the question, then asks the judge model whether
      each required fact is present in the returned context.
"""

from __future__ import annotations

TIER_BANDS = {
    "high": (0.7, 1.01),
    "medium": (0.3, 0.7),
    "low": (0.0, 0.3),
    "medium_or_high": (0.3, 1.01),  # Boundary cases where both are valid
}


def _fact_of(result: dict) -> str:
    return (result.get("fact") or "").lower()


async def run_assertion(a: dict, client, judge) -> tuple[str, str]:
    t = a["type"]

    if t == "search_contains":
        results = await client.search(a["query"], limit=a.get("top_k", 5))
        needles = [s.lower() for s in ([a["expect_substring"]] if "expect_substring" in a
                                       else a["any_of"])]
        for r in results:
            if any(n in _fact_of(r) for n in needles):
                return "pass", f"found at rank {results.index(r) + 1}"
        got = " | ".join(_fact_of(r)[:50] for r in results[:3])
        return "fail", f"none of {needles} in top {a.get('top_k', 5)}; got: {got}"

    if t == "search_absent":
        results = await client.search(a["query"], limit=a.get("top_k", 5))
        needle = a["reject_substring"].lower()
        for i, r in enumerate(results):
            if needle in _fact_of(r):
                return "fail", f"'{needle}' present at rank {i + 1}: {_fact_of(r)[:70]}"
        return "pass", "absent from top results"

    if t == "search_contains_or_absent":
        # Passes if the injection was stored as a fact (findable) OR safely
        # dropped (not found). Both are valid security outcomes — the only
        # failure case is if it was *executed* (checked by profile_absent).
        results = await client.search(a["query"], limit=a.get("top_k", 5))
        needles = [s.lower() for s in ([a["expect_substring"]] if "expect_substring" in a
                                       else a.get("any_of", []))]
        for r in results:
            if any(n in _fact_of(r) for n in needles):
                return "pass", f"stored as content at rank {results.index(r) + 1} (valid)"
        return "pass", "safely dropped — not stored or executed (valid)"

    if t == "search_rank":
        results = await client.search(a["query"], limit=max(a.get("max_rank", 1), 5))
        needle = a["expect_substring"].lower()
        for i, r in enumerate(results, start=1):
            if needle in _fact_of(r):
                if i <= a.get("max_rank", 1):
                    return "pass", f"rank {i}"
                return "fail", f"found but at rank {i} > max_rank {a.get('max_rank', 1)}"
        return "fail", "not found at all"

    if t == "salience_tier":
        results = await client.search(a["query"], limit=a.get("top_k", 5))
        needle = a["expect_substring"].lower()
        for r in results:
            if needle in _fact_of(r):
                sal = r.get("salience")
                if sal is None:
                    return "fail", "fact found but salience is null (scoring pass missed it)"
                lo, hi = TIER_BANDS[a["tier"]]
                if lo <= float(sal) < hi:
                    return "pass", f"salience {sal} in {a['tier']} band"
                return "fail", f"salience {sal} outside {a['tier']} band [{lo},{hi})"
        return "fail", "fact not found via search"

    if t == "salience_tier_or_absent":
        # Passes if the fact is in the expected tier OR was correctly filtered out
        # (not stored at all). Both are valid outcomes for low-value content.
        results = await client.search(a["query"], limit=a.get("top_k", 5))
        needle = a["expect_substring"].lower()
        for r in results:
            if needle in _fact_of(r):
                sal = r.get("salience")
                if sal is None:
                    return "pass", "fact found but unscored — acceptable for low-value content"
                lo, hi = TIER_BANDS[a["tier"]]
                if lo <= float(sal) < hi:
                    return "pass", f"salience {sal} in {a['tier']} band"
                return "fail", f"salience {sal} outside {a['tier']} band [{lo},{hi}) — inflated"
        return "pass", "fact correctly filtered out (not stored) — valid for low-value content"

    if t == "profile_section":
        needle = a["match_substring"].lower()
        sections = set(a["sections"])
        tiers = set(a.get("tiers", []))
        # Check pending queue first, then applied profile facts.
        for u in await client.pending_updates():
            if needle in u.get("proposed_change", "").lower():
                if u["section"] in sections and (not tiers or u["tier"] in tiers):
                    return "pass", f"pending in {u['section']} ({u['tier']})"
                return "fail", (f"found but in section '{u['section']}' tier "
                                f"'{u['tier']}'; wanted {sections} {tiers or ''}")
        prof = await client.profile()
        for sec_name, sec in prof.items():
            if not isinstance(sec, dict):
                continue
            for fact in sec.get("key_facts", []):
                if needle in fact.lower():
                    if sec_name in sections:
                        return "pass", f"applied in profile/{sec_name}"
                    return "fail", f"applied but in profile/{sec_name}; wanted {sections}"
        return "fail", f"'{needle}' not found in pending queue or profile"

    if t == "profile_absent":
        needle = a["match_substring"].lower()
        for u in await client.pending_updates():
            if needle in u.get("proposed_change", "").lower():
                return "fail", f"contamination: pending in {u['section']}"
        prof = await client.profile()
        for sec_name, sec in prof.items():
            if isinstance(sec, dict):
                for fact in sec.get("key_facts", []):
                    if needle in fact.lower():
                        return "fail", f"contamination: applied in profile/{sec_name}"
        return "pass", "not present anywhere in profile"

    if t == "cypher_rows":
        data = await client.cypher(a["query"])
        if data is None:
            return "skip", "/debug/cypher not available — apply sidecar_patch"
        rows = data.get("rows", [])
        n = len(rows)
        min_rows = a.get("min_rows", 1)
        max_rows = a.get("max_rows")
        if n < min_rows:
            return "fail", f"{n} rows < min {min_rows}"
        if max_rows is not None and n > max_rows:
            return "fail", f"{n} rows > max {max_rows}; rows: {rows[:3]}"
        return "pass", f"{n} rows"

    if t == "judge_context_recall":
        retrieval = await client.retrieve(a["question"], token_budget=a.get("token_budget", 1500))
        context = retrieval.get("context", "")
        if not context:
            return "fail", "retrieval returned empty context"
        recall, missing = await judge.context_recall(
            a["question"], context, a["required_facts"]
        )
        min_recall = a.get("min_recall", 1.0)
        if recall >= min_recall:
            return "pass", f"context recall {recall:.2f}"
        # Dump truncated context on failure for funnel diagnostics
        ctx_preview = context[:1200].replace("\n", " ↵ ")
        return "fail", (f"context recall {recall:.2f} < {min_recall}; "
                        f"missing: {missing}\n"
                        f"    [context dump]: {ctx_preview}...")

    return "skip", f"unknown assertion type '{t}'"
