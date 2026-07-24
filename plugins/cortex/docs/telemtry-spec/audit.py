"""Cortex weekly judged audit — the production twin of the eval suite's
context-recall metric.

Samples ~20 retrieve exchanges from the trailing week (stratified: goal-brief
exchanges and long queries oversampled; every flagged exchange — miss,
redundant_question, correction — is ALWAYS included and adjudicated rather
than sampled). Each sample's logged query + context snapshot + response is
graded by a strong judge model against the generalized rubric, results are
written back as `audit` events, and the weekly KPI record is appended.

Run weekly (cron/launchd) or by hand:
    python -m sidecar.audit --sample 20 --model gpt-5.4
Requires OPENAI_API_KEY (or --api-key).
"""

import argparse
import asyncio
import json
import logging
import random
from typing import Optional

import httpx

from .telemetry import (CONTEXTS_DIR, _load_flags, log_event, read_events,
                        record_weekly_kpis)

logger = logging.getLogger("cortex.audit")

AUDIT_PROMPT = """You are auditing a memory system that assembles context for a business/personal advisory AI. Judge THIS SINGLE exchange strictly from what is shown.

USER QUERY:
{query}

CONTEXT THE MEMORY SYSTEM ASSEMBLED (what the advisory AI saw):
---
{context}
---

THE AI'S RESPONSE:
---
{response}
---

Grade these five things:
1. context_sufficient — could a competent advisor answer this query well from the context shown? (If the query needs no memory — greetings, general knowledge — answer true.)
2. missing — list the specific pieces of needed information absent from the context (empty list if none).
3. superseded_value_cited — does the RESPONSE assert, as current, any value the context marks [superseded] or contradicts with a newer value? (Mentioning history explicitly as history is fine.)
4. goal_relevant — does the query touch a tracked goal/objective visible in the context (a [Goal Brief] block, or an objectives section)?
5. priority_deadline_present — ONLY if goal_relevant: are that goal's priority AND deadline both present in the context? Otherwise null.

Output ONLY valid JSON:
{"context_sufficient": bool, "missing": ["..."], "superseded_value_cited": bool, "goal_relevant": bool, "priority_deadline_present": bool_or_null, "notes": "<one line>"}"""


async def _judge(model: str, api_key: str, base_url: str,
                 query: str, context: str, response: str) -> Optional[dict]:
    prompt = (AUDIT_PROMPT
              .replace("{query}", (query or "")[:2000])
              .replace("{context}", (context or "")[:9000])
              .replace("{response}", (response or "")[:4000]))
    async with httpx.AsyncClient(timeout=90.0) as c:
        r = await c.post(
            f"{base_url}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}"},
            json={"model": model,
                  "messages": [{"role": "user", "content": prompt}],
                  "temperature": 0,
                  "max_completion_tokens": 500},
        )
        r.raise_for_status()
        raw = r.json()["choices"][0]["message"]["content"]
    try:
        start, end = raw.find("{"), raw.rfind("}")
        return json.loads(raw[start:end + 1])
    except Exception:
        logger.warning("audit: judge returned unparseable output")
        return None


def _select_samples(events: list[dict], sample_size: int) -> list[dict]:
    """Flagged exchanges always in; remainder stratified-random."""
    retrieves = {e["exchange_id"]: e for e in events
                 if e["type"] == "retrieve" and e.get("exchange_id")}
    responses = {e["exchange_id"]: e for e in events
                 if e["type"] == "response" and e.get("exchange_id")}
    # Only auditable exchanges: have a snapshot on disk.
    auditable = {xid: ev for xid, ev in retrieves.items()
                 if (CONTEXTS_DIR / f"{xid}.txt").exists()}

    flags = _load_flags()
    must = [auditable[x] for x in auditable if x in flags]
    rest = [auditable[x] for x in auditable if x not in flags]

    # Stratify the remainder: goal-brief exchanges and long queries first.
    weighted = sorted(rest, key=lambda e: (
        -(e.get("briefs_included", 0) > 0),
        -len(e.get("query", "")),
        random.random(),
    ))
    take = max(sample_size - len(must), 0)
    chosen = must + weighted[:take]
    for e in chosen:
        e["_response"] = (responses.get(e["exchange_id"], {}) or {}).get(
            "response_text", "")
    return chosen


async def run_audit(model: str, api_key: str, base_url: str,
                    sample_size: int = 20, days: int = 7) -> dict:
    events = read_events(days)
    samples = _select_samples(events, sample_size)
    if not samples:
        logger.warning("audit: no auditable exchanges in window "
                       "(need retrieve events with context snapshots)")
        return {"audited": 0}

    print(f"Auditing {len(samples)} exchange(s) with {model} ...")
    graded = 0
    for e in samples:
        xid = e["exchange_id"]
        context = (CONTEXTS_DIR / f"{xid}.txt").read_text()
        verdict = await _judge(model, api_key, base_url,
                               e.get("query", ""), context,
                               e.get("_response", ""))
        if verdict is None:
            continue
        log_event("audit", xid, e.get("session_id"), **verdict)
        graded += 1
        mark = "✓" if verdict.get("context_sufficient") else "✗"
        extra = ""
        if verdict.get("superseded_value_cited"):
            extra += " [SUPERSEDED CITED]"
        if verdict.get("missing"):
            extra += f" missing: {verdict['missing'][:2]}"
        print(f"  {mark} {e.get('query', '')[:60]}{extra}")

    record = record_weekly_kpis(note=f"audit n={graded}, model={model}")
    k = record["kpis"]
    print("\nWeekly KPI record written:")
    for key in ("live_context_recall_pct", "superseded_citation_rate_pct",
                "priority_deadline_present_pct", "redundant_question_rate_per100",
                "correction_rate_per100", "miss_count", "retrieval_p95_ms"):
        print(f"  {key}: {k.get(key)}")
    return {"audited": graded, "kpis": k}


def main():
    import os
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="gpt-5.4")
    ap.add_argument("--api-key", default=None)
    ap.add_argument("--base-url", default="https://api.openai.com/v1")
    ap.add_argument("--sample", type=int, default=20)
    ap.add_argument("--days", type=int, default=7)
    args = ap.parse_args()
    api_key = args.api_key or os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        raise SystemExit("OPENAI_API_KEY required")
    asyncio.run(run_audit(args.model, api_key, args.base_url,
                          args.sample, args.days))


if __name__ == "__main__":
    main()
