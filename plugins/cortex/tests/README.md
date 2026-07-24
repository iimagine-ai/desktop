# Cortex Limits Eval Suite

Pushes the memory system where systems like this actually break: interference
at scale, temporal chains, non-fact contamination, entity resolution, salience
calibration, robustness, and the headline metric — advisory context recall.

## Layout

```
cortex_eval/
├── harness/
│   ├── runner.py        # entrypoint: multi-run, fresh/cumulative, report
│   ├── client.py        # sidecar HTTP client
│   ├── assertions.py    # 8 assertion types (incl. cypher + LLM judge)
│   ├── judge.py         # context-recall judge (use a STRONG model)
│   └── generator.py     # seeded distractor corpus w/ near-miss collisions
├── scenarios/
│   ├── 10_interference_scale.json    # precision@5 at 50 & 150 distractors
│   ├── 20_temporal_chains.json       # 3→5→4→7 devs; invalid_at proofs
│   ├── 30_non_facts.json             # hypotheticals/retractions/negations
│   ├── 40_entity_resolution.json     # 5 aliases→1 node; 2 Sarahs→2 nodes
│   ├── 50_salience_calibration.json  # hand-labeled tiers; variance via runs
│   ├── 70_robustness.json            # injection-as-content, long msg, unicode
│   └── 80_advisory_judge.json        # context recall on advisory questions
├── chaos.sh             # kill -9 persistence, concurrency, engine outage
└── sidecar_patch/       # /debug/cypher endpoint + pending-queue dedup fix
```

## Setup

1. Apply `sidecar_patch/README.md` — Patch 1 (/debug/cypher) is required for
   the graph-level assertions; Patch 2 (queue dedup) fixes the 41-pending
   finding and is measured by this suite.
2. Copy this directory next to your sidecar, e.g. `plugins/cortex/cortex_eval/`.
3. Start the sidecar: `CORTEX_DEBUG=1 python -m sidecar.run --port 9199`
4. `export OPENAI_API_KEY=sk-...`

## Run

```bash
cd cortex_eval

# Full suite, isolated graphs, 3 runs (pass-rate mode):
python -m harness.runner --model gpt-5.4-mini --judge-model gpt-5.4 --runs 3

# Cumulative mode — one growing graph across all scenarios. Strictly harder,
# closer to production. Run AFTER fresh mode passes:
python -m harness.runner --mode cumulative --runs 3

# One scenario while iterating:
python -m harness.runner --only 30_non_facts --runs 3

# Process-level chaos (separate, manages its own sidecar):
chmod +x chaos.sh && ./chaos.sh all && ./chaos.sh engine
```

WARNING: `--clear` semantics — fresh mode wipes the graph AND profile before
every scenario. Never point this at a graph you care about; use a throwaway
data dir (`~/.iimagine/memory`) or export first.

## Cost & time

The interference scenario ingests ~155 episodes per run; at 3 runs that's
~470 extraction calls plus salience passes — roughly $1-3 with a mini-class
model and 30-60 minutes wall-clock (ingestion is the bottleneck). Use
`--only` + `--runs 1` while iterating; save full 3-run suites for milestones.

## Reading results

- **Pass-rate per assertion, not pass/fail.** Extraction is stochastic; a
  67% assertion is flaky (a prompt/model weakness), 0% is broken (a code bug).
- **SKIP ≠ pass.** Skipped rows mean /debug/cypher isn't patched in — the
  bi-temporal proofs aren't running at all.
- **Expect 30_non_facts to score worst.** Contamination (hypotheticals,
  assistant speculation, retractions) is where extraction pipelines quietly
  poison themselves — failures here are your highest-value fixes, likely via
  extraction-prompt guidance ("do not extract hypotheticals, questions, or
  the assistant's suggestions as facts") rather than code.

## The regression dashboard — four numbers to track per commit/model change

1. **Interference precision@5** at the 150-episode checkpoint (scenario 10)
2. **Temporal-chain accuracy** incl. the invalid_at Cypher proofs (scenario 20)
3. **Contamination rate** = 1 - pass-rate on scenario 30
4. **Advisory context recall** (scenario 80) — the headline product metric

When all four hold across fresh AND cumulative modes at 3 runs, claims about
memory quality are backed by instruments, not vibes. Re-run on every
extraction-model change, prompt edit, rerank-weight tweak, and graphiti-core
upgrade — that's what the suite is for.
