// Model Swap Indicator — inline progress in the model selector (top left)
// Shows loading state directly in the model dropdown button so users never leave their screen

const ModelSwapIndicator = {
  _isLoading: false,
  _originalBtnContent: '',

  init() {
    this._bindEvents();
  },

  _bindEvents() {
    window.api.modelSwap.onSwitchStart((data) => {
      this._showLoading(data.model);
    });

    window.api.modelSwap.onSwitchProgress((data) => {
      this._updateProgress(data.phase, data.model);
    });

    window.api.modelSwap.onSwitchComplete((data) => {
      if (data.alreadyLoaded) return;
      this._showComplete(data.model, data.durationMs);
    });

    window.api.modelSwap.onSwitchError((data) => {
      this._showError(data.model, data.error);
    });

    window.api.modelSwap.onPreloadStart(() => {});
    window.api.modelSwap.onPreloadComplete(() => {});
  },

  _getBtn() {
    return document.querySelector('#modelDropdownBtn');
  },

  _getDropdownContainer() {
    return document.querySelector('#modelDropdown');
  },

  _showLoading(modelName) {
    this._isLoading = true;
    const btn = this._getBtn();
    if (!btn) return;

    const displayName = this._formatModelName(modelName);

    // Replace button content with loading state + progress bar
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" 
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="model-swap-spinner flex-shrink-0">
        <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
      </svg>
      <span class="truncate text-neutral-500 dark:text-neutral-400">${displayName}</span>
    `;

    // Add progress bar below the button
    this._showProgressBar();
  },

  _updateProgress(phase, modelName) {
    if (!this._isLoading) return;
    const fill = document.querySelector('#modelSwapProgressFill');
    if (!fill) return;

    if (phase === 'evicting') {
      fill.style.width = '30%';
    } else if (phase === 'loading') {
      fill.style.width = '60%';
    }
  },

  _showComplete(modelName, durationMs) {
    this._isLoading = false;
    const btn = this._getBtn();
    if (!btn) return;

    const fill = document.querySelector('#modelSwapProgressFill');
    if (fill) fill.style.width = '100%';

    // Brief "ready" flash then restore normal dropdown state
    const displayName = this._formatModelName(modelName);
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" 
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="flex-shrink-0">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
      <span class="truncate">${displayName}</span>
    `;

    // After 1.5s, restore normal dropdown display
    setTimeout(() => {
      this._hideProgressBar();
      if (window.AppRouter) window.AppRouter.updateModelDropdown();
    }, 1500);
  },

  _showError(modelName, error) {
    this._isLoading = false;
    const btn = this._getBtn();
    if (!btn) return;

    const displayName = this._formatModelName(modelName);
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" 
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="flex-shrink-0">
        <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/>
        <line x1="9" y1="9" x2="15" y2="15"/>
      </svg>
      <span class="truncate text-red-500">${displayName} failed</span>
    `;

    setTimeout(() => {
      this._hideProgressBar();
      if (window.AppRouter) window.AppRouter.updateModelDropdown();
    }, 3000);
  },

  _showProgressBar() {
    // Remove existing if any
    this._hideProgressBar();

    const container = this._getDropdownContainer();
    if (!container) return;

    const bar = document.createElement('div');
    bar.id = 'modelSwapProgressBar';
    bar.className = 'model-swap-progress-bar';
    bar.innerHTML = '<div id="modelSwapProgressFill" class="model-swap-progress-fill animating" style="width:20%"></div>';
    container.appendChild(bar);
  },

  _hideProgressBar() {
    const bar = document.querySelector('#modelSwapProgressBar');
    if (bar) bar.remove();
  },

  _formatModelName(name) {
    if (!name) return 'model';
    const parts = name.split(':');
    const base = parts[0].replace(/[-_]/g, ' ');
    const tag = parts[1] || '';
    const formatted = base.charAt(0).toUpperCase() + base.slice(1);
    return tag ? `${formatted} ${tag.toUpperCase()}` : formatted;
  },

  isLoading() {
    return this._isLoading;
  },
};

window.ModelSwapIndicator = ModelSwapIndicator;
