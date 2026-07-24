// Cortex Telemetry — Production metrics for dogfooding calibration
//
// Tracks:
// - Extraction failure rate (target: <1%)
// - Salience-null rate (target: <5%)
// - Profile coverage: facts per section
// - Queue growth: pending updates per session
// - Retrieval latency p95 (target: <500ms)
//
// Data stored in ~/.iimagine/plugin-data/cortex/telemetry.json
// Rotated weekly (keeps last 4 weeks)

const fs = require('fs');
const path = require('path');
const os = require('os');

const LOG = '[Cortex:Telemetry]';
const DATA_DIR = path.join(os.homedir(), '.iimagine', 'plugin-data', 'cortex');
const TELEMETRY_FILE = path.join(DATA_DIR, 'telemetry.json');
const MAX_WEEKS = 4;

class Telemetry {
  constructor() {
    this._session = {
      startedAt: new Date().toISOString(),
      extractions: { success: 0, failure: 0 },
      retrievals: { count: 0, latencies: [] },
      salienceNull: 0,
      salienceTotal: 0,
      queueGrowth: 0,
    };
  }

  // ── Recording ───────────────────────────────────────────────

  recordExtraction(success) {
    if (success) {
      this._session.extractions.success++;
    } else {
      this._session.extractions.failure++;
    }
  }

  recordRetrieval(latencyMs) {
    this._session.retrievals.count++;
    this._session.retrievals.latencies.push(latencyMs);
  }

  recordSalience(isNull) {
    this._session.salienceTotal++;
    if (isNull) this._session.salienceNull++;
  }

  recordQueueGrowth(pendingCount) {
    this._session.queueGrowth = pendingCount;
  }

  // ── Computed Metrics ────────────────────────────────────────

  getSessionMetrics() {
    const ext = this._session.extractions;
    const ret = this._session.retrievals;
    const totalExtractions = ext.success + ext.failure;

    const latencies = [...ret.latencies].sort((a, b) => a - b);
    const p50 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.5)] : 0;
    const p95 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.95)] : 0;

    return {
      session_start: this._session.startedAt,
      extraction_failure_rate: totalExtractions > 0 ? ext.failure / totalExtractions : 0,
      extraction_total: totalExtractions,
      salience_null_rate: this._session.salienceTotal > 0
        ? this._session.salienceNull / this._session.salienceTotal : 0,
      retrieval_count: ret.count,
      retrieval_latency_p50_ms: p50,
      retrieval_latency_p95_ms: p95,
      queue_growth: this._session.queueGrowth,
    };
  }

  // ── Persistence ─────────────────────────────────────────────

  flush() {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

      const metrics = this.getSessionMetrics();
      metrics.flushed_at = new Date().toISOString();

      // Load existing data
      let data = { weeks: [] };
      if (fs.existsSync(TELEMETRY_FILE)) {
        try {
          data = JSON.parse(fs.readFileSync(TELEMETRY_FILE, 'utf-8'));
        } catch {}
      }

      // Get current week key
      const now = new Date();
      const weekKey = `${now.getFullYear()}-W${String(Math.ceil(((now - new Date(now.getFullYear(), 0, 1)) / 86400000 + 1) / 7)).padStart(2, '0')}`;

      // Find or create current week
      let week = data.weeks.find(w => w.week === weekKey);
      if (!week) {
        week = { week: weekKey, sessions: [] };
        data.weeks.push(week);
      }

      week.sessions.push(metrics);

      // Trim to MAX_WEEKS
      data.weeks.sort((a, b) => b.week.localeCompare(a.week));
      data.weeks = data.weeks.slice(0, MAX_WEEKS);

      fs.writeFileSync(TELEMETRY_FILE, JSON.stringify(data, null, 2));
      console.log(`${LOG} Flushed session metrics: ${metrics.extraction_total} extractions, ${metrics.retrieval_count} retrievals, p95=${metrics.retrieval_latency_p95_ms}ms`);
    } catch (err) {
      console.warn(`${LOG} Flush error:`, err.message);
    }
  }

  // ── Summary (for /memory command or settings panel) ─────────

  getWeeklySummary() {
    try {
      if (!fs.existsSync(TELEMETRY_FILE)) return null;
      const data = JSON.parse(fs.readFileSync(TELEMETRY_FILE, 'utf-8'));
      if (!data.weeks || data.weeks.length === 0) return null;

      const currentWeek = data.weeks[0];
      const sessions = currentWeek.sessions || [];

      const totals = sessions.reduce((acc, s) => {
        acc.extractions += s.extraction_total || 0;
        acc.failures += Math.round((s.extraction_failure_rate || 0) * (s.extraction_total || 0));
        acc.retrievals += s.retrieval_count || 0;
        acc.latencies.push(s.retrieval_latency_p95_ms || 0);
        return acc;
      }, { extractions: 0, failures: 0, retrievals: 0, latencies: [] });

      return {
        week: currentWeek.week,
        sessions: sessions.length,
        extraction_failure_rate: totals.extractions > 0
          ? (totals.failures / totals.extractions * 100).toFixed(1) + '%' : '—',
        retrieval_p95_ms: totals.latencies.length > 0
          ? Math.max(...totals.latencies) + 'ms' : '—',
        total_extractions: totals.extractions,
        total_retrievals: totals.retrievals,
      };
    } catch {
      return null;
    }
  }
}

module.exports = Telemetry;
