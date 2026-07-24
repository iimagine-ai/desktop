# Session 5 Brief — Cortex Eval (Freeze Session)

**Date:** 2026-07-13 (this session completed the code; next session is the freeze run)  
**Status:** All code fixes landed and validated. Ready for freeze run.

---

## What Was Done This Session

1. **Scenario 10 rerun (suite v3.1)** — context-level recall 100%, history-mode 100%, valid_at investigation resolved. Precision@5 pooled ~84% (volatile, profile compensates).
2. **Scenario 40 rerun** — 90%, Graphiti dedup edge case confirmed.
3. **Cumulative mode ×3 (pre-fix)** — 86.4%, cross-residue probes 95%. Profile crowding identified.
4. **Scenario 30 discrepancy resolved** — $180k regression was numeric-anchor side-effect, not model gap. A/B narrowed.
5. **Fix 1: Retraction extraction guidance** — extraction.py + assertion relaxation in 30_non_facts.json
6. **Fix 2: Consolidation-on-approve** — endpoint path, threshold 10→8, DROP_ORDER team promotion, numeric-figure guard in consolidation prompt
7. **Fix 3: Entity dedup sweep** — LLM-assisted merge in reflection.py, plus episode-count trigger every 25 episodes in extraction.py
8. **Fix 4: Summaries-always-rendered** — profile.py get_profile_context now degrades by stripping key_facts before ever dropping a section. Numeric-in-summary guard in consolidation prompt.
9. **Fix 5: Sweep trigger decoupling** — fires every 25 episodes in extraction path, independent of reflection.
10. **Validation:** sc30 fresh 97%, sc80 fresh 100%, cumulative n=1 (sc80 100%, sc99 7/7).

---

## Next Session Plan (THE FREEZE SESSION)

### Orientation

Read these files first:
- `desktop-companion/plugins/cortex/docs/eval-baseline-v5.md` — the living document (observations section has the full plan)
- This file (SESSION-5-BRIEF.md) — context for what was done

### Step 1: Negation Vocabulary Check (~10 min)

The sc30 "negation retains polarity" assertion fails 33-67% of the time. Hypothesis: the model stores correct meaning ("staying bootstrapped", "staying focused on small business") without the keywords the assertion greps for ("not pivoting", "no enterprise", "smb").

**Actions:**
1. Look at fail details in `docs/eval-30-post-fix.json` and `docs/eval-cumulative-rendering-fix.json` — the `fail_details` key shows what was actually in the top-3 results.
2. If the stored facts have correct polarity but different vocabulary → fix the assertion:
   - Option A (quick): widen `any_of` in `tests/30_non_facts.json` to include "bootstrapped", "focused on small business", "staying"
   - Option B (better): convert to `judge_context_recall` assertion type — ask the judge "does the context indicate the company is NOT pivoting to enterprise?"
3. Note as suite v3.2 in the eval doc.
4. Rerun `--only 30 --runs 1 --mode fresh` to confirm the fix passes.

**If stored facts show WRONG polarity** (e.g., "pivoting to enterprise" without negation) → the A/B is still alive. But based on all prior evidence, this won't be the case.

### Step 2: Create Lazy-User Variant (~5 min)

Copy `tests/80_advisory_judge.json` to `tests/81_advisory_lazy.json`. Remove the `approve_pending` step. This tests advisory recall without any approvals (worst-case recall bracket — opposite of approve-all worst-case crowding).

### Step 3: Freeze Validation Run (~3-4 hours wall clock)

Start embedding engine + sidecar, then:

```bash
# Full suite fresh ×3
OPENAI_API_KEY="$(grep '^OPENAI_API_KEY' /Users/adamradly/Documents/iia-28/.env.local | cut -d= -f2-)" \
  .venv/bin/python -m tests.runner \
  --model gpt-5.4-mini --judge-model gpt-5.4 \
  --port 9199 --runs 3 --mode fresh \
  --report docs/eval-v5-final-fresh.json

# Full suite cumulative ×3
OPENAI_API_KEY="$(grep '^OPENAI_API_KEY' /Users/adamradly/Documents/iia-28/.env.local | cut -d= -f2-)" \
  .venv/bin/python -m tests.runner \
  --model gpt-5.4-mini --judge-model gpt-5.4 \
  --port 9199 --runs 3 --mode cumulative \
  --report docs/eval-v5-final-cumulative.json
```

**Starting engines:**
```bash
# Embedding engine
DYLD_LIBRARY_PATH=/Users/adamradly/Documents/iia-28/desktop-companion/bin \
  /Users/adamradly/Documents/iia-28/desktop-companion/bin/iimagine-engine \
  --embedding --model /Users/adamradly/.iimagine/models/nomic-embed-text-v1.5-f16.gguf \
  --port 8847 --host 127.0.0.1 -c 2048

# Sidecar
cd /Users/adamradly/Documents/iia-28/desktop-companion/plugins/cortex
CORTEX_DEBUG=1 OPENAI_API_KEY="$(grep '^OPENAI_API_KEY' /Users/adamradly/Documents/iia-28/.env.local | cut -d= -f2-)" \
  .venv/bin/python -m sidecar.run --port 9199
```

**Clear before each suite:**
```bash
rm -rf ~/.iimagine/memory/graph.db ~/.iimagine/memory/salience.json \
       ~/.iimagine/memory/profile.json ~/.iimagine/memory/pending_updates.json
```

### Step 4: Analyze Results & Write Freeze Document

Expected targets (fresh mode):
- All scenarios ≥80% (most at 97-100%)
- Context recall at scale: 100%
- Cross-residue: ≥95%
- Lazy-user (sc81): note whether advisory recall holds without approvals

Expected cumulative:
- Overall ~85-90% (degradation from fresh is expected and documented)
- sc80 + sc99: should hold at 100% (profile rendering fix)
- sc10 context-recall: may fail (approve-all artifact, annotate)
- sc30 negation/rejection: expected cumulative noise
- sc40 dedup: expected (sweep timing)

**Document the following in the eval-baseline-v5.md freeze section:**
- Fresh ×3 numbers (the headline)
- Cumulative ×3 numbers (the honest stress test)
- Lazy-user result (the approval-UX pricing)
- Annotate approve-all as worst-case, lazy-user as other bracket
- Note A/B skipped with justification

### Step 5: Freeze Artifacts

1. **Tag the repo:** `git tag cortex-eval-v5-final`
2. **Create manifest file** at `desktop-companion/plugins/cortex/MANIFEST.md`:
   ```
   # Cortex Memory v5 — Frozen Baseline
   
   ## Pinned Dependencies
   - graphiti-core: [check version in requirements.txt]
   - Extraction model: gpt-5.4-mini (OpenAI)
   - Judge model: gpt-5.4 (OpenAI)  
   - Embedding: nomic-embed-text-v1.5-f16 (local, llama.cpp)
   - Eval suite: v3.2
   
   ## Extraction Tier
   mini — adequate per v5-final. Revisit if dogfooding reveals gap.
   
   ## Baseline Numbers
   [paste fresh ×3 headline numbers]
   [paste cumulative ×3 headline numbers]
   
   ## CI Expectations
   - Smoke (every merge): --only 30 --only 80, --runs 1, fresh
   - Weekly: full suite, --runs 3, fresh
   - Release candidate: full suite, --runs 3, cumulative
   ```

3. **Archive reports** — the JSON files in docs/ are the archive (eval-v5-final-fresh.json, eval-v5-final-cumulative.json)

4. **CI wiring** — if CI exists, add the smoke command. Otherwise document it in the manifest for when CI is set up.

5. **Production telemetry spec** — add to manifest:
   ```
   ## Production Telemetry (calibrate during dogfooding)
   - Extraction failure rate (target: <1%)
   - Salience-null rate (target: <5%)
   - Profile coverage: facts per section
   - Queue growth: pending updates per user per week
   - Retrieval latency p95 (target: <500ms)
   ```

---

## Key Context for the Agent

- The eval doc is at `desktop-companion/plugins/cortex/docs/eval-baseline-v5.md` (279 lines)
- Test fixtures are in `desktop-companion/plugins/cortex/tests/*.json`
- Sidecar code is in `desktop-companion/plugins/cortex/sidecar/`
- All JSON reports are in `desktop-companion/plugins/cortex/docs/eval-*.json`
- The negation assertion is in `tests/30_non_facts.json`, last step — `any_of: ["not pivoting", "no enterprise", "staying focused on small business", "smb"]`
- The approve_pending step in sc80 is just: `{"step": "approve_pending"}`
- Suite version bumps are noted in the eval doc preamble

## Decision Rules

- If negation vocabulary check confirms correct polarity → fix assertion, skip A/B, write "extraction tier: mini" in manifest
- If negation shows wrong polarity → run `--only 30 --mode cumulative --runs 1` with gpt-5.4 full before the freeze run (the narrowed A/B)
- If freeze run has any scenario below 80% fresh → investigate before tagging (it's a regression)
- If cumulative crowding causes sc80 to fail → check context dumps for over-merge (the consolidation-prompt guard should prevent this)
- Don't add a third approval variant — two brackets + annotation is sufficient
