// Prompt Picker — dropdown/popup for inserting saved prompts into chat input
// Renders as a small button next to the chat input area

const PromptPicker = {
  isOpen: false,
  prompts: [],
  filtered: [],
  searchQuery: '',

  /**
   * Render the prompt picker button into a container element
   * @param {HTMLElement} container - element to render the button into
   * @param {Function} onSelect - callback(content) when a prompt is selected
   */
  render(container, onSelect) {
    this._onSelect = onSelect;

    container.innerHTML = `
      <div class="relative inline-block">
        <button id="promptPickerBtn" class="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100/60 dark:hover:bg-neutral-700/60 transition-all" title="Insert prompt template">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M9 14h6"/><path d="M9 18h6"/><path d="M9 10h6"/></svg>
        </button>
        <div id="promptPickerDropdown" class="hidden absolute bottom-full left-0 mb-2 w-72 max-h-80 bg-white dark:bg-neutral-800 border border-neutral-200/60 dark:border-neutral-700/60 rounded-xl shadow-lg overflow-hidden z-50">
          <div class="p-2 border-b border-neutral-100 dark:border-neutral-700/50">
            <input id="promptPickerSearch" type="text" placeholder="Search prompts..."
              class="w-full bg-neutral-50 dark:bg-neutral-900/50 border border-neutral-200/50 dark:border-neutral-700/50 rounded-lg px-2.5 py-1.5 text-xs text-neutral-700 dark:text-neutral-300 placeholder-neutral-400 focus:outline-none" />
          </div>
          <div id="promptPickerList" class="overflow-y-auto max-h-60 p-1"></div>
          <div class="p-2 border-t border-neutral-100 dark:border-neutral-700/50">
            <button id="promptPickerManage" class="w-full text-center text-[11px] text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 py-1">
              Manage Prompts →
            </button>
          </div>
        </div>
      </div>
    `;

    this._bindEvents();
  },

  _bindEvents() {
    const btn = document.querySelector('#promptPickerBtn');
    const dropdown = document.querySelector('#promptPickerDropdown');
    const search = document.querySelector('#promptPickerSearch');

    btn?.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (this.isOpen) {
        this._close();
      } else {
        await this._open();
      }
    });

    search?.addEventListener('input', async (e) => {
      this.searchQuery = e.target.value;
      await this._loadPrompts();
      this._renderList();
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (this.isOpen && !e.target.closest('#promptPickerDropdown') && !e.target.closest('#promptPickerBtn')) {
        this._close();
      }
    });

    // Manage prompts link
    document.querySelector('#promptPickerManage')?.addEventListener('click', () => {
      this._close();
      if (window.AppRouter) window.AppRouter.navigate('prompts');
    });
  },

  async _open() {
    this.isOpen = true;
    this.searchQuery = '';
    const dropdown = document.querySelector('#promptPickerDropdown');
    const search = document.querySelector('#promptPickerSearch');
    dropdown?.classList.remove('hidden');
    if (search) search.value = '';
    await this._loadPrompts();
    this._renderList();
    search?.focus();
  },

  _close() {
    this.isOpen = false;
    document.querySelector('#promptPickerDropdown')?.classList.add('hidden');
  },

  async _loadPrompts() {
    if (this.searchQuery.trim()) {
      this.filtered = await window.api.prompts.search(this.searchQuery);
    } else {
      this.filtered = await window.api.prompts.list();
    }
  },

  _renderList() {
    const list = document.querySelector('#promptPickerList');
    if (!list) return;

    if (this.filtered.length === 0) {
      list.innerHTML = `
        <div class="text-center py-4 text-xs text-neutral-400">
          ${this.searchQuery ? 'No matching prompts' : 'No prompts saved yet'}
        </div>
      `;
      return;
    }

    list.innerHTML = this.filtered.map(p => `
      <button class="pp-item w-full text-left px-2.5 py-2 rounded-lg hover:bg-neutral-50 dark:hover:bg-neutral-700/50 transition-colors group" data-id="${p.id}">
        <div class="flex items-center gap-2">
          <span class="text-xs font-medium text-neutral-800 dark:text-neutral-200 truncate">${this._esc(p.title)}</span>
          ${p.category ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-400 shrink-0">${this._esc(p.category)}</span>` : ''}
        </div>
        <p class="text-[11px] text-neutral-400 dark:text-neutral-500 truncate mt-0.5">${this._esc(this._preview(p.content))}</p>
      </button>
    `).join('');

    list.querySelectorAll('.pp-item').forEach(item => {
      item.addEventListener('click', () => {
        const prompt = this.filtered.find(p => p.id === item.dataset.id);
        if (prompt && this._onSelect) {
          this._onSelect(prompt.content);
        }
        this._close();
      });
    });
  },

  _preview(content) {
    if (!content) return '';
    return content.replace(/\n/g, ' ').substring(0, 60);
  },

  _esc(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  },
};

window.PromptPicker = PromptPicker;
