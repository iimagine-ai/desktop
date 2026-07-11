// RAG Prompt Storage — Context-aware system prompts for KB chat
// Categories: project_active, kb_selected, comms_kb_selected
// Each category has a non-deletable default + user-created prompts
// The active prompt per category persists until the user changes it.

const crypto = require('crypto');

const LOG = '[RAGPrompts]';

let db = null;
let store = null;

// ── Default Prompts ─────────────────────────────────────────────

const DEFAULTS = {
  project_active: {
    id: 'default_project_active',
    title: 'Project Assistant',
    content: `You are a project assistant. Answer questions using the documents below and any memory context provided. If the answer is in the documents, use it and cite the source. If you don't have enough information, say so.`,
  },
  kb_selected: {
    id: 'default_kb_selected',
    title: 'Knowledge Base Assistant',
    content: `You are a helpful assistant. Answer questions using the documents below. If the answer is in the documents, use it and cite the source. If the documents don't contain the answer, say so.`,
  },
  comms_kb_selected: {
    id: 'default_comms_kb_selected',
    title: 'Communications Analyst',
    content: `You are a communications analyst. Answer questions using the message history below. 

RESPONSE FORMAT:
1. Each item must START with the date in format "9 May 2026 —" followed by the description.
2. Order items from most recent date first to oldest last.
3. Write in clear, complete sentences.
4. At the end of your response, add a brief "Assumptions:" section listing any assumptions you made about quantity, timeframe, or scope.
5. Always cite the source communication and date.`,
  },
};

// ── Init ────────────────────────────────────────────────────────

function init(database, electronStore) {
  db = database;
  store = electronStore;
  createTable();
  seedDefaults();
}

function createTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rag_prompts (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      is_default INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_rag_prompts_category ON rag_prompts(category);
  `);
}

function seedDefaults() {
  for (const [category, prompt] of Object.entries(DEFAULTS)) {
    const existing = db.prepare('SELECT id FROM rag_prompts WHERE id = ?').get(prompt.id);
    if (!existing) {
      db.prepare(`
        INSERT INTO rag_prompts (id, category, title, content, is_default)
        VALUES (?, ?, ?, ?, 1)
      `).run(prompt.id, category, prompt.title, prompt.content);
      console.log(`${LOG} Seeded default: ${prompt.title} (${category})`);
    }
  }
}

// ── CRUD ────────────────────────────────────────────────────────

function getByCategory(category) {
  return db.prepare(
    'SELECT * FROM rag_prompts WHERE category = ? ORDER BY is_default DESC, updated_at DESC'
  ).all(category);
}

function getAll() {
  return db.prepare(
    'SELECT * FROM rag_prompts ORDER BY category, is_default DESC, updated_at DESC'
  ).all();
}

function getPrompt(id) {
  return db.prepare('SELECT * FROM rag_prompts WHERE id = ?').get(id) || null;
}

function createPrompt({ category, title, content }) {
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO rag_prompts (id, category, title, content, is_default)
    VALUES (?, ?, ?, ?, 0)
  `).run(id, category, title, content);
  return { id, category, title, content, is_default: 0 };
}

function updatePrompt(id, { title, content }) {
  const existing = db.prepare('SELECT * FROM rag_prompts WHERE id = ?').get(id);
  if (!existing) return null;

  const updates = [];
  const values = [];
  if (title !== undefined) { updates.push('title = ?'); values.push(title); }
  if (content !== undefined) { updates.push('content = ?'); values.push(content); }
  if (!updates.length) return existing;

  updates.push("updated_at = datetime('now')");
  values.push(id);
  db.prepare(`UPDATE rag_prompts SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  return getPrompt(id);
}

function deletePrompt(id) {
  const existing = db.prepare('SELECT * FROM rag_prompts WHERE id = ?').get(id);
  if (!existing) return false;
  if (existing.is_default) return false; // Cannot delete defaults
  db.prepare('DELETE FROM rag_prompts WHERE id = ?').run(id);
  // If this was the active prompt, reset to default
  const activeKey = `ragPrompts.active.${existing.category}`;
  if (store.get(activeKey) === id) {
    store.delete(activeKey);
  }
  return true;
}

// ── Active Prompt Selection ─────────────────────────────────────

function getActivePromptId(category) {
  return store.get(`ragPrompts.active.${category}`) || DEFAULTS[category]?.id || null;
}

function setActivePromptId(category, promptId) {
  store.set(`ragPrompts.active.${category}`, promptId);
}

/**
 * Get the active prompt content for a given context.
 * Determines category based on state, returns the prompt content string.
 */
function getActivePromptContent(context) {
  const { isCommsKB, isKBSelected, isProjectActive } = context;

  let category = null;
  if (isCommsKB) category = 'comms_kb_selected';
  else if (isKBSelected) category = 'kb_selected';
  else if (isProjectActive) category = 'project_active';

  if (!category) return null;

  const activeId = getActivePromptId(category);
  if (!activeId) return null;

  const prompt = getPrompt(activeId);
  return prompt ? prompt.content : DEFAULTS[category]?.content || null;
}

module.exports = {
  init,
  getAll,
  getByCategory,
  getPrompt,
  createPrompt,
  updatePrompt,
  deletePrompt,
  getActivePromptId,
  setActivePromptId,
  getActivePromptContent,
};
