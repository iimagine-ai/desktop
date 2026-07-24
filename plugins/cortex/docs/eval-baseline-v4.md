# Cortex Eval — Baseline v4

**Date:** 2026-07-12  
**Suite version:** v2 (recalibrated bands, loosened injection assertion, redesigned temporal assertion)  
**Model:** gpt-5.4-mini (extraction) / gpt-5.4 (judge)  
**Mode:** fresh (isolated graph per scenario)  
**Runs:** 3  
**Runtime:** ~45 minutes (scenarios run sequentially with sidecar restart between each)

---

## Dashboard (means at n=3, with range)

| Metric | Mean | Range | Target | Status |
|--------|------|-------|--------|--------|
| Contamination rate (30) | **3%** | [0%-33%] | <10% | ✓ MET |
| Entity resolution (40) | **81%** | [0%-100%] | 80%+ | ✓ MET |
| Salience calibration (50) | **85%** | [0%-100%] | 80%+ | ✓ MET |
| Robustness (70) | **83%** | [0%-100%] | 80%+ | ✓ MET |
| Temporal-chain accuracy (20) | **72%** | [0%-100%] | 90%+ | not met |
| Advisory context recall (80) | **33%** | [0%-67%] | 90%+ | not met |
| Interference precision@5 (10) | — | — | 80%+ | not run (semaphore validation pending) |
| Persistence (kill -9) | PASS | — | pass | ✓ |
| Concurrency (parallel writes) | PASS | — | pass | ✓ |

**5 of 7 metrics meet target at n=3 mean.** Two remain below target.

---

## Per-Scenario Detail

### Scenario 20: Temporal Chains — mean 72%

| Assertion | Rate | Notes |
|-----------|------|-------|
| old headcount edges have invalid_at set | 100% | bi-temporal proof solid |
| stale headcount suppressed below rank 1 | 100% | invalid_at penalty working |
| current runway (10 months) top answer | 100% | |
| current headcount (7) top answer | 67% | flaky — model sometimes extracts "7 total" without "developer" substring |
| exactly one valid headcount fact | 67% | depends on Graphiti's invalidation timing |
| history question recall | 0% | retrieval never surfaces full transition trajectory |

**Diagnosis:** Bi-temporal mechanics work (100% on the proofs). The headcount flakiness is extraction variance on the substring match. History recall is a structural gap — the retrieval budget is spent before trajectory facts surface.

### Scenario 30: Non-Facts — mean 97%

| Assertion | Rate | Notes |
|-----------|------|-------|
| 9 of 10 assertions | 100% | zero contamination on all key cases |
| $180k invalidation | 67% | Graphiti's temporal invalidation fires 2/3 runs |

**Diagnosis:** Contamination solved. The one flaky assertion (67%) is Graphiti's invalidation timing — the retraction arrives fast enough that the original sometimes isn't invalidated (it's just outranked). Not a contamination issue.

### Scenario 40: Entity Resolution — mean 81%

| Assertion | Rate | Notes |
|-----------|------|-------|
| one Sarah Chen node | 100% | |
| alias convergence | 100% | |
| CTO role is top answer | 100% | guard carve-out confirmed |
| two Sarahs distinct | 100% | |
| rename links names | 100% | |
| accountant isolation | 67% | flaky — cross-contamination on 1/3 runs |
| duplicate node check | 0% | known Graphiti edge case (role update creates new node) |

**Diagnosis:** CTO extraction fully recovered via the carve-out. The duplicate-node issue is a Graphiti resolution behavior, not sidecar code.

### Scenario 50: Salience — mean 85%

| Assertion | Rate | Notes |
|-----------|------|-------|
| 7 of 9 assertions | 100% | scoring accurate across tiers |
| strategic pivot | 67% | scored HIGH 2/3 runs, missed 1 (extraction variance) |
| positioning NOT a decision | 0% | model consistently scores this 0.8+ (HIGH not MEDIUM) |

**Diagnosis:** The "positioning" assertion is a calibration disagreement — the model considers market positioning strategically important. This is a test-boundary issue, not a code bug. Consider widening the band or reclassifying.

### Scenario 70: Robustness — mean 83%

| Assertion | Rate | Notes |
|-----------|------|-------|
| 5 of 6 assertions | 100% | injection safe, unicode works, long messages survive |
| SYSTEM directive salience | 0% | SLA fact consistently scores 0.7+ (HIGH not MEDIUM) |

**Diagnosis:** Same pattern as scenario 50 — the model considers "SLA is 24 hours" a commitment (HIGH). This is a calibration boundary, not a salience bug.

### Scenario 80: Advisory Recall — mean 33%

| Assertion | Rate | Notes |
|-----------|------|-------|
| workload/lifestyle | 67% | carve-out works 2/3 runs |
| distributor-deal | 33% | missing the precedent OR the revenue figure on 2/3 runs |
| financing/zero-debt | 33% | the preference IS extracted but not always retrieved |
| new-product/capacity | 0% | "team is small" / "at capacity" never retrieved together |

**Diagnosis:** This is the honest number. Advisory recall at 33% mean tells you the retrieval layer loses specific facts in a 7-message graph — not interference, just ranking. The MMR diversity fix helps (proven in the run where distributor passed) but doesn't cure it. The remaining gap is between "fact exists in graph" and "fact scores high enough in top-30 to make token budget." Next lever: increase RETRIEVAL_CANDIDATES from 30 → 50, or implement a two-pass retrieval (broad semantic → focused re-query on missing categories).

---

## Suite Integrity Notes

- **No "best-of-n" in this report.** All numbers are mean pass-rate across 3 runs.
- **Suite v2 recalibrations from session 3:** `medium_or_high` tier band for objectives, `salience_tier_or_absent` for filtered small talk, `search_contains_or_absent` for injection, scenario 20 redesigned to test "stale suppressed" not "stale absent."
- **Immutable baseline:** This report is the v4 baseline. Future changes state "Δ vs v4" with the suite version pinned.

---

## Architecture Summary (fixes in place at v4)

1. **Extraction:** User-only episode body (assistant ack only if ≤60 chars, non-speculative). Guard with carve-out for preferences/role changes.
2. **Salience:** Sidecar-owned scores in salience.json, surfaced by /search. Batch scoring (max 10/call), reconcile sweep, retry on parse failure.
3. **Reranker:** Relevance 0.5 + recency 0.25 + salience 0.25, with invalid_at penalty (0.15x) and [superseded] annotation.
4. **Context assembly:** MMR diversity (skip facts >0.85 cosine similarity to already-selected, after top-3).
5. **Profile routing:** Queue floor at salience 0.5 (0.3-0.5 = graph-only zone).
6. **Embedding:** Global semaphore (2 permits) preventing engine overload. Retry with backoff.
7. **Storage:** FalkorDB Lite confirmed stable + persistent (chaos tests pass).

---

## Post-Baseline Diagnosis

> Written after initial analysis of v4 results. This reframes the 33% advisory recall and charts the v5 sequence.

### The 33% is measuring the product with its second layer disconnected

The three-layer retrieval plan is: **profile doc** (current strategic picture, always injected in full) → **retrieved temporal facts** → **conversation context**. The zero-debt preference, the capacity constraint, the 500-customer objective — those are exactly the facts the profile exists to guarantee so that retrieval never has to get lucky on them.

But in the eval, those facts route to the pending queue as MEDIUM/HIGH — and nothing ever approves them. HIGH never auto-applies (by design, FIX #4), fresh mode clears state, no human clicks approve. So `/retrieve` runs with an empty profile and retrieval alone must carry everything — which is precisely the failure mode the profile was designed to prevent.

**Fix:** Add an `approve_pending` step to the harness (loop `/pending-updates` → `/approve`) placed after ingestion in scenario 80. This simulates the user doing their digest review, which is the honest production condition. Expected: a large jump on the headline metric. Remaining misses after that are the true retrieval gaps.

### The candidates 30→50 lever can't work here

Scenario 80's graph is ~7 exchanges ≈ 15–25 edges total. `num_results=30` already returns every edge in the graph; raising to 50 returns the same set. Token budget isn't the constraint either: ~20 facts × ~20 tokens ≈ 400 tokens against a 1500 budget with an empty profile.

If a fact "exists in graph but isn't retrieved," it's being lost at one of exactly three places. Instrument the funnel rather than guess — for each failed judge assertion, log:

1. **(a) Fact in graph?** — direct search
2. **(b) Returned by graphiti.search for this query?** — semantic ranking
3. **(c) Survived MMR?** — the 0.85-cosine skip is a prime suspect for "team is small" being deduped against another IIMAGINE fact
4. **(d) In final context?** — assembly stage
5. **(e) Judge still said missing?** — judge error

Five checkpoints, one afternoon, and every future retrieval fix targets a named stage instead of a hunch.

**Bet:** Losses split between **(b)** — Graphiti's semantic search not ranking "engineering at capacity" for "should I launch an invoicing tool" — and **(c)** MMR over-pruning in tiny graphs. Consider disabling MMR when candidate count < 15; diversity pruning only makes sense when there's redundancy to prune.

### Calibration disagreements (scenarios 50 + 70)

The two 0% assertions (positioning, SLA) should be fixed in the **scoring prompt**, not the tests. The rubric is ours — add few-shot anchors to `SCORING_PROMPT`:

- "Market positioning/branding statements: 0.5–0.7"
- "Standing operational commitments like SLAs: 0.5–0.7 unless newly decided this conversation"

Keep the hand labels as ground truth. If the model still disagrees after explicit anchors, then reclassify.

### Temporal history (scenario 20, 0%)

Endorse the history-mode idea. Simplest version is query-side: when the query matches `change/evolution/history/since`, drop the `invalid_at` penalty, include superseded edges with their annotations, and order chronologically. That's the `[superseded]` machinery finally paying off — converts scenario 20's structural failure into a routing branch.

### Sidecar restart note

The "sidecar restart between each scenario" needs an explanation before v5. If restarts are required for stability, there's a leak or resource exhaustion hiding (engine contention residue? redislite file handles?), and production sidecars run for weeks. Either diagnose it or document why it's an eval-only convenience.

### Scenario 10 at n=3

Still the open flank. Baseline v4 isn't complete until the scale test runs under the semaphore. If it survives 155 episodes ×3, that also answers the restart question empirically.

---

## V5 Sequence (priority order)

1. ✅ **approve_pending harness step** → rerun 80 n=3 — **+42pp (33% → 75%)**
2. **Funnel instrumentation** → fix the named stage → rerun 80
3. **Salience prompt anchors** → rerun 50/70 n=3
4. **History-mode branch** → rerun 20 n=3
5. **Scenario 10 ×3 under semaphore**
6. **Full fresh baseline v5** — then cumulative

---

## V5 Step 1 Results: approve_pending (2026-07-12)

**Change:** Added `approve_pending` step to scenario 80 harness (after `reflect`, before assertions). This simulates the user's digest review — approving all HIGH/MEDIUM pending profile updates so the profile layer is populated before retrieval.

**Result: 75% overall (9/12 assertion-runs)** — up from 33% in baseline v4.

| Assertion | v4 Rate | v5-step1 Rate | Detail |
|-----------|---------|---------------|--------|
| distributor-deal | 33% | **100%** | profile now carries the precedent + preference |
| financing/zero-debt | 33% | **67%** | fails 1/3: "Current runway position (about 14 months)" missing from retrieval |
| new-product/capacity | 0% | **33%** | fails 2/3: "The team is small (about 7 people)" never retrieved |
| workload/lifestyle | 67% | **100%** | profile carries the lifestyle preference reliably |

**Diagnosis confirmed:** The 33% was the product running with its profile layer disconnected. With the profile populated, advisory recall jumps to 75% — 2 of 4 assertions now at 100%.

**Remaining retrieval gaps (v5 step 2 targets):**

1. **"The team is small (about 7 people)"** — consistently missing from retrieval context. Prime MMR over-pruning suspect: this fact likely dedupes against other IIMAGINE entity facts at >0.85 cosine. Fix: disable MMR when candidate count < 15, or lower the cosine threshold.

2. **"Current runway position (about 14 months)"** — intermittently missing (1/3 runs). The profile should carry this (it's HIGH salience). Possible cause: profile section overflow during consolidation, or the judge is strict on phrasing variance ("14 months" vs "runway 14 months").

**Next:** Instrument the 5-checkpoint funnel on the two failing facts to identify whether loss is at stage (b) semantic search, (c) MMR, or (d) assembly.

---

## V5 Step 2 Results: Profile Layer Fixes + Extraction Anchor (2026-07-12)

**Suite version: v3** — assertions restored to v2 originals (strict), with headcount probe added as non-graded informational. Decision-anchor added to extraction instructions.

**Code changes applied:**

1. **Removed `key_facts[-5:]` hard cap** — was silently dropping the oldest (most strategic) facts from each section. The first facts ingested are often the foundational ones (runway, team size, zero-debt) and the arbitrary last-5 window pushed them off.

2. **Priority-based truncation order** — when profile exceeds token budget, drop low-value sections first (segments, products, skills) before touching high-advisory-value sections (constraints, preferences, objectives).

3. **Increased PROFILE_BUDGET_RATIO from 0.3 → 0.4** — the profile is the guaranteed strategic layer; it deserves 40% of the token budget, not 30%.

4. **Extraction decision-anchor** — added to CUSTOM_EXTRACTION_INSTRUCTIONS: "When the user reports evaluating an opportunity, ALWAYS extract one fact stating the outcome ('declined X', 'proceeded with Y') in addition to any reasons." Fix is extraction-side; judge stays pure.

5. **Context dump on judge failure** — assertions now log the full retrieved context on failure, enabling instant stage identification without a separate funnel run.

6. **Headcount probe (non-graded)** — tracks whether "7 people" ever makes context. Confirms the mid-salience gap exists: headcount consistently routes to graph-only zone (0.3–0.5 salience), never reaching profile, and retrieval doesn't surface it either.

### Decomposition: code effect vs test effect

Measured against the **original v2 assertions** (strict wording, headcount required):

| Assertion | v4 (no approve) | Step 1 (approve only) | Step 2 (code fixes) | Detail |
|-----------|-----|--------|--------|--------|
| distributor-deal | 33% | 100% | **100%** | decision-anchor ensures "declined" is extracted atomically |
| financing/zero-debt | 33% | 67% | **100%** | profile carries runway reliably now (no [-5:] eviction) |
| new-product (with headcount) | 0% | 33% | **0%** | "7 people" never in context — confirmed mid-salience gap |
| workload/lifestyle | 67% | 100% | **100%** | profile carries both halves (weekends + slower growth) |

**On strict assertions: 75% (9/12)** — the code fixes took us from 75→75 on a per-headline basis (distributor +33pp, financing +33pp, workload held, new-product dropped back to 0% because headcount is structurally absent).

The honest claim: **three code fixes delivered 100% on 3 of 4 assertions**. The 4th (new-product at 0%) is a known architectural limitation — mid-salience operational figures are guaranteed by neither layer.

### Known limitation: mid-salience operational figures

The headcount probe confirms empirically what the architecture concedes: numeric operational facts (team size, customer count, churn rate, pricing) that score 0.3–0.5 salience live in a no-man's-land — not profile-carried, not reliably retrieved in small graphs.

**Decision required (logged, not resolved):**
- Option A: Salience rubric anchor — "current operational figures (headcount, customer count, pricing) score 0.5–0.7" — pushes them into profile territory.
- Option B: Strengthen mid-band retrieval — cumulative mode will test whether these facts surface when the graph has enough edges for semantic search to rank them.

The headcount probe stays in the suite as a canary — when it starts passing (due to either fix), the dashboard will show it without requiring a target change.

**Production bug found and fixed:** `key_facts[-5:]` truncation was silently dropping foundational strategic facts when sections accumulate >5 entries. This would have manifested at month 2 of real usage as "the system forgot my runway/debt preference" — exactly the kind of failure a user would attribute to the product being broken rather than a display-window bug.

---

## Summary: Advisory Recall Arc (33% → 75% on strict assertions)

| Stage | Metric (strict v2 assertions) | Change |
|-------|------|--------|
| Baseline v4 (empty profile) | 33% | — |
| + approve_pending harness fix | 75% | +42pp (harness artifact corrected) |
| + profile fixes + decision-anchor | 75% | 3/4 assertions at 100%; headcount structurally absent |

The headline: **three of four advisory assertions now pass at 100%** on strict wording. The fourth (headcount) is a known architectural limitation logged with a decision framework, not papered over. The 33→75 was the harness; the code fixes converted two flaky assertions (67%) into deterministic passes (100%) while the decision-anchor resolved the distributor-deal extraction variance.

The instruments caught: the empty-profile harness gap, the `key_facts[-5:]` production bug, the truncation priority inversion, and the mid-salience no-man's-land. All diagnosed via the suite, all fixed at the named layer.

---

## Next Steps (v5 path)

1. **Salience anchors** → "current operational figures (headcount, customer count, pricing): 0.5–0.7" → rerun 50/70/80 n=3. Track queue-growth-per-episode in the same run — if anchor pushes growth above ~0.3/episode, tier-split: pure operational figures auto-apply (LOW-style, factual not judgment), don't retreat on the anchor.
2. **History-mode branch** → rerun 20 n=3
3. **Scenario 10 ×3 under semaphore** + sidecar-restart explanation — the only items between "baseline" and "baseline, complete"
4. **Full fresh baseline v5** on suite v3 → then cumulative
5. **Lazy-user variant** of scenario 80 (no approvals / HIGH-only) — graceful-degradation datum. Gap between diligent-user and lazy-user recall = measured value of the approval UX.
6. **Porting gate** — once v5 fresh + cumulative lands, the eval suite becomes the acceptance gate for the web/multi-tenant deployment (same scenarios, server-mode stack, per-tenant isolation checks added).

---

## Meta-observation

The pattern of this whole arc is holding: every big "failure" so far — null salience, the guard regression, the crash, now the empty profile — has been the instruments catching a real integration truth one layer down. 33% was the suite refusing to let the demo-quality answer stand.

**Corollary (session 4):** The instruments only keep catching truths one layer down if the instruments themselves stay untouched by the layer they're grading. Guard that boundary. The judge stays pure — no inference hints, no "constraints present = decision made" shortcuts. Extraction-side fixes for extraction gaps. Test wording changes get decomposed and reported separately. The 75% on strict assertions is the kind you can defend; it means "three of four advisory-critical facts are deterministically delivered, and the fourth is a documented architectural gap with a named resolution path."
