// Cortex Lite — Database layer
// Creates tables, provides CRUD helpers for entities, relationships, facts, summaries

const crypto = require('crypto');

const LOG = '[CortexLite:DB]';

let db = null;
let vecLoaded = false;

function init(database, isVecAvailable) {
  db = database;
  vecLoaded = isVecAvailable;
  createTables();
}

function createTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_entities (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      properties TEXT DEFAULT '{}',
      confidence REAL DEFAULT 1.0,
      mention_count INTEGER DEFAULT 1,
      last_mentioned TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(type, name COLLATE NOCASE)
    );

    CREATE INDEX IF NOT EXISTS idx_memory_entities_type
      ON memory_entities(type);
    CREATE INDEX IF NOT EXISTS idx_memory_entities_name
      ON memory_entities(name COLLATE NOCASE);

    CREATE TABLE IF NOT EXISTS memory_relationships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      type TEXT NOT NULL,
      properties TEXT DEFAULT '{}',
      strength REAL DEFAULT 1.0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (source_id) REFERENCES memory_entities(id) ON DELETE CASCADE,
      FOREIGN KEY (target_id) REFERENCES memory_entities(id) ON DELETE CASCADE,
      UNIQUE(source_id, target_id, type)
    );

    CREATE INDEX IF NOT EXISTS idx_memory_rels_source
      ON memory_relationships(source_id);
    CREATE INDEX IF NOT EXISTS idx_memory_rels_target
      ON memory_relationships(target_id);

    CREATE TABLE IF NOT EXISTS memory_facts (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      source TEXT,
      entity_ids TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_memory_facts_created
      ON memory_facts(created_at DESC);

    CREATE TABLE IF NOT EXISTS memory_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      summary TEXT NOT NULL,
      message_count INTEGER DEFAULT 0,
      token_estimate INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Create vec virtual table if available
  if (vecLoaded) {
    try {
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS memory_embeddings
        USING vec0(fact_id TEXT PRIMARY KEY, embedding float[768]);
      `);
      console.log(`${LOG} sqlite-vec table ready (768 dimensions)`);
    } catch (err) {
      console.warn(`${LOG} Failed to create vec0 table:`, err.message);
      vecLoaded = false;
    }
  }

  console.log(`${LOG} Tables initialized`);
}

// ── Entities ────────────────────────────────────────────────────

function upsertEntity({ type, name, properties, confidence }) {
  const existing = db.prepare(
    'SELECT id, mention_count, properties FROM memory_entities WHERE type = ? AND name = ? COLLATE NOCASE'
  ).get(type, name);

  if (existing) {
    // Merge properties
    let merged = {};
    try { merged = JSON.parse(existing.properties || '{}'); } catch {}
    if (properties && typeof properties === 'object') {
      merged = { ...merged, ...properties };
    }

    db.prepare(`
      UPDATE memory_entities
      SET mention_count = mention_count + 1,
          last_mentioned = datetime('now'),
          properties = ?,
          confidence = MAX(confidence, ?)
      WHERE id = ?
    `).run(JSON.stringify(merged), confidence || 1.0, existing.id);

    return existing.id;
  }

  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO memory_entities (id, type, name, properties, confidence)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, type, name, JSON.stringify(properties || {}), confidence || 1.0);

  return id;
}

function getEntities(limit = 100) {
  return db.prepare(
    'SELECT * FROM memory_entities ORDER BY last_mentioned DESC LIMIT ?'
  ).all(limit);
}

function getEntitiesByType(type) {
  return db.prepare(
    'SELECT * FROM memory_entities WHERE type = ? ORDER BY mention_count DESC'
  ).all(type);
}

function searchEntities(query) {
  const pattern = `%${query}%`;
  return db.prepare(
    'SELECT * FROM memory_entities WHERE name LIKE ? COLLATE NOCASE ORDER BY mention_count DESC LIMIT 20'
  ).all(pattern);
}

function deleteEntity(id) {
  db.prepare('DELETE FROM memory_relationships WHERE source_id = ? OR target_id = ?').run(id, id);
  db.prepare('DELETE FROM memory_entities WHERE id = ?').run(id);
}

// ── Relationships ───────────────────────────────────────────────

function upsertRelationship({ sourceId, targetId, type, properties }) {
  const existing = db.prepare(
    'SELECT id, strength FROM memory_relationships WHERE source_id = ? AND target_id = ? AND type = ?'
  ).get(sourceId, targetId, type);

  if (existing) {
    db.prepare(
      'UPDATE memory_relationships SET strength = strength + 0.5, properties = ? WHERE id = ?'
    ).run(JSON.stringify(properties || {}), existing.id);
    return existing.id;
  }

  const result = db.prepare(`
    INSERT INTO memory_relationships (source_id, target_id, type, properties)
    VALUES (?, ?, ?, ?)
  `).run(sourceId, targetId, type, JSON.stringify(properties || {}));

  return result.lastInsertRowid;
}

function getRelationshipsForEntity(entityId) {
  return db.prepare(`
    SELECT r.*, 
      s.name as source_name, s.type as source_type,
      t.name as target_name, t.type as target_type
    FROM memory_relationships r
    JOIN memory_entities s ON r.source_id = s.id
    JOIN memory_entities t ON r.target_id = t.id
    WHERE r.source_id = ? OR r.target_id = ?
    ORDER BY r.strength DESC
  `).all(entityId, entityId);
}

// ── Facts ───────────────────────────────────────────────────────

function addFact({ content, source, entityIds }) {
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO memory_facts (id, content, source, entity_ids)
    VALUES (?, ?, ?, ?)
  `).run(id, content, source || null, JSON.stringify(entityIds || []));
  return id;
}

function getRecentFacts(limit = 20) {
  return db.prepare(
    'SELECT * FROM memory_facts ORDER BY created_at DESC LIMIT ?'
  ).all(limit);
}

function searchFactsByKeyword(keyword) {
  const pattern = `%${keyword}%`;
  return db.prepare(
    'SELECT * FROM memory_facts WHERE content LIKE ? COLLATE NOCASE ORDER BY created_at DESC LIMIT 10'
  ).all(pattern);
}

// ── Embeddings ──────────────────────────────────────────────────

function storeFactEmbedding(factId, embedding) {
  if (!vecLoaded) return false;
  try {
    const buf = Buffer.from(new Float32Array(embedding).buffer);
    db.prepare('INSERT OR REPLACE INTO memory_embeddings (fact_id, embedding) VALUES (?, ?)').run(factId, buf);
    return true;
  } catch (err) {
    console.warn(`${LOG} Failed to store embedding:`, err.message);
    return false;
  }
}

function searchByEmbedding(queryEmbedding, topK = 5) {
  if (!vecLoaded) return [];
  try {
    const buf = Buffer.from(new Float32Array(queryEmbedding).buffer);
    return db.prepare(`
      SELECT e.fact_id, e.distance, f.content
      FROM memory_embeddings e
      JOIN memory_facts f ON e.fact_id = f.id
      WHERE e.embedding MATCH ? AND k = ?
      ORDER BY e.distance
    `).all(buf, topK);
  } catch (err) {
    console.warn(`${LOG} Vector search error:`, err.message);
    return [];
  }
}

// ── Summaries ───────────────────────────────────────────────────

function addSummary({ summary, messageCount, tokenEstimate }) {
  db.prepare(`
    INSERT INTO memory_summaries (summary, message_count, token_estimate)
    VALUES (?, ?, ?)
  `).run(summary, messageCount || 0, tokenEstimate || 0);
}

function getRecentSummaries(limit = 3) {
  return db.prepare(
    'SELECT * FROM memory_summaries ORDER BY created_at DESC LIMIT ?'
  ).all(limit);
}

// ── Stats ───────────────────────────────────────────────────────

function getStats() {
  const entities = db.prepare('SELECT COUNT(*) as count FROM memory_entities').get().count;
  const relationships = db.prepare('SELECT COUNT(*) as count FROM memory_relationships').get().count;
  const facts = db.prepare('SELECT COUNT(*) as count FROM memory_facts').get().count;
  const summaries = db.prepare('SELECT COUNT(*) as count FROM memory_summaries').get().count;

  let embeddings = 0;
  if (vecLoaded) {
    try {
      embeddings = db.prepare('SELECT COUNT(*) as count FROM memory_embeddings').get().count;
    } catch {}
  }

  return { entities, relationships, facts, summaries, embeddings, vecLoaded };
}

function clearAll() {
  if (vecLoaded) {
    try { db.exec('DELETE FROM memory_embeddings'); } catch {}
  }
  db.exec('DELETE FROM memory_relationships');
  db.exec('DELETE FROM memory_facts');
  db.exec('DELETE FROM memory_summaries');
  db.exec('DELETE FROM memory_entities');
  console.log(`${LOG} All memory cleared`);
}

module.exports = {
  init,
  // Entities
  upsertEntity,
  getEntities,
  getEntitiesByType,
  searchEntities,
  deleteEntity,
  // Relationships
  upsertRelationship,
  getRelationshipsForEntity,
  // Facts
  addFact,
  getRecentFacts,
  searchFactsByKeyword,
  // Embeddings
  storeFactEmbedding,
  searchByEmbedding,
  // Summaries
  addSummary,
  getRecentSummaries,
  // Stats
  getStats,
  clearAll,
};
