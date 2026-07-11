// Settings page — provider configuration UI

const SettingsPage = {
  _activeTab: 'profile',

  render(container) {
    container.innerHTML = `
      <div id="settingsPage" class="flex flex-col flex-1 min-h-0">
        <div class="p-6 pb-0">
          <h2 class="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100 mb-4">Settings</h2>
          <div class="flex gap-1 border-b border-neutral-200/40 dark:border-neutral-700/40">
            <button data-settings-tab="profile" class="settings-tab-btn px-4 py-2 text-sm font-medium transition-all border-b-2">Profile</button>
            <button data-settings-tab="models" class="settings-tab-btn px-4 py-2 text-sm font-medium transition-all border-b-2">Models</button>
            <button data-settings-tab="chat" class="settings-tab-btn px-4 py-2 text-sm font-medium transition-all border-b-2">Chat</button>
            <button data-settings-tab="plugins" class="settings-tab-btn px-4 py-2 text-sm font-medium transition-all border-b-2">Plugins</button>
            <button data-settings-tab="integrations" class="settings-tab-btn px-4 py-2 text-sm font-medium transition-all border-b-2">Integrations</button>
            <button data-settings-tab="personas" class="settings-tab-btn px-4 py-2 text-sm font-medium transition-all border-b-2">Personas</button>
            <button data-settings-tab="memory" id="memoryTabBtn" class="settings-tab-btn px-4 py-2 text-sm font-medium transition-all border-b-2 hidden">Memory</button>
          </div>
        </div>
        <div id="settingsContent" class="flex-1 overflow-y-auto p-6 space-y-6"></div>
      </div>
    `;

    this._bindTabs(container);
    this._checkMemoryTabVisibility(container);
    this._showTab('profile', container);
  },

  async _checkMemoryTabVisibility(container) {
    try {
      const plugins = await window.api.plugins.list();
      const cortexLite = plugins.find(p => p.id === 'cortex-lite' && p.enabled);
      const memoryBtn = container.querySelector('#memoryTabBtn');
      if (cortexLite && memoryBtn) {
        memoryBtn.classList.remove('hidden');
      }
    } catch {}
  },

  _bindTabs(container) {
    container.querySelectorAll('.settings-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._showTab(btn.dataset.settingsTab, container);
      });
    });
  },

  _highlightTab(tab, container) {
    container.querySelectorAll('.settings-tab-btn').forEach(btn => {
      const isActive = btn.dataset.settingsTab === tab;
      if (isActive) {
        btn.classList.remove('text-neutral-500', 'dark:text-neutral-400', 'border-transparent', 'hover:text-neutral-700', 'dark:hover:text-neutral-300');
        btn.classList.add('text-neutral-900', 'dark:text-neutral-100', 'border-neutral-900', 'dark:border-neutral-100');
      } else {
        btn.classList.remove('text-neutral-900', 'dark:text-neutral-100', 'border-neutral-900', 'dark:border-neutral-100');
        btn.classList.add('text-neutral-500', 'dark:text-neutral-400', 'border-transparent', 'hover:text-neutral-700', 'dark:hover:text-neutral-300');
      }
    });
  },

  _showTab(tab, container) {
    this._activeTab = tab;
    this._highlightTab(tab, container);
    const content = container.querySelector('#settingsContent');

    // Clear poll interval when switching tabs
    if (this._pollInterval) {
      clearInterval(this._pollInterval);
      this._pollInterval = null;
    }

    // Stop runtime monitor polling when leaving models tab
    if (window.RuntimeMonitor) {
      window.RuntimeMonitor.stopPolling();
    }

    if (tab === 'profile') this._renderProfile(content);
    else if (tab === 'models') this._renderModelsTab(content);
    else if (tab === 'chat') this._renderChatTab(content);
    else if (tab === 'plugins') this._renderPluginsTab(content);
    else if (tab === 'integrations') this._renderIntegrationsTab(content);
    else if (tab === 'personas') this._renderPersonasTab(content);
    else if (tab === 'memory') this._renderMemoryTab(content);
  },

  // ─── Profile Tab ──────────────────────────────────────────────────────────
  _renderProfile(content) {
    content.innerHTML = `
      <!-- Account -->
      <section class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-5 shadow-[0_2px_10px_rgb(0,0,0,0.02)] dark:shadow-[0_2px_10px_rgb(0,0,0,0.2)] backdrop-blur-md">
        <div class="flex items-center gap-2 mb-3">
          <div class="p-2 bg-white dark:bg-neutral-800 rounded-xl border border-neutral-100 dark:border-neutral-800 shadow-sm text-neutral-700 dark:text-neutral-300"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>
          <div>
            <h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Profile</h3>
            <p id="settingsUserEmail" class="text-xs text-neutral-500 dark:text-neutral-400"></p>
          </div>
        </div>
        <div class="space-y-3">
          <div>
            <label class="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-1.5 block">Display Name</label>
            <div class="flex gap-2">
              <input id="profileNameInput" type="text" placeholder="Enter your name"
                class="flex-1 bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300 placeholder-neutral-400 dark:placeholder-neutral-500 focus:bg-white/90 dark:focus:bg-neutral-800/90 focus:outline-none transition-all shadow-sm" />
              <button id="saveProfileNameBtn" class="px-4 py-2 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm">Save</button>
            </div>
            <p id="profileNameStatus" class="text-xs text-emerald-600 mt-1 hidden">Saved</p>
          </div>
        </div>
      </section>

      <!-- Your Data -->
      <section class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-5 shadow-[0_2px_10px_rgb(0,0,0,0.02)] dark:shadow-[0_2px_10px_rgb(0,0,0,0.2)] backdrop-blur-md">
        <div class="flex items-center gap-2 mb-3">
          <div class="p-2 bg-white dark:bg-neutral-800 rounded-xl border border-neutral-100 dark:border-neutral-800 shadow-sm text-neutral-700 dark:text-neutral-300"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg></div>
          <div>
            <h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Your Data</h3>
            <p class="text-xs text-neutral-500 dark:text-neutral-400">Stored locally on this computer — you own it</p>
          </div>
        </div>
        <div id="dataStats" class="space-y-1 text-sm text-neutral-600">
          <p>Loading...</p>
        </div>
      </section>
    `;

    this._bindProfile(content);
  },

  async _bindProfile(content) {
    const settingsUserEmail = content.querySelector('#settingsUserEmail');

    // Account email
    if (window.AppState?.currentUser) {
      settingsUserEmail.textContent = window.AppState.currentUser.email || 'Not signed in';
    }

    // Profile name
    const profileNameInput = content.querySelector('#profileNameInput');
    const saveProfileNameBtn = content.querySelector('#saveProfileNameBtn');
    const profileNameStatus = content.querySelector('#profileNameStatus');

    const savedName = await window.api.settings.get('profile.displayName');
    if (savedName) {
      profileNameInput.value = savedName;
    }

    saveProfileNameBtn.addEventListener('click', async () => {
      const name = profileNameInput.value.trim();
      await window.api.settings.set('profile.displayName', name);
      const sidebarUser = document.querySelector('#sidebarUser');
      if (sidebarUser) sidebarUser.textContent = name || window.AppState?.currentUser?.email || 'Local User';
      if (window.AppState?.currentUser) {
        window.AppState.currentUser.displayName = name;
      }
      profileNameStatus.classList.remove('hidden');
      setTimeout(() => profileNameStatus.classList.add('hidden'), 2000);
    });

    profileNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveProfileNameBtn.click();
    });

    // Data stats
    const dataStats = content.querySelector('#dataStats');
    try {
      const stats = await window.api.storage.getStats();
      dataStats.innerHTML = `
        <div class="flex items-center justify-between py-1">
          <span class="text-neutral-500 dark:text-neutral-400">Location</span>
          <span class="text-xs font-mono text-neutral-700 dark:text-neutral-300 truncate max-w-[200px]" title="${stats.dbPath}">${stats.dbPath}</span>
        </div>
        <div class="flex items-center justify-between py-1">
          <span class="text-neutral-500 dark:text-neutral-400">Size</span>
          <span class="text-neutral-700 dark:text-neutral-300">${stats.fileSizeMB} MB</span>
        </div>
        <div class="flex items-center justify-between py-1">
          <span class="text-neutral-500 dark:text-neutral-400">Conversations</span>
          <span class="text-neutral-700 dark:text-neutral-300">${stats.conversations}</span>
        </div>
        <div class="flex items-center justify-between py-1">
          <span class="text-neutral-500 dark:text-neutral-400">Messages</span>
          <span class="text-neutral-700 dark:text-neutral-300">${stats.messages}</span>
        </div>
        <div class="flex items-center justify-between py-1">
          <span class="text-neutral-500 dark:text-neutral-400">Knowledge entities</span>
          <span class="text-neutral-700 dark:text-neutral-300">${stats.entities}</span>
        </div>
        <div class="flex items-center justify-between py-1">
          <span class="text-neutral-500 dark:text-neutral-400">Media files</span>
          <span class="text-neutral-700 dark:text-neutral-300">${stats.media || 0}</span>
        </div>
      `;

      // Add KB stats
      try {
        const kbStats = await window.api.kb.getStats();
        dataStats.innerHTML += `
          <div class="flex items-center justify-between py-1 border-t border-neutral-200/40 dark:border-neutral-700/40 mt-1 pt-1">
            <span class="text-neutral-500 dark:text-neutral-400">KB collections</span>
            <span class="text-neutral-700 dark:text-neutral-300">${kbStats.collections}</span>
          </div>
          <div class="flex items-center justify-between py-1">
            <span class="text-neutral-500 dark:text-neutral-400">KB documents</span>
            <span class="text-neutral-700 dark:text-neutral-300">${kbStats.documents}</span>
          </div>
          <div class="flex items-center justify-between py-1">
            <span class="text-neutral-500 dark:text-neutral-400">KB chunks</span>
            <span class="text-neutral-700 dark:text-neutral-300">${kbStats.chunks}</span>
          </div>
          <div class="flex items-center justify-between py-1">
            <span class="text-neutral-500 dark:text-neutral-400">Vector search</span>
            <span class="${kbStats.vecLoaded ? 'text-emerald-600' : 'text-amber-500'}">${kbStats.vecLoaded ? 'Active' : 'Unavailable'}</span>
          </div>
        `;
      } catch { /* KB not initialized yet */ }
    } catch {
      dataStats.innerHTML = '<p class="text-xs text-neutral-400">Could not load stats</p>';
    }
  },

  // ─── Chat Tab ─────────────────────────────────────────────────────────────
  _renderChatTab(content) {
    content.innerHTML = `
      <section class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-5 shadow-[0_2px_10px_rgb(0,0,0,0.02)] dark:shadow-[0_2px_10px_rgb(0,0,0,0.2)] backdrop-blur-md">
        <div class="flex items-center gap-2 mb-4">
          <div class="p-2 bg-white dark:bg-neutral-800 rounded-xl border border-neutral-100 dark:border-neutral-800 shadow-sm text-neutral-700 dark:text-neutral-300"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div>
          <div>
            <h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Chat Memory</h3>
            <p class="text-xs text-neutral-500 dark:text-neutral-400">How much conversation history is sent to the model each turn</p>
          </div>
        </div>

        <div class="space-y-4">
          <div>
            <label class="text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1.5 block">Messages to include</label>
            <p class="text-[10px] text-neutral-400 mb-3">The number of recent messages from the current chat that are sent to the model with each new message. More messages = better recall within the chat, but uses more of the context window and may slow responses.</p>
            <div class="flex items-center gap-4">
              <input id="chatHistorySlider" type="range" min="2" max="50" step="2" value="6"
                class="flex-1 h-2 bg-neutral-200 dark:bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-neutral-900 dark:accent-neutral-100" />
              <span id="chatHistoryValue" class="text-sm font-mono font-medium text-neutral-700 dark:text-neutral-300 min-w-[3rem] text-right">6</span>
            </div>
            <div class="flex justify-between text-[10px] text-neutral-400 mt-1 px-0.5">
              <span>2 (minimal)</span>
              <span>50 (maximum)</span>
            </div>
          </div>

          <div class="bg-neutral-50 dark:bg-neutral-900/50 border border-neutral-200/30 dark:border-neutral-700/30 rounded-xl p-3">
            <p class="text-[11px] text-neutral-500 dark:text-neutral-400 leading-relaxed">
              <strong class="text-neutral-700 dark:text-neutral-300">How it works:</strong> Each time you send a message, the last N messages from the current chat are included so the AI can follow the conversation. This only applies within a single chat — starting a new chat resets the history. For cross-chat memory, enable the Cortex plugin in Settings → Plugins.
            </p>
          </div>

          <button id="saveChatSettingsBtn" class="w-full px-4 py-2.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm">
            Save
          </button>
          <p id="chatSettingsSaveStatus" class="text-xs text-emerald-600 text-center hidden">Settings saved</p>
        </div>
      </section>
    `;

    this._bindChatTab(content);
  },

  async _bindChatTab(content) {
    const slider = content.querySelector('#chatHistorySlider');
    const valueDisplay = content.querySelector('#chatHistoryValue');
    const saveBtn = content.querySelector('#saveChatSettingsBtn');
    const saveStatus = content.querySelector('#chatSettingsSaveStatus');

    // Load current value
    const saved = await window.api.settings.get('chat.historyMessages');
    const current = saved || 6;
    slider.value = current;
    valueDisplay.textContent = current;

    // Update display on slide
    slider.addEventListener('input', () => {
      valueDisplay.textContent = slider.value;
    });

    // Save
    saveBtn.addEventListener('click', async () => {
      await window.api.settings.set('chat.historyMessages', parseInt(slider.value, 10));
      saveStatus.classList.remove('hidden');
      setTimeout(() => saveStatus.classList.add('hidden'), 2000);
    });
  },

  // ─── Models Tab ───────────────────────────────────────────────────────────
  _renderModelsTab(content) {
    content.innerHTML = `
      <!-- Local AI -->
      <section class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-5 shadow-[0_2px_10px_rgb(0,0,0,0.02)] dark:shadow-[0_2px_10px_rgb(0,0,0,0.2)] backdrop-blur-md">
        <div class="flex items-center gap-2 mb-3">
          <div class="p-2 bg-white dark:bg-neutral-800 rounded-xl border border-neutral-100 dark:border-neutral-800 shadow-sm text-emerald-600"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"/><path d="m13 8-4 8h6l-4-8z"/></svg></div>
          <div>
            <h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Local AI</h3>
            <p class="text-xs text-neutral-500 dark:text-neutral-400">Nothing leaves your machine</p>
          </div>
        </div>

        <!-- Model Download Onboarding (shown when no engine models installed) -->
        <div id="modelOnboardingMount" class="mb-4"></div>

        <!-- Model Recommendation Wizard -->
        <div id="modelBrowserMount" class="mb-4"></div>

        <!-- Advanced Options -->
        <div id="localAdvancedSection" class="mb-4">
          <button id="advancedToggle" class="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 hover:bg-white/70 dark:hover:bg-neutral-700/70 transition-all text-left group">
            <div class="flex items-center gap-2.5">
              <div class="p-1.5 bg-white dark:bg-neutral-800 rounded-lg border border-neutral-100 dark:border-neutral-800 shadow-sm text-neutral-600 dark:text-neutral-400">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              </div>
              <div>
                <span class="text-sm font-medium text-neutral-900 dark:text-neutral-100">Advanced Options</span>
                <p class="text-[11px] text-neutral-500 dark:text-neutral-400">Web search, context window, network & storage</p>
              </div>
            </div>
            <svg id="advancedChevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-neutral-400 transition-transform"><polyline points="6 9 12 15 18 9"/></svg>
          </button>

          <div id="advancedPanel" class="hidden mt-3 space-y-4">
            <!-- Web Search -->
            <div>
              <div class="flex items-center justify-between">
                <div>
                  <label class="text-xs font-medium text-neutral-500 uppercase tracking-wider">Web Search</label>
                  <p class="text-[10px] text-neutral-400 mt-0.5">Allow the model to search the web for current information</p>
                </div>
                <button id="webSearchToggle" class="relative w-10 h-5 rounded-full transition-colors bg-neutral-200 dark:bg-neutral-700" role="switch" aria-checked="false">
                  <span id="webSearchDot" class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"></span>
                </button>
              </div>
            </div>

            <!-- Context Window -->
            <div>
              <label class="text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1.5 block">Context Window</label>
              <p class="text-[10px] text-neutral-400 mb-2">How much conversation history the model can see. Larger = more memory but slower.</p>
              <select id="contextWindowSelect" class="w-full bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2.5 text-sm text-neutral-700 dark:text-neutral-300 focus:bg-white/90 dark:focus:bg-neutral-800/90 focus:outline-none transition-all shadow-sm">
                <option value="2048">2K tokens (fast, minimal memory)</option>
                <option value="4096">4K tokens (default)</option>
                <option value="8192">8K tokens (balanced)</option>
                <option value="16384">16K tokens (good memory)</option>
                <option value="32768">32K tokens (large context)</option>
                <option value="65536">64K tokens (very large)</option>
                <option value="131072">128K tokens (maximum — requires 16GB+ RAM)</option>
              </select>
            </div>

            <!-- Network Connection -->
            <div>
              <label class="text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1.5 block">Memory Unload Timer</label>
              <p class="text-[10px] text-neutral-400 mb-2">Automatically unload the model from memory after this period of inactivity to free RAM.</p>
              <select id="keepAliveSelect" class="w-full bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2.5 text-sm text-neutral-700 dark:text-neutral-300 focus:bg-white/90 dark:focus:bg-neutral-800/90 focus:outline-none transition-all shadow-sm">
                <option value="1m">1 minute</option>
                <option value="2m">2 minutes (default)</option>
                <option value="5m">5 minutes</option>
                <option value="10m">10 minutes</option>
                <option value="30m">30 minutes</option>
                <option value="-1">Never (keep loaded until app closes)</option>
              </select>
            </div>

            <!-- Model Storage Location -->
            <div>
              <label class="text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1.5 block">Model Storage Location</label>
              <p class="text-[10px] text-neutral-400 mb-2">Where iimagine-engine stores downloaded models on disk.</p>
              <div class="flex items-center gap-2">
                <span id="modelLocationPath" class="flex-1 text-xs font-mono text-neutral-600 dark:text-neutral-400 bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2 truncate">Detecting...</span>
                <button id="openModelLocationBtn" class="px-3 py-2 rounded-lg bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-700 transition-all shadow-sm">Open</button>
              </div>
            </div>

            <!-- Save Advanced Settings -->
            <button id="saveAdvancedBtn" class="w-full px-4 py-2.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm">
              Save Settings
            </button>
            <p id="advancedSaveStatus" class="text-xs text-emerald-600 text-center hidden">Settings saved</p>
          </div>
        </div>

        <!-- Engine status -->
        <div id="engineStatus" class="mb-4">
          <div class="flex items-center justify-between text-sm">
            <span class="text-neutral-600 dark:text-neutral-400">AI Engine</span>
            <span id="engineStatusBadge" class="text-xs px-2 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400 border border-neutral-200">Checking...</span>
          </div>
        </div>

        <!-- Install engine button (shown when engine not found) -->
        <div id="installSection" class="hidden mb-4">
          <button id="installEngineBtn" class="w-full px-4 py-2.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm">
            Install AI Engine
          </button>
          <p id="installProgress" class="text-xs text-neutral-500 mt-2 hidden"></p>
        </div>

        <!-- Model management (shown when engine is running) -->
        <div id="modelSection" class="hidden">
          <div class="flex items-center justify-between mb-2">
            <span class="text-sm text-neutral-600 dark:text-neutral-400">Models</span>
          </div>

          <!-- Download progress (shown during model pull) -->
          <div id="pullProgress" class="hidden mb-3 bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-4 shadow-[0_2px_10px_rgb(0,0,0,0.02)] dark:shadow-[0_2px_10px_rgb(0,0,0,0.2)] backdrop-blur-md">
            <div class="w-full bg-neutral-100 dark:bg-neutral-800 rounded-full h-2 shadow-inner mb-2">
              <div id="pullProgressBar" class="progress-bar bg-gradient-to-r from-neutral-600 to-neutral-900 h-2 rounded-full transition-all" style="width: 0%"></div>
            </div>
            <div class="flex items-center justify-between">
              <p id="pullProgressText" class="text-xs text-neutral-500"></p>
              <button id="cancelPullBtn" class="text-xs text-rose-500 hover:text-rose-700 font-medium">Cancel</button>
            </div>
          </div>

          <!-- Installed models list -->
          <div id="modelList" class="space-y-1"></div>
        </div>

        <!-- Runtime Monitor mount point -->
        <div id="runtimeMonitorMount"></div>
      </section>

      <!-- TTS / Voice Settings -->
      <div id="ttsSettingsMount"></div>

      <!-- Vertex AI (Regional Cloud) -->
      <section class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-5 shadow-[0_2px_10px_rgb(0,0,0,0.02)] dark:shadow-[0_2px_10px_rgb(0,0,0,0.2)] backdrop-blur-md">
        <div class="flex items-center gap-2 mb-3">
          <div class="p-2 bg-white dark:bg-neutral-800 rounded-xl border border-neutral-100 dark:border-neutral-800 shadow-sm text-amber-600"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg></div>
          <div>
            <h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Private Cloud</h3>
            <p class="text-xs text-neutral-500 dark:text-neutral-400">Data stays in your chosen region via Google Cloud</p>
          </div>
        </div>

        <div class="space-y-3">
          <div>
            <label class="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-1.5 block">Region</label>
            <select id="vertexRegion" class="w-full bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2.5 text-sm text-neutral-700 dark:text-neutral-300 focus:bg-white/90 dark:focus:bg-neutral-800/90 focus:outline-none transition-all shadow-sm">
              <option value="">Select a region...</option>
            </select>
          </div>
          <div>
            <label class="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-1.5 block">Model</label>
            <select id="vertexModel" class="w-full bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2.5 text-sm text-neutral-700 dark:text-neutral-300 focus:bg-white/90 dark:focus:bg-neutral-800/90 focus:outline-none transition-all shadow-sm">
              <option value="">Select a model...</option>
            </select>
          </div>
          <button id="activateVertexBtn" class="w-full px-4 py-2.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none" disabled>
            Activate Private Cloud
          </button>
          <div id="vertexStatus" class="hidden text-xs text-emerald-600 text-center"></div>
        </div>
      </section>

      <!-- Cloud Models (AI Gateway) -->
      <section class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-5 shadow-[0_2px_10px_rgb(0,0,0,0.02)] dark:shadow-[0_2px_10px_rgb(0,0,0,0.2)] backdrop-blur-md">
        <div class="flex items-center gap-2 mb-3">
          <div class="p-2 bg-white dark:bg-neutral-800 rounded-xl border border-neutral-100 dark:border-neutral-800 shadow-sm text-red-600"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><path d="M6 6h.01M6 18h.01"/></svg></div>
          <div>
            <h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Public Cloud</h3>
            <p class="text-xs text-neutral-500 dark:text-neutral-400">Access GPT, Claude, Gemini, Grok — bring your own API key</p>
          </div>
        </div>

        <div class="space-y-3">
          <div>
            <label class="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-1.5 block">OpenAI API Key</label>
            <input id="openaiApiKey" type="password" placeholder="sk-..." class="w-full bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2.5 text-sm text-neutral-700 dark:text-neutral-300 placeholder-neutral-400 focus:bg-white/90 dark:focus:bg-neutral-800/90 focus:outline-none transition-all shadow-sm" />
            <p class="text-[10px] text-neutral-400 mt-1">Get your key from <span class="text-neutral-600 dark:text-neutral-300">platform.openai.com/api-keys</span></p>
          </div>
          <div>
            <label class="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-1.5 block">Anthropic API Key</label>
            <input id="anthropicApiKey" type="password" placeholder="sk-ant-..." class="w-full bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2.5 text-sm text-neutral-700 dark:text-neutral-300 placeholder-neutral-400 focus:bg-white/90 dark:focus:bg-neutral-800/90 focus:outline-none transition-all shadow-sm" />
            <p class="text-[10px] text-neutral-400 mt-1">Get your key from <span class="text-neutral-600 dark:text-neutral-300">console.anthropic.com/settings/keys</span></p>
          </div>
          <div>
            <label class="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-1.5 block">Google Gemini API Key</label>
            <input id="geminiApiKey" type="password" placeholder="AIza..." class="w-full bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2.5 text-sm text-neutral-700 dark:text-neutral-300 placeholder-neutral-400 focus:bg-white/90 dark:focus:bg-neutral-800/90 focus:outline-none transition-all shadow-sm" />
            <p class="text-[10px] text-neutral-400 mt-1">Get your key from <span class="text-neutral-600 dark:text-neutral-300">aistudio.google.com/apikey</span></p>
          </div>
          <div>
            <label class="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-1.5 block">OpenRouter API Key</label>
            <input id="openrouterApiKey" type="password" placeholder="sk-or-..." class="w-full bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2.5 text-sm text-neutral-700 dark:text-neutral-300 placeholder-neutral-400 focus:bg-white/90 dark:focus:bg-neutral-800/90 focus:outline-none transition-all shadow-sm" />
            <p class="text-[10px] text-neutral-400 mt-1">Get your key from <span class="text-neutral-600 dark:text-neutral-300">openrouter.ai/keys</span></p>
          </div>
          <div>
            <label class="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-1.5 block">Model</label>
            <select id="gatewayModel" class="w-full bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2.5 text-sm text-neutral-700 dark:text-neutral-300 focus:bg-white/90 dark:focus:bg-neutral-800/90 focus:outline-none transition-all shadow-sm">
              <option value="">Select a model...</option>
            </select>
          </div>
          <button id="activateGatewayBtn" class="w-full px-4 py-2.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none" disabled>
            Activate Public Cloud
          </button>
          <div id="gatewayStatus" class="hidden text-xs text-violet-600 text-center"></div>
          <p class="text-[10px] text-neutral-400">Your API key is stored locally. Data is sent directly to the provider.</p>
        </div>
      </section>
    `;

    this._bindModelsTab(content);
  },

  async _bindModelsTab(content) {
    const engineStatusBadge = content.querySelector('#engineStatusBadge');
    const installSection = content.querySelector('#installSection');
    const installEngineBtn = content.querySelector('#installEngineBtn');
    const installProgress = content.querySelector('#installProgress');
    const modelSection = content.querySelector('#modelSection');
    const cancelPullBtn = content.querySelector('#cancelPullBtn');
    const pullProgress = content.querySelector('#pullProgress');
    const pullProgressBar = content.querySelector('#pullProgressBar');
    const pullProgressText = content.querySelector('#pullProgressText');
    const modelList = content.querySelector('#modelList');

    // ── Model Download Onboarding (no models installed state) ──
    const modelOnboardingMount = content.querySelector('#modelOnboardingMount');
    if (modelOnboardingMount && window.ModelDownloadOnboarding) {
      const shouldShow = await window.ModelDownloadOnboarding.shouldShow();
      if (shouldShow) {
        window.ModelDownloadOnboarding.mount(modelOnboardingMount);
      } else {
        modelOnboardingMount.classList.add('hidden');
      }
    }

    // ── Model Browser (guided wizard + advanced browser) ────────
    const modelBrowserMount = content.querySelector('#modelBrowserMount');
    if (modelBrowserMount && window.ModelBrowser) {
      window.ModelBrowser.mount(modelBrowserMount);

      // Check for manifest updates and show notification
      const updateInfo = await window.api.manifest.checkUpdate();
      if (updateInfo.hasUpdate && updateInfo.newModelCount > 0) {
        const banner = document.createElement('div');
        banner.className = 'mb-3 p-3 rounded-xl bg-blue-50/80 dark:bg-blue-900/20 border border-blue-200/60 dark:border-blue-800/40 flex items-center justify-between';
        banner.innerHTML = `
          <p class="text-xs text-blue-700 dark:text-blue-300">${updateInfo.newModelCount} new model${updateInfo.newModelCount > 1 ? 's' : ''} available in the registry</p>
          <button id="mbDismissUpdate" class="text-[10px] text-blue-400 hover:text-blue-600">Dismiss</button>
        `;
        modelBrowserMount.parentNode.insertBefore(banner, modelBrowserMount);
        banner.querySelector('#mbDismissUpdate').addEventListener('click', () => {
          banner.remove();
          window.api.manifest.dismissUpdate();
        });
      }
    }

    // ── Advanced Options ─────────────────────────────────────────
    this._bindAdvancedOptions(content);

    // ── Runtime Monitor (loaded models status) ───────────────────
    const runtimeMount = content.querySelector('#runtimeMonitorMount');
    if (runtimeMount && window.RuntimeMonitor) {
      window.RuntimeMonitor.mount(runtimeMount);
    }

    // ── TTS Settings ────────────────────────────────────────────────
    const ttsMount = content.querySelector('#ttsSettingsMount');
    if (ttsMount && window.TTSSettings) {
      window.TTSSettings.mount(ttsMount);
    }

    // ── Vertex AI (Regional Cloud) setup ─────────────────────────
    const vertexRegion = content.querySelector('#vertexRegion');
    const vertexModel = content.querySelector('#vertexModel');
    const activateVertexBtn = content.querySelector('#activateVertexBtn');
    const vertexStatus = content.querySelector('#vertexStatus');

    // Populate regions
    window.VERTEX_REGIONS.forEach(r => {
      const opt = document.createElement('option');
      opt.value = r.id;
      opt.textContent = r.name;
      vertexRegion.appendChild(opt);
    });

    // Populate models
    window.VERTEX_MODELS.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = `${m.name} — ${m.description}`;
      vertexModel.appendChild(opt);
    });

    // Restore saved selections
    const savedRegion = await window.api.settings.get('vertex.region');
    const savedModel = await window.api.settings.get('vertex.model');
    if (savedRegion) vertexRegion.value = savedRegion;
    if (savedModel) vertexModel.value = savedModel;

    const updateVertexBtn = () => {
      activateVertexBtn.disabled = !vertexRegion.value || !vertexModel.value;
    };
    vertexRegion.addEventListener('change', updateVertexBtn);
    vertexModel.addEventListener('change', updateVertexBtn);
    updateVertexBtn();

    // Check if already active
    const existingVertex = window.ProviderManager.providers.find(p => p.type === 'vertex');
    if (existingVertex) {
      vertexStatus.textContent = `Active: ${existingVertex.name}`;
      vertexStatus.classList.remove('hidden');
      activateVertexBtn.textContent = 'Update Private Cloud';
    }

    activateVertexBtn.addEventListener('click', async () => {
      const region = vertexRegion.value;
      const modelId = vertexModel.value;
      if (!region || !modelId) return;

      await window.api.settings.set('vertex.region', region);
      await window.api.settings.set('vertex.model', modelId);

      // Remove old vertex providers
      window.ProviderManager.providers = window.ProviderManager.providers.filter(p => p.type !== 'vertex');

      const modelInfo = window.VERTEX_MODELS.find(m => m.id === modelId);
      const regionInfo = window.VERTEX_REGIONS.find(r => r.id === region);
      const provider = new window.VertexProvider(modelId, modelInfo.name, regionInfo.name);
      window.ProviderManager.providers.push(provider);

      if (!window.ProviderManager.activeProvider) {
        window.ProviderManager.activeProvider = provider;
        await window.api.settings.set('activeModel', provider.name);
      }

      window.AppRouter?.updateModelDropdown();

      vertexStatus.textContent = `Active: ${provider.name}`;
      vertexStatus.classList.remove('hidden');
      activateVertexBtn.textContent = 'Update Private Cloud';
    });

    // ── Gateway (Cloud Models) setup ─────────────────────────────
    const openaiApiKey = content.querySelector('#openaiApiKey');
    const anthropicApiKey = content.querySelector('#anthropicApiKey');
    const geminiApiKey = content.querySelector('#geminiApiKey');
    const openrouterApiKey = content.querySelector('#openrouterApiKey');
    const gatewayModel = content.querySelector('#gatewayModel');
    const activateGatewayBtn = content.querySelector('#activateGatewayBtn');
    const gatewayStatus = content.querySelector('#gatewayStatus');

    // Restore saved API keys
    const savedApiKey = await window.api.settings.get('openai.apiKey');
    if (savedApiKey) openaiApiKey.value = savedApiKey;
    const savedAnthropicKey = await window.api.settings.get('anthropic.apiKey');
    if (savedAnthropicKey) anthropicApiKey.value = savedAnthropicKey;
    const savedGeminiKey = await window.api.settings.get('gemini.apiKey');
    if (savedGeminiKey) geminiApiKey.value = savedGeminiKey;
    const savedOpenrouterKey = await window.api.settings.get('openrouter.apiKey');
    if (savedOpenrouterKey) openrouterApiKey.value = savedOpenrouterKey;

    // Populate models
    window.GATEWAY_MODELS.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = `${m.name} (${m.vendor})`;
      gatewayModel.appendChild(opt);
    });

    // Restore saved selection (clear if model no longer exists in list)
    const savedGatewayModel = await window.api.settings.get('gateway.model');
    if (savedGatewayModel) {
      const exists = window.GATEWAY_MODELS.some(m => m.id === savedGatewayModel);
      if (exists) {
        gatewayModel.value = savedGatewayModel;
      } else {
        // Old model ID no longer valid — clear it
        await window.api.settings.set('gateway.model', '');
      }
    }

    // Enable button when model is selected AND the vendor's API key is filled
    const getVendorKeyInput = (vendor) => {
      const map = { openai: openaiApiKey, anthropic: anthropicApiKey, google: geminiApiKey, openrouter: openrouterApiKey };
      return map[vendor];
    };
    const updateGatewayBtnState = () => {
      if (!gatewayModel.value) { activateGatewayBtn.disabled = true; return; }
      const modelInfo = window.GATEWAY_MODELS.find(m => m.id === gatewayModel.value);
      if (!modelInfo) { activateGatewayBtn.disabled = true; return; }
      const keyInput = getVendorKeyInput(modelInfo.vendor);
      activateGatewayBtn.disabled = !keyInput || !keyInput.value.trim();
    };
    gatewayModel.addEventListener('change', updateGatewayBtnState);
    openaiApiKey.addEventListener('input', updateGatewayBtnState);
    anthropicApiKey.addEventListener('input', updateGatewayBtnState);
    geminiApiKey.addEventListener('input', updateGatewayBtnState);
    openrouterApiKey.addEventListener('input', updateGatewayBtnState);
    updateGatewayBtnState();

    // Check if already active
    const existingGateway = window.ProviderManager.providers.find(p => p.type === 'gateway');
    if (existingGateway) {
      gatewayStatus.textContent = `Active: ${existingGateway.name}`;
      gatewayStatus.classList.remove('hidden');
      activateGatewayBtn.textContent = 'Update Public Cloud';
    }

    activateGatewayBtn.addEventListener('click', async () => {
      const modelId = gatewayModel.value;
      if (!modelId) return;
      const modelInfo = window.GATEWAY_MODELS.find(m => m.id === modelId);
      if (!modelInfo) return;
      const keyInput = getVendorKeyInput(modelInfo.vendor);
      const apiKey = keyInput?.value.trim();
      if (!apiKey) return;

      await window.api.settings.set('gateway.model', modelId);
      await window.api.settings.set('gateway.vendor', modelInfo.vendor);
      // Save all provided API keys
      if (openaiApiKey.value.trim()) await window.api.settings.set('openai.apiKey', openaiApiKey.value.trim());
      if (anthropicApiKey.value.trim()) await window.api.settings.set('anthropic.apiKey', anthropicApiKey.value.trim());
      if (geminiApiKey.value.trim()) await window.api.settings.set('gemini.apiKey', geminiApiKey.value.trim());
      if (openrouterApiKey.value.trim()) await window.api.settings.set('openrouter.apiKey', openrouterApiKey.value.trim());

      // Remove old gateway providers
      window.ProviderManager.providers = window.ProviderManager.providers.filter(p => p.type !== 'gateway');

      const provider = new window.GatewayProvider(modelId, modelInfo.name);
      window.ProviderManager.providers.push(provider);

      // Set as active provider
      window.ProviderManager.activeProvider = provider;
      await window.api.settings.set('activeModel', provider.name);

      window.AppRouter?.updateModelDropdown();

      gatewayStatus.textContent = `Active: ${provider.name}`;
      gatewayStatus.classList.remove('hidden');
      activateGatewayBtn.textContent = 'Update Public Cloud';
    });

    // ── Engine status + model pull ───────────────────────────────
    const updateStatus = async () => {
      const status = await window.ProviderManager.getLocalStatus();
      if (status.running || status.models?.length > 0) {
        engineStatusBadge.textContent = status.running ? 'Running' : 'Ready';
        engineStatusBadge.className = 'text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100';
        installSection.classList.add('hidden');
        modelSection.classList.remove('hidden');
        this._renderModels(modelList, status.models || []);
      } else {
        engineStatusBadge.textContent = 'No models';
        engineStatusBadge.className = 'text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-100';
        installSection.classList.add('hidden');
        modelSection.classList.remove('hidden');
        this._renderModels(modelList, []);
      }
    };

    await updateStatus();

    // Poll status while on models tab
    this._pollInterval = setInterval(updateStatus, 5000);

    // Install engine — engine is bundled, just show info
    installEngineBtn.addEventListener('click', async () => {
      installEngineBtn.disabled = true;
      installEngineBtn.textContent = 'Engine is bundled';
      installProgress.classList.remove('hidden');
      installProgress.textContent = 'The AI engine is bundled with the app. Download a model below to get started.';
    });

    // Cancel download button
    cancelPullBtn.addEventListener('click', async () => {
      await window.api.engine.cancelDownload();
    });

    // Engine download progress listener
    window.api.engine.onDownloadProgress((data) => {
      if (!pullProgress) return;
      pullProgress.classList.remove('hidden');

      if (data.total > 0) {
        const pct = data.percent || Math.round((data.downloaded / data.total) * 100);
        pullProgressBar.style.width = pct + '%';
        const downloadedMB = (data.downloaded / 1e6).toFixed(0);
        const totalMB = (data.total / 1e6).toFixed(0);
        pullProgressText.textContent = `Downloading — ${downloadedMB}MB / ${totalMB}MB (${pct}%)`;
      } else {
        pullProgressText.textContent = 'Downloading...';
      }
    });

    window.api.engine.onDownloadDone(async (data) => {
      if (data.success) {
        pullProgressBar.style.width = '100%';
        pullProgressText.textContent = 'Model installed.';
        await window.ProviderManager.refreshLocal();
        await updateStatus();
        window.AppRouter?.updateModelDropdown();

        setTimeout(() => {
          pullProgress.classList.add('hidden');
          pullProgressBar.style.width = '0%';
        }, 1500);
      } else {
        pullProgressText.textContent = data.error === 'Download cancelled' ? 'Download cancelled.' : `Error: ${data.error}`;
        setTimeout(() => {
          pullProgress.classList.add('hidden');
          pullProgressBar.style.width = '0%';
        }, 2000);
      }
    });
  },

  // ─── Personas Tab ──────────────────────────────────────────────────────────
  _renderPersonasTab(content) {
    if (window.PersonalizationPage) {
      window.PersonalizationPage.render(content);
    } else {
      content.innerHTML = '<p class="text-sm text-neutral-500 p-4">Personas not available.</p>';
    }
  },

  // ─── Memory Tab (Cortex Lite) ──────────────────────────────────────────────
  async _renderMemoryTab(content) {
    // Load current settings
    const tokenBudget = await window.api.settings.get('cortex-lite.tokenBudget') || 1500;
    const embeddingModel = await window.api.settings.get('cortex-lite.embeddingModel') || 'nomic-embed-text';
    const extractionEnabled = await window.api.settings.get('cortex-lite.extractionEnabled') !== false;
    const summarizeAfter = await window.api.settings.get('cortex-lite.summarizeAfterMessages') || 10;
    const maxFacts = await window.api.settings.get('cortex-lite.maxFactsInContext') || 5;
    const maxEntities = await window.api.settings.get('cortex-lite.maxEntitiesInContext') || 8;

    content.innerHTML = `
      <section class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-5 shadow-[0_2px_10px_rgb(0,0,0,0.02)] dark:shadow-[0_2px_10px_rgb(0,0,0,0.2)] backdrop-blur-md">
        <div class="flex items-center gap-2 mb-4">
          <div class="p-2 bg-white dark:bg-neutral-800 rounded-xl border border-neutral-100 dark:border-neutral-800 shadow-sm text-purple-600">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a7 7 0 0 1 7 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 0 1 7-7z"/><path d="M10 21h4"/></svg>
          </div>
          <div>
            <h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Memory Settings</h3>
            <p class="text-xs text-neutral-500 dark:text-neutral-400">Cortex Lite — advanced memory configuration</p>
          </div>
        </div>

        <div class="mb-4 px-3 py-2.5 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200/50 dark:border-amber-700/30">
          <p class="text-xs text-amber-700 dark:text-amber-300">⚠️ Advanced users only. These settings control how memory extraction and retrieval work. Incorrect values may degrade response quality or increase latency.</p>
        </div>

        <div class="space-y-5">
          <!-- Extraction Toggle -->
          <div class="flex items-center justify-between">
            <div>
              <label class="text-sm font-medium text-neutral-700 dark:text-neutral-300">Memory Extraction</label>
              <p class="text-[10px] text-neutral-400 mt-0.5">Learn from conversations and store entities/facts</p>
            </div>
            <button id="memExtractionToggle" class="relative w-10 h-5 rounded-full transition-colors ${extractionEnabled ? 'bg-purple-500' : 'bg-neutral-200 dark:bg-neutral-700'}" role="switch" aria-checked="${extractionEnabled}">
              <span class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${extractionEnabled ? 'translate-x-5' : ''}"></span>
            </button>
          </div>

          <!-- Token Budget -->
          <div>
            <label class="text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1.5 block">Context Token Budget</label>
            <p class="text-[10px] text-neutral-400 mb-2">How many tokens of memory context to inject before each message. Higher = more context but uses more of the model's window.</p>
            <input id="memTokenBudget" type="range" min="500" max="3000" step="100" value="${tokenBudget}"
              class="w-full accent-purple-500" />
            <div class="flex justify-between text-[10px] text-neutral-400 mt-1">
              <span>500 (minimal)</span>
              <span id="memTokenBudgetValue" class="font-medium text-neutral-600 dark:text-neutral-300">${tokenBudget} tokens</span>
              <span>3000 (maximum)</span>
            </div>
          </div>

          <!-- Max Facts in Context -->
          <div>
            <label class="text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1.5 block">Max Facts in Context</label>
            <p class="text-[10px] text-neutral-400 mb-2">Maximum number of remembered facts to include per message.</p>
            <input id="memMaxFacts" type="number" min="1" max="20" value="${maxFacts}"
              class="w-20 bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300 focus:outline-none shadow-sm" />
          </div>

          <!-- Max Entities in Context -->
          <div>
            <label class="text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1.5 block">Max Entities in Context</label>
            <p class="text-[10px] text-neutral-400 mb-2">Maximum number of KG entities to include per message.</p>
            <input id="memMaxEntities" type="number" min="1" max="30" value="${maxEntities}"
              class="w-20 bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300 focus:outline-none shadow-sm" />
          </div>

          <!-- Summarize After N Messages -->
          <div>
            <label class="text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1.5 block">Summarize After</label>
            <p class="text-[10px] text-neutral-400 mb-2">Number of messages before generating a conversation summary.</p>
            <div class="flex items-center gap-2">
              <input id="memSummarizeAfter" type="number" min="5" max="50" value="${summarizeAfter}"
                class="w-20 bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300 focus:outline-none shadow-sm" />
              <span class="text-xs text-neutral-400">messages</span>
            </div>
          </div>

          <!-- Embedding Model -->
          <div>
            <label class="text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1.5 block">Embedding Model</label>
            <p class="text-[10px] text-neutral-400 mb-2">Model used for vector search (downloaded automatically via Settings → Models).</p>
            <input id="memEmbeddingModel" type="text" value="${embeddingModel}" placeholder="nomic-embed-text"
              class="w-full bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300 placeholder-neutral-400 focus:outline-none shadow-sm font-mono" />
          </div>

          <!-- Save Button -->
          <div class="pt-2 border-t border-neutral-200/40 dark:border-neutral-700/40">
            <button id="memSaveBtn" class="w-full px-4 py-2.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm">
              Save Memory Settings
            </button>
            <p id="memSaveStatus" class="text-xs text-emerald-600 text-center mt-2 hidden">Settings saved — restart app to apply</p>
          </div>

          <!-- Danger Zone -->
          <div class="pt-4 border-t border-neutral-200/40 dark:border-neutral-700/40">
            <p class="text-xs font-medium text-red-500 uppercase tracking-wider mb-2">Danger Zone</p>
            <button id="memClearBtn" class="px-4 py-2 rounded-lg bg-red-900/80 hover:bg-red-800 text-sm font-medium text-red-100 transition-all shadow-sm">
              Clear All Memory
            </button>
            <p class="text-[10px] text-neutral-400 mt-1">Permanently deletes all stored entities, facts, relationships, and summaries.</p>
          </div>
        </div>
      </section>
    `;

    this._bindMemoryTab(content);
  },

  _bindMemoryTab(content) {
    // Token budget slider
    const slider = content.querySelector('#memTokenBudget');
    const sliderValue = content.querySelector('#memTokenBudgetValue');
    slider.addEventListener('input', () => {
      sliderValue.textContent = `${slider.value} tokens`;
    });

    // Extraction toggle
    const toggle = content.querySelector('#memExtractionToggle');
    toggle.addEventListener('click', () => {
      const isOn = toggle.getAttribute('aria-checked') === 'true';
      const newState = !isOn;
      toggle.setAttribute('aria-checked', String(newState));
      toggle.className = `relative w-10 h-5 rounded-full transition-colors ${newState ? 'bg-purple-500' : 'bg-neutral-200 dark:bg-neutral-700'}`;
      toggle.querySelector('span').className = `absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${newState ? 'translate-x-5' : ''}`;
    });

    // Save button
    content.querySelector('#memSaveBtn').addEventListener('click', async () => {
      const extractionOn = content.querySelector('#memExtractionToggle').getAttribute('aria-checked') === 'true';
      await window.api.settings.set('cortex-lite.tokenBudget', parseInt(slider.value));
      await window.api.settings.set('cortex-lite.extractionEnabled', extractionOn);
      await window.api.settings.set('cortex-lite.maxFactsInContext', parseInt(content.querySelector('#memMaxFacts').value));
      await window.api.settings.set('cortex-lite.maxEntitiesInContext', parseInt(content.querySelector('#memMaxEntities').value));
      await window.api.settings.set('cortex-lite.summarizeAfterMessages', parseInt(content.querySelector('#memSummarizeAfter').value));
      await window.api.settings.set('cortex-lite.embeddingModel', content.querySelector('#memEmbeddingModel').value.trim());

      const status = content.querySelector('#memSaveStatus');
      status.classList.remove('hidden');
      setTimeout(() => status.classList.add('hidden'), 3000);
    });

    // Clear memory button
    content.querySelector('#memClearBtn').addEventListener('click', async () => {
      if (!confirm('Are you sure you want to clear all memory? This cannot be undone.')) return;
      await window.api.settings.set('cortex-lite.clearRequested', true);
      alert('Memory will be cleared on next restart.');
    });
  },

  // ─── Plugins Tab ──────────────────────────────────────────────────────────
  _renderPluginsTab(content) {
    content.innerHTML = `
      <!-- AI-Generated Plugins Section -->
      <section class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-5 shadow-[0_2px_10px_rgb(0,0,0,0.02)] dark:shadow-[0_2px_10px_rgb(0,0,0,0.2)] backdrop-blur-md">
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-2">
            <div class="p-2 bg-white dark:bg-neutral-800 rounded-xl border border-neutral-100 dark:border-neutral-800 shadow-sm text-neutral-700 dark:text-neutral-300"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg></div>
            <div>
              <h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">My Plugins</h3>
              <p class="text-xs text-neutral-500 dark:text-neutral-400">Plugins you've built with AI</p>
            </div>
          </div>
        </div>
        <div id="aiPluginsList" class="space-y-2">
          <p class="text-xs text-neutral-400">Loading...</p>
        </div>
      </section>

      <!-- Installed/Official Plugins Section -->
      <section class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-5 shadow-[0_2px_10px_rgb(0,0,0,0.02)] dark:shadow-[0_2px_10px_rgb(0,0,0,0.2)] backdrop-blur-md">
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-2">
            <div class="p-2 bg-white dark:bg-neutral-800 rounded-xl border border-neutral-100 dark:border-neutral-800 shadow-sm text-neutral-700 dark:text-neutral-300"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="M9 8v3M15 8v3M8 11h8v2a4 4 0 0 1-8 0v-2z"/></svg></div>
            <div>
              <h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Installed Plugins</h3>
              <p class="text-xs text-neutral-500 dark:text-neutral-400">Official and third-party add-ons</p>
            </div>
          </div>
          <button id="installPluginBtn" class="px-4 py-2 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm flex items-center gap-2"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12h8M12 8v8"/></svg> Install</button>
        </div>
        <div id="pluginsList" class="space-y-2">
          <p class="text-xs text-neutral-400">Loading...</p>
        </div>
        <p id="pluginsDir" class="text-[10px] text-neutral-400 mt-3"></p>
      </section>
    `;

    this._loadPlugins(content);
  },

  // ─── Integrations Tab (MCP) ──────────────────────────────────────────────
  async _renderIntegrationsTab(content) {
    const googleStatus = await window.api.google.status();

    content.innerHTML = `
      <!-- Google Workspace One-Click Connect -->
      <section class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-5 shadow-[0_2px_10px_rgb(0,0,0,0.02)] dark:shadow-[0_2px_10px_rgb(0,0,0,0.2)] backdrop-blur-md mb-4">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="p-2 bg-white dark:bg-neutral-800 rounded-xl border border-neutral-100 dark:border-neutral-800 shadow-sm">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
            </div>
            <div>
              <div class="text-sm font-medium text-neutral-900 dark:text-neutral-100">Google Workspace</div>
              <div class="text-xs text-neutral-500 dark:text-neutral-400">Gmail, Calendar, Drive, Docs, Sheets</div>
              ${googleStatus.connected ? `<div class="text-[10px] text-emerald-600 dark:text-emerald-400 mt-0.5 font-medium">Connected • ${googleStatus.toolCount} tools available</div>` : ''}
            </div>
          </div>
          <div>
            ${!googleStatus.hasCredentials
              ? `<span class="text-xs text-neutral-400 italic">Not available in this build</span>`
              : googleStatus.connected
                ? `<button id="googleDisconnectBtn" class="px-4 py-2 rounded-lg border border-neutral-200/50 dark:border-neutral-600/50 bg-white/60 dark:bg-neutral-700/60 text-sm font-medium text-neutral-600 dark:text-neutral-300 hover:bg-white/90 dark:hover:bg-neutral-700/90 transition-all">Disconnect</button>`
                : `<button id="googleConnectBtn" class="px-4 py-2 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm">Connect Google</button>`
            }
          </div>
        </div>
      </section>

      <!-- Action Steps -->
      <section class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-5 shadow-[0_2px_10px_rgb(0,0,0,0.02)] dark:shadow-[0_2px_10px_rgb(0,0,0,0.2)] backdrop-blur-md mb-4">
        <div class="flex items-center gap-2 mb-4">
          <div class="p-2 bg-white dark:bg-neutral-800 rounded-xl border border-neutral-100 dark:border-neutral-800 shadow-sm text-neutral-700 dark:text-neutral-300">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></svg>
          </div>
          <div>
            <h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Max Action Steps</h3>
            <p class="text-xs text-neutral-500 dark:text-neutral-400">How many consecutive actions the AI can take before pausing</p>
          </div>
        </div>
        <div class="space-y-3">
          <div class="flex items-center gap-4">
            <input id="maxActionStepsSlider" type="range" min="1" max="25" step="1" value="10"
              class="flex-1 h-2 bg-neutral-200 dark:bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-neutral-900 dark:accent-neutral-100" />
            <span id="maxActionStepsValue" class="text-sm font-mono font-medium text-neutral-700 dark:text-neutral-300 min-w-[2.5rem] text-right">10</span>
          </div>
          <div class="flex justify-between text-[10px] text-neutral-400 px-0.5">
            <span>1 (always pause)</span>
            <span>25 (maximum autonomy)</span>
          </div>
          <p class="text-[10px] text-neutral-400 leading-relaxed">When the AI needs multiple steps to complete a task (e.g. search → read → write), it will chain them automatically up to this limit. Higher values allow more complex tasks to complete in one go but use more tokens.</p>
        </div>
      </section>

      <!-- MCP Servers (Advanced) -->
      <section class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-5 shadow-[0_2px_10px_rgb(0,0,0,0.02)] dark:shadow-[0_2px_10px_rgb(0,0,0,0.2)] backdrop-blur-md">
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-2">
            <div class="p-2 bg-white dark:bg-neutral-800 rounded-xl border border-neutral-100 dark:border-neutral-800 shadow-sm text-neutral-700 dark:text-neutral-300">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            </div>
            <div>
              <h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Other Integrations</h3>
              <p class="text-xs text-neutral-500 dark:text-neutral-400">Connect additional MCP servers</p>
            </div>
          </div>
          <button id="addMCPServerBtn" class="px-4 py-2 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12h8M12 8v8"/></svg> Add
          </button>
        </div>
        <div id="mcpServersList" class="space-y-3">
          <p class="text-xs text-neutral-400">Loading...</p>
        </div>
      </section>
    `;

    // Bind Google Connect/Disconnect
    const connectBtn = content.querySelector('#googleConnectBtn');
    if (connectBtn) {
      connectBtn.addEventListener('click', async () => {
        connectBtn.disabled = true;
        connectBtn.textContent = 'Connecting...';
        const result = await window.api.google.connect();
        if (result.success) {
          await this._renderIntegrationsTab(content);
        } else {
          connectBtn.textContent = 'Failed';
          connectBtn.title = result.error;
          setTimeout(() => this._renderIntegrationsTab(content), 2000);
        }
      });
    }

    const disconnectBtn = content.querySelector('#googleDisconnectBtn');
    if (disconnectBtn) {
      disconnectBtn.addEventListener('click', async () => {
        await window.api.google.disconnect();
        await this._renderIntegrationsTab(content);
      });
    }

    await this._loadMCPServers(content);

    // Bind max action steps slider
    const stepsSlider = content.querySelector('#maxActionStepsSlider');
    const stepsValue = content.querySelector('#maxActionStepsValue');
    if (stepsSlider) {
      const savedSteps = await window.api.settings.get('integrations.maxActionSteps');
      const currentSteps = savedSteps || 10;
      stepsSlider.value = currentSteps;
      stepsValue.textContent = currentSteps;

      stepsSlider.addEventListener('input', () => {
        stepsValue.textContent = stepsSlider.value;
      });
      stepsSlider.addEventListener('change', async () => {
        await window.api.settings.set('integrations.maxActionSteps', parseInt(stepsSlider.value, 10));
      });
    }

    // Bind "Add" button
    const addBtn = content.querySelector('#addMCPServerBtn');
    if (addBtn) {
      addBtn.addEventListener('click', () => this._showAddMCPServerDialog(content));
    }
  },

  _showAddMCPServerDialog(settingsContainer) {
    const existing = document.getElementById('mcp-add-dialog');
    if (existing) existing.remove();

    const dialog = document.createElement('div');
    dialog.id = 'mcp-add-dialog';
    dialog.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm';
    dialog.innerHTML = `
      <div class="bg-white/90 dark:bg-neutral-800/90 backdrop-blur-xl border border-neutral-200/60 dark:border-neutral-700/60 rounded-2xl p-6 w-full max-w-md shadow-xl">
        <h3 class="text-base font-semibold text-neutral-900 dark:text-neutral-100 mb-4">Add MCP Server</h3>
        <p class="text-xs text-neutral-500 dark:text-neutral-400 mb-4">Connect any community MCP server. Find servers at <span class="font-medium text-neutral-700 dark:text-neutral-300">mcpservers.org</span> or the official MCP GitHub registry.</p>
        <div class="space-y-3">
          <div>
            <label class="text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1 block">Name</label>
            <input id="mcpAddName" type="text" placeholder="e.g. GitHub" class="w-full bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-4 py-2.5 text-sm text-neutral-700 dark:text-neutral-200 placeholder-neutral-400 focus:outline-none" />
          </div>
          <div>
            <label class="text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1 block">Command</label>
            <input id="mcpAddCommand" type="text" placeholder="e.g. npx" class="w-full bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-4 py-2.5 text-sm text-neutral-700 dark:text-neutral-200 placeholder-neutral-400 focus:outline-none font-mono" />
          </div>
          <div>
            <label class="text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1 block">Arguments <span class="text-neutral-400 font-normal">(space-separated)</span></label>
            <input id="mcpAddArgs" type="text" placeholder="e.g. -y @modelcontextprotocol/server-github" class="w-full bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-4 py-2.5 text-sm text-neutral-700 dark:text-neutral-200 placeholder-neutral-400 focus:outline-none font-mono" />
          </div>
          <div>
            <label class="text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1 block">Environment Variables <span class="text-neutral-400 font-normal">(optional, KEY=VALUE per line)</span></label>
            <textarea id="mcpAddEnv" rows="2" placeholder="GITHUB_TOKEN=ghp_xxx&#10;API_KEY=abc123" class="w-full bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-4 py-2.5 text-sm text-neutral-700 dark:text-neutral-200 placeholder-neutral-400 focus:outline-none font-mono resize-none"></textarea>
          </div>
        </div>
        <div id="mcpAddError" class="text-xs text-rose-500 mt-2 hidden"></div>
        <div class="flex items-center justify-end gap-2 mt-5">
          <button id="mcpAddCancel" class="px-4 py-2 rounded-lg bg-white/60 dark:bg-neutral-700/60 border border-neutral-200/50 dark:border-neutral-600/50 text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:bg-white/90 dark:hover:bg-neutral-700/90 transition-all">Cancel</button>
          <button id="mcpAddSave" class="px-4 py-2 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm">Add Server</button>
        </div>
      </div>
    `;
    document.body.appendChild(dialog);

    // Close on backdrop click
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.remove(); });
    dialog.querySelector('#mcpAddCancel').addEventListener('click', () => dialog.remove());

    dialog.querySelector('#mcpAddSave').addEventListener('click', async () => {
      const name = dialog.querySelector('#mcpAddName').value.trim();
      const command = dialog.querySelector('#mcpAddCommand').value.trim();
      const argsStr = dialog.querySelector('#mcpAddArgs').value.trim();
      const envStr = dialog.querySelector('#mcpAddEnv').value.trim();
      const errorEl = dialog.querySelector('#mcpAddError');

      if (!name || !command) {
        errorEl.textContent = 'Name and command are required.';
        errorEl.classList.remove('hidden');
        return;
      }

      // Parse args
      const args = argsStr ? argsStr.split(/\s+/) : [];

      // Parse env vars
      const env = {};
      if (envStr) {
        for (const line of envStr.split('\n')) {
          const eq = line.indexOf('=');
          if (eq > 0) {
            env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
          }
        }
      }

      // Generate ID from name
      const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

      await window.api.mcp.addServer(id, { name, command, args, env, description: `Custom: ${command} ${args.join(' ')}` });
      dialog.remove();
      await this._loadMCPServers(settingsContainer);
    });

    // Focus name input
    dialog.querySelector('#mcpAddName').focus();
  },

  async _loadMCPServers(container) {
    const list = container.querySelector('#mcpServersList');
    try {
      const servers = await window.api.mcp.getServers();
      // Filter out google-workspace (it has its own dedicated card above)
      const filteredEntries = Object.entries(servers || {}).filter(([id]) => id !== 'google-workspace');
      if (!filteredEntries.length) {
        list.innerHTML = '<p class="text-xs text-neutral-400 italic">No additional integrations configured.</p>';
        return;
      }

      list.innerHTML = filteredEntries.map(([id, s]) => {
        const statusColor = s.status === 'connected' ? 'bg-emerald-500' : s.status === 'error' ? 'bg-rose-500' : 'bg-neutral-300 dark:bg-neutral-600';
        const statusText = s.status === 'connected' ? `Connected • ${s.toolCount} tools` : s.status === 'error' ? `Error: ${s.error}` : 'Disconnected';
        return `
          <div class="flex items-center justify-between p-4 rounded-xl bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40">
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-2 h-2 rounded-full ${statusColor} flex-shrink-0"></div>
              <div class="min-w-0">
                <div class="text-sm font-medium text-neutral-900 dark:text-neutral-100">${s.name}</div>
                <div class="text-xs text-neutral-500 dark:text-neutral-400">${s.description || ''}</div>
                <div class="text-[10px] text-neutral-400 dark:text-neutral-500 mt-0.5">${statusText}</div>
              </div>
            </div>
            <div class="flex items-center gap-2 flex-shrink-0">
              ${s.status === 'connected'
                ? `<button class="mcp-disconnect text-xs px-3 py-1.5 rounded-lg border border-neutral-200/50 dark:border-neutral-600/50 bg-white/60 dark:bg-neutral-700/60 text-neutral-600 dark:text-neutral-300 hover:bg-white/90 dark:hover:bg-neutral-700/90 transition-all font-medium" data-id="${id}">Disconnect</button>`
                : `<button class="mcp-connect text-xs px-3 py-1.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm font-medium" data-id="${id}">Connect</button>`
              }
              <button class="mcp-remove text-neutral-300 hover:text-rose-500 transition-colors p-1" data-id="${id}" title="Remove integration">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            </div>
          </div>
        `;
      }).join('');

      // Bind connect buttons
      list.querySelectorAll('.mcp-connect').forEach(btn => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          btn.textContent = 'Connecting...';
          const result = await window.api.mcp.connect(btn.dataset.id);
          if (result?.success) {
            await this._loadMCPServers(container);
          } else {
            btn.textContent = 'Failed';
            setTimeout(() => this._loadMCPServers(container), 2000);
          }
        });
      });

      // Bind disconnect buttons
      list.querySelectorAll('.mcp-disconnect').forEach(btn => {
        btn.addEventListener('click', async () => {
          await window.api.mcp.disconnect(btn.dataset.id);
          await this._loadMCPServers(container);
        });
      });

      // Bind remove buttons
      list.querySelectorAll('.mcp-remove').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (confirm('Remove this integration?')) {
            await window.api.mcp.removeServer(btn.dataset.id);
            await this._loadMCPServers(container);
          }
        });
      });
    } catch (err) {
      list.innerHTML = `<p class="text-xs text-rose-500">${err.message}</p>`;
    }
  },

  // ─── Shared Helpers ────────────────────────────────────────────────────────

  async _bindAdvancedOptions(container) {
    const toggle = container.querySelector('#advancedToggle');
    const panel = container.querySelector('#advancedPanel');
    const chevron = container.querySelector('#advancedChevron');
    const webSearchToggle = container.querySelector('#webSearchToggle');
    const webSearchDot = container.querySelector('#webSearchDot');
    const contextWindowSelect = container.querySelector('#contextWindowSelect');
    const keepAliveSelect = container.querySelector('#keepAliveSelect');
    const modelLocationPath = container.querySelector('#modelLocationPath');
    const openModelLocationBtn = container.querySelector('#openModelLocationBtn');
    const saveAdvancedBtn = container.querySelector('#saveAdvancedBtn');
    const advancedSaveStatus = container.querySelector('#advancedSaveStatus');

    // Toggle panel
    toggle.addEventListener('click', () => {
      panel.classList.toggle('hidden');
      chevron.style.transform = panel.classList.contains('hidden') ? '' : 'rotate(180deg)';
    });

    // Load saved settings
    const savedWebSearch = await window.api.settings.get('local.webSearchEnabled');
    const savedContextWindow = await window.api.settings.get('local.contextWindow');

    // Web Search toggle state
    let webSearchEnabled = savedWebSearch || false;
    const updateWebSearchUI = () => {
      if (webSearchEnabled) {
        webSearchToggle.classList.remove('bg-neutral-200', 'dark:bg-neutral-700');
        webSearchToggle.classList.add('bg-neutral-900', 'dark:bg-neutral-100');
        webSearchToggle.setAttribute('aria-checked', 'true');
        webSearchDot.style.transform = 'translateX(20px)';
      } else {
        webSearchToggle.classList.remove('bg-neutral-900', 'dark:bg-neutral-100');
        webSearchToggle.classList.add('bg-neutral-200', 'dark:bg-neutral-700');
        webSearchToggle.setAttribute('aria-checked', 'false');
        webSearchDot.style.transform = 'translateX(0)';
      }
    };
    updateWebSearchUI();

    webSearchToggle.addEventListener('click', () => {
      webSearchEnabled = !webSearchEnabled;
      updateWebSearchUI();
    });

    // Context window
    if (savedContextWindow) {
      contextWindowSelect.value = String(savedContextWindow);
    } else {
      contextWindowSelect.value = '4096';
    }

    // Keep alive (memory unload timer)
    const savedKeepAlive = await window.api.settings.get('engine.keepAlive');
    keepAliveSelect.value = savedKeepAlive || '2m';

    // Model storage location
    try {
      const location = await window.api.engine.getModelsDir();
      modelLocationPath.textContent = location || '~/.iimagine/models';
      modelLocationPath.title = location || '~/.iimagine/models';
    } catch {
      modelLocationPath.textContent = '~/.iimagine/models';
    }

    openModelLocationBtn.addEventListener('click', async () => {
      const modelsDir = await window.api.engine.getModelsDir();
      if (modelsDir) window.api.shell.openPath(modelsDir);
    });

    // Save all advanced settings
    saveAdvancedBtn.addEventListener('click', async () => {
      const ctxWindow = parseInt(contextWindowSelect.value);
      const keepAlive = keepAliveSelect.value;

      await window.api.settings.set('local.webSearchEnabled', webSearchEnabled);
      await window.api.settings.set('local.contextWindow', ctxWindow);
      await window.api.settings.set('engine.keepAlive', keepAlive);

      advancedSaveStatus.classList.remove('hidden');
      setTimeout(() => advancedSaveStatus.classList.add('hidden'), 2000);
    });
  },
  async _loadPlugins(container) {
    const pluginsList = container.querySelector('#pluginsList');
    const aiPluginsList = container.querySelector('#aiPluginsList');
    const pluginsDir = container.querySelector('#pluginsDir');
    const installBtn = container.querySelector('#installPluginBtn');

    try {
      const plugins = await window.api.plugins.list();
      const dir = await window.api.plugins.getDir();
      pluginsDir.textContent = `Plugin directory: ${dir}`;

      // Split into AI-generated and official/bundled
      const aiPlugins = plugins.filter(p => p.author === 'ai-generated');
      const officialPlugins = plugins.filter(p => p.author !== 'ai-generated');

      // Render AI-generated plugins
      if (!aiPlugins.length) {
        aiPluginsList.innerHTML = '<p class="text-xs text-neutral-400 italic">No AI-generated plugins yet. Use the Builder button in chat to create one.</p>';
      } else {
        aiPluginsList.innerHTML = aiPlugins.map(p => `
          <div class="flex items-center justify-between py-2.5 px-3 rounded-2xl bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 backdrop-blur-md">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="text-sm font-medium text-neutral-900 dark:text-neutral-100">${p.name}</span>
                <span class="text-[10px] text-neutral-400">v${p.version}</span>
                ${p.error ? '<span class="text-[10px] text-rose-500 font-medium">⚠ Error</span>' : ''}
              </div>
              <p class="text-xs text-neutral-500 dark:text-neutral-400">${p.description || ''}</p>
            </div>
            <div class="flex items-center gap-2 ml-2">
              <button class="plugin-toggle text-xs px-3 py-1.5 rounded-lg border font-medium transition-all ${p.enabled ? 'bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 border-neutral-900 dark:border-neutral-100' : 'bg-white/60 dark:bg-neutral-700/60 text-neutral-500 dark:text-neutral-400 border-neutral-200/50 dark:border-neutral-600/50'}" data-id="${p.id}" data-enabled="${p.enabled}">
                ${p.enabled ? 'Active' : 'Inactive'}
              </button>
              <button class="plugin-edit text-xs px-2 py-1.5 rounded-lg bg-white/60 dark:bg-neutral-700/60 border border-neutral-200/50 dark:border-neutral-600/50 text-neutral-600 dark:text-neutral-300 hover:bg-white/90 dark:hover:bg-neutral-700/90 transition-all" data-id="${p.id}" title="Edit with AI"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg></button>
              <button class="plugin-folder text-neutral-300 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors p-1" data-id="${p.id}" title="Open plugin folder"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></button>
              <button class="plugin-remove text-neutral-300 hover:text-rose-500 transition-colors p-1" data-id="${p.id}" title="Delete plugin"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
            </div>
          </div>
        `).join('');

        // Bind AI plugin buttons
        aiPluginsList.querySelectorAll('.plugin-toggle').forEach(btn => {
          btn.addEventListener('click', async () => {
            const newState = btn.dataset.enabled !== 'true';
            await window.api.plugins.setEnabled(btn.dataset.id, newState);
            this._loadPlugins(container);
            await window.loadPluginSidebarItems?.();
          });
        });

        aiPluginsList.querySelectorAll('.plugin-edit').forEach(btn => {
          btn.addEventListener('click', () => {
            if (window.BuilderMode) window.BuilderMode.enter(btn.dataset.id);
          });
        });

        aiPluginsList.querySelectorAll('.plugin-folder').forEach(btn => {
          btn.addEventListener('click', async () => {
            await window.api.plugins.openFolder(btn.dataset.id);
          });
        });

        aiPluginsList.querySelectorAll('.plugin-remove').forEach(btn => {
          btn.addEventListener('click', async () => {
            if (confirm(`Delete "${btn.dataset.id}" plugin and all its data?`)) {
              await window.api.plugins.uninstall(btn.dataset.id);
              this._loadPlugins(container);
              await window.loadPluginSidebarItems?.();
            }
          });
        });
      }

      // Render official/bundled plugins
      if (!officialPlugins.length) {
        pluginsList.innerHTML = '<p class="text-xs text-neutral-400 italic">No installed plugins.</p>';
      } else {
        pluginsList.innerHTML = officialPlugins.map(p => `
          <div class="flex items-center justify-between py-2 px-2 rounded-2xl ${p.enabled ? 'bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 backdrop-blur-md' : ''}">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="text-sm font-medium text-neutral-900 dark:text-neutral-100">${p.name}</span>
                <span class="text-[10px] text-neutral-400">v${p.version}</span>
              </div>
              <p class="text-xs text-neutral-500">${p.description || ''}</p>
              ${p.author ? `<p class="text-[10px] text-neutral-400">by ${p.author}</p>` : ''}
            </div>
            <div class="flex items-center gap-2 ml-2">
              <button class="plugin-toggle text-xs px-3 py-1 rounded-lg border ${p.enabled ? 'bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 border-neutral-900 dark:border-neutral-100' : 'bg-white/60 dark:bg-neutral-700/60 text-neutral-500 dark:text-neutral-400 border-neutral-200/50 dark:border-neutral-600/50'}" data-id="${p.id}" data-enabled="${p.enabled}">
                ${p.enabled ? 'Active' : 'Inactive'}
              </button>
              <button class="plugin-remove text-xs text-neutral-300 hover:text-rose-600 px-1" data-id="${p.id}" title="Uninstall — removes plugin files"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
            </div>
          </div>
        `).join('');

        pluginsList.querySelectorAll('.plugin-toggle').forEach(btn => {
          btn.addEventListener('click', async () => {
            const newState = btn.dataset.enabled !== 'true';
            await window.api.plugins.setEnabled(btn.dataset.id, newState);
            this._loadPlugins(container);
            await window.loadPluginSidebarItems?.();
          });
        });

        pluginsList.querySelectorAll('.plugin-remove').forEach(btn => {
          btn.addEventListener('click', async () => {
            if (confirm('Uninstall this plugin?')) {
              await window.api.plugins.uninstall(btn.dataset.id);
              this._loadPlugins(container);
            }
          });
        });
      }
    } catch (err) {
      pluginsList.innerHTML = `<p class="text-xs text-rose-600">${err.message}</p>`;
    }

    installBtn?.addEventListener('click', async () => {
      const result = await window.api.plugins.install();
      if (!result.canceled) {
        this._loadPlugins(container);
      }
    });
  },

  _renderModels(container, models) {
    if (!models.length) {
      container.innerHTML = '<p class="text-xs text-neutral-400 italic">No models installed. Use "Find the right model for you" below to download one.</p>';
      return;
    }

    container.innerHTML = models.map(m => {
      const sizeGB = m.sizeGB || (m.size ? (m.size / 1e9).toFixed(1) : '?');
      const isActive = window.ProviderManager.activeProvider?.name === m.name;
      const isHidden = window.ProviderManager.isModelHidden(m.name);
      return `
        <div class="flex items-center justify-between py-1.5 px-2 rounded-2xl ${isActive ? 'bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 backdrop-blur-md' : ''} ${isHidden ? 'opacity-50' : ''}">
          <div class="flex items-center gap-2">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="${isHidden ? 'text-neutral-300' : 'text-emerald-500'}"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"/></svg>
            <span class="text-sm ${isHidden ? 'text-neutral-400 line-through' : 'text-neutral-900 dark:text-neutral-100'}">${m.name}</span>
            <span class="text-xs text-neutral-400">${sizeGB}GB</span>
          </div>
          <div class="flex items-center gap-2">
            ${isActive ? '<span class="text-xs text-emerald-600 font-medium">Active</span>' : ''}
            <button class="model-toggle-btn text-neutral-300 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors" data-model="${m.name}" title="${isHidden ? 'Activate — load into memory' : 'Deactivate — unload from memory'}">
              ${isHidden
                ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
                : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'
              }
            </button>
            <button class="model-delete-btn text-neutral-300 hover:text-rose-500 transition-colors" data-filename="${m.filename || m.name}" title="Delete model">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </div>
      `;
    }).join('');

    // Bind toggle visibility buttons
    container.querySelectorAll('.model-toggle-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const modelName = btn.dataset.model;
        const wasHidden = window.ProviderManager.isModelHidden(modelName);
        await window.ProviderManager.toggleModelVisibility(modelName);

        window.AppRouter?.updateModelDropdown();
        const status = await window.ProviderManager.getLocalStatus();
        this._renderModels(container, status.models || []);
      });
    });

    // Bind delete buttons
    container.querySelectorAll('.model-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const filename = btn.dataset.filename;
        const displayName = filename.replace('.gguf', '');
        if (!confirm(`Delete "${displayName}"?\n\nThis will permanently remove the model from your computer and free up disk space. You will need to re-download it if you want to use it again.\n\nTip: Use the eye icon to hide a model from the dropdown without deleting it.`)) return;

        btn.innerHTML = '<span class="text-xs">...</span>';
        btn.disabled = true;

        const result = await window.api.engine.deleteModel(filename);
        if (result.success) {
          await window.ProviderManager.refreshLocal();
          window.AppRouter?.updateModelDropdown();
          const status = await window.ProviderManager.getLocalStatus();
          this._renderModels(container, status.models || []);
        } else {
          btn.innerHTML = '<span class="text-xs text-rose-500">Error</span>';
          setTimeout(() => {
            btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
            btn.disabled = false;
          }, 2000);
        }
      });
    });
  },

  destroy() {
    if (this._pollInterval) {
      clearInterval(this._pollInterval);
      this._pollInterval = null;
    }
  }
};

window.SettingsPage = SettingsPage;
