// Runtime Monitor — shows currently loaded AI engine status

const RuntimeMonitor = {
  _container: null,
  _pollInterval: null,
  _isOpen: false,

  /**
   * Mount the runtime monitor into a container element
   * @param {HTMLElement} container
   */
  mount(container) {
    this._container = container;
    this._render();
    this._bindEvents();
    // Auto-refresh once on mount to show current state
    this._refresh();
  },

  /** Start polling for running models (call when component becomes visible) */
  startPolling() {
    this._refresh();
    this._pollInterval = setInterval(() => this._refresh(), 5000);
  },

  /** Stop polling (call when component is hidden or unmounted) */
  stopPolling() {
    if (this._pollInterval) {
      clearInterval(this._pollInterval);
      this._pollInterval = null;
    }
  },

  _render() {
    this._container.innerHTML = `
      <div class="mt-4">
        <button id="runtimeToggle" class="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 hover:bg-white/70 dark:hover:bg-neutral-700/70 transition-all text-left group">
          <div class="flex items-center gap-2.5">
            <span class="text-base">📊</span>
            <div>
              <span class="text-sm font-medium text-neutral-900 dark:text-neutral-100">Runtime Status</span>
              <p id="runtimeSubtitle" class="text-[11px] text-neutral-500 dark:text-neutral-400">Checking...</p>
            </div>
          </div>
          <svg id="runtimeChevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-neutral-400 transition-transform"><polyline points="6 9 12 15 18 9"/></svg>
        </button>

        <div id="runtimePanel" class="hidden mt-3 px-1">
          <div id="runtimeContent" class="space-y-3">
            <p class="text-xs text-neutral-500 dark:text-neutral-400 italic">Loading...</p>
          </div>
        </div>
      </div>
    `;
  },

  _bindEvents() {
    const toggle = this._container.querySelector('#runtimeToggle');
    const panel = this._container.querySelector('#runtimePanel');
    const chevron = this._container.querySelector('#runtimeChevron');

    toggle?.addEventListener('click', () => {
      this._isOpen = !this._isOpen;
      panel.classList.toggle('hidden', !this._isOpen);
      chevron.style.transform = this._isOpen ? 'rotate(180deg)' : '';
      if (this._isOpen) {
        this.startPolling();
      } else {
        this.stopPolling();
      }
    });
  },

  async _refresh() {
    try {
      // Use localAI status (same as settings page engine status badge)
      const status = await window.api.localAI.status();
      // Also get engine state for running/currentModel info
      const engineState = await window.api.engine.status();
      console.log('[RuntimeMonitor] localAI:', JSON.stringify({ running: status.running, modelCount: status.models?.length }), 'engine:', JSON.stringify({ running: engineState.running, currentModel: engineState.currentModel?.split('/').pop() }));
      
      if (engineState.running && engineState.currentModel) {
        const modelFilename = engineState.currentModel.split('/').pop();
        const modelName = modelFilename.replace('.gguf', '');
        const loadedModel = (status.models || []).find(m => modelFilename === m.filename);
        const sizeGB = loadedModel ? loadedModel.sizeGB : null;
        this._renderRunning(modelName, sizeGB, engineState.port);
      } else if (status.models && status.models.length > 0) {
        this._renderIdle(status.models);
      } else {
        this._renderEmpty();
      }
    } catch (err) {
      console.warn('[RuntimeMonitor] Error:', err);
      this._renderEmpty();
    }
  },

  _renderRunning(modelName, sizeGB, port) {
    const content = this._container.querySelector('#runtimeContent');
    if (!content) return;

    // Update subtitle even when panel is collapsed
    const subtitle = this._container.querySelector('#runtimeSubtitle');
    if (subtitle) subtitle.textContent = `${modelName} loaded in memory`;

    const memoryLine = sizeGB ? `~${sizeGB}GB in memory` : 'Loaded in memory';

    content.innerHTML = `
      <div class="bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/40 dark:border-neutral-700/40 rounded-xl p-3 shadow-sm">
        <div class="flex items-start justify-between gap-2">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1">
              <span class="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0 animate-pulse"></span>
              <span class="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate">${modelName}</span>
            </div>
            <div class="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-neutral-500 dark:text-neutral-400">
              <span>${memoryLine}</span>
              <span>Port ${port || 8847}</span>
              <span class="text-emerald-600 dark:text-emerald-400">● Ready</span>
            </div>
          </div>
          <button id="stopEngineBtn" class="flex-shrink-0 px-2 py-1 rounded-lg text-[11px] font-medium text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800/40 hover:bg-rose-100 dark:hover:bg-rose-900/40 transition-all">
            Unload
          </button>
        </div>
      </div>
    `;

    const stopBtn = content.querySelector('#stopEngineBtn');
    if (stopBtn) {
      stopBtn.addEventListener('click', async () => {
        stopBtn.disabled = true;
        stopBtn.textContent = 'Unloading...';
        try {
          await window.api.engine.stop();
          setTimeout(() => this._refresh(), 500);
        } catch {
          stopBtn.textContent = 'Failed';
        }
      });
    }
  },

  _renderIdle(models) {
    const content = this._container.querySelector('#runtimeContent');
    if (!content) return;
    const subtitle = this._container.querySelector('#runtimeSubtitle');
    if (subtitle) subtitle.textContent = `${models.length} model${models.length > 1 ? 's' : ''} on disk · Idle`;
    const totalSize = models.reduce((sum, m) => sum + (m.sizeGB || 0), 0).toFixed(1);
    content.innerHTML = `
      <div class="flex items-center gap-2 py-3">
        <span class="w-2 h-2 rounded-full bg-neutral-300 dark:bg-neutral-600"></span>
        <div>
          <p class="text-xs text-neutral-500 dark:text-neutral-400">No model loaded in memory</p>
          <p class="text-[10px] text-neutral-400 dark:text-neutral-500 mt-0.5">${models.length} model${models.length > 1 ? 's' : ''} on disk (${totalSize}GB) · Engine starts automatically on first message</p>
        </div>
      </div>
    `;
  },

  _renderEmpty() {
    const content = this._container.querySelector('#runtimeContent');
    if (!content) return;
    const subtitle = this._container.querySelector('#runtimeSubtitle');
    if (subtitle) subtitle.textContent = 'No local models installed';
    content.innerHTML = `
      <div class="flex items-center gap-2 py-3">
        <span class="w-2 h-2 rounded-full bg-neutral-300 dark:bg-neutral-600"></span>
        <p class="text-xs text-neutral-500 dark:text-neutral-400">No local models installed</p>
      </div>
    `;
  },

  _formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) return `${gb.toFixed(1)} GB`;
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(0)} MB`;
  },

  _getCountdown(expiresAt) {
    if (!expiresAt) return '';
    try {
      const expires = new Date(expiresAt);
      const now = new Date();
      const diffMs = expires - now;
      if (diffMs <= 0) return 'expiring...';
      const mins = Math.floor(diffMs / 60000);
      if (mins < 60) return `${mins}m`;
      const hours = Math.floor(mins / 60);
      const remainMins = mins % 60;
      if (hours < 24) return `${hours}h ${remainMins}m`;
      return `${Math.floor(hours / 24)}d ${hours % 24}h`;
    } catch {
      return '';
    }
  },
};

window.RuntimeMonitor = RuntimeMonitor;
