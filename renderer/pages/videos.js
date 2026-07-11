// Videos page — AI video generation with local storage

const VIDEO_MODELS = [
  { id: 'veo-3.1-fast', name: 'Veo 3.1 Fast', desc: 'Google — fast default', durations: [4, 6, 8] },
  { id: 'veo-3.1', name: 'Veo 3.1', desc: 'Google — high quality', durations: [4, 6, 8] },
  { id: 'kling-2.6', name: 'Kling 2.6', desc: 'KlingAI — fast', durations: [5, 10] },
  { id: 'wan-2.6', name: 'Wan 2.6', desc: 'Alibaba — creative', durations: [5] },
  { id: 'seedance-1', name: 'Seedance 1', desc: 'ByteDance — motion', durations: [5] },
];

const VideosPage = {
  isGenerating: false,

  render(container) {
    container.innerHTML = `
      <div id="videosPage" class="flex flex-col flex-1 min-h-0">
        <div class="flex-1 overflow-y-auto p-6 space-y-4">
          <h2 class="text-lg font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Generate Videos</h2>

          <div class="space-y-3">
            <div>
              <label class="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-1.5 block">Prompt</label>
              <textarea id="videoPrompt" rows="3"
                placeholder="Describe the video you want to create..."
                class="w-full resize-none bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2.5 text-sm text-neutral-700 dark:text-neutral-300 placeholder-neutral-400 dark:placeholder-neutral-500 focus:bg-white/90 dark:focus:bg-neutral-800/90 focus:outline-none transition-all shadow-sm"></textarea>
            </div>

            <div class="flex gap-3">
              <div class="flex-1">
                <label class="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-1.5 block">Model</label>
                <select id="videoModel" class="w-full bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2.5 text-sm text-neutral-700 dark:text-neutral-300 focus:bg-white/90 dark:focus:bg-neutral-800/90 focus:outline-none transition-all shadow-sm">
                  ${VIDEO_MODELS.map(m => `<option value="${m.id}" data-durations="${m.durations.join(',')}">${m.name} — ${m.desc}</option>`).join('')}
                </select>
              </div>
              <div class="w-24">
                <label class="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-1.5 block">Duration</label>
                <select id="videoDuration" class="w-full bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2.5 text-sm text-neutral-700 dark:text-neutral-300 focus:bg-white/90 dark:focus:bg-neutral-800/90 focus:outline-none transition-all shadow-sm">
                </select>
              </div>
              <div class="w-28">
                <label class="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-1.5 block">Aspect</label>
                <select id="videoAspect" class="w-full bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2.5 text-sm text-neutral-700 dark:text-neutral-300 focus:bg-white/90 dark:focus:bg-neutral-800/90 focus:outline-none transition-all shadow-sm">
                  <option value="16:9">16:9</option>
                  <option value="9:16">9:16</option>
                  <option value="1:1">1:1</option>
                </select>
              </div>
            </div>

            <button id="videoGenBtn"
              class="w-full px-4 py-2.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m22 8-6 4 6 4V8Z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg> Generate Video
            </button>
          </div>

          <!-- Result area -->
          <div id="videoResult" class="hidden">
            <div id="videoLoading" class="hidden text-center py-8">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="text-neutral-400"><path d="m22 8-6 4 6 4V8Z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
              <p class="text-sm text-neutral-500 mt-2">Generating video — this can take a few minutes...</p>
              <div class="mt-3 w-48 mx-auto bg-neutral-100 dark:bg-neutral-800 rounded-full h-1.5 overflow-hidden">
                <div class="bg-neutral-900 h-1.5 rounded-full animate-pulse" style="width:60%"></div>
              </div>
              <p id="videoTimer" class="text-xs text-neutral-400 mt-2">0:00</p>
            </div>
            <div id="videoOutput" class="hidden">
              <video id="generatedVideo" controls class="w-full rounded-2xl border border-neutral-200/40 dark:border-neutral-700/40 shadow-sm"></video>
              <div class="flex items-center justify-between mt-3">
                <span id="videoModelUsed" class="text-xs text-neutral-400"></span>
                <span id="videoSavedLabel" class="text-xs text-emerald-600 hidden">✓ Saved locally</span>
              </div>
            </div>
            <div id="videoError" class="hidden bg-rose-50 border border-rose-100 rounded-xl p-3 text-sm text-rose-700"></div>
          </div>

          <!-- History -->
          <div>
            <h3 id="videoHistoryTitle" class="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2 hidden">Recent Videos</h3>
            <div id="videoHistory" class="space-y-3"></div>
          </div>
        </div>
      </div>
    `;

    this._bind(container);
    this._loadHistory(container);
  },

  _bind(container) {
    const prompt = container.querySelector('#videoPrompt');
    const model = container.querySelector('#videoModel');
    const duration = container.querySelector('#videoDuration');
    const aspect = container.querySelector('#videoAspect');
    const genBtn = container.querySelector('#videoGenBtn');
    const result = container.querySelector('#videoResult');
    const loading = container.querySelector('#videoLoading');
    const timer = container.querySelector('#videoTimer');
    const output = container.querySelector('#videoOutput');
    const video = container.querySelector('#generatedVideo');
    const modelUsed = container.querySelector('#videoModelUsed');
    const savedLabel = container.querySelector('#videoSavedLabel');
    const videoError = container.querySelector('#videoError');

    let timerInterval = null;

    // Update duration options based on model
    const updateDurations = () => {
      const sel = model.options[model.selectedIndex];
      const durations = (sel.dataset.durations || '5').split(',').map(Number);
      duration.innerHTML = durations.map(d => `<option value="${d}">${d}s</option>`).join('');
    };
    model.addEventListener('change', updateDurations);
    updateDurations(); // init

    genBtn.addEventListener('click', async () => {
      const text = prompt.value.trim();
      if (!text || this.isGenerating) return;

      this.isGenerating = true;
      genBtn.disabled = true;
      genBtn.textContent = 'Generating...';
      result.classList.remove('hidden');
      loading.classList.remove('hidden');
      output.classList.add('hidden');
      videoError.classList.add('hidden');
      savedLabel.classList.add('hidden');

      // Start timer
      let seconds = 0;
      timer.textContent = '0:00';
      timerInterval = setInterval(() => {
        seconds++;
        const m = Math.floor(seconds / 60);
        const s = String(seconds % 60).padStart(2, '0');
        timer.textContent = `${m}:${s}`;
      }, 1000);

      try {
        const res = await window.api.gateway.generateVideo(
          text, model.value, aspect.value, parseInt(duration.value)
        );

        clearInterval(timerInterval);

        if (res.success && res.video) {
          // Save to local storage
          const id = `vid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const filename = `${id}.mp4`;

          await window.api.media.saveVideo({
            id, prompt: text, model: model.value,
            filename, uint8Array: res.video,
          });

          // Display video
          const filePath = await window.api.media.getPath(filename);
          video.src = `file://${filePath}`;
          modelUsed.textContent = model.value;
          savedLabel.classList.remove('hidden');

          loading.classList.add('hidden');
          output.classList.remove('hidden');

          // Refresh history
          this._loadHistory(container);
        } else {
          loading.classList.add('hidden');
          videoError.textContent = res.error || 'Failed to generate video';
          videoError.classList.remove('hidden');
        }
      } catch (err) {
        clearInterval(timerInterval);
        loading.classList.add('hidden');
        videoError.textContent = err.message || 'Unexpected error';
        videoError.classList.remove('hidden');
      } finally {
        this.isGenerating = false;
        genBtn.disabled = false;
        genBtn.textContent = 'Generate Video';
      }
    });

    prompt.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!genBtn.disabled) genBtn.click();
      }
    });
  },

  async _loadHistory(container) {
    const history = container.querySelector('#videoHistory');
    const title = container.querySelector('#videoHistoryTitle');
    if (!history) return;

    try {
      const items = await window.api.media.list('video', 20);
      if (!items?.length) {
        history.innerHTML = '';
        title.classList.add('hidden');
        return;
      }

      title.classList.remove('hidden');
      history.innerHTML = '';

      for (const item of items) {
        const filePath = await window.api.media.getPath(item.filename);
        const sizeMB = (item.file_size / 1e6).toFixed(1);
        const date = new Date(item.created_at).toLocaleDateString();

        const el = document.createElement('div');
        el.className = 'flex gap-3 p-3 rounded-2xl bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 backdrop-blur-md hover:bg-white/80 dark:hover:bg-neutral-700/80 transition-all items-center';
        el.innerHTML = `
          <div class="w-20 h-14 bg-gray-200 rounded flex items-center justify-center flex-shrink-0 overflow-hidden">
            <video src="file://${filePath}" class="w-full h-full object-cover" muted preload="metadata"></video>
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-xs text-neutral-700 dark:text-neutral-300 truncate">${item.prompt || 'No prompt'}</p>
            <p class="text-[10px] text-neutral-400">${item.model} · ${sizeMB}MB · ${date}</p>
          </div>
          <button data-id="${item.id}" class="vid-del text-neutral-300 hover:text-rose-600 text-xs px-1">✕</button>
        `;
        history.appendChild(el);
      }

      // Delete handlers
      history.querySelectorAll('.vid-del').forEach(btn => {
        btn.addEventListener('click', async () => {
          await window.api.media.delete(btn.dataset.id);
          this._loadHistory(container);
        });
      });
    } catch {
      history.innerHTML = '<p class="text-xs text-neutral-400">Could not load history</p>';
    }
  },

  destroy() {}
};

window.VideosPage = VideosPage;
