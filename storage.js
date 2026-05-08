// Local SQLite storage layer
// All user data lives in a single file: ~/.iimagine/cortex.db
// "You own your data" — backup = copy one file, delete = delete one file.

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

let db = null;

// ── Init ────────────────────────────────────────────────────────

function getDbPath() {
  const dir = path.join(app.getPath('home'), '.iimagine');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'cortex.db');
}

function init() {
  if (db) return db;

  const dbPath = getDbPath();
  db = new Database(dbPath);

  // Performance settings for desktop use
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  createTables();
  return db;
}

function createTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT,
      model TEXT,
      provider_type TEXT DEFAULT 'local',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      model TEXT,
      provider_type TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation
      ON messages(conversation_id, created_at);

    CREATE TABLE IF NOT EXISTS kg_entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      properties TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_kg_entities_name_type
      ON kg_entities(name, entity_type);

    CREATE TABLE IF NOT EXISTS kg_relationships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_entity_id INTEGER NOT NULL,
      target_entity_id INTEGER NOT NULL,
      relationship_type TEXT NOT NULL,
      properties TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (source_entity_id) REFERENCES kg_entities(id) ON DELETE CASCADE,
      FOREIGN KEY (target_entity_id) REFERENCES kg_entities(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_kg_rel_source
      ON kg_relationships(source_entity_id);
    CREATE INDEX IF NOT EXISTS idx_kg_rel_target
      ON kg_relationships(target_entity_id);

    CREATE TABLE IF NOT EXISTS media (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      prompt TEXT,
      model TEXT,
      filename TEXT NOT NULL,
      media_type TEXT,
      file_size INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_media_type
      ON media(type, created_at DESC);
  `);

  // Migration: add collection_id to conversations for KB chat
  try {
    db.prepare("SELECT collection_id FROM conversations LIMIT 1").get();
  } catch {
    try { db.exec("ALTER TABLE conversations ADD COLUMN collection_id TEXT DEFAULT NULL"); } catch {}
  }

  // Migration: add kb_selections JSON column for multi-select KB
  try {
    db.prepare("SELECT kb_selections FROM conversations LIMIT 1").get();
  } catch {
    try { db.exec("ALTER TABLE conversations ADD COLUMN kb_selections TEXT DEFAULT NULL"); } catch {}
  }
}

// ── Conversations ───────────────────────────────────────────────

function createConversation({ id, title, model, providerType, collectionId, kbSelections }) {
  const stmt = db.prepare(`
    INSERT INTO conversations (id, title, model, provider_type, collection_id, kb_selections)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(id, title || 'New conversation', model || null, providerType || 'local', collectionId || null, kbSelections || null);
  return { id, title, model, providerType, collectionId };
}

function getConversations(limit = 50) {
  const stmt = db.prepare(`
    SELECT id, title, model, provider_type, collection_id, kb_selections, created_at, updated_at
    FROM conversations
    ORDER BY updated_at DESC
    LIMIT ?
  `);
  return stmt.all(limit);
}

function getConversation(id) {
  const stmt = db.prepare(`
    SELECT id, title, model, provider_type, collection_id, kb_selections, created_at, updated_at
    FROM conversations WHERE id = ?
  `);
  return stmt.get(id) || null;
}

function updateConversationTitle(id, title) {
  const stmt = db.prepare(`
    UPDATE conversations SET title = ?, updated_at = datetime('now')
    WHERE id = ?
  `);
  return stmt.run(title, id);
}

function updateConversationCollection(id, collectionId) {
  const stmt = db.prepare(`
    UPDATE conversations SET collection_id = ?, updated_at = datetime('now')
    WHERE id = ?
  `);
  return stmt.run(collectionId || null, id);
}

function updateConversationKBSelections(id, selections) {
  const json = selections && selections.length > 0 ? JSON.stringify(selections) : null;
  // Also update legacy collection_id for backward compat
  const collectionId = selections && selections.length > 0 ? selections[0].collectionId : null;
  const stmt = db.prepare(`
    UPDATE conversations SET kb_selections = ?, collection_id = ?, updated_at = datetime('now')
    WHERE id = ?
  `);
  return stmt.run(json, collectionId, id);
}

function deleteConversation(id) {
  const stmt = db.prepare('DELETE FROM conversations WHERE id = ?');
  return stmt.run(id);
}

// ── Messages ────────────────────────────────────────────────────

function addMessage({ conversationId, role, content, model, providerType }) {
  const stmt = db.prepare(`
    INSERT INTO messages (conversation_id, role, content, model, provider_type)
    VALUES (?, ?, ?, ?, ?)
  `);
  const result = stmt.run(conversationId, role, content, model || null, providerType || null);

  // Touch conversation updated_at
  db.prepare(`
    UPDATE conversations SET updated_at = datetime('now') WHERE id = ?
  `).run(conversationId);

  return { id: result.lastInsertRowid, conversationId, role, content };
}

function getMessages(conversationId, limit = 200) {
  const stmt = db.prepare(`
    SELECT id, conversation_id, role, content, model, provider_type, created_at
    FROM messages
    WHERE conversation_id = ?
    ORDER BY created_at ASC
    LIMIT ?
  `);
  return stmt.all(conversationId, limit);
}

// ── Knowledge Graph ─────────────────────────────────────────────

function upsertEntity({ name, entityType, properties }) {
  const stmt = db.prepare(`
    INSERT INTO kg_entities (name, entity_type, properties)
    VALUES (?, ?, ?)
    ON CONFLICT(name, entity_type) DO UPDATE SET
      properties = ?,
      updated_at = datetime('now')
  `);
  const props = JSON.stringify(properties || {});
  const result = stmt.run(name, entityType, props, props);
  return { id: result.lastInsertRowid, name, entityType };
}

function getEntities(entityType, limit = 100) {
  let stmt;
  if (entityType) {
    stmt = db.prepare(`
      SELECT id, name, entity_type, properties, created_at, updated_at
      FROM kg_entities WHERE entity_type = ?
      ORDER BY updated_at DESC LIMIT ?
    `);
    return stmt.all(entityType, limit);
  }
  stmt = db.prepare(`
    SELECT id, name, entity_type, properties, created_at, updated_at
    FROM kg_entities ORDER BY updated_at DESC LIMIT ?
  `);
  return stmt.all(limit);
}

function addRelationship({ sourceEntityId, targetEntityId, relationshipType, properties }) {
  const stmt = db.prepare(`
    INSERT INTO kg_relationships (source_entity_id, target_entity_id, relationship_type, properties)
    VALUES (?, ?, ?, ?)
  `);
  const props = JSON.stringify(properties || {});
  const result = stmt.run(sourceEntityId, targetEntityId, relationshipType, props);
  return { id: result.lastInsertRowid };
}

function getRelationships(entityId) {
  const stmt = db.prepare(`
    SELECT r.id, r.relationship_type, r.properties, r.created_at,
           s.name as source_name, s.entity_type as source_type,
           t.name as target_name, t.entity_type as target_type
    FROM kg_relationships r
    JOIN kg_entities s ON r.source_entity_id = s.id
    JOIN kg_entities t ON r.target_entity_id = t.id
    WHERE r.source_entity_id = ? OR r.target_entity_id = ?
    ORDER BY r.created_at DESC
  `);
  return stmt.all(entityId, entityId);
}

// ── Media ────────────────────────────────────────────────────

function getMediaDir() {
  const dir = path.join(app.getPath('home'), '.iimagine', 'media');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function saveMedia({ id, type, prompt, model, filename, mediaType, fileSize }) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO media (id, type, prompt, model, filename, media_type, file_size)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(id, type, prompt || null, model || null, filename, mediaType || null, fileSize || 0);
  return { id, type, filename };
}

function getMedia(id) {
  const stmt = db.prepare('SELECT * FROM media WHERE id = ?');
  return stmt.get(id) || null;
}

function listMedia(type, limit = 50) {
  if (type) {
    const stmt = db.prepare('SELECT * FROM media WHERE type = ? ORDER BY created_at DESC LIMIT ?');
    return stmt.all(type, limit);
  }
  const stmt = db.prepare('SELECT * FROM media ORDER BY created_at DESC LIMIT ?');
  return stmt.all(limit);
}

function deleteMedia(id) {
  const row = db.prepare('SELECT filename FROM media WHERE id = ?').get(id);
  if (row) {
    const filePath = path.join(getMediaDir(), row.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  db.prepare('DELETE FROM media WHERE id = ?').run(id);
  return true;
}

function getMediaStats() {
  const imgCount = db.prepare("SELECT COUNT(*) as count FROM media WHERE type = 'image'").get().count;
  const vidCount = db.prepare("SELECT COUNT(*) as count FROM media WHERE type = 'video'").get().count;
  const totalSize = db.prepare('SELECT COALESCE(SUM(file_size), 0) as total FROM media').get().total;
  return { images: imgCount, videos: vidCount, totalSize, totalSizeMB: (totalSize / 1e6).toFixed(2) };
}

// ── Stats ───────────────────────────────────────────────────────

function getStats() {
  const dbPath = getDbPath();
  const fileSize = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;

  const convCount = db.prepare('SELECT COUNT(*) as count FROM conversations').get().count;
  const msgCount = db.prepare('SELECT COUNT(*) as count FROM messages').get().count;
  const entityCount = db.prepare('SELECT COUNT(*) as count FROM kg_entities').get().count;
  const relCount = db.prepare('SELECT COUNT(*) as count FROM kg_relationships').get().count;
  const mediaCount = db.prepare('SELECT COUNT(*) as count FROM media').get().count;

  return {
    dbPath,
    fileSize,
    fileSizeMB: (fileSize / 1e6).toFixed(2),
    conversations: convCount,
    messages: msgCount,
    entities: entityCount,
    relationships: relCount,
    media: mediaCount,
    mediaDir: getMediaDir(),
  };
}

// ── DB Access (for extensions like KB) ──────────────────────────

function getDb() {
  return db;
}

// ── Cleanup ─────────────────────────────────────────────────────

function close() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  init,
  close,
  getDb,
  getDbPath,
  // Conversations
  createConversation,
  getConversations,
  getConversation,
  updateConversationTitle,
  updateConversationCollection,
  updateConversationKBSelections,
  deleteConversation,
  // Messages
  addMessage,
  getMessages,
  // Knowledge Graph
  upsertEntity,
  getEntities,
  addRelationship,
  getRelationships,
  // Media
  getMediaDir,
  saveMedia,
  getMedia,
  listMedia,
  deleteMedia,
  getMediaStats,
  // Stats
  getStats,
};
