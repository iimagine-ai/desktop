// AI Assistants storage layer
// Custom GPT-like assistants with KB integration

let db = null;

function init(database) {
  db = database;
  createTables();
}

function createTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS assistants (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      system_prompt TEXT DEFAULT '',
      collection_id TEXT,
      model_preference TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (collection_id) REFERENCES kb_collections(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS assistant_conversations (
      id TEXT PRIMARY KEY,
      assistant_id TEXT NOT NULL,
      title TEXT DEFAULT 'New conversation',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (assistant_id) REFERENCES assistants(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS assistant_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      context_chunks TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (conversation_id) REFERENCES assistant_conversations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_asst_conv_assistant
      ON assistant_conversations(assistant_id, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_asst_msg_conv
      ON assistant_messages(conversation_id, created_at);
  `);

  // Migration: add kb_selections JSON column for multi-select KB
  try {
    db.prepare("SELECT kb_selections FROM assistants LIMIT 1").get();
  } catch {
    try { db.exec("ALTER TABLE assistants ADD COLUMN kb_selections TEXT DEFAULT NULL"); } catch {}
  }
}

// ── Assistants CRUD ─────────────────────────────────────────────

function createAssistant({ id, title, description, systemPrompt, collectionId, kbSelections, modelPreference }) {
  db.prepare(`
    INSERT INTO assistants (id, title, description, system_prompt, collection_id, kb_selections, model_preference)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, title, description || '', systemPrompt || '', collectionId || null, kbSelections || null, modelPreference || null);
  return getAssistant(id);
}

function getAssistants() {
  return db.prepare(`
    SELECT a.*,
      c.name as collection_name,
      (SELECT COUNT(*) FROM assistant_conversations WHERE assistant_id = a.id) as conversation_count
    FROM assistants a
    LEFT JOIN kb_collections c ON a.collection_id = c.id
    ORDER BY a.updated_at DESC
  `).all();
}

function getAssistant(id) {
  return db.prepare(`
    SELECT a.*, c.name as collection_name
    FROM assistants a
    LEFT JOIN kb_collections c ON a.collection_id = c.id
    WHERE a.id = ?
  `).get(id) || null;
}

function updateAssistant(id, { title, description, systemPrompt, collectionId, kbSelections, modelPreference }) {
  db.prepare(`
    UPDATE assistants
    SET title = ?, description = ?, system_prompt = ?, collection_id = ?, kb_selections = ?, model_preference = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(title, description || '', systemPrompt || '', collectionId || null, kbSelections || null, modelPreference || null, id);
  return getAssistant(id);
}

function deleteAssistant(id) {
  db.prepare('DELETE FROM assistants WHERE id = ?').run(id);
  return true;
}

// ── Conversations ───────────────────────────────────────────────

function createConversation({ id, assistantId, title }) {
  db.prepare(`
    INSERT INTO assistant_conversations (id, assistant_id, title) VALUES (?, ?, ?)
  `).run(id, assistantId, title || 'New conversation');
  return { id, assistantId, title };
}

function getConversations(assistantId) {
  return db.prepare(`
    SELECT id, assistant_id, title, created_at, updated_at
    FROM assistant_conversations WHERE assistant_id = ? ORDER BY updated_at DESC
  `).all(assistantId);
}

function deleteConversation(id) {
  db.prepare('DELETE FROM assistant_conversations WHERE id = ?').run(id);
  return true;
}

// ── Messages ────────────────────────────────────────────────────

function addMessage({ conversationId, role, content, contextChunks }) {
  const result = db.prepare(`
    INSERT INTO assistant_messages (conversation_id, role, content, context_chunks)
    VALUES (?, ?, ?, ?)
  `).run(conversationId, role, content, contextChunks ? JSON.stringify(contextChunks) : null);

  db.prepare("UPDATE assistant_conversations SET updated_at = datetime('now') WHERE id = ?").run(conversationId);

  return { id: result.lastInsertRowid, conversationId, role, content };
}

function getMessages(conversationId, limit = 100) {
  return db.prepare(`
    SELECT id, conversation_id, role, content, context_chunks, created_at
    FROM assistant_messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ?
  `).all(conversationId, limit);
}

module.exports = {
  init,
  createAssistant,
  getAssistants,
  getAssistant,
  updateAssistant,
  deleteAssistant,
  createConversation,
  getConversations,
  deleteConversation,
  addMessage,
  getMessages,
};
