// Model Browser — guided wizard + advanced browser UI component
// Mounted into the Models tab of settings. Handles both user flows.

const ModelBrowser = {
  _container: null,
  _manifest: null,
  _hardware: null,
  _installedModels: [],
  _selectedCategories: new Set(),
  _activeView: 'entry', // 'entry', 'guided', 'browse'

  async mount(container) {
    this._container = container;
    this._manifest = await window.api.manifest.get();
    this._hardware = await window.api.hardware.scan();

    // Load installed models from disk to mark them as "Installed" in the UI
    try {
      const installed = await window.api.engine.getInstalledModels();
      this._installedModels = installed || [];
    } catch { this._installedModels = []; }

    this._render();
  },

  setInstalledModels(models) {
    this._installedModels = models || [];
  },

  _render() {
    if (this._activeView === 'entry') this._renderEntry();
    else if (this._activeView === 'guided') this._renderGuided();
    else if (this._activeView === 'browse') this._renderBrowse();
  },

  // ─── Entry Point ──────────────────────────────────────────────
  _renderEntry() {
    this._container.innerHTML = `
      <div class="space-y-3">
        <button id="mbGuidedBtn" class="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 hover:bg-white/70 dark:hover:bg-neutral-700/70 transition-all text-left">
          <div class="p-2 bg-emerald-50 dark:bg-emerald-900/30 rounded-lg"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="text-emerald-600"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg></div>
          <div>
            <p class="text-sm font-medium text-neutral-900 dark:text-neutral-100">Find the right model</p>
            <p class="text-[11px] text-neutral-500 dark:text-neutral-400">Tell us what you need and we'll recommend the best options for your hardware</p>
          </div>
        </button>
        <button id="mbBrowseBtn" class="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 hover:bg-white/70 dark:hover:bg-neutral-700/70 transition-all text-left">
          <div class="p-2 bg-neutral-100 dark:bg-neutral-800 rounded-lg"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="text-neutral-600 dark:text-neutral-400"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg></div>
          <div>
            <p class="text-sm font-medium text-neutral-900 dark:text-neutral-100">Browse all models</p>
            <p class="text-[11px] text-neutral-500 dark:text-neutral-400">Search and filter the full catalog, or enter a custom model ID</p>
          </div>
        </button>
      </div>
    `;
    this._container.querySelector('#mbGuidedBtn').addEventListener('click', () => { this._activeView = 'guided'; this._render(); });
    this._container.querySelector('#mbBrowseBtn').addEventListener('click', () => { this._activeView = 'browse'; this._render(); });
  },

  // ─── Guided Wizard ────────────────────────────────────────────
  _renderGuided() {
    const hw = this._hardware || {};
    const hwSummary = `${hw.aiMemoryGB || hw.ramGB || '?'}GB RAM • ${hw.gpu?.name || 'Unknown GPU'} • ${hw.diskFreeGB || '?'}GB free disk`;

    this._container.innerHTML = `
      <div class="space-y-4">
        <button id="mbBackBtn" class="text-xs text-neutral-400 hover:text-neutral-600 flex items-center gap-1"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg> Back</button>

        <div>
          <label class="text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-2 block">What do you need AI for?</label>
          <div id="mbCategories" class="flex flex-wrap gap-2"></div>
        </div>

        <div class="p-3 rounded-xl bg-neutral-50/80 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40">
          <p class="text-[10px] font-medium text-neutral-500 uppercase tracking-wider mb-1">Your hardware</p>
          <p class="text-xs text-neutral-600 dark:text-neutral-400">${hwSummary}</p>
        </div>

        <button id="mbRecommendBtn" class="w-full px-4 py-2.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm disabled:opacity-40 disabled:cursor-not-allowed" disabled>
          Get Recommendations
        </button>

        <div id="mbResults" class="hidden space-y-2"></div>
      </div>
    `;

    // Back button
    this._container.querySelector('#mbBackBtn').addEventListener('click', () => { this._activeView = 'entry'; this._selectedCategories.clear(); this._render(); });

    // Category pills
    const catContainer = this._container.querySelector('#mbCategories');
    const recommendBtn = this._container.querySelector('#mbRecommendBtn');

    window.ModelAdvisor.CATEGORY_OPTIONS.forEach(cat => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'px-3 py-2 rounded-xl border text-xs transition-all flex items-center gap-1.5 border-neutral-200/50 dark:border-neutral-700/50 bg-white/60 dark:bg-neutral-800/60 text-neutral-600 dark:text-neutral-400 hover:bg-white/90 dark:hover:bg-neutral-700/90';
      btn.innerHTML = `${cat.icon}<span>${cat.label}</span>`;
      btn.addEventListener('click', () => {
        if (this._selectedCategories.has(cat.id)) {
          this._selectedCategories.delete(cat.id);
          btn.className = 'px-3 py-2 rounded-xl border text-xs transition-all flex items-center gap-1.5 border-neutral-200/50 dark:border-neutral-700/50 bg-white/60 dark:bg-neutral-800/60 text-neutral-600 dark:text-neutral-400 hover:bg-white/90 dark:hover:bg-neutral-700/90';
        } else {
          this._selectedCategories.add(cat.id);
          btn.className = 'px-3 py-2 rounded-xl border text-xs transition-all flex items-center gap-1.5 border-neutral-900 dark:border-neutral-100 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900';
        }
        recommendBtn.disabled = this._selectedCategories.size === 0;
      });
      catContainer.appendChild(btn);
    });

    // Recommend button
    recommendBtn.addEventListener('click', () => this._showRecommendations());
  },

  _showRecommendations() {
    const resultsDiv = this._container.querySelector('#mbResults');
    const { models, message } = window.ModelAdvisor.getRecommendations(
      this._manifest, this._hardware, [...this._selectedCategories]
    );

    resultsDiv.classList.remove('hidden');

    if (!models.length) {
      resultsDiv.innerHTML = `<p class="text-xs text-amber-600 p-3 rounded-xl bg-amber-50/80 border border-amber-100">${message || 'No compatible models found.'}</p>`;
      return;
    }

    let noteHtml = '';
    if (message) {
      noteHtml = `<p class="text-[11px] text-blue-600 dark:text-blue-400 p-2.5 rounded-xl bg-blue-50/80 dark:bg-blue-900/20 border border-blue-200/60 dark:border-blue-800/40 mb-2">${message}</p>`;
    }

    const installedFilenames = this._installedModels.map(m => m.filename);
    const top5 = models.slice(0, 5);

    resultsDiv.innerHTML = noteHtml + top5.map((model, i) => {
      const variant = model.variants.find(v => v.is_default || v.isDefault) || model.variants[0];
      const perf = window.ModelAdvisor.getPerformanceEstimate(model, this._hardware);
      const isInstalled = model.variants.some(v => installedFilenames.includes(v.filename));
      const sizeGB = variant.size_gb || variant.sizeGB || '?';
      const ramGB = variant.ram_required_gb || variant.ramRequired || '?';

      return `
        <div class="p-3 rounded-xl ${i === 0 ? 'bg-emerald-50/80 dark:bg-emerald-900/20 border border-emerald-200/60 dark:border-emerald-800/40' : 'bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40'}">
          <div class="flex items-start justify-between gap-2">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <p class="text-sm font-medium text-neutral-900 dark:text-neutral-100">${model.name}</p>
                ${i === 0 ? '<span class="text-[9px] px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 font-medium">Recommended</span>' : ''}
              </div>
              <p class="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5">${model.description}</p>
              <div class="flex items-center gap-3 mt-1.5 text-[10px]">
                <span class="text-neutral-400">${sizeGB}GB download</span>
                <span class="text-neutral-400">${ramGB}GB RAM needed</span>
                <span class="${perf.speedColor} font-medium">${perf.speedLabel}</span>
              </div>
            </div>
            ${isInstalled
              ? '<span class="px-2.5 py-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 text-[11px] font-medium text-emerald-700 dark:text-emerald-300 flex-shrink-0">Installed ✓</span>'
              : `<button class="mb-download-btn px-2.5 py-1.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-[11px] font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all flex-shrink-0" data-model="${model.id}">Download</button>`
            }
          </div>
        </div>
      `;
    }).join('');

    // Bind download buttons
    resultsDiv.querySelectorAll('.mb-download-btn').forEach(btn => {
      btn.addEventListener('click', () => this._triggerDownload(btn));
    });
  },

  // ─── Advanced Browser ─────────────────────────────────────────
  _renderBrowse() {
    const models = this._manifest?.models || [];

    this._container.innerHTML = `
      <div class="space-y-3">
        <button id="mbBackBtn2" class="text-xs text-neutral-400 hover:text-neutral-600 flex items-center gap-1"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg> Back</button>

        <input id="mbSearchInput" type="text" placeholder="Search models..."
          class="w-full bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300 placeholder-neutral-400 focus:outline-none transition-all shadow-sm" />

        <div id="mbCatFilter" class="flex flex-wrap gap-1.5"></div>

        <div id="mbModelTable" class="space-y-1 max-h-[300px] overflow-y-auto"></div>

        <div class="pt-3 border-t border-neutral-200/40 dark:border-neutral-700/40">
          <p class="text-[10px] text-neutral-400">Models are downloaded directly from HuggingFace as GGUF files.</p>
        </div>
      </div>
    `;

    // Back
    this._container.querySelector('#mbBackBtn2').addEventListener('click', () => { this._activeView = 'entry'; this._render(); });

    // Category filter pills
    const catFilter = this._container.querySelector('#mbCatFilter');
    const activeCats = new Set();
    const categories = this._manifest?.categories?.filter(c => c !== 'video') || ['text', 'code', 'multimodal', 'embedding'];

    categories.forEach(cat => {
      const pill = document.createElement('button');
      pill.className = 'px-2 py-1 rounded-lg text-[10px] border border-neutral-200/50 dark:border-neutral-700/50 text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-all';
      pill.textContent = cat;
      pill.addEventListener('click', () => {
        if (activeCats.has(cat)) { activeCats.delete(cat); pill.className = 'px-2 py-1 rounded-lg text-[10px] border border-neutral-200/50 dark:border-neutral-700/50 text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-all'; }
        else { activeCats.add(cat); pill.className = 'px-2 py-1 rounded-lg text-[10px] border border-neutral-900 dark:border-neutral-100 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900'; }
        renderTable();
      });
      catFilter.appendChild(pill);
    });

    // Search + table rendering
    const searchInput = this._container.querySelector('#mbSearchInput');
    const tableDiv = this._container.querySelector('#mbModelTable');

    const installedFilenames = this._installedModels.map(m => m.filename);

    const renderTable = () => {
      let filtered = models;
      if (activeCats.size) filtered = window.ModelAdvisor.filterByCategory(filtered, [...activeCats]);
      if (searchInput.value.trim()) filtered = window.ModelAdvisor.searchModels(filtered, searchInput.value);

      tableDiv.innerHTML = filtered.map(model => {
        const variant = model.variants.find(v => v.is_default || v.isDefault) || model.variants[0];
        const compat = window.ModelAdvisor.checkCompatibility(model, this._hardware);
        const isInstalled = model.variants.some(v => installedFilenames.includes(v.filename));
        const sizeGB = variant.size_gb || variant.sizeGB || '?';

        return `
          <div class="flex items-center justify-between py-2 px-2.5 rounded-xl ${!compat.compatible ? 'opacity-40' : ''} hover:bg-white/50 dark:hover:bg-neutral-800/50 transition-all">
            <div class="flex items-center gap-2 flex-1 min-w-0">
              <div class="min-w-0">
                <p class="text-xs font-medium text-neutral-900 dark:text-neutral-100 truncate">${model.name}</p>
                <div class="flex items-center gap-2 mt-0.5">
                  <span class="text-[10px] text-neutral-400">${sizeGB}GB</span>
                  <span class="text-[10px] text-neutral-400">${model.categories.join(', ')}</span>
                </div>
              </div>
            </div>
            ${!compat.compatible
              ? `<span class="text-[10px] text-rose-400 flex-shrink-0" title="${compat.reason}">⚠️</span>`
              : isInstalled
                ? '<span class="text-[10px] text-emerald-600 flex-shrink-0">Installed</span>'
                : `<button class="mb-download-btn px-2 py-1 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-[10px] font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all flex-shrink-0" data-model="${model.id}">⬇</button>`
            }
          </div>
        `;
      }).join('') || '<p class="text-xs text-neutral-400 italic p-2">No models match your search.</p>';

      // Bind download buttons
      tableDiv.querySelectorAll('.mb-download-btn').forEach(btn => {
        btn.addEventListener('click', () => this._triggerDownload(btn));
      });
    };

    searchInput.addEventListener('input', renderTable);
    renderTable();

  },

  // ─── Shared: trigger download ─────────────────────────────────
  async _triggerDownload(btn) {
    const modelId = btn.dataset.model;

    // Look up model in the GGUF registry
    const registry = await window.api.engine.getRegistry();
    const registryMatch = registry?.find(m => {
      const cleanId = modelId.toLowerCase().split(':')[0];
      return m.id === cleanId || m.id === modelId || m.name.toLowerCase().includes(cleanId);
    });

    if (!registryMatch) {
      btn.textContent = 'Not found';
      setTimeout(() => { btn.textContent = '⬇'; }, 2000);
      return;
    }

    // Use the new download manager (supports resume, progress, queue)
    const progressId = 'mb-progress-' + Date.now();
    btn.outerHTML = `
      <div class="flex-shrink-0 w-32" id="${progressId}">
        <div class="w-full bg-neutral-200 dark:bg-neutral-700 rounded-full h-2 mb-1">
          <div class="mb-prog-bar bg-neutral-900 dark:bg-neutral-100 h-2 rounded-full transition-all" style="width: 0%"></div>
        </div>
        <p class="mb-prog-text text-[9px] text-neutral-500 text-center">Starting...</p>
      </div>
    `;

    const progressEl = document.getElementById(progressId);
    const bar = progressEl?.querySelector('.mb-prog-bar');
    const text = progressEl?.querySelector('.mb-prog-text');

    let isDone = false;

    window.api.downloads.onProgress((data) => {
      if (isDone || data.modelId !== registryMatch.id) return;
      if (bar && text) {
        bar.style.width = data.percentage + '%';
        const speed = data.speedMBps > 0 ? ` • ${data.speedMBps} MB/s` : '';
        text.textContent = data.percentage + '%' + speed;
      }
    });

    window.api.downloads.onComplete((data) => {
      if (isDone || data.modelId !== registryMatch.id) return;
      isDone = true;
      if (progressEl) {
        progressEl.innerHTML = '<span class="text-[10px] text-emerald-600 font-medium">Installed ✓</span>';
        if (window.ProviderManager?.refreshLocal) window.ProviderManager.refreshLocal();
        if (window.AppRouter?.updateModelDropdown) window.AppRouter.updateModelDropdown();
      }
    });

    window.api.downloads.onFailed((data) => {
      if (isDone || data.modelId !== registryMatch.id) return;
      isDone = true;
      if (progressEl) {
        progressEl.innerHTML = `<span class="text-[10px] text-rose-500">${data.error || 'Download failed'}</span>`;
      }
    });

    try {
      await window.api.downloads.start(registryMatch.id, 0);
    } catch (err) {
      if (progressEl && !isDone) {
        progressEl.innerHTML = `<span class="text-[10px] text-rose-500">${err.message || 'Error'}</span>`;
      }
    }
  },

  destroy() {
    this._container = null;
  }
};

window.ModelBrowser = ModelBrowser;
