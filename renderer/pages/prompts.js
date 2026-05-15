// Prompts Manager page — CRUD for reusable prompt templates

const PromptsPage = {
  currentView: 'list', // 'list' | 'form'
  editingPrompt: null,
  searchQuery: '',
  page: 0,
  PAGE_SIZE: 10,

  render(container) {
    container.innerHTML = `
      <div id="promptsPage" class="flex flex-col flex-1 min-h-0">
        <div id="promptsContent" class="flex-1 overflow-y-auto"></div>
      </div>
    `;
    this._showList();
  },

  async _showList() {
    this.currentView = 'list';
    this.editingPrompt = null;
    const el = document.querySelector('#promptsContent');
    const allPrompts = await window.api.prompts.list();

    // Filter by search
    const q = this.searchQuery.toLowerCase();
    const filtered = q ? allPrompts.filter(p => p.title.toLowerCase().includes(q) || (p.content || '').toLowerCase().includes(q) || (p.category || '').toLowerCase().includes(q)) : allPrompts;

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / this.PAGE_SIZE));
    this.page = Math.min(this.page, totalPages - 1);
    const start = this.page * this.PAGE_SIZE;
    const prompts = filtered.slice(start, start + this.PAGE_SIZE);

    // Group paginated results by category
    const categories = {};
    for (const p of prompts) {
      const cat = p.category || 'Uncategorized';
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push(p);
    }

    el.innerHTML = `
      <div class="p-6 space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Prompts</h2>
          <button id="pmNewBtn" class="px-4 py-2.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm">
            + New Prompt
          </button>
        </div>

        <p class="text-xs text-neutral-500 dark:text-neutral-400">Save reusable prompts and quickly insert them into chat.</p>

        <input id="pmSearch" type="text" placeholder="Search prompts..." value="${this._escAttr(this.searchQuery)}"
          class="w-full bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300 placeholder-neutral-400 dark:placeholder-neutral-500 focus:bg-white/90 dark:focus:bg-neutral-800/90 focus:outline-none transition-all shadow-sm" />

        ${prompts.length === 0 ? `
          <div class="text-center py-12 text-neutral-400">
            <div class="p-3 bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-100 dark:border-neutral-800 shadow-sm text-neutral-400 inline-flex mb-2">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>
            </div>
            <p class="text-sm">${q ? 'No prompts match your search.' : 'No prompts yet. Create one to get started.'}</p>
          </div>
        ` : Object.entries(categories).map(([cat, items]) => `
          <div class="space-y-2">
            <h3 class="text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">${this._esc(cat)}</h3>
            ${items.map(p => `
              <div class="pm-item bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-xl p-4 shadow-sm hover:shadow-md transition-all" data-id="${p.id}">
                <div class="flex items-start justify-between">
                  <div class="min-w-0 flex-1">
                    <h4 class="text-sm font-medium text-neutral-900 dark:text-neutral-100">${this._esc(p.title)}</h4>
                    <p class="text-xs text-neutral-400 dark:text-neutral-500 mt-1 line-clamp-2">${this._esc(this._preview(p.content, 120))}</p>
                  </div>
                  <div class="flex items-center gap-1 ml-3 shrink-0">
                    <button class="pm-edit p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100/60 dark:hover:bg-neutral-700/60 transition-all" data-id="${p.id}" title="Edit">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button class="pm-delete p-1.5 rounded-lg text-neutral-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-all" data-id="${p.id}" title="Delete">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        `).join('')}

        <div class="flex items-center justify-center gap-2 pt-2">
          <button id="pmPrev" class="px-3 py-1.5 rounded-lg text-xs font-medium ${this.page === 0 ? 'text-neutral-300 dark:text-neutral-600 cursor-default' : 'text-neutral-600 dark:text-neutral-400 hover:bg-white/60 dark:hover:bg-neutral-800/60'}">← Prev</button>
          <span class="text-xs text-neutral-400">Page ${this.page + 1} of ${totalPages}</span>
          <button id="pmNext" class="px-3 py-1.5 rounded-lg text-xs font-medium ${this.page >= totalPages - 1 ? 'text-neutral-300 dark:text-neutral-600 cursor-default' : 'text-neutral-600 dark:text-neutral-400 hover:bg-white/60 dark:hover:bg-neutral-800/60'}">Next →</button>
        </div>
      </div>
    `;

    this._bindListEvents();
  },

  _bindListEvents() {
    document.querySelector('#pmNewBtn')?.addEventListener('click', () => this._showForm(null));

    document.querySelector('#pmSearch')?.addEventListener('input', (e) => {
      this.searchQuery = e.target.value;
      this.page = 0;
      this._showList();
    });

    document.querySelector('#pmPrev')?.addEventListener('click', () => {
      if (this.page > 0) { this.page--; this._showList(); }
    });
    document.querySelector('#pmNext')?.addEventListener('click', () => {
      this.page++; this._showList();
    });

    document.querySelectorAll('.pm-edit').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const prompts = await window.api.prompts.list();
        const prompt = prompts.find(p => p.id === btn.dataset.id);
        if (prompt) this._showForm(prompt);
      });
    });

    document.querySelectorAll('.pm-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('Delete this prompt?')) return;
        await window.api.prompts.delete(btn.dataset.id);
        this._showList();
      });
    });
  },

  _showForm(prompt) {
    this.currentView = 'form';
    this.editingPrompt = prompt;
    const el = document.querySelector('#promptsContent');
    const isEdit = !!prompt;

    el.innerHTML = `
      <div class="p-6 space-y-4">
        <div class="flex items-center gap-2">
          <button id="pmBackBtn" class="text-neutral-400 hover:text-neutral-600 text-sm">← Back</button>
          <span class="text-neutral-300">|</span>
          <span class="text-sm text-neutral-500">${isEdit ? 'Edit Prompt' : 'New Prompt'}</span>
        </div>

        <input id="pmTitle" type="text" placeholder="Prompt title (required)" value="${this._escAttr(prompt?.title || '')}"
          class="w-full bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2.5 text-sm text-neutral-700 dark:text-neutral-300 placeholder-neutral-400 dark:placeholder-neutral-500 focus:bg-white/90 dark:focus:bg-neutral-800/90 focus:outline-none transition-all shadow-sm" />

        <input id="pmCategory" type="text" placeholder="Category (optional, e.g. Writing, Code, Analysis)" value="${this._escAttr(prompt?.category || '')}"
          class="w-full bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2.5 text-sm text-neutral-700 dark:text-neutral-300 placeholder-neutral-400 dark:placeholder-neutral-500 focus:bg-white/90 dark:focus:bg-neutral-800/90 focus:outline-none transition-all shadow-sm" />

        <textarea id="pmContent" rows="10" placeholder="Prompt content — use {{variable}} for placeholders..."
          class="w-full resize-none bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2.5 text-sm text-neutral-700 dark:text-neutral-300 placeholder-neutral-400 dark:placeholder-neutral-500 focus:bg-white/90 dark:focus:bg-neutral-800/90 focus:outline-none transition-all shadow-sm font-mono">${this._esc(prompt?.content || '')}</textarea>

        <div class="flex gap-2">
          <button id="pmSaveBtn" class="px-4 py-2.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm">
            ${isEdit ? 'Save Changes' : 'Create Prompt'}
          </button>
          <button id="pmCancelBtn" class="text-sm text-neutral-500 dark:text-neutral-400 px-4 py-2 hover:text-neutral-700 dark:hover:text-neutral-300">Cancel</button>
        </div>
      </div>
    `;

    document.querySelector('#pmTitle')?.focus();
    this._bindFormEvents();
  },

  _bindFormEvents() {
    document.querySelector('#pmBackBtn')?.addEventListener('click', () => this._showList());
    document.querySelector('#pmCancelBtn')?.addEventListener('click', () => this._showList());

    document.querySelector('#pmSaveBtn')?.addEventListener('click', async () => {
      const title = document.querySelector('#pmTitle').value.trim();
      const content = document.querySelector('#pmContent').value.trim();
      const category = document.querySelector('#pmCategory').value.trim();

      if (!title || !content) return;

      if (this.editingPrompt) {
        await window.api.prompts.update(this.editingPrompt.id, { title, content, category });
      } else {
        await window.api.prompts.create({ title, content, category });
      }
      this._showList();
    });
  },

  _preview(content, max = 80) {
    if (!content) return '';
    return content.replace(/\n/g, ' ').substring(0, max);
  },

  _esc(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  },

  _escAttr(str) {
    return (str || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  },

  destroy() {},
};

window.PromptsPage = PromptsPage;
