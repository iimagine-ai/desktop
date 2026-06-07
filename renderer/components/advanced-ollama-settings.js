// Advanced Ollama Settings — GPU, CPU threads, keep alive, context window controls

const AdvancedOllamaSettings = {
  _container: null,
  _isOpen: false,

  GPU_OPTIONS: [
    { value: 'auto', label: 'Auto (recommended)' },
    { value: '0', label: '0 (CPU only)' },
    { value: '1', label: '1' },
    { value: '2', label: '2' },
    { value: '4', label: '4' },
    { value: '8', label: '8' },
    { value: '16', label: '16' },
    { value: '32', label: '32' },
    { value: '64', label: '64' },
    { value: '-1', label: '-1 (All to GPU)' },
  ],

  THREAD_OPTIONS: [
    { value: 'auto', label: 'Auto (recommended)' },
    { value: '1', label: '1' },
    { value: '2', label: '2' },
    { value: '4', label: '4' },
    { value: '6', label: '6' },
    { value: '8', label: '8' },
    { value: '12', label: '12' },
    { value: '16', label: '16' },
  ],

  KEEP_ALIVE_OPTIONS: [
    { value: '0', label: 'Unload immediately' },
    { value: '5m', label: '5 minutes (default)' },
    { value: '30m', label: '30 minutes' },
    { value: '1h', label: '1 hour' },
    { value: '24h', label: '24 hours' },
    { value: '-1', label: 'Never unload' },
  ],

  CTX_OPTIONS: [
    { value: 'auto', label: 'Auto' },
    { value: '2048', label: '2048' },
    { value: '4096', label: '4096' },
    { value: '8192', label: '8192' },
    { value: '16384', label: '16384' },
    { value: '32768', label: '32768' },
    { value: '65536', label: '65536' },
    { value: '131072', label: '131072' },
  ],

  REASONING_OPTIONS: [
    { value: 'false', label: 'Off (faster, recommended)' },
    { value: 'true', label: 'On (slower, may improve hard questions)' },
  ],

  TOOLS_OPTIONS: [
    { value: 'true', label: 'On (MCP integrations + web search)' },
    { value: 'false', label: 'Off (faster, no tool calls)' },
  ],

  /**
   * Mount the advanced settings component into a container element
   */
  async mount(container) {
    this._container = container;
    this._render();
    await this._loadSettings();
    this._bindEvents();
  },

  _render() {
    this._container.innerHTML = `
      <div class="mt-4">
        <button id="advOllamaToggle" class="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 hover:bg-white/70 dark:hover:bg-neutral-700/70 transition-all text-left group">
          <div class="flex items-center gap-2.5">
            <span class="text-base">⚙️</span>
            <div>
              <span class="text-sm font-medium text-neutral-900 dark:text-neutral-100">Advanced</span>
              <p class="text-[11px] text-neutral-500 dark:text-neutral-400">GPU layers, threads, memory management</p>
            </div>
          </div>
          <svg id="advOllamaChevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-neutral-400 transition-transform"><polyline points="6 9 12 15 18 9"/></svg>
        </button>

        <div id="advOllamaPanel" class="hidden mt-3 space-y-4 px-1">
          <p class="text-[11px] text-neutral-500 dark:text-neutral-400 italic">These settings control how the local AI engine uses your hardware. Changes take effect when the engine restarts (next chat message with a local model).</p>

          <!-- GPU Layers -->
          <div>
            <label class="text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-1.5 block">GPU Layers</label>
            <p class="text-[10px] text-neutral-400 dark:text-neutral-500 mb-1.5">Number of model layers offloaded to GPU. 0 = CPU only, -1 = all to GPU.</p>
            <select id="advNumGpu" class="w-full bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2.5 text-sm text-neutral-700 dark:text-neutral-300 focus:outline-none transition-all shadow-sm"></select>
          </div>

          <!-- CPU Threads -->
          <div>
            <label class="text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-1.5 block">CPU Threads</label>
            <p class="text-[10px] text-neutral-400 dark:text-neutral-500 mb-1.5">Number of CPU threads for inference. Auto uses all available cores.</p>
            <select id="advNumThread" class="w-full bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2.5 text-sm text-neutral-700 dark:text-neutral-300 focus:outline-none transition-all shadow-sm"></select>
          </div>

          <!-- Keep Alive -->
          <div>
            <label class="text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-1.5 block">Keep Alive</label>
            <p class="text-[10px] text-neutral-400 dark:text-neutral-500 mb-1.5">How long the model stays loaded in memory after the last request.</p>
            <select id="advKeepAlive" class="w-full bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2.5 text-sm text-neutral-700 dark:text-neutral-300 focus:outline-none transition-all shadow-sm"></select>
          </div>

          <!-- Context Window -->
          <div>
            <label class="text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-1.5 block">Context Window</label>
            <p class="text-[10px] text-neutral-400 dark:text-neutral-500 mb-1.5">Maximum tokens the model can process per request (system prompt + chat history + response). Lower values save RAM; higher values let the model see more conversation history. Setting this above the model's trained limit wastes memory without improving quality. Takes effect on next engine start.</p>
            <select id="advNumCtx" class="w-full bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2.5 text-sm text-neutral-700 dark:text-neutral-300 focus:outline-none transition-all shadow-sm"></select>
            <p id="advCtxNote" class="text-[10px] text-amber-600 dark:text-amber-400 mt-1 hidden"></p>
          </div>

          <!-- Reasoning -->
          <div>
            <label class="text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-1.5 block">Reasoning</label>
            <p class="text-[10px] text-neutral-400 dark:text-neutral-500 mb-1.5">When on, the model "thinks" before answering. This can improve quality on hard questions but is much slower on local hardware and adds a long delay before the first word appears. Off answers directly. Takes effect on next engine start.</p>
            <select id="advReasoning" class="w-full bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2.5 text-sm text-neutral-700 dark:text-neutral-300 focus:outline-none transition-all shadow-sm"></select>
          </div>

          <!-- Tool Use -->
          <div>
            <label class="text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-1.5 block">Tool Use</label>
            <p class="text-[10px] text-neutral-400 dark:text-neutral-500 mb-1.5">When on, MCP integrations (Google Workspace etc.) and web search tools are sent with each request. Turning off reduces prompt size and speeds up responses on local models that don't need tool calling.</p>
            <select id="advToolsEnabled" class="w-full bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2.5 text-sm text-neutral-700 dark:text-neutral-300 focus:outline-none transition-all shadow-sm"></select>
          </div>

          <!-- Reset button -->
          <button id="advResetBtn" class="w-full px-4 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-xs font-medium text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-all">
            Reset to defaults
          </button>
          <p id="advSaveStatus" class="text-[11px] text-emerald-600 dark:text-emerald-400 text-center hidden">Settings saved</p>
        </div>
      </div>
    `;

    // Populate dropdowns
    this._populateSelect('advNumGpu', this.GPU_OPTIONS);
    this._populateSelect('advNumThread', this.THREAD_OPTIONS);
    this._populateSelect('advKeepAlive', this.KEEP_ALIVE_OPTIONS);
    this._populateSelect('advNumCtx', this.CTX_OPTIONS);
    this._populateSelect('advReasoning', this.REASONING_OPTIONS);
    this._populateSelect('advToolsEnabled', this.TOOLS_OPTIONS);
  },

  _populateSelect(id, options) {
    const select = this._container.querySelector(`#${id}`);
    if (!select) return;
    select.innerHTML = options.map(o => `<option value="${o.value}">${o.label}</option>`).join('');
  },

  async _loadSettings() {
    try {
      const settings = await window.api.ollama.getAdvancedSettings();
      this._setSelectValue('advNumGpu', settings.numGpu);
      this._setSelectValue('advNumThread', settings.numThread);
      this._setSelectValue('advKeepAlive', settings.keepAlive);
      this._setSelectValue('advNumCtx', settings.numCtx);
      this._updateCtxNote(settings.numCtx);
      this._setSelectValue('advReasoning', settings.reasoning);
      this._setSelectValue('advToolsEnabled', settings.toolsEnabled);
    } catch (err) {
      console.warn('[AdvancedOllamaSettings] Failed to load:', err);
    }
  },

  _setSelectValue(id, value) {
    const select = this._container.querySelector(`#${id}`);
    if (select) select.value = String(value);
  },

  _bindEvents() {
    const toggle = this._container.querySelector('#advOllamaToggle');
    const panel = this._container.querySelector('#advOllamaPanel');
    const chevron = this._container.querySelector('#advOllamaChevron');

    toggle?.addEventListener('click', () => {
      this._isOpen = !this._isOpen;
      panel.classList.toggle('hidden', !this._isOpen);
      chevron.style.transform = this._isOpen ? 'rotate(180deg)' : '';
    });

    // Auto-save on change
    const selects = ['advNumGpu', 'advNumThread', 'advKeepAlive', 'advNumCtx', 'advReasoning', 'advToolsEnabled'];
    selects.forEach(id => {
      this._container.querySelector(`#${id}`)?.addEventListener('change', () => this._save());
    });

    // Reset button
    this._container.querySelector('#advResetBtn')?.addEventListener('click', () => this._reset());
  },

  async _save() {
    const settings = {
      numGpu: this._container.querySelector('#advNumGpu')?.value || 'auto',
      numThread: this._container.querySelector('#advNumThread')?.value || 'auto',
      keepAlive: this._container.querySelector('#advKeepAlive')?.value || '5m',
      numCtx: this._container.querySelector('#advNumCtx')?.value || 'auto',
      reasoning: this._container.querySelector('#advReasoning')?.value === 'true',
      toolsEnabled: this._container.querySelector('#advToolsEnabled')?.value === 'true',
    };

    // Show context window guidance
    this._updateCtxNote(settings.numCtx);

    try {
      await window.api.ollama.setAdvancedSettings(settings);
      this._flashStatus('Settings saved');
    } catch (err) {
      console.warn('[AdvancedOllamaSettings] Save failed:', err);
    }
  },

  _updateCtxNote(numCtx) {
    const note = this._container.querySelector('#advCtxNote');
    if (!note) return;

    const val = parseInt(numCtx);
    if (isNaN(val) || numCtx === 'auto') {
      note.classList.add('hidden');
      return;
    }

    if (val >= 65536) {
      note.textContent = '⚠️ Very large context window. Requires significant RAM (~4-8GB extra). Most small models (8B) are trained for 8K-32K context.';
      note.classList.remove('hidden');
    } else if (val >= 32768) {
      note.textContent = 'Large context window. Uses more RAM. Good for models trained with 32K+ context (Qwen 3, Gemma 4).';
      note.classList.remove('hidden');
    } else if (val <= 2048) {
      note.textContent = 'Small context window. Saves RAM but limits how much conversation history the model can see.';
      note.classList.remove('hidden');
    } else {
      note.classList.add('hidden');
    }
  },

  async _reset() {
    const defaults = { numGpu: 'auto', numThread: 'auto', keepAlive: '5m', numCtx: 'auto', reasoning: false, toolsEnabled: true };
    this._setSelectValue('advNumGpu', defaults.numGpu);
    this._setSelectValue('advNumThread', defaults.numThread);
    this._setSelectValue('advKeepAlive', defaults.keepAlive);
    this._setSelectValue('advNumCtx', defaults.numCtx);
    this._setSelectValue('advReasoning', defaults.reasoning);
    this._setSelectValue('advToolsEnabled', defaults.toolsEnabled);
    await window.api.ollama.setAdvancedSettings(defaults);
    this._flashStatus('Reset to defaults');
  },

  _flashStatus(msg) {
    const el = this._container.querySelector('#advSaveStatus');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 2000);
  },
};

window.AdvancedOllamaSettings = AdvancedOllamaSettings;
