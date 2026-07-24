# Cortex Memory Plugin

Cortex is the persistent memory system for the IIMAGINE Desktop companion. It gives the AI a temporal knowledge graph that remembers everything the user shares across conversations — facts, preferences, decisions, goals, constraints, team details — and surfaces the right context at the right time without the user needing to repeat themselves.

## What It Does

Every conversation exchange passes through two pipelines:

1. **Extraction** (post-chat) — An LLM identifies entities, relationships, and facts from what the user said. These are stored as typed nodes and edges in a knowledge graph. Speculative content from the assistant is filtered out; only user-asserted ground truth is persisted.

2. **Retrieval** (pre-chat) — Before the AI responds, Cortex searches the graph for relevant context, assembles a profile document and goal briefs, reranks by relevance × recency × salience, and injects it into the system prompt. The AI sees the user's full history without the user lifting a finger.

The result: an AI that knows the user's business, remembers decisions made months ago, tracks goals over time, and never asks "remind me what your MRR is?"

---

## Facts (User-Declared Ground Truth)

Facts are the highest-authority layer in Cortex. They represent things the user has explicitly declared as true — the AI will never override them from conversation.

### Authority Spectrum

```
Facts (user-declared axioms — AI never touches)
  → Objectives (user-declared goals, AI updates progress fields)
    → Profile (AI-proposed, user-approved)
      → Memory (AI-inferred, reranked from conversation)
```

Each layer trades automation for authority. The AI manages memory automatically; it proposes profile updates for review; it updates objective progress but not deadlines; it never modifies Facts.

### Two Tiers

**Always included** (~10-15% of context budget):
- Sent to the AI with every message, unconditionally
- Identity-level: name, birth year, location, company, core product, target market, USP
- Stable phrasings encouraged ("born 1992" not "age 34", "founded 2019" not "5 years old")
- UI shows approximate budget usage as facts are added

**Include when relevant** (unlimited, semantically matched):
- Each fact is embedded on save (same nomic model as all other embeddings)
- At retrieval time: cosine similarity against the user's query → top 5-10 matches included
- Best-effort by design — truly critical facts belong in always-on
- Zero cost when not relevant (floats in an array, not text in a prompt)

### Contradiction Detection

When the user says something in chat that contradicts a Fact:

1. Post-extraction: each new fact's embedding is compared against the Facts index (sub-millisecond local math, no LLM)
2. High similarity hit → LLM confirms conflict (~100 tokens, async)
3. **Inline delivery** (mid-conversation): AI mentions it once — "Quick flag: you mentioned X, but your Facts list Y. I'll keep using your Facts until you update them — want me to change it?"
4. Never repeats. One flag per contradiction, then silence until resolved.
5. **Digest delivery** (detected async): appears in pending updates with [Update] [Keep current] [Remove] buttons

The Fact stays authoritative until the user explicitly changes it. Chat-derived data never silently overrides a Fact.

### Staleness Sweep

Facts containing numbers or dates that haven't been confirmed in 6+ months get a low-friction "still true?" prompt in the digest. The AI never edits Facts, and the system never lets Facts rot silently — both commitments are maintained simultaneously.

### Deduplication

At context assembly time, profile/memory lines that duplicate an already-injected Fact are skipped (cosine similarity check). Prevents "7 employees" appearing from both Facts and the AI-managed profile.

### Advisory Prompt

Every retrieval context includes: "User-declared Facts are authoritative. Where memory conflicts with a Fact, the Fact wins. Do not assert a contradicting value back to the user."

### Storage

- `~/.iimagine/memory/facts.json` — the facts themselves
- `~/.iimagine/memory/fact_contradictions.json` — active contradiction flags
- `~/.iimagine/memory/fact_staleness.json` — staleness sweep state
- NOT stored in the graph. Not subject to extraction, consolidation, or reflection.

---

## Architecture

### Stack

| Component | Technology | Role |
|-----------|-----------|------|
| Plugin shell | Node.js (Electron plugin) | Hooks into chatPreprocess/chatPostprocess |
| Sidecar | Python FastAPI | Runs the extraction, retrieval, and reflection pipelines |
| Knowledge graph | [Zep Graphiti](https://github.com/getzep/graphiti) (graphiti-core 0.5.1) | Temporal knowledge graph with entity resolution, bi-temporal edges |
| Graph storage | [FalkorDB Lite](https://github.com/FalkorDB/FalkorDB) (embedded, via falkordblite) | Persistent graph database — no external server required |
| Embeddings | nomic-embed-text-v1.5-f16 (local, llama.cpp) | Semantic search with Nomic's prefix-aware embedding |
| Extraction model | gpt-5.4-mini (OpenAI) | Structured entity/relationship extraction |
| Judge model | gpt-5.4 (OpenAI) | Eval suite assertions and salience calibration |

### How Zep/Graphiti Fits

Graphiti (by Zep) is the engine that handles the hard graph operations:

- **Entity resolution** — "Sarah" and "Sarah Chen" get merged into one node
- **Temporal invalidation** — when facts change ("MRR is now $85k"), the old edge gets `invalid_at` set and a new one is created, preserving history
- **Hybrid search** — semantic vector similarity + keyword match + graph traversal, fused via Reciprocal Rank Fusion (RRF)
- **Episode ingestion** — `add_episode()` handles the full pipeline: LLM extraction → entity resolution → graph storage → embedding

FalkorDB Lite is the embedded graph database that Graphiti persists to. It's a Redis-protocol graph DB compiled to run as a library (no server process). Data lives in a single file at `~/.iimagine/memory/graph.db`.

### Adapter Architecture (Ports & Adapters)

Cortex isolates all Graphiti/FalkorDB imports behind an adapter layer:

```
Your code (ports.py interface)
    └── adapters/graphiti_adapter.py  ← ONLY file that imports graphiti_core
```

- `sidecar/ports.py` — defines `GraphPort` protocol with typed methods
- `sidecar/adapters/graphiti_adapter.py` — implements GraphPort using graphiti-core
- Schema, ontology, and extraction prompts are adapter construction config (not port args)
- Raw episodes are the source of truth; the graph is a derived, rebuildable index

This means upgrading graphiti-core or swapping engines only touches one file. The eval suite gates every upgrade: bump on a branch, run the suite, merge on green.

### Workflow for Ongoing Updates

**Upgrading graphiti-core:**
1. Bump version in `requirements.txt` on a branch
2. Run eval: `--runs 1 --mode fresh --only 30 --only 80` (smoke)
3. If green → full suite: `--runs 3 --mode fresh`
4. Compare numbers to v5-final baseline
5. Any movement = investigate before merge

**Adding features:**
- New extraction anchors → update `CUSTOM_EXTRACTION_INSTRUCTIONS` in `adapters/graphiti_adapter.py`
- New retrieval behavior → modify `main.py` (uses adapter's typed methods, no raw Cypher)
- New graph queries → add typed method to `ports.py` + implement in adapter

**Pinning:**
- `graphiti-core[falkordblite]==0.5.1` (exact pin)
- Full lockfile (pip freeze) belongs in frozen manifest
- Transitive deps matter — the redislite driver episode proved this

---

## SCOPED Objectives Framework

Cortex tracks user goals as first-class objects called **Modules**. Each module has a SCOPED structure:

| Letter | Field | Purpose |
|--------|-------|---------|
| **S** | Status | Current progress metrics (auto-updated from extraction) |
| **C** | Challenges | Blockers and obstacles mentioned in conversation |
| **O** | Objective | The goal itself + measurable target |
| **P** | Priority | 1-10 scale (declared or inferred) |
| **E** | Enablers | Resources, skills, partnerships that help |
| **D** | Deadline | Target date (if any) |

### How Modules Work

1. **Auto-detection** — When the user states a new goal in conversation, extraction identifies the Objective entity and auto-creates a module
2. **Fact routing** — Subsequent facts get matched to modules by embedding similarity + keyword overlap. Status updates auto-apply; challenges/enablers queue for review; deadline/priority changes require approval
3. **Brief compilation** — At retrieval time, matched modules compile into per-goal advisory briefs that frame the AI's response:

```
[Goal Brief: Reach 500 paying customers]
Priority: 8/10 | Deadline: 2026-09-30 (11 weeks away)
Objective: 500 paying customers
Status: 340 customers (as of 2026-07-10)
Gap: 160 to target in 11 weeks (~15/week needed)
Challenges: Engineering capacity at limit; onboarding takes 2 weeks
Enablers: Partnership with XYZ; new sales hire starting Aug 1
[End Goal Brief]
```

The SCOPED symmetry does the advisory work: Status↔Objective = gap analysis, Challenges↔Enablers = feasibility ledger, Priority↔Deadline = urgency triage.

### The Bracket Inversion (Key Finding)

The eval proved that users who selectively approve profile facts get better results than those who approve everything. Approve-all floods the profile with distractors that crowd out critical facts. The profile's value is curation, not volume. This drives three UX decisions:
- No "approve all" button in the digest
- Unreviewed MEDIUMs expire rather than auto-apply
- The approval flow is framed as a quality mechanism, not admin homework

---

## Eval Results (Frozen 2026-07-14)

Full eval documentation: [eval-baseline-v5.md](./eval-baseline-v5.md)

### Fresh Mode (×3 runs, isolated graph per scenario)

| Scenario | Pass Rate | Target | Status |
|----------|-----------|--------|--------|
| 10: Interference at scale (precision@5) | 83.3% | 80% | ✓ MET |
| 20: Temporal chains | 88.9% | 90% | ⚠ MARGINAL |
| 30: Non-facts / contamination | 96.7% | 90% | ✓ MET |
| 40: Entity resolution | 85.7% | 80% | ✓ MET |
| 50: Salience calibration | 100.0% | 80% | ✓ MET |
| 70: Robustness | 100.0% | 80% | ✓ MET |
| 80: Advisory recall (approve-all) | 100.0% | 90% | ✓ MET |
| 81: Advisory recall (lazy/no-approvals) | 75.0% | — | NOTED |

### Cumulative Mode (×3 runs, shared growing graph ~600+ episodes)

| Scenario | Pass Rate | Notes |
|----------|-----------|-------|
| 10: Precision@5 | 87.5% | Actually higher than fresh (variance) |
| 20: Temporal chains | 100.0% | |
| 30: Non-facts | 83.3% | Venture-debt distractor outranks in shared graph |
| 40: Entity resolution | 85.7% | |
| 50: Salience | 92.9% | |
| 70: Robustness | 61.1% | Accepted — retrieval precision at scale, not robustness gap |
| 80: Advisory (approve-all) | 75.0% | Crowding from approve-all pattern |
| 81: Advisory (lazy) | **91.7%** | Better than approve-all — the bracket inversion |
| 99: Cross-residue | 95.2% | No cross-scenario contamination |

### Key Takeaways

- Context-level recall (the product metric): **100%** in the non-crowded path — the profile guarantees delivery regardless of search rank volatility
- Security properties (injection containment, profile protection): **100%** in all modes
- Stability: 1,800+ episodes across the session with zero crashes; p50 latency 83ms, p95 125ms
- The architecture compensates for stochastic search variance via the profile layer — that's the design working, not a weakness

---

## Platform Support

### macOS (Current — Full Support)

The full stack runs natively:
- FalkorDB Lite compiles cleanly for macOS (arm64 + x86_64)
- The Python sidecar runs in a bundled venv
- The llama.cpp embedding engine runs as a child process with Metal acceleration
- All data stored locally at `~/.iimagine/memory/`

### Windows (Planned — Not Yet Validated)

The Electron shell, SQLite, llama.cpp, and keytar all have established Windows support. The blocker is the Cortex sidecar:

**Problem:** FalkorDB Lite (`falkordblite` Python package) has immature Windows support. FalkorDB's lineage is Redis-based (Linux/Mac first). Pre-built Windows wheels may not exist, and compilation from source hasn't been tested.

**Planned solution:**
1. Test `falkordblite` wheel availability on Windows (pip install in a Windows VM)
2. If it works → ship as-is with PyInstaller-frozen sidecar
3. If it doesn't → either:
   - Get upstream to add Windows CI (contribute or request)
   - PyInstaller-freeze the entire sidecar into a standalone `.exe` with the compiled FalkorDB embedded
   - Worst case: fall back to a simpler graph storage layer (e.g., NetworkX + SQLite for graph ops) on Windows only, behind the adapter — same port interface, different implementation

The adapter architecture was designed specifically for this scenario: a Windows adapter could use a different storage engine while preserving all extraction/retrieval/profile logic unchanged.

---

## Memory Spaces

Spaces are isolated memory partitions. Each space has its own knowledge graph — facts stored in one space don't appear when retrieving from another.

### How It Works

The active space is shown as a purple badge in the chat input. The `group_id` parameter on every extraction and retrieval call determines which partition is read/written.

| Space | ID Format | Purpose |
|-------|-----------|---------|
| My Business | `business` | Default. Your personal facts, preferences, goals, business context |
| Custom spaces | `client:{slug}` | One per client/project. Isolated memory for that context |
| Off | `off` | Disables memory entirely. Nothing stored or recalled |

### Cross-Space Behavior

When a custom space is active (e.g., `client:acme-corp`), retrieval searches **both** the active space AND the `business` space. This means your own preferences, constraints, and working style are always available as context regardless of which client you're advising. The client's facts don't leak into your business space or other clients' spaces.

### When to Use Spaces

- **Multiple clients** — create a space per client to prevent cross-contamination
- **Side ventures** — keep exploratory projects separate from your main business
- **Sensitive conversations** — switch to "Off" for one-off chats you don't want remembered
- **Default** — if you only have one business context, just use "My Business" and never think about it

### Creating and Managing Spaces

- Click the purple memory badge in chat → "+ New space" → type a name
- Switch between spaces by clicking the badge and selecting from the dropdown
- Deleting a space (from the dropdown) removes the label but doesn't delete graph data

---

## Important Settings and Features

### Configuration (`sidecar/config.py`)

| Setting | Default | Purpose |
|---------|---------|---------|
| `DEFAULT_TOKEN_BUDGET` | 1500 | Total tokens allocated for memory context injection |
| `PROFILE_BUDGET_RATIO` | 0.35 | Max 35% of budget for the profile document |
| `BRIEFS_BUDGET_RATIO` | 0.25 | Max 25% of budget for SCOPED goal briefs |
| `RETRIEVAL_CANDIDATES` | 30 | Edges fetched from Graphiti before reranking |
| `RECENCY_HALF_LIFE_DAYS` | 30 | How fast old facts decay in relevance |
| `RERANK_W_RELEVANCE` | 0.50 | Weight: search rank position |
| `RERANK_W_RECENCY` | 0.25 | Weight: time decay |
| `RERANK_W_SALIENCE` | 0.25 | Weight: LLM-assigned importance |
| `CONSOLIDATION_THRESHOLD` | 8 | Facts per profile section before LLM rewrite |
| `DEDUP_SWEEP_INTERVAL` | 25 | Entity dedup runs every N episodes |

### Key Features

- **Salience scoring** — Each extracted fact gets an importance score (0.0–1.0) via a calibrated LLM call. Anchored with few-shot examples for operational figures (0.5–0.7), decisions/commitments (0.8–1.0), and routine context (0.2–0.4).

- **Facts layer** — User-declared ground truth, immune to AI modification. Two tiers: always-on (injected every time, ~15% budget cap) and pinned (semantically matched when relevant). Contradiction detection flags conflicts; staleness sweep prompts review of aged numeric facts. See Facts section above for full details.

- **Profile document** — A persistent, AI-managed summary of the user's business context, constraints, and preferences. Lower authority than Facts — where they overlap, Facts win. Protected by DROP_ORDER (constraints/preferences survive longest under budget pressure). Consolidates via LLM rewrite when sections get noisy.

- **History mode** — Queries about change/evolution/trajectory automatically surface superseded (invalidated) facts with `[superseded]` annotations, so the AI can describe transitions over time.

- **Pending updates / approval queue** — HIGH-salience facts queue for user approval before entering the profile. MEDIUMs expire after 7 days (silence = reject). LOWs auto-apply. This prevents profile pollution while capturing important changes.

- **Reflection pass** — Triggered on session end (5-min idle). Collects recent facts, asks the LLM to identify patterns and contradictions, stores derived insights back into the graph. Includes entity dedup sweep.

- **Graceful degradation** — If the sidecar is down, the embedding engine is offline, or the LLM is unavailable: chat passes through unmodified. Memory is never a blocking dependency. Failed extractions queue for retry (max 100, FIFO).

- **MMR diversity** — At retrieval time, Maximal Marginal Relevance prevents 5 near-duplicate facts from spending the token budget. Disabled for small graphs (<15 edges) where redundancy doesn't exist.

- **Process into Knowledge Graph** — Connected folders can be bulk-processed into memory. Each file is chunked (~3000 chars), run through the extraction pipeline, and stored as entities/relationships in the graph — exactly as if the content had been mentioned in conversation. Useful for onboarding existing business plans, client briefs, meeting notes, or any document with facts the AI should know. Supports PDF, Word (.docx), Markdown (.md), plain text (.txt), and CSV. Accessed via Knowledge → Folder Connect → "Process into Knowledge Graph" button on each folder.

- **Debug endpoint** — `POST /debug/cypher` (CORTEX_DEBUG=1 only) allows raw Cypher queries for the eval harness's bi-temporal assertions. Not exposed in production.

---

## File Structure

```
plugins/cortex/
├── plugin.json                     # Electron plugin manifest
├── index.js                        # Node.js hooks (chatPreprocess, chatPostprocess, sidebar)
├── lifecycle.js                    # Sidecar process management (spawn, health, restart)
├── sidecar-client.js               # HTTP client for Node→Python communication
├── retry-queue.js                  # Failed extraction queue (max 100, persisted)
├── telemetry.js                    # Extraction/retrieval metrics
├── MANIFEST.md                     # Frozen baseline: pinned deps, numbers, CI spec
├── sidecar/
│   ├── main.py                     # FastAPI app — all HTTP endpoints
│   ├── ports.py                    # GraphPort protocol (the interface)
│   ├── adapters/
│   │   └── graphiti_adapter.py     # Implements GraphPort — ONLY graphiti import
│   ├── graph.py                    # Singleton holder + backward-compat shims
│   ├── extraction.py               # Episode ingestion orchestration
│   ├── reflection.py               # Pattern detection + entity dedup
│   ├── salience.py                 # Importance scoring (JSON file, not graph props)
│   ├── facts.py                    # User-declared Facts store (two tiers + contradiction + staleness)
│   ├── profile.py                  # Profile document CRUD + consolidation
│   ├── modules.py                  # SCOPED module store
│   ├── module_updater.py           # Extraction → module fact routing
│   ├── scoped.py                   # Brief compiler (S↔O gap, C↔E ledger, P↔D urgency)
│   ├── embeddings.py               # NomicLocalEmbedder (prefix-aware, semaphored)
│   ├── schema.py                   # Entity/edge type definitions (adapter config)
│   ├── config.py                   # All tunable constants
│   ├── models.py                   # Pydantic data models
│   ├── llm_adapter.py             # Generic LLM call helper
│   └── run.py                      # Uvicorn entrypoint
├── tests/                          # Eval scenarios (JSON fixtures)
└── docs/
    ├── CORTEX.md                   # This file
    ├── eval-baseline-v5.md         # Frozen eval results + analysis
    ├── SESSION-5-BRIEF.md          # Final eval session context
    └── ...                         # Eval reports, test sequences
```

---

## Data Locations

| Data | Path | Backup strategy |
|------|------|----------------|
| Graph database | `~/.iimagine/memory/graph.db` | Copy one file |
| Facts (user-declared) | `~/.iimagine/memory/facts.json` | Copy one file |
| Fact contradictions | `~/.iimagine/memory/fact_contradictions.json` | Copy one file |
| Fact staleness state | `~/.iimagine/memory/fact_staleness.json` | Copy one file |
| Profile | `~/.iimagine/memory/profile.json` | Copy one file |
| Salience scores | `~/.iimagine/memory/salience.json` | Copy one file |
| Pending updates | `~/.iimagine/memory/pending_updates.json` | Copy one file |
| Modules | `~/.iimagine/memory/modules.json` | Copy one file |
| Module proposals | `~/.iimagine/memory/module_pending.json` | Copy one file |

All memory lives in `~/.iimagine/memory/`. Backup = copy the directory. Delete = delete the directory. The graph is rebuildable from raw episodes (`store_raw_episode_content=True`).
