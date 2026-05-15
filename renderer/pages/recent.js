// Recent conversations page — search + pagination

const RecentPage = {
  search: '',
  page: 0,
  PAGE_SIZE: 10,

  render(container) {
    container.innerHTML = `
      <div id="recentPage" class="flex flex-col flex-1 min-h-0">
        <div class="p-6 pb-4">
          <h2 class="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100 mb-4">Recent Chats</h2>
          <p class="text-xs text-neutral-500 dark:text-neutral-400 mb-4">Browse and continue previous conversations.</p>
          <div class="flex items-center gap-2">
            <input id="recentSearch" type="text" placeholder="Search conversations..."
              class="flex-1 bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300 placeholder-neutral-400 dark:placeholder-neutral-500 focus:bg-white/90 dark:focus:bg-neutral-800/90 focus:outline-none transition-all shadow-sm" />
          </div>
        </div>
        <div id="recentList" class="flex-1 overflow-y-auto px-6"></div>
        <div id="recentPagination" class="px-6 py-3 border-t border-neutral-200/40 dark:border-neutral-700/40 flex items-center justify-between">
          <button id="recentPrev" class="px-3 py-1.5 rounded-lg bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 text-xs font-medium text-neutral-600 dark:text-neutral-400 hover:bg-white/90 dark:hover:bg-neutral-800/90 transition-all disabled:opacity-40 disabled:cursor-not-allowed" disabled>Previous</button>
          <span id="recentPageInfo" class="text-xs text-neutral-500 dark:text-neutral-400"></span>
          <button id="recentNext" class="px-3 py-1.5 rounded-lg bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 text-xs font-medium text-neutral-600 dark:text-neutral-400 hover:bg-white/90 dark:hover:bg-neutral-800/90 transition-all disabled:opacity-40 disabled:cursor-not-allowed" disabled>Next</button>
        </div>
      </div>
    `;

    this._bind(container);
    this._loadList();
  },

  _bind(container) {
    const searchInput = container.querySelector('#recentSearch');
    searchInput.value = this.search;

    let debounce;
    searchInput.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        this.search = searchInput.value.trim();
        this.page = 0;
        this._loadList();
      }, 200);
    });

    container.querySelector('#recentPrev').addEventListener('click', () => {
      if (this.page > 0) { this.page--; this._loadList(); }
    });
    container.querySelector('#recentNext').addEventListener('click', () => {
      this.page++;
      this._loadList();
    });
  },

  async _loadList() {
    const listEl = document.querySelector('#recentList');
    const prevBtn = document.querySelector('#recentPrev');
    const nextBtn = document.querySelector('#recentNext');
    const pageInfo = document.querySelector('#recentPageInfo');
    if (!listEl) return;

    const allConvs = await window.api.storage.getConversations(500);

    // Filter by search
    let filtered = allConvs;
    if (this.search) {
      const q = this.search.toLowerCase();
      filtered = allConvs.filter(c => (c.title || '').toLowerCase().includes(q));
    }

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / this.PAGE_SIZE));
    if (this.page >= totalPages) this.page = totalPages - 1;

    const start = this.page * this.PAGE_SIZE;
    const pageItems = filtered.slice(start, start + this.PAGE_SIZE);

    // Render list
    if (!pageItems.length) {
      listEl.innerHTML = '<p class="text-sm text-neutral-400 py-4">No conversations found.</p>';
    } else {
      listEl.innerHTML = pageItems.map(conv => {
        const title = this._esc(conv.title || 'New conversation');
        const date = conv.updated_at ? new Date(conv.updated_at).toLocaleDateString() : '';
        return `
          <div class="recent-item group flex items-center justify-between py-3 px-3 rounded-xl hover:bg-white/50 dark:hover:bg-neutral-800/50 transition-all cursor-pointer border-b border-neutral-100/50 dark:border-neutral-800/30" data-id="${conv.id}">
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate">${title}</p>
              <p class="text-[11px] text-neutral-400 mt-0.5">${date}</p>
            </div>
            <div class="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <button class="recent-delete p-1.5 rounded-lg text-neutral-300 hover:text-rose-500 dark:text-neutral-600 dark:hover:text-rose-400 transition-colors" data-id="${conv.id}" title="Delete">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="text-neutral-400"><polyline points="9 18 15 12 9 6"/></svg>
            </div>
          </div>
        `;
      }).join('');

      // Bind click to open conversation
      listEl.querySelectorAll('.recent-item').forEach(el => {
        el.addEventListener('click', (e) => {
          if (e.target.closest('.recent-delete')) return;
          const id = el.dataset.id;
          window._cwPendingConvId = id;
          window.ChatPage.activeConversationId = null;
          window.AppRouter.navigate('chat');
        });
      });

      // Bind delete buttons
      listEl.querySelectorAll('.recent-delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const id = btn.dataset.id;
          if (!confirm('Delete this conversation?')) return;
          await window.api.storage.deleteConversation(id);
          if (window.ChatPage.activeConversationId === id) {
            window.ChatPage.activeConversationId = null;
            window.ChatPage.chatHistory = [];
          }
          this._loadList();
        });
      });
    }

    // Pagination
    pageInfo.textContent = `Page ${this.page + 1} of ${totalPages}`;
    prevBtn.disabled = this.page === 0;
    nextBtn.disabled = this.page >= totalPages - 1;
  },

  _esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }
};

window.RecentPage = RecentPage;
