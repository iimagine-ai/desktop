// Audio Page — Standalone TTS generator using Kokoro
// Enter text, pick a voice, generate, play & download

window.AudioPage = {
  _container: null,
  _generating: false,
  _lastAudioPath: null,

  async render(container) {
    this._container = container;
    this._generating = false;
    this._lastAudioPath = null;

    const settings = await window.api.tts.getSettings();
    const setup = await window.api.tts.checkSetup();

    container.innerHTML = `
      <div class="h-full flex flex-col p-6 max-w-2xl mx-auto">
        <h1 class="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-1">Audio</h1>
        <p class="text-xs text-neutral-500 dark:text-neutral-400 mb-6">Generate speech from text using Kokoro TTS (100% local, private)</p>

        ${!setup.ready ? `
          <div class="flex-1 flex items-center justify-center">
            <div class="text-center space-y-3">
              <p class="text-sm text-neutral-600 dark:text-neutral-400">TTS not set up yet</p>
              <button id="audioSetupBtn" class="px-4 py-2.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all">
                Set Up Kokoro TTS
              </button>
              <p id="audioSetupStatus" class="text-xs text-neutral-500 hidden"></p>
            </div>
          </div>
        ` : `
          <!-- Text Input -->
          <div class="mb-4">
            <label class="text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-1.5 block">Text</label>
            <textarea id="audioTextInput" rows="6" placeholder="Enter text to convert to speech..." class="w-full bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-4 py-3 text-sm text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 dark:placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-900/10 dark:focus:ring-neutral-100/10 resize-none transition-all shadow-sm"></textarea>
          </div>

          <!-- Voice Selector -->
          <div class="mb-4">
            <label class="text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-1.5 block">Voice</label>
            <select id="audioVoiceSelect" class="w-full bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2.5 text-sm text-neutral-700 dark:text-neutral-300 focus:outline-none transition-all shadow-sm">
              <option value="af_heart" ${settings.voice === 'af_heart' ? 'selected' : ''}>Heart (Female, American)</option>
              <option value="af_bella" ${settings.voice === 'af_bella' ? 'selected' : ''}>Bella (Female, American)</option>
              <option value="af_sarah" ${settings.voice === 'af_sarah' ? 'selected' : ''}>Sarah (Female, American)</option>
              <option value="af_nicole" ${settings.voice === 'af_nicole' ? 'selected' : ''}>Nicole (Female, American)</option>
              <option value="am_adam" ${settings.voice === 'am_adam' ? 'selected' : ''}>Adam (Male, American)</option>
              <option value="am_michael" ${settings.voice === 'am_michael' ? 'selected' : ''}>Michael (Male, American)</option>
              <option value="bf_emma" ${settings.voice === 'bf_emma' ? 'selected' : ''}>Emma (Female, British)</option>
              <option value="bf_isabella" ${settings.voice === 'bf_isabella' ? 'selected' : ''}>Isabella (Female, British)</option>
              <option value="bm_george" ${settings.voice === 'bm_george' ? 'selected' : ''}>George (Male, British)</option>
              <option value="bm_lewis" ${settings.voice === 'bm_lewis' ? 'selected' : ''}>Lewis (Male, British)</option>
            </select>
          </div>

          <!-- Generate Button -->
          <button id="audioGenerateBtn" class="w-full px-4 py-2.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm mb-4">
            Generate Audio
          </button>

          <!-- Status -->
          <p id="audioStatus" class="text-xs text-neutral-500 dark:text-neutral-400 text-center mb-4 hidden"></p>

          <!-- Audio Player + Download (hidden until generated) -->
          <div id="audioResultSection" class="hidden space-y-3">
            <div class="bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl p-4">
              <audio id="audioPlayer" controls class="w-full"></audio>
            </div>
            <button id="audioDownloadBtn" class="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-neutral-200 dark:border-neutral-700 text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-all">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Download .wav
            </button>
          </div>
        `}
      </div>
    `;

    this._bindEvents(setup.ready);
  },

  _bindEvents(isReady) {
    if (!isReady) {
      const setupBtn = this._container.querySelector('#audioSetupBtn');
      if (setupBtn) {
        setupBtn.addEventListener('click', async () => {
          const statusEl = this._container.querySelector('#audioSetupStatus');
          setupBtn.disabled = true;
          setupBtn.textContent = 'Setting up...';
          if (statusEl) { statusEl.textContent = 'Creating Python environment & installing Kokoro...'; statusEl.classList.remove('hidden'); }

          const result = await window.api.tts.setup();
          if (result.success) {
            this.render(this._container);
          } else {
            setupBtn.disabled = false;
            setupBtn.textContent = 'Set Up Kokoro TTS';
            if (statusEl) { statusEl.textContent = 'Setup failed: ' + (result.error || 'unknown'); statusEl.classList.remove('hidden'); statusEl.classList.add('text-rose-500'); }
          }
        });
      }
      return;
    }

    const generateBtn = this._container.querySelector('#audioGenerateBtn');
    const downloadBtn = this._container.querySelector('#audioDownloadBtn');

    generateBtn.addEventListener('click', () => this._generate());

    if (downloadBtn) {
      downloadBtn.addEventListener('click', () => this._download());
    }
  },

  async _generate() {
    if (this._generating) return;

    const textInput = this._container.querySelector('#audioTextInput');
    const voiceSelect = this._container.querySelector('#audioVoiceSelect');
    const generateBtn = this._container.querySelector('#audioGenerateBtn');
    const statusEl = this._container.querySelector('#audioStatus');
    const resultSection = this._container.querySelector('#audioResultSection');

    const text = textInput.value.trim();
    if (!text) {
      statusEl.textContent = 'Please enter some text';
      statusEl.classList.remove('hidden');
      return;
    }

    this._generating = true;
    generateBtn.disabled = true;
    generateBtn.textContent = 'Generating...';
    statusEl.textContent = 'Synthesizing speech...';
    statusEl.classList.remove('hidden', 'text-rose-500');
    resultSection.classList.add('hidden');

    try {
      const result = await window.api.tts.synthesize(text, { voice: voiceSelect.value });

      if (result && result.audioPath) {
        this._lastAudioPath = result.audioPath;
        const player = this._container.querySelector('#audioPlayer');
        player.src = 'file://' + result.audioPath;
        resultSection.classList.remove('hidden');
        statusEl.textContent = `Generated ${result.duration ? result.duration.toFixed(1) + 's' : ''} of audio`;
      } else {
        statusEl.textContent = 'Generation failed — no audio returned';
        statusEl.classList.add('text-rose-500');
      }
    } catch (err) {
      statusEl.textContent = 'Error: ' + (err.message || 'unknown');
      statusEl.classList.add('text-rose-500');
    }

    this._generating = false;
    generateBtn.disabled = false;
    generateBtn.textContent = 'Generate Audio';
  },

  _download() {
    if (!this._lastAudioPath) return;
    // Open the file location in system file manager
    window.api.shell.openPath(this._lastAudioPath);
  },
};
