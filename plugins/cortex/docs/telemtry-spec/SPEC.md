# Cortex Dogfooding Telemetry — Specification v1

**Purpose:** Measure whether Cortex delivers high-quality advisory context in
real usage — accurate recall, correct handling of time (no superseded values),
and priority/goal awareness — without putting a judge on the hot path.

**Design principle (inherited from the eval program):** three cost tiers.
(a) universal logging: free, every exchange. (b) automatic proxy signals:
cheap local math, every exchange, async. (c) judged audit: expensive,
weekly, sampled — the production twin of scenario 80's context-recall metric,
using the same judge.

---

## 1. Event log

**File:** `~/.iimagine/memory/telemetry/events-YYYY-Www.jsonl` (ISO-week
rotation). One JSON object per line. Written by a single append-only writer
(`telemetry.log_event`) — never blocks the request path.

**Correlation:** the Electron plugin generates an `exchange_id` (uuid) per
user message and passes it to `/retrieve`, `/extract`, and `/log/response`.
Everything about one exchange joins on that id.

**Event types & payloads:**

| type | when | payload (beyond ts/exchange_id/session_id) |
|---|---|---|
| `retrieve` | every /retrieve | query, facts_used, briefs_included, brief_modules, profile_included, tokens {facts, profile, briefs, always_on_facts, pinned_facts}, latency_ms, scoped |
| `extract` | every /extract | entities, edges, scored_edges, profile_updates, modules_updated, error (null/str), latency_ms |
| `response` | plugin posts assistant reply | response_len, question_count |
| `redundant_question` | signal fired | question, matched_fact, similarity |
| `correction` | signal fired | pattern, user_message_head |
| `miss` | user runs /memory miss | note, snapshot flagged |
| `contradiction` / `contradiction_resolved` | fact conflict lifecycle | fact_key, resolution |
| `digest` | approve/reject/stale on pending updates | action, tier, section |
| `queue_snapshot` | after each extract | pending_count |
| `audit` | weekly audit per sample | judged fields (see §4) |

**Context snapshots:** the full assembled context per retrieve is written to
`telemetry/contexts/<exchange_id>.txt`. Without the snapshot, no failure is
auditable later ("retrieved-and-ignored vs never-retrieved" is unanswerable
from counters). Pruned after 30 days EXCEPT flagged exchanges (misses,
signal hits, audited samples), which are kept indefinitely — they are the
failure journal's evidence and future eval scenarios.

---

## 2. Automatic proxy signals (signals.py — async, post-response)

**Redundant-question detector** — the product claim ("never asks 'remind me
what your MRR is?'") made measurable. If the assistant's reply contains
questions: embed each (local nomic, query prefix), search the graph, embed
the top returned facts, cosine locally. similarity ≥ 0.75 against a VALID
fact → the AI asked for something memory already knew → `redundant_question`
event + snapshot flag. Limits: max 2 questions checked per response,
questions under 15 chars skipped (rhetorical). Cost: a few local embed
calls, off the hot path.

**Correction detector** — user message matches "I already told you / as I
said / I('ve) mentioned / we already discussed / no, it's actually / that's
not what I said" (case-insensitive pattern list, tuned during calibration)
→ `correction` event + flag. Pattern-only by design: cheap, slightly noisy,
and the weekly audit adjudicates flagged cases. Silent recall failures are
the ones users feel most; this catches the vocalized subset.

---

## 3. Failure journal

`/memory miss` (slash command or thumbs-down) → `POST /memory-miss {note}` →
`miss` event, snapshot flagged permanent, entry visible on the dashboard
failures panel. **Each journal entry is a future eval assertion**: real
misses harvested from real usage become scenario-90 cases. Keep it to two
keystrokes — the failure mode of dogfooding is noticing and not recording.

---

## 4. Weekly judged audit (audit.py)

Samples ~20 `retrieve` exchanges from the trailing 7 days (stratified:
oversample briefs_included>0 and longer queries; always include every
signal-flagged and miss-flagged exchange — those are adjudicated, not
sampled). For each: logged query + context snapshot + response → judge model
(gpt-5.4 class) → strict JSON:

```json
{
  "context_sufficient": true,        // could a competent advisor answer well from this context?
  "missing": ["..."],                // what needed info was absent (if any)
  "superseded_value_cited": false,   // does the RESPONSE state a value the context marks [superseded] or contradicts?
  "goal_relevant": true,             // does the query touch a tracked goal/objective?
  "priority_deadline_present": true, // if goal_relevant: are the goal's priority AND deadline in context? else null
  "notes": "..."
}
```

Aggregated into the weekly KPI record (`kpi_history.json`). Cost: ~20 judge
calls/week ≈ well under $1. CLI: `python -m sidecar.audit --sample 20`
(cron/launchd weekly, or run by hand Sunday night).

---

## 5. KPIs (targets seeded from eval baselines; finalize after 2 calibration weeks)

| # | KPI | Goal dimension | Source | Target |
|---|---|---|---|---|
| 1 | Live context recall (% context_sufficient) | accurate recall | audit | ≥85% |
| 2 | Redundant-question rate /100 exchanges | recall failure | auto | <2 |
| 3 | Correction rate /100 exchanges | silent recall failure | auto | <3 |
| 4 | Miss journal entries /week | felt failures | journal | trend ↓ |
| 5 | Superseded-value citation rate | **time** understanding | audit | ~0 |
| 6 | Priority+deadline present on goal-relevant queries | **priority** understanding | audit | ≥80% |
| 7 | Brief match count on goal-relevant queries | goal awareness | auto+audit | ≥80% |
| 8 | Retrieval latency p95 | responsiveness | auto | <500ms |
| 9 | Extraction failure rate | pipeline health | auto | <1% |
| 10 | Salience coverage (scored/created edges) | pipeline health | auto | >95% |
| 11 | Queue growth /week + digest engagement (approve:reject:ignore) | curation contract | auto | ignore-share not rising |
| 12 | Contradiction backlog (open flags, oldest age) | Facts layer health | auto | oldest <14 days |

**Rules carried over from the eval program:** KPI definitions are versioned;
targets never move toward the data; weeks 1–2 are calibration (real usage ≠
scenario distribution) and get annotated as such in kpi_history.

---

## 6. Dashboard

`GET /metrics` (rolling 7-day KPIs), `GET /metrics/history` (weekly records),
`GET /metrics/failures` (recent misses + signal hits with snapshot links).
Rendered by `dashboard/dashboard.html` — a self-contained page (no external
deps) that fetches the three endpoints from the local sidecar; embeddable in
the My Data tab or opened standalone. Layout: KPI cards (value, target,
red/amber/green, 8-week inline-SVG sparkline) + a failures panel, because
for a single-user dogfood the list of specific misses is more actionable
than any aggregate.

---

## 7. Retention & cost

Events: kilobytes/day, kept indefinitely (rotated weekly files). Snapshots:
the only real disk user; 30-day prune except flagged. Audit: <$1/week.
Hot-path overhead: one file append per endpoint call (~µs) — signals and
audits are entirely async/offline.
