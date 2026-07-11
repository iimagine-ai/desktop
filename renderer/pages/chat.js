// Chat page — renders into #mainContent when active
// Persists conversations and messages to local SQLite

const ChatPage = {
  conversations: [],
  activeConversationId: null,
  activeCollectionId: null, // Legacy single ID (kept for backward compat)
  activeKBSelections: [], // New: [{ collectionId, documentId? }]
  chatHistory: [],
  isStreaming: false,
  fullContext: false, // Full Context mode: skip RAG, send all doc content
  activeAssistantEl: null,
  activeAssistantContent: '',
  activeTypingEl: null,
  pendingAttachments: [], // Attached files: [{ type, filename, base64, mimeType, text }]
  _listenersRegistered: false,
  _collections: [],
  _ttsPlaying: false,

  async render(container) {
    container.innerHTML = `
      <div id="chatPage" class="flex flex-1 min-h-0">
        <!-- Chat area -->
        <div class="flex flex-col flex-1 min-h-0 min-w-0 bg-white/60 dark:bg-transparent" style="--dark-bg: rgba(255,255,255,0.25);">
          <div id="messages" class="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
            <div id="welcomeMessage" class="text-center py-8">
              <p id="chatUserName" class="text-neutral-900 dark:text-neutral-100 font-semibold text-lg tracking-tight"></p>
              <div id="noProviderMsg" class="hidden bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-4 text-sm text-neutral-600 dark:text-neutral-400 max-w-xs mx-auto backdrop-blur-md mt-4">
                <p class="font-medium mb-1">No AI model configured</p>
                <p class="text-xs">Go to <button id="goToSettings" class="underline text-neutral-900 dark:text-neutral-100 font-medium">Settings</button> to set up a local model.</p>
              </div>
            </div>
          </div>
          <div class="border-t border-neutral-200/40 dark:border-neutral-700/40 p-3 flex-shrink-0 bg-white/30 dark:bg-neutral-800/30">
            <div class="relative bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl shadow-sm">
              <div id="attachPreview" class="hidden px-3 pt-2 pb-1 flex items-center gap-2 flex-wrap"></div>
              <div class="flex">
                <textarea id="chatInput" placeholder="Ask anything..." rows="3"
                  class="flex-1 resize-none bg-transparent px-3 py-2.5 text-sm text-neutral-700 dark:text-neutral-300 placeholder-neutral-400 dark:placeholder-neutral-500 focus:outline-none"></textarea>
                <div class="flex flex-col gap-1 p-2 self-end">
                  <button id="sendBtn" class="px-3 py-2 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm disabled:opacity-40 disabled:cursor-not-allowed" disabled>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
                  </button>
                  <button id="stopBtn" class="hidden px-3 py-2 rounded-lg bg-neutral-200 dark:bg-neutral-700 text-rose-600 dark:text-rose-400 hover:bg-neutral-300 dark:hover:bg-neutral-600 transition-all shadow-sm">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
                  </button>
                </div>
              </div>
              <div class="flex items-center gap-1.5 px-2 pb-2 pt-1.5">
                <button id="newChatBtn" class="flex items-center gap-1 text-xs px-2 py-1 rounded-md text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100/80 dark:hover:bg-neutral-700/60 transition-all whitespace-nowrap" title="Start a new chat">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12h8M12 8v8"/></svg>
                  <span>New</span>
                </button>
                <button id="recentBtn" class="flex items-center gap-1 text-xs px-2 py-1 rounded-md text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100/80 dark:hover:bg-neutral-700/60 transition-all whitespace-nowrap" title="Recent chats">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  <span>Recents</span>
                </button>
                <button id="attachBtn" class="flex items-center gap-1 text-xs px-2 py-1 rounded-md text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100/80 dark:hover:bg-neutral-700/60 transition-all whitespace-nowrap" title="Attach image or file (PDF, DOCX, TXT, etc.)">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.49"/></svg>
                  <span>Attach</span>
                </button>
                <div id="builderBtnContainer" class="relative shrink-0">
                  <button id="builderBtn" class="flex items-center gap-1 text-xs px-2 py-1 rounded-md text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100/80 dark:hover:bg-neutral-700/60 transition-all whitespace-nowrap" title="Enter Plugin Builder mode">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
                    <span>Builder</span>
                  </button>
                  <div id="builderDropdown" class="hidden absolute bottom-full left-0 mb-1 bg-white/95 dark:bg-neutral-800/95 backdrop-blur-xl border border-neutral-200/50 dark:border-neutral-700/50 rounded-lg shadow-lg z-50 min-w-[180px] py-1 max-h-48 overflow-y-auto">
                  </div>
                </div>
                <div id="projSelectorContainer" class="shrink-0"></div>
                <div id="kbSelectorContainer" class="shrink-0 min-w-0"></div>
                <div id="promptPickerMount" class="shrink-0"></div>
                <div id="mcpIndicator" class="hidden shrink-0">
                  <span class="text-[10px] leading-none py-[5px] px-2 rounded-full bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-800 whitespace-nowrap inline-flex items-center gap-1">
                    <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block"></span>
                    <span id="mcpToolCount"></span> tools
                  </span>
                </div>
                <button id="downloadChatBtn" class="p-1.5 rounded-md text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100/80 dark:hover:bg-neutral-700/60 transition-all shrink-0" title="Download chat">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                </button>
              </div>
            </div>
            <div class="flex items-center gap-2 mt-1.5 px-1">
              <span id="kbBadge" class="hidden text-xs leading-none py-[5px] px-2.5 rounded-full bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-800 whitespace-nowrap inline-flex items-center">KB active</span>
              <div id="kbModeButtons" class="hidden flex items-center gap-1">
                <button id="btnModeRag" class="text-xs leading-none py-[5px] px-2.5 rounded-full border whitespace-nowrap transition-all inline-flex items-center bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 border-neutral-900 dark:border-neutral-100">RAG</button>
                <button id="btnModeContext" class="text-xs leading-none py-[5px] px-2.5 rounded-full border whitespace-nowrap transition-all inline-flex items-center bg-white/60 dark:bg-neutral-700/60 text-neutral-500 dark:text-neutral-400 border-neutral-200/50 dark:border-neutral-600/50 hover:bg-white/90 dark:hover:bg-neutral-700/90">Context Window</button>
              </div>
              <span id="fullContextTokens" class="hidden text-xs leading-none py-[5px] px-2.5 rounded-full border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 whitespace-nowrap inline-flex items-center"></span>
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
    const kbSelectorContainer = container.querySelector('#kbSelectorContainer');
    const kbBadge = container.querySelector('#kbBadge');
    const kbModeButtons = container.querySelector('#kbModeButtons');
    const btnModeRag = container.querySelector('#btnModeRag');
    const btnModeContext = container.querySelector('#btnModeContext');
    const fullContextTokens = container.querySelector('#fullContextTokens');
    const stopBtn = container.querySelector('#stopBtn');

    if (window.AppState?.currentUser) {
      const savedName = await window.api.settings.get('profile.displayName');
      const displayName = savedName || window.AppState.currentUser.displayName || window.AppState.currentUser.email || 'there';
      chatUserName.textContent = `Hi ${displayName}. What's on your mind?`;
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
      this.activeCollectionId = selections.length > 0 ? selections[0].collectionId : null;
      kbBadge.classList.toggle('hidden', selections.length === 0);
      kbModeButtons.classList.toggle('hidden', selections.length === 0);
      if (selections.length === 0) {
        fullContextTokens.classList.add('hidden');
        this.fullContext = false;
      } else if (this.fullContext) {
        this._estimateFullContextTokens(fullContextTokens);
      }
      if (this.activeConversationId) {
        await window.api.storage.updateConversationKBSelections(this.activeConversationId, selections);
      }
      chatInput.placeholder = selections.length > 0
        ? (this.fullContext ? 'Ask anything...' : 'Ask anything...')
        : 'Ask anything...';
    });

    // Mode buttons click handlers
    btnModeRag.addEventListener('click', () => {
      this.fullContext = false;
      this._updateModeButtonsUI(btnModeRag, btnModeContext, fullContextTokens);
      chatInput.placeholder = 'Ask anything...';
    });

    btnModeContext.addEventListener('click', async () => {
      this.fullContext = true;
      this._updateModeButtonsUI(btnModeRag, btnModeContext, fullContextTokens);
      chatInput.placeholder = 'Ask with full document context...';
      await this._estimateFullContextTokens(fullContextTokens);
    });

    // Restore selections if conversation has them
    if (this.activeKBSelections.length > 0) {
      window.KBSelector.setSelections(this.activeKBSelections);
      kbBadge.classList.toggle('hidden', this.activeKBSelections.length === 0);
      kbModeButtons.classList.toggle('hidden', this.activeKBSelections.length === 0);
      this._updateModeButtonsUI(btnModeRag, btnModeContext, fullContextTokens);
      if (this.fullContext) {
        this._estimateFullContextTokens(fullContextTokens);
      }
    }

    // Initialize Prompt Picker below input
    const promptPickerMount = container.querySelector('#promptPickerMount');
    if (promptPickerMount && window.PromptPicker) {
      window.PromptPicker.render(promptPickerMount, (content) => {
        chatInput.value = content;
        chatInput.style.height = 'auto';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
        sendBtn.disabled = !content.trim() || this.isStreaming || !pm.activeProvider;
        chatInput.focus();
      });
    }

    // Show active project indicator (Client Workspace plugin)
    this._updateActiveProjectBar(container);

    // Initialize Project Selector dropdown
    const projSelectorContainer = container.querySelector('#projSelectorContainer');
    if (projSelectorContainer && window.ProjectSelector) {
      window.ProjectSelector.render(projSelectorContainer, (project) => {
        // Update the active project bar when selection changes
        this._updateActiveProjectBar(container);
      });
    }

    // Load conversations (auto-load most recent or start new)
    await this._loadConversations(null, messages, welcomeMessage);

    // Input handling
    chatInput.addEventListener('input', () => {
      chatInput.style.height = 'auto';
      chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
      sendBtn.disabled = (!chatInput.value.trim() && !this.pendingAttachments.length) || this.isStreaming || !pm.activeProvider;

      // Slash command autocomplete
      this._handleSlashAutocomplete(chatInput);
    });

    chatInput.addEventListener('keydown', (e) => {
      // Handle slash dropdown navigation
      const slashDrop = document.querySelector('#slashAutocomplete');
      if (slashDrop && !slashDrop.classList.contains('hidden')) {
        const items = slashDrop.querySelectorAll('[data-slash-value]');
        if (items.length > 0) {
          const activeItem = slashDrop.querySelector('.bg-neutral-100, .dark\\:bg-neutral-700');
          let idx = [...items].indexOf(activeItem);

          if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (activeItem) activeItem.classList.remove('bg-neutral-100', 'dark:bg-neutral-700');
            idx = (idx + 1) % items.length;
            items[idx].classList.add('bg-neutral-100', 'dark:bg-neutral-700');
            items[idx].scrollIntoView({ block: 'nearest' });
            return;
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (activeItem) activeItem.classList.remove('bg-neutral-100', 'dark:bg-neutral-700');
            idx = idx <= 0 ? items.length - 1 : idx - 1;
            items[idx].classList.add('bg-neutral-100', 'dark:bg-neutral-700');
            items[idx].scrollIntoView({ block: 'nearest' });
            return;
          }
          if (e.key === 'Tab' || e.key === 'Enter') {
            e.preventDefault();
            const selected = activeItem || items[0];
            chatInput.value = selected.dataset.slashValue + ' ';
            slashDrop.classList.add('hidden');
            chatInput.dispatchEvent(new Event('input'));
            return;
          }
          if (e.key === 'Escape') {
            slashDrop.classList.add('hidden');
            return;
          }
        }
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!sendBtn.disabled) this._send(chatInput, sendBtn, messages, welcomeMessage, null);
      }
    });

    sendBtn.addEventListener('click', () => {
      this._send(chatInput, sendBtn, messages, welcomeMessage, null);
    });

    // Hide slash autocomplete on blur
    chatInput.addEventListener('blur', () => {
      setTimeout(() => {
        const drop = document.querySelector('#slashAutocomplete');
        if (drop) drop.classList.add('hidden');
      }, 150);
    });

    // Attachment button
    const attachBtn = container.querySelector('#attachBtn');
    const attachPreview = container.querySelector('#attachPreview');

    attachBtn.addEventListener('click', async () => {
      const filePath = await window.api.chat.pickFile();
      if (!filePath) return;
      const result = await window.api.chat.readFile(filePath);
      if (result.error) {
        attachPreview.classList.remove('hidden');
        attachPreview.innerHTML = `<span class="text-xs text-red-500">${result.error}</span>`;
        setTimeout(() => { attachPreview.classList.add('hidden'); attachPreview.innerHTML = ''; }, 3000);
        return;
      }
      this.pendingAttachments.push(result);
      this._renderAttachPreview(attachPreview);
      // Enable send button when attachment is present
      sendBtn.disabled = this.isStreaming || !pm.activeProvider;
    });

    stopBtn.addEventListener('click', async () => {
      await this._stopStream(stopBtn, sendBtn, chatInput);
    });

    // Builder button — enter plugin builder mode
    const builderBtn = container.querySelector('#builderBtn');
    const builderDropdown = container.querySelector('#builderDropdown');
    if (builderBtn && builderDropdown) {
      builderBtn.addEventListener('click', async () => {
        // Populate dropdown with existing AI plugins + "New Plugin" option
        const generated = await window.api.pluginGen.listGenerated();
        let html = `<button data-builder-action="new" class="w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-neutral-100/80 dark:hover:bg-neutral-700/60 transition-colors text-neutral-700 dark:text-neutral-300 font-medium">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12h8M12 8v8"/></svg> New Plugin
        </button>`;
        if (generated.length > 0) {
          html += '<div class="border-t border-neutral-200/40 dark:border-neutral-700/40 my-1"></div>';
          for (const p of generated) {
            html += `<button data-builder-action="edit" data-plugin-id="${p.id}" class="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-neutral-100/80 dark:hover:bg-neutral-700/60 transition-colors text-neutral-600 dark:text-neutral-400">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg> ${p.name}
            </button>`;
          }
        }
        builderDropdown.innerHTML = html;
        builderDropdown.classList.toggle('hidden');

        // Bind dropdown items
        builderDropdown.querySelectorAll('button').forEach(btn => {
          btn.addEventListener('click', () => {
            builderDropdown.classList.add('hidden');
            const action = btn.dataset.builderAction;
            const pluginId = btn.dataset.pluginId;
            if (action === 'new') {
              // Enter builder mode with no plugin — first message will create one
              if (window.BuilderMode) window.BuilderMode.enter(null);
            } else if (action === 'edit' && pluginId) {
              if (window.BuilderMode) window.BuilderMode.enter(pluginId);
            }
          });
        });
      });

      // Close dropdown on outside click
      document.addEventListener('click', (e) => {
        const container = document.querySelector('#builderBtnContainer');
        if (container && !container.contains(e.target)) {
          builderDropdown.classList.add('hidden');
        }
      });
    }

    // Recent button — navigate to chat history page
    const recentBtn = container.querySelector('#recentBtn');
    if (recentBtn) {
      recentBtn.addEventListener('click', () => {
        window.AppRouter.navigate('recent');
      });
    }

    // New Chat button — start a fresh conversation
    const newChatBtn = container.querySelector('#newChatBtn');
    if (newChatBtn) {
      newChatBtn.addEventListener('click', async () => {
        await this._startNewConversation(null, container.querySelector('#messages'), container.querySelector('#welcomeMessage'));
        container.querySelector('#chatInput')?.focus();
      });
    }

    // Download chat button
    const downloadChatBtn = container.querySelector('#downloadChatBtn');
    if (downloadChatBtn) {
      downloadChatBtn.addEventListener('click', async () => {
        if (!this.activeConversationId) return;
        const msgs = await window.api.storage.getMessages(this.activeConversationId, 500);
        const conv = this.conversations.find(c => c.id === this.activeConversationId);
        const title = conv?.title || 'conversation';
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
    }

    // Register stream listeners once
    if (!this._listenersRegistered) {
      // Chat stream stopped event
      window.api.chat.onStreamStopped(() => {
        if (stopBtn) stopBtn.classList.add('hidden');
        if (sendBtn) sendBtn.classList.remove('hidden');
        this.isStreaming = false;
      });
      this._listenersRegistered = true;

      // Local engine cold-start load progress — render a bar inside the typing bubble.
      if (window.api.engine?.onLoadProgress) {
        window.api.engine.onLoadProgress((data) => this._showLoadProgress(data));
      }

      // Local engine per-response token stats (tokens used, tokens/sec).
      if (window.api.engine?.onStats) {
        window.api.engine.onStats((data) => { this._pendingStats = data; });
      }

      // Local AI stream (via iimagine-engine)
      window.api.localAI.onStreamChunk((chunk) => {
        if (this.activeTypingEl?.parentNode) this.activeTypingEl.remove();
        if (chunk.message?.content && this.activeAssistantEl) {
          if (!this._firstTokenTime) this._firstTokenTime = Date.now();
          this.activeAssistantEl.style.display = '';
          this.activeAssistantContent += chunk.message.content;
          this.activeAssistantEl.querySelector('.msg-content').textContent = this.activeAssistantContent;
          const msgs = document.querySelector('#messages');
          if (msgs) msgs.scrollTop = msgs.scrollHeight;
        }
      });

      window.api.localAI.onStreamDone(async () => {
        this._onStreamComplete();
      });

      // Vertex stream
      window.api.vertex.onStreamChunk((chunk) => {
        if (this.activeTypingEl?.parentNode) this.activeTypingEl.remove();
        if (chunk.content && this.activeAssistantEl) {
          this.activeAssistantEl.style.display = '';
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
          this.activeAssistantEl.style.display = '';
          this.activeAssistantContent += chunk.content;
          this.activeAssistantEl.querySelector('.msg-content').textContent = this.activeAssistantContent;
          const msgs = document.querySelector('#messages');
          if (msgs) msgs.scrollTop = msgs.scrollHeight;
        }
      });

      window.api.gateway.onStreamDone(async () => {
        this._onStreamComplete();
      });

      // Gateway clear indicator (replaces "Searching..." with actual follow-up content)
      window.api.gateway.onClearIndicator(() => {
        if (this.activeAssistantEl) {
          // Remove the indicator text from accumulated content
          this.activeAssistantContent = this.activeAssistantContent
            .replace(/\n\n⚡ \*Running action\.\.\.\*\n\n/g, '')
            .replace(/\n\n🔍 \*Searching\.\.\.\*\n\n/g, '')
            .replace(/\n\n⏸️ \*\*Approval needed:.*?\n/g, '');
          const contentEl = this.activeAssistantEl.querySelector('.msg-content');
          if (contentEl) contentEl.textContent = this.activeAssistantContent;
        }
      });

      // Chat RAG stream (KB-augmented chat)
      window.api.chatRag.onChunk((chunk) => {
        if (this.activeTypingEl?.parentNode) this.activeTypingEl.remove();
        if (chunk.content && this.activeAssistantEl) {
          this.activeAssistantEl.style.display = '';
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

    // Check for connected MCP integrations and show indicator
    this._updateMCPIndicator(container);
  },

  async _updateMCPIndicator(container) {
    try {
      const indicator = container.querySelector('#mcpIndicator');
      const countEl = container.querySelector('#mcpToolCount');
      if (!indicator || !countEl || !window.api.mcp) return;
      const tools = await window.api.mcp.getTools();
      if (tools && tools.length > 0) {
        countEl.textContent = tools.length;
        indicator.classList.remove('hidden');
      } else {
        indicator.classList.add('hidden');
      }
    } catch {}
  },

  async _loadConversations(convList, messagesEl, welcomeMessage) {
    this.conversations = await window.api.storage.getConversations(50);
    if (convList) this._renderConvList(convList, messagesEl, welcomeMessage);

    // Check if a specific conversation was requested (e.g. from project chat tab or recent page)
    const pendingId = window._cwPendingConvId;
    if (pendingId) {
      window._cwPendingConvId = null;
      const target = this.conversations.find(c => c.id === pendingId);
      if (target) {
        await this._selectConversation(target.id, messagesEl, welcomeMessage);
        if (convList) this._highlightConv(convList);
        return;
      }
    }

    // Load active conversation or most recent, or start new
    if (this.activeConversationId) {
      await this._selectConversation(this.activeConversationId, messagesEl, welcomeMessage);
    } else if (this.conversations.length > 0) {
      await this._selectConversation(this.conversations[0].id, messagesEl, welcomeMessage);
    }
    if (convList) this._highlightConv(convList);
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
    const kbModeButtons = document.querySelector('#kbModeButtons');
    const btnModeRag = document.querySelector('#btnModeRag');
    const btnModeContext = document.querySelector('#btnModeContext');
    const fullContextTokens = document.querySelector('#fullContextTokens');
    if (window.KBSelector) {
      window.KBSelector.setSelections(this.activeKBSelections);
    }
    if (kbBadge) kbBadge.classList.toggle('hidden', this.activeKBSelections.length === 0);
    if (kbModeButtons) kbModeButtons.classList.toggle('hidden', this.activeKBSelections.length === 0);
    if (btnModeRag && btnModeContext) {
      this._updateModeButtonsUI(btnModeRag, btnModeContext, fullContextTokens);
    }
    if (this.fullContext && this.activeKBSelections.length > 0 && fullContextTokens) {
      this._estimateFullContextTokens(fullContextTokens);
    }
    const chatInput = document.querySelector('#chatInput');
    if (chatInput) {
      chatInput.placeholder = 'Ask anything...';
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
    // Get active project ID from Client Workspace plugin
    let projectId = null;
    try {
      const activeProject = await window.api.plugins.sendEvent('cw:get-active-project', {});
      if (activeProject && activeProject.id) projectId = activeProject.id;
    } catch {}
    await window.api.storage.createConversation({
      id,
      title: 'New conversation',
      model: window.ProviderManager.activeProvider?.name || null,
      providerType: window.ProviderManager.activeProvider?.type || 'local',
      collectionId: this.activeCollectionId || null,
      kbSelections: this.activeKBSelections.length > 0 ? JSON.stringify(this.activeKBSelections) : null,
      projectId,
    });
    this.activeConversationId = id;
    this.chatHistory = [];

    // Refresh list
    this.conversations = await window.api.storage.getConversations(50);
    if (convList) {
      this._renderConvList(convList, messagesEl, welcomeMessage);
      this._highlightConv(convList);
    }

    // Clear messages area
    messagesEl.innerHTML = '';
    messagesEl.appendChild(welcomeMessage);
    welcomeMessage.classList.remove('hidden');
  },

  async _send(chatInput, sendBtn, messages, welcomeMessage, convList) {
    const text = chatInput.value.trim();
    if ((!text && !this.pendingAttachments.length) || this.isStreaming) return;

    // Per-response stats: mark submit time, reset first-token + token stats.
    this._respStartTime = Date.now();
    this._firstTokenTime = null;
    this._pendingStats = null;

    const pm = window.ProviderManager;
    if (!pm.activeProvider) return;

    // ── Plugin Generation Intent Detection ──────────────────────
    if (text && !this.pendingAttachments.length) {
      const intent = await window.api.pluginGen.detectIntent(text);
      if (intent.isPluginRequest) {
        // If in builder mode and modifying the active plugin, pass the active ID
        if (window.BuilderMode?.isActive() && intent.action === 'modify' && !intent.pluginId) {
          intent.pluginId = window.BuilderMode.activePluginId;
        }
        await this._handlePluginGeneration(text, intent, chatInput, sendBtn, messages, welcomeMessage);
        return;
      }
      // Also detect general modification phrases when in builder mode
      // When in builder mode, EVERYTHING goes to plugin generator unless it's clearly a navigation/exit command
      if (window.BuilderMode?.isActive()) {
        const exitPhrases = /^(?:exit|quit|leave|close|go to|navigate to|open |switch to|show me (?:chat|settings|images|videos|knowledge))/i;
        if (!exitPhrases.test(text)) {
          const pluginId = window.BuilderMode.activePluginId;
          const action = pluginId ? 'modify' : 'create';
          const autoIntent = { isPluginRequest: true, action, pluginId };
          await this._handlePluginGeneration(text, autoIntent, chatInput, sendBtn, messages, welcomeMessage);
          return;
        }
      }
    }
    // ── End Plugin Generation ────────────────────────────────────

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

    // Check for slash commands or skills
    if (text.startsWith('/')) {
      const commands = await window.api.plugins.getCommands();
      const skills = await window.api.skills.autocomplete();
      const parts = text.split(' ');
      const cmdName = parts[0];
      const cmdArgs = parts.slice(1).join(' ');
      const cmd = commands.find(c => c.command === cmdName);

      // Check for skill match: /skill-name rest of message
      const skillSlug = cmdName.slice(1); // remove leading /
      const matchedSkill = skills.find(s => s.slug === skillSlug);

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
          this.activeAssistantEl.style.display = '';
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

      // If not a plugin command, check if it's a skill
      if (matchedSkill) {
        // Strip /skill-name, use rest as the user message
        const userQuery = cmdArgs || '';
        if (!userQuery.trim()) {
          // Just /skill-name with no message — show a hint
          this._appendMessage(messages, 'assistant', `Skill **${matchedSkill.name}** activated. Type your message after the skill name, e.g.:\n\n\`/${matchedSkill.slug} your question here\``);
          chatInput.value = '';
          chatInput.style.height = 'auto';
          return;
        }

        // Inject skill context and continue with normal chat
        const skillContext = await window.api.skills.buildContext([matchedSkill.slug]);
        if (skillContext) {
          // Add skill context as system message to history
          this.chatHistory.push({ role: 'system', content: skillContext });
        }
        // Replace the text with just the user query (without /skill-name prefix)
        text = userQuery;
        // Fall through to normal chat flow below
      }
    }

    // Build message content with attachments
    let userMessageContent = text;
    let userMessageForHistory = text;

    if (this.pendingAttachments.length > 0) {
      const attachments = [...this.pendingAttachments];
      this.pendingAttachments = [];
      const attachPreview = document.querySelector('#attachPreview');
      if (attachPreview) { attachPreview.classList.add('hidden'); attachPreview.innerHTML = ''; }

      const imageAttachments = attachments.filter(a => a.type === 'image');
      const docAttachments = attachments.filter(a => a.type === 'document');

      if (imageAttachments.length > 0) {
        // Build multimodal content array for vision models
        const contentParts = [];
        if (docAttachments.length > 0) {
          const docContext = docAttachments.map(d => `[File: ${d.filename}]\n${d.text}`).join('\n\n');
          contentParts.push({ type: 'text', text: docContext + '\n\n' + (text || 'Describe this image.') });
        } else {
          contentParts.push({ type: 'text', text: text || 'Describe this image.' });
        }
        for (const img of imageAttachments) {
          contentParts.push({
            type: 'image_url',
            image_url: { url: `data:${img.mimeType};base64,${img.base64}` }
          });
        }
        userMessageContent = contentParts;
        userMessageForHistory = (text || 'Describe this image.') + imageAttachments.map(i => ` [📷 ${i.filename}]`).join('') + docAttachments.map(d => ` [📄 ${d.filename}]`).join('');
      } else if (docAttachments.length > 0) {
        // Text-only: prepend document content to the message
        const docContext = docAttachments.map(d => `[File: ${d.filename}]\n${d.text}`).join('\n\n---\n\n');
        userMessageContent = `The user has attached the following file(s):\n\n${docContext}\n\n---\n\nUser message: ${text || 'Please review the attached file(s).'}`;
        userMessageForHistory = (text || 'Please review the attached file(s).') + docAttachments.map(d => ` [📄 ${d.filename}]`).join('');
      }
    }

    this.chatHistory.push({ role: 'user', content: userMessageContent });
    this._appendMessage(messages, 'user', userMessageForHistory);

    // Persist user message (plain text version — don't store base64 in DB)
    await window.api.storage.addMessage({
      conversationId: this.activeConversationId,
      role: 'user',
      content: userMessageForHistory,
      model: pm.activeProvider.name,
      providerType: pm.activeProvider.type,
    });

    // Stamp project_id on this conversation if a project is active and it's not already stamped
    try {
      const activeProject = await window.api.plugins.sendEvent('cw:get-active-project', {});
      if (activeProject && activeProject.id && this.activeConversationId) {
        await window.api.plugins.sendEvent('cw:stamp-conversation-project', {
          conversationId: this.activeConversationId,
          projectId: activeProject.id,
        });
      }
    } catch {}

    // Auto-title from first message
    const conv = this.conversations.find(c => c.id === this.activeConversationId);
    if (conv && conv.title === 'New conversation' && this.chatHistory.length === 1) {
      const title = text.substring(0, 40) + (text.length > 40 ? '...' : '');
      await window.api.storage.updateConversationTitle(this.activeConversationId, title);
      this.conversations = await window.api.storage.getConversations(50);
      if (convList) {
        this._renderConvList(convList, messages, welcomeMessage);
        this._highlightConv(convList);
      }
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
        fullContext: this.fullContext,          // Full Context mode
      });

      if (!result.success) {
        if (this.activeTypingEl?.parentNode) this.activeTypingEl.remove();
        this.activeAssistantEl.style.display = '';
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
      this.activeAssistantEl.style.display = '';
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

  _renderAttachPreview(container) {
    if (!this.pendingAttachments.length) {
      container.classList.add('hidden');
      container.innerHTML = '';
      return;
    }
    container.classList.remove('hidden');
    container.innerHTML = this.pendingAttachments.map((att, i) => {
      const icon = att.type === 'image' ? '🖼️' : '📄';
      return `<span class="inline-flex items-center gap-1 text-xs bg-neutral-100 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300 px-2 py-1 rounded-lg">
        ${icon} ${att.filename}
        <button data-remove-attach="${i}" class="ml-1 text-neutral-400 hover:text-red-500">×</button>
      </span>`;
    }).join('');
    container.querySelectorAll('[data-remove-attach]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.pendingAttachments.splice(parseInt(btn.dataset.removeAttach), 1);
        this._renderAttachPreview(container);
        // Update send button state
        const chatInput = document.querySelector('#chatInput');
        const sendBtn = document.querySelector('#sendBtn');
        const pm = window.ProviderManager;
        if (sendBtn && chatInput) {
          sendBtn.disabled = (!chatInput.value.trim() && !this.pendingAttachments.length) || this.isStreaming || !pm.activeProvider;
        }
      });
    });
  },

  _appendMessage(container, role, content) {
    const div = document.createElement('div');
    div.className = `message-enter group flex ${role === 'user' ? 'justify-end' : 'justify-start'}`;
    const wrapper = document.createElement('div');
    wrapper.className = 'flex flex-col max-w-[85%]';
    const bubble = document.createElement('div');
    bubble.className = role === 'user'
      ? 'bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 rounded-2xl rounded-br-sm px-4 py-2.5 text-sm'
      : 'msg-content text-neutral-800 dark:text-neutral-200 rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm whitespace-pre-wrap';
    if (role === 'assistant') {
      bubble.classList.add('assistant-bubble');
    }
    bubble.textContent = content;
    wrapper.appendChild(bubble);

    // Add action bar with save/copy icons for assistant messages
    if (role === 'assistant') {
      const actionBar = this._createMessageActionBar(content);
      wrapper.appendChild(actionBar);
    }

    div.appendChild(wrapper);
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  },

  _createMessageActionBar(content) {
    const bar = document.createElement('div');
    bar.className = 'flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity';

    // Copy button
    const copyBtn = document.createElement('button');
    copyBtn.className = 'p-1 rounded text-neutral-300 hover:text-neutral-600 dark:text-neutral-600 dark:hover:text-neutral-300 transition-colors';
    copyBtn.title = 'Copy';
    copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(content);
      copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
      setTimeout(() => {
        copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
      }, 2000);
    });

    // Save to project button (📄)
    const saveBtn = document.createElement('button');
    saveBtn.className = 'cw-save-btn p-1 rounded text-neutral-300 hover:text-neutral-600 dark:text-neutral-600 dark:hover:text-neutral-300 transition-colors';
    saveBtn.title = 'Save to project';
    saveBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>';
    saveBtn.addEventListener('click', () => this._showSaveDialog(content));

    bar.appendChild(copyBtn);
    bar.appendChild(saveBtn);

    // TTS play button (speaker icon)
    const ttsBtn = document.createElement('button');
    ttsBtn.className = 'tts-play-btn p-1 rounded text-neutral-300 hover:text-violet-600 dark:text-neutral-600 dark:hover:text-violet-400 transition-colors';
    ttsBtn.title = 'Read aloud';
    ttsBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>';
    ttsBtn.addEventListener('click', () => this._playTTS(ttsBtn, content));
    bar.appendChild(ttsBtn);

    return bar;
  },

  // ── Slash Command Autocomplete ─────────────────────────────────

  _slashCache: null,
  _slashCacheTime: 0,

  async _handleSlashAutocomplete(input) {
    const text = input.value;

    // Only show when input starts with / and cursor is in the first word
    if (!text.startsWith('/') || text.includes(' ')) {
      const drop = document.querySelector('#slashAutocomplete');
      if (drop) drop.classList.add('hidden');
      return;
    }

    const query = text.slice(1).toLowerCase(); // remove leading /

    // Cache commands + skills for 5 seconds
    const now = Date.now();
    if (!this._slashCache || now - this._slashCacheTime > 5000) {
      const [commands, skills] = await Promise.all([
        window.api.plugins.getCommands(),
        window.api.skills.autocomplete(),
      ]);
      this._slashCache = [
        ...commands.map(c => ({ type: 'command', name: c.command || c.name, description: c.description || '' })),
        ...skills.map(s => ({ type: 'skill', name: '/' + s.slug, description: s.description || s.name })),
      ];
      this._slashCacheTime = now;
    }

    // Filter by query
    const filtered = query
      ? this._slashCache.filter(item => item.name.toLowerCase().includes(query))
      : this._slashCache;

    if (filtered.length === 0) {
      const drop = document.querySelector('#slashAutocomplete');
      if (drop) drop.classList.add('hidden');
      return;
    }

    // Render dropdown
    let drop = document.querySelector('#slashAutocomplete');
    if (!drop) {
      drop = document.createElement('div');
      drop.id = 'slashAutocomplete';
      drop.className = 'absolute bottom-full left-0 right-0 mb-1 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl shadow-lg overflow-hidden z-50';
      input.parentElement.style.position = 'relative';
      input.parentElement.appendChild(drop);
    }

    drop.classList.remove('hidden');
    drop.innerHTML = `
      <div class="max-h-48 overflow-y-auto py-1">
        ${filtered.slice(0, 10).map((item, i) => `
          <div data-slash-value="${this._escAttr(item.name)}" class="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-700 ${i === 0 ? 'bg-neutral-100 dark:bg-neutral-700' : ''}">
            <span class="text-[10px] px-1.5 py-0.5 rounded font-medium ${item.type === 'skill' ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400' : 'bg-neutral-100 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-400'}">${item.type === 'skill' ? 'skill' : 'cmd'}</span>
            <span class="text-sm font-medium text-neutral-900 dark:text-neutral-100">${this._esc(item.name)}</span>
            <span class="text-xs text-neutral-400 dark:text-neutral-500 truncate">${this._esc(item.description)}</span>
          </div>
        `).join('')}
      </div>
    `;

    // Click handler for items
    drop.querySelectorAll('[data-slash-value]').forEach(el => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        input.value = el.dataset.slashValue + ' ';
        drop.classList.add('hidden');
        input.focus();
        input.dispatchEvent(new Event('input'));
      });
    });
  },

  _escAttr(str) {
    return (str || '').replace(/"/g, '&quot;');
  },

  _esc(str) {
    const div = document.createElement('span');
    div.textContent = str || '';
    return div.innerHTML;
  },

  async _autoPlayTTS(text, bubbleEl) {
    // Guard: only one autoplay per response
    if (this._ttsPlaying || this._ttsAutoPlayPending) return;
    this._ttsAutoPlayPending = true;
    try {
      const settings = await window.api.tts.getSettings();
      if (!settings || !settings.autoplay) { this._ttsAutoPlayPending = false; return; }
      const ttsBtn = bubbleEl?.querySelector('.tts-play-btn');
      if (ttsBtn) {
        this._playTTS(ttsBtn, text);
      }
    } catch {}
    this._ttsAutoPlayPending = false;
  },

  _splitIntoSentences(text) {
    // Split on sentence boundaries (.!?) followed by space or end
    const sentences = text.match(/[^.!?]+[.!?]+[\s]?|[^.!?]+$/g);
    if (!sentences) return [text];
    // Merge very short sentences with the next one for smoother playback
    const merged = [];
    let buffer = '';
    for (const s of sentences) {
      buffer += s;
      if (buffer.length >= 60) {
        merged.push(buffer.trim());
        buffer = '';
      }
    }
    if (buffer.trim()) {
      if (merged.length > 0 && buffer.trim().length < 40) {
        merged[merged.length - 1] += ' ' + buffer.trim();
      } else {
        merged.push(buffer.trim());
      }
    }
    return merged.length ? merged : [text];
  },

  async _playTTS(btn, text) {
    // If already playing/generating, stop everything
    if (this._ttsPlaying) {
      this._stopTTS();
      return;
    }
    this._ttsPlaying = true;
    this._ttsCancelled = false;
    this._ttsCurrentAudio = null;

    // Show loading state
    const origHtml = btn.innerHTML;
    const showStop = () => {
      btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" class="text-violet-600 dark:text-violet-400"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
      btn.title = 'Stop';
    };
    const showLoading = () => {
      btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="animate-pulse"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>';
      btn.title = 'Generating audio...';
    };
    const resetBtn = () => {
      btn.innerHTML = origHtml;
      btn.title = 'Read aloud';
      this._ttsPlaying = false;
      this._ttsCurrentAudio = null;
    };

    // Wire stop on click
    btn.onclick = () => this._stopTTS();

    showLoading();

    try {
      // Split into sentences for chunked playback
      const sentences = this._splitIntoSentences(text);

      for (let i = 0; i < sentences.length; i++) {
        if (this._ttsCancelled) break;

        const chunk = sentences[i];
        if (!chunk.trim()) continue;

        // Generate audio for this sentence
        if (i === 0) showLoading();
        const result = await window.api.tts.synthesize(chunk);
        if (this._ttsCancelled || !result || !result.audioPath) break;

        // Play this chunk
        showStop();
        await new Promise((resolve, reject) => {
          const audio = new Audio('file://' + result.audioPath);
          this._ttsCurrentAudio = audio;
          audio.onended = resolve;
          audio.onerror = reject;
          // Wait for audio to be fully buffered before playing to prevent cut-off
          audio.oncanplaythrough = () => {
            audio.play().catch(reject);
          };
          audio.load();
        });

        if (this._ttsCancelled) break;
      }
    } catch (err) {
      if (!this._ttsCancelled) {
        console.warn('[TTS] Synthesis failed:', err.message);
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-rose-500"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>';
        btn.title = 'TTS failed — check Settings → Voice';
        setTimeout(resetBtn, 3000);
        return;
      }
    }

    resetBtn();
    btn.onclick = () => this._playTTS(btn, text);
  },

  _stopTTS() {
    this._ttsCancelled = true;
    if (this._ttsCurrentAudio) {
      this._ttsCurrentAudio.pause();
      this._ttsCurrentAudio.currentTime = 0;
      this._ttsCurrentAudio = null;
    }
    this._ttsPlaying = false;
    // Reset all TTS buttons to original state
    document.querySelectorAll('.tts-play-btn').forEach(btn => {
      btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>';
      btn.title = 'Read aloud';
    });
  },

  _showSaveDialog(content) {
    // Check if client-workspace plugin has an active project
    const existing = document.getElementById('cw-save-dialog');
    if (existing) existing.remove();

    const dialog = document.createElement('div');
    dialog.id = 'cw-save-dialog';
    dialog.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm';
    dialog.innerHTML = `
      <div class="bg-white/90 dark:bg-neutral-800/90 backdrop-blur-xl border border-neutral-200/60 dark:border-neutral-700/60 rounded-2xl p-6 w-full max-w-md shadow-xl">
        <h3 class="text-base font-semibold text-neutral-900 dark:text-neutral-100 mb-4">Save to Project</h3>
        <div class="space-y-3">
          <div>
            <label class="text-xs font-medium text-neutral-500 dark:text-neutral-400 block mb-1">Title *</label>
            <input type="text" id="cw-save-title" placeholder="e.g. Client Job Ad Draft"
              class="w-full bg-white/60 dark:bg-neutral-700/60 border border-neutral-200/50 dark:border-neutral-600/50 rounded-xl px-4 py-2 text-sm text-neutral-700 dark:text-neutral-300 placeholder-neutral-400 dark:placeholder-neutral-500 focus-within:bg-white/90 dark:focus-within:bg-neutral-700/90 transition-all shadow-sm focus:outline-none" />
          </div>
          <div>
            <label class="text-xs font-medium text-neutral-500 dark:text-neutral-400 block mb-1">Description (optional)</label>
            <input type="text" id="cw-save-desc" placeholder="Brief note about this document"
              class="w-full bg-white/60 dark:bg-neutral-700/60 border border-neutral-200/50 dark:border-neutral-600/50 rounded-xl px-4 py-2 text-sm text-neutral-700 dark:text-neutral-300 placeholder-neutral-400 dark:placeholder-neutral-500 focus-within:bg-white/90 dark:focus-within:bg-neutral-700/90 transition-all shadow-sm focus:outline-none" />
          </div>
        </div>
        <div id="cw-save-error" class="hidden text-xs text-rose-600 dark:text-rose-400 mt-2"></div>
        <div class="flex justify-end gap-2 mt-4">
          <button id="cw-save-cancel"
            class="px-4 py-2.5 rounded-lg bg-white/60 dark:bg-neutral-700/60 border border-neutral-200/50 dark:border-neutral-600/50 text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:bg-white/90 dark:hover:bg-neutral-700/90 transition-all shadow-sm">
            Cancel
          </button>
          <button id="cw-save-confirm"
            class="px-4 py-2.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm">
            Save
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(dialog);

    const titleInput = dialog.querySelector('#cw-save-title');
    const descInput = dialog.querySelector('#cw-save-desc');
    const errorEl = dialog.querySelector('#cw-save-error');
    const cancelBtn = dialog.querySelector('#cw-save-cancel');
    const confirmBtn = dialog.querySelector('#cw-save-confirm');

    titleInput.focus();

    cancelBtn.addEventListener('click', () => dialog.remove());
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.remove(); });

    titleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') confirmBtn.click();
      if (e.key === 'Escape') dialog.remove();
    });

    confirmBtn.addEventListener('click', async () => {
      const title = titleInput.value.trim();
      if (!title) {
        errorEl.textContent = 'Title is required';
        errorEl.classList.remove('hidden');
        return;
      }

      const result = await window.api.plugins.sendEvent('cw:save-response', {
        content,
        title,
        description: descInput.value.trim() || null,
      });

      if (result?.error) {
        errorEl.textContent = result.error;
        errorEl.classList.remove('hidden');
        return;
      }

      dialog.remove();

      // Show confirmation toast
      this._showToast(`Saved to ${result?.projectName || 'project'}`);
    });
  },

  _showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-sm font-medium shadow-lg transition-opacity';
    toast.textContent = `📄 ${message}`;
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 2500);
  },

  _createAssistantBubble(container) {
    const div = document.createElement('div');
    div.className = 'message-enter group flex justify-start';
    div.style.display = 'none'; // Hidden until first token arrives
    const wrapper = document.createElement('div');
    wrapper.className = 'flex flex-col max-w-[85%]';
    const bubble = document.createElement('div');
    bubble.className = 'assistant-bubble text-neutral-800 dark:text-neutral-200 rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm whitespace-pre-wrap';
    const content = document.createElement('span');
    content.className = 'msg-content';
    bubble.appendChild(content);
    wrapper.appendChild(bubble);
    div.appendChild(wrapper);
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

  // Render/update a model-load progress bar inside the active typing bubble.
  // Driven by 'engine:loadProgress' events during a local engine cold start. The bar
  // eases toward each phase target and gently creeps so it never looks frozen; it is
  // removed automatically when the first token arrives (activeTypingEl is cleared).
  _showLoadProgress(data) {
    const el = this.activeTypingEl;
    if (!el || !el.parentNode) return; // streaming already started, nothing to show

    if (data?.phase === 'error') {
      if (this._loadProgressTimer) { clearInterval(this._loadProgressTimer); this._loadProgressTimer = null; }
      return;
    }

    // Swap the typing dots for a labelled bar the first time we get progress.
    let bar = el.querySelector('.load-progress-fill');
    if (!bar) {
      el.innerHTML = `
        <div class="assistant-bubble rounded-2xl rounded-bl-sm px-4 py-3 w-64 max-w-full">
          <div class="load-progress-label text-xs text-neutral-500 mb-2"></div>
          <div class="h-1.5 w-full bg-neutral-200 dark:bg-neutral-700 rounded-full overflow-hidden">
            <div class="load-progress-fill h-full bg-black dark:bg-white rounded-full transition-all duration-500 ease-out" style="width:0%"></div>
          </div>
          <div class="text-[10px] text-neutral-400 mt-1.5">First message is slower while the model loads. Later replies are fast.</div>
        </div>
      `;
      bar = el.querySelector('.load-progress-fill');
      this._loadProgressTarget = 0;
    }

    const label = el.querySelector('.load-progress-label');
    if (label && data?.label) label.textContent = data.label;

    const target = Math.max(this._loadProgressTarget || 0, Number(data?.percent) || 0);
    this._loadProgressTarget = target;
    bar.style.width = target + '%';

    // Gentle creep between milestones so the bar keeps moving during long phases.
    if (this._loadProgressTimer) clearInterval(this._loadProgressTimer);
    this._loadProgressTimer = setInterval(() => {
      const fill = this.activeTypingEl?.querySelector?.('.load-progress-fill');
      if (!fill || !this.activeTypingEl?.parentNode) {
        clearInterval(this._loadProgressTimer);
        this._loadProgressTimer = null;
        return;
      }
      const cur = parseFloat(fill.style.width) || 0;
      const ceiling = Math.min((this._loadProgressTarget || 0) + 10, 96);
      if (cur < ceiling) fill.style.width = (cur + 0.6).toFixed(1) + '%';
    }, 400);
  },

  async _loadKBCollections() {
    // Refresh the KB selector component
    if (window.KBSelector) {
      await window.KBSelector.refresh();
    }
  },

  // Build a subtle per-response stats line: time-to-first-token, tokens used, tokens/sec.
  // Returns null when no stats are available (e.g. cloud providers that don't emit them).
  _buildStatsLine() {
    const stats = this._pendingStats;
    const haveTiming = this._respStartTime && this._firstTokenTime;
    if (!stats && !haveTiming) return null;

    const parts = [];
    if (haveTiming) {
      const secs = (this._firstTokenTime - this._respStartTime) / 1000;
      parts.push(`${secs.toFixed(1)}s to first token`);
    }
    if (stats?.completionTokens != null) {
      parts.push(`${stats.completionTokens} tokens`);
    }
    let tps = stats?.tokensPerSecond;
    if ((tps == null || !isFinite(tps)) && stats?.completionTokens != null && this._firstTokenTime) {
      const genSecs = (Date.now() - this._firstTokenTime) / 1000;
      if (genSecs > 0) tps = stats.completionTokens / genSecs;
    }
    if (tps != null && isFinite(tps)) parts.push(`${tps.toFixed(1)} tok/s`);

    if (!parts.length) return null;

    const div = document.createElement('div');
    div.className = 'text-[11px] text-neutral-400 dark:text-neutral-500 mt-1 select-none';
    div.textContent = parts.join('  ·  ');
    return div;
  },

  async _onStreamComplete() {
    if (this.activeTypingEl?.parentNode) this.activeTypingEl.remove();
    if (this.activeAssistantContent && this.activeConversationId) {
      // Ensure bubble is visible
      if (this.activeAssistantEl) this.activeAssistantEl.style.display = '';
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

      // Add action bar (copy + save) to the completed assistant bubble
      if (this.activeAssistantEl) {
        const wrapper = this.activeAssistantEl.querySelector('.flex.flex-col');
        if (wrapper) {
          const actionBar = this._createMessageActionBar(this.activeAssistantContent);
          wrapper.appendChild(actionBar);
          // Per-response performance stats (local engine only).
          const statsLine = this._buildStatsLine();
          if (statsLine) wrapper.appendChild(statsLine);
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

      // Auto-play TTS if enabled
      this._autoPlayTTS(this.activeAssistantContent, this.activeAssistantEl);
    }
    this.isStreaming = false;
    const sendBtn = document.querySelector('#sendBtn');
    const stopBtn = document.querySelector('#stopBtn');
    const chatInput = document.querySelector('#chatInput');
    if (sendBtn && chatInput) sendBtn.disabled = !chatInput.value.trim() && !this.pendingAttachments.length;
    if (stopBtn) stopBtn.classList.add('hidden');
    if (sendBtn) sendBtn.classList.remove('hidden');
    this.activeAssistantEl = null;
    this.activeAssistantContent = '';
    this.activeTypingEl = null;
  },
  _updateActiveProjectBar(container) {
    // The ProjectSelector component handles the active project display.
    // This method is kept as a hook for future use (e.g. updating badges).
  },

  _updateModeButtonsUI(ragBtn, contextBtn, tokensEl) {
    const activeClasses = ['bg-neutral-900', 'dark:bg-neutral-100', 'text-white', 'dark:text-neutral-900', 'border-neutral-900', 'dark:border-neutral-100'];
    const inactiveClasses = ['bg-white/60', 'dark:bg-neutral-700/60', 'text-neutral-500', 'dark:text-neutral-400', 'border-neutral-200/50', 'dark:border-neutral-600/50'];

    if (this.fullContext) {
      // Context Window is active
      ragBtn.classList.remove(...activeClasses);
      ragBtn.classList.add(...inactiveClasses, 'hover:bg-white/90', 'dark:hover:bg-neutral-700/90');
      contextBtn.classList.remove(...inactiveClasses, 'hover:bg-white/90', 'dark:hover:bg-neutral-700/90');
      contextBtn.classList.add(...activeClasses);
    } else {
      // RAG is active
      ragBtn.classList.remove(...inactiveClasses, 'hover:bg-white/90', 'dark:hover:bg-neutral-700/90');
      ragBtn.classList.add(...activeClasses);
      contextBtn.classList.remove(...activeClasses);
      contextBtn.classList.add(...inactiveClasses, 'hover:bg-white/90', 'dark:hover:bg-neutral-700/90');
      if (tokensEl) tokensEl.classList.add('hidden');
    }
  },

  async _estimateFullContextTokens(tokensEl) {
    if (!this.activeKBSelections.length) {
      tokensEl.classList.add('hidden');
      return;
    }
    try {
      const estimate = await window.api.chatRag.estimateFullContext(this.activeKBSelections);
      if (estimate && estimate.totalChars > 0) {
        const tokens = Math.ceil(estimate.totalChars / 4); // ~4 chars per token
        const display = tokens > 1000 ? `~${(tokens / 1000).toFixed(1)}k tokens` : `~${tokens} tokens`;
        tokensEl.textContent = display;
        tokensEl.classList.remove('hidden');
      } else {
        tokensEl.classList.add('hidden');
      }
    } catch (err) {
      console.warn('[Chat] Token estimate failed:', err);
      tokensEl.classList.add('hidden');
    }
  },

  // ── Plugin Generation Handler ─────────────────────────────────
  async _handlePluginGeneration(text, intent, chatInput, sendBtn, messages, welcomeMessage) {
    welcomeMessage.classList.add('hidden');

    // Show user message
    this._appendMessage(messages, 'user', text);
    chatInput.value = '';
    chatInput.style.height = 'auto';
    sendBtn.disabled = true;

    if (intent.action === 'delete') {
      this._appendMessage(messages, 'assistant', `🗑️ Deleting plugin "${intent.pluginId}"...`);
      const result = await window.api.pluginGen.delete(intent.pluginId);
      if (result.success) {
        await window.api.pluginGen.refreshSidebar();
        this._replaceLastAssistant(messages, `✅ Plugin "${intent.pluginId}" has been deleted.`);
        // Refresh sidebar items
        await window.loadPluginSidebarItems?.();
      } else {
        this._replaceLastAssistant(messages, `❌ Could not delete plugin: ${result.error || 'not found'}`);
      }
      sendBtn.disabled = false;
      return;
    }

    // Create or modify
    const actionLabel = intent.action === 'modify' ? 'Updating' : 'Building';
    this._appendMessage(messages, 'assistant', `🔨 ${actionLabel} your plugin...`);

    const result = await window.api.pluginGen.generate(text, intent.pluginId || null);

    if (result.success) {
      await window.api.pluginGen.refreshSidebar();
      // Refresh sidebar nav items
      await window.loadPluginSidebarItems?.();

      // Check if the plugin activated successfully or has an error
      const plugins = await window.api.plugins.list();
      const generated = plugins.find(p => p.id === result.pluginId);
      if (generated && generated.error) {
        // Plugin was generated but crashed on activation — offer to fix
        const msg = `⚠️ Created "${result.pluginName}" but it has a bug:\n\n\`${generated.error}\`\n\nWant me to fix it? Just say "fix the ${result.pluginId} plugin"`;
        this._replaceLastAssistant(messages, msg);
        // Refresh builder preview if already in builder mode, otherwise enter it
        if (window.BuilderMode?.isActive()) {
          window.BuilderMode.activePluginId = result.pluginId;
          window.BuilderMode.refreshPreview();
        } else {
          window.BuilderMode?.enter(result.pluginId);
        }
      } else {
        const msg = intent.action === 'modify'
          ? `✅ Updated "${result.pluginName}". Preview refreshed →`
          : `✅ Created "${result.pluginName}"! Preview is on the right →`;
        this._replaceLastAssistant(messages, msg);
        // Refresh builder preview if already in builder mode, otherwise enter it
        if (window.BuilderMode?.isActive()) {
          window.BuilderMode.activePluginId = result.pluginId;
          window.BuilderMode.refreshPreview();
          window.BuilderMode._updatePluginName();
        } else {
          window.BuilderMode?.enter(result.pluginId);
        }
      }
    } else {
      this._replaceLastAssistant(messages, `❌ Plugin generation failed: ${result.error}\n\nTry rephrasing your request or using a more capable model.`);
    }

    sendBtn.disabled = false;
  },

  _replaceLastAssistant(messagesEl, newContent) {
    // Search globally — in builder mode the chat may be in a different container
    const searchIn = document.querySelector('#builderChatContent') || messagesEl;
    const allMsgs = searchIn.querySelectorAll('.msg-content');
    if (allMsgs.length > 0) {
      const last = allMsgs[allMsgs.length - 1];
      last.innerHTML = this._renderMarkdown ? this._renderMarkdown(newContent) : newContent.replace(/\n/g, '<br>');
    }
  },
  // ── End Plugin Generation Handler ──────────────────────────────

  async _stopStream(stopBtn, sendBtn, chatInput) {
    try {
      await window.api.chat.stop();
      // Hide stop button, show send button
      stopBtn.classList.add('hidden');
      sendBtn.classList.remove('hidden');
      // Re-enable input
      sendBtn.disabled = !chatInput.value.trim() && !this.pendingAttachments.length;
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
