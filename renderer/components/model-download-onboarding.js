// Model Download Onboarding — shown when no local models are installed
// Provides a friendly "no models found" state with one-click download
// Uses window.api.engine.downloadModel() and the model-registry

const ModelDownloadOnboarding = {
  _container: null,
  _hardware: null,
  _registry: null,
  _downloading: false,
  _downloadFilename: null,

  async mount(container) {
    this._container = container;
    this._hardware = await window.api.hardware.scan();
    this._registry = await window.api.engine.getRegistry();
    this._render();
  },

  /**
   * Check if onboarding should be shown (no engine models installed)
   */
  async shouldShow() {
    try {
      const installed = await window.api.engine.getInstalledModels();
      return !installed || installed.length === 0;
    } catch {
      return true;
    }
  },

  /**
   * Pick the best model for the user's hardware
   */
  _getRecommendedModel() {
    if (!this._registry || !this._registry.length) return null;

    const ramGB = this._hardware?.aiMemoryGB || this._hardware?.ramGB || 8;
    const chatModels = this._registry.filter(m =>
      m.categories.includes('text') &&
      m.variants.some(v => v.ramRequired <= ramGB)
    );

    if (!chatModels.length) return null;

    // Prefer larger models that still fit comfortably (use < 70% of RAM)
    const scored = chatModels.map(m => {
      const variant = m.variants.find(v => v.isDefault) || m.variants[0];
      const ramRatio = variant.ramRequired / ramGB;
      let score = 0;

      // Prefer models that use 30-60% of RAM (good balance)
      if (ramRatio < 0.3) score += 10;
      else if (ramRatio < 0.5) score += 30;
      else if (ramRatio < 0.7) score += 25;
      else score += 5;

      // Prefer larger parameter counts (better quality)
      score += Math.min(variant.sizeGB * 3, 20);

      return { model: m, variant, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored[0] || null;
  },

  _render() {
    const recommended = this._getRecommendedModel();
    const ramGB = this._hardware?.aiMemoryGB || this._hardware?.ramGB || '?';
    const gpu = this._hardware?.gpu?.name || 'Unknown GPU';

    if (!recommended) {
      this._container.innerHTML = `
        <div class="p-6 rounded-2xl bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 backdrop-blur-md text-center">
          <div class="w-12 h-12 rounded-xl bg-amber-50 dark:bg-amber-900/30 flex items-center justify-center mx-auto mb-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="text-amber-600">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          </div>
          <h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-1">No compatible models found</h3>
          <p class="text-xs text-neutral-500 dark:text-neutral-400 mb-3">Your system has ${ramGB}GB RAM. Consider using the Public Cloud or Private Cloud options below instead.</p>
        </div>
      `;
      return;
    }

    const { model, variant } = recommended;

    this._container.innerHTML = `
      <div class="p-5 rounded-2xl bg-gradient-to-br from-emerald-50/80 to-white/50 dark:from-emerald-900/20 dark:to-neutral-800/50 border border-emerald-200/60 dark:border-emerald-800/40 backdrop-blur-md">
        <div class="flex items-start gap-4">
          <div class="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center flex-shrink-0">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="text-emerald-600">
              <rect x="4" y="4" width="16" height="16" rx="2"/>
              <path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"/>
              <path d="m13 8-4 8h6l-4-8z"/>
            </svg>
          </div>
          <div class="flex-1 min-w-0">
            <h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-0.5">Get started with Local AI</h3>
            <p class="text-xs text-neutral-500 dark:text-neutral-400 mb-3">No models installed yet. Download one to start chatting privately — nothing leaves your machine.</p>

            <!-- Recommended model card -->
            <div class="p-3.5 rounded-xl bg-white/70 dark:bg-neutral-800/70 border border-neutral-200/40 dark:border-neutral-700/40 mb-3">
              <div class="flex items-center justify-between mb-2">
                <div>
                  <span class="text-sm font-medium text-neutral-900 dark:text-neutral-100">${model.name}</span>
                  <span class="ml-2 text-[9px] px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 font-medium">Recommended</span>
                </div>
              </div>
              <p class="text-[11px] text-neutral-500 dark:text-neutral-400 mb-2">${model.description}</p>
              <div class="flex items-center gap-3 text-[10px] text-neutral-400">
                <span>${variant.sizeGB}GB download</span>
                <span>•</span>
                <span>${variant.ramRequired}GB RAM needed</span>
                <span>•</span>
                <span>You have ${ramGB}GB</span>
              </div>
            </div>

            <!-- Download button / progress -->
            <div id="onboardingDownloadArea">
              <button id="onboardingDownloadBtn" class="w-full px-4 py-2.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm flex items-center justify-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Download ${model.name}
              </button>
            </div>

            <p class="text-[10px] text-neutral-400 dark:text-neutral-500 mt-2 text-center">
              ${variant.sizeGB}GB download • ${variant.quantization} quantization • runs entirely on your ${gpu}
            </p>
          </div>
        </div>
      </div>
    `;

    this._bindDownload(model, variant);
  },

  _bindDownload(model, variant) {
    const btn = this._container.querySelector('#onboardingDownloadBtn');
    const area = this._container.querySelector('#onboardingDownloadArea');

    btn.addEventListener('click', async () => {
      if (this._downloading) return;
      this._downloading = true;
      this._downloadFilename = variant.filename;

      // Replace button with progress UI
      area.innerHTML = `
        <div class="space-y-2">
          <div class="w-full bg-neutral-100 dark:bg-neutral-800 rounded-full h-2.5 shadow-inner overflow-hidden">
            <div id="onboardingProgressBar" class="bg-gradient-to-r from-emerald-500 to-emerald-600 h-2.5 rounded-full transition-all duration-300" style="width: 0%"></div>
          </div>
          <div class="flex items-center justify-between">
            <p id="onboardingProgressText" class="text-xs text-neutral-500 dark:text-neutral-400">Starting download...</p>
            <button id="onboardingCancelBtn" class="text-[10px] text-rose-500 hover:text-rose-700 dark:hover:text-rose-400 font-medium transition-colors">Cancel</button>
          </div>
        </div>
      `;

      const progressBar = area.querySelector('#onboardingProgressBar');
      const progressText = area.querySelector('#onboardingProgressText');
      const cancelBtn = area.querySelector('#onboardingCancelBtn');

      // Listen for progress events
      const onProgress = (data) => {
        if (data.filename !== variant.filename) return;
        if (data.total > 0) {
          const pct = data.percent || Math.round((data.downloaded / data.total) * 100);
          progressBar.style.width = pct + '%';
          const downloadedMB = (data.downloaded / 1e6).toFixed(0);
          const totalMB = (data.total / 1e6).toFixed(0);
          progressText.textContent = `${downloadedMB} / ${totalMB} MB (${pct}%)`;
        } else {
          progressText.textContent = 'Downloading...';
        }
      };

      const onDone = (data) => {
        if (data.filename !== variant.filename) return;
        this._downloading = false;

        if (data.success) {
          area.innerHTML = `
            <div class="flex items-center justify-center gap-2 py-2.5">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-emerald-600">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                <polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
              <span class="text-sm font-medium text-emerald-700 dark:text-emerald-300">Downloaded successfully!</span>
            </div>
            <p class="text-[10px] text-neutral-400 text-center mt-1">Model is ready. Switch to it from the model dropdown in the sidebar.</p>
          `;

          // Notify the app to refresh model lists
          if (window.ProviderManager?.refreshLocal) {
            window.ProviderManager.refreshLocal();
          }
          if (window.AppRouter?.updateModelDropdown) {
            window.AppRouter.updateModelDropdown();
          }
        } else {
          const errorMsg = data.error === 'Download cancelled' ? 'Download cancelled' : 'Download failed';
          area.innerHTML = `
            <div class="text-center py-2">
              <p class="text-xs text-rose-500 mb-2">${errorMsg}</p>
              <button id="onboardingRetryBtn" class="px-4 py-2 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-xs font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm">
                Try Again
              </button>
            </div>
          `;
          area.querySelector('#onboardingRetryBtn')?.addEventListener('click', () => {
            this._render();
          });
        }
      };

      window.api.engine.onDownloadProgress(onProgress);
      window.api.engine.onDownloadDone(onDone);

      // Cancel button
      cancelBtn.addEventListener('click', async () => {
        await window.api.engine.cancelDownload();
        cancelBtn.textContent = 'Cancelling...';
        cancelBtn.disabled = true;
      });

      // Start the download
      try {
        await window.api.engine.downloadModel(variant.url, variant.filename);
      } catch (err) {
        this._downloading = false;
        area.innerHTML = `
          <div class="text-center py-2">
            <p class="text-xs text-rose-500 mb-2">Download failed: ${err.message || 'Unknown error'}</p>
            <button id="onboardingRetryBtn" class="px-4 py-2 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-xs font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm">
              Try Again
            </button>
          </div>
        `;
        area.querySelector('#onboardingRetryBtn')?.addEventListener('click', () => {
          this._render();
        });
      }
    });
  },

  destroy() {
    this._container = null;
    this._downloading = false;
  }
};

window.ModelDownloadOnboarding = ModelDownloadOnboarding;
