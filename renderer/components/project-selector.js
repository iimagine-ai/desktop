// Project Selector Component
// Search-and-select dropdown for client projects in chat.
// Sits next to the KB selector. When a project is selected, its context
// is injected into the system prompt via the client-workspace plugin.

const ProjectSelector = {
  _isOpen: false,
  _projects: [],
  _selectedId: null,
  _selectedName: null,
  _onChange: null,
  _containerEl: null,
  _searchQuery: '',

  /**
   * Render the project selector into the given container element
   * @param {HTMLElement} container
   * @param {Function} onChange - (project | null) => void
   */
  render(container, onChange) {
    this._containerEl = container;
    this._onChange = onChange;
    container.innerHTML = this._buildHTML();
    this._bindEvents(container);
    this._loadProjects();
    this._restoreSelection();
  },

  _buildHTML() {
    return `
      <div class="project-selector relative">
        <button id="projToggleBtn" type="button"
          class="flex items-center gap-2 bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-lg px-2.5 py-1.5 text-xs text-neutral-600 dark:text-neutral-400 hover:bg-white/90 dark:hover:bg-neutral-800/90 transition-all shadow-sm cursor-pointer text-left max-w-[180px]">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="text-neutral-400 shrink-0"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          <span id="projSelectionLabel" class="flex-1 truncate">No project</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-neutral-400"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div id="projDropdown" class="hidden absolute bottom-full left-0 mb-1 bg-white dark:bg-neutral-800 border border-neutral-200/60 dark:border-neutral-700/60 rounded-xl shadow-lg w-64 max-h-56 overflow-hidden z-50 flex flex-col">
          <div class="px-2 pt-2 pb-1 border-b border-neutral-100 dark:border-neutral-700/50 shrink-0">
            <input id="projSearchInput" type="text" placeholder="Search projects..."
              class="w-full bg-neutral-50 dark:bg-neutral-700/50 border border-neutral-200/50 dark:border-neutral-600/50 rounded-lg px-2.5 py-1.5 text-[11px] text-neutral-700 dark:text-neutral-300 placeholder-neutral-400 dark:placeholder-neutral-500 focus:bg-white dark:focus:bg-neutral-700 focus:outline-none transition-all" />
          </div>
          <div id="projDropdownList" class="py-1 overflow-y-auto flex-1"></div>
        </div>
      </div>
    `;
  },

  _bindEvents(container) {
    const toggleBtn = container.querySelector('#projToggleBtn');
    toggleBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this._toggleDropdown();
    });

    document.addEventListener('click', (e) => {
      if (this._isOpen && !container.querySelector('.project-selector')?.contains(e.target)) {
        this._closeDropdown();
      }
    });
  },

  _bindSearchInput() {
    const searchInput = this._containerEl?.querySelector('#projSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this._searchQuery = e.target.value.toLowerCase();
        this._renderList();
      });
      searchInput.addEventListener('click', (e) => e.stopPropagation());
    }
  },

  async _loadProjects() {
    try {
      this._projects = await window.api.plugins.sendEvent('cw:list-projects', {});
      if (!Array.isArray(this._projects)) this._projects = [];
    } catch (err) {
      console.warn('[ProjectSelector] Failed to load projects:', err.message);
      this._projects = [];
    }
  },

  async _restoreSelection() {
    try {
      const project = await window.api.plugins.sendEvent('cw:get-active-project', {});
      if (project && project.id) {
        this._selectedId = project.id;
        this._selectedName = project.name;
        this._updateLabel();
      }
    } catch {}
  },

  _toggleDropdown() {
    this._isOpen ? this._closeDropdown() : this._openDropdown();
  },

  async _openDropdown() {
    this._isOpen = true;
    this._searchQuery = '';
    await this._loadProjects();
    const dropdown = this._containerEl?.querySelector('#projDropdown');
    if (dropdown) dropdown.classList.remove('hidden');
    this._renderList();
    setTimeout(() => {
      const input = this._containerEl?.querySelector('#projSearchInput');
      if (input) { input.value = ''; input.focus(); }
    }, 50);
  },

  _closeDropdown() {
    this._isOpen = false;
    const dropdown = this._containerEl?.querySelector('#projDropdown');
    if (dropdown) dropdown.classList.add('hidden');
  },

  _renderList() {
    const listEl = this._containerEl?.querySelector('#projDropdownList');
    if (!listEl) return;

    const q = this._searchQuery;
    const filtered = q
      ? this._projects.filter(p => p.name.toLowerCase().includes(q))
      : this._projects;

    let html = '';

    // "None" option to deselect
    html += `
      <div class="proj-item flex items-center gap-2 px-3 py-1.5 hover:bg-neutral-50 dark:hover:bg-neutral-700/50 cursor-pointer ${!this._selectedId ? 'bg-neutral-50 dark:bg-neutral-700/50' : ''}" data-proj-id="">
        <span class="text-xs text-neutral-400 italic">No project</span>
      </div>
    `;

    if (filtered.length === 0 && q) {
      html += `<div class="px-3 py-2 text-xs text-neutral-400 text-center">No matches</div>`;
    } else {
      for (const p of filtered) {
        const isActive = p.id === this._selectedId;
        const statusDot = p.status === 'active'
          ? '<span class="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"></span>'
          : '<span class="w-1.5 h-1.5 rounded-full bg-neutral-300 shrink-0"></span>';
        html += `
          <div class="proj-item flex items-center gap-2 px-3 py-1.5 hover:bg-neutral-50 dark:hover:bg-neutral-700/50 cursor-pointer ${isActive ? 'bg-neutral-100 dark:bg-neutral-700/70' : ''}" data-proj-id="${p.id}">
            ${statusDot}
            <span class="text-xs text-neutral-700 dark:text-neutral-300 truncate flex-1">${this._esc(p.name)}</span>
            ${isActive ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="text-neutral-900 dark:text-neutral-100 shrink-0"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
          </div>
        `;
      }
    }

    listEl.innerHTML = html;
    this._bindListEvents(listEl);
    this._bindSearchInput();
  },

  _bindListEvents(listEl) {
    listEl.querySelectorAll('.proj-item').forEach(item => {
      item.addEventListener('click', async (e) => {
        e.stopPropagation();
        const projId = item.dataset.projId;
        if (projId) {
          await window.api.plugins.sendEvent('cw:select-project', { id: projId });
          const project = this._projects.find(p => p.id === projId);
          this._selectedId = projId;
          this._selectedName = project?.name || '';
        } else {
          await window.api.plugins.sendEvent('cw:deselect-project', {});
          this._selectedId = null;
          this._selectedName = null;
        }
        this._updateLabel();
        this._closeDropdown();
        if (this._onChange) {
          this._onChange(this._selectedId ? { id: this._selectedId, name: this._selectedName } : null);
        }
      });
    });
  },

  _updateLabel() {
    const labelEl = this._containerEl?.querySelector('#projSelectionLabel');
    if (!labelEl) return;
    labelEl.textContent = this._selectedName || 'No project';
  },

  // ── Public API ───────────────────────────────────────────────

  getSelectedProject() {
    if (!this._selectedId) return null;
    return { id: this._selectedId, name: this._selectedName };
  },

  setSelection(projectId, projectName) {
    this._selectedId = projectId;
    this._selectedName = projectName;
    this._updateLabel();
  },

  clearSelection() {
    this._selectedId = null;
    this._selectedName = null;
    this._updateLabel();
  },

  _esc(str) {
    const div = document.createElement('span');
    div.textContent = str || '';
    return div.innerHTML;
  },
};

window.ProjectSelector = ProjectSelector;
