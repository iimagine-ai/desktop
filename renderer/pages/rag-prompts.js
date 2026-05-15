// RAG Prompts page — Manage context-aware system prompts for KB chat
// Categories: project_active, kb_selected, comms_kb_selected

const CATEGORY_LABELS = {
  project_active: 'Project Active',
  kb_selected: 'Knowledge Base',
  comms_kb_selected: 'Communications',
};

const CATEGORY_DESCRIPTIONS = {
  project_active: 'Applied when a project is selected but no KB is active.',
  kb_selected: 'Applied when any KB collection is selected for chat.',
  comms_kb_selected: 'Applied when a project communications KB is selected.',
};

const RagPromptsPage = {
  currentView: 'list',
  editingPrompt: null,

  render(container) {
    container.innerHTML = `
      <div id="ragPromptsPage" class="flex flex-col flex-1 min-h-0">
        <div id="ragPromptsContent" class="flex-1 overflow-y-auto"></div>
      </div>
    `;
    this._showList();
  },

  async _showList() {
    this.currentView = 'list';
    this.editingPrompt = null;
    const el = document.querySelector('#ragPromptsContent');
    const allPrompts = await window.api.ragPrompts.list();

    const grouped = { project_active: [], kb_selected: [], comms_kb_selected: [] };
    for (const p of allPrompts) {
      if (grouped[p.category]) grouped[p.category].push(p);
    }

    const activeIds = {};
    for (const cat of Object.keys(grouped)) {
      activeIds[cat] = await window.api.ragPrompts.getActive(cat);
    }

    el.innerHTML = `
      <div class="p-6 space-y-6">
        <div>
          <h2 class="text-lg font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">RAG System Prompts</h2>
          <p class="text-xs text-neutral-500 dark:text-neutral-400 mt-1">Control how the AI responds when querying your knowledge base. The active prompt is automatically applied based on context.</p>
        </div>

        ${Object.entries(grouped).map(([cat, prompts]) => `
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <div>
                <h3 class="text-sm font-medium text-neutral-700 dark:text-neutral-300">${CATEGORY_LABELS[cat]}</h3>
                <p class="text-xs text-neutral-400 dark:text-neutral-500">${CATEGORY_DESCRIPTIONS[cat]}</p>
              </div>
              <button class="rp-add-btn px-3 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-800 text-xs font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-all" data-category="${cat}">
                + Add
              </button>
            </div>

            ${prompts.map(p => {
              const isActive = activeIds[cat] === p.id || (!activeIds[cat] && p.is_default);
              return `
              <div class="rp-item flex items-start gap-3 p-3 rounded-xl border ${isActive ? 'border-neutral-900 dark:border-neutral-100 bg-neutral-50 dark:bg-neutral-800/80' : 'border-neutral-200/40 dark:border-neutral-700/40 bg-white/50 dark:bg-neutral-800/30'} transition-all" data-id="${p.id}" data-category="${cat}">
                <button class="rp-activate mt-0.5 w-4 h-4 rounded-full border-2 ${isActive ? 'border-neutral-900 dark:border-neutral-100 bg-neutral-900 dark:bg-neutral-100' : 'border-neutral-300 dark:border-neutral-600 hover:border-neutral-500'} transition-all shrink-0" data-id="${p.id}" data-category="${cat}" title="${isActive ? 'Active' : 'Set as active'}"></button>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <h4 class="text-sm font-medium text-neutral-900 dark:text-neutral-100">${this._esc(p.title)}</h4>
                    ${p.is_default ? '<span class="text-[10px] px-1.5 py-0.5 rounded bg-neutral-200 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-400">Default</span>' : ''}
                    ${isActive ? '<span class="text-[10px] px-1.5 py-0.5 rounded bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900">Active</span>' : ''}
                  </div>
                  <p class="text-xs text-neutral-400 dark:text-neutral-500 mt-1 line-clamp-2">${this._esc(this._preview(p.content, 150))}</p>
                </div>
                <div class="flex items-center gap-1 shrink-0">
                  <button class="rp-edit p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100/60 dark:hover:bg-neutral-700/60 transition-all" data-id="${p.id}" title="Edit">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  </button>
                  ${!p.is_default ? `
                  <button class="rp-delete p-1.5 rounded-lg text-neutral-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-all" data-id="${p.id}" title="Delete">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  </button>` : ''}
                </div>
              </div>`;
            }).join('')}
          </div>
        `).join('')}
      </div>
    `;

    this._bindListEvents();
  },

  _bindListEvents() {
    document.querySelectorAll('.rp-activate').forEach(btn => {
      btn.addEventListener('click', async () => {
        await window.api.ragPrompts.setActive(btn.dataset.category, btn.dataset.id);
        this._showList();
      });
    });

    document.querySelectorAll('.rp-edit').forEach(btn => {
      btn.addEventListener('click', async () => {
        const prompt = await window.api.ragPrompts.get(btn.dataset.id);
        if (prompt) this._showForm(prompt);
      });
    });

    document.querySelectorAll('.rp-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this prompt?')) return;
        await window.api.ragPrompts.delete(btn.dataset.id);
        this._showList();
      });
    });

    document.querySelectorAll('.rp-add-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._showForm({ category: btn.dataset.category });
      });
    });
  },

  _showForm(prompt) {
    this.currentView = 'form';
    this.editingPrompt = prompt;
    const el = document.querySelector('#ragPromptsContent');
    const isEdit = !!prompt?.id;
    const category = prompt?.category || 'kb_selected';

    el.innerHTML = `
      <div class="p-6 space-y-4">
        <div class="flex items-center gap-2">
          <button id="rpBackBtn" class="text-neutral-400 hover:text-neutral-600 text-sm">← Back</button>
          <span class="text-neutral-300">|</span>
          <span class="text-sm text-neutral-500">${isEdit ? 'Edit' : 'New'} ${CATEGORY_LABELS[category] || ''} Prompt</span>
        </div>

        <input id="rpTitle" type="text" placeholder="Prompt title" value="${this._escAttr(prompt?.title || '')}"
          class="w-full bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2.5 text-sm text-neutral-700 dark:text-neutral-300 placeholder-neutral-400 focus:outline-none transition-all shadow-sm" />

        <textarea id="rpContent" rows="12" placeholder="System prompt content — this instructs the AI how to respond when this context is active..."
          class="w-full resize-none bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2.5 text-sm text-neutral-700 dark:text-neutral-300 placeholder-neutral-400 focus:outline-none transition-all shadow-sm font-mono">${this._esc(prompt?.content || '')}</textarea>

        <div class="flex gap-2">
          <button id="rpSaveBtn" class="px-4 py-2.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm">
            ${isEdit ? 'Save Changes' : 'Create Prompt'}
          </button>
          <button id="rpCancelBtn" class="text-sm text-neutral-500 px-4 py-2 hover:text-neutral-700 dark:hover:text-neutral-300">Cancel</button>
        </div>
      </div>
    `;

    document.querySelector('#rpTitle')?.focus();
    document.querySelector('#rpBackBtn')?.addEventListener('click', () => this._showList());
    document.querySelector('#rpCancelBtn')?.addEventListener('click', () => this._showList());

    document.querySelector('#rpSaveBtn')?.addEventListener('click', async () => {
      const title = document.querySelector('#rpTitle').value.trim();
      const content = document.querySelector('#rpContent').value.trim();
      if (!title || !content) return;

      if (isEdit) {
        await window.api.ragPrompts.update(prompt.id, { title, content });
      } else {
        await window.api.ragPrompts.create({ category, title, content });
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

window.RagPromptsPage = RagPromptsPage;
