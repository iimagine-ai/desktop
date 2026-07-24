"""Cortex telemetry — event log, context snapshots, and KPI aggregation.

Three responsibilities:
  1. log_event(): append-only JSONL, one line per event, weekly-rotated files.
     Called from the request path — must be cheap (single file append) and
     must NEVER raise into the caller.
  2. Context snapshots: full assembled context per exchange, pruned after
     30 days unless flagged (misses, signal hits, audited samples).
  3. aggregate(): rolling-window KPI computation from the event log, plus
     weekly KPI history for the dashboard sparklines.
"""

import json
import logging
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from .config import DATA_DIR

logger = logging.getLogger("cortex.telemetry")

TELEMETRY_DIR = DATA_DIR / "telemetry"
CONTEXTS_DIR = TELEMETRY_DIR / "contexts"
FLAGS_PATH = TELEMETRY_DIR / "flagged.json"
KPI_HISTORY_PATH = TELEMETRY_DIR / "kpi_history.json"

SNAPSHOT_RETENTION_DAYS = 30

for d in (TELEMETRY_DIR, CONTEXTS_DIR):
    d.mkdir(parents=True, exist_ok=True)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _events_file(dt: Optional[datetime] = None) -> Path:
    dt = dt or _now()
    year, week, _ = dt.isocalendar()
    return TELEMETRY_DIR / f"events-{year}-W{week:02d}.jsonl"


# ── Event writing ────────────────────────────────────────────────


def log_event(event_type: str, exchange_id: Optional[str] = None,
              session_id: Optional[str] = None, **payload) -> None:
    """Append one event. Never raises into the caller — telemetry failure
    must never break a chat exchange."""
    try:
        record = {"ts": _now().isoformat(), "type": event_type,
                  "exchange_id": exchange_id, "session_id": session_id}
        record.update(payload)
        with _events_file().open("a") as f:
            f.write(json.dumps(record, default=str) + "\n")
    except Exception as e:
        logger.debug(f"telemetry write failed ({event_type}): {e}")


def save_context_snapshot(exchange_id: str, context: str) -> None:
    try:
        (CONTEXTS_DIR / f"{exchange_id}.txt").write_text(context or "")
    except Exception as e:
        logger.debug(f"snapshot write failed: {e}")


def flag_exchange(exchange_id: str, reason: str) -> None:
    """Protect an exchange's snapshot from pruning (miss/signal/audit)."""
    try:
        flags = _load_flags()
        flags[exchange_id] = {"reason": reason, "ts": _now().isoformat()}
        FLAGS_PATH.write_text(json.dumps(flags, indent=2))
    except Exception as e:
        logger.debug(f"flag write failed: {e}")


def _load_flags() -> dict:
    if FLAGS_PATH.exists():
        try:
            return json.loads(FLAGS_PATH.read_text())
        except Exception:
            return {}
    return {}


def prune_snapshots(days: int = SNAPSHOT_RETENTION_DAYS) -> int:
    """Delete unflagged snapshots older than `days`. Call from the reflection
    cycle or on sidecar startup — anywhere periodic."""
    flags = _load_flags()
    cutoff = time.time() - days * 86400
    pruned = 0
    try:
        for p in CONTEXTS_DIR.glob("*.txt"):
            if p.stem in flags:
                continue
            if p.stat().st_mtime < cutoff:
                p.unlink()
                pruned += 1
    except Exception as e:
        logger.debug(f"snapshot prune failed: {e}")
    if pruned:
        logger.info(f"telemetry: pruned {pruned} context snapshot(s)")
    return pruned


# ── Reading & aggregation ────────────────────────────────────────


def read_events(days: int = 7) -> list[dict]:
    """All events in the trailing window (reads current + previous weekly
    files as needed)."""
    cutoff = _now() - timedelta(days=days)
    events: list[dict] = []
    # Weekly files that could contain the window:
    files = set()
    probe = cutoff
    while probe <= _now() + timedelta(days=1):
        files.add(_events_file(probe))
        probe += timedelta(days=7)
    files.add(_events_file())
    for path in sorted(files):
        if not path.exists():
            continue
        for line in path.read_text().splitlines():
            try:
                e = json.loads(line)
                if datetime.fromisoformat(e["ts"]) >= cutoff:
                    events.append(e)
            except Exception:
                continue
    return events


def _pct(numerator: int, denominator: int) -> Optional[float]:
    return round(100.0 * numerator / denominator, 1) if denominator else None


def _p(values: list[float], q: float) -> Optional[float]:
    if not values:
        return None
    s = sorted(values)
    return round(s[min(int(len(s) * q), len(s) - 1)], 1)


def aggregate(days: int = 7) -> dict:
    """Rolling-window KPIs from the event log. Judged KPIs (context recall,
    superseded citation, priority presence) come from `audit` events written
    by audit.py — absent until the first audit runs."""
    ev = read_events(days)
    by = lambda t: [e for e in ev if e["type"] == t]

    retrieves = by("retrieve")
    n = len(retrieves)
    extracts = by("extract")
    latencies = [e.get("latency_ms") for e in retrieves if e.get("latency_ms") is not None]

    audits = by("audit")
    goal_audits = [a for a in audits if a.get("goal_relevant")]

    edges_created = sum(e.get("edges", 0) for e in extracts)
    edges_scored = sum(e.get("scored_edges", 0) for e in extracts)

    digests = by("digest")
    d_actions = [d.get("action") for d in digests]

    queue_snaps = sorted(by("queue_snapshot"), key=lambda e: e["ts"])
    queue_growth = (queue_snaps[-1].get("pending_count", 0)
                    - queue_snaps[0].get("pending_count", 0)) if len(queue_snaps) >= 2 else 0

    open_contradictions = len(by("contradiction")) - len(by("contradiction_resolved"))

    return {
        "window_days": days,
        "exchanges": n,
        # Recall (auto)
        "redundant_question_rate_per100": _pct(len(by("redundant_question")), n),
        "correction_rate_per100": _pct(len(by("correction")), n),
        "miss_count": len(by("miss")),
        # Recall / time / priority (judged — from weekly audit)
        "live_context_recall_pct": _pct(
            sum(1 for a in audits if a.get("context_sufficient")), len(audits)),
        "superseded_citation_rate_pct": _pct(
            sum(1 for a in audits if a.get("superseded_value_cited")), len(audits)),
        "priority_deadline_present_pct": _pct(
            sum(1 for a in goal_audits if a.get("priority_deadline_present")),
            len(goal_audits)),
        "audited_samples": len(audits),
        # Goal awareness (auto)
        "brief_match_count": sum(1 for e in retrieves if e.get("briefs_included", 0) > 0),
        # Performance & pipeline
        "retrieval_p50_ms": _p(latencies, 0.50),
        "retrieval_p95_ms": _p(latencies, 0.95),
        "extraction_failure_rate_pct": _pct(
            sum(1 for e in extracts if e.get("error")), len(extracts)),
        "salience_coverage_pct": _pct(edges_scored, edges_created),
        # Curation contract
        "queue_growth": queue_growth,
        "digest_actions": {a: d_actions.count(a) for a in set(d_actions)} if d_actions else {},
        "open_contradictions": max(open_contradictions, 0),
    }


def record_weekly_kpis(note: str = "") -> dict:
    """Append this week's aggregate to kpi_history.json (dashboard sparklines).
    Run by audit.py after each audit, or manually."""
    record = {"week_ending": _now().date().isoformat(), "note": note,
              "kpis": aggregate(7)}
    history = []
    if KPI_HISTORY_PATH.exists():
        try:
            history = json.loads(KPI_HISTORY_PATH.read_text())
        except Exception:
            history = []
    history.append(record)
    KPI_HISTORY_PATH.write_text(json.dumps(history, indent=2))
    return record


def recent_failures(limit: int = 20) -> list[dict]:
    """Misses + signal hits, newest first — the dashboard failures panel."""
    ev = read_events(30)
    fails = [e for e in ev if e["type"] in ("miss", "redundant_question", "correction")]
    fails.sort(key=lambda e: e["ts"], reverse=True)
    for f in fails:
        snap = CONTEXTS_DIR / f"{f.get('exchange_id')}.txt"
        f["snapshot_available"] = snap.exists()
    return fails[:limit]
