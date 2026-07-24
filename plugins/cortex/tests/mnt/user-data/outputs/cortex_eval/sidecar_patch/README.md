# Sidecar patches required/recommended for the limits eval

## Patch 1 (REQUIRED for graph-level assertions): /debug/cypher

The temporal-chain and entity-resolution scenarios assert directly against the
graph (invalid_at set, node counts). Without this endpoint those assertions
report SKIP. Gated behind CORTEX_DEBUG so it can never ship enabled.

Add to `sidecar/main.py`:

```python
@app.post("/debug/cypher")
async def debug_cypher(body: dict):
    """Raw Cypher for eval assertions. ONLY available when CORTEX_DEBUG=1."""
    if not CORTEX_DEBUG:
        return {"error": "debug disabled"}
    from .graph import get_driver
    driver = get_driver()
    if not driver:
        return {"error": "graph not initialized", "rows": []}
    try:
        result = await driver.execute_query(body["query"])
        rows = result[0] if result else []
        # Normalize rows to plain dicts for JSON
        return {"rows": [dict(r) if hasattr(r, "keys") else {"value": str(r)}
                         for r in rows]}
    except Exception as e:
        return {"error": str(e), "rows": []}
```

Note: if your stored edge property names differ (check with
`MATCH ()-[r:RELATES_TO]->() RETURN r LIMIT 1`), adjust the Cypher inside
`scenarios/20_*.json` / `30_*.json` / `40_*.json` — the property names used
are `fact`, `group_id`, `invalid_at` per Graphiti's FalkorDB schema.

## Patch 2 (RECOMMENDED): pending-queue dedup — the "41 updates" finding

Your own smoke test showed 41 pending updates after ~13 episodes, including
the same fact queued twice. At that rate a real user faces hundreds of
approvals within weeks and stops reviewing — which kills the digest design.

Add to `ProfileManager.queue_update()` in `sidecar/profile.py`, at the top:

```python
        # Dedup: don't queue what's already pending (or already applied).
        norm = proposed_change.strip().lower()
        for u in self._pending:
            if u.status == "pending" and u.section == section_name:
                existing = u.proposed_change.strip().lower()
                if norm == existing or norm in existing or existing in norm:
                    logger.debug(f"Skipped duplicate pending update: {norm[:50]}")
                    return u.id
        section = getattr(self._profile, section_name, None)
        if section:
            for fact in section.key_facts:
                f = fact.strip().lower()
                if norm == f or norm in f or f in norm:
                    logger.debug(f"Already in profile, not queueing: {norm[:50]}")
                    return ""
```

The eval runner prints `Pending-queue size at '<checkpoint>'` — after this
patch, watch that number: queue growth per episode should drop well below 1.0
on the interference scenario. That metric is part of your regression dashboard.
