# Facts Layer — Design Specification

**Date:** 2026-07-15  
**Status:** Approved, ready for implementation

---

## Purpose

Facts are user-declared ground truth that the AI cannot override. They complete the authority spectrum:

```
Facts (user-declared axioms)
  → SCOPED Objectives (user-declared structure, AI-updated fields)
    → Profile (AI-proposed, user-approved)
      → Memory (AI-inferred, reranked)
        → Conversation
```

Each layer trades automation for authority. Recall is layers 4–5; advice quality is mostly determined by whether layers 1–3 are correct. Facts ensures layer 1 exists.

---

## Storage

- File: `~/.iimagine/memory/facts.json`
- NOT in the graph. Not subject to extraction, consolidation, invalidation, or reflection.
- Only editable by the user directly (add/edit/delete in the UI).

### Schema

```json
{
  "always_on": [
    {
      "id": "uuid",
      "key": "Age",
      "value": "Born 1992",
      "created_at": "2026-07-15T10:00:00Z",
      "last_confirmed_at": "2026-07-15T10:00:00Z"
    }
  ],
  "pinned": [
    {
      "id": "uuid",
      "key": "Allergy",
      "value": "Allergic to peanuts",
      "embedding": [0.012, -0.034, ...],
      "created_at": "2026-07-15T10:00:00Z",
      "last_confirmed_at": "2026-07-15T10:00:00Z"
    }
  ]
}
```

`key` is optional but encouraged. Enables fast-path contradiction detection (same key = automatic candidate, skip embeddings).

---

## Two Tiers

### Always-On (~10–15% token budget cap)

- Injected verbatim every time, position 1 in context assembly
- Identity-level: name, birth year, location, company, core product, target market, USP
- UX nudges stable phrasings ("born 1992" not "age 34", "founded 2019" not "5 years old")
- UI shows approximate token cost as facts are added (budget feedback)
- Hard cap enforced at assembly time: if always-on exceeds 15% of budget, truncate from bottom with warning

### Pinned (unlimited, semantically matched)

- Each fact embedded on save (nomic, storage prefix, same invariants as all stored embeddings)
- At retrieval: reuse the query embedding already computed for search → cosine against pinned embeddings → top 5–10 above threshold included after always-on
- Best-effort by design: truly critical facts belong in always-on
- Cross-domain misses are acceptable and documented ("should I take the catering contract?" may not cosine-match "allergic to peanuts")

---

## Context Assembly Order

1. **Always-on Facts** (verbatim, unconditional, ~10–15% budget cap)
2. **Matched Pinned Facts** (top N by cosine, verbatim)
3. **SCOPED briefs** (if objectives match the query)
4. **AI-managed Profile** (existing behavior)
5. **Retrieved memory facts** (reranked graph edges)

Advisory prompt instruction: "User-declared Facts are authoritative. Where memory or profile conflicts with a Fact, the Fact wins. Do not assert a contradicting value back to the user."

---

## Contradiction Detection

### Mechanism (post-extraction, async, off hot path)

1. Each extraction produces 2–6 new fact embeddings (already computed as part of storage pipeline)
2. Cosine each new embedding against the full Facts index
3. Sub-millisecond local dot product (5000 facts × 768 dims = ~15MB, trivial)
4. Fast path for keyed facts: same key = automatic contradiction candidate, skip embeddings
5. High similarity hit (>0.80) → one cheap LLM confirm (~100 tokens): "Same subject, conflicting values?"
6. Confirmed conflict → flag raised

### Delivery: Inline vs Digest

**Inline (mid-conversation, user just said the contradicting thing):**
- AI mentions it once, briefly, in the same response
- Message: "Quick flag: you mentioned turning 35, but your Facts list 'Born 1992.' I'll keep using your Facts until you update them — want me to change it?"
- Never repeats across turns once acknowledged or ignored
- One flag per contradiction, then silence until resolved or expired into digest

**Digest (detected async, after the conversation):**
- Appears in pending updates / digest view
- Message: "Your Facts say 'Born 1992'; recent conversation suggests age 35. [Update] [Keep current] [Remove fact]"
- [Keep current] refreshes `last_confirmed_at` and suppresses re-flagging
- [Update] opens inline edit with the new value pre-filled
- [Remove fact] deletes the fact entirely

### Boundary Case: Graceful Acknowledgment

When contradiction is unambiguous and recent ("I just turned 35, feeling old"), the AI:
- Does NOT assert "you're 34" back at the user
- DOES use the Fact value for any advice/computation (precedence rule)
- CAN acknowledge gracefully: "Happy birthday — I've flagged your Facts for an update"
- Rigid precedence with human delivery

---

## Staleness Sweep

- Facts untouched for N months (configurable, default 6), especially containing numbers or dates → low-friction "still true?" in digest
- AI never edits Facts AND system never lets Facts rot silently — compatible commitments
- [Keep current] refreshes the date; ignored items re-surface next cycle

---

## Deduplication Across Layers

- At context assembly time: skip profile/memory lines above cosine similarity threshold (0.85) to an already-injected Fact
- Same machinery as SCOPED brief-fact dedup
- Prevents "IIMAGINE, 7 people, Sydney" appearing from both Facts and Profile

---

## Phase 2: Facts as Extraction Context

- Pass always-on Facts to the extraction LLM as additional context
- "The user is Adam; the company is IIMAGINE; the CTO is Sarah Chen"
- Helps entity resolution — targets the Sarah/Sarah-Chen class of problem
- Cheap, directly addresses weakest eval number (scenario 40, 85.7%)
- Do after v1 Facts ships and stabilizes

---

## UX

### Facts Tab (sidebar)

```
┌─ Facts ────────────────────────────────────┐
│                                            │
│  Always included:              ~8% budget  │
│  ┌──────────────────────────────────────┐  │
│  │ Name    │ Adam                       │  │
│  │ Born    │ 1992                       │  │
│  │ Location│ Sydney, Australia          │  │
│  │ Company │ IIMAGINE, founded 2019     │  │
│  │ Product │ AI desktop companion       │  │
│  │ Market  │ Solopreneurs, SMBs         │  │
│  └──────────────────────────────────────┘  │
│  [+ Add fact]                              │
│                                            │
│  ─────────────────────────────────────     │
│                                            │
│  Include when relevant:                    │
│  ┌──────────────────────────────────────┐  │
│  │ Co-founder James handles sales       │  │
│  │ Office lease expires March 2027      │  │
│  │ Uses Stripe, Neon, Vercel            │  │
│  │ Allergic to peanuts                  │  │
│  └──────────────────────────────────────┘  │
│  [+ Add fact]                              │
│                                            │
└────────────────────────────────────────────┘
```

- Each fact: editable inline (click to edit), delete button (x)
- Optional key field (label) — nudged but not required
- Always-on section shows approximate budget usage
- Hint text: "Facts are always true. The AI will never override them."

---

## Eval: Scenario 120

Four assertions:
1. **Contradiction precedence** — Fact says "Born 1992", chat says "35" → advisory context resolves to birth year, digest item exists
2. **Pinned-fact surfacing** — allergy question retrieves the allergy fact
3. **No duplication** — fact injected once across layers (not repeated from profile/memory)
4. **Budget behavior** — 50+ always-on facts: cap enforced, warning surfaced, no context overflow

Two additional assertions:
5. **Inline contradiction flag** — produces exactly one flag per contradiction, not repeated
6. **Keep-current suppresses re-flagging** — confirming a fact prevents the same contradiction from re-surfacing

---

## Implementation Order

1. `sidecar/facts.py` — store (JSON CRUD, embedding on save, contradiction cosine check)
2. Facts endpoints in `main.py` (GET/POST/PATCH/DELETE + contradiction check hook)
3. Context assembly changes in `/retrieve` (injection at position 1, dedup, budget cap)
4. Contradiction detection wiring in extraction post-hook
5. UI: Facts tab in `index.js` (two-tier list, inline edit, budget indicator)
6. IPC: plugin handlers + preload exposure
7. Advisory prompt update (precedence instruction)
8. Eval scenario 120
