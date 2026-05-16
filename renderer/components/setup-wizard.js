// First-run setup wizard — shown once on first launch
// Guides user to choose Local AI (Ollama) or Cloud AI (API keys)

const SetupWizard = {
  async shouldShow() {
    const completed = await window.api.settings.get('setup.completed');
    return !completed;
  },

  show(onComplete) {
    const overlay = document.createElement('div');
    overlay.id = 'setupWizardOverlay';
    overlay.className = 'fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm';
    overlay.innerHTML = this._renderStep1();
    document.body.appendChild(overlay);
    this._bindStep1(overlay, onComplete);
  },

  _renderStep1() {
    return `
      <div class="bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl border border-neutral-200/60 dark:border-neutral-700/60 w-full max-w-md p-8 text-center">
        <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-neutral-800 to-neutral-950 flex items-center justify-center mx-auto mb-5">
          <div class="w-2.5 h-2.5 bg-white rounded-full"></div>
        </div>
        <h2 class="text-xl font-semibold text-neutral-900 dark:text-neutral-100 mb-2">Welcome to IIMAGINE Desktop</h2>
        <p class="text-sm text-neutral-500 dark:text-neutral-400 mb-6">How would you like to run AI?</p>

        <div class="space-y-3">
          <button id="wizSetupLocal" class="w-full p-4 rounded-xl border border-neutral-200 dark:border-neutral-700 hover:border-neutral-900 dark:hover:border-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-all text-left group">
            <div class="flex items-start gap-3">
              <div class="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 shrink-0 mt-0.5">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"/></svg>
              </div>
              <div>
                <p class="text-sm font-medium text-neutral-900 dark:text-neutral-100">Local AI</p>
                <p class="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">Private. Free. Nothing leaves your computer. Requires Ollama download (~500MB).</p>
              </div>
            </div>
          </button>

          <button id="wizSetupCloud" class="w-full p-4 rounded-xl border border-neutral-200 dark:border-neutral-700 hover:border-neutral-900 dark:hover:border-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-all text-left group">
            <div class="flex items-start gap-3">
              <div class="p-2 rounded-lg bg-violet-50 dark:bg-violet-900/30 text-violet-600 shrink-0 mt-0.5">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>
              </div>
              <div>
                <p class="text-sm font-medium text-neutral-900 dark:text-neutral-100">Cloud AI</p>
                <p class="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">Fast. GPT, Claude, Gemini. Requires an API key (bring your own).</p>
              </div>
            </div>
          </button>

          <button id="wizSetupSkip" class="w-full py-2 text-xs text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors">
            Skip — I'll set this up later in Settings
          </button>
        </div>
      </div>
    `;
  },

  _bindStep1(overlay, onComplete) {
    overlay.querySelector('#wizSetupLocal').addEventListener('click', async () => {
      // Mark setup as completed and navigate to Settings → Models
      await window.api.settings.set('setup.completed', true);
      await window.api.settings.set('setup.choice', 'local');
      overlay.remove();
      onComplete('local');
    });

    overlay.querySelector('#wizSetupCloud').addEventListener('click', async () => {
      await window.api.settings.set('setup.completed', true);
      await window.api.settings.set('setup.choice', 'cloud');
      overlay.remove();
      onComplete('cloud');
    });

    overlay.querySelector('#wizSetupSkip').addEventListener('click', async () => {
      await window.api.settings.set('setup.completed', true);
      await window.api.settings.set('setup.choice', 'skipped');
      overlay.remove();
      onComplete('skipped');
    });
  }
};

window.SetupWizard = SetupWizard;
