// Knowledge Base storage layer
// Manages collections, documents, chunks, and vector embeddings
// Uses sqlite-vec for semantic search on top of better-sqlite3

const path = require('path');
const fs = require('fs');

let db = null;
let vecLoaded = false;

// ── Init ────────────────────────────────────────────────────────

function init(database) {
  db = database;
  loadVecExtension();
  createKBTables();
}

function loadVecExtension() {
  try {
    const sqliteVec = require('sqlite-vec');
    sqliteVec.load(db);
    vecLoaded = true;
    console.log('[KB] sqlite-vec loaded');
  } catch (err) {
    console.warn('[KB] sqlite-vec not available, vector search disabled:', err.message);
    vecLoaded = false;
  }
}

function createKBTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS kb_collections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS kb_documents (
      id TEXT PRIMARY KEY,
      collection_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      source_type TEXT NOT NULL DEFAULT 'paste',
      original_filename TEXT,
      content TEXT NOT NULL,
      char_count INTEGER DEFAULT 0,
      chunk_count INTEGER DEFAULT 0,
      embedded INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (collection_id) REFERENCES kb_collections(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_kb_docs_collection
      ON kb_documents(collection_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS kb_chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      collection_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      token_estimate INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (document_id) REFERENCES kb_documents(id) ON DELETE CASCADE,
      FOREIGN KEY (collection_id) REFERENCES kb_collections(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_kb_chunks_doc
      ON kb_chunks(document_id, chunk_index);

    CREATE INDEX IF NOT EXISTS idx_kb_chunks_collection
      ON kb_chunks(collection_id);
  `);

  // Migration: add description column to existing kb_documents tables
  try {
    db.prepare("SELECT description FROM kb_documents LIMIT 1").get();
  } catch {
    try { db.exec("ALTER TABLE kb_documents ADD COLUMN description TEXT DEFAULT ''"); } catch {}
  }

  // Create vec virtual table if extension loaded
  if (vecLoaded) {
    try {
      // Check if table exists with wrong dimensions and recreate
      try {
        const testVec = new Float32Array(768);
        const testBuf = Buffer.from(testVec.buffer);
        db.prepare('SELECT chunk_id FROM kb_embeddings WHERE embedding MATCH ? AND k = 1').all(testBuf);
      } catch (dimErr) {
        // Dimension mismatch or table doesn't exist — drop and recreate
        try { db.exec('DROP TABLE IF EXISTS kb_embeddings'); } catch {}
      }

      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS kb_embeddings
        USING vec0(chunk_id TEXT PRIMARY KEY, embedding float[768]);
      `);
      console.log('[KB] vec0 virtual table ready (768 dimensions)');
    } catch (err) {
      console.warn('[KB] Failed to create vec0 table:', err.message);
      vecLoaded = false;
    }
  }
}

// ── Collections CRUD ────────────────────────────────────────────

function createCollection({ id, name, description }) {
  const stmt = db.prepare(`
    INSERT INTO kb_collections (id, name, description) VALUES (?, ?, ?)
  `);
  stmt.run(id, name, description || '');
  return { id, name, description };
}

function getCollections() {
  return db.prepare(`
    SELECT c.*, 
      (SELECT COUNT(*) FROM kb_documents WHERE collection_id = c.id) as doc_count,
      (SELECT COUNT(*) FROM kb_chunks WHERE collection_id = c.id) as chunk_count
    FROM kb_collections c ORDER BY c.updated_at DESC
  `).all();
}

function getCollection(id) {
  return db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM kb_documents WHERE collection_id = c.id) as doc_count,
      (SELECT COUNT(*) FROM kb_chunks WHERE collection_id = c.id) as chunk_count
    FROM kb_collections c WHERE c.id = ?
  `).get(id) || null;
}

function updateCollection(id, { name, description }) {
  db.prepare(`
    UPDATE kb_collections SET name = ?, description = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(name, description || '', id);
  return getCollection(id);
}

function deleteCollection(id) {
  // Chunks and docs cascade. Remove embeddings manually.
  if (vecLoaded) {
    const chunkIds = db.prepare(
      'SELECT id FROM kb_chunks WHERE collection_id = ?'
    ).all(id).map(r => r.id);
    if (chunkIds.length) {
      const del = db.prepare('DELETE FROM kb_embeddings WHERE chunk_id = ?');
      for (const cid of chunkIds) del.run(cid);
    }
  }
  db.prepare('DELETE FROM kb_collections WHERE id = ?').run(id);
  return true;
}

// ── Documents CRUD ──────────────────────────────────────────────

function addDocument({ id, collectionId, title, sourceType, originalFilename, content, description }) {
  const charCount = content.length;
  db.prepare(`
    INSERT INTO kb_documents (id, collection_id, title, description, source_type, original_filename, content, char_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, collectionId, title, description || '', sourceType || 'paste', originalFilename || null, content, charCount);

  // Auto-chunk
  const chunks = chunkText(content, id, collectionId);
  const insertChunk = db.prepare(`
    INSERT INTO kb_chunks (id, document_id, collection_id, chunk_index, content, token_estimate)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertMany = db.transaction((items) => {
    for (const c of items) insertChunk.run(c.id, c.document_id, c.collection_id, c.chunk_index, c.content, c.token_estimate);
  });
  insertMany(chunks);

  // Update chunk count
  db.prepare('UPDATE kb_documents SET chunk_count = ? WHERE id = ?').run(chunks.length, id);
  // Touch collection
  db.prepare("UPDATE kb_collections SET updated_at = datetime('now') WHERE id = ?").run(collectionId);

  return { id, collectionId, title, charCount, chunkCount: chunks.length };
}

function getDocuments(collectionId) {
  return db.prepare(`
    SELECT id, collection_id, title, description, source_type, original_filename, char_count, chunk_count, embedded, created_at, updated_at
    FROM kb_documents WHERE collection_id = ? ORDER BY created_at DESC
  `).all(collectionId);
}

function getDocument(id) {
  return db.prepare('SELECT * FROM kb_documents WHERE id = ?').get(id) || null;
}

function updateDocument(id, { title, content, description }) {
  const doc = db.prepare('SELECT collection_id FROM kb_documents WHERE id = ?').get(id);
  if (!doc) return null;

  // Update description if provided
  if (description !== undefined) {
    db.prepare('UPDATE kb_documents SET description = ? WHERE id = ?').run(description || '', id);
  }

  const charCount = content.length;

  // Generate new chunks
  const newChunks = chunkText(content, id, doc.collection_id);

  // Get existing chunks with their content for comparison
  const oldChunks = db.prepare('SELECT id, chunk_index, content FROM kb_chunks WHERE document_id = ? ORDER BY chunk_index').all(id);

  // Build a map of old chunk content hashes to chunk IDs (for reuse)
  const oldContentMap = new Map(); // content -> { id, hasEmbedding }
  for (const oc of oldChunks) {
    const hasEmb = db.prepare('SELECT 1 FROM kb_embeddings WHERE chunk_id = ? LIMIT 1').get(oc.id);
    oldContentMap.set(oc.content, { id: oc.id, hasEmbedding: !!hasEmb });
  }

  // Determine which new chunks match old content (keep their embeddings)
  const chunksToInsert = [];
  const chunkIdsToKeep = new Set();
  let keptEmbeddings = 0;

  for (const nc of newChunks) {
    const match = oldContentMap.get(nc.content);
    if (match) {
      // Content unchanged — keep the old chunk and its embedding
      chunkIdsToKeep.add(match.id);
      if (match.hasEmbedding) keptEmbeddings++;
      // Update chunk_index if it changed
      db.prepare('UPDATE kb_chunks SET chunk_index = ? WHERE id = ?').run(nc.chunk_index, match.id);
      oldContentMap.delete(nc.content); // consume the match so duplicates don't reuse
    } else {
      // New or modified content — insert fresh chunk
      chunksToInsert.push(nc);
    }
  }

  // Delete old chunks that weren't matched (their content changed or was removed)
  for (const oc of oldChunks) {
    if (!chunkIdsToKeep.has(oc.id)) {
      db.prepare('DELETE FROM kb_embeddings WHERE chunk_id = ?').run(oc.id);
      db.prepare('DELETE FROM kb_chunks WHERE id = ?').run(oc.id);
    }
  }

  // Insert new/modified chunks
  const insertChunk = db.prepare(`
    INSERT INTO kb_chunks (id, document_id, collection_id, chunk_index, content, token_estimate)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertMany = db.transaction((items) => {
    for (const c of items) insertChunk.run(c.id, c.document_id, c.collection_id, c.chunk_index, c.content, c.token_estimate);
  });
  insertMany(chunksToInsert);

  // Update document
  const hasUnembedded = chunksToInsert.length > 0;
  db.prepare(`
    UPDATE kb_documents SET title = ?, content = ?, char_count = ?, chunk_count = ?,
      embedded = CASE WHEN ? THEN 0 ELSE embedded END, updated_at = datetime('now')
    WHERE id = ?
  `).run(title, content, charCount, newChunks.length, hasUnembedded ? 1 : 0, id);

  db.prepare("UPDATE kb_collections SET updated_at = datetime('now') WHERE id = ?").run(doc.collection_id);

  return { id, charCount, chunkCount: newChunks.length, newChunks: chunksToInsert.length, keptEmbeddings };
}

function deleteDocument(id) {
  const doc = db.prepare('SELECT collection_id FROM kb_documents WHERE id = ?').get(id);
  removeChunksForDocument(id);
  db.prepare('DELETE FROM kb_documents WHERE id = ?').run(id);
  if (doc) {
    db.prepare("UPDATE kb_collections SET updated_at = datetime('now') WHERE id = ?").run(doc.collection_id);
  }
  return true;
}

function removeChunksForDocument(docId) {
  if (vecLoaded) {
    const chunkIds = db.prepare('SELECT id FROM kb_chunks WHERE document_id = ?').all(docId).map(r => r.id);
    const del = db.prepare('DELETE FROM kb_embeddings WHERE chunk_id = ?');
    for (const cid of chunkIds) del.run(cid);
  }
  db.prepare('DELETE FROM kb_chunks WHERE document_id = ?').run(docId);
}

// ── Chunking ────────────────────────────────────────────────────

function chunkText(text, documentId, collectionId, chunkSize = 500, overlap = 50) {
  // Split by paragraphs first, then merge into ~chunkSize token chunks
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim());
  const chunks = [];
  let current = '';
  let index = 0;

  for (const para of paragraphs) {
    const paraTokens = estimateTokens(para);

    if (estimateTokens(current) + paraTokens > chunkSize && current.trim()) {
      chunks.push(makeChunk(current.trim(), index++, documentId, collectionId));
      // Keep overlap from end of current chunk
      const words = current.trim().split(/\s+/);
      current = words.slice(-overlap).join(' ') + '\n\n';
    }
    current += para + '\n\n';
  }

  if (current.trim()) {
    chunks.push(makeChunk(current.trim(), index, documentId, collectionId));
  }

  // If no paragraphs found (single block), chunk by sentences
  if (chunks.length === 0 && text.trim()) {
    chunks.push(makeChunk(text.trim(), 0, documentId, collectionId));
  }

  return chunks;
}

function makeChunk(content, index, documentId, collectionId) {
  const id = `chunk_${documentId}_${index}`;
  return {
    id,
    document_id: documentId,
    collection_id: collectionId,
    chunk_index: index,
    content,
    token_estimate: estimateTokens(content),
  };
}

function estimateTokens(text) {
  // Rough estimate: ~4 chars per token for English
  return Math.ceil(text.length / 4);
}

// ── Embeddings ──────────────────────────────────────────────────

function storeEmbeddings(items) {
  // items: [{ chunkId, embedding: Float32Array }]
  if (!vecLoaded) return { stored: 0 };

  const stmt = db.prepare('INSERT OR REPLACE INTO kb_embeddings (chunk_id, embedding) VALUES (?, ?)');
  const insertMany = db.transaction((rows) => {
    for (const row of rows) {
      stmt.run(row.chunkId, Buffer.from(row.embedding.buffer));
    }
  });
  insertMany(items);

  // Mark documents as embedded
  const docIds = new Set();
  for (const item of items) {
    const chunk = db.prepare('SELECT document_id FROM kb_chunks WHERE id = ?').get(item.chunkId);
    if (chunk) docIds.add(chunk.document_id);
  }
  for (const docId of docIds) {
    db.prepare('UPDATE kb_documents SET embedded = 1 WHERE id = ?').run(docId);
  }

  return { stored: items.length };
}

function getUnembeddedChunks(collectionId, limit = 100) {
  // Get chunks that don't have embeddings yet
  if (!vecLoaded) {
    return db.prepare(`
      SELECT id, content FROM kb_chunks WHERE collection_id = ? LIMIT ?
    `).all(collectionId, limit);
  }

  return db.prepare(`
    SELECT c.id, c.content FROM kb_chunks c
    LEFT JOIN kb_embeddings e ON c.id = e.chunk_id
    WHERE c.collection_id = ? AND e.chunk_id IS NULL
    LIMIT ?
  `).all(collectionId, limit);
}

function searchSimilar(queryEmbedding, collectionId, topK = 5) {
  if (!vecLoaded) return [];

  const queryBuf = Buffer.from(queryEmbedding.buffer);
  let query;
  let params;

  if (collectionId) {
    query = `
      SELECT e.chunk_id, e.distance, c.content, c.document_id, d.title as doc_title
      FROM kb_embeddings e
      JOIN kb_chunks c ON e.chunk_id = c.id
      JOIN kb_documents d ON c.document_id = d.id
      WHERE e.embedding MATCH ? AND k = ?
        AND c.collection_id = ?
      ORDER BY e.distance
    `;
    params = [queryBuf, topK, collectionId];
  } else {
    query = `
      SELECT e.chunk_id, e.distance, c.content, c.document_id, d.title as doc_title
      FROM kb_embeddings e
      JOIN kb_chunks c ON e.chunk_id = c.id
      JOIN kb_documents d ON c.document_id = d.id
      WHERE e.embedding MATCH ? AND k = ?
      ORDER BY e.distance
    `;
    params = [queryBuf, topK];
  }

  try {
    return db.prepare(query).all(...params);
  } catch (err) {
    console.error('[KB] Vector search error:', err.message);
    return [];
  }
}

/**
 * Search across multiple collections and/or specific documents
 * @param {Float32Array} queryEmbedding - The query vector
 * @param {Array} selections - [{ collectionId, documentId? }]
 * @param {number} topK - Number of results per source
 * @returns {Array} Combined and sorted results
 */
function searchMultiple(queryEmbedding, selections, topK = 5) {
  if (!vecLoaded || !selections || selections.length === 0) return [];

  const queryBuf = Buffer.from(queryEmbedding.buffer);
  const allResults = [];

  for (const sel of selections) {
    try {
      let query;
      let params;

      if (sel.documentId) {
        // Search within a specific document
        query = `
          SELECT e.chunk_id, e.distance, c.content, c.document_id, d.title as doc_title
          FROM kb_embeddings e
          JOIN kb_chunks c ON e.chunk_id = c.id
          JOIN kb_documents d ON c.document_id = d.id
          WHERE e.embedding MATCH ? AND k = ?
            AND c.document_id = ?
          ORDER BY e.distance
        `;
        params = [queryBuf, topK, sel.documentId];
      } else {
        // Search whole collection
        query = `
          SELECT e.chunk_id, e.distance, c.content, c.document_id, d.title as doc_title
          FROM kb_embeddings e
          JOIN kb_chunks c ON e.chunk_id = c.id
          JOIN kb_documents d ON c.document_id = d.id
          WHERE e.embedding MATCH ? AND k = ?
            AND c.collection_id = ?
          ORDER BY e.distance
        `;
        params = [queryBuf, topK, sel.collectionId];
      }

      const results = db.prepare(query).all(...params);
      allResults.push(...results);
    } catch (err) {
      console.error('[KB] Vector search error for selection:', sel, err.message);
    }
  }

  // Deduplicate by chunk_id and sort by distance, take top K
  const seen = new Set();
  const unique = [];
  for (const r of allResults.sort((a, b) => (a.distance || 0) - (b.distance || 0))) {
    if (!seen.has(r.chunk_id)) {
      seen.add(r.chunk_id);
      unique.push(r);
    }
  }

  return unique.slice(0, topK);
}

// ── Stats ───────────────────────────────────────────────────────

function getKBStats() {
  const collections = db.prepare('SELECT COUNT(*) as count FROM kb_collections').get().count;
  const documents = db.prepare('SELECT COUNT(*) as count FROM kb_documents').get().count;
  const chunks = db.prepare('SELECT COUNT(*) as count FROM kb_chunks').get().count;
  const embedded = db.prepare('SELECT COUNT(*) as count FROM kb_documents WHERE embedded = 1').get().count;

  let embeddingCount = 0;
  if (vecLoaded) {
    try {
      embeddingCount = db.prepare('SELECT COUNT(*) as count FROM kb_embeddings').get().count;
    } catch { /* table might not exist */ }
  }

  return { collections, documents, chunks, embedded, embeddingCount, vecLoaded };
}

function isVecLoaded() {
  return vecLoaded;
}

module.exports = {
  init,
  isVecLoaded,
  // Collections
  createCollection,
  getCollections,
  getCollection,
  updateCollection,
  deleteCollection,
  // Documents
  addDocument,
  getDocuments,
  getDocument,
  updateDocument,
  deleteDocument,
  // Embeddings
  storeEmbeddings,
  getUnembeddedChunks,
  searchSimilar,
  searchMultiple,
  // Stats
  getKBStats,
};
