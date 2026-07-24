# Cortex Operating Principles

## The Measurement Boundary

The instruments only keep catching truths one layer down if the instruments themselves stay untouched by the layer they're grading.

- The **judge** measures what the advisory model would actually receive. It never infers facts not present in context. No "constraints present = decision made" shortcuts. If the context doesn't explicitly establish a claim, the judge is correct to say it's missing.
- **Extraction-side** problems get extraction-side fixes. The judge stays pure.
- **Assertion wording** changes are decomposed and reported separately from code changes. Every result states which suite version produced it.
- When a metric improves, state whether the improvement came from the system getting better or the test getting easier. Both are legitimate; conflating them is not.

## The Three-Layer Contract

The retrieval architecture guarantees facts through three layers, each with a defined responsibility:

1. **Profile document** — current strategic picture, always injected in full. Carries: preferences, constraints, objectives, strategies, resources. The layer built to *guarantee* facts so retrieval never has to get lucky.
2. **Retrieved temporal facts** — semantic search + reranking over the knowledge graph. Carries: recent operational detail, conversation-specific context, anything too granular or volatile for the profile.
3. **Conversation context** — the current exchange. Carries: immediate topic, user's question, framing.

A fact must be guaranteed by at least one layer. If it falls between layers (mid-salience operational figures), that's an architectural gap — log it, decide which layer owns it, then fix. Never paper over layer gaps by removing assertions.

## Eval Suite Integrity

- **No "best-of-n."** All numbers are mean pass-rate across N runs.
- **Suite version is immutable per comparison.** Changing assertions mid-arc requires a version bump and decomposition run.
- **The harness simulates production conditions.** If an eval step doesn't exist in production (like approve_pending), state what user behavior it simulates and why omitting it would misrepresent the product.
- **Probes track known gaps without gating.** Non-graded assertions keep the dashboard honest about questions the suite isn't yet ready to answer.
- **Variance is the enemy.** A 100% deterministic pass on 3/4 assertions is a stronger engineering position than a flaky 92% on 4/4. Kill variance before chasing coverage.
