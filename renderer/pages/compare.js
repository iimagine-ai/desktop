// Compare page — run the same prompt on any two models, judge with a third
// Models can be local (GGUF) or cloud (API key). Any combination.

const ComparePage = {
  isRunning: false,
  abortController: null,

  render(container) {
    container.innerHTML = `
      <div id="comparePage" class="flex flex-col flex-1 min-h-0">
        <div class="flex-1 overflow-y-auto p-6 lg:p-10 space-y-6 max-w-5xl">
          <div class="space-y-1">
            <h2 class="text-lg font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Compare Models</h2>
            <p class="text-sm text-neutral-500 dark:text-neutral-400">Run the same prompt on two models. See which performs better for your use case.</p>
          </div>

          <!-- Prompt input -->
          <div class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-5 backdrop-blur-md space-y-4">
            <div>
              <label class="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-1.5 block">Test Prompt</label>
              <textarea id="comparePrompt" rows="4" placeholder="Write the prompt you want to test on both models..."
                class="w-full resize-none bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-4 py-3 text-sm text-neutral-700 dark:text-neutral-300 placeholder-neutral-400 dark:placeholder-neutral-500 focus:bg-white/90 dark:focus:bg-neutral-800/90 focus:outline-none transition-all shadow-sm"></textarea>
            </div>

            <!-- Model selectors — 3 columns -->
            <div class="grid grid-cols-3 gap-3">
              <div class="p-3 rounded-xl bg-green-50/50 dark:bg-green-900/10 border border-green-200/40 dark:border-green-800/30">
                <label class="text-xs font-medium text-green-800 dark:text-green-300 mb-1.5 block">Model A</label>
                <select id="compareModelA" class="w-full bg-transparent border border-green-200/50 dark:border-green-700/50 rounded-lg text-xs text-green-700 dark:text-green-400 font-medium p-1.5 focus:outline-none cursor-pointer">
                  <option value="">Loading...</option>
                </select>
              </div>
              <div class="p-3 rounded-xl bg-blue-50/50 dark:bg-blue-900/10 border border-blue-200/40 dark:border-blue-800/30">
                <label class="text-xs font-medium text-blue-800 dark:text-blue-300 mb-1.5 block">Model B</label>
                <select id="compareModelB" class="w-full bg-transparent border border-blue-200/50 dark:border-blue-700/50 rounded-lg text-xs text-blue-700 dark:text-blue-400 font-medium p-1.5 focus:outline-none cursor-pointer">
                  <option value="">Loading...</option>
                </select>
              </div>
              <div class="p-3 rounded-xl bg-purple-50/50 dark:bg-purple-900/10 border border-purple-200/40 dark:border-purple-800/30">
                <label class="text-xs font-medium text-purple-800 dark:text-purple-300 mb-1.5 block">Judge Model</label>
                <select id="compareJudgeModel" class="w-full bg-transparent border border-purple-200/50 dark:border-purple-700/50 rounded-lg text-xs text-purple-700 dark:text-purple-400 font-medium p-1.5 focus:outline-none cursor-pointer">
                  <option value="">Loading...</option>
                </select>
                <label class="flex items-center gap-1.5 mt-1.5 cursor-pointer">
                  <input id="compareJudgeToggle" type="checkbox" checked class="w-3 h-3 rounded border-neutral-300 dark:border-neutral-600" />
                  <span class="text-[10px] text-purple-600 dark:text-purple-400">Enable judge</span>
                </label>
              </div>
            </div>

            <!-- Judge prompt (editable) -->
            <div id="judgePromptSection">
              <div class="flex items-center justify-between mb-1.5">
                <label class="text-xs font-medium text-neutral-400 uppercase tracking-wider">Judge Prompt</label>
                <button id="toggleJudgePrompt" class="text-[10px] text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors">Show / Edit</button>
              </div>
              <textarea id="judgePromptInput" rows="8" class="hidden w-full resize-y bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-4 py-3 text-xs font-mono text-neutral-600 dark:text-neutral-400 placeholder-neutral-400 dark:placeholder-neutral-500 focus:bg-white/90 dark:focus:bg-neutral-800/90 focus:outline-none transition-all shadow-sm">You are an impartial AI judge. Two models answered the same prompt. Score each response 1-10 on: Accuracy, Completeness, Clarity, Reasoning. Provide an overall score for each.

Then provide a "value assessment" considering:
- Model A (MODEL_A_NAME) — LOCAL_OR_CLOUD_A, MODEL_A_SPEED tok/s, took MODEL_A_TIME seconds, cost MODEL_A_COST
- Model B (MODEL_B_NAME) — LOCAL_OR_CLOUD_B, MODEL_B_SPEED tok/s, took MODEL_B_TIME seconds, cost MODEL_B_COST

Note: Local models are free regardless of usage volume. Cloud model pricing is approximately $0.15 per 1M input tokens and $0.60 per 1M output tokens (adjust if you know the actual pricing).

Is the quality difference worth the cost/speed difference for this type of task?

Format your response as:
SCORES: A=[score]/10, B=[score]/10
[Your detailed analysis]</textarea>
              <p id="judgePromptHint" class="text-[10px] text-neutral-400 mt-1 hidden">Placeholders: MODEL_A_NAME, MODEL_B_NAME, MODEL_A_SPEED, MODEL_B_SPEED, MODEL_A_TIME, MODEL_B_TIME, MODEL_A_COST, MODEL_B_COST, LOCAL_OR_CLOUD_A, LOCAL_OR_CLOUD_B</p>
            </div>

            <!-- Action buttons -->
            <div class="flex gap-2">
              <button id="compareRunBtn" class="flex-1 px-4 py-2.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                <span id="compareRunText">Run Comparison</span>
              </button>
              <button id="compareAbortBtn" class="hidden px-4 py-2.5 rounded-lg bg-rose-600 dark:bg-rose-500 text-sm font-medium text-white hover:bg-rose-700 dark:hover:bg-rose-600 transition-all shadow-sm flex items-center justify-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
                Abort
              </button>
            </div>

            <div id="compareWarning" class="hidden text-xs text-amber-600 dark:text-amber-400 bg-amber-50/50 dark:bg-amber-900/10 border border-amber-200/40 dark:border-amber-800/30 rounded-lg p-3"></div>
          </div>

          <!-- Progress -->
          <div id="compareProgress" class="hidden space-y-2">
            <div class="flex items-center gap-3">
              <div class="w-2 h-2 rounded-full bg-neutral-400 animate-pulse"></div>
              <span id="compareProgressText" class="text-sm text-neutral-500 dark:text-neutral-400">Running...</span>
              <span id="compareElapsed" class="text-xs text-neutral-400 ml-auto">0s</span>
            </div>
          </div>

          <!-- Results -->
          <div id="compareResults" class="hidden space-y-4">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div class="bg-white/50 dark:bg-neutral-800/50 border border-green-200/40 dark:border-green-800/30 rounded-2xl p-5 backdrop-blur-md space-y-3">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <span class="w-2 h-2 rounded-full bg-green-500"></span>
                    <span id="resultAName" class="text-sm font-medium text-neutral-900 dark:text-neutral-100">Model A</span>
                  </div>
                  <span id="resultAScore" class="text-xs font-bold px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 hidden"></span>
                </div>
                <div id="resultAText" class="text-sm text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap max-h-80 overflow-y-auto"></div>
                <div id="resultAMetrics" class="border-t border-neutral-200/40 dark:border-neutral-700/40 pt-3 space-y-1"></div>
              </div>
              <div class="bg-white/50 dark:bg-neutral-800/50 border border-blue-200/40 dark:border-blue-800/30 rounded-2xl p-5 backdrop-blur-md space-y-3">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <span class="w-2 h-2 rounded-full bg-blue-500"></span>
                    <span id="resultBName" class="text-sm font-medium text-neutral-900 dark:text-neutral-100">Model B</span>
                  </div>
                  <span id="resultBScore" class="text-xs font-bold px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hidden"></span>
                </div>
                <div id="resultBText" class="text-sm text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap max-h-80 overflow-y-auto"></div>
                <div id="resultBMetrics" class="border-t border-neutral-200/40 dark:border-neutral-700/40 pt-3 space-y-1"></div>
              </div>
            </div>
            <!-- Judge -->
            <div id="compareJudgeResult" class="hidden bg-white/50 dark:bg-neutral-800/50 border border-purple-200/40 dark:border-purple-800/30 rounded-2xl p-5 backdrop-blur-md space-y-3">
              <div class="flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
                <span class="text-sm font-medium text-neutral-900 dark:text-neutral-100">AI Judge Analysis</span>
                <span id="judgeModelLabel" class="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400"></span>
              </div>
              <div id="judgeAnalysisText" class="text-sm text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap"></div>
            </div>
          </div>
        </div>
      </div>
    `;

    this._bind(container);
    this._populateSelectors();
  },

  async _populateSelectors() {
    const modelA = document.querySelector('#compareModelA');
    const modelB = document.querySelector('#compareModelB');
    const judgeModel = document.querySelector('#compareJudgeModel');

    // Build unified options list: local models + cloud models
    const localOptions = [];
    const cloudOptions = [];

    // Local models
    try {
      const status = await window.api.engine.status();
      for (const m of (status.models || [])) {
        const name = m.name || m.filename?.replace('.gguf', '');
        const size = m.sizeGB ? ` (${m.sizeGB} GB)` : '';
        localOptions.push({ value: `local:${m.filename}`, label: `🟢 ${name}${size}`, isLocal: true });
      }
    } catch {}

    // Cloud models
    try {
      const vendor = await window.api.settings.get('gateway.vendor') || 'openai';
      const keyMap = { openai: 'openai.apiKey', anthropic: 'anthropic.apiKey', openrouter: 'openrouter.apiKey' };
      const hasKey = await window.api.settings.get(keyMap[vendor]);
      const currentModel = await window.api.settings.get('gateway.model');

      if (hasKey) {
        const CLOUD_MODELS = {
          openai: ['gpt-5.4-mini', 'gpt-4o', 'gpt-4o-mini', 'o4-mini', 'gpt-5'],
          anthropic: ['claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022'],
          openrouter: ['openai/gpt-5.4-mini', 'anthropic/claude-sonnet-4', 'google/gemini-2.5-flash'],
        };
        for (const m of (CLOUD_MODELS[vendor] || CLOUD_MODELS.openai)) {
          cloudOptions.push({ value: `cloud:${m}`, label: `☁️ ${m}`, isCurrent: m === currentModel });
        }
      }
    } catch {}

    if (!localOptions.length && !cloudOptions.length) {
      const msg = '<option value="">No models available</option>';
      modelA.innerHTML = msg;
      modelB.innerHTML = msg;
      judgeModel.innerHTML = msg;
      return;
    }

    const buildOptions = (defaultLocal) => {
      let html = '';
      if (localOptions.length) {
        html += '<optgroup label="Local (Private, Free)">';
        html += localOptions.map(o => `<option value="${o.value}">${o.label}</option>`).join('');
        html += '</optgroup>';
      }
      if (cloudOptions.length) {
        html += '<optgroup label="Cloud (API Key)">';
        html += cloudOptions.map(o => `<option value="${o.value}">${o.label}</option>`).join('');
        html += '</optgroup>';
      }
      return html;
    };

    const optionsHtml = buildOptions();
    modelA.innerHTML = optionsHtml;
    modelB.innerHTML = optionsHtml;
    judgeModel.innerHTML = optionsHtml;

    // Default selections: A = first local, B = first cloud, Judge = first cloud
    if (localOptions.length) modelA.value = localOptions[0].value;
    if (cloudOptions.length) {
      const current = cloudOptions.find(o => o.isCurrent);
      modelB.value = (current || cloudOptions[0]).value;
      judgeModel.value = (current || cloudOptions[0]).value;
    } else if (localOptions.length > 1) {
      modelB.value = localOptions[1].value;
      judgeModel.value = localOptions[0].value;
    }
  },

  _bind(container) {
    const prompt = container.querySelector('#comparePrompt');
    const runBtn = container.querySelector('#compareRunBtn');
    const runText = container.querySelector('#compareRunText');
    const abortBtn = container.querySelector('#compareAbortBtn');
    const progress = container.querySelector('#compareProgress');
    const progressText = container.querySelector('#compareProgressText');
    const elapsedEl = container.querySelector('#compareElapsed');
    const results = container.querySelector('#compareResults');
    const judgeToggle = container.querySelector('#compareJudgeToggle');
    const judgePromptInput = container.querySelector('#judgePromptInput');
    const judgePromptHint = container.querySelector('#judgePromptHint');
    const toggleJudgePromptBtn = container.querySelector('#toggleJudgePrompt');

    toggleJudgePromptBtn.addEventListener('click', () => {
      judgePromptInput.classList.toggle('hidden');
      judgePromptHint.classList.toggle('hidden');
    });

    // Abort
    abortBtn.addEventListener('click', () => {
      if (this.abortController) {
        this.abortController.abort();
        this.abortController = null;
      }
      window.api.compare.abort();
      progressText.textContent = 'Aborted.';
      abortBtn.classList.add('hidden');
      runBtn.disabled = false;
      runText.textContent = 'Run Comparison';
      this.isRunning = false;
    });

    runBtn.addEventListener('click', async () => {
      const text = prompt.value.trim();
      if (!text || this.isRunning) return;

      const modelAVal = container.querySelector('#compareModelA')?.value;
      const modelBVal = container.querySelector('#compareModelB')?.value;
      const judgeVal = container.querySelector('#compareJudgeModel')?.value;

      if (!modelAVal) { alert('Select Model A.'); return; }
      if (!modelBVal) { alert('Select Model B.'); return; }

      this.isRunning = true;
      this.abortController = new AbortController();
      runBtn.disabled = true;
      runText.textContent = 'Running...';
      abortBtn.classList.remove('hidden');
      progress.classList.remove('hidden');
      results.classList.add('hidden');

      // Elapsed timer
      const startTime = Date.now();
      const timer = setInterval(() => {
        elapsedEl.textContent = `${Math.round((Date.now() - startTime) / 1000)}s`;
      }, 1000);

      try {
        // Run Model A
        progressText.textContent = 'Running Model A...';
        const resultA = await window.api.compare.runModel(text, modelAVal);

        if (!this.isRunning) { clearInterval(timer); return; } // aborted

        // Run Model B
        progressText.textContent = 'Running Model B...';
        const resultB = await window.api.compare.runModel(text, modelBVal);

        if (!this.isRunning) { clearInterval(timer); return; }

        this._showResults(resultA, resultB);

        // Judge
        if (judgeToggle.checked && judgeVal && (resultA.success || resultB.success)) {
          progressText.textContent = 'AI judge analyzing...';
          const customJudgePrompt = judgePromptInput.value.trim() || null;
          const judgeResult = await window.api.compare.judge(text, resultA, resultB, judgeVal, customJudgePrompt);
          this._showJudge(judgeResult);
        }

        progress.classList.add('hidden');
      } catch (err) {
        if (err.name !== 'AbortError') {
          progressText.textContent = `Error: ${err.message}`;
        }
      } finally {
        clearInterval(timer);
        this.isRunning = false;
        this.abortController = null;
        runBtn.disabled = false;
        runText.textContent = 'Run Comparison';
        abortBtn.classList.add('hidden');
      }
    });
  },

  _showResults(a, b) {
    const results = document.querySelector('#compareResults');
    results.classList.remove('hidden');

    const isLocalA = a.isLocal;
    const isLocalB = b.isLocal;

    document.querySelector('#resultAName').textContent = a.modelName || 'Model A';
    document.querySelector('#resultAText').textContent = a.success ? a.content : `Error: ${a.error}`;
    document.querySelector('#resultAMetrics').innerHTML = a.success ? `
      <div class="flex justify-between text-[11px]"><span class="text-neutral-400">Speed</span><span class="text-neutral-600 dark:text-neutral-300 font-medium">${a.tokPerSec || '—'} tok/s</span></div>
      <div class="flex justify-between text-[11px]"><span class="text-neutral-400">Tokens</span><span class="text-neutral-600 dark:text-neutral-300">${a.tokensOut || '—'} out</span></div>
      <div class="flex justify-between text-[11px]"><span class="text-neutral-400">Time</span><span class="text-neutral-600 dark:text-neutral-300">${a.totalTime || '—'}s</span></div>
      <div class="flex justify-between text-[11px]"><span class="text-neutral-400">Cost</span><span class="text-neutral-600 dark:text-neutral-300 font-medium">${isLocalA ? 'Free' : '~$' + (a.cost || '0.00')}</span></div>
    ` : '';

    document.querySelector('#resultBName').textContent = b.modelName || 'Model B';
    document.querySelector('#resultBText').textContent = b.success ? b.content : `Error: ${b.error}`;
    document.querySelector('#resultBMetrics').innerHTML = b.success ? `
      <div class="flex justify-between text-[11px]"><span class="text-neutral-400">Speed</span><span class="text-neutral-600 dark:text-neutral-300 font-medium">${b.tokPerSec || '—'} tok/s</span></div>
      <div class="flex justify-between text-[11px]"><span class="text-neutral-400">Tokens</span><span class="text-neutral-600 dark:text-neutral-300">${b.tokensOut || '—'} out</span></div>
      <div class="flex justify-between text-[11px]"><span class="text-neutral-400">Time</span><span class="text-neutral-600 dark:text-neutral-300">${b.totalTime || '—'}s</span></div>
      <div class="flex justify-between text-[11px]"><span class="text-neutral-400">Cost</span><span class="text-neutral-600 dark:text-neutral-300 font-medium">${isLocalB ? 'Free' : '~$' + (b.cost || '0.00')}</span></div>
    ` : '';
  },

  _showJudge(judge) {
    const judgeEl = document.querySelector('#compareJudgeResult');
    if (!judge || !judge.success) { judgeEl.classList.add('hidden'); return; }
    judgeEl.classList.remove('hidden');
    document.querySelector('#judgeModelLabel').textContent = judge.judgeModel || '';
    document.querySelector('#judgeAnalysisText').textContent = judge.analysis || 'No analysis available.';
    if (judge.scoreA) { const el = document.querySelector('#resultAScore'); el.textContent = `${judge.scoreA}/10`; el.classList.remove('hidden'); }
    if (judge.scoreB) { const el = document.querySelector('#resultBScore'); el.textContent = `${judge.scoreB}/10`; el.classList.remove('hidden'); }
  },
};

window.ComparePage = ComparePage;
