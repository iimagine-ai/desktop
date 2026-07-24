// Cortex Sidecar Client — HTTP client for the Python FastAPI sidecar
// All memory operations route through this client to localhost:{port}

const LOG = '[Cortex:Client]';

class SidecarClient {
  constructor(port) {
    this.port = port;
    this.baseUrl = `http://127.0.0.1:${port}`;
  }

  setPort(port) {
    this.port = port;
    this.baseUrl = `http://127.0.0.1:${port}`;
  }

  // ── Health ──────────────────────────────────────────────────

  async health() {
    const res = await this._get('/health');
    return res;
  }

  // ── Retrieval ───────────────────────────────────────────────

  async retrieve(query, tokenBudget = 1500, groupId = 'business', citeSources = false, scoped = true, exchangeId = null, sessionId = null) {
    return this._post('/retrieve', {
      query,
      token_budget: tokenBudget,
      include_profile: true,
      group_id: groupId,
      cite_sources: citeSources,
      scoped,
      exchange_id: exchangeId,
      session_id: sessionId,
    });
  }

  // ── Extraction ──────────────────────────────────────────────

  async extract(userMessage, assistantResponse, llmConfig, groupId = 'business') {
    return this._post('/extract', {
      user_message: userMessage,
      assistant_response: assistantResponse,
      llm_config: llmConfig,
      group_id: groupId,
    });
  }

  // ── Profile ─────────────────────────────────────────────────

  async getProfile() {
    return this._get('/profile');
  }

  async getPendingUpdates() {
    return this._get('/pending-updates');
  }

  async approveUpdate(id) {
    return this._post(`/pending-updates/${id}/approve`);
  }

  async rejectUpdate(id) {
    return this._post(`/pending-updates/${id}/reject`);
  }

  // ── Reflection ──────────────────────────────────────────────

  async reflect(factIds, llmConfig) {
    return this._post('/reflect', {
      fact_ids: factIds || null,
      llm_config: llmConfig,
    });
  }

  // ── Stats & Search ──────────────────────────────────────────

  async getStats() {
    return this._get('/stats');
  }

  async search(query, limit = 10) {
    return this._post('/search', { query, limit });
  }

  // ── Clear ───────────────────────────────────────────────────

  async clear() {
    return this._delete('/clear');
  }

  // ── Modules (SCOPED objectives) ─────────────────────────────

  async listModules() {
    return this._get('/modules');
  }

  async createModule(data) {
    return this._post('/modules', data);
  }

  async updateModule(id, patch) {
    return this._patch(`/modules/${id}`, patch);
  }

  async deleteModule(id) {
    return this._delete(`/modules/${id}`);
  }

  // ── Generic request (used by IPC handlers and processKG) ────

  async request(method, path, body = null) {
    if (method === 'GET') return this._get(path);
    if (method === 'POST') return this._post(path, body || {});
    if (method === 'PATCH') return this._patch(path, body || {});
    if (method === 'DELETE') return this._delete(path);
    throw new Error(`Unsupported method: ${method}`);
  }

  // ── HTTP helpers ────────────────────────────────────────────

  async _get(path) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Sidecar GET ${path} failed: ${res.status} — ${body.slice(0, 200)}`);
    }
    return res.json();
  }

  async _post(path, body = {}) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Sidecar POST ${path} failed: ${res.status} — ${errBody.slice(0, 200)}`);
    }
    return res.json();
  }

  async _patch(path, body = {}) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Sidecar PATCH ${path} failed: ${res.status} — ${errBody.slice(0, 200)}`);
    }
    return res.json();
  }

  async _delete(path) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Sidecar DELETE ${path} failed: ${res.status} — ${body.slice(0, 200)}`);
    }
    return res.json();
  }
}

module.exports = SidecarClient;
