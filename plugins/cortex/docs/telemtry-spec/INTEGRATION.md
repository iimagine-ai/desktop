# Integration — telemetry, signals, audit, dashboard

New files: `sidecar/telemetry.py`, `sidecar/signals.py`, `sidecar/audit.py`,
`dashboard/dashboard.html`. Changes below wire them in. Telemetry must never
raise into the request path — `log_event` already guarantees that.

## 1. exchange_id plumbing (plugin → sidecar)

The Electron plugin generates `exchange_id = crypto.randomUUID()` per user
message and passes it to all three calls for that exchange:

```
chatPreprocess  → POST /retrieve      {..., "exchange_id", "session_id"}
(after reply)   → POST /log/response  {"exchange_id", "session_id",
                                       "user_message", "assistant_response"}
chatPostprocess → POST /extract       {..., "exchange_id"}
```

Add `exchange_id: str | None = None` to `RetrieveRequest` and
`ExtractRequest`.

## 2. Instrument /retrieve

At the end of the endpoint (success path), before returning:

```python
        from .telemetry import log_event, save_context_snapshot
        log_event("retrieve", request.exchange_id, request.session_id,
                  query=request.query,
                  facts_used=facts_used,
                  briefs_included=len(briefs),
                  brief_modules=brief_modules,
                  profile_included=profile_included,
                  tokens={"facts": token_count,
                          "profile": len(profile_context) // 4,
                          "briefs": len(briefs_text) // 4 if briefs else 0},
                  latency_ms=round(latency_ms, 1),
                  scoped=request.scoped)
        if request.exchange_id:
            save_context_snapshot(request.exchange_id, context)
```

## 3. Instrument /extract

In `run_extraction`'s result path (and error path — log with `error=str(e)`):

```python
        from .telemetry import log_event
        log_event("extract", exchange_id, session_id,
                  entities=result["entities_created"],
                  edges=result["relationships_created"],
                  scored_edges=len(salience_map),
                  profile_updates=result["profile_updates_queued"],
                  modules_updated=result.get("modules_created", []),
                  error=None,
                  latency_ms=round((time.time() - t0) * 1000, 1))
        # Curation-contract tracking:
        from .profile import get_profile_manager
        log_event("queue_snapshot", exchange_id,
                  pending_count=len(get_profile_manager().get_pending_updates()))
```

Also add one-line `log_event("digest", action=..., tier=..., section=...)`
calls inside approve_update / reject_update / stale handling, and
`log_event("contradiction", ...)` / `log_event("contradiction_resolved", ...)`
in the Facts contradiction lifecycle.

## 4. New endpoint: POST /log/response  (triggers the signals)

```python
class LogResponseRequest(BaseModel):
    exchange_id: str | None = None
    session_id: str | None = None
    user_message: str = ""
    assistant_response: str = ""

@app.post("/log/response")
async def log_response(req: LogResponseRequest, background_tasks: BackgroundTasks):
    from .telemetry import log_event
    from .signals import check_correction, check_redundant_questions, extract_questions

    log_event("response", req.exchange_id, req.session_id,
              response_len=len(req.assistant_response),
              response_text=req.assistant_response[:4000],   # audit needs it
              question_count=len(extract_questions(req.assistant_response)))

    check_correction(req.exchange_id, req.session_id, req.user_message)

    # Redundant-question check runs in the background — local embeds only.
    async def _bg():
        from .graph import get_graphiti
        from .embeddings import query_mode
        g = get_graphiti()
        if not g:
            return

        async def search_fn(q: str, limit: int):
            with query_mode():
                edges = await g.search(query=q, num_results=limit,
                                       group_ids=[GROUP_ID])
            # Valid facts only — questions about superseded values are
            # legitimate clarification, not redundancy.
            return [{"fact": getattr(e, "fact", "")} for e in edges
                    if getattr(e, "invalid_at", None) is None]

        async def embed_q(text: str):
            with query_mode():
                return await g.embedder.create(text)

        async def embed_d(text: str):
            return await g.embedder.create(text)

        from .signals import check_redundant_questions
        await check_redundant_questions(req.exchange_id, req.session_id,
                                        req.assistant_response,
                                        search_fn, embed_q, embed_d)

    background_tasks.add_task(_bg)
    return {"success": True}
```

(`from fastapi import BackgroundTasks` at the top of main.py.)

## 5. New endpoint: POST /memory-miss  (the failure journal)

```python
@app.post("/memory-miss")
async def memory_miss(body: dict):
    from .telemetry import flag_exchange, log_event
    xid = body.get("exchange_id")
    log_event("miss", xid, body.get("session_id"), note=body.get("note", ""))
    if xid:
        flag_exchange(xid, "miss")
    return {"success": True, "message": "Logged — this exchange is kept for review"}
```

Plugin side: `/memory miss <note>` slash command (and/or thumbs-down) posts
the LAST exchange_id + optional note. Two keystrokes, no confirmation dialog —
friction here is data lost.

## 6. Metrics endpoints (dashboard backend)

```python
@app.get("/metrics")
async def metrics():
    from .telemetry import aggregate
    return aggregate(7)

@app.get("/metrics/history")
async def metrics_history():
    from .telemetry import KPI_HISTORY_PATH
    import json as _json
    if KPI_HISTORY_PATH.exists():
        return {"history": _json.loads(KPI_HISTORY_PATH.read_text())}
    return {"history": []}

@app.get("/metrics/failures")
async def metrics_failures():
    from .telemetry import recent_failures
    return {"failures": recent_failures(20)}
```

CORS note: if dashboard.html is opened as a file:// page rather than inside
the app, add localhost CORS middleware (dev-only, bound to 127.0.0.1).

## 7. Housekeeping hooks

- Sidecar startup (lifespan) and/or the reflection cycle:
  `from .telemetry import prune_snapshots; prune_snapshots()`
- `/clear` should NOT delete telemetry — measurement history survives memory
  resets by design (annotate resets instead: `log_event("system",
  note="memory cleared")`).

## 8. Weekly audit scheduling

macOS launchd (or just a calendar reminder for week 1–2):
```
cd plugins/cortex && source .venv/bin/activate && \
OPENAI_API_KEY=... python -m sidecar.audit --sample 20 --model gpt-5.4
```
The audit writes `audit` events + the weekly KPI history record the
dashboard sparklines read. First two weeks are calibration: annotate the
history records, then freeze KPI targets.

## 9. Verify checklist

1. Send one chat message → `events-*.jsonl` gains retrieve + response +
   extract + queue_snapshot lines sharing one exchange_id; a context
   snapshot exists.
2. Ask the AI something it demonstrably knows, have it ask you back (or
   temporarily set SIMILARITY_THRESHOLD to 0.3) → `redundant_question` event.
3. Type "I already told you the MRR" → `correction` event, exchange flagged.
4. `/memory miss test` → miss event + permanent flag.
5. `python -m sidecar.audit --sample 5` → audit events + kpi_history entry.
6. Open dashboard.html → cards populate, failures panel lists items 2–4.
7. Confirm /retrieve p95 unchanged (telemetry adds one file append).
