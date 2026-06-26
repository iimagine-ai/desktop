// Images page — AI image generation (cloud + local)
// Local generation uses stable-diffusion.cpp via sd-engine-manager
// Supports both text-to-image and image-to-image (img2img) modes

const CLOUD_MODELS = [
  { id: 'flux-2-flex', name: 'Flux 2 Flex', desc: 'Fast, high quality', type: 'cloud' },
  { id: 'imagen-4', name: 'Imagen 4', desc: 'Photorealistic', type: 'cloud' },
  { id: 'recraft-v3', name: 'Recraft V3', desc: 'Professional grade', type: 'cloud' },
  { id: 'gemini-2.5-flash-image', name: 'Gemini Flash Image', desc: 'Multimodal (experimental)', type: 'cloud' },
  { id: 'gemini-3-pro-image', name: 'Gemini Pro Image', desc: 'Multimodal (experimental)', type: 'cloud' },
];

const ImagesPage = {
  isGenerating: false,
  localModels: [],
  activeTab: 'txt2img', // 'txt2img' | 'img2img'
  inputImageData: null,  // base64 data for img2img

  async render(container) {
    // Check for local SD models
    try {
      const status = await window.api.sd.status();
      this.localModels = (status.models || []).map(m => ({
        id: `local:${m.filename}`,
        name: m.name,
        desc: `${m.sizeGB} GB — Local`,
        type: 'local',
        path: m.path,
        filename: m.filename,
      }));
    } catch {
      this.localModels = [];
    }

    const allModels = [...this.localModels, ...CLOUD_MODELS];
    const hasLocal = this.localModels.length > 0;
    const sdEngineInstalled = (await window.api.sd.status()).installed;

    container.innerHTML = `
      <div id="imagesPage" class="flex flex-col flex-1 min-h-0">
        <div class="flex-1 overflow-y-auto p-6 space-y-4">
          <h2 class="text-lg font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Generate Images</h2>

          <!-- Local model download prompt (shown when engine exists but no models) -->
          ${sdEngineInstalled && !hasLocal ? `
          <div id="sdDownloadPrompt" class="bg-green-50/60 dark:bg-green-900/10 border border-green-200/50 dark:border-green-800/30 rounded-xl p-4 space-y-2">
            <div class="flex items-center gap-2">
              <span class="text-green-600 dark:text-green-400">🟢</span>
              <span class="text-sm font-medium text-green-800 dark:text-green-200">Local Image Generation Available</span>
            </div>
            <p class="text-xs text-green-700 dark:text-green-300">Download SDXL Turbo (3.9 GB) to generate images privately on your machine. Runs in 1–4 steps on Apple Silicon.</p>
            <div class="flex items-center gap-2">
              <button id="downloadSdxlBtn" class="px-3 py-1.5 rounded-lg bg-green-700 dark:bg-green-600 text-xs font-medium text-white hover:bg-green-800 dark:hover:bg-green-700 transition-all shadow-sm">Download SDXL Turbo</button>
              <span id="sdDownloadStatus" class="text-[10px] text-green-600 dark:text-green-400 hidden"></span>
            </div>
            <div id="sdDownloadProgress" class="hidden">
              <div class="w-full bg-green-200/60 dark:bg-green-900/40 rounded-full h-1.5 overflow-hidden">
                <div id="sdDownloadFill" class="bg-green-600 dark:bg-green-400 h-full rounded-full transition-all duration-300" style="width: 0%"></div>
              </div>
              <p id="sdDownloadText" class="text-[10px] text-green-600 dark:text-green-400 mt-1">Downloading...</p>
            </div>
          </div>
          ` : ''}

          <!-- Mode tabs (only show if local models available) -->
          ${hasLocal ? `
          <div class="flex gap-1 p-1 bg-neutral-100/60 dark:bg-neutral-800/60 rounded-lg w-fit">
            <button id="tabTxt2img" class="px-3 py-1.5 text-xs font-medium rounded-md transition-all ${this.activeTab === 'txt2img' ? 'bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100 shadow-sm' : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'}">Text → Image</button>
            <button id="tabImg2img" class="px-3 py-1.5 text-xs font-medium rounded-md transition-all ${this.activeTab === 'img2img' ? 'bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100 shadow-sm' : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'}">Image → Image</button>
          </div>
          ` : ''}

          <div class="space-y-3">
            <!-- Img2img input area (hidden by default) -->
            <div id="img2imgInput" class="${this.activeTab === 'img2img' ? '' : 'hidden'}">
              <label class="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-1.5 block">Source Image</label>
              <div id="dropZone" class="border-2 border-dashed border-neutral-200/60 dark:border-neutral-700/60 rounded-xl p-4 text-center cursor-pointer hover:border-neutral-400 dark:hover:border-neutral-500 transition-colors">
                <div id="dropZonePlaceholder">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mx-auto text-neutral-300 dark:text-neutral-600 mb-2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
                  <p class="text-xs text-neutral-400">Drop an image here or click to select</p>
                </div>
                <img id="inputPreview" class="hidden max-h-40 mx-auto rounded-lg" />
                <input id="imageFileInput" type="file" accept="image/*" class="hidden" />
              </div>

              <div class="mt-2">
                <label class="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-1 block">Strength <span id="strengthValue" class="text-neutral-600 dark:text-neutral-300">0.45</span></label>
                <input id="strengthSlider" type="range" min="0.1" max="0.9" step="0.05" value="0.45" class="w-full h-1.5 bg-neutral-200 dark:bg-neutral-700 rounded-lg appearance-none cursor-pointer" />
                <div class="flex justify-between text-[10px] text-neutral-400 mt-0.5">
                  <span>Subtle</span>
                  <span>Strong</span>
                </div>
              </div>
            </div>

            <div>
              <label class="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-1.5 block">Prompt</label>
              <textarea id="imagePrompt" rows="3" placeholder="${this.activeTab === 'img2img' ? 'Describe how to transform the image...' : 'Describe the image you want to create...'}"
                class="w-full resize-none bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2.5 text-sm text-neutral-700 dark:text-neutral-300 placeholder-neutral-400 dark:placeholder-neutral-500 focus:bg-white/90 dark:focus:bg-neutral-800/90 focus:outline-none transition-all shadow-sm"></textarea>
            </div>

            <div class="flex gap-3">
              <div class="flex-1">
                <label class="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-1.5 block">Model</label>
                <select id="imageModel" class="w-full bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2.5 text-sm text-neutral-700 dark:text-neutral-300 focus:bg-white/90 dark:focus:bg-neutral-800/90 focus:outline-none transition-all shadow-sm">
                  ${hasLocal ? '<optgroup label="🟢 Local (Private)">' : ''}
                  ${this.localModels.map(m => `<option value="${m.id}">🟢 ${m.name} — ${m.desc}</option>`).join('')}
                  ${hasLocal ? '</optgroup>' : ''}
                  <optgroup label="☁️ Cloud">
                  ${CLOUD_MODELS.map(m => `<option value="${m.id}">${m.name} — ${m.desc}</option>`).join('')}
                  </optgroup>
                </select>
              </div>
              <div class="w-32" id="aspectGroup">
                <label class="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-1.5 block">Aspect</label>
                <select id="imageAspect" class="w-full bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-3 py-2.5 text-sm text-neutral-700 dark:text-neutral-300 focus:bg-white/90 dark:focus:bg-neutral-800/90 focus:outline-none transition-all shadow-sm">
                  <option value="">Default</option>
                  <option value="1:1">1:1</option>
                  <option value="16:9">16:9</option>
                  <option value="4:3">4:3</option>
                  <option value="9:16">9:16</option>
                </select>
              </div>
            </div>

            <!-- Local model options (steps, seed) -->
            <div id="localOptions" class="${hasLocal ? '' : 'hidden'} space-y-2">
              <div class="flex gap-3">
                <div class="w-24">
                  <label class="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-1 block">Steps</label>
                  <input id="stepsInput" type="number" min="1" max="50" value="4" class="w-full bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-lg px-2.5 py-2 text-sm text-neutral-700 dark:text-neutral-300 focus:outline-none" />
                </div>
                <div class="w-32">
                  <label class="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-1 block">Seed</label>
                  <input id="seedInput" type="number" value="-1" class="w-full bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-lg px-2.5 py-2 text-sm text-neutral-700 dark:text-neutral-300 focus:outline-none" placeholder="Random" />
                </div>
              </div>
              <p class="text-[10px] text-neutral-400">SDXL Turbo works best at 1–4 steps. Seed -1 = random.</p>
            </div>

            <button id="generateBtn" class="w-full px-4 py-2.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m15 4-1 1M4 15l1-1"/><path d="m2 2 20 20"/><path d="m9 5 .5-.5M5 9l-.5.5M14 14l.5-.5"/></svg>
              <span id="generateBtnText">Generate Image</span>
            </button>
          </div>

          <!-- Progress bar -->
          <div id="progressBar" class="hidden">
            <div class="w-full bg-neutral-200 dark:bg-neutral-700 rounded-full h-2 overflow-hidden">
              <div id="progressFill" class="bg-neutral-900 dark:bg-neutral-100 h-full rounded-full transition-all duration-300" style="width: 0%"></div>
            </div>
            <p id="progressText" class="text-xs text-neutral-400 mt-1 text-center">Generating...</p>
          </div>

          <!-- Result area -->
          <div id="imageResult" class="hidden">
            <div id="imageLoading" class="hidden text-center py-8">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="text-neutral-400 animate-pulse"><circle cx="13.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="10.5" r="1.5"/><circle cx="8.5" cy="7.5" r="1.5"/><circle cx="6.5" cy="12.5" r="1.5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>
              <p class="text-sm text-neutral-500 mt-2">Generating image...</p>
            </div>
            <div id="imageOutput" class="hidden">
              <img id="generatedImage" class="w-full rounded-2xl border border-neutral-200/40 dark:border-neutral-700/40 shadow-sm" />
              <div class="flex items-center justify-between mt-3">
                <div class="flex items-center gap-2">
                  <span id="imageModelUsed" class="text-xs text-neutral-400"></span>
                  <span id="imagePrivacyBadge" class="hidden text-[10px] px-1.5 py-0.5 rounded-full font-medium"></span>
                </div>
                <div class="flex gap-2">
                  <button id="useAsInputBtn" class="hidden px-3 py-1.5 rounded-lg bg-neutral-200 dark:bg-neutral-700 text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-300 dark:hover:bg-neutral-600 transition-all flex items-center gap-1">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
                    Use as input
                  </button>
                  <button id="saveImageBtn" class="px-4 py-2 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm flex items-center gap-1.5">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Save
                  </button>
                </div>
              </div>
            </div>
            <div id="imageError" class="hidden bg-rose-50 dark:bg-rose-900/20 border border-rose-100 dark:border-rose-800/30 rounded-xl p-3 text-sm text-rose-700 dark:text-rose-300"></div>
          </div>

          <!-- History -->
          <div id="imageHistory" class="space-y-3"></div>
        </div>
      </div>
    `;

    this._bind(container);
  },

  _bind(container) {
    const prompt = container.querySelector('#imagePrompt');
    const model = container.querySelector('#imageModel');
    const aspect = container.querySelector('#imageAspect');
    const aspectGroup = container.querySelector('#aspectGroup');
    const generateBtn = container.querySelector('#generateBtn');
    const generateBtnText = container.querySelector('#generateBtnText');
    const result = container.querySelector('#imageResult');
    const loading = container.querySelector('#imageLoading');
    const output = container.querySelector('#imageOutput');
    const generatedImage = container.querySelector('#generatedImage');
    const imageModelUsed = container.querySelector('#imageModelUsed');
    const imagePrivacyBadge = container.querySelector('#imagePrivacyBadge');
    const imageError = container.querySelector('#imageError');
    const saveImageBtn = container.querySelector('#saveImageBtn');
    const useAsInputBtn = container.querySelector('#useAsInputBtn');
    const history = container.querySelector('#imageHistory');
    const progressBar = container.querySelector('#progressBar');
    const progressFill = container.querySelector('#progressFill');
    const progressText = container.querySelector('#progressText');
    const localOptions = container.querySelector('#localOptions');
    const stepsInput = container.querySelector('#stepsInput');
    const seedInput = container.querySelector('#seedInput');

    // Img2img elements
    const img2imgInput = container.querySelector('#img2imgInput');
    const dropZone = container.querySelector('#dropZone');
    const dropZonePlaceholder = container.querySelector('#dropZonePlaceholder');
    const inputPreview = container.querySelector('#inputPreview');
    const imageFileInput = container.querySelector('#imageFileInput');
    const strengthSlider = container.querySelector('#strengthSlider');
    const strengthValue = container.querySelector('#strengthValue');

    // Tab elements
    const tabTxt2img = container.querySelector('#tabTxt2img');
    const tabImg2img = container.querySelector('#tabImg2img');

    let lastImageData = null;

    // ── SD model download ──────────────────────────────────────────
    const downloadSdxlBtn = container.querySelector('#downloadSdxlBtn');
    const sdDownloadProgress = container.querySelector('#sdDownloadProgress');
    const sdDownloadFill = container.querySelector('#sdDownloadFill');
    const sdDownloadText = container.querySelector('#sdDownloadText');
    const sdDownloadStatus = container.querySelector('#sdDownloadStatus');
    const sdDownloadPrompt = container.querySelector('#sdDownloadPrompt');

    if (downloadSdxlBtn) {
      downloadSdxlBtn.addEventListener('click', async () => {
        downloadSdxlBtn.disabled = true;
        downloadSdxlBtn.textContent = 'Downloading...';
        if (sdDownloadProgress) sdDownloadProgress.classList.remove('hidden');

        window.api.sd.onDownloadProgress((data) => {
          if (sdDownloadFill) sdDownloadFill.style.width = `${data.percent}%`;
          const mb = (data.downloaded / 1e6).toFixed(0);
          const totalMb = (data.total / 1e6).toFixed(0);
          if (sdDownloadText) sdDownloadText.textContent = `${mb} MB / ${totalMb} MB (${data.percent}%)`;
        });

        window.api.sd.onDownloadDone((data) => {
          if (data.success) {
            if (sdDownloadPrompt) {
              sdDownloadPrompt.innerHTML = `
                <div class="flex items-center gap-2">
                  <span class="text-green-600 dark:text-green-400">✓</span>
                  <span class="text-sm font-medium text-green-800 dark:text-green-200">SDXL Turbo installed! Reload the page to use it.</span>
                </div>
              `;
            }
          } else {
            downloadSdxlBtn.disabled = false;
            downloadSdxlBtn.textContent = 'Retry Download';
            if (sdDownloadText) sdDownloadText.textContent = `Error: ${data.error}`;
          }
        });

        try {
          await window.api.sd.downloadModel(
            'https://huggingface.co/gpustack/stable-diffusion-xl-1.0-turbo-GGUF/resolve/main/stable-diffusion-xl-1.0-turbo-Q4_0.gguf',
            'stable-diffusion-xl-1.0-turbo-Q4_0.gguf'
          );
        } catch (err) {
          downloadSdxlBtn.disabled = false;
          downloadSdxlBtn.textContent = 'Retry Download';
          if (sdDownloadText) sdDownloadText.textContent = `Error: ${err.message}`;
        }
      });
    }

    // ── Tab switching ──────────────────────────────────────────────
    if (tabTxt2img) {
      tabTxt2img.addEventListener('click', () => {
        this.activeTab = 'txt2img';
        tabTxt2img.classList.add('bg-white', 'dark:bg-neutral-700', 'text-neutral-900', 'dark:text-neutral-100', 'shadow-sm');
        tabTxt2img.classList.remove('text-neutral-500');
        tabImg2img.classList.remove('bg-white', 'dark:bg-neutral-700', 'text-neutral-900', 'dark:text-neutral-100', 'shadow-sm');
        tabImg2img.classList.add('text-neutral-500');
        img2imgInput.classList.add('hidden');
        prompt.placeholder = 'Describe the image you want to create...';
      });
    }

    if (tabImg2img) {
      tabImg2img.addEventListener('click', () => {
        this.activeTab = 'img2img';
        tabImg2img.classList.add('bg-white', 'dark:bg-neutral-700', 'text-neutral-900', 'dark:text-neutral-100', 'shadow-sm');
        tabImg2img.classList.remove('text-neutral-500');
        tabTxt2img.classList.remove('bg-white', 'dark:bg-neutral-700', 'text-neutral-900', 'dark:text-neutral-100', 'shadow-sm');
        tabTxt2img.classList.add('text-neutral-500');
        img2imgInput.classList.remove('hidden');
        prompt.placeholder = 'Describe how to transform the image...';
      });
    }

    // ── Img2img file handling ──────────────────────────────────────
    if (dropZone) {
      dropZone.addEventListener('click', () => imageFileInput.click());

      dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('border-neutral-400', 'dark:border-neutral-500');
      });

      dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('border-neutral-400', 'dark:border-neutral-500');
      });

      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('border-neutral-400', 'dark:border-neutral-500');
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) {
          this._loadInputImage(file, inputPreview, dropZonePlaceholder);
        }
      });

      imageFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          this._loadInputImage(file, inputPreview, dropZonePlaceholder);
        }
      });
    }

    // Strength slider
    if (strengthSlider) {
      strengthSlider.addEventListener('input', () => {
        strengthValue.textContent = strengthSlider.value;
      });
    }

    // ── Model selection changes ────────────────────────────────────
    model.addEventListener('change', () => {
      const isLocal = model.value.startsWith('local:');
      if (localOptions) {
        localOptions.classList.toggle('hidden', !isLocal);
      }
      // Hide aspect ratio for local models (uses fixed 1024x1024)
      if (aspectGroup) {
        aspectGroup.classList.toggle('hidden', isLocal);
      }
    });

    // Trigger initial state
    if (model.value.startsWith('local:')) {
      if (localOptions) localOptions.classList.remove('hidden');
      if (aspectGroup) aspectGroup.classList.add('hidden');
    }

    // ── Progress listener ──────────────────────────────────────────
    window.api.sd.onProgress((progress) => {
      if (progressBar) {
        progressBar.classList.remove('hidden');
        progressFill.style.width = `${progress.percent}%`;
        progressText.textContent = `Step ${progress.step}/${progress.totalSteps}`;
      }
    });

    // ── Generate ───────────────────────────────────────────────────
    generateBtn.addEventListener('click', async () => {
      const text = prompt.value.trim();
      if (!text || this.isGenerating) return;

      this.isGenerating = true;
      generateBtn.disabled = true;
      generateBtnText.textContent = 'Generating...';
      result.classList.remove('hidden');
      loading.classList.remove('hidden');
      output.classList.add('hidden');
      imageError.classList.add('hidden');
      progressBar.classList.add('hidden');

      const selectedModel = model.value;
      const isLocal = selectedModel.startsWith('local:');

      try {
        let res;

        if (isLocal) {
          // Local generation via stable-diffusion.cpp
          const localModel = this.localModels.find(m => m.id === selectedModel);
          if (!localModel) throw new Error('Local model not found');

          const steps = parseInt(stepsInput?.value) || 4;
          const seed = parseInt(seedInput?.value) || -1;

          if (this.activeTab === 'img2img' && this.inputImageData) {
            // Image-to-image
            const strength = parseFloat(strengthSlider?.value) || 0.45;
            res = await window.api.sd.img2img({
              modelPath: localModel.path,
              inputImageBase64: this.inputImageData,
              prompt: text,
              strength,
              steps,
              seed,
            });
          } else {
            // Text-to-image
            res = await window.api.sd.txt2img({
              modelPath: localModel.path,
              prompt: text,
              steps,
              seed,
              width: 1024,
              height: 1024,
            });
          }
        } else {
          // Cloud generation via gateway
          res = await window.api.gateway.generateImage(
            text,
            selectedModel,
            aspect.value || undefined
          );
        }

        progressBar.classList.add('hidden');

        if (res.success && res.image) {
          const src = `data:${res.mediaType || 'image/png'};base64,${res.image}`;
          generatedImage.src = src;
          imageModelUsed.textContent = isLocal ? this.localModels.find(m => m.id === selectedModel)?.name : (res.model || selectedModel);
          lastImageData = { base64: res.image, mediaType: res.mediaType, prompt: text };

          // Privacy badge
          if (isLocal) {
            imagePrivacyBadge.textContent = '🟢 Local';
            imagePrivacyBadge.className = 'text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300';
            imagePrivacyBadge.classList.remove('hidden');
            useAsInputBtn.classList.remove('hidden');
          } else {
            imagePrivacyBadge.textContent = '☁️ Cloud';
            imagePrivacyBadge.className = 'text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300';
            imagePrivacyBadge.classList.remove('hidden');
            useAsInputBtn.classList.toggle('hidden', this.localModels.length === 0);
          }

          loading.classList.add('hidden');
          output.classList.remove('hidden');

          // Auto-save to local media storage
          const ext = (res.mediaType || 'image/png').split('/')[1] || 'png';
          const id = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const filename = `${id}.${ext}`;
          try {
            await window.api.media.save({
              id, type: 'image', prompt: text, model: selectedModel,
              filename, mediaType: res.mediaType || 'image/png', base64Data: res.image,
            });
          } catch (e) { console.warn('Failed to save image locally:', e); }

          // Add to history
          const histItem = document.createElement('div');
          histItem.className = 'flex gap-3 p-3 rounded-2xl bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 backdrop-blur-md hover:bg-white/80 dark:hover:bg-neutral-700/80 transition-all';
          histItem.innerHTML = `
            <img src="${src}" class="w-16 h-16 rounded object-cover flex-shrink-0" />
            <div class="min-w-0">
              <p class="text-xs text-neutral-700 dark:text-neutral-300 truncate">${text}</p>
              <p class="text-[10px] text-neutral-400">${isLocal ? '🟢 ' : ''}${isLocal ? this.localModels.find(m => m.id === selectedModel)?.name : selectedModel}</p>
            </div>
          `;
          history.prepend(histItem);
        } else {
          loading.classList.add('hidden');
          imageError.textContent = res.error || 'Failed to generate image';
          imageError.classList.remove('hidden');
        }
      } catch (err) {
        loading.classList.add('hidden');
        progressBar.classList.add('hidden');
        imageError.textContent = err.message || 'Unexpected error';
        imageError.classList.remove('hidden');
      } finally {
        this.isGenerating = false;
        generateBtn.disabled = false;
        generateBtnText.textContent = 'Generate Image';
      }
    });

    // ── Use as img2img input ──────────────────────────────────────
    useAsInputBtn.addEventListener('click', () => {
      if (!lastImageData) return;
      this.inputImageData = lastImageData.base64;
      inputPreview.src = `data:${lastImageData.mediaType};base64,${lastImageData.base64}`;
      inputPreview.classList.remove('hidden');
      if (dropZonePlaceholder) dropZonePlaceholder.classList.add('hidden');

      // Switch to img2img tab
      if (tabImg2img) tabImg2img.click();
    });

    // Save image to disk via download
    saveImageBtn.addEventListener('click', () => {
      if (!lastImageData) return;
      const ext = lastImageData.mediaType?.split('/')[1] || 'png';
      const link = document.createElement('a');
      link.href = `data:${lastImageData.mediaType};base64,${lastImageData.base64}`;
      link.download = `iimagine-${Date.now()}.${ext}`;
      link.click();
    });

    prompt.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!generateBtn.disabled) generateBtn.click();
      }
    });
  },

  /**
   * Load an image file into the img2img input
   * @private
   */
  _loadInputImage(file, preview, placeholder) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      // Extract base64 from data URL
      const base64 = dataUrl.split(',')[1];
      this.inputImageData = base64;
      preview.src = dataUrl;
      preview.classList.remove('hidden');
      if (placeholder) placeholder.classList.add('hidden');
    };
    reader.readAsDataURL(file);
  },
};

window.ImagesPage = ImagesPage;
