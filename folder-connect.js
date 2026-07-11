// Folder Connect — watches local folders and indexes supported files into KB
// Integrates with kb-storage for chunking and embedding

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

let db = null;
let watchers = new Map(); // folderId -> chokidar watcher
let kbStorageRef = null;

const SUPPORTED_EXTS = ['.pdf', '.docx', '.txt', '.md', '.csv'];

// ── Init ────────────────────────────────────────────────────────

function init(database, kbStorage) {
  db = database;
  kbStorageRef = kbStorage;
  createTables();
}

function createTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS kb_folders (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      file_count INTEGER DEFAULT 0,
      last_synced TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS kb_folder_files (
      id TEXT PRIMARY KEY,
      folder_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_hash TEXT,
      last_modified TEXT,
      indexed_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (folder_id) REFERENCES kb_folders(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_folder_files_folder
      ON kb_folder_files(folder_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_folder_files_path
      ON kb_folder_files(folder_id, file_path);
  `);
}

// ── CRUD ────────────────────────────────────────────────────────

function addFolder(folderPath) {
  const name = path.basename(folderPath);
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO kb_folders (id, path, name) VALUES (?, ?, ?)
  `).run(id, folderPath, name);

  // Create a corresponding KB collection so the folder appears in chat/assistant KB selector
  if (kbStorageRef) {
    try {
      kbStorageRef.createCollection({ id, name: `📁 ${name}`, description: `Auto-synced from: ${folderPath}` });
    } catch (err) {
      console.warn('[FolderConnect] Failed to create KB collection:', err.message);
    }
  }

  return { id, path: folderPath, name, file_count: 0, status: 'active' };
}

function getFolders() {
  return db.prepare('SELECT * FROM kb_folders ORDER BY created_at DESC').all();
}

function removeFolder(id) {
  // Stop watcher first
  stopWatchingFolder(id);
  // Remove KB collection (cascades to documents, chunks, embeddings)
  if (kbStorageRef) {
    try { kbStorageRef.deleteCollection(id); } catch {}
  }
  // Remove indexed files and folder record
  db.prepare('DELETE FROM kb_folder_files WHERE folder_id = ?').run(id);
  db.prepare('DELETE FROM kb_folders WHERE id = ?').run(id);
  return true;
}

function getFilesForFolder(folderId) {
  return db.prepare('SELECT * FROM kb_folder_files WHERE folder_id = ? ORDER BY file_path').all(folderId);
}

function upsertFile(folderId, filePath, fileHash, lastModified) {
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO kb_folder_files (id, folder_id, file_path, file_hash, last_modified, indexed_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(folder_id, file_path) DO UPDATE SET
      file_hash = excluded.file_hash,
      last_modified = excluded.last_modified,
      indexed_at = datetime('now')
  `).run(id, folderId, filePath, fileHash, lastModified);
}

function removeFile(folderId, filePath) {
  db.prepare('DELETE FROM kb_folder_files WHERE folder_id = ? AND file_path = ?').run(folderId, filePath);
}

function updateFolderStats(folderId) {
  const count = db.prepare('SELECT COUNT(*) as cnt FROM kb_folder_files WHERE folder_id = ?').get(folderId);
  db.prepare(`UPDATE kb_folders SET file_count = ?, last_synced = datetime('now') WHERE id = ?`)
    .run(count?.cnt || 0, folderId);
}

// ── File Parsing ────────────────────────────────────────────────

async function parseFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!SUPPORTED_EXTS.includes(ext)) return null;

  try {
    const buffer = fs.readFileSync(filePath);

    if (ext === '.txt' || ext === '.md') {
      return buffer.toString('utf-8');
    } else if (ext === '.csv') {
      return buffer.toString('utf-8');
    } else if (ext === '.pdf') {
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(buffer);
      return data.text || '';
    } else if (ext === '.docx') {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      return result.value || '';
    }
  } catch (err) {
    console.warn('[FolderConnect] Parse error for', filePath, err.message);
    return null;
  }
  return null;
}

function computeFileHash(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    return crypto.createHash('md5').update(buffer).digest('hex');
  } catch {
    return null;
  }
}

// ── Watching ────────────────────────────────────────────────────

function startWatching(folderId, progressCb) {
  const folder = db.prepare('SELECT * FROM kb_folders WHERE id = ?').get(folderId);
  if (!folder) return;

  // Don't double-watch
  if (watchers.has(folderId)) return;

  let chokidar;
  try {
    chokidar = require('chokidar');
  } catch {
    console.warn('[FolderConnect] chokidar not available');
    return;
  }

  const watcher = chokidar.watch(folder.path, {
    ignored: /(^|[\/\\])\../, // ignore dotfiles
    persistent: true,
    ignoreInitial: true,
    depth: 10,
  });

  watcher.on('add', (filePath) => handleFileChange(folderId, filePath, progressCb));
  watcher.on('change', (filePath) => handleFileChange(folderId, filePath, progressCb));
  watcher.on('unlink', (filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    if (!SUPPORTED_EXTS.includes(ext)) return;
    // Remove KB document
    if (kbStorageRef) {
      const docId = `folder_${folderId}_${crypto.createHash('md5').update(filePath).digest('hex')}`;
      try { kbStorageRef.deleteDocument(docId); } catch {}
    }
    removeFile(folderId, filePath);
    updateFolderStats(folderId);
  });

  watchers.set(folderId, watcher);
  db.prepare("UPDATE kb_folders SET status = 'watching' WHERE id = ?").run(folderId);
}

function stopWatchingFolder(folderId) {
  const watcher = watchers.get(folderId);
  if (watcher) {
    watcher.close();
    watchers.delete(folderId);
  }
}

function stopWatching() {
  for (const [id, watcher] of watchers) {
    watcher.close();
  }
  watchers.clear();
}

async function handleFileChange(folderId, filePath, progressCb) {
  const ext = path.extname(filePath).toLowerCase();
  if (!SUPPORTED_EXTS.includes(ext)) return;

  const hash = computeFileHash(filePath);
  const existing = db.prepare(
    'SELECT file_hash FROM kb_folder_files WHERE folder_id = ? AND file_path = ?'
  ).get(folderId, filePath);

  // Skip if unchanged
  if (existing && existing.file_hash === hash) return;

  const content = await parseFile(filePath);
  if (!content || !content.trim()) return;

  const stat = fs.statSync(filePath);
  upsertFile(folderId, filePath, hash, stat.mtime.toISOString());
  updateFolderStats(folderId);

  // Add/update document in KB collection for RAG
  if (kbStorageRef) {
    const docId = `folder_${folderId}_${crypto.createHash('md5').update(filePath).digest('hex')}`;
    const title = path.basename(filePath);
    try {
      const existingDoc = kbStorageRef.getDocument(docId);
      if (existingDoc) {
        kbStorageRef.updateDocument(docId, { title, content });
      } else {
        kbStorageRef.addDocument({ id: docId, collectionId: folderId, title, sourceType: 'folder', originalFilename: path.basename(filePath), content });
      }
    } catch (err) {
      console.warn('[FolderConnect] KB document error:', err.message);
    }
  }

  if (progressCb) progressCb({ folderId, filePath, status: 'indexed' });
}

// ── Full Index ──────────────────────────────────────────────────

async function indexFolder(folderId, progressCb) {
  const folder = db.prepare('SELECT * FROM kb_folders WHERE id = ?').get(folderId);
  if (!folder || !fs.existsSync(folder.path)) return { error: 'Folder not found' };

  db.prepare("UPDATE kb_folders SET status = 'indexing' WHERE id = ?").run(folderId);

  const files = getAllSupportedFiles(folder.path);
  let indexed = 0;

  for (const filePath of files) {
    const hash = computeFileHash(filePath);
    const content = await parseFile(filePath);
    if (!content || !content.trim()) continue;

    const stat = fs.statSync(filePath);
    upsertFile(folderId, filePath, hash, stat.mtime.toISOString());

    // Add document to KB collection for RAG
    if (kbStorageRef) {
      const docId = `folder_${folderId}_${crypto.createHash('md5').update(filePath).digest('hex')}`;
      const title = path.basename(filePath);
      try {
        const existingDoc = kbStorageRef.getDocument(docId);
        if (existingDoc) {
          kbStorageRef.updateDocument(docId, { title, content });
        } else {
          kbStorageRef.addDocument({ id: docId, collectionId: folderId, title, sourceType: 'folder', originalFilename: path.basename(filePath), content });
        }
      } catch (err) {
        console.warn('[FolderConnect] KB document error:', err.message);
      }
    }

    indexed++;

    if (progressCb) {
      progressCb({ folderId, indexed, total: files.length, filePath });
    }
  }

  updateFolderStats(folderId);
  db.prepare("UPDATE kb_folders SET status = 'active' WHERE id = ?").run(folderId);

  if (progressCb) progressCb({ folderId, indexed, total: files.length, done: true });
  return { indexed, total: files.length };
}

// ── KG Processing ───────────────────────────────────────────────
// Standalone operation: reads all files in a folder and sends them through
// an LLM extractor to populate the Cortex Knowledge Graph with entities/facts.

async function processKG(folderId, extractor, progressCb) {
  const folder = db.prepare('SELECT * FROM kb_folders WHERE id = ?').get(folderId);
  if (!folder || !fs.existsSync(folder.path)) return { error: 'Folder not found' };

  const files = getAllSupportedFiles(folder.path);
  if (!files.length) return { processed: 0, total: 0 };

  if (progressCb) progressCb({ folderId, processed: 0, total: files.length, phase: 'start' });

  let processed = 0;
  for (const filePath of files) {
    const content = await parseFile(filePath);
    if (!content || !content.trim()) { processed++; continue; }

    // Chunk content into ~3000 char segments for the LLM
    const segments = chunkForExtraction(content);
    const fileName = path.basename(filePath);

    for (const segment of segments) {
      try {
        const prefixed = `[Document: ${fileName}]\n${segment}`;
        const extracted = await extractor.extract(prefixed, '');
        if (extracted) {
          await extractor.processExtraction(extracted);
        }
      } catch (err) {
        console.warn('[FolderConnect] KG extraction error:', fileName, err.message);
      }
    }

    processed++;
    if (progressCb) progressCb({ folderId, processed, total: files.length, filePath: fileName });
  }

  if (progressCb) progressCb({ folderId, processed, total: files.length, phase: 'done' });
  return { processed, total: files.length };
}

function chunkForExtraction(content) {
  const MAX_LEN = 3000;
  if (content.length <= MAX_LEN) return [content];

  const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim());
  const segments = [];
  let current = '';

  for (const para of paragraphs) {
    if (current.length + para.length > MAX_LEN && current.trim()) {
      segments.push(current.trim());
      current = '';
    }
    current += para + '\n\n';
  }
  if (current.trim()) segments.push(current.trim());
  return segments;
}

function getAllSupportedFiles(dirPath, depth = 0) {
  if (depth > 10) return [];
  const results = [];

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        results.push(...getAllSupportedFiles(fullPath, depth + 1));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (SUPPORTED_EXTS.includes(ext)) results.push(fullPath);
      }
    }
  } catch (err) {
    console.warn('[FolderConnect] Read dir error:', dirPath, err.message);
  }

  return results;
}

module.exports = {
  init,
  addFolder,
  getFolders,
  removeFolder,
  getFilesForFolder,
  upsertFile,
  removeFile,
  startWatching,
  stopWatching,
  indexFolder,
  processKG,
};
