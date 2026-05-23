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
            <button data-settings-tab="plugins" class="settings-tab-btn px-4 py-2 text-sm font-medium transition-all border-b-2">Plugins</button>
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
    else if (tab === 'plugins') this._renderPluginsTab(content);
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

            <!-- Network Connection -->
            <div>
              <label class="text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1.5 block">Network Connection</label>
              <p class="text-[10px] text-neutral-400 mb-2">Connect to a remote Ollama instance (e.g. another machine on your network).</p>
              <div class="flex gap-2">
                <input id="ollamaHostInput" type="text" placeholder="http://localhost:11434"
                  class="flex-1 bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300 placeholder-neutral-400 dark:placeholder-neutral-500 focus:bg-white/90 dark:focus:bg-neutral-800/90 focus:outline-none transition-all shadow-sm font-mono" />
                <button id="testConnectionBtn" class="px-3 py-2 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-xs font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm">Test</button>
              </div>
              <p id="connectionStatus" class="text-[10px] mt-1.5 hidden"></p>
            </div>

            <!-- Model Storage Location -->
            <div>
              <label class="text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1.5 block">Model Storage Location</label>
              <p class="text-[10px] text-neutral-400 mb-2">Where Ollama stores downloaded models on disk.</p>
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

        <!-- Install engine button (shown when Ollama not found) -->
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

        <!-- Advanced Ollama Settings mount point -->
        <div id="advancedOllamaMount"></div>

        <!-- Runtime Monitor mount point -->
        <div id="runtimeMonitorMount"></div>
      </section>

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

    // ── Advanced Ollama Settings (GPU, threads, keep alive) ──────
    const advOllamaMount = content.querySelector('#advancedOllamaMount');
    if (advOllamaMount && window.AdvancedOllamaSettings) {
      window.AdvancedOllamaSettings.mount(advOllamaMount);
    }

    // ── Runtime Monitor (loaded models status) ───────────────────
    const runtimeMount = content.querySelector('#runtimeMonitorMount');
    if (runtimeMount && window.RuntimeMonitor) {
      window.RuntimeMonitor.mount(runtimeMount);
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
      const status = await window.ProviderManager.getOllamaStatus();
      if (status.running) {
        engineStatusBadge.textContent = 'Running';
        engineStatusBadge.className = 'text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100';
        installSection.classList.add('hidden');
        modelSection.classList.remove('hidden');
        this._renderModels(modelList, status.models || []);
      } else {
        engineStatusBadge.textContent = 'Not installed';
        engineStatusBadge.className = 'text-xs px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-100';
        installSection.classList.remove('hidden');
        modelSection.classList.add('hidden');
      }
    };

    await updateStatus();

    // Poll status while on models tab
    this._pollInterval = setInterval(updateStatus, 5000);

    // Install engine
    installEngineBtn.addEventListener('click', async () => {
      installEngineBtn.disabled = true;
      installEngineBtn.textContent = 'Installing...';
      installProgress.classList.remove('hidden');
      installProgress.textContent = 'Downloading and installing AI engine...';

      try {
        const result = await window.api.ollama.install();
        if (result.success) {
          installProgress.textContent = 'Installed. Starting engine...';
          await new Promise(r => setTimeout(r, 3000));
          await updateStatus();
          await window.ProviderManager.refreshLocal();
        } else {
          installProgress.textContent = `Error: ${result.error}`;
          installEngineBtn.disabled = false;
          installEngineBtn.textContent = 'Install AI Engine';
        }
      } catch (err) {
        installProgress.textContent = `Error: ${err.message}`;
        installEngineBtn.disabled = false;
        installEngineBtn.textContent = 'Install AI Engine';
      }
    });

    // Cancel download button
    cancelPullBtn.addEventListener('click', async () => {
      await window.api.ollama.cancelPull();
    });

    // Pull progress listener
    window.api.ollama.onPullProgress((data) => {
      if (!pullProgress) return;
      pullProgress.classList.remove('hidden');

      if (data.total && data.completed) {
        const pct = Math.round((data.completed / data.total) * 100);
        pullProgressBar.style.width = pct + '%';
        const downloadedMB = (data.completed / 1e6).toFixed(0);
        const totalMB = (data.total / 1e6).toFixed(0);
        pullProgressText.textContent = `${data.status || 'Downloading'} — ${downloadedMB}MB / ${totalMB}MB (${pct}%)`;
      } else {
        pullProgressText.textContent = data.status || 'Processing...';
      }
    });

    window.api.ollama.onPullDone(async (data) => {
      if (data.success) {
        pullProgressBar.style.width = '100%';
        pullProgressText.textContent = 'Model installed.';
        await window.ProviderManager.refreshLocal();
        await updateStatus();
        window.AppRouter?.updateModelDropdown();

        setTimeout(() => {
          pullProgress.classList.add('hidden');
        }, 1500);
      } else {
        pullProgressText.textContent = data.error === 'Download cancelled' ? 'Download cancelled.' : `Error: ${data.error}`;
        setTimeout(() => {
          pullProgress.classList.add('hidden');
        }, 2000);
      }

      // Reset custom download button state
      if (window.ModelBrowser) {
        // Re-render model browser to reflect new installed state
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
            <p class="text-[10px] text-neutral-400 mb-2">Local Ollama model used for vector search. Must be pulled separately.</p>
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
      <section class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-5 shadow-[0_2px_10px_rgb(0,0,0,0.02)] dark:shadow-[0_2px_10px_rgb(0,0,0,0.2)] backdrop-blur-md">
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-2">
            <div class="p-2 bg-white dark:bg-neutral-800 rounded-xl border border-neutral-100 dark:border-neutral-800 shadow-sm text-neutral-700 dark:text-neutral-300"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="M9 8v3M15 8v3M8 11h8v2a4 4 0 0 1-8 0v-2z"/></svg></div>
            <div>
              <h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Plugins</h3>
              <p class="text-xs text-neutral-500 dark:text-neutral-400">Extend functionality with add-ons</p>
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

  // ─── Shared Helpers ────────────────────────────────────────────────────────

  async _bindAdvancedOptions(container) {
    const toggle = container.querySelector('#advancedToggle');
    const panel = container.querySelector('#advancedPanel');
    const chevron = container.querySelector('#advancedChevron');
    const webSearchToggle = container.querySelector('#webSearchToggle');
    const webSearchDot = container.querySelector('#webSearchDot');
    const contextWindowSelect = container.querySelector('#contextWindowSelect');
    const keepAliveSelect = container.querySelector('#keepAliveSelect');
    const ollamaHostInput = container.querySelector('#ollamaHostInput');
    const testConnectionBtn = container.querySelector('#testConnectionBtn');
    const connectionStatus = container.querySelector('#connectionStatus');
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
    const savedOllamaHost = await window.api.settings.get('local.ollamaHost');

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
    const savedKeepAlive = await window.api.settings.get('ollama.keepAlive');
    keepAliveSelect.value = savedKeepAlive || '2m';

    // Ollama host
    ollamaHostInput.value = savedOllamaHost || 'http://localhost:11434';

    // Test connection
    testConnectionBtn.addEventListener('click', async () => {
      const host = ollamaHostInput.value.trim() || 'http://localhost:11434';
      testConnectionBtn.disabled = true;
      testConnectionBtn.textContent = '...';
      connectionStatus.classList.remove('hidden');
      connectionStatus.textContent = 'Testing connection...';
      connectionStatus.className = 'text-[10px] mt-1.5 text-neutral-500';

      try {
        const result = await window.api.ollama.testConnection(host);
        if (result.success) {
          connectionStatus.textContent = `Connected — ${result.models || 0} model(s) available`;
          connectionStatus.className = 'text-[10px] mt-1.5 text-emerald-600';
        } else {
          connectionStatus.textContent = `Failed: ${result.error}`;
          connectionStatus.className = 'text-[10px] mt-1.5 text-rose-600';
        }
      } catch (err) {
        connectionStatus.textContent = `Error: ${err.message}`;
        connectionStatus.className = 'text-[10px] mt-1.5 text-rose-600';
      }

      testConnectionBtn.disabled = false;
      testConnectionBtn.textContent = 'Test';
    });

    // Model storage location
    try {
      const location = await window.api.ollama.getModelLocation();
      modelLocationPath.textContent = location || '~/.ollama/models';
      modelLocationPath.title = location || '~/.ollama/models';
    } catch {
      modelLocationPath.textContent = '~/.ollama/models';
    }

    openModelLocationBtn.addEventListener('click', async () => {
      await window.api.ollama.openModelLocation();
    });

    // Save all advanced settings
    saveAdvancedBtn.addEventListener('click', async () => {
      const host = ollamaHostInput.value.trim() || 'http://localhost:11434';
      const ctxWindow = parseInt(contextWindowSelect.value);
      const keepAlive = keepAliveSelect.value;

      await window.api.settings.set('local.webSearchEnabled', webSearchEnabled);
      await window.api.settings.set('local.contextWindow', ctxWindow);
      await window.api.settings.set('local.ollamaHost', host);
      await window.api.settings.set('ollama.keepAlive', keepAlive);

      advancedSaveStatus.classList.remove('hidden');
      setTimeout(() => advancedSaveStatus.classList.add('hidden'), 2000);
    });
  },
  async _loadPlugins(container) {
    const pluginsList = container.querySelector('#pluginsList');
    const pluginsDir = container.querySelector('#pluginsDir');
    const installBtn = container.querySelector('#installPluginBtn');

    try {
      const plugins = await window.api.plugins.list();
      const dir = await window.api.plugins.getDir();
      pluginsDir.textContent = `Plugin directory: ${dir}`;

      if (!plugins.length) {
        pluginsList.innerHTML = '<p class="text-xs text-neutral-400 italic">No plugins installed. Drop a plugin folder into the plugins directory or click Install.</p>';
      } else {
        pluginsList.innerHTML = plugins.map(p => `
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
              <button class="plugin-toggle text-xs px-3 py-1 rounded-lg border ${p.enabled ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-white/60 text-neutral-500 border-neutral-200'}" data-id="${p.id}" data-enabled="${p.enabled}">
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
      const sizeGB = (m.size / 1e9).toFixed(1);
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
            <button class="model-delete-btn text-neutral-300 hover:text-rose-500 transition-colors" data-model="${m.name}" title="Delete model">
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

        // If we just disabled (hid) the model, unload it from memory to free resources
        if (!wasHidden) {
          btn.title = 'Unloading from memory...';
          await window.api.ollama.unload(modelName);
        }

        window.AppRouter?.updateModelDropdown();
        const status = await window.api.ollama.status();
        this._renderModels(container, status.models || []);
      });
    });

    // Bind delete buttons
    container.querySelectorAll('.model-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const modelName = btn.dataset.model;
        if (!confirm(`Delete "${modelName}"?\n\nThis will permanently remove the model from your computer and free up disk space. You will need to re-download it if you want to use it again.\n\nTip: Use the eye icon to hide a model from the dropdown without deleting it.`)) return;

        btn.innerHTML = '<span class="text-xs">...</span>';
        btn.disabled = true;

        const result = await window.api.ollama.delete(modelName);
        if (result.success) {
          await window.ProviderManager.refreshLocal();
          window.AppRouter?.updateModelDropdown();
          const status = await window.api.ollama.status();
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
