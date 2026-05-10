// KB Multi-Select Component
// Allows selecting multiple collections or individual files within collections
// Returns selections as array: [{ collectionId, documentId? }]

const KBSelector = {
  _isOpen: false,
  _collections: [],
  _expandedCollections: new Set(),
  _selections: [], // [{ collectionId, documentId? }]
  _onChange: null,
  _containerEl: null,
  _searchQuery: '',
  _isRerendering: false, // Guard flag to prevent outside-click closing during re-render

  /**
   * Render the KB selector into the given container element
   * @param {HTMLElement} container - The element to render into
   * @param {Function} onChange - Callback when selections change: (selections) => void
   */
  render(container, onChange) {
    this._containerEl = container;
    this._onChange = onChange;
    container.innerHTML = this._buildHTML();
    this._bindEvents(container);
    this._loadCollections();
  },

  _buildHTML() {
    return `
      <div class="kb-multi-select relative">
        <button id="kbToggleBtn" type="button"
          class="w-full flex items-center gap-2 bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-lg px-2.5 py-1.5 text-xs text-neutral-600 dark:text-neutral-400 hover:bg-white/90 dark:hover:bg-neutral-800/90 transition-all shadow-sm cursor-pointer text-left">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="text-neutral-400 shrink-0"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>
          <span id="kbSelectionLabel" class="flex-1 truncate">No knowledge base</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-neutral-400"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div id="kbDropdown" class="hidden absolute bottom-full left-0 right-0 mb-1 bg-white dark:bg-neutral-800 border border-neutral-200/60 dark:border-neutral-700/60 rounded-xl shadow-lg max-h-64 overflow-hidden z-50 flex flex-col">
          <div class="px-2 pt-2 pb-1 border-b border-neutral-100 dark:border-neutral-700/50 shrink-0">
            <input id="kbSearchInput" type="text" placeholder="Search files..." 
              class="w-full bg-neutral-50 dark:bg-neutral-700/50 border border-neutral-200/50 dark:border-neutral-600/50 rounded-lg px-2.5 py-1.5 text-[11px] text-neutral-700 dark:text-neutral-300 placeholder-neutral-400 dark:placeholder-neutral-500 focus:bg-white dark:focus:bg-neutral-700 focus:outline-none transition-all" />
          </div>
          <div id="kbDropdownList" class="py-1 overflow-y-auto flex-1"></div>
        </div>
      </div>
    `;
  },

  _bindEvents(container) {
    const toggleBtn = container.querySelector('#kbToggleBtn');
    toggleBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this._toggleDropdown();
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (this._isOpen && !this._isRerendering && !container.querySelector('.kb-multi-select')?.contains(e.target)) {
        this._closeDropdown();
      }
    });

    // Search input (re-bind after each render since dropdown is rebuilt)
    this._bindSearchInput();
  },

  _bindSearchInput() {
    const searchInput = this._containerEl?.querySelector('#kbSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this._searchQuery = e.target.value.toLowerCase();
        this._renderDropdownList();
        // Re-focus search after re-render
        const newInput = this._containerEl?.querySelector('#kbSearchInput');
        if (newInput) {
          newInput.value = e.target.value;
          newInput.focus();
        }
      });
      // Prevent dropdown close when clicking in search
      searchInput.addEventListener('click', (e) => e.stopPropagation());
    }
  },

  async _loadCollections() {
    try {
      this._collections = await window.api.kb.getCollections();
      // Pre-load documents for each collection
      for (const coll of this._collections) {
        coll._documents = await window.api.kb.getDocuments(coll.id);
      }
      this._renderDropdownList();
    } catch (err) {
      console.warn('[KBSelector] Failed to load collections:', err.message);
    }
  },

  _toggleDropdown() {
    this._isOpen ? this._closeDropdown() : this._openDropdown();
  },

  _openDropdown() {
    this._isOpen = true;
    this._searchQuery = '';
    const dropdown = this._containerEl?.querySelector('#kbDropdown');
    if (dropdown) dropdown.classList.remove('hidden');
    this._renderDropdownList();
    // Focus search input after opening
    setTimeout(() => {
      const searchInput = this._containerEl?.querySelector('#kbSearchInput');
      if (searchInput) { searchInput.value = ''; searchInput.focus(); }
    }, 50);
  },

  _closeDropdown() {
    this._isOpen = false;
    const dropdown = this._containerEl?.querySelector('#kbDropdown');
    if (dropdown) dropdown.classList.add('hidden');
  },

  _renderDropdownList() {
    const listEl = this._containerEl?.querySelector('#kbDropdownList');
    if (!listEl) return;

    this._isRerendering = true;

    if (this._collections.length === 0) {
      listEl.innerHTML = `<div class="px-3 py-2 text-xs text-neutral-400">No collections yet</div>`;
      this._bindSearchInput();
      return;
    }

    const q = this._searchQuery;
    let html = '';
    let hasResults = false;

    for (const coll of this._collections) {
      const docs = coll._documents || [];
      const collNameMatch = !q || coll.name.toLowerCase().includes(q);
      // Filter docs by search query
      const matchingDocs = q
        ? docs.filter(d => d.title.toLowerCase().includes(q))
        : docs;

      // Show collection if its name matches OR any of its docs match
      if (!collNameMatch && matchingDocs.length === 0) continue;

      hasResults = true;
      // Auto-expand collections when searching and docs match
      const isExpanded = this._expandedCollections.has(coll.id) || (q && matchingDocs.length > 0);
      const collSelected = this._isCollectionSelected(coll.id);
      const someDocsSelected = this._hasPartialDocSelection(coll.id);

      html += `
        <div class="kb-coll-group" data-coll-id="${coll.id}">
          <div class="flex items-center gap-1 px-2 py-1.5 hover:bg-neutral-50 dark:hover:bg-neutral-700/50 cursor-pointer">
            <button class="kb-expand-btn shrink-0 w-5 h-5 flex items-center justify-center rounded hover:bg-neutral-200/60 dark:hover:bg-neutral-600/60 transition-colors" data-coll-id="${coll.id}" title="${docs.length} document${docs.length !== 1 ? 's' : ''}">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="transition-transform ${isExpanded ? 'rotate-90' : ''}"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
            <label class="flex items-center gap-2 flex-1 cursor-pointer min-w-0">
              <input type="checkbox" class="kb-coll-check rounded border-neutral-300 dark:border-neutral-600 text-neutral-900 dark:text-neutral-100 focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5"
                data-coll-id="${coll.id}" ${collSelected ? 'checked' : ''} ${someDocsSelected && !collSelected ? 'indeterminate' : ''}>
              <span class="text-xs text-neutral-700 dark:text-neutral-300 truncate">${this._esc(coll.name)}</span>
              <span class="text-[10px] text-neutral-400 shrink-0">(${docs.length})</span>
            </label>
          </div>
          ${isExpanded ? this._renderDocList(coll.id, q ? matchingDocs : docs) : ''}
        </div>
      `;
    }

    if (!hasResults) {
      html = `<div class="px-3 py-3 text-xs text-neutral-400 text-center">No matches for "${this._esc(this._searchQuery)}"</div>`;
    }

    listEl.innerHTML = html;
    this._bindDropdownEvents(listEl);
    this._setIndeterminateStates(listEl);
    this._bindSearchInput();

    // Reset re-render guard after a tick to allow current event to finish
    setTimeout(() => { this._isRerendering = false; }, 0);
  },

  _renderDocList(collectionId, docs) {
    if (docs.length === 0) {
      return `<div class="pl-8 pr-3 py-1 text-[10px] text-neutral-400 italic">No documents</div>`;
    }

    let html = '<div class="kb-doc-list pl-6 border-l border-neutral-100 dark:border-neutral-700 ml-4">';
    for (const doc of docs) {
      const isSelected = this._isDocumentSelected(collectionId, doc.id);
      const icon = this._getDocIcon(doc.source_type);
      html += `
        <label class="flex items-center gap-2 px-2 py-1 hover:bg-neutral-50 dark:hover:bg-neutral-700/50 cursor-pointer">
          <input type="checkbox" class="kb-doc-check rounded border-neutral-300 dark:border-neutral-600 text-neutral-900 dark:text-neutral-100 focus:ring-0 focus:ring-offset-0 w-3 h-3"
            data-coll-id="${collectionId}" data-doc-id="${doc.id}" ${isSelected ? 'checked' : ''}>
          <span class="text-[10px] text-neutral-400 shrink-0">${icon}</span>
          <span class="text-[11px] text-neutral-600 dark:text-neutral-400 truncate">${this._esc(doc.title)}</span>
        </label>
      `;
    }
    html += '</div>';
    return html;
  },

  _bindDropdownEvents(listEl) {
    // Expand/collapse buttons
    listEl.querySelectorAll('.kb-expand-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const collId = btn.dataset.collId;
        if (this._expandedCollections.has(collId)) {
          this._expandedCollections.delete(collId);
        } else {
          this._expandedCollections.add(collId);
        }
        this._renderDropdownList();
      });
    });

    // Collection checkboxes
    listEl.querySelectorAll('.kb-coll-check').forEach(cb => {
      cb.addEventListener('change', (e) => {
        e.stopPropagation();
        const collId = cb.dataset.collId;
        if (cb.checked) {
          this._selectWholeCollection(collId);
        } else {
          this._deselectCollection(collId);
        }
        this._emitChange();
        this._renderDropdownList();
      });
      cb.addEventListener('click', (e) => e.stopPropagation());
    });

    // Document checkboxes
    listEl.querySelectorAll('.kb-doc-check').forEach(cb => {
      cb.addEventListener('change', (e) => {
        e.stopPropagation();
        const collId = cb.dataset.collId;
        const docId = cb.dataset.docId;
        if (cb.checked) {
          this._selectDocument(collId, docId);
        } else {
          this._deselectDocument(collId, docId);
        }
        this._emitChange();
        this._renderDropdownList();
      });
      cb.addEventListener('click', (e) => e.stopPropagation());
    });
  },

  _setIndeterminateStates(listEl) {
    listEl.querySelectorAll('.kb-coll-check').forEach(cb => {
      const collId = cb.dataset.collId;
      if (this._hasPartialDocSelection(collId) && !this._isCollectionSelected(collId)) {
        cb.indeterminate = true;
      }
    });
  },

  // ── Selection logic ──────────────────────────────────────────

  _selectWholeCollection(collId) {
    // Remove any individual doc selections for this collection
    this._selections = this._selections.filter(s => s.collectionId !== collId);
    // Add whole collection selection
    this._selections.push({ collectionId: collId });
  },

  _deselectCollection(collId) {
    this._selections = this._selections.filter(s => s.collectionId !== collId);
  },

  _selectDocument(collId, docId) {
    // If whole collection is selected, don't add individual docs
    if (this._isCollectionSelected(collId)) return;
    // Add doc if not already selected
    if (!this._isDocumentSelected(collId, docId)) {
      this._selections.push({ collectionId: collId, documentId: docId });
    }
    // Check if all docs in collection are now selected → upgrade to collection-level
    const coll = this._collections.find(c => c.id === collId);
    if (coll && coll._documents) {
      const selectedDocs = this._selections.filter(s => s.collectionId === collId && s.documentId);
      if (selectedDocs.length >= coll._documents.length) {
        this._selectWholeCollection(collId);
      }
    }
  },

  _deselectDocument(collId, docId) {
    // If whole collection was selected, break it into individual doc selections minus this one
    if (this._isCollectionSelected(collId)) {
      const coll = this._collections.find(c => c.id === collId);
      this._selections = this._selections.filter(s => s.collectionId !== collId);
      if (coll && coll._documents) {
        for (const doc of coll._documents) {
          if (doc.id !== docId) {
            this._selections.push({ collectionId: collId, documentId: doc.id });
          }
        }
      }
    } else {
      this._selections = this._selections.filter(s => !(s.collectionId === collId && s.documentId === docId));
    }
  },

  _isCollectionSelected(collId) {
    return this._selections.some(s => s.collectionId === collId && !s.documentId);
  },

  _isDocumentSelected(collId, docId) {
    // Selected if whole collection is selected OR specific doc is selected
    return this._isCollectionSelected(collId) ||
      this._selections.some(s => s.collectionId === collId && s.documentId === docId);
  },

  _hasPartialDocSelection(collId) {
    return this._selections.some(s => s.collectionId === collId && s.documentId);
  },

  _emitChange() {
    this._updateLabel();
    if (this._onChange) this._onChange(this._selections);
  },

  _updateLabel() {
    const labelEl = this._containerEl?.querySelector('#kbSelectionLabel');
    if (!labelEl) return;

    if (this._selections.length === 0) {
      labelEl.textContent = 'No knowledge base';
      return;
    }

    const collCount = this._selections.filter(s => !s.documentId).length;
    const docCount = this._selections.filter(s => s.documentId).length;

    const parts = [];
    if (collCount === 1 && docCount === 0) {
      const coll = this._collections.find(c => c.id === this._selections[0].collectionId);
      parts.push(coll?.name || '1 collection');
    } else if (collCount > 0) {
      parts.push(`${collCount} collection${collCount > 1 ? 's' : ''}`);
    }
    if (docCount > 0) {
      parts.push(`${docCount} file${docCount > 1 ? 's' : ''}`);
    }
    labelEl.textContent = parts.join(' + ');
  },

  // ── Public API ───────────────────────────────────────────────

  getSelections() {
    return [...this._selections];
  },

  setSelections(selections) {
    this._selections = selections || [];
    this._updateLabel();
    this._renderDropdownList();
  },

  hasSelections() {
    return this._selections.length > 0;
  },

  /**
   * Get all collection IDs that are relevant (either whole collection or have docs selected)
   */
  getActiveCollectionIds() {
    const ids = new Set();
    for (const s of this._selections) {
      ids.add(s.collectionId);
    }
    return [...ids];
  },

  /**
   * Get document IDs selected for a specific collection (empty if whole collection selected)
   */
  getDocumentIdsForCollection(collId) {
    if (this._isCollectionSelected(collId)) return null; // null = all docs
    return this._selections
      .filter(s => s.collectionId === collId && s.documentId)
      .map(s => s.documentId);
  },

  async refresh() {
    await this._loadCollections();
  },

  // ── Helpers ──────────────────────────────────────────────────

  _getDocIcon(sourceType) {
    switch (sourceType) {
      case 'pdf': return '📄';
      case 'file': return '📎';
      case 'paste': return '📝';
      default: return '📄';
    }
  },

  _esc(str) {
    const div = document.createElement('span');
    div.textContent = str || '';
    return div.innerHTML;
  },
};

// Export for use in chat.js
window.KBSelector = KBSelector;
