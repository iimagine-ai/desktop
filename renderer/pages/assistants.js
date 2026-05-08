// Assistants page — create/manage custom AI assistants with KB integration

const AssistantsPage = {
  currentView: 'list', // 'list' | 'edit' | 'chat'
  currentAssistant: null,
  currentConversation: null,
  _streamBuffer: '',
  _searchQuery: '',
  _page: 0,
  _pageSize: 10,

  render(container) {
    container.innerHTML = '<div id="asstPage" class="flex flex-col flex-1 min-h-0"><div id="asstContent" class="flex-1 overflow-y-auto"></div></div>';
    this._showList();
  },

  // ── Assistant List ──────────────────────────────────────────
  async _showList() {
    this.currentView = 'list';
    this.currentAssistant = null;
    const el = document.querySelector('#asstContent');
    const allAssistants = await window.api.assistants.list();

    // Filter by search
    const q = this._searchQuery.toLowerCase();
    const filtered = q ? allAssistants.filter(a =>
      (a.title || '').toLowerCase().includes(q) ||
      (a.description || '').toLowerCase().includes(q) ||
      (a.collection_name || '').toLowerCase().includes(q)
    ) : allAssistants;

    // Pagination
    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / this._pageSize));
    this._page = Math.min(this._page, totalPages - 1);
    const start = this._page * this._pageSize;
    const assistants = filtered.slice(start, start + this._pageSize);

    el.innerHTML = `
      <div class="p-6 space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">AI Assistants</h2>
          <button id="asstNewBtn" class="px-4 py-2.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm">+ New Assistant</button>
        </div>
        <p class="text-xs text-neutral-500">${allAssistants.length} assistant${allAssistants.length !== 1 ? 's' : ''}${q ? ` · ${filtered.length} match${filtered.length !== 1 ? 'es' : ''}` : ''}</p>

        <input id="asstSearch" type="text" placeholder="Search assistants..." value="${this._escAttr(this._searchQuery)}"
          class="w-full bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300 placeholder-neutral-400 dark:placeholder-neutral-500 focus:bg-white/90 dark:focus:bg-neutral-800/90 focus:outline-none transition-all shadow-sm" />

        <div id="asstGrid" class="space-y-2">
          ${assistants.length === 0 ? `
            <div class="text-center py-12 text-neutral-400">
              <div class="p-3 bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-100 dark:border-neutral-800 shadow-sm text-neutral-400 inline-flex mb-2"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></div>
              <p class="text-sm">${q ? 'No assistants match your search.' : 'No assistants yet. Create one to get started.'}</p>
            </div>
          ` : assistants.map(a => `
            <div class="asst-item bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-5 shadow-[0_2px_10px_rgb(0,0,0,0.02)] dark:shadow-[0_2px_10px_rgb(0,0,0,0.2)] backdrop-blur-md hover:shadow-md cursor-pointer transition-all" data-id="${a.id}">
              <div class="flex items-center justify-between">
                <div class="min-w-0 flex-1">
                  <h3 class="text-sm font-medium text-neutral-900 dark:text-neutral-100">${this._esc(a.title)}</h3>
                  ${a.description ? `<p class="text-xs text-neutral-500 mt-0.5 truncate">${this._esc(a.description)}</p>` : ''}
                  <div class="flex gap-3 text-xs text-neutral-400 mt-1">
                    ${a.collection_name ? `<span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="inline-block" style="vertical-align:-1px"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg> ${this._esc(a.collection_name)}</span>` : '<span class="text-neutral-300 dark:text-neutral-600">No KB</span>'}
                    <span>${a.conversation_count || 0} chat${a.conversation_count !== 1 ? 's' : ''}</span>
                  </div>
                </div>
                <div class="flex items-center gap-5 ml-4 shrink-0">
                  <button class="asst-del text-neutral-300 hover:text-rose-600" data-id="${a.id}" title="Delete">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  </button>
                </div>
              </div>
            </div>
          `).join('')}
        </div>

        <div class="flex items-center justify-center gap-2 pt-2">
          <button id="asstPrevBtn" class="px-3 py-1.5 rounded-lg text-xs font-medium ${this._page === 0 ? 'text-neutral-300 dark:text-neutral-600 cursor-default' : 'text-neutral-600 dark:text-neutral-400 hover:bg-white/60 dark:hover:bg-neutral-800/60'}">← Prev</button>
          <span class="text-xs text-neutral-400">Page ${this._page + 1} of ${totalPages}</span>
          <button id="asstNextBtn" class="px-3 py-1.5 rounded-lg text-xs font-medium ${this._page >= totalPages - 1 ? 'text-neutral-300 dark:text-neutral-600 cursor-default' : 'text-neutral-600 dark:text-neutral-400 hover:bg-white/60 dark:hover:bg-neutral-800/60'}">Next →</button>
        </div>
      </div>
    `;

    // Search handler
    document.querySelector('#asstSearch')?.addEventListener('input', (e) => {
      this._searchQuery = e.target.value;
      this._page = 0;
      this._showList();
    });

    document.querySelector('#asstPrevBtn')?.addEventListener('click', () => {
      if (this._page > 0) { this._page--; this._showList(); }
    });
    document.querySelector('#asstNextBtn')?.addEventListener('click', () => {
      if (this._page < totalPages - 1) { this._page++; this._showList(); }
    });

    document.querySelector('#asstNewBtn')?.addEventListener('click', () => this._showEdit(null));

    document.querySelectorAll('.asst-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.asst-del')) return;
        this._showEdit(item.dataset.id);
      });
    });

    document.querySelectorAll('.asst-del').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm('Delete this assistant and all its conversations?')) {
          await window.api.assistants.delete(btn.dataset.id);
          this._showList();
        }
      });
    });
  },

  // ── Edit / Create Assistant ─────────────────────────────────
  async _showEdit(assistantId) {
    this.currentView = 'edit';
    const el = document.querySelector('#asstContent');
    const assistant = assistantId ? await window.api.assistants.get(assistantId) : null;
    const isNew = !assistant;

    el.innerHTML = `
      <div class="p-6 space-y-4">
        <div class="flex items-center gap-2">
          <button id="asstEditBack" class="text-neutral-400 hover:text-neutral-600 text-sm">← Back</button>
          <span class="text-neutral-300">|</span>
          <h2 class="text-lg font-semibold text-neutral-900 dark:text-neutral-100">${isNew ? 'New Assistant' : 'Edit Assistant'}</h2>
        </div>

        <div class="space-y-3">
          <div>
            <label class="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-1.5 block">Title</label>
            <input id="asstTitle" type="text" value="${this._escAttr(assistant?.title || '')}" placeholder="e.g. Legal Research Assistant"
              class="w-full bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2.5 text-sm text-neutral-700 dark:text-neutral-300 placeholder-neutral-400 dark:placeholder-neutral-500 focus:bg-white/90 dark:focus:bg-neutral-800/90 focus:outline-none transition-all shadow-sm" />
          </div>
          <div>
            <label class="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-1.5 block">Description</label>
            <input id="asstDesc" type="text" value="${this._escAttr(assistant?.description || '')}" placeholder="What does this assistant do?"
              class="w-full bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2.5 text-sm text-neutral-700 dark:text-neutral-300 placeholder-neutral-400 dark:placeholder-neutral-500 focus:bg-white/90 dark:focus:bg-neutral-800/90 focus:outline-none transition-all shadow-sm" />
          </div>
          <div>
            <label class="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-1.5 block">System Prompt</label>
            <textarea id="asstPrompt" rows="6" placeholder="You are a helpful assistant that..."
              class="w-full resize-none bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2.5 text-sm text-neutral-700 dark:text-neutral-300 font-mono focus:bg-white/90 dark:focus:bg-neutral-800/90 focus:outline-none transition-all shadow-sm">${this._esc(assistant?.system_prompt || '')}</textarea>
          </div>
          <div>
            <label class="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-1.5 block">Knowledge Base (optional)</label>
            <div id="asstKBSelectorContainer"></div>
            <p class="text-[10px] text-neutral-400 mt-1">Select collections or specific files to give this assistant access to.</p>
          </div>
        </div>

        <div class="flex gap-2 pt-2">
          <button id="asstSaveBtn" class="px-6 py-2.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm">${isNew ? 'Create' : 'Save'}</button>
          <button id="asstCancelBtn" class="text-sm text-neutral-500 dark:text-neutral-400 px-4 py-2 hover:text-neutral-700 dark:hover:text-neutral-300">Cancel</button>
        </div>
      </div>
    `;

    // Initialize KB multi-select for assistant
    const asstKBContainer = document.querySelector('#asstKBSelectorContainer');
    let asstKBSelections = [];
    // Restore existing selections: support new kb_selections JSON or legacy collection_id
    if (assistant?.kb_selections) {
      try { asstKBSelections = JSON.parse(assistant.kb_selections); } catch {}
    } else if (assistant?.collection_id) {
      asstKBSelections = [{ collectionId: assistant.collection_id }];
    }

    // Create a separate KBSelector instance for assistants
    const AsstKBSelector = Object.create(window.KBSelector);
    AsstKBSelector._isOpen = false;
    AsstKBSelector._collections = [];
    AsstKBSelector._expandedCollections = new Set();
    AsstKBSelector._selections = [];
    AsstKBSelector._onChange = null;
    AsstKBSelector._containerEl = null;

    AsstKBSelector.render(asstKBContainer, (selections) => {
      asstKBSelections = selections;
    });
    if (asstKBSelections.length > 0) {
      // Wait for collections to load then set selections
      setTimeout(() => AsstKBSelector.setSelections(asstKBSelections), 200);
    }

    document.querySelector('#asstEditBack')?.addEventListener('click', () => this._showList());
    document.querySelector('#asstCancelBtn')?.addEventListener('click', () => this._showList());

    document.querySelector('#asstSaveBtn')?.addEventListener('click', async () => {
      const title = document.querySelector('#asstTitle').value.trim();
      if (!title) return;
      const data = {
        title,
        description: document.querySelector('#asstDesc').value.trim(),
        systemPrompt: document.querySelector('#asstPrompt').value,
        collectionId: asstKBSelections.length > 0 ? asstKBSelections[0].collectionId : null,
        kbSelections: asstKBSelections.length > 0 ? JSON.stringify(asstKBSelections) : null,
        modelPreference: null,
      };
      if (isNew) {
        data.id = `asst_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        await window.api.assistants.create(data);
      } else {
        await window.api.assistants.update(assistantId, data);
      }
      this._showList();
    });
  },

  // ── Chat with Assistant ─────────────────────────────────────
  async _showChat(assistantId) {
    this.currentView = 'chat';
    const assistant = await window.api.assistants.get(assistantId);
    if (!assistant) return this._showList();
    this.currentAssistant = assistant;

    // Get or create conversation
    let convos = await window.api.assistants.getConversations(assistantId);
    if (!convos.length) {
      const convId = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      await window.api.assistants.createConversation({ id: convId, assistantId, title: 'Chat' });
      convos = await window.api.assistants.getConversations(assistantId);
    }
    this.currentConversation = convos[0];

    const messages = await window.api.assistants.getMessages(this.currentConversation.id);
    const el = document.querySelector('#asstContent');

    el.innerHTML = `
      <div class="flex flex-col flex-1 min-h-0 h-full">
        <div class="flex items-center gap-2 px-4 py-3 border-b border-neutral-200/40 dark:border-neutral-700/40 flex-shrink-0">
          <button id="asstChatBack" class="text-neutral-400 hover:text-neutral-600 text-sm">← Back</button>
          <span class="text-neutral-300">|</span>
          <div class="min-w-0 flex-1">
            <h3 class="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate">${this._esc(assistant.title)}</h3>
            <p class="text-xs text-neutral-400 truncate">${assistant.collection_name ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg> ' + this._esc(assistant.collection_name) : 'No KB'}</p>
          </div>
          <button id="asstNewConvBtn" class="px-4 py-2 rounded-lg bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:bg-white/90 dark:hover:bg-neutral-700/90 transition-all shadow-sm flex items-center gap-2"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12h8M12 8v8"/></svg> New Chat</button>
        </div>

        <div id="asstMessages" class="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          ${messages.length === 0 ? `
            <div class="text-center py-8 text-neutral-400">
              <div class="p-3 bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-100 dark:border-neutral-800 shadow-sm text-neutral-400 inline-flex mb-2"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></div>
              <p class="text-sm">${this._esc(assistant.description || 'Ask me anything')}</p>
            </div>
          ` : messages.map(m => this._renderMessage(m.role, m.content)).join('')}
        </div>

        <div class="px-4 py-3 border-t border-neutral-200/40 dark:border-neutral-700/40 flex-shrink-0">
          <div class="flex gap-2">
            <textarea id="asstInput" rows="3" placeholder="Type a message..."
              class="flex-1 bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2.5 text-sm text-neutral-700 dark:text-neutral-300 placeholder-neutral-400 dark:placeholder-neutral-500 focus:bg-white/90 dark:focus:bg-neutral-800/90 focus:outline-none transition-all shadow-sm resize-none"></textarea>
            <button id="asstSendBtn" class="px-4 py-2.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm disabled:opacity-40 self-end">Send</button>
          </div>
        </div>
      </div>
    `;

    // Scroll to bottom
    const msgContainer = document.querySelector('#asstMessages');
    msgContainer.scrollTop = msgContainer.scrollHeight;

    this._bindChatEvents(assistant);
  },

  _bindChatEvents(assistant) {
    const input = document.querySelector('#asstInput');
    const sendBtn = document.querySelector('#asstSendBtn');
    const msgContainer = document.querySelector('#asstMessages');

    document.querySelector('#asstChatBack')?.addEventListener('click', () => this._showList());

    document.querySelector('#asstNewConvBtn')?.addEventListener('click', async () => {
      const convId = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      await window.api.assistants.createConversation({ id: convId, assistantId: assistant.id, title: 'Chat' });
      this._showChat(assistant.id);
    });

    const sendMessage = async () => {
      const text = input.value.trim();
      if (!text || sendBtn.disabled) return;

      input.value = '';
      sendBtn.disabled = true;

      // Show user message
      msgContainer.innerHTML += this._renderMessage('user', text);

      // Create response container immediately
      const responseId = 'resp_' + Date.now();
      msgContainer.innerHTML += `<div id="${responseId}" class="message-enter bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl px-4 py-3 text-sm text-neutral-800 dark:text-neutral-200 backdrop-blur-md max-w-[80%] whitespace-pre-wrap"><span class="text-neutral-400">Thinking...</span></div>`;
      msgContainer.scrollTop = msgContainer.scrollHeight;

      // Track response text
      let fullText = '';
      let firstChunk = true;

      // Remove any previous listeners to avoid stacking
      window.api.assistants.removeStreamListeners?.();

      // Set up fresh listeners
      const onChunk = (data) => {
        const el = document.querySelector(`#${responseId}`);
        if (!el) return;
        if (firstChunk) {
          el.innerHTML = '';
          firstChunk = false;
        }
        fullText += data.content;
        el.textContent = fullText;
        msgContainer.scrollTop = msgContainer.scrollHeight;
      };

      const onDone = () => {
        sendBtn.disabled = false;
        input.focus();
        if (firstChunk) {
          const el = document.querySelector(`#${responseId}`);
          if (el) el.innerHTML = '<span class="text-neutral-400">No response received</span>';
        }
      };

      window.api.assistants.onStreamChunk(onChunk);
      window.api.assistants.onStreamDone(onDone);

      try {
        const result = await window.api.assistants.ragChat({
          assistantId: assistant.id,
          conversationId: this.currentConversation.id,
          userMessage: text,
        });
        if (!result.success) {
          const el = document.querySelector(`#${responseId}`);
          if (el) el.innerHTML = `<span class="text-rose-600">${result.error || 'Error'}</span>`;
          sendBtn.disabled = false;
        }
      } catch (err) {
        const el = document.querySelector(`#${responseId}`);
        if (el) el.innerHTML = `<span class="text-rose-600">${err.message}</span>`;
        sendBtn.disabled = false;
      }
    };

    sendBtn.addEventListener('click', sendMessage);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });

    input.focus();
  },

  _renderMessage(role, content) {
    if (role === 'user') {
      return `<div class="message-enter flex justify-end"><div class="bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 rounded-lg px-3 py-2 text-sm max-w-[80%]">${this._esc(content)}</div></div>`;
    }
    if (role === 'system') return '';
    return `<div class="message-enter bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl px-4 py-3 text-sm text-neutral-800 dark:text-neutral-200 backdrop-blur-md max-w-[80%] whitespace-pre-wrap">${this._esc(content)}</div>`;
  },

  _esc(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  },

  _escAttr(str) {
    return (str || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  },

  destroy() {}
};

window.AssistantsPage = AssistantsPage;
