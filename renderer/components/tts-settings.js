// TTS Settings — UI component for text-to-speech configuration
// Mounted in the Settings page under the Models tab or its own Voice tab

const TTSSettings = {
  _container: null,
  _settings: null,
  _setupStatus: null,

  async mount(container) {
    this._container = container;
    this._settings = await window.api.tts.getSettings();
    this._setupStatus = await window.api.tts.checkSetup();
    this._render();
  },

  _render() {
    const isSetup = this._setupStatus?.ready;
    const hasVoiceClone = !!this._settings?.voiceCloneAudioPath;

    this._container.innerHTML = `
      <section class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-5 shadow-[0_2px_10px_rgb(0,0,0,0.02)] dark:shadow-[0_2px_10px_rgb(0,0,0,0.2)] backdrop-blur-md">
        <div class="flex items-center gap-2 mb-4">
          <div class="p-2 bg-white dark:bg-neutral-800 rounded-xl border border-neutral-100 dark:border-neutral-800 shadow-sm text-violet-600">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
          </div>
          <div>
            <h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Voice / TTS</h3>
            <p class="text-xs text-neutral-500 dark:text-neutral-400">Read responses aloud using Kokoro TTS (local, private)</p>
          </div>
        </div>

        ${!isSetup ? this._renderSetupSection() : this._renderConfigSection(hasVoiceClone)}
      </section>
    `;

    this._bindEvents();
  },

  _renderSetupSection() {
    return `
      <div class="space-y-3">
        <div class="p-3 rounded-xl bg-amber-50/80 dark:bg-amber-900/20 border border-amber-200/60 dark:border-amber-800/40">
          <p class="text-xs text-amber-700 dark:text-amber-300">
            <strong>One-time setup required.</strong> This will create an isolated Python environment and install mlx-audio (~500MB). Requires Python 3.10+ installed on your system.
          </p>
        </div>
        <button id="ttsSetupBtn" class="w-full px-4 py-2.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm">
          Set Up Voice
        </button>
        <p id="ttsSetupStatus" class="text-xs text-neutral-500 text-center hidden"></p>
      </div>
    `;
  },

  _renderConfigSection(hasVoiceClone) {
    const voice = this._settings?.voice || 'af_heart';
    const autoplay = this._settings?.autoplay || false;

    return `
      <div class="space-y-4">
        <!-- Voice Selection -->
        <div>
          <label class="text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1.5 block">Voice</label>
          <select id="ttsVoiceSelect" class="w-full bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2.5 text-sm text-neutral-700 dark:text-neutral-300 focus:outline-none transition-all shadow-sm">
            <option value="af_heart" ${voice === 'af_heart' ? 'selected' : ''}>Heart (Female, American)</option>
            <option value="af_bella" ${voice === 'af_bella' ? 'selected' : ''}>Bella (Female, American)</option>
            <option value="af_nicole" ${voice === 'af_nicole' ? 'selected' : ''}>Nicole (Female, American)</option>
            <option value="af_sarah" ${voice === 'af_sarah' ? 'selected' : ''}>Sarah (Female, American)</option>
            <option value="af_sky" ${voice === 'af_sky' ? 'selected' : ''}>Sky (Female, American)</option>
            <option value="am_adam" ${voice === 'am_adam' ? 'selected' : ''}>Adam (Male, American)</option>
            <option value="am_michael" ${voice === 'am_michael' ? 'selected' : ''}>Michael (Male, American)</option>
            <option value="bf_emma" ${voice === 'bf_emma' ? 'selected' : ''}>Emma (Female, British)</option>
            <option value="bf_isabella" ${voice === 'bf_isabella' ? 'selected' : ''}>Isabella (Female, British)</option>
            <option value="bm_george" ${voice === 'bm_george' ? 'selected' : ''}>George (Male, British)</option>
            <option value="bm_lewis" ${voice === 'bm_lewis' ? 'selected' : ''}>Lewis (Male, British)</option>
          </select>
          <p class="text-[10px] text-neutral-400 mt-1">Powered by Kokoro TTS (82M params, 100% local)</p>
        </div>

        <!-- Autoplay Toggle -->
        <div class="flex items-center justify-between">
          <div>
            <label class="text-xs font-medium text-neutral-700 dark:text-neutral-300">Auto-play responses</label>
            <p class="text-[10px] text-neutral-400 mt-0.5">Automatically read aloud every assistant response</p>
          </div>
          <button id="ttsAutoplayToggle" class="relative w-10 h-5 rounded-full transition-colors ${autoplay ? 'bg-emerald-500' : 'bg-neutral-200 dark:bg-neutral-700'}" role="switch" aria-checked="${autoplay}">
            <span class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${autoplay ? 'translate-x-5' : ''}"></span>
          </button>
        </div>

        <!-- Voice Cloning -->
        <div>
          <label class="text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1.5 block">Voice Clone</label>
          <p class="text-[10px] text-neutral-400 mb-2">Upload a short audio clip (5-30s) to clone a voice. The TTS will sound like the speaker in the clip.</p>
          <div class="flex items-center gap-2">
            ${hasVoiceClone
              ? `<span class="flex-1 text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                  Voice clone active
                </span>
                <button id="ttsClearVoiceBtn" class="px-3 py-1.5 rounded-lg text-xs font-medium text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-all border border-rose-200 dark:border-rose-800">Clear</button>`
              : `<button id="ttsUploadVoiceBtn" class="flex-1 px-3 py-2 rounded-lg bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-700 transition-all shadow-sm text-center">
                  Upload Voice Clip
                </button>`
            }
          </div>
        </div>

        <!-- Save -->
        <button id="ttsSaveBtn" class="w-full px-4 py-2.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm">
          Save Voice Settings
        </button>
        <p id="ttsSaveStatus" class="text-xs text-emerald-600 text-center hidden">Settings saved</p>
      </div>
    `;
  },

  _bindEvents() {
    // Setup button
    const setupBtn = this._container.querySelector('#ttsSetupBtn');
    if (setupBtn) {
      setupBtn.addEventListener('click', async () => {
        const statusEl = this._container.querySelector('#ttsSetupStatus');
        setupBtn.disabled = true;
        setupBtn.textContent = 'Setting up...';
        if (statusEl) { statusEl.textContent = 'Creating Python environment...'; statusEl.classList.remove('hidden'); }

        const result = await window.api.tts.setup();
        if (result.success) {
          this._setupStatus = await window.api.tts.checkSetup();
          this._render();
        } else {
          if (statusEl) { statusEl.textContent = `Setup failed: ${result.error}`; statusEl.className = 'text-xs text-rose-500 text-center'; }
          setupBtn.disabled = false;
          setupBtn.textContent = 'Retry Setup';
        }
      });
    }

    // Autoplay toggle
    const autoplayToggle = this._container.querySelector('#ttsAutoplayToggle');
    if (autoplayToggle) {
      autoplayToggle.addEventListener('click', () => {
        const isOn = autoplayToggle.getAttribute('aria-checked') === 'true';
        const newState = !isOn;
        autoplayToggle.setAttribute('aria-checked', String(newState));
        autoplayToggle.className = `relative w-10 h-5 rounded-full transition-colors ${newState ? 'bg-emerald-500' : 'bg-neutral-200 dark:bg-neutral-700'}`;
        const dot = autoplayToggle.querySelector('span');
        dot.className = `absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${newState ? 'translate-x-5' : ''}`;
      });
    }

    // Upload voice clip
    const uploadBtn = this._container.querySelector('#ttsUploadVoiceBtn');
    if (uploadBtn) {
      uploadBtn.addEventListener('click', async () => {
        const result = await window.api.dialog.open({
          filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'm4a', 'ogg', 'flac'] }],
          properties: ['openFile'],
        });
        if (result && result.filePaths && result.filePaths[0]) {
          await window.api.tts.setVoiceClone(result.filePaths[0]);
          this._settings = await window.api.tts.getSettings();
          this._render();
        }
      });
    }

    // Clear voice clone
    const clearBtn = this._container.querySelector('#ttsClearVoiceBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', async () => {
        await window.api.tts.clearVoiceClone();
        this._settings = await window.api.tts.getSettings();
        this._render();
      });
    }

    // Save button
    const saveBtn = this._container.querySelector('#ttsSaveBtn');
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        const voice = this._container.querySelector('#ttsVoiceSelect')?.value;
        const autoplay = this._container.querySelector('#ttsAutoplayToggle')?.getAttribute('aria-checked') === 'true';
        await window.api.tts.updateSettings({ voice, autoplay, model: 'kokoro' });
        this._settings = await window.api.tts.getSettings();
        const status = this._container.querySelector('#ttsSaveStatus');
        if (status) { status.classList.remove('hidden'); setTimeout(() => status.classList.add('hidden'), 2000); }
      });
    }
  },

  destroy() {
    this._container = null;
  }
};

window.TTSSettings = TTSSettings;
