"""Cortex limits eval — main runner.

Usage:
  export OPENAI_API_KEY=sk-...
  python -m harness.runner --model gpt-5.4-mini --judge-model gpt-5.4 \
      --port 9199 --runs 3 --mode fresh
  python -m harness.runner --mode cumulative --only 10_interference

Modes:
  fresh       /clear before EVERY scenario (isolated capability testing)
  cumulative  /clear once at suite start; scenarios share one growing graph
              (interference-realistic; strictly harder; closer to production)

Every scenario runs --runs times; results report PASS-RATE per assertion,
because extraction is stochastic and 1-of-3 is a fail wearing camouflage.

Scenario JSON format:
{
  "name": "...", "description": "...",
  "steps": [
    {"step": "ingest", "user_message": "...", "assistant_response": "...",
     "repeat_text": {"times": 200, "text": "..."}},        // optional long-msg builder
    {"step": "generate_distractors", "count": 150, "seed": 42},
    {"step": "checkpoint", "label": "at_150"},              // precision probe point
    {"step": "reflect"},
    {"step": "assert", ...assertion object (see assertions.py)...},
    {"step": "precision_probe", "label": "at_150",          // scored per checkpoint
     "query": "...", "expect_substring": "...", "top_k": 5}
  ]
}
"""

import argparse
import asyncio
import json
import statistics
import sys
import time
from collections import defaultdict
from pathlib import Path

from .assertions import run_assertion
from .client import SidecarClient
from .generator import generate
from .judge import Judge

SCENARIO_DIR = Path(__file__).parent


def load_scenarios(only: str | None) -> list[dict]:
    files = sorted(SCENARIO_DIR.glob("*.json"))
    scenarios = []
    for f in files:
        if only and only not in f.stem:
            continue
        scenarios.append(json.loads(f.read_text()))
    return scenarios


async def run_scenario(sc: dict, client: SidecarClient, judge: Judge,
                       results: dict, latencies: list, run_idx: int):
    name = sc["name"]
    print(f"\n▶ [{run_idx + 1}] {name}: {sc.get('description', '')}")

    for step in sc["steps"]:
        kind = step["step"]

        if kind == "ingest":
            msg = step.get("user_message", "")
            if "repeat_text" in step:
                rt = step["repeat_text"]
                msg = (msg + " " + (rt["text"] + " ") * rt["times"]).strip()
            r = await client.extract(msg, step.get("assistant_response", ""),
                                     session_id=name)
            print(f"  ingested: {r.get('entities_created', 0)}E "
                  f"{r.get('relationships_created', 0)}R")

        elif kind == "generate_distractors":
            batch = generate(step["count"], seed=step.get("seed", 42))
            for i, ex in enumerate(batch):
                await client.extract(ex["user_message"], ex["assistant_response"],
                                     session_id=f"{name}-distractor")
                if (i + 1) % 25 == 0:
                    print(f"  distractors ingested: {i + 1}/{step['count']}")

        elif kind == "reflect":
            r = await client.reflect()
            print(f"  reflection: {r.get('insights_created', 0)} insights")

        elif kind == "approve_pending":
            # Simulate user digest review: approve all pending profile updates.
            # This is the honest production condition — HIGH facts require explicit
            # human approval, and the profile layer only works once they're approved.
            updates = await client.pending_updates()
            approved = 0
            for u in updates:
                if u.get("status") == "pending":
                    await client.approve_update(u["id"])
                    approved += 1
            print(f"  approved {approved} pending profile updates")

        elif kind == "checkpoint":
            st = await client.stats()
            print(f"  checkpoint '{step['label']}': {st.get('episodes')} episodes, "
                  f"{st.get('edges')} edges, {st.get('pending_updates')} pending")
            results["queue_growth"][step["label"]].append(st.get("pending_updates", 0))

        elif kind == "precision_probe":
            t0 = time.time()
            hits = await client.search(step["query"], limit=step.get("top_k", 5))
            latencies.append((time.time() - t0) * 1000)
            needle = step["expect_substring"].lower()
            hit = any(needle in (h.get("fact") or "").lower() for h in hits)
            key = f"{name} :: precision@{step.get('top_k', 5)} [{step['label']}] {needle[:40]}"
            results["assertions"][key].append(1 if hit else 0)
            print(f"  {'✓' if hit else '✗'} probe [{step['label']}]: {needle[:50]}")

        elif kind == "assert":
            t0 = time.time()
            status, detail = await run_assertion(step, client, judge)
            if step["type"].startswith("search"):
                latencies.append((time.time() - t0) * 1000)
            label = step.get("label") or f"{step['type']}: {str(step.get('query') or step.get('match_substring') or step.get('question'))[:45]}"
            key = f"{name} :: {label}"
            non_graded = step.get("_non_graded", False)
            if status == "skip":
                results["skipped"][key] = detail
                print(f"  ⊘ SKIP {label} — {detail}")
            elif non_graded:
                # Informational probes: logged but not counted in pass-rate
                mark = "✓" if status == "pass" else "✗"
                results.setdefault("probes", {})[key] = status
                print(f"  {mark} {label} (probe, non-graded)" + ("" if status == "pass" else f"\n    → {detail}"))
            else:
                results["assertions"][key].append(1 if status == "pass" else 0)
                mark = "✓" if status == "pass" else "✗"
                print(f"  {mark} {label}" + ("" if status == "pass" else f"\n    → {detail}"))
                if status == "fail":
                    results["fail_details"][key].append(detail)

        else:
            print(f"  ⊘ unknown step '{kind}'")


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=9199)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--model", default="gpt-5.4-mini", help="extraction model")
    ap.add_argument("--provider", default="openai")
    ap.add_argument("--api-key", default=None, help="defaults to OPENAI_API_KEY env")
    ap.add_argument("--judge-model", default="gpt-5.4",
                    help="STRONG model for context-recall judging")
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("--mode", choices=["fresh", "cumulative"], default="fresh")
    ap.add_argument("--only", default=None, help="substring filter on scenario filename")
    ap.add_argument("--report", default="eval_report.json")
    args = ap.parse_args()

    import os
    api_key = args.api_key or os.environ.get("OPENAI_API_KEY", "")
    llm_config = {"provider": args.provider, "model": args.model, "api_key": api_key}

    client = SidecarClient(f"http://{args.host}:{args.port}", llm_config)
    judge = Judge(model=args.judge_model, api_key=api_key)

    health = await client.health()
    if health.get("status") != "ok":
        print(f"ABORT: sidecar degraded: {health}")
        sys.exit(1)

    scenarios = load_scenarios(args.only)
    if not scenarios:
        print("No scenarios matched.")
        sys.exit(1)

    print("=" * 62)
    print(f"CORTEX LIMITS EVAL — {len(scenarios)} scenarios × {args.runs} runs "
          f"({args.mode} mode)")
    print(f"Extraction: {args.model} | Judge: {args.judge_model}")
    print("=" * 62)

    results = {
        "assertions": defaultdict(list),
        "fail_details": defaultdict(list),
        "skipped": {},
        "queue_growth": defaultdict(list),
    }
    latencies: list[float] = []

    for run_idx in range(args.runs):
        if args.mode == "cumulative":
            await client.clear()  # once per run, graph grows across scenarios
        for sc in scenarios:
            if args.mode == "fresh":
                await client.clear()
            await run_scenario(sc, client, judge, results, latencies, run_idx)

    # ── Report ───────────────────────────────────────────────────
    print("\n" + "=" * 62)
    print("PASS-RATES (across runs — anything under 100% is flaky or broken)")
    print("=" * 62)
    total_p = total_n = 0
    flaky, broken = [], []
    for key, outcomes in sorted(results["assertions"].items()):
        rate = sum(outcomes) / len(outcomes)
        total_p += sum(outcomes)
        total_n += len(outcomes)
        tag = "✓" if rate == 1.0 else ("~" if rate > 0 else "✗")
        print(f"  {tag} {rate * 100:5.1f}%  {key}")
        if 0 < rate < 1.0:
            flaky.append(key)
        elif rate == 0:
            broken.append(key)

    if latencies:
        print(f"\nSearch latency: p50 {statistics.median(latencies):.0f}ms, "
              f"p95 {sorted(latencies)[int(len(latencies) * 0.95) - 1]:.0f}ms "
              f"({len(latencies)} samples)")
    for label, counts in results["queue_growth"].items():
        print(f"Pending-queue size at '{label}': {counts}")
    if results["skipped"]:
        print(f"\nSKIPPED ({len(results['skipped'])}): apply sidecar_patch/ to enable "
              "graph-level assertions")
    if flaky:
        print(f"\nFLAKY ({len(flaky)}): passed some runs, not all — these are "
              "stochastic-extraction weak points; fix prompts/model, not the test.")
    if broken:
        print(f"BROKEN ({len(broken)}): failed every run.")

    print(f"\nOVERALL: {total_p}/{total_n} assertion-runs passed "
          f"({(total_p / max(total_n, 1)) * 100:.1f}%)")

    Path(args.report).write_text(json.dumps({
        "config": vars(args) | {"api_key": "***"},
        "pass_rates": {k: sum(v) / len(v) for k, v in results["assertions"].items()},
        "fail_details": dict(results["fail_details"]),
        "skipped": results["skipped"],
        "queue_growth": {k: v for k, v in results["queue_growth"].items()},
        "latency_ms": {"p50": statistics.median(latencies) if latencies else None,
                       "samples": len(latencies)},
    }, indent=2))
    print(f"Report written to {args.report}")


if __name__ == "__main__":
    asyncio.run(main())
