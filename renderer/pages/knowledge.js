// Knowledge Base page — collections, documents, paste/upload, edit, search

const KnowledgePage = {
  currentView: 'collections', // 'collections' | 'documents' | 'editor' | 'search'
  currentCollection: null,
  currentDocument: null,
  collPage: 0,
  docPage: 0,
  collSearch: '',
  docSearch: '',
  PAGE_SIZE: 10,

  activeTab: 'folders', // 'folders' | 'collections'

  render(container) {
    container.innerHTML = `
      <div id="kbPage" class="flex flex-col flex-1 min-h-0">
        <div class="p-6 pb-0">
          <h2 class="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100 mb-4">Knowledge</h2>
          <div class="flex gap-1 border-b border-neutral-200/40 dark:border-neutral-700/40">
            <button data-kb-tab="folders" class="kb-tab-btn px-4 py-2 text-sm font-medium transition-all border-b-2 ${this.activeTab === 'folders' ? 'text-neutral-900 dark:text-neutral-100 border-neutral-900 dark:border-neutral-100' : 'text-neutral-500 dark:text-neutral-400 border-transparent hover:text-neutral-700 dark:hover:text-neutral-300'}">Connected Folders</button>
            <button data-kb-tab="collections" class="kb-tab-btn px-4 py-2 text-sm font-medium transition-all border-b-2 ${this.activeTab === 'collections' ? 'text-neutral-900 dark:text-neutral-100 border-neutral-900 dark:border-neutral-100' : 'text-neutral-500 dark:text-neutral-400 border-transparent hover:text-neutral-700 dark:hover:text-neutral-300'}">Knowledge Bases</button>
          </div>
        </div>
        <div id="kbContent" class="flex-1 overflow-y-auto"></div>
      </div>
    `;

    // Tab switching
    container.querySelectorAll('.kb-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.activeTab = btn.dataset.kbTab;
        this.render(container);
      });
    });

    if (this.activeTab === 'folders') {
      this._showFolders();
    } else {
      this._showCollections();
    }
  },

  folderSearch: '',
  folderPage: 0,

  // ── Connected Folders Tab ───────────────────────────────────
  async _showFolders() {
    const el = document.querySelector('#kbContent');
    const allFolders = await window.api.folders.list();

    // Filter by search
    const q = this.folderSearch.toLowerCase();
    const filtered = q ? allFolders.filter(f => f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)) : allFolders;

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / this.PAGE_SIZE));
    this.folderPage = Math.min(this.folderPage, totalPages - 1);
    const start = this.folderPage * this.PAGE_SIZE;
    const folders = filtered.slice(start, start + this.PAGE_SIZE);

    el.innerHTML = `
      <div class="p-6 space-y-4">
        <p class="text-xs text-neutral-500 dark:text-neutral-400">Connect a folder from your computer. Files inside will be automatically synced and indexed so the AI can reference them in conversations.</p>

        <div class="flex items-center justify-between">
          <span class="text-xs text-neutral-500">${allFolders.length} folder${allFolders.length !== 1 ? 's' : ''} connected</span>
          <button id="fcAddBtn" class="px-4 py-2.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm">
            + Connect Folder
          </button>
        </div>

        <input id="fcSearch" type="text" placeholder="Search folders..." value="${this._escAttr(this.folderSearch)}"
          class="w-full bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300 placeholder-neutral-400 dark:placeholder-neutral-500 focus:bg-white/90 dark:focus:bg-neutral-800/90 focus:outline-none transition-all shadow-sm" />

        <div id="fcFolderList" class="space-y-2">
          ${folders.length === 0 ? `
            <div class="text-center py-8 border border-dashed border-neutral-200/60 dark:border-neutral-700/60 rounded-2xl">
              <p class="text-xs text-neutral-400 dark:text-neutral-500">${q ? 'No folders match your search.' : 'No folders connected. Click "+ Connect Folder" to get started.'}</p>
            </div>
          ` : folders.map(f => window.FolderConnectUI._renderFolder(f)).join('')}
        </div>

        ${total > this.PAGE_SIZE ? `
          <div class="flex items-center justify-center gap-2 pt-2">
            <button id="fcPrev" class="px-3 py-1.5 rounded-lg text-xs font-medium ${this.folderPage === 0 ? 'text-neutral-300 dark:text-neutral-600 cursor-default' : 'text-neutral-600 dark:text-neutral-400 hover:bg-white/60 dark:hover:bg-neutral-800/60'}">← Prev</button>
            <span class="text-xs text-neutral-400">Page ${this.folderPage + 1} of ${totalPages}</span>
            <button id="fcNext" class="px-3 py-1.5 rounded-lg text-xs font-medium ${this.folderPage >= totalPages - 1 ? 'text-neutral-300 dark:text-neutral-600 cursor-default' : 'text-neutral-600 dark:text-neutral-400 hover:bg-white/60 dark:hover:bg-neutral-800/60'}">Next →</button>
          </div>
        ` : ''}
      </div>
    `;

    // Bind events
    document.querySelector('#fcAddBtn')?.addEventListener('click', async () => {
      const result = await window.api.folders.add();
      if (result && !result.canceled && !result.error) {
        this._showFolders();
      } else if (result?.error) {
        alert(result.error);
      }
    });

    document.querySelector('#fcSearch')?.addEventListener('input', (e) => {
      this.folderSearch = e.target.value;
      this.folderPage = 0;
      this._showFolders();
    });

    document.querySelector('#fcPrev')?.addEventListener('click', () => {
      if (this.folderPage > 0) { this.folderPage--; this._showFolders(); }
    });
    document.querySelector('#fcNext')?.addEventListener('click', () => {
      if (this.folderPage < totalPages - 1) { this.folderPage++; this._showFolders(); }
    });

    // Reindex and remove buttons (from FolderConnectUI's rendered HTML)
    document.querySelectorAll('.fc-reindex').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        await window.api.folders.reindex(btn.dataset.id);
        this._showFolders();
      });
    });

    document.querySelectorAll('.fc-remove').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Remove this folder connection? Files will no longer be indexed.')) return;
        await window.api.folders.remove(btn.dataset.id);
        this._showFolders();
      });
    });

    // Listen for indexing progress
    window.api.folders.onProgress((data) => {
      if (!data.folderId) return;
      const el = document.querySelector(`#fc-progress-${data.folderId}`);
      if (!el) return;
      if (data.done) { this._showFolders(); return; }
      el.classList.remove('hidden');
      const bar = el.querySelector('.fc-bar');
      const count = el.querySelector('.fc-count');
      if (bar && data.total > 0) bar.style.width = Math.round((data.indexed / data.total) * 100) + '%';
      if (count) count.textContent = `${data.indexed || 0}/${data.total || 0}`;
    });
  },

  // ── Collections List ────────────────────────────────────────
  async _showCollections() {
    this.currentView = 'collections';
    this.currentCollection = null;
    const el = document.querySelector('#kbContent');

    const allCollections = await window.api.kb.getCollections();
    const stats = await window.api.kb.getStats();

    // Filter by search
    const q = this.collSearch.toLowerCase();
    const filtered = q ? allCollections.filter(c => c.name.toLowerCase().includes(q) || (c.description || '').toLowerCase().includes(q)) : allCollections;

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / this.PAGE_SIZE));
    this.collPage = Math.min(this.collPage, totalPages - 1);
    const start = this.collPage * this.PAGE_SIZE;
    const collections = filtered.slice(start, start + this.PAGE_SIZE);

    el.innerHTML = `
      <div class="p-6 space-y-4">
        <p class="text-xs text-neutral-500 dark:text-neutral-400">Create collections and add documents (text, PDF, DOCX, CSV). The AI will search these when answering your questions.</p>

        <div class="flex items-center justify-between">
          <div class="flex gap-3 text-xs text-neutral-500">
            <span>${stats.collections} collection${stats.collections !== 1 ? 's' : ''}</span>
            <span>·</span>
            <span>${stats.documents} document${stats.documents !== 1 ? 's' : ''}</span>
          </div>
          <button id="kbNewCollBtn" class="px-4 py-2.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm">
            + New Collection
          </button>
        </div>

        <input id="kbCollSearch" type="text" placeholder="Search collections..." value="${this._escAttr(this.collSearch)}"
          class="w-full bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300 placeholder-neutral-400 dark:placeholder-neutral-500 focus:bg-white/90 dark:focus:bg-neutral-800/90 focus:outline-none transition-all shadow-sm" />

        <!-- New collection form (hidden) -->
        <div id="kbNewCollForm" class="hidden bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-5 shadow-[0_2px_10px_rgb(0,0,0,0.02)] dark:shadow-[0_2px_10px_rgb(0,0,0,0.2)] backdrop-blur-md space-y-3">
          <input id="kbNewCollName" type="text" placeholder="Collection name"
            class="w-full bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2.5 text-sm text-neutral-700 dark:text-neutral-300 placeholder-neutral-400 dark:placeholder-neutral-500 focus:bg-white/90 dark:focus:bg-neutral-800/90 focus:outline-none transition-all shadow-sm" />
          <input id="kbNewCollDesc" type="text" placeholder="Description (optional)"
            class="w-full bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2.5 text-sm text-neutral-700 dark:text-neutral-300 placeholder-neutral-400 dark:placeholder-neutral-500 focus:bg-white/90 dark:focus:bg-neutral-800/90 focus:outline-none transition-all shadow-sm" />
          <div class="flex gap-2">
            <button id="kbSaveCollBtn" class="px-4 py-2.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm">Create</button>
            <button id="kbCancelCollBtn" class="text-sm text-neutral-500 dark:text-neutral-400 px-4 py-2 hover:text-neutral-700 dark:hover:text-neutral-300">Cancel</button>
          </div>
        </div>

        <!-- Collections grid -->
        <div id="kbCollGrid" class="space-y-2">
          ${collections.length === 0 && this.collPage === 0 ? `
            <div class="text-center py-12 text-neutral-400">
              <div class="p-3 bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-100 dark:border-neutral-800 shadow-sm text-neutral-400 inline-flex mb-2"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg></div>
              <p class="text-sm">No collections yet. Create one to start building your knowledge base.</p>
            </div>
          ` : collections.map(c => `
            <div class="kb-coll-item bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-5 shadow-[0_2px_10px_rgb(0,0,0,0.02)] dark:shadow-[0_2px_10px_rgb(0,0,0,0.2)] backdrop-blur-md hover:shadow-md cursor-pointer transition-all" data-id="${c.id}">
              <div class="flex items-start justify-between">
                <div class="min-w-0 flex-1">
                  <h3 class="text-sm font-medium text-neutral-900 dark:text-neutral-100">${this._esc(c.name)}</h3>
                  <div class="flex gap-2 text-xs text-neutral-400 mt-1">
                    <span>${c.doc_count} doc${c.doc_count !== 1 ? 's' : ''}</span>
                    <span>·</span>
                    <span>${this._formatDate(c.updated_at)}</span>
                  </div>
                  ${c.description ? `<p class="text-xs text-neutral-500 mt-1">${this._esc(c.description)}</p>` : ''}
                </div>
                <div class="flex items-center gap-5 ml-4 shrink-0">
                  <button class="kb-del-coll text-neutral-300 hover:text-rose-600" data-id="${c.id}" title="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
                </div>
              </div>
            </div>
          `).join('')}
        </div>

        <div class="flex items-center justify-center gap-2 pt-2">
          <button id="kbCollPrev" class="px-3 py-1.5 rounded-lg text-xs font-medium ${this.collPage === 0 ? 'text-neutral-300 dark:text-neutral-600 cursor-default' : 'text-neutral-600 dark:text-neutral-400 hover:bg-white/60 dark:hover:bg-neutral-800/60'}">← Prev</button>
          <span class="text-xs text-neutral-400">Page ${this.collPage + 1} of ${totalPages}</span>
          <button id="kbCollNext" class="px-3 py-1.5 rounded-lg text-xs font-medium ${this.collPage >= totalPages - 1 ? 'text-neutral-300 dark:text-neutral-600 cursor-default' : 'text-neutral-600 dark:text-neutral-400 hover:bg-white/60 dark:hover:bg-neutral-800/60'}">Next →</button>
        </div>
      </div>
    `;

    // Bind events
    document.querySelector('#kbNewCollBtn')?.addEventListener('click', () => {
      document.querySelector('#kbNewCollForm').classList.toggle('hidden');
      document.querySelector('#kbNewCollName')?.focus();
    });

    document.querySelector('#kbCancelCollBtn')?.addEventListener('click', () => {
      document.querySelector('#kbNewCollForm').classList.add('hidden');
    });

    document.querySelector('#kbSaveCollBtn')?.addEventListener('click', async () => {
      const name = document.querySelector('#kbNewCollName').value.trim();
      if (!name) return;
      const desc = document.querySelector('#kbNewCollDesc').value.trim();
      const id = `coll_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      await window.api.kb.createCollection({ id, name, description: desc });
      this._showCollections();
    });

    // Click collection to open
    document.querySelectorAll('.kb-coll-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.kb-del-coll')) return;
        this.docPage = 0;
        this._showDocuments(item.dataset.id);
      });
    });

    // Delete collection
    document.querySelectorAll('.kb-del-coll').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm('Are you sure you want to delete this collection?\n\nThis will permanently delete the collection AND all documents inside it. This cannot be undone.')) {
          await window.api.kb.deleteCollection(btn.dataset.id);
          this._showCollections();
        }
      });
    });

    // Collection search
    document.querySelector('#kbCollSearch')?.addEventListener('input', (e) => {
      this.collSearch = e.target.value;
      this.collPage = 0;
      this._showCollections();
    });

    // Pagination
    document.querySelector('#kbCollPrev')?.addEventListener('click', () => {
      if (this.collPage > 0) { this.collPage--; this._showCollections(); }
    });
    document.querySelector('#kbCollNext')?.addEventListener('click', () => {
      this.collPage++; this._showCollections();
    });
  },

  // ── Documents List ──────────────────────────────────────────
  async _showDocuments(collectionId) {
    this.currentView = 'documents';
    const collection = await window.api.kb.getCollection(collectionId);
    if (!collection) return this._showCollections();
    this.currentCollection = collection;

    const allDocs = await window.api.kb.getDocuments(collectionId);

    // Filter by search
    const dq = this.docSearch.toLowerCase();
    const filteredDocs = dq ? allDocs.filter(d => d.title.toLowerCase().includes(dq) || (d.description || '').toLowerCase().includes(dq)) : allDocs;

    const total = filteredDocs.length;
    const totalPages = Math.max(1, Math.ceil(total / this.PAGE_SIZE));
    this.docPage = Math.min(this.docPage, totalPages - 1);
    const start = this.docPage * this.PAGE_SIZE;
    const docs = filteredDocs.slice(start, start + this.PAGE_SIZE);
    const el = document.querySelector('#kbContent');

    el.innerHTML = `
      <div class="p-6 space-y-4">
        <div class="flex items-center gap-2 mb-1">
          <button id="kbBackBtn" class="text-neutral-400 hover:text-neutral-600 text-sm">← Back</button>
          <span class="text-neutral-300">|</span>
          <h2 class="text-lg font-semibold text-neutral-900 dark:text-neutral-100">${this._esc(collection.name)}</h2>
        </div>
        ${collection.description ? `<p class="text-xs text-neutral-500 -mt-2">${this._esc(collection.description)}</p>` : ''}

        <div class="flex gap-2">
          <button id="kbAddDataBtn" class="px-4 py-2.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm">
            + Add Data
          </button>
        </div>

        <!-- Drag & Drop Zone -->
        <div id="kbDropZone" class="relative border-2 border-dashed border-neutral-200/60 dark:border-neutral-700/60 rounded-2xl p-4 text-center transition-all hover:border-neutral-300 dark:hover:border-neutral-600 cursor-pointer">
          <div id="kbDropZoneContent" class="flex flex-col items-center gap-1.5">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="text-neutral-300 dark:text-neutral-600"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <p class="text-xs text-neutral-400 dark:text-neutral-500">Drag files here to upload</p>
            <p class="text-[10px] text-neutral-300 dark:text-neutral-600">.pdf .docx .txt .csv .md</p>
          </div>
          <div id="kbDropZoneActive" class="hidden absolute inset-0 rounded-2xl bg-neutral-900/5 dark:bg-neutral-100/5 border-2 border-dashed border-neutral-900 dark:border-neutral-100 flex items-center justify-center pointer-events-none">
            <p class="text-sm font-medium text-neutral-900 dark:text-neutral-100">Drop to upload</p>
          </div>
        </div>

        <input id="kbDocSearch" type="text" placeholder="Search documents..." value="${this._escAttr(this.docSearch)}"
          class="w-full bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300 placeholder-neutral-400 dark:placeholder-neutral-500 focus:bg-white/90 dark:focus:bg-neutral-800/90 focus:outline-none transition-all shadow-sm" />

        <!-- Auto-embed status indicator (shown when embedding in background) -->
        <div id="kbAutoEmbedStatus" class="hidden flex items-center gap-2 px-3 py-2 bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-xl text-xs text-neutral-500 dark:text-neutral-400">
          <div class="w-3 h-3 rounded-full border-2 border-neutral-400 border-t-neutral-900 dark:border-neutral-500 dark:border-t-neutral-100 animate-spin"></div>
          <span id="kbAutoEmbedLabel">Embedding...</span>
          <div class="flex-1 bg-neutral-100 dark:bg-neutral-700 rounded-full h-1.5 ml-1">
            <div id="kbAutoEmbedBar" class="bg-gradient-to-r from-neutral-600 to-neutral-900 dark:from-neutral-400 dark:to-neutral-100 h-1.5 rounded-full transition-all" style="width: 0%"></div>
          </div>
          <span id="kbAutoEmbedCount" class="text-neutral-400 tabular-nums"></span>
        </div>

        <!-- Unified Add Data form (hidden) -->
        <div id="kbAddDataForm" class="hidden bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-5 shadow-[0_2px_10px_rgb(0,0,0,0.02)] dark:shadow-[0_2px_10px_rgb(0,0,0,0.2)] backdrop-blur-md space-y-3">
          <input id="kbAddTitle" type="text" placeholder="Document title (required)"
            class="w-full bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2.5 text-sm text-neutral-700 dark:text-neutral-300 placeholder-neutral-400 dark:placeholder-neutral-500 focus:bg-white/90 dark:focus:bg-neutral-800/90 focus:outline-none transition-all shadow-sm" />
          <input id="kbAddDesc" type="text" placeholder="Description (optional)"
            class="w-full bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2.5 text-sm text-neutral-700 dark:text-neutral-300 placeholder-neutral-400 dark:placeholder-neutral-500 focus:bg-white/90 dark:focus:bg-neutral-800/90 focus:outline-none transition-all shadow-sm" />
          <textarea id="kbAddContent" rows="8" placeholder="Paste your text here..."
            class="w-full resize-none bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2.5 text-sm text-neutral-700 dark:text-neutral-300 placeholder-neutral-400 dark:placeholder-neutral-500 focus:bg-white/90 dark:focus:bg-neutral-800/90 focus:outline-none transition-all shadow-sm"></textarea>
          <div class="flex items-center gap-2">
            <button id="kbAddFileBtn" class="px-3 py-2 rounded-lg bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 text-xs font-medium text-neutral-600 dark:text-neutral-400 hover:bg-white/90 dark:hover:bg-neutral-700/90 transition-all shadow-sm flex items-center gap-1.5">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg> Upload file
            </button>
            <span id="kbAddFilename" class="text-xs text-neutral-400 dark:text-neutral-500 truncate"></span>
            <span class="text-xs text-neutral-300 dark:text-neutral-600 ml-auto">.pdf .docx .txt .csv .md</span>
          </div>
          <div class="flex gap-2">
            <button id="kbSaveAddBtn" class="px-4 py-2.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm">Save</button>
            <button id="kbCancelAddBtn" class="text-sm text-neutral-500 dark:text-neutral-400 px-4 py-2 hover:text-neutral-700 dark:hover:text-neutral-300">Cancel</button>
          </div>
        </div>

        <!-- Documents list -->
        <div id="kbDocList" class="space-y-2">
          ${docs.length === 0 ? `
            <div class="text-center py-12 text-neutral-400">
              <div class="p-3 bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-100 dark:border-neutral-800 shadow-sm text-neutral-400 inline-flex mb-2"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8M16 17H8M10 9H8"/></svg></div>
              <p class="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">No documents yet</p>
              <p class="text-xs text-neutral-400 max-w-xs mx-auto">Add knowledge by pasting text or uploading files (.txt, .md, .csv, .pdf, .docx). Each document gets chunked and can be embedded for AI search.</p>
            </div>
          ` : docs.map(d => `
            <div class="kb-doc-item bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-4 shadow-[0_2px_10px_rgb(0,0,0,0.02)] dark:shadow-[0_2px_10px_rgb(0,0,0,0.2)] backdrop-blur-md hover:shadow-md cursor-pointer transition-all" data-id="${d.id}">
              <div class="flex items-start justify-between">
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <span class="text-xs shrink-0">${this._sourceIcon(d.source_type)}</span>
                    <h4 class="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate">${this._esc(d.title)}</h4>
                  </div>
                  <p class="text-xs text-neutral-400 mt-1">${this._formatDate(d.updated_at || d.created_at)}</p>
                  <p class="text-xs mt-0.5 truncate ${d.description ? 'text-neutral-500' : 'text-neutral-400 italic'}">${d.description ? this._esc(this._truncate(d.description, 80)) : 'No description'}</p>
                </div>
                <div class="flex items-center gap-5 ml-4 shrink-0">
                  <button class="kb-del-doc text-neutral-300 hover:text-rose-600" data-id="${d.id}" title="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
                </div>
              </div>
            </div>
          `).join('')}
        </div>

        <div class="flex items-center justify-center gap-2 pt-2">
          <button id="kbDocPrev" class="px-3 py-1.5 rounded-lg text-xs font-medium ${this.docPage === 0 ? 'text-neutral-300 dark:text-neutral-600 cursor-default' : 'text-neutral-600 dark:text-neutral-400 hover:bg-white/60 dark:hover:bg-neutral-800/60'}">← Prev</button>
          <span class="text-xs text-neutral-400">Page ${this.docPage + 1} of ${totalPages}</span>
          <button id="kbDocNext" class="px-3 py-1.5 rounded-lg text-xs font-medium ${this.docPage >= totalPages - 1 ? 'text-neutral-300 dark:text-neutral-600 cursor-default' : 'text-neutral-600 dark:text-neutral-400 hover:bg-white/60 dark:hover:bg-neutral-800/60'}">Next →</button>
        </div>
      </div>
    `;

    this._bindDocEvents(collectionId);
  },

  _bindDocEvents(collectionId) {
    document.querySelector('#kbBackBtn')?.addEventListener('click', () => {
      this.docPage = 0;
      this.docSearch = '';
      this._showCollections();
    });

    // Document search
    document.querySelector('#kbDocSearch')?.addEventListener('input', (e) => {
      this.docSearch = e.target.value;
      this.docPage = 0;
      this._showDocuments(collectionId);
    });

    // Document pagination
    document.querySelector('#kbDocPrev')?.addEventListener('click', () => {
      if (this.docPage > 0) { this.docPage--; this._showDocuments(collectionId); }
    });
    document.querySelector('#kbDocNext')?.addEventListener('click', () => {
      this.docPage++; this._showDocuments(collectionId);
    });

    // Listen for auto-embed events from main process
    window.api.kb.onAutoEmbedStart((data) => {
      if (data.collectionId !== collectionId) return;
      const el = document.querySelector('#kbAutoEmbedStatus');
      const label = document.querySelector('#kbAutoEmbedLabel');
      const bar = document.querySelector('#kbAutoEmbedBar');
      const count = document.querySelector('#kbAutoEmbedCount');
      if (el) {
        el.classList.remove('hidden');
        if (label) label.textContent = `Embedding ${data.total} chunks...`;
        if (bar) bar.style.width = '0%';
        if (count) count.textContent = `0/${data.total}`;
      }
    });

    window.api.kb.onAutoEmbedProgress((data) => {
      if (data.collectionId !== collectionId) return;
      const bar = document.querySelector('#kbAutoEmbedBar');
      const count = document.querySelector('#kbAutoEmbedCount');
      if (bar && count) {
        const pct = Math.round((data.processed / data.total) * 100);
        bar.style.width = pct + '%';
        count.textContent = `${data.processed}/${data.total}`;
      }
    });

    window.api.kb.onAutoEmbedDone((data) => {
      if (data.collectionId !== collectionId) return;
      const el = document.querySelector('#kbAutoEmbedStatus');
      const label = document.querySelector('#kbAutoEmbedLabel');
      const bar = document.querySelector('#kbAutoEmbedBar');
      const count = document.querySelector('#kbAutoEmbedCount');
      if (el && label) {
        label.textContent = `Embedded ${data.embedded} chunks ✓`;
        if (bar) bar.style.width = '100%';
        if (count) count.textContent = '';
        // Hide after a short delay and refresh doc list
        setTimeout(() => {
          el.classList.add('hidden');
          this._showDocuments(collectionId);
        }, 2000);
      }
    });

    // Listen for embed progress (manual batch from main process)
    window.api.kb.onEmbedProgress((data) => {
      const bar = document.querySelector('#kbAutoEmbedBar');
      const count = document.querySelector('#kbAutoEmbedCount');
      if (bar && count) {
        const pct = Math.round((data.processed / data.total) * 100);
        bar.style.width = pct + '%';
        count.textContent = `${data.processed}/${data.total}`;
      }
    });

    // Unified Add Data form
    let uploadedSourceType = null;
    let uploadedFilename = null;

    document.querySelector('#kbAddDataBtn')?.addEventListener('click', () => {
      const form = document.querySelector('#kbAddDataForm');
      form.classList.toggle('hidden');
      if (!form.classList.contains('hidden')) {
        document.querySelector('#kbAddTitle')?.focus();
      }
    });

    document.querySelector('#kbCancelAddBtn')?.addEventListener('click', () => {
      document.querySelector('#kbAddDataForm').classList.add('hidden');
      uploadedSourceType = null;
      uploadedFilename = null;
      document.querySelector('#kbAddFilename').textContent = '';
    });

    // Upload file button inside Add Data form — extracts content into textarea
    document.querySelector('#kbAddFileBtn')?.addEventListener('click', async () => {
      const result = await window.api.kb.openFileDialog();
      if (result.canceled || !result.files.length) return;

      const file = result.files[0];
      const content = file.content || '';

      if (!content.trim()) {
        alert('Could not extract text from ' + file.filename);
        return;
      }

      document.querySelector('#kbAddContent').value = content;
      document.querySelector('#kbAddFilename').textContent = file.filename;
      uploadedSourceType = file.type;
      uploadedFilename = file.filename;

      // Set title from filename if title is empty
      const titleInput = document.querySelector('#kbAddTitle');
      if (!titleInput.value.trim()) {
        titleInput.value = file.filename.replace(/\.[^.]+$/, '');
      }
    });

    // Save from Add Data form
    document.querySelector('#kbSaveAddBtn')?.addEventListener('click', async () => {
      const title = document.querySelector('#kbAddTitle').value.trim();
      const content = document.querySelector('#kbAddContent').value.trim();
      if (!title || !content) return;
      const desc = document.querySelector('#kbAddDesc').value.trim();
      const id = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const sourceType = uploadedSourceType || 'paste';

      await window.api.kb.addDocument({
        id, collectionId, title, sourceType, content,
        originalFilename: uploadedFilename || undefined,
        description: desc || undefined,
      });

      uploadedSourceType = null;
      uploadedFilename = null;
      this._showDocuments(collectionId);
    });

    // Click doc to edit
    document.querySelectorAll('.kb-doc-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.kb-del-doc')) return;
        this._showEditor(item.dataset.id);
      });
    });

    // Delete doc
    document.querySelectorAll('.kb-del-doc').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm('Delete this document?')) {
          await window.api.kb.deleteDocument(btn.dataset.id);
          this._showDocuments(collectionId);
        }
      });
    });

    // ── Drag & Drop ──────────────────────────────────────────────
    const dropZone = document.querySelector('#kbDropZone');
    const dropActive = document.querySelector('#kbDropZoneActive');
    const dropContent = document.querySelector('#kbDropZoneContent');
    let dragCounter = 0;

    if (dropZone) {
      // Click the drop zone to open file picker too
      dropZone.addEventListener('click', async () => {
        console.log('[KB] Drop zone clicked, opening file dialog...');
        const result = await window.api.kb.openFileDialog();
        console.log('[KB] File dialog result:', result.canceled, 'files:', result.files?.length);
        if (result.canceled || !result.files.length) return;
        await this._processDroppedFiles(result.files, collectionId);
      });

      dropZone.addEventListener('dragenter', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter++;
        if (dropActive) dropActive.classList.remove('hidden');
        if (dropContent) dropContent.classList.add('hidden');
      });

      dropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter--;
        if (dragCounter <= 0) {
          dragCounter = 0;
          if (dropActive) dropActive.classList.add('hidden');
          if (dropContent) dropContent.classList.remove('hidden');
        }
      });

      dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });

      dropZone.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter = 0;
        if (dropActive) dropActive.classList.add('hidden');
        if (dropContent) dropContent.classList.remove('hidden');

        const files = e.dataTransfer?.files;
        if (!files || files.length === 0) return;

        // Show processing indicator
        if (dropContent) {
          dropContent.innerHTML = `
            <div class="w-4 h-4 rounded-full border-2 border-neutral-400 border-t-neutral-900 dark:border-neutral-500 dark:border-t-neutral-100 animate-spin"></div>
            <p class="text-xs text-neutral-500">Processing ${files.length} file${files.length > 1 ? 's' : ''}...</p>
          `;
        }

        // Get file paths using Electron's webUtils API (required for Electron 33+ with contextIsolation)
        const filePaths = [];
        for (let i = 0; i < files.length; i++) {
          try {
            const path = window.api.kb.getFilePath(files[i]);
            if (path) filePaths.push(path);
          } catch (err) {
            console.warn('[KB] getFilePath failed:', err.message);
          }
        }

        if (filePaths.length > 0) {
          const result = await window.api.kb.readDroppedFiles(filePaths);
          if (result?.files?.length > 0) {
            await this._processDroppedFiles(result.files, collectionId);
            return;
          }
        }

        // If we get here, nothing was processed
        this._resetDropZone(dropContent);
      });
    }
  },

  /**
   * Process files (from drag-drop or file picker) and add them to the collection
   */
  async _processDroppedFiles(files, collectionId) {
    let added = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.content || !file.content.trim()) {
        console.warn('[KB] Skipping file with no content:', file.filename);
        continue;
      }
      const id = `doc_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 8)}`;
      const title = file.filename ? file.filename.replace(/\.[^.]+$/, '') : `Document ${Date.now()}`;
      console.log('[KB] Adding document:', title, 'content length:', file.content.length);
      await window.api.kb.addDocument({
        id,
        collectionId,
        title,
        sourceType: file.type || 'file',
        content: file.content,
        originalFilename: file.filename || undefined,
      });
      added++;
    }
    console.log('[KB] Added', added, 'documents to collection', collectionId);
    if (added > 0) {
      this._showDocuments(collectionId);
    }
  },

  _resetDropZone(dropContent) {
    if (dropContent) {
      dropContent.innerHTML = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="text-neutral-300 dark:text-neutral-600"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        <p class="text-xs text-neutral-400 dark:text-neutral-500">Drag files here to upload</p>
        <p class="text-[10px] text-neutral-300 dark:text-neutral-600">.pdf .docx .txt .csv .md</p>
      `;
    }
  },

  // ── Document Editor ─────────────────────────────────────────
  async _showEditor(docId) {
    this.currentView = 'editor';
    const doc = await window.api.kb.getDocument(docId);
    if (!doc) return;
    this.currentDocument = doc;

    const el = document.querySelector('#kbContent');
    el.innerHTML = `
      <div class="p-6 space-y-4 flex flex-col flex-1 min-h-0">
        <div class="flex items-center gap-2">
          <button id="kbEditorBack" class="text-neutral-400 hover:text-neutral-600 text-sm">← Back</button>
          <span class="text-neutral-300">|</span>
          <span class="text-sm text-neutral-500">Edit Document</span>
        </div>

        <input id="kbEditorTitle" type="text" value="${this._escAttr(doc.title)}"
          class="w-full bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2.5 text-sm font-medium text-neutral-700 dark:text-neutral-300 focus:bg-white/90 dark:focus:bg-neutral-800/90 focus:outline-none transition-all shadow-sm" />

        <input id="kbEditorDesc" type="text" value="${this._escAttr(doc.description || '')}" placeholder="Description (optional)"
          class="w-full bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2.5 text-sm text-neutral-700 dark:text-neutral-300 placeholder-neutral-400 dark:placeholder-neutral-500 focus:bg-white/90 dark:focus:bg-neutral-800/90 focus:outline-none transition-all shadow-sm" />

        <textarea id="kbEditorContent" class="w-full flex-1 min-h-[300px] resize-none bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2.5 text-sm text-neutral-700 dark:text-neutral-300 font-mono focus:bg-white/90 dark:focus:bg-neutral-800/90 focus:outline-none transition-all shadow-sm">${this._esc(doc.content)}</textarea>

        <div class="flex items-center justify-between">
          <div class="text-xs text-neutral-400">
            <span id="kbEditorCharCount">${doc.char_count.toLocaleString()} chars</span>
            · ${doc.chunk_count} chunks
            · Source: ${doc.source_type}
          </div>
          <div class="flex gap-2">
            <button id="kbEditorCancel" class="text-sm text-neutral-500 dark:text-neutral-400 px-4 py-2 hover:text-neutral-700 dark:hover:text-neutral-300">Cancel</button>
            <button id="kbEditorSave" class="px-4 py-2.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm">Save Changes</button>
          </div>
        </div>
      </div>
    `;

    // Live char count
    const textarea = document.querySelector('#kbEditorContent');
    const charCount = document.querySelector('#kbEditorCharCount');
    textarea.addEventListener('input', () => {
      charCount.textContent = `${textarea.value.length.toLocaleString()} chars`;
    });

    document.querySelector('#kbEditorBack')?.addEventListener('click', () => {
      this._showDocuments(doc.collection_id);
    });

    document.querySelector('#kbEditorCancel')?.addEventListener('click', () => {
      this._showDocuments(doc.collection_id);
    });

    document.querySelector('#kbEditorSave')?.addEventListener('click', async () => {
      const title = document.querySelector('#kbEditorTitle').value.trim();
      const content = textarea.value;
      const description = document.querySelector('#kbEditorDesc').value.trim();
      if (!title) return;
      const btn = document.querySelector('#kbEditorSave');
      btn.disabled = true;
      btn.textContent = 'Saving...';
      await window.api.kb.updateDocument(docId, { title, content, description });
      this._showDocuments(doc.collection_id);
    });
  },

  // ── Helpers ─────────────────────────────────────────────────

  _esc(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  },

  _escAttr(str) {
    return (str || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  },

  _formatDate(dateStr) {
    if (!dateStr) return '';
    try {
      // SQLite datetime('now') stores UTC without a Z suffix — append Z so JS parses it as UTC
      const d = new Date(dateStr.endsWith('Z') ? dateStr : dateStr + 'Z');
      if (isNaN(d.getTime())) return '';
      const now = new Date();
      const diff = now - d;
      if (diff < 60000) return 'just now';
      if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
      if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
      if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
    } catch { return ''; }
  },

  _truncate(str, max) {
    if (!str) return '';
    const clean = str.replace(/\s+/g, ' ').trim();
    if (clean.length <= max) return clean;
    return clean.slice(0, max).replace(/\s\S*$/, '') + '…';
  },

  _sourceIcon(type) {
    const icons = {
      paste: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="text-neutral-500"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>',
      txt: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="text-neutral-500"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8M16 17H8M10 9H8"/></svg>',
      md: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="text-neutral-500"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 18v-6M9 15h6"/></svg>',
      csv: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="text-neutral-500"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 17V11M12 17V7M16 17v-4"/></svg>',
      pdf: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="text-rose-500"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
      docx: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="text-blue-500"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
    };
    return icons[type] || '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="text-neutral-500"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8M16 17H8M10 9H8"/></svg>';
  },

  destroy() {
    // cleanup if needed
  }
};

window.KnowledgePage = KnowledgePage;
