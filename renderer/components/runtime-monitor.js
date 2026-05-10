// Runtime Monitor — shows currently loaded Ollama models with memory/GPU status

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
              <p class="text-[11px] text-neutral-500 dark:text-neutral-400">Models loaded in memory</p>
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
      const { models } = await window.api.ollama.getRunningModels();
      this._renderModels(models || []);
    } catch {
      this._renderModels([]);
    }
  },

  _renderModels(models) {
    const content = this._container.querySelector('#runtimeContent');
    if (!content) return;

    if (!models.length) {
      content.innerHTML = `
        <div class="flex items-center gap-2 py-3">
          <span class="w-2 h-2 rounded-full bg-neutral-300 dark:bg-neutral-600"></span>
          <p class="text-xs text-neutral-500 dark:text-neutral-400">No models currently loaded in memory</p>
        </div>
      `;
      return;
    }

    content.innerHTML = models.map(m => this._renderModelCard(m)).join('');

    // Bind unload buttons
    content.querySelectorAll('[data-unload-model]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const name = btn.dataset.unloadModel;
        btn.disabled = true;
        btn.textContent = 'Unloading...';
        try {
          await window.api.ollama.unload(name);
          setTimeout(() => this._refresh(), 500);
        } catch {
          btn.textContent = 'Failed';
        }
      });
    });
  },

  _renderModelCard(model) {
    const name = model.name || model.model || 'Unknown';
    const paramSize = model.details?.parameter_size || '';
    const quant = model.details?.quantization_level || '';
    const totalSize = this._formatBytes(model.size || 0);
    const vramSize = this._formatBytes(model.size_vram || 0);
    const isFullGpu = model.size_vram && model.size && model.size_vram >= model.size;
    const isPartialGpu = model.size_vram && model.size && model.size_vram > 0 && model.size_vram < model.size;
    const isCpuOnly = !model.size_vram || model.size_vram === 0;
    const vramPercent = (model.size && model.size_vram) ? Math.round((model.size_vram / model.size) * 100) : 0;
    const countdown = this._getCountdown(model.expires_at);

    // Status indicator
    let statusDot = 'bg-neutral-400';
    let statusLabel = 'CPU';
    if (isFullGpu) { statusDot = 'bg-emerald-500'; statusLabel = 'Fully GPU'; }
    else if (isPartialGpu) { statusDot = 'bg-amber-500'; statusLabel = `${vramPercent}% GPU`; }

    return `
      <div class="bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/40 dark:border-neutral-700/40 rounded-xl p-3 shadow-sm">
        <div class="flex items-start justify-between gap-2">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1">
              <span class="w-2 h-2 rounded-full ${statusDot} flex-shrink-0"></span>
              <span class="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate">${name}</span>
              ${paramSize ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-400 flex-shrink-0">${paramSize}</span>` : ''}
            </div>
            <div class="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-neutral-500 dark:text-neutral-400">
              <span>Memory: ${totalSize}</span>
              ${!isCpuOnly ? `<span>VRAM: ${vramSize}</span>` : ''}
              <span>${statusLabel}</span>
              ${quant ? `<span>${quant}</span>` : ''}
            </div>
            ${countdown ? `<p class="text-[10px] text-neutral-400 dark:text-neutral-500 mt-1">Unloads in ${countdown}</p>` : ''}
          </div>
          <button data-unload-model="${name}" class="flex-shrink-0 px-2 py-1 rounded-lg text-[11px] font-medium text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800/40 hover:bg-rose-100 dark:hover:bg-rose-900/40 transition-all">
            Unload
          </button>
        </div>
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
