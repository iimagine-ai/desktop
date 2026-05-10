// Persona Storage — CRUD for AI personas (personalization)
// SQLite-backed, integrates with the main database

const crypto = require('crypto');

let db = null;

// ── Init ────────────────────────────────────────────────────────

function init(database) {
  db = database;
  createTable();
}

function createTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS personas (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      persona_name TEXT DEFAULT '',
      persona_role TEXT DEFAULT '',
      custom_instructions TEXT DEFAULT '',
      image_url TEXT DEFAULT '',
      is_active INTEGER DEFAULT 0,
      communication_style TEXT DEFAULT 'empathetic',
      detail_level TEXT DEFAULT 'balanced',
      response_format TEXT DEFAULT 'conversational',
      warmth_level INTEGER DEFAULT 3,
      directness_level INTEGER DEFAULT 3,
      emotional_depth INTEGER DEFAULT 3,
      challenge_level INTEGER DEFAULT 3,
      structure_preference INTEGER DEFAULT 3,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

// ── CRUD ────────────────────────────────────────────────────────

function createPersona(data) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO personas (id, name, description, persona_name, persona_role, custom_instructions,
      image_url, is_active, communication_style, detail_level, response_format,
      warmth_level, directness_level, emotional_depth, challenge_level, structure_preference,
      created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.name || '',
    data.description || '',
    data.persona_name || '',
    data.persona_role || '',
    data.custom_instructions || '',
    data.image_url || '',
    data.is_active ? 1 : 0,
    data.communication_style || 'empathetic',
    data.detail_level || 'balanced',
    data.response_format || 'conversational',
    data.warmth_level ?? 3,
    data.directness_level ?? 3,
    data.emotional_depth ?? 3,
    data.challenge_level ?? 3,
    data.structure_preference ?? 3,
    now, now
  );
  return getPersona(id);
}

function getPersonas() {
  return db.prepare('SELECT * FROM personas ORDER BY created_at DESC').all();
}

function getPersona(id) {
  return db.prepare('SELECT * FROM personas WHERE id = ?').get(id) || null;
}

function getActivePersona() {
  return db.prepare('SELECT * FROM personas WHERE is_active = 1').get() || null;
}

function updatePersona(id, data) {
  const existing = getPersona(id);
  if (!existing) return null;

  const fields = ['name', 'description', 'persona_name', 'persona_role', 'custom_instructions',
    'image_url', 'communication_style', 'detail_level', 'response_format',
    'warmth_level', 'directness_level', 'emotional_depth', 'challenge_level', 'structure_preference'];

  const updates = [];
  const values = [];
  for (const f of fields) {
    if (data[f] !== undefined) {
      updates.push(`${f} = ?`);
      values.push(data[f]);
    }
  }
  if (!updates.length) return existing;

  updates.push("updated_at = datetime('now')");
  values.push(id);

  db.prepare(`UPDATE personas SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  return getPersona(id);
}

function deletePersona(id) {
  db.prepare('DELETE FROM personas WHERE id = ?').run(id);
  return { success: true };
}

function activatePersona(id) {
  db.prepare('UPDATE personas SET is_active = 0').run();
  db.prepare('UPDATE personas SET is_active = 1, updated_at = datetime(\'now\') WHERE id = ?').run(id);
  return getPersona(id);
}

function deactivateAll() {
  db.prepare('UPDATE personas SET is_active = 0').run();
  return { success: true };
}

module.exports = {
  init,
  createPersona,
  getPersonas,
  getPersona,
  getActivePersona,
  updatePersona,
  deletePersona,
  activatePersona,
  deactivateAll,
};
