// Chat page — renders into #mainContent when active
// Persists conversations and messages to local SQLite

const ChatPage = {
  conversations: [],
  activeConversationId: null,
  activeCollectionId: null, // Legacy single ID (kept for backward compat)
  activeKBSelections: [], // New: [{ collectionId, documentId? }]
  chatHistory: [],
  isStreaming: false,
  activeAssistantEl: null,
  activeAssistantContent: '',
  activeTypingEl: null,
  _listenersRegistered: false,
  _collections: [],

  async render(container) {
    container.innerHTML = `
      <div id="chatPage" class="flex flex-1 min-h-0">
        <!-- Conversation list -->
        <div id="convSidebar" class="w-48 border-r border-neutral-200/40 dark:border-neutral-700/40 flex flex-col flex-shrink-0 bg-white/50 dark:bg-neutral-800/20">
          <div class="p-2 border-b border-neutral-200/40 dark:border-neutral-700/40">
            <button id="newConvBtn" class="w-full px-3 py-1.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-xs font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm flex items-center justify-center gap-1.5">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12h8M12 8v8"/></svg>
              New chat
            </button>
          </div>
          <div id="convList" class="flex-1 overflow-y-auto p-1 space-y-0.5"></div>
        </div>

        <!-- Chat area -->
        <div class="flex flex-col flex-1 min-h-0 min-w-0 bg-white/60 dark:bg-transparent" style="--dark-bg: rgba(255,255,255,0.25);">
          <div id="messages" class="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
            <div id="welcomeMessage" class="text-center py-8">
              <div class="p-3 bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-100 dark:border-neutral-800 shadow-sm text-neutral-400 inline-flex mb-3"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8.5V3a1 1 0 0 0-1-1h-4l-4 4-4-4H1a1 1 0 0 0-1 1v5.5"/><path d="m2 14 4-4 3 3 4-4 3 3 4-4"/><path d="M2 14v5a1 1 0 0 0 1 1h4"/><path d="M22 14v5a1 1 0 0 1-1 1h-4"/></svg></div>
              <p class="text-neutral-900 dark:text-neutral-100 font-semibold mb-1 tracking-tight">Welcome back</p>
              <p id="chatUserName" class="text-neutral-400 text-sm mb-4"></p>
              <div id="noProviderMsg" class="hidden bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-4 text-sm text-neutral-600 dark:text-neutral-400 max-w-xs mx-auto backdrop-blur-md">
                <p class="font-medium mb-1">No AI model configured</p>
                <p class="text-xs">Go to <button id="goToSettings" class="underline text-neutral-900 dark:text-neutral-100 font-medium">Settings</button> to set up a local model.</p>
              </div>
            </div>
          </div>
          <div class="border-t border-neutral-200/40 dark:border-neutral-700/40 p-3 flex-shrink-0 bg-white/30 dark:bg-neutral-800/30">
            <div id="kbSelectorRow" class="flex items-center gap-2 mb-2">
              <div id="kbSelectorContainer" class="flex-1"></div>
              <span id="kbBadge" class="hidden text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-800 whitespace-nowrap">KB active</span>
            </div>
            <div class="flex gap-2">
              <textarea id="chatInput" placeholder="Message your local AI..." rows="3"
                class="flex-1 resize-none bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2.5 text-sm text-neutral-700 dark:text-neutral-300 placeholder-neutral-400 dark:placeholder-neutral-500 focus:bg-white/90 dark:focus:bg-neutral-800/90 focus:outline-none transition-all shadow-sm"></textarea>
              <div class="flex flex-col gap-1 self-end">
                <button id="sendBtn" class="px-4 py-2.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm disabled:opacity-40 disabled:cursor-not-allowed" disabled>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
                </button>
                <button id="stopBtn" class="hidden px-4 py-2.5 rounded-lg bg-neutral-200 dark:bg-neutral-700 text-sm font-medium text-rose-600 dark:text-rose-400 hover:bg-neutral-300 dark:hover:bg-neutral-600 transition-all shadow-sm">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
                </button>
              </div>
            </div>
            <div class="flex items-center justify-between mt-1.5 px-1">
              <span class="text-[10px] text-neutral-400">Running locally · Your data stays on this computer</span>
            </div>
          </div>
        </div>
      </div>
    `;

    await this._bind(container);
  },

  async _bind(container) {
    const chatInput = container.querySelector('#chatInput');
    const sendBtn = container.querySelector('#sendBtn');
    const messages = container.querySelector('#messages');
    const welcomeMessage = container.querySelector('#welcomeMessage');
    const noProviderMsg = container.querySelector('#noProviderMsg');
    const goToSettings = container.querySelector('#goToSettings');
    const chatUserName = container.querySelector('#chatUserName');
    const convList = container.querySelector('#convList');
    const kbSelectorContainer = container.querySelector('#kbSelectorContainer');
    const kbBadge = container.querySelector('#kbBadge');
    const newConvBtn = container.querySelector('#newConvBtn');
    const stopBtn = container.querySelector('#stopBtn');

    if (window.AppState?.currentUser) {
      chatUserName.textContent = window.AppState.currentUser.email || '';
    }

    const pm = window.ProviderManager;
    if (!pm.activeProvider) {
      noProviderMsg.classList.remove('hidden');
      sendBtn.disabled = true;
    } else {
      noProviderMsg.classList.add('hidden');
      sendBtn.disabled = !chatInput.value.trim();
    }

    goToSettings?.addEventListener('click', () => window.AppRouter?.navigate('settings'));

    // Initialize KB multi-select component
    window.KBSelector.render(kbSelectorContainer, async (selections) => {
      this.activeKBSelections = selections;
      // Backward compat: set activeCollectionId to first collection if any
      this.activeCollectionId = selections.length > 0 ? selections[0].collectionId : null;
      kbBadge.classList.toggle('hidden', selections.length === 0);
      // Persist KB selections on the active conversation
      if (this.activeConversationId) {
        await window.api.storage.updateConversationKBSelections(this.activeConversationId, selections);
      }
      // Update placeholder text
      chatInput.placeholder = selections.length > 0
        ? 'Ask about your knowledge base...'
        : 'Message your local AI...';
    });

    // Restore selections if conversation has them
    if (this.activeKBSelections.length > 0) {
      window.KBSelector.setSelections(this.activeKBSelections);
      kbBadge.classList.toggle('hidden', this.activeKBSelections.length === 0);
    }

    // Load conversations
    await this._loadConversations(convList, messages, welcomeMessage);

    // New conversation
    newConvBtn.addEventListener('click', async () => {
      await this._startNewConversation(convList, messages, welcomeMessage);
      chatInput.focus();
    });

    // Input handling
    chatInput.addEventListener('input', () => {
      chatInput.style.height = 'auto';
      chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
      sendBtn.disabled = !chatInput.value.trim() || this.isStreaming || !pm.activeProvider;
    });

    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!sendBtn.disabled) this._send(chatInput, sendBtn, messages, welcomeMessage, convList);
      }
    });

    sendBtn.addEventListener('click', () => {
      this._send(chatInput, sendBtn, messages, welcomeMessage, convList);
    });

    stopBtn.addEventListener('click', async () => {
      await this._stopStream(stopBtn, sendBtn, chatInput);
    });

    // Register stream listeners once
    if (!this._listenersRegistered) {
      // Chat stream stopped event
      window.api.chat.onStreamStopped(() => {
        if (stopBtn) stopBtn.classList.add('hidden');
        if (sendBtn) sendBtn.classList.remove('hidden');
        this.isStreaming = false;
      });
      this._listenersRegistered = true;

      // Ollama stream
      window.api.ollama.onStreamChunk((chunk) => {
        if (this.activeTypingEl?.parentNode) this.activeTypingEl.remove();
        if (chunk.message?.content && this.activeAssistantEl) {
          this.activeAssistantContent += chunk.message.content;
          this.activeAssistantEl.querySelector('.msg-content').textContent = this.activeAssistantContent;
          const msgs = document.querySelector('#messages');
          if (msgs) msgs.scrollTop = msgs.scrollHeight;
        }
      });

      window.api.ollama.onStreamDone(async () => {
        this._onStreamComplete();
      });

      // Vertex stream
      window.api.vertex.onStreamChunk((chunk) => {
        if (this.activeTypingEl?.parentNode) this.activeTypingEl.remove();
        if (chunk.content && this.activeAssistantEl) {
          this.activeAssistantContent += chunk.content;
          this.activeAssistantEl.querySelector('.msg-content').textContent = this.activeAssistantContent;
          const msgs = document.querySelector('#messages');
          if (msgs) msgs.scrollTop = msgs.scrollHeight;
        }
      });

      window.api.vertex.onStreamDone(async () => {
        this._onStreamComplete();
      });

      // Gateway stream (same SSE format as Vertex)
      window.api.gateway.onStreamChunk((chunk) => {
        if (this.activeTypingEl?.parentNode) this.activeTypingEl.remove();
        if (chunk.content && this.activeAssistantEl) {
          this.activeAssistantContent += chunk.content;
          this.activeAssistantEl.querySelector('.msg-content').textContent = this.activeAssistantContent;
          const msgs = document.querySelector('#messages');
          if (msgs) msgs.scrollTop = msgs.scrollHeight;
        }
      });

      window.api.gateway.onStreamDone(async () => {
        this._onStreamComplete();
      });

      // Chat RAG stream (KB-augmented chat)
      window.api.chatRag.onChunk((chunk) => {
        if (this.activeTypingEl?.parentNode) this.activeTypingEl.remove();
        if (chunk.content && this.activeAssistantEl) {
          this.activeAssistantContent += chunk.content;
          this.activeAssistantEl.querySelector('.msg-content').textContent = this.activeAssistantContent;
          const msgs = document.querySelector('#messages');
          if (msgs) msgs.scrollTop = msgs.scrollHeight;
        }
      });

      window.api.chatRag.onDone(async () => {
        this._onStreamComplete();
      });
    }

    chatInput.focus();
  },

  async _loadConversations(convList, messagesEl, welcomeMessage) {
    this.conversations = await window.api.storage.getConversations(50);
    this._renderConvList(convList, messagesEl, welcomeMessage);

    // Load most recent conversation if exists
    if (this.conversations.length > 0 && !this.activeConversationId) {
      await this._selectConversation(this.conversations[0].id, messagesEl, welcomeMessage);
      this._highlightConv(convList);
    }
  },

  _renderConvList(convList, messagesEl, welcomeMessage) {
    convList.innerHTML = '';
    for (const conv of this.conversations) {
      const wrapper = document.createElement('div');
      wrapper.className = 'conv-item group relative flex items-center rounded-lg transition-all';
      wrapper.dataset.convId = conv.id;
      if (conv.id === this.activeConversationId) {
        wrapper.classList.add('conv-item-active');
      }

      const btn = document.createElement('button');
      btn.className = `flex-1 text-left px-2 py-1.5 text-xs truncate ${
        conv.id === this.activeConversationId ? 'font-medium text-neutral-900 dark:text-neutral-100' : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300'
      }`;
      const kbIcon = conv.collection_id ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="inline-block mr-0.5 text-emerald-500 shrink-0" style="vertical-align: -1px;"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>' : '';
      btn.innerHTML = `${kbIcon}${this._escHtml(conv.title || 'New conversation')}`;
      btn.addEventListener('click', async () => {
        await this._selectConversation(conv.id, messagesEl, welcomeMessage);
        this._highlightConv(convList);
      });

      const delBtn = document.createElement('button');
      delBtn.className = 'hidden group-hover:flex items-center justify-center w-5 h-5 rounded text-neutral-300 hover:text-rose-500 dark:text-neutral-600 dark:hover:text-rose-400 transition-colors shrink-0';
      delBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
      delBtn.title = 'Delete conversation';

      // Rename button
      const renameBtn = document.createElement('button');
      renameBtn.className = 'hidden group-hover:flex items-center justify-center w-5 h-5 rounded text-neutral-300 hover:text-neutral-600 dark:text-neutral-600 dark:hover:text-neutral-300 transition-colors shrink-0';
      renameBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>';
      renameBtn.title = 'Rename';
      renameBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        // Replace the button text with an inline input
        const currentTitle = conv.title || 'New conversation';
        const input = document.createElement('input');
        input.type = 'text';
        input.value = currentTitle;
        input.className = 'flex-1 px-1.5 py-0.5 text-xs bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-600 rounded text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-1 focus:ring-neutral-400';
        btn.replaceWith(input);
        input.focus();
        input.select();

        const save = async () => {
          const newTitle = input.value.trim() || currentTitle;
          await window.api.storage.updateConversationTitle(conv.id, newTitle);
          this.conversations = await window.api.storage.getConversations(50);
          this._renderConvList(convList, messagesEl, welcomeMessage);
          this._highlightConv(convList);
        };
        input.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') { ev.preventDefault(); save(); }
          if (ev.key === 'Escape') { this._renderConvList(convList, messagesEl, welcomeMessage); this._highlightConv(convList); }
        });
        input.addEventListener('blur', save);
      });

      // Download button
      const downloadBtn = document.createElement('button');
      downloadBtn.className = 'hidden group-hover:flex items-center justify-center w-5 h-5 rounded text-neutral-300 hover:text-neutral-600 dark:text-neutral-600 dark:hover:text-neutral-300 transition-colors shrink-0';
      downloadBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
      downloadBtn.title = 'Download chat';
      downloadBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const msgs = await window.api.storage.getMessages(conv.id, 500);
        const title = conv.title || 'conversation';
        let text = `# ${title}\n\n`;
        for (const m of msgs) {
          const role = m.role === 'user' ? 'You' : 'AI';
          text += `**${role}:**\n${m.content}\n\n`;
        }
        const blob = new Blob([text], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.md`;
        a.click();
        URL.revokeObjectURL(url);
      });
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await window.api.storage.deleteConversation(conv.id);
        // If we deleted the active conversation, clear it
        if (this.activeConversationId === conv.id) {
          this.activeConversationId = null;
          this.chatHistory = [];
          messagesEl.innerHTML = '';
          messagesEl.appendChild(welcomeMessage);
          welcomeMessage.classList.remove('hidden');
        }
        // Refresh list
        this.conversations = await window.api.storage.getConversations(50);
        this._renderConvList(convList, messagesEl, welcomeMessage);
        // Select first remaining conversation if we deleted the active one
        if (!this.activeConversationId && this.conversations.length > 0) {
          await this._selectConversation(this.conversations[0].id, messagesEl, welcomeMessage);
        }
        this._highlightConv(convList);
      });

      wrapper.appendChild(btn);
      wrapper.appendChild(renameBtn);
      wrapper.appendChild(downloadBtn);
      wrapper.appendChild(delBtn);
      convList.appendChild(wrapper);
    }
  },

  _escHtml(str) {
    const div = document.createElement('span');
    div.textContent = str;
    return div.innerHTML;
  },

  _highlightConv(convList) {
    convList.querySelectorAll('.conv-item').forEach(el => {
      const isActive = el.dataset.convId === this.activeConversationId;
      const textBtn = el.querySelector('button');
      if (textBtn) {
        textBtn.className = `flex-1 text-left px-2 py-1.5 text-xs truncate ${
          isActive ? 'font-medium text-neutral-900 dark:text-neutral-100' : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300'
        }`;
      }
      if (isActive) {
        el.classList.add('conv-item-active');
      } else {
        el.classList.remove('conv-item-active');
      }
    });
  },

  async _selectConversation(id, messagesEl, welcomeMessage) {
    this.activeConversationId = id;
    const dbMessages = await window.api.storage.getMessages(id, 200);
    this.chatHistory = dbMessages.map(m => ({ role: m.role, content: m.content }));

    // Restore KB collection selection for this conversation
    const conv = await window.api.storage.getConversation(id);
    // Support new multi-select format (kb_selections JSON) with fallback to legacy collection_id
    if (conv?.kb_selections) {
      try {
        this.activeKBSelections = JSON.parse(conv.kb_selections);
      } catch { this.activeKBSelections = []; }
    } else if (conv?.collection_id) {
      this.activeKBSelections = [{ collectionId: conv.collection_id }];
    } else {
      this.activeKBSelections = [];
    }
    this.activeCollectionId = this.activeKBSelections.length > 0 ? this.activeKBSelections[0].collectionId : null;
    const kbBadge = document.querySelector('#kbBadge');
    if (window.KBSelector) {
      window.KBSelector.setSelections(this.activeKBSelections);
    }
    if (kbBadge) kbBadge.classList.toggle('hidden', this.activeKBSelections.length === 0);
    const chatInput = document.querySelector('#chatInput');
    if (chatInput) {
      chatInput.placeholder = this.activeKBSelections.length > 0
        ? 'Ask about your knowledge base...'
        : 'Message your local AI...';
    }

    // Clear and re-render messages
    messagesEl.innerHTML = '';
    if (this.chatHistory.length === 0) {
      messagesEl.appendChild(welcomeMessage);
      welcomeMessage.classList.remove('hidden');
    } else {
      welcomeMessage.classList.add('hidden');
      for (const msg of this.chatHistory) {
        this._appendMessage(messagesEl, msg.role, msg.content);
      }
    }
  },

  async _startNewConversation(convList, messagesEl, welcomeMessage) {
    const id = crypto.randomUUID();
    await window.api.storage.createConversation({
      id,
      title: 'New conversation',
      model: window.ProviderManager.activeProvider?.name || null,
      providerType: window.ProviderManager.activeProvider?.type || 'local',
      collectionId: this.activeCollectionId || null,
      kbSelections: this.activeKBSelections.length > 0 ? JSON.stringify(this.activeKBSelections) : null,
    });
    this.activeConversationId = id;
    this.chatHistory = [];

    // Refresh list
    this.conversations = await window.api.storage.getConversations(50);
    this._renderConvList(convList, messagesEl, welcomeMessage);
    this._highlightConv(convList);

    // Clear messages area
    messagesEl.innerHTML = '';
    messagesEl.appendChild(welcomeMessage);
    welcomeMessage.classList.remove('hidden');
  },

  async _send(chatInput, sendBtn, messages, welcomeMessage, convList) {
    const text = chatInput.value.trim();
    if (!text || this.isStreaming) return;

    const pm = window.ProviderManager;
    if (!pm.activeProvider) return;

    // Auto-create conversation if none active
    if (!this.activeConversationId) {
      await this._startNewConversation(convList, messages, welcomeMessage);
    }

    welcomeMessage.classList.add('hidden');

    // Parse @mentions from message
    const mentionRegex = /@(\w[\w-]*)/g;
    const mentionMatches = [...text.matchAll(mentionRegex)];
    let activeMentions = [];

    if (mentionMatches.length > 0) {
      const availableMentions = await window.api.plugins.getMentions();
      activeMentions = mentionMatches
        .map(m => availableMentions.find(am => am.name === m[1]))
        .filter(Boolean);
    }
    this._activeMentions = activeMentions;

    // Check for @agent — hand off to agent runner
    if (text.match(/@agent\b/i)) {
      console.log('[Chat] @agent detected, handing off to AgentRunner');
      this.chatHistory.push({ role: 'user', content: text });
      this._appendMessage(messages, 'user', text);
      await window.api.storage.addMessage({
        conversationId: this.activeConversationId,
        role: 'user',
        content: text,
        model: pm.activeProvider.name,
        providerType: pm.activeProvider.type,
      });
      chatInput.value = '';
      chatInput.style.height = 'auto';

      // Strip @agent from the message for the planner
      const cleanMessage = text.replace(/@agent\b/g, '').replace(/@\w[\w-]*/g, '').trim();
      const result = await window.AgentRunner.run(cleanMessage, messages, this);

      if (result?.error && result.message) {
        // Model not capable — show helpful message
        this._appendMessage(messages, 'assistant', result.message);
        this.chatHistory.push({ role: 'assistant', content: result.message });
        await window.api.storage.addMessage({
          conversationId: this.activeConversationId,
          role: 'assistant',
          content: result.message,
          model: pm.activeProvider?.name || null,
          providerType: pm.activeProvider?.type || 'local',
        });
        return;
      } else if (result?.error && result.fallbackToChat) {
        // Plan failed — fall back to normal chat without @agent
        // Continue to normal flow below (don't return)
      } else if (result?.summary) {
        // Agent completed — show summary
        this._appendMessage(messages, 'assistant', result.summary);
        this.chatHistory.push({ role: 'assistant', content: result.summary });
        await window.api.storage.addMessage({
          conversationId: this.activeConversationId,
          role: 'assistant',
          content: result.summary,
          model: pm.activeProvider?.name || null,
          providerType: pm.activeProvider?.type || 'local',
        });
        return;
      } else {
        return;
      }
    }

    // Check for slash commands
    if (text.startsWith('/')) {
      const commands = await window.api.plugins.getCommands();
      const parts = text.split(' ');
      const cmdName = parts[0];
      const cmdArgs = parts.slice(1).join(' ');
      const cmd = commands.find(c => c.command === cmdName);
      if (cmd) {
        this.chatHistory.push({ role: 'user', content: text });
        this._appendMessage(messages, 'user', text);
        await window.api.storage.addMessage({
          conversationId: this.activeConversationId,
          role: 'user',
          content: text,
          model: pm.activeProvider.name,
          providerType: pm.activeProvider.type,
        });

        const result = await window.api.plugins.chatPreprocess({
          messages: this.chatHistory,
          assistant: null,
          command: { name: cmdName, args: cmdArgs, pluginId: cmd.pluginId },
        });

        if (result.directResponse) {
          this._appendMessage(messages, 'assistant', result.directResponse);
          this.chatHistory.push({ role: 'assistant', content: result.directResponse });
          await window.api.storage.addMessage({
            conversationId: this.activeConversationId,
            role: 'assistant',
            content: result.directResponse,
            model: pm.activeProvider?.name || null,
            providerType: pm.activeProvider?.type || 'local',
          });
          chatInput.value = '';
          chatInput.style.height = 'auto';
          return;
        }
        // Otherwise continue with modified messages below
        chatInput.value = '';
        chatInput.style.height = 'auto';
        sendBtn.disabled = true;
        this.isStreaming = true;
        const stopBtn = document.querySelector('#stopBtn');
        if (stopBtn) {
          stopBtn.classList.remove('hidden');
          sendBtn.classList.add('hidden');
        }
        this.activeTypingEl = this._appendTyping(messages);
        this.activeAssistantContent = '';
        this.activeAssistantEl = this._createAssistantBubble(messages);

        const chatResult = await pm.activeProvider.chat(result.messages || this.chatHistory);
        if (!chatResult.success) {
          if (this.activeTypingEl?.parentNode) this.activeTypingEl.remove();
          if (chatResult.error && chatResult.error.includes('aborted')) {
            this.activeAssistantEl.querySelector('.msg-content').textContent = 'Response stopped.';
            this.activeAssistantEl.querySelector('.msg-content').classList.add('text-neutral-400');
          } else {
            this.activeAssistantEl.querySelector('.msg-content').textContent =
              `Error: ${chatResult.error}. Make sure the AI engine is running.`;
            this.activeAssistantEl.querySelector('.msg-content').classList.add('text-red-500');
          }
          this.isStreaming = false;
          sendBtn.disabled = false;
          this.activeAssistantEl = null;
          this.activeAssistantContent = '';
          this.activeTypingEl = null;
        }
        return;
      }
    }

    this.chatHistory.push({ role: 'user', content: text });
    this._appendMessage(messages, 'user', text);

    // Persist user message
    await window.api.storage.addMessage({
      conversationId: this.activeConversationId,
      role: 'user',
      content: text,
      model: pm.activeProvider.name,
      providerType: pm.activeProvider.type,
    });

    // Auto-title from first message
    const conv = this.conversations.find(c => c.id === this.activeConversationId);
    if (conv && conv.title === 'New conversation' && this.chatHistory.length === 1) {
      const title = text.substring(0, 40) + (text.length > 40 ? '...' : '');
      await window.api.storage.updateConversationTitle(this.activeConversationId, title);
      this.conversations = await window.api.storage.getConversations(50);
      this._renderConvList(convList, messages, welcomeMessage);
      this._highlightConv(convList);
    }

    chatInput.value = '';
    chatInput.style.height = 'auto';
    sendBtn.disabled = true;
    this.isStreaming = true;
    const stopBtn = document.querySelector('#stopBtn');
    if (stopBtn) {
      stopBtn.classList.remove('hidden');
      sendBtn.classList.add('hidden');
    }

    this.activeTypingEl = this._appendTyping(messages);
    this.activeAssistantContent = '';
    this.activeAssistantEl = this._createAssistantBubble(messages);

    // If KB selections are active, use RAG chat
    if (this.activeKBSelections.length > 0) {
      const result = await window.api.chatRag.send({
        conversationId: this.activeConversationId,
        userMessage: text,
        collectionId: this.activeCollectionId, // Legacy: first collection
        kbSelections: this.activeKBSelections,  // New: full selections array
        chatHistory: this.chatHistory,
      });

      if (!result.success) {
        if (this.activeTypingEl?.parentNode) this.activeTypingEl.remove();
        this.activeAssistantEl.querySelector('.msg-content').textContent =
          `Error: ${result.error}`;
        this.activeAssistantEl.querySelector('.msg-content').classList.add('text-red-500');
        this.isStreaming = false;
        sendBtn.disabled = false;
        this.activeAssistantEl = null;
        this.activeAssistantContent = '';
        this.activeTypingEl = null;
      }
      return;
    }

    // Run plugin preprocess hooks
    const preprocessed = await window.api.plugins.chatPreprocess({
      messages: this.chatHistory,
      assistant: null,
      mentions: activeMentions,
    });
    const messagesToSend = preprocessed.messages || this.chatHistory;

    // Standard chat (no KB) — use preprocessed messages
    const result = await pm.activeProvider.chat(messagesToSend);

    if (!result.success) {
      if (this.activeTypingEl?.parentNode) this.activeTypingEl.remove();
      if (result.error && result.error.includes('aborted')) {
        this.activeAssistantEl.querySelector('.msg-content').textContent = 'Response stopped.';
        this.activeAssistantEl.querySelector('.msg-content').classList.add('text-neutral-400');
      } else {
        this.activeAssistantEl.querySelector('.msg-content').textContent =
          `Error: ${result.error}. Make sure the AI engine is running.`;
        this.activeAssistantEl.querySelector('.msg-content').classList.add('text-red-500');
      }
      this.isStreaming = false;
      sendBtn.disabled = false;
      this.activeAssistantEl = null;
      this.activeAssistantContent = '';
      this.activeTypingEl = null;
    }
  },

  _appendMessage(container, role, content) {
    const div = document.createElement('div');
    div.className = `message-enter flex ${role === 'user' ? 'justify-end' : 'justify-start'}`;
    const bubble = document.createElement('div');
    bubble.className = role === 'user'
      ? 'bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 rounded-2xl rounded-br-sm px-4 py-2.5 max-w-[85%] text-sm'
      : 'text-neutral-800 dark:text-neutral-200 rounded-2xl rounded-bl-sm px-4 py-2.5 max-w-[85%] text-sm whitespace-pre-wrap';
    if (role === 'assistant') {
      bubble.classList.add('assistant-bubble');
    }
    bubble.textContent = content;
    div.appendChild(bubble);
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  },

  _createAssistantBubble(container) {
    const div = document.createElement('div');
    div.className = 'message-enter flex justify-start';
    const bubble = document.createElement('div');
    bubble.className = 'assistant-bubble text-neutral-800 dark:text-neutral-200 rounded-2xl rounded-bl-sm px-4 py-2.5 max-w-[85%] text-sm whitespace-pre-wrap';
    const content = document.createElement('span');
    content.className = 'msg-content';
    bubble.appendChild(content);
    div.appendChild(bubble);
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return div;
  },

  _appendTyping(container) {
    const div = document.createElement('div');
    div.className = 'message-enter flex justify-start';
    div.innerHTML = `
      <div class="assistant-bubble rounded-2xl rounded-bl-sm px-4 py-3 flex gap-1">
        <div class="typing-dot w-2 h-2 bg-neutral-400 rounded-full"></div>
        <div class="typing-dot w-2 h-2 bg-neutral-400 rounded-full"></div>
        <div class="typing-dot w-2 h-2 bg-neutral-400 rounded-full"></div>
      </div>
    `;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return div;
  },

  async _loadKBCollections() {
    // Refresh the KB selector component
    if (window.KBSelector) {
      await window.KBSelector.refresh();
    }
  },

  async _onStreamComplete() {
    if (this.activeTypingEl?.parentNode) this.activeTypingEl.remove();
    if (this.activeAssistantContent && this.activeConversationId) {
      // Run plugin postprocess hooks
      const postprocessed = await window.api.plugins.chatPostprocess({
        response: this.activeAssistantContent,
        assistant: null,
        mentions: this._activeMentions || [],
      });
      if (postprocessed.response) {
        this.activeAssistantContent = postprocessed.response;
        // Update displayed message if plugins modified it
        if (this.activeAssistantEl) {
          const contentEl = this.activeAssistantEl.querySelector('.msg-content');
          if (contentEl) contentEl.textContent = this.activeAssistantContent;
        }
      }

      this.chatHistory.push({ role: 'assistant', content: this.activeAssistantContent });
      const pm = window.ProviderManager;
      await window.api.storage.addMessage({
        conversationId: this.activeConversationId,
        role: 'assistant',
        content: this.activeAssistantContent,
        model: pm.activeProvider?.name || null,
        providerType: pm.activeProvider?.type || 'local',
      });
    }
    this.isStreaming = false;
    const sendBtn = document.querySelector('#sendBtn');
    const stopBtn = document.querySelector('#stopBtn');
    const chatInput = document.querySelector('#chatInput');
    if (sendBtn && chatInput) sendBtn.disabled = !chatInput.value.trim();
    if (stopBtn) stopBtn.classList.add('hidden');
    if (sendBtn) sendBtn.classList.remove('hidden');
    this.activeAssistantEl = null;
    this.activeAssistantContent = '';
    this.activeTypingEl = null;
  },
  async _stopStream(stopBtn, sendBtn, chatInput) {
    try {
      await window.api.chat.stop();
      // Hide stop button, show send button
      stopBtn.classList.add('hidden');
      sendBtn.classList.remove('hidden');
      // Re-enable input
      sendBtn.disabled = !chatInput.value.trim();
      this.isStreaming = false;
      // Remove typing indicator if present
      if (this.activeTypingEl?.parentNode) this.activeTypingEl.remove();
      this.activeTypingEl = null;
    } catch (err) {
      console.error('[Chat] Stop stream error:', err);
    }
  }
};

window.ChatPage = ChatPage;
