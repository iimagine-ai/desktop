# Verification checklist — run BEFORE trusting this code

This code was written against Graphiti's documented API without a live install
to test against (this environment has no network access). Graphiti moves fast.
Every item below is a point where your installed version may differ. None are
guesses about *design* — they are exact-name checks.

## 1. API names to confirm (grep your installed graphiti-core)

| What | Expected | Where used | If different |
|---|---|---|---|
| add_episode kwargs | `entity_types`, `edge_types`, `edge_type_map` | extraction.py, reflection.py | Check `Graphiti.add_episode` signature; older versions may lack `edge_types` |
| Edge attributes | `edge.attributes` dict containing custom fields like `salience` | extraction.py, main.py | Inspect an extracted edge: `print(edge.model_dump())` |
| Node type labels | `node.labels` includes the entity type name | extraction.py `_node_type_label` | Inspect `node.model_dump()` for where the type is recorded |
| Embedder base | `graphiti_core.embedder.client.EmbedderClient` with `create` / `create_batch` | embeddings.py | Check the abstract methods' exact signatures |
| Lite driver | `graphiti_core.driver.falkordb_lite_driver.FalkorLiteDriver(path=...)` | graph.py path 1 | Falls back to path 2 automatically |
| falkordblite client | `from falkordblite import FalkorDB; FalkorDB(path)` | graph.py path 2 | Check falkordblite's README for constructor args |
| build_indices | `graphiti.build_indices_and_constraints()` | graph.py | Some versions expose it on the driver instead |
| Cypher param passing | `driver.execute_query(query, **params)` | reflection.py, graph.py | May be `params=` dict in some versions |
| RELATES_TO / group_id / invalid_at on edges | Cypher in reflection.py `_gather_recent_facts` | reflection.py | Inspect actual stored properties: `MATCH ()-[r]->() RETURN r LIMIT 1` |

## 2. Smoke-test sequence (in order — each gates the next)

```bash
export CORTEX_DEBUG=1          # re-raise instead of degrading silently
python -m sidecar.run --port 9100
```

1. **Startup:** logs must show "FalkorDB roundtrip smoke test PASSED" and
   "Nomic prefix verification PASSED" (call verify_prefix_handling at startup
   or manually). If startup raises — good, that's the point of debug mode.
2. **GET /health** → `status: "ok"`. If `"degraded"`, the error field tells
   you which init step failed.
3. **POST /extract** with a real fact, e.g. user_message = "We decided to
   hire two developers next quarter, budget is $180k." → expect
   entities_created ≥ 2, relationships_created ≥ 1.
4. **GET /stats** → entities/edges must be > 0. Zero here = extraction is
   silently failing; check logs.
5. **POST /search** query "hiring plans" → the fact should return WITH a
   non-null salience value. Null salience on typed edges means edge
   attributes aren't populating — check item 1, rows 1–2.
6. **Vector-channel check** (the FalkorDB Lite question): temporarily stop
   the embedding engine, repeat /search with a paraphrase ("expanding the
   team") that shares no keywords, restart engine, compare. With embeddings
   up, the paraphrase should hit; keyword-only, it may miss.
7. **POST /reflect** after ~10 extractions → insights_created ≥ 0 AND a
   follow-up /search for the insight's wording should FIND it (proves the
   group_id fix).
8. **Profile:** GET /pending-updates after step 3 → the hiring decision
   should be queued HIGH (salience ≥ 0.7) in the "team" or "resources"
   section — not "business" (proves type routing).

## 3. Known open items (deliberately not in this fix)

- Contradiction surfacing from reflection (counted, not yet routed to UI)
- Session-end batching for profile classification (currently per-exchange)
- The eval suite — build it next; it is the only durable defense against
  the silent-degradation failure class this fix addresses.
