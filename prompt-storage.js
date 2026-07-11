// Prompt Storage — CRUD for reusable prompt templates
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
    CREATE TABLE IF NOT EXISTS prompts (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      category TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_prompts_category ON prompts(category);
  `);
}

// ── CRUD ────────────────────────────────────────────────────────

function createPrompt({ title, content, category }) {
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO prompts (id, title, content, category)
    VALUES (?, ?, ?, ?)
  `).run(id, title, content, category || '');
  return { id, title, content, category: category || '', created_at: new Date().toISOString() };
}

function getPrompts() {
  return db.prepare('SELECT * FROM prompts ORDER BY updated_at DESC').all();
}

function getPrompt(id) {
  return db.prepare('SELECT * FROM prompts WHERE id = ?').get(id) || null;
}

function updatePrompt(id, { title, content, category }) {
  const updates = [];
  const values = [];

  if (title !== undefined) { updates.push('title = ?'); values.push(title); }
  if (content !== undefined) { updates.push('content = ?'); values.push(content); }
  if (category !== undefined) { updates.push('category = ?'); values.push(category); }

  if (!updates.length) return null;

  updates.push("updated_at = datetime('now')");
  values.push(id);

  db.prepare(`UPDATE prompts SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  return getPrompt(id);
}

function deletePrompt(id) {
  db.prepare('DELETE FROM prompts WHERE id = ?').run(id);
  return true;
}

function searchPrompts(query) {
  if (!query || !query.trim()) return getPrompts();
  const like = `%${query.trim()}%`;
  return db.prepare(`
    SELECT * FROM prompts
    WHERE title LIKE ? OR content LIKE ?
    ORDER BY updated_at DESC
  `).all(like, like);
}

module.exports = {
  init,
  createPrompt,
  getPrompts,
  getPrompt,
  updatePrompt,
  deletePrompt,
  searchPrompts,
};
