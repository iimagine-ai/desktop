// Legal Companion — Database layer
// Project workspace tables + legal-specific helpers

const crypto = require('crypto');
const LOG = '[Legal:DB]';

let db = null;

function init(database) {
  db = database;
  createTables();
}

function createTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS legal_matters (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      priority TEXT DEFAULT 'medium',
      description TEXT,
      practice_area TEXT,
      jurisdiction TEXT,
      client_name TEXT,
      client_type TEXT,
      opposing_party TEXT,
      opposing_counsel TEXT,
      court_tribunal TEXT,
      file_number TEXT,
      billing_type TEXT,
      matter_number TEXT,
      next_deadline TEXT,
      deadline_description TEXT,
      matter_value TEXT,
      folder_path TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      archived_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_legal_matters_status ON legal_matters(status);

    CREATE TABLE IF NOT EXISTS legal_documents (
      id TEXT PRIMARY KEY,
      matter_id TEXT NOT NULL,
      name TEXT NOT NULL,
      doc_type TEXT DEFAULT 'uploaded',
      category TEXT,
      file_path TEXT,
      file_size INTEGER,
      mime_type TEXT,
      content_hash TEXT,
      metadata TEXT DEFAULT '{}',
      indexed_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (matter_id) REFERENCES legal_matters(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_legal_docs_matter ON legal_documents(matter_id);

    CREATE TABLE IF NOT EXISTS legal_outputs (
      id TEXT PRIMARY KEY,
      matter_id TEXT NOT NULL,
      output_type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      prompt_used TEXT,
      template_id TEXT,
      model_used TEXT,
      status TEXT DEFAULT 'draft',
      version INTEGER DEFAULT 1,
      metadata TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (matter_id) REFERENCES legal_matters(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_legal_outputs_matter ON legal_outputs(matter_id);

    CREATE TABLE IF NOT EXISTS legal_activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      matter_id TEXT NOT NULL,
      action TEXT NOT NULL,
      summary TEXT,
      details TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (matter_id) REFERENCES legal_matters(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_legal_activity_matter ON legal_activity(matter_id);

    CREATE TABLE IF NOT EXISTS legal_chats (
      id TEXT PRIMARY KEY,
      matter_id TEXT NOT NULL,
      title TEXT,
      message_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (matter_id) REFERENCES legal_matters(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS legal_practice_profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      firm_name TEXT,
      practice_areas TEXT DEFAULT '[]',
      jurisdictions TEXT DEFAULT '[]',
      firm_size TEXT,
      role TEXT,
      citation_format TEXT DEFAULT 'AGLC4',
      document_tone TEXT DEFAULT 'Professional',
      billing_model TEXT,
      time_entry_format TEXT,
      setup_complete INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Ensure practice profile row exists
  const existing = db.prepare('SELECT id FROM legal_practice_profile WHERE id = 1').get();
  if (!existing) {
    db.prepare('INSERT INTO legal_practice_profile (id) VALUES (1)').run();
  }

  console.log(`${LOG} Tables initialized`);
}

// ── Practice Profile ────────────────────────────────────────────

function getProfile() {
  return db.prepare('SELECT * FROM legal_practice_profile WHERE id = 1').get();
}

function updateProfile(fields) {
  const allowed = ['firm_name', 'practice_areas', 'jurisdictions', 'firm_size', 'role',
    'citation_format', 'document_tone', 'billing_model', 'time_entry_format', 'setup_complete'];
  const sets = [];
  const values = [];
  for (const [key, val] of Object.entries(fields)) {
    if (!allowed.includes(key)) continue;
    sets.push(`${key} = ?`);
    values.push(typeof val === 'object' ? JSON.stringify(val) : val);
  }
  if (sets.length === 0) return;
  sets.push("updated_at = datetime('now')");
  values.push(1); // WHERE id = 1
  db.prepare(`UPDATE legal_practice_profile SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

// ── Matters ─────────────────────────────────────────────────────

function createMatter(data) {
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO legal_matters (id, name, practice_area, jurisdiction, client_name, client_type,
      opposing_party, opposing_counsel, court_tribunal, file_number, billing_type, matter_number,
      next_deadline, deadline_description, matter_value, status, priority, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, data.name, data.practice_area || null, data.jurisdiction || null,
    data.client_name || null, data.client_type || null, data.opposing_party || null,
    data.opposing_counsel || null, data.court_tribunal || null, data.file_number || null,
    data.billing_type || null, data.matter_number || null, data.next_deadline || null,
    data.deadline_description || null, data.matter_value || null,
    data.status || 'active', data.priority || 'medium', data.description || null);
  logActivity(id, 'matter_created', `Matter "${data.name}" created`);
  return id;
}

function getMatter(id) {
  return db.prepare('SELECT * FROM legal_matters WHERE id = ?').get(id);
}

function getAllMatters(includeArchived = false) {
  if (includeArchived) {
    return db.prepare('SELECT * FROM legal_matters ORDER BY updated_at DESC').all();
  }
  return db.prepare("SELECT * FROM legal_matters WHERE status != 'archived' ORDER BY updated_at DESC").all();
}

function updateMatter(id, fields) {
  const allowed = ['name', 'status', 'priority', 'description', 'practice_area', 'jurisdiction',
    'client_name', 'client_type', 'opposing_party', 'opposing_counsel', 'court_tribunal',
    'file_number', 'billing_type', 'matter_number', 'next_deadline', 'deadline_description',
    'matter_value', 'folder_path', 'archived_at'];
  const sets = [];
  const values = [];
  for (const [key, val] of Object.entries(fields)) {
    if (!allowed.includes(key)) continue;
    sets.push(`${key} = ?`);
    values.push(val);
  }
  if (sets.length === 0) return;
  sets.push("updated_at = datetime('now')");
  values.push(id);
  db.prepare(`UPDATE legal_matters SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

function archiveMatter(id) {
  updateMatter(id, { status: 'archived', archived_at: new Date().toISOString() });
  logActivity(id, 'status_changed', 'Matter archived');
}

function deleteMatter(id) {
  db.prepare('DELETE FROM legal_matters WHERE id = ?').run(id);
}

// ── Outputs ─────────────────────────────────────────────────────

function saveOutput(matterId, data) {
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO legal_outputs (id, matter_id, output_type, title, content, prompt_used, template_id, model_used, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, matterId, data.output_type, data.title, data.content,
    data.prompt_used || null, data.template_id || null, data.model_used || null,
    JSON.stringify(data.metadata || {}));
  logActivity(matterId, 'output_generated', `Generated: ${data.title}`);
  return id;
}

function getOutputsForMatter(matterId) {
  return db.prepare('SELECT * FROM legal_outputs WHERE matter_id = ? ORDER BY created_at DESC').all(matterId);
}

function getOutput(id) {
  return db.prepare('SELECT * FROM legal_outputs WHERE id = ?').get(id);
}

function updateOutputStatus(id, status) {
  db.prepare("UPDATE legal_outputs SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
}

// ── Activity Log ────────────────────────────────────────────────

function logActivity(matterId, action, summary, details = {}) {
  db.prepare(`
    INSERT INTO legal_activity (matter_id, action, summary, details)
    VALUES (?, ?, ?, ?)
  `).run(matterId, action, summary, JSON.stringify(details));
}

function getTimeline(matterId, limit = 50) {
  return db.prepare('SELECT * FROM legal_activity WHERE matter_id = ? ORDER BY created_at DESC LIMIT ?').all(matterId, limit);
}

// ── Documents ───────────────────────────────────────────────────

function addDocument(matterId, data) {
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO legal_documents (id, matter_id, name, doc_type, category, file_path, file_size, mime_type, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, matterId, data.name, data.doc_type || 'uploaded', data.category || null,
    data.file_path || null, data.file_size || null, data.mime_type || null,
    JSON.stringify(data.metadata || {}));
  logActivity(matterId, 'document_added', `Document added: ${data.name}`);
  return id;
}

function getDocumentsForMatter(matterId) {
  return db.prepare('SELECT * FROM legal_documents WHERE matter_id = ? ORDER BY created_at DESC').all(matterId);
}

// ── Stats ───────────────────────────────────────────────────────

function getStats() {
  const matters = db.prepare('SELECT COUNT(*) as count FROM legal_matters').get().count;
  const active = db.prepare("SELECT COUNT(*) as count FROM legal_matters WHERE status != 'archived'").get().count;
  const documents = db.prepare('SELECT COUNT(*) as count FROM legal_documents').get().count;
  const outputs = db.prepare('SELECT COUNT(*) as count FROM legal_outputs').get().count;
  return { matters, active, documents, outputs };
}

module.exports = {
  init,
  getProfile, updateProfile,
  createMatter, getMatter, getAllMatters, updateMatter, archiveMatter, deleteMatter,
  saveOutput, getOutputsForMatter, getOutput, updateOutputStatus,
  logActivity, getTimeline,
  addDocument, getDocumentsForMatter,
  getStats,
};
