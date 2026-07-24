# Cortex Memory Plugin — Session 2 Brief

## What exists

The Cortex plugin is at `desktop-companion/plugins/cortex/`. It has:
- Node.js plugin entry (`index.js`) — hooks into chatPreprocess/chatPostprocess, manages sidecar lifecycle
- Python sidecar (`sidecar/`) — FastAPI on localhost, FalkorDB Lite graph storage
- Extraction works: GPT-5.4-mini extracts entities/relationships/facts into FalkorDB Lite
- Graph storage works: entities, edges, episodes persist correctly
- Profile update queue works: facts get classified and queued
- The iimagine-engine is available at port 8847 serving nomic-embed-text (768-dim embeddings confirmed working)
- FalkorDB Lite vector search CONFIRMED WORKING with correct syntax:
  - `CREATE VECTOR INDEX FOR (n:Label) ON (n.embedding) OPTIONS {dimension: 768, similarityFunction: 'cosine'}`
  - Store vectors with `vecf32([...])`
  - Query with `CALL db.idx.vector.queryNodes('Label', 'embedding', k, vecf32($query))`

## What's broken

Two critical mistakes were made:

### 1. Wrong vector query syntax
The retrieval code uses Neo4j Cypher (`vector.similarity.cosine()`) instead of FalkorDB's API (`CALL db.idx.vector.queryNodes()`). This is why vector search returns empty — it's a syntax error, not a limitation.

### 2. Hand-rolled retrieval instead of using Graphiti
The files `retrieval.py`, `rrf.py`, `scoring.py`, `entity_resolution.py`, and `extraction.py` are ALL custom code that should not exist. Graphiti already provides:
- `graphiti.add_episode()` — handles extraction, entity resolution, temporal invalidation, embedding storage
- `graphiti.search()` — handles BM25 + vector + graph traversal + RRF, in the correct FalkorDB dialect

The sidecar should be a thin wrapper around Graphiti's API, not a reimplementation of it.

## What needs to happen in Session 2

1. **Read Graphiti's actual API** — specifically `graphiti.add_episode()` and `graphiti.search()`. Use Context7 or the repo docs at https://github.com/getzep/graphiti
2. **Delete the hand-rolled code**: `retrieval.py`, `rrf.py`, `scoring.py`, `entity_resolution.py` — Graphiti handles all of this
3. **Rewrite `extraction.py`** to call `graphiti.add_episode(user_msg + assistant_response)` — Graphiti does the extraction, entity resolution, dedup, temporal invalidation, and embedding storage internally
4. **Rewrite the `/retrieve` endpoint** to call `graphiti.search(query)` — returns ranked results with BM25 + vector + graph fusion already done
5. **Configure Graphiti with** the custom entity types (12 business advisory types) and the embedding function (call localhost:8847 with nomic prefixes)
6. **Test end-to-end** with the same test data used in Session 1

## Key files to modify
- `sidecar/main.py` — endpoints stay the same, internals change to call Graphiti
- `sidecar/graph.py` — replace with Graphiti initialization (not raw FalkorDB queries)
- DELETE: `sidecar/retrieval.py`, `sidecar/rrf.py`, `sidecar/scoring.py`, `sidecar/entity_resolution.py`
- KEEP: `sidecar/embeddings.py` (provides the embedding function Graphiti needs), `sidecar/config.py`, `sidecar/models.py`, `sidecar/profile.py`, `sidecar/reflection.py`

## Key constraints
- FalkorDB Lite via `from redislite import FalkorDB` — connection: `FalkorDB('/path/to/file.rdb')`
- Embedding endpoint: `http://127.0.0.1:8847/v1/embeddings` with nomic-embed-text (768-dim)
- Must prepend "search_document: " for storage, "search_query: " for queries
- LLM for extraction: whatever the user has active (passed via `llm_config` in the request)
- The Node.js plugin side (`index.js`, `lifecycle.js`, `sidecar-client.js`, `retry-queue.js`) is fine — don't touch it

## Spec location
`desktop-companion/.kiro/specs/cortex-memory-plugin/` — has requirements.md, design.md, tasks.md

## OpenAI key for testing
In `iia-28/.env.local` under `OPENAI_API_KEY`

## How to test
```bash
cd desktop-companion/plugins/cortex
source .venv/bin/activate
rm -f ~/.iimagine/memory/graph.rdb
python -m sidecar.run --port 9199
```
Then curl extract/retrieve endpoints (see docs/test-sequence-gpt54mini.md)

## The objective
The most advanced AI long-term memory on the planet. Temporal knowledge graph. Structured extraction with salience. Hybrid retrieval (vector + BM25 + graph). Sub-500ms latency. Graphiti is the engine — we are NOT reimplementing it.
