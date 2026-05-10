// Folder Connect UI — renders connected folders section in Knowledge Base page

const FolderConnectUI = {
  _indexingState: {}, // folderId -> { indexed, total }

  async render(container) {
    const folders = await window.api.folders.list();

    container.innerHTML = `
      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-medium text-neutral-700 dark:text-neutral-300">Connected Folders</h3>
          <button id="fcAddBtn" class="px-4 py-2.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm">
            + Connect Folder
          </button>
        </div>

        ${folders.length === 0 ? `
          <div class="text-center py-6 border border-dashed border-neutral-200/60 dark:border-neutral-700/60 rounded-2xl">
            <p class="text-xs text-neutral-400 dark:text-neutral-500">No folders connected. Connect a folder to auto-index its files.</p>
          </div>
        ` : `
          <div class="space-y-2">
            ${folders.map(f => this._renderFolder(f)).join('')}
          </div>
        `}
      </div>
    `;

    this._bindEvents();
    this._listenForProgress();
  },

  _renderFolder(folder) {
    const statusColors = {
      active: 'bg-emerald-400',
      watching: 'bg-emerald-400 animate-pulse',
      indexing: 'bg-amber-400 animate-pulse',
      error: 'bg-rose-400',
    };
    const statusDot = statusColors[folder.status] || statusColors.active;
    const synced = folder.last_synced ? this._formatDate(folder.last_synced) : 'Never';

    return `
      <div class="fc-folder bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-xl p-3 shadow-sm" data-id="${folder.id}">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 rounded-full ${statusDot} shrink-0"></span>
              <span class="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate">${this._esc(folder.name)}</span>
            </div>
            <p class="text-[11px] text-neutral-400 dark:text-neutral-500 mt-0.5 truncate pl-4">${this._esc(folder.path)}</p>
            <div class="flex gap-3 text-[11px] text-neutral-400 mt-1 pl-4">
              <span>${folder.file_count} file${folder.file_count !== 1 ? 's' : ''}</span>
              <span>·</span>
              <span>Synced ${synced}</span>
            </div>
            <div id="fc-progress-${folder.id}" class="hidden mt-2 pl-4">
              <div class="flex items-center gap-2">
                <div class="flex-1 bg-neutral-100 dark:bg-neutral-700 rounded-full h-1.5">
                  <div class="fc-bar bg-neutral-900 dark:bg-neutral-100 h-1.5 rounded-full transition-all" style="width: 0%"></div>
                </div>
                <span class="fc-count text-[10px] text-neutral-400 tabular-nums"></span>
              </div>
            </div>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <button class="fc-reindex p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100/60 dark:hover:bg-neutral-700/60 transition-all" data-id="${folder.id}" title="Re-index">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
            </button>
            <button class="fc-remove p-1.5 rounded-lg text-neutral-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-all" data-id="${folder.id}" title="Remove">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </div>
      </div>
    `;
  },

  _bindEvents() {
    document.querySelector('#fcAddBtn')?.addEventListener('click', async () => {
      const result = await window.api.folders.add();
      if (result && !result.canceled && !result.error) {
        const container = document.querySelector('#fcContainer');
        if (container) this.render(container);
      } else if (result?.error) {
        alert(result.error);
      }
    });

    document.querySelectorAll('.fc-reindex').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        btn.disabled = true;
        await window.api.folders.reindex(id);
        const container = document.querySelector('#fcContainer');
        if (container) this.render(container);
      });
    });

    document.querySelectorAll('.fc-remove').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        if (!confirm('Remove this folder connection? Files will no longer be indexed.')) return;
        await window.api.folders.remove(id);
        const container = document.querySelector('#fcContainer');
        if (container) this.render(container);
      });
    });
  },

  _listenForProgress() {
    window.api.folders.onProgress((data) => {
      if (!data.folderId) return;
      const el = document.querySelector(`#fc-progress-${data.folderId}`);
      if (!el) return;

      if (data.done) {
        el.classList.add('hidden');
        const container = document.querySelector('#fcContainer');
        if (container) this.render(container);
        return;
      }

      el.classList.remove('hidden');
      const bar = el.querySelector('.fc-bar');
      const count = el.querySelector('.fc-count');
      if (bar && data.total > 0) {
        const pct = Math.round((data.indexed / data.total) * 100);
        bar.style.width = pct + '%';
      }
      if (count) count.textContent = `${data.indexed || 0}/${data.total || 0}`;
    });
  },

  _esc(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  },

  _formatDate(dateStr) {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr.endsWith('Z') ? dateStr : dateStr + 'Z');
      if (isNaN(d.getTime())) return '';
      const now = new Date();
      const diff = now - d;
      if (diff < 60000) return 'just now';
      if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
      if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch { return ''; }
  },
};

window.FolderConnectUI = FolderConnectUI;
