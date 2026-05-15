// Client Workspace — Project Management Plugin
// Create projects, save AI responses as documents, track timelines.
// Works for any professional: recruiters, lawyers, accountants, consultants.

const cwDb = require('./db');
const ui = require('./ui');
const { buildProjectContext, summarizeForTimeline } = require('./context');
const crypto = require('crypto');
const cpu = require('../cortex-lite/cpu');

const LOG = '[ClientWorkspace]';

let context = null;
let store = null;
let kbStorage = null;
let autoEmbedCollection = null;
let getOllamaUrl = null;
let activeProjectId = null;
let lastUserMessage = '';

// ── Plugin Lifecycle ────────────────────────────────────────────

module.exports = {
  activate(ctx) {
    context = ctx;
    store = ctx.store;
    kbStorage = ctx.kbStorage;
    autoEmbedCollection = ctx.autoEmbedCollection;
    getOllamaUrl = ctx.getOllamaUrl;
    console.log(`${LOG} Activating...`);

    cwDb.init(ctx.db);

    // Restore last active project
    activeProjectId = store.get('client-workspace.activeProjectId', null);
    if (activeProjectId) {
      const project = cwDb.getProject(activeProjectId);
      if (!project || project.status === 'archived') {
        activeProjectId = null;
        store.delete('client-workspace.activeProjectId');
      }
    }

    console.log(`${LOG} Activated (active project: ${activeProjectId || 'none'})`);
  },

  deactivate() {
    console.log(`${LOG} Deactivated`);
    context = null;
  },

  // ── Chat Preprocess (CONTEXT INJECTION) ─────────────────────

  async onChatPreprocess({ messages, assistant }) {
    try {
      if (!activeProjectId) return { messages, assistant };

      const project = cwDb.getProject(activeProjectId);
      if (!project) return { messages, assistant };

      const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
      if (lastUserMsg) lastUserMessage = lastUserMsg.content || '';

      console.log(`${LOG} Preprocess running for project "${project.name}" (${activeProjectId}), query: "${lastUserMessage.slice(0, 50)}"`);

      const contextStr = buildProjectContext(project);

      // Vector search project comms via KB embeddings
      const projectData = await this._searchProjectVectors(lastUserMessage, activeProjectId);

      const parts = [];
      if (contextStr) parts.push(contextStr);
      if (projectData) parts.push(projectData);

      if (parts.length === 0) return { messages, assistant };

      const systemMsg = { role: 'system', content: parts.join('\n\n') };
      const systemEnd = messages.findIndex(m => m.role !== 'system');
      const insertAt = systemEnd === -1 ? 0 : systemEnd;
      messages.splice(insertAt, 0, systemMsg);

      return { messages, assistant };
    } catch (err) {
      console.error(`${LOG} Preprocess error:`, err.message);
      return { messages, assistant };
    }
  },

  /**
   * Hybrid search: vector similarity + keyword matching combined.
   * This ensures factual lookups (names, amounts, dates) are found
   * even when vector similarity alone misses them.
   */
  async _searchProjectVectors(query, projectId) {
    if (!query || query.trim().length < 3) return null;
    if (!kbStorage || !kbStorage.isVecLoaded()) {
      console.log(`${LOG} Vec not loaded, skipping vector search`);
      return null;
    }

    const collectionId = this._getProjectCollectionId(projectId);
    if (!collectionId) {
      console.log(`${LOG} No KB collection for project, skipping vector search`);
      return null;
    }

    const collection = kbStorage.getCollection(collectionId);
    if (!collection || collection.chunk_count === 0) {
      console.log(`${LOG} Project collection empty (0 chunks), skipping vector search`);
      return null;
    }

    // ── KEYWORD SEARCH (BM25-style) ──────────────────────────────
    const stopWords = new Set(['what', 'did', 'for', 'the', 'this', 'that', 'with', 'from', 'have', 'been', 'will', 'would', 'could', 'should', 'about', 'which', 'their', 'there', 'where', 'when', 'how', 'who', 'whom', 'does', 'was', 'are', 'is', 'do', 'can', 'has']);
    const keywords = query.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
    let keywordResults = [];

    if (keywords.length > 0) {
      try {
        // Get all chunks for this collection and score by keyword matches
        const db = context.db;
        const allChunks = db.prepare(
          'SELECT c.id, c.content, d.title as doc_title FROM kb_chunks c JOIN kb_documents d ON c.document_id = d.id WHERE c.collection_id = ?'
        ).all(collectionId);

        const scored = [];
        for (const chunk of allChunks) {
          const lower = chunk.content.toLowerCase();
          let score = 0;
          for (const kw of keywords) {
            // Count occurrences of each keyword
            let idx = 0;
            while ((idx = lower.indexOf(kw, idx)) !== -1) {
              score++;
              idx += kw.length;
            }
          }
          if (score > 0) {
            scored.push({ ...chunk, score });
          }
        }

        // Sort by score descending, take top 10
        scored.sort((a, b) => b.score - a.score);
        keywordResults = scored.slice(0, 10).map(r => ({
          content: r.content,
          docTitle: r.doc_title,
          distance: null,
          source: 'keyword',
          score: r.score,
        }));
        console.log(`${LOG} Keyword search found ${keywordResults.length} matches (top score: ${keywordResults[0]?.score || 0})`);
      } catch (err) {
        console.error(`${LOG} Keyword search error:`, err.message);
      }
    }

    // ── VECTOR SEARCH ────────────────────────────────────────────
    let vectorResults = [];
    try {
      const ollamaUrl = getOllamaUrl();
      console.log(`${LOG} Embedding query for project vector search...`);
      const embedRes = await fetch(`${ollamaUrl}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'nomic-embed-text', input: query }),
      });

      if (embedRes.ok) {
        const embedData = await embedRes.json();
        const queryVec = embedData.embeddings?.[0];
        if (queryVec) {
          const results = kbStorage.searchMultiple(
            new Float32Array(queryVec),
            [{ collectionId }],
            10
          );
          vectorResults = (results || []).map(r => ({
            content: r.content,
            docTitle: r.doc_title,
            distance: r.distance,
            source: 'vector',
          }));
          console.log(`${LOG} Vector search found ${vectorResults.length} chunks (best distance: ${vectorResults[0]?.distance?.toFixed(4) || 'N/A'})`);
        }
      }
    } catch (err) {
      console.error(`${LOG} Vector search error:`, err.message);
    }

    // ── MERGE & DEDUPLICATE ──────────────────────────────────────
    // Keyword results first (they're more precise for factual lookups),
    // then vector results for semantic coverage
    const seen = new Set();
    const merged = [];

    // Keyword matches are highest priority
    for (const r of keywordResults) {
      const key = r.content.slice(0, 100);
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(r);
      }
    }
    // Then vector matches
    for (const r of vectorResults) {
      const key = r.content.slice(0, 100);
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(r);
      }
    }

    if (merged.length === 0) {
      console.log(`${LOG} Hybrid search returned 0 results`);
      return null;
    }

    // Take top 5 combined (RAG search already provides chunks from this collection)
    const top = merged.slice(0, 5);
    console.log(`${LOG} Hybrid search: ${top.length} results (${keywordResults.length} keyword + ${vectorResults.length} vector, ${top.length} after dedup)`);

    const project = cwDb.getProject(projectId);
    const snippets = top.map(r => {
      const label = r.source === 'keyword' ? `keyword match, score: ${r.score}` : `vector, distance: ${r.distance?.toFixed(3)}`;
      return `[Source: ${r.docTitle} (${label})]\n${r.content}`;
    });

    return `[Project Communications — Retrieved via hybrid search (keyword + semantic) from project "${project?.name}". ${top.length} of ${merged.length} matching chunks shown, sorted by relevance.]\n\n${snippets.join('\n\n---\n\n')}\n\n[End Project Communications]`;
  },

  /**
   * Get or create the KB collection ID for a project.
   * Convention: collection ID = "cw_project_<projectId>"
   */
  _getProjectCollectionId(projectId) {
    const collectionId = `cw_project_${projectId}`;
    return collectionId;
  },

  _ensureProjectCollection(projectId) {
    const collectionId = this._getProjectCollectionId(projectId);
    const existing = kbStorage.getCollection(collectionId);
    if (existing) return collectionId;

    const project = cwDb.getProject(projectId);
    const name = project ? `CW: ${project.name}` : `CW: Project ${projectId.slice(0, 8)}`;
    kbStorage.createCollection({
      id: collectionId,
      name,
      description: `Auto-created collection for Client Workspace project communications`,
    });
    console.log(`${LOG} Created KB collection "${name}" (${collectionId})`);
    return collectionId;
  },

  /**
   * Index a comm into the KB vector store.
   * Chunks the content, stores in kb_chunks, triggers auto-embed.
   */
  _indexCommToKB(commId, projectId, content, source, commDate) {
    if (!kbStorage) return;

    const collectionId = this._ensureProjectCollection(projectId);
    const docId = `cw_comm_${commId}`;
    const title = `Comm (${source}) — ${commDate}`;

    // Add as a KB document (this auto-chunks)
    const result = kbStorage.addDocument({
      id: docId,
      collectionId,
      title,
      sourceType: 'comm',
      originalFilename: null,
      content,
      description: `Communication from ${source} on ${commDate}`,
    });

    console.log(`${LOG} Indexed comm to KB: ${result.chunkCount} chunks in collection ${collectionId}`);

    // Fire-and-forget: trigger auto-embed
    if (autoEmbedCollection) {
      autoEmbedCollection(collectionId).catch(err =>
        console.warn(`${LOG} Auto-embed after comm add failed:`, err.message)
      );
    }
  },

  // ── Chat Postprocess (TIMELINE LOGGING) ─────────────────────

  async onChatPostprocess({ response, assistant }) {
    try {
      if (!activeProjectId) return { response, assistant };

      const userMsg = lastUserMessage;
      lastUserMessage = '';

      // Fire-and-forget timeline logging
      setTimeout(() => {
        try {
          if (userMsg) {
            cwDb.addTimelineEntry(activeProjectId, 'chat_user', `You: ${summarizeForTimeline(userMsg)}`);
          }
          if (response) {
            cwDb.addTimelineEntry(activeProjectId, 'chat_ai', `AI: ${summarizeForTimeline(response)}`);
          }
        } catch (err) {
          console.error(`${LOG} Timeline logging error:`, err.message);
        }
      }, 0);

      return { response, assistant };
    } catch (err) {
      console.error(`${LOG} Postprocess error:`, err.message);
      return { response, assistant };
    }
  },

  // ── Event Handler (from renderer via IPC) ────────────────────

  onEvent(eventName, data) {
    if (eventName === 'cw:save-response') {
      return this._handleSaveResponse(data);
    }
    if (eventName === 'cw:get-active-project') {
      if (!activeProjectId) return null;
      return cwDb.getProject(activeProjectId);
    }
    if (eventName === 'cw:list-projects') {
      return cwDb.getAllProjects('active');
    }
    if (eventName === 'cw:create-project') {
      const id = cwDb.createProject({
        name: data.name,
        clientName: data.clientName,
        clientEmail: data.clientEmail,
        notes: data.notes,
      });
      this._ensureProjectDirs(id);
      activeProjectId = id;
      store.set('client-workspace.activeProjectId', id);
      return { success: true, id };
    }
    if (eventName === 'cw:select-project') {
      activeProjectId = data.id;
      store.set('client-workspace.activeProjectId', data.id);
      return { success: true };
    }
    if (eventName === 'cw:deselect-project') {
      activeProjectId = null;
      store.delete('client-workspace.activeProjectId');
      return { success: true };
    }
    if (eventName === 'cw:archive-project') {
      cwDb.archiveProject(data.id);
      if (activeProjectId === data.id) {
        activeProjectId = null;
        store.delete('client-workspace.activeProjectId');
      }
      return { success: true };
    }
    if (eventName === 'cw:open-document') {
      return cwDb.getDocument(data.id);
    }
    if (eventName === 'cw:update-document') {
      return cwDb.updateDocument(data.id, {
        title: data.title,
        description: data.description,
        content: data.content,
        status: data.status,
      });
    }
    if (eventName === 'cw:delete-document') {
      return cwDb.deleteDocument(data.id);
    }
    if (eventName === 'cw:update-project') {
      return cwDb.updateProject(data.id, {
        name: data.name,
        clientEmail: data.clientEmail,
        notes: data.notes,
      });
    }
    if (eventName === 'cw:delete-project') {
      cwDb.deleteProject(data.id);
      if (activeProjectId === data.id) {
        activeProjectId = null;
        store.delete('client-workspace.activeProjectId');
      }
      return { success: true };
    }
    if (eventName === 'cw:get-documents') {
      return cwDb.getDocumentsForProject(data.projectId);
    }
    if (eventName === 'cw:get-project-conversations') {
      // Get conversations linked to this project from main storage
      if (context && context.db) {
        try {
          return context.db.prepare(
            'SELECT id, title, updated_at FROM conversations WHERE project_id = ? ORDER BY updated_at DESC LIMIT 30'
          ).all(data.projectId);
        } catch { return []; }
      }
      return [];
    }
    if (eventName === 'cw:stamp-conversation-project') {
      // Stamp project_id on a conversation that doesn't have one yet
      if (context && context.db && data.conversationId && data.projectId) {
        try {
          context.db.prepare(
            'UPDATE conversations SET project_id = ? WHERE id = ? AND (project_id IS NULL OR project_id = ?)'
          ).run(data.projectId, data.conversationId, data.projectId);
          return { success: true };
        } catch { return { success: false }; }
      }
      return { success: false };
    }
    if (eventName === 'cw:get-timeline') {
      return cwDb.getTimeline(data.projectId, data.limit || 50);
    }
    if (eventName === 'cw:get-time-entries') {
      return cwDb.getTimeEntries(data.projectId);
    }
    if (eventName === 'cw:add-comm') {
      const id = cwDb.addComm({
        projectId: data.projectId,
        source: data.source,
        content: data.content,
        commDate: data.commDate,
        summary: data.summary,
      });

      // Index into KB vector store for RAG search
      this._indexCommToKB(id, data.projectId, data.content, data.source || 'other', data.commDate || new Date().toISOString().split('T')[0]);

      // CPU: extract entities/relationships/facts into local KG (fire-and-forget)
      const project = cwDb.getProject(data.projectId);
      cpu.processAsync({
        content: data.content,
        source: 'comm',
        metadata: {
          projectId: data.projectId,
          projectName: project?.name,
          clientName: project?.client_name,
          commDate: data.commDate,
          commSource: data.source,
        },
      });

      return { success: true, id };
    }
    if (eventName === 'cw:get-comms') {
      return cwDb.getComms(data.projectId, data.limit);
    }
    if (eventName === 'cw:delete-comm') {
      // Also remove from KB
      const comm = cwDb.getComm(data.id);
      if (comm) {
        const docId = `cw_comm_${data.id}`;
        try { kbStorage.deleteDocument(docId); } catch (e) { /* ignore if not found */ }
      }
      return cwDb.deleteComm(data.id);
    }
    if (eventName === 'cw:open-comm') {
      return cwDb.getComm(data.id);
    }
    if (eventName === 'cw:reindex-comms') {
      return this._reindexAllComms(data.projectId);
    }
    if (eventName === 'cw:create-task') {
      const id = cwDb.createTask({
        projectId: data.projectId,
        title: data.title,
        description: data.description,
        status: data.status,
        dueDate: data.dueDate,
      });
      return { success: true, id };
    }
    if (eventName === 'cw:get-tasks') {
      return cwDb.getTasks(data.projectId);
    }
    if (eventName === 'cw:get-task') {
      return cwDb.getTask(data.id);
    }
    if (eventName === 'cw:update-task') {
      return cwDb.updateTask(data.id, {
        title: data.title,
        description: data.description,
        status: data.status,
        dueDate: data.dueDate,
        position: data.position,
      });
    }
    if (eventName === 'cw:delete-task') {
      return cwDb.deleteTask(data.id);
    }
    if (eventName === 'cw:get-kanban-tasks') {
      return cwDb.getKanbanTasks();
    }
    if (eventName === 'cw:toggle-task-kanban') {
      return cwDb.toggleTaskKanban(data.id, data.onKanban);
    }
    if (eventName === 'cw:connect-folder') {
      const id = cwDb.addProjectFolder({
        projectId: data.projectId,
        folderPath: data.folderPath,
        folderName: data.folderName,
        autoIndex: data.autoIndex || false,
      });
      return { success: true, id };
    }
    if (eventName === 'cw:get-folders') {
      return cwDb.getProjectFolders(data.projectId);
    }
    if (eventName === 'cw:remove-folder') {
      return cwDb.removeProjectFolder(data.id);
    }
    if (eventName === 'cw:toggle-folder-index') {
      return cwDb.updateProjectFolder(data.id, { autoIndex: data.autoIndex });
    }
    // ── Project Files (disk-based files/ folder) ─────────────────
    if (eventName === 'cw:get-project-files') {
      const filesDir = this._getFilesDir(data.projectId);
      this._ensureFilesDir(data.projectId);
      const files = this._listProjectFiles(data.projectId);
      const scanMeta = store.get(`client-workspace.lastScan.${data.projectId}`, null);
      return { filesDir, files, lastScan: scanMeta };
    }
    if (eventName === 'cw:get-files-path') {
      const filesDir = this._getFilesDir(data.projectId);
      this._ensureFilesDir(data.projectId);
      return { path: filesDir };
    }
    if (eventName === 'cw:scan-index-files') {
      return this._scanAndIndexFiles(data.projectId);
    }
    // ── Billing ──────────────────────────────────────────────────
    if (eventName === 'cw:create-billing-item') {
      const id = cwDb.createBillingItem({
        projectId: data.projectId,
        name: data.name,
        amount: data.amount,
      });
      return { success: true, id };
    }
    if (eventName === 'cw:get-billing-items') {
      return cwDb.getBillingItems(data.projectId);
    }
    if (eventName === 'cw:get-billing-item') {
      return cwDb.getBillingItem(data.id);
    }
    if (eventName === 'cw:update-billing-item') {
      return cwDb.updateBillingItem(data.id, {
        name: data.name,
        amount: data.amount,
        completed: data.completed,
        billed: data.billed,
        paid: data.paid,
      });
    }
    if (eventName === 'cw:delete-billing-item') {
      return cwDb.deleteBillingItem(data.id);
    }
    // ── Notes ──────────────────────────────────────────────────
    if (eventName === 'cw:get-notes') {
      return this._getNotes(data.projectId);
    }
    if (eventName === 'cw:get-note') {
      return this._getNote(data.projectId, data.filename);
    }
    if (eventName === 'cw:create-note') {
      return this._createNote(data.projectId, data.title, data.content);
    }
    if (eventName === 'cw:update-note') {
      return this._updateNote(data.projectId, data.filename, data.content);
    }
    if (eventName === 'cw:delete-note') {
      return this._deleteNote(data.projectId, data.filename);
    }
    if (eventName === 'cw:get-notes-path') {
      return this._getNotesPath(data.projectId);
    }
    return null;
  },

  /**
   * Re-index all comms for a project into the KB vector store.
   * Use this after the RAG fix to make existing comms searchable.
   */
  _reindexAllComms(projectId) {
    if (!kbStorage) return { success: false, error: 'KB storage not available' };

    const comms = cwDb.getComms(projectId, 9999);
    if (!comms || comms.length === 0) return { success: true, indexed: 0 };

    console.log(`${LOG} Re-indexing ${comms.length} comms for project ${projectId}`);

    const collectionId = this._ensureProjectCollection(projectId);

    // Delete existing comm documents from this collection to avoid duplicates
    const existingDocs = kbStorage.getDocuments(collectionId);
    for (const doc of existingDocs) {
      if (doc.id.startsWith('cw_comm_')) {
        kbStorage.deleteDocument(doc.id);
      }
    }

    let indexed = 0;
    for (const comm of comms) {
      const docId = `cw_comm_${comm.id}`;
      const title = `Comm (${comm.source}) — ${comm.comm_date}`;
      kbStorage.addDocument({
        id: docId,
        collectionId,
        title,
        sourceType: 'comm',
        originalFilename: null,
        content: comm.content,
        description: `Communication from ${comm.source} on ${comm.comm_date}`,
      });
      indexed++;
    }

    console.log(`${LOG} Re-indexed ${indexed} comms into ${collectionId}`);

    // Trigger auto-embed for all new chunks
    if (autoEmbedCollection) {
      autoEmbedCollection(collectionId).catch(err =>
        console.warn(`${LOG} Auto-embed after reindex failed:`, err.message)
      );
    }

    return { success: true, indexed, collectionId };
  },

  _handleSaveResponse({ content, title, description }) {
    if (!activeProjectId) return { error: 'No active project' };
    if (!title) return { error: 'Title is required' };
    if (!content) return { error: 'No content to save' };

    const docId = cwDb.createDocument({
      projectId: activeProjectId,
      title,
      description: description || null,
      content,
    });

    const project = cwDb.getProject(activeProjectId);
    return { success: true, docId, projectName: project?.name };
  },

  // ── Notes (disk-based .md files) ────────────────────────────

  _getProjectDir(projectId) {
    const os = require('os');
    const path = require('path');
    return path.join(os.homedir(), 'Documents', 'IIMAGINE', 'projects', projectId);
  },

  _getNotesDir(projectId) {
    const path = require('path');
    return path.join(this._getProjectDir(projectId), 'notes');
  },

  _ensureNotesDir(projectId) {
    const fs = require('fs');
    const dir = this._getNotesDir(projectId);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  },

  _getFilesDir(projectId) {
    const path = require('path');
    return path.join(this._getProjectDir(projectId), 'files');
  },

  _ensureFilesDir(projectId) {
    const fs = require('fs');
    const dir = this._getFilesDir(projectId);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  },

  _ensureProjectDirs(projectId) {
    this._ensureNotesDir(projectId);
    this._ensureFilesDir(projectId);
  },

  _listProjectFiles(projectId) {
    const fs = require('fs');
    const path = require('path');
    const dir = this._getFilesDir(projectId);
    if (!fs.existsSync(dir)) return [];
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
    return entries
      .filter(e => e.isFile() && !e.name.startsWith('.'))
      .map(e => {
        const fullPath = path.join(dir, e.name);
        let stat;
        try { stat = fs.statSync(fullPath); } catch { return null; }
        return {
          name: e.name,
          ext: path.extname(e.name).toLowerCase(),
          size: stat.size,
          modified: stat.mtime.toISOString(),
        };
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.modified) - new Date(a.modified));
  },

  async _scanAndIndexFiles(projectId) {
    const fs = require('fs');
    const path = require('path');
    const dir = this._ensureFilesDir(projectId);
    const SUPPORTED = ['.txt', '.md', '.pdf', '.docx', '.csv'];

    if (!fs.existsSync(dir)) return { success: false, error: 'Files directory not found' };

    const collectionId = this._ensureProjectCollection(projectId);
    let indexed = 0;

    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return { success: false, error: 'Cannot read directory' }; }

    for (const entry of entries) {
      if (!entry.isFile() || entry.name.startsWith('.')) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!SUPPORTED.includes(ext)) continue;

      const fullPath = path.join(dir, entry.name);
      let content = null;
      try {
        if (ext === '.txt' || ext === '.md' || ext === '.csv') {
          content = fs.readFileSync(fullPath, 'utf-8');
        } else if (ext === '.pdf') {
          const pdfParse = require('pdf-parse');
          const buffer = fs.readFileSync(fullPath);
          const data = await pdfParse(buffer);
          content = data.text || '';
        } else if (ext === '.docx') {
          const mammoth = require('mammoth');
          const buffer = fs.readFileSync(fullPath);
          const result = await mammoth.extractRawText({ buffer });
          content = result.value || '';
        }
      } catch (err) {
        console.warn(`[ClientWorkspace] Parse error for ${entry.name}:`, err.message);
        continue;
      }

      if (!content || !content.trim()) continue;

      const docId = `cw_file_${projectId}_${entry.name}`;
      try { kbStorage.deleteDocument(docId); } catch (e) { /* ignore */ }
      kbStorage.addDocument({
        id: docId,
        collectionId,
        title: `File: ${entry.name}`,
        sourceType: 'file',
        originalFilename: entry.name,
        content,
      });
      indexed++;
    }

    // Trigger auto-embed
    if (autoEmbedCollection) {
      autoEmbedCollection(collectionId).catch(err =>
        console.warn(`[ClientWorkspace] Auto-embed after file scan failed:`, err.message)
      );
    }

    const scanMeta = { time: new Date().toISOString(), count: indexed };
    store.set(`client-workspace.lastScan.${projectId}`, scanMeta);

    cwDb.addTimelineEntry(projectId, 'files_scanned', `Scanned & indexed ${indexed} file${indexed !== 1 ? 's' : ''}`);
    return { success: true, indexed, total: entries.filter(e => e.isFile()).length };
  },

  _getNotes(projectId) {
    const fs = require('fs');
    const path = require('path');
    const dir = this._getNotesDir(projectId);
    if (!fs.existsSync(dir)) return [];
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
    return files.map(f => {
      const filePath = path.join(dir, f);
      const stat = fs.statSync(filePath);
      const content = fs.readFileSync(filePath, 'utf-8');
      return {
        filename: f,
        title: f.replace(/\.md$/, ''),
        modified: stat.mtime.toISOString(),
        preview: content.substring(0, 150).replace(/\n/g, ' '),
        size: content.length,
      };
    }).sort((a, b) => new Date(b.modified) - new Date(a.modified));
  },

  _getNote(projectId, filename) {
    const fs = require('fs');
    const path = require('path');
    const filePath = path.join(this._getNotesDir(projectId), filename);
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf-8');
    const stat = fs.statSync(filePath);
    return { filename, title: filename.replace(/\.md$/, ''), content, modified: stat.mtime.toISOString() };
  },

  _createNote(projectId, title, content) {
    const fs = require('fs');
    const path = require('path');
    const dir = this._ensureNotesDir(projectId);
    const safeName = title.replace(/[^a-zA-Z0-9_\- ]/g, '').trim().replace(/\s+/g, '-').toLowerCase();
    const filename = safeName + '.md';
    const filePath = path.join(dir, filename);
    if (fs.existsSync(filePath)) return { success: false, error: 'A note with this name already exists' };
    fs.writeFileSync(filePath, content || '', 'utf-8');
    const project = cwDb.getProject(projectId);
    cpu.processAsync({
      content: content || '',
      source: 'note',
      metadata: { projectId, projectName: project?.name, noteTitle: title },
    });
    this._indexNoteToKB(projectId, filename, content || '', title);
    cwDb.addTimelineEntry(projectId, 'note_created', `Note created: "${title}"`);
    return { success: true, filename };
  },

  _updateNote(projectId, filename, content) {
    const fs = require('fs');
    const path = require('path');
    const filePath = path.join(this._getNotesDir(projectId), filename);
    if (!fs.existsSync(filePath)) return { success: false, error: 'Note not found' };
    fs.writeFileSync(filePath, content, 'utf-8');
    const project = cwDb.getProject(projectId);
    const title = filename.replace(/\.md$/, '');
    cpu.processAsync({
      content,
      source: 'note',
      metadata: { projectId, projectName: project?.name, noteTitle: title },
    });
    this._indexNoteToKB(projectId, filename, content, title);
    return { success: true };
  },

  _deleteNote(projectId, filename) {
    const fs = require('fs');
    const path = require('path');
    const filePath = path.join(this._getNotesDir(projectId), filename);
    if (!fs.existsSync(filePath)) return { success: false, error: 'Note not found' };
    fs.unlinkSync(filePath);
    const docId = `cw_note_${projectId}_${filename}`;
    try { kbStorage.deleteDocument(docId); } catch (e) { /* ignore */ }
    const title = filename.replace(/\.md$/, '');
    cwDb.addTimelineEntry(projectId, 'note_deleted', `Note deleted: "${title}"`);
    return { success: true };
  },

  _getNotesPath(projectId) {
    return this._getNotesDir(projectId);
  },

  _indexNoteToKB(projectId, filename, content, title) {
    if (!kbStorage || !content) return;
    const collectionId = this._ensureProjectCollection(projectId);
    const docId = `cw_note_${projectId}_${filename}`;
    try { kbStorage.deleteDocument(docId); } catch (e) { /* ignore */ }
    kbStorage.addDocument({
      id: docId,
      collectionId,
      title: `Note: ${title}`,
      sourceType: 'note',
      originalFilename: filename,
      content,
      description: `Project note: ${title}`,
    });
    if (autoEmbedCollection) {
      autoEmbedCollection(collectionId).catch(err =>
        console.warn(`${LOG} Auto-embed after note save failed:`, err.message)
      );
    }
  },

  // ── Sidebar Page ────────────────────────────────────────────

  renderPage(container) {
    const activeProject = activeProjectId ? cwDb.getProject(activeProjectId) : null;
    if (activeProject) {
      return ui.renderProjectDetail(activeProject);
    }
    return ui.renderProjectList(activeProjectId);
  },

  // ── Settings Panel ──────────────────────────────────────────

  renderSettings(container) {
    return ui.renderSettings(activeProjectId);
  },

  // ── Slash Commands ──────────────────────────────────────────

  getCommands() {
    return [
      {
        name: '/project',
        description: 'Switch active project by name',
        execute: (args) => {
          const name = args.trim();
          if (!name) {
            if (!activeProjectId) return '📁 No active project. Use /project [name] to select one.';
            const p = cwDb.getProject(activeProjectId);
            return `📁 Active project: ${p?.name || 'Unknown'}`;
          }
          const results = cwDb.searchProjects(name);
          if (results.length === 0) return `📁 No project found matching "${name}"`;
          activeProjectId = results[0].id;
          store.set('client-workspace.activeProjectId', activeProjectId);
          return `📁 Switched to: ${results[0].name}`;
        },
      },
      {
        name: '/projects',
        description: 'List all projects',
        execute: () => {
          const projects = cwDb.getAllProjects();
          if (projects.length === 0) return '📁 No projects. Use /new-project [name] to create one.';
          const list = projects.map(p => {
            const marker = p.id === activeProjectId ? '→ ' : '  ';
            return `${marker}${p.name} (${p.status})`;
          }).join('\n');
          return `📁 Projects:\n${list}`;
        },
      },
      {
        name: '/new-project',
        description: 'Create a new project',
        execute: (args) => {
          const name = args.trim();
          if (!name) return '📁 Usage: /new-project [project name]';
          const id = cwDb.createProject({ name });
          activeProjectId = id;
          store.set('client-workspace.activeProjectId', id);
          return `📁 Created and activated: ${name}`;
        },
      },
      {
        name: '/docs',
        description: 'List documents for active project',
        execute: () => {
          if (!activeProjectId) return '📁 No active project. Use /project [name] first.';
          const docs = cwDb.getDocumentsForProject(activeProjectId);
          if (docs.length === 0) return '📁 No documents in this project yet.';
          const list = docs.map(d =>
            `  ${d.title} [${d.status}] — ${d.updated_at?.split('T')[0] || ''}`
          ).join('\n');
          const project = cwDb.getProject(activeProjectId);
          return `📁 Documents in ${project?.name}:\n${list}`;
        },
      },
      {
        name: '/time',
        description: 'Log a time/billing entry for active project',
        execute: (args) => {
          const description = args.trim();
          if (!activeProjectId) return '📁 No active project. Use /project [name] first.';
          if (!description) return '📁 Usage: /time [description of work done]';
          cwDb.addTimeEntry({ projectId: activeProjectId, description });
          return `📁 Time logged: ${description}`;
        },
      },
      {
        name: '/archive',
        description: 'Archive the active project',
        execute: () => {
          if (!activeProjectId) return '📁 No active project.';
          const project = cwDb.getProject(activeProjectId);
          cwDb.archiveProject(activeProjectId);
          activeProjectId = null;
          store.delete('client-workspace.activeProjectId');
          return `📁 Archived: ${project?.name}`;
        },
      },
      {
        name: '/reindex',
        description: 'Re-index all comms for the active project into vector search',
        execute: () => {
          if (!activeProjectId) return '📁 No active project. Use /project [name] first.';
          const result = this._reindexAllComms(activeProjectId);
          if (result.success) {
            return `📁 Re-indexed ${result.indexed} comms. Embeddings will be generated in the background.`;
          }
          return `📁 Re-index failed: ${result.error}`;
        },
      },
    ];
  },

  // ── Public API (for core chat UI integration) ───────────────

  getActiveProject() {
    if (!activeProjectId) return null;
    return cwDb.getProject(activeProjectId);
  },

  setActiveProject(projectId) {
    activeProjectId = projectId;
    if (projectId) {
      store.set('client-workspace.activeProjectId', projectId);
    } else {
      store.delete('client-workspace.activeProjectId');
    }
  },

  saveResponseAsDocument({ title, description, content }) {
    return this._handleSaveResponse({ content, title, description });
  },
};
