// Builder Mode — Split-view layout for plugin development
// Shows chat on the left and live plugin preview on the right
// Activates automatically during plugin generation/modification

const BuilderMode = {
  active: false,
  activePluginId: null,
  _originalContent: null,

  /**
   * Enter builder mode — splits the main content area into chat + preview
   */
  enter(pluginId) {
    if (this.active && this.activePluginId === pluginId && pluginId !== null) {
      // Already in builder mode for this plugin — just refresh preview
      this.refreshPreview();
      return;
    }

    this.active = true;
    this.activePluginId = pluginId; // Can be null for "new plugin" mode

    const mainContent = document.querySelector('#mainContent');
    if (!mainContent) return;

    // Save current content
    this._originalContent = mainContent.innerHTML;

    // Create split layout
    mainContent.innerHTML = `
      <div id="builderContainer" class="flex flex-1 min-h-0 overflow-hidden">
        <!-- Chat Panel (left) -->
        <div id="builderChat" class="flex flex-col w-[400px] min-w-[320px] max-w-[50%] border-r border-neutral-200/40 dark:border-neutral-700/40 overflow-hidden relative">
          <!-- Builder mode header -->
          <div class="flex items-center justify-between px-4 py-2 border-b border-neutral-200/30 dark:border-neutral-700/30 bg-white/30 dark:bg-neutral-800/30 flex-shrink-0">
            <div class="flex items-center gap-2">
              <span class="text-xs font-medium text-neutral-500 dark:text-neutral-400 flex items-center gap-1.5"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg> Builder Mode</span>
              <span class="text-xs text-neutral-400 dark:text-neutral-500">·</span>
              <span id="builderPluginName" class="text-xs font-medium text-neutral-700 dark:text-neutral-300 truncate max-w-[150px]"></span>
            </div>
            <button id="exitBuilderBtn" class="text-xs px-2.5 py-1 rounded-md bg-white/60 dark:bg-neutral-700/60 border border-neutral-200/50 dark:border-neutral-600/50 text-neutral-600 dark:text-neutral-300 hover:bg-white/90 dark:hover:bg-neutral-700/90 transition-all" title="Exit builder mode">
              ✕ Exit
            </button>
          </div>
          <!-- Chat content renders here -->
          <div id="builderChatContent" class="flex-1 flex flex-col min-h-0 overflow-hidden"></div>
        </div>

        <!-- Resize handle -->
        <div id="builderResizer" class="w-1 cursor-col-resize bg-neutral-200/40 dark:bg-neutral-700/40 hover:bg-neutral-300 dark:hover:bg-neutral-600 transition-colors flex-shrink-0"></div>

        <!-- Preview Panel (right) -->
        <div id="builderPreview" class="flex-1 flex flex-col min-h-0 overflow-hidden">
          <!-- Preview header -->
          <div class="flex items-center justify-between px-4 py-2 border-b border-neutral-200/30 dark:border-neutral-700/30 bg-white/30 dark:bg-neutral-800/30 flex-shrink-0">
            <span class="text-xs font-medium text-neutral-500 dark:text-neutral-400">Preview</span>
            <button id="refreshPreviewBtn" class="text-xs px-2.5 py-1 rounded-md bg-white/60 dark:bg-neutral-700/60 border border-neutral-200/50 dark:border-neutral-600/50 text-neutral-600 dark:text-neutral-300 hover:bg-white/90 dark:hover:bg-neutral-700/90 transition-all" title="Refresh preview">
              ↻ Refresh
            </button>
          </div>
          <!-- Plugin page renders here -->
          <div id="builderPreviewContent" class="flex-1 overflow-y-auto"></div>
        </div>
      </div>
    `;

    // Bind exit button
    document.querySelector('#exitBuilderBtn').addEventListener('click', () => this.exit());

    // Bind refresh button
    document.querySelector('#refreshPreviewBtn').addEventListener('click', () => this.refreshPreview());

    // Set plugin name in header
    this._updatePluginName();

    // Render chat into the left panel
    const chatContainer = document.querySelector('#builderChatContent');
    if (window.ChatPage) {
      window.ChatPage.render(chatContainer);
    }

    // Render plugin preview on the right
    this.refreshPreview();

    // Setup resizer
    this._setupResizer();
  },

  /**
   * Exit builder mode — return to full-screen normal view
   */
  exit() {
    this.active = false;
    this.activePluginId = null;

    // Navigate back to chat page in full mode
    if (window.AppRouter) {
      window.AppRouter.navigate('chat');
    }
  },

  /**
   * Refresh the preview panel with the latest plugin page
   */
  async refreshPreview() {
    if (!this.active) return;

    const previewContainer = document.querySelector('#builderPreviewContent');
    if (!previewContainer) return;

    // If no plugin yet (new plugin mode), show placeholder
    if (!this.activePluginId) {
      previewContainer.innerHTML = `
        <div class="flex items-center justify-center h-full">
          <div class="text-center">
            <p class="text-neutral-400 dark:text-neutral-500 mb-2"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mx-auto"><circle cx="12" cy="12" r="10"/><path d="M8 12h8M12 8v8"/></svg></p>
            <p class="text-sm text-neutral-500 dark:text-neutral-400">Describe what you want to build</p>
            <p class="text-xs text-neutral-400 dark:text-neutral-500 mt-1">Your plugin will appear here</p>
          </div>
        </div>
      `;
      return;
    }

    try {
      const html = await window.api.plugins.renderPage(this.activePluginId);
      if (html) {
        previewContainer.innerHTML = html;
        // Execute script tags
        previewContainer.querySelectorAll('script').forEach(oldScript => {
          const newScript = document.createElement('script');
          newScript.textContent = oldScript.textContent;
          oldScript.parentNode.replaceChild(newScript, oldScript);
        });
      } else {
        previewContainer.innerHTML = `
          <div class="flex items-center justify-center h-full">
            <div class="text-center">
              <p class="text-neutral-400 dark:text-neutral-500 mb-2"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mx-auto"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg></p>
              <p class="text-sm text-neutral-500 dark:text-neutral-400">Plugin is being built...</p>
              <p class="text-xs text-neutral-400 dark:text-neutral-500 mt-1">Preview will appear once generation completes</p>
            </div>
          </div>
        `;
      }
    } catch (err) {
      previewContainer.innerHTML = `
        <div class="p-6">
          <div class="bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-2xl p-5">
            <p class="text-sm font-medium text-rose-700 dark:text-rose-400">Preview Error</p>
            <p class="text-xs text-rose-600 dark:text-rose-500 mt-1">${err.message}</p>
          </div>
        </div>
      `;
    }
  },

  /**
   * Update the plugin name display in the header
   */
  async _updatePluginName() {
    const el = document.querySelector('#builderPluginName');
    if (!el) return;

    if (!this.activePluginId) {
      el.textContent = 'New Plugin';
      return;
    }

    const plugins = await window.api.plugins.list();
    const plugin = plugins.find(p => p.id === this.activePluginId);
    el.textContent = plugin?.name || this.activePluginId;
  },

  /**
   * Setup the resizable divider between chat and preview
   */
  _setupResizer() {
    const resizer = document.querySelector('#builderResizer');
    const chatPanel = document.querySelector('#builderChat');
    if (!resizer || !chatPanel) return;

    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    resizer.addEventListener('mousedown', (e) => {
      isResizing = true;
      startX = e.clientX;
      startWidth = chatPanel.offsetWidth;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      const diff = e.clientX - startX;
      const newWidth = Math.max(280, Math.min(startWidth + diff, window.innerWidth * 0.6));
      chatPanel.style.width = newWidth + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    });
  },

  /**
   * Check if currently in builder mode
   */
  isActive() {
    return this.active;
  },
};

window.BuilderMode = BuilderMode;
