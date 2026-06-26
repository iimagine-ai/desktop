// Download Manager — handles downloading GGUF model files from HuggingFace
// Features: progress tracking, resume support, queue system, persistent state

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { EventEmitter } = require('events');
const os = require('os');
// Model lookups resolve against the live manifest (cache → remote → bundled),
// so newly published models are downloadable without an app release.
const manifestManager = require('./manifest-manager');
const getModel = (modelId) => manifestManager.getModel(modelId);

const MODELS_DIR = path.join(os.homedir(), '.iimagine', 'models');
const SD_MODELS_DIR = path.join(os.homedir(), '.iimagine', 'sd-models');
const STATE_FILE = path.join(os.homedir(), '.iimagine', 'download-state.json');
const INSTALLED_FILE = path.join(os.homedir(), '.iimagine', 'installed-models.json');

const MAX_CONCURRENT = 1;
const MAX_RETRIES = 3;
const PROGRESS_INTERVAL = 500; // ms
const MAX_REDIRECTS = 5;

class DownloadManager extends EventEmitter {
  constructor() {
    super();
    this.state = { active: null, queue: [], downloads: {} };
    this.activeRequest = null;
    this.activeStream = null;
    this.progressTimer = null;
    this.retryCount = 0;
    this.lastBytesTime = 0;
    this.lastBytesValue = 0;
  }

  // ─── Public API ─────────────────────────────────────────────────

  /**
   * Initialize the download manager — set up directories, load state.
   */
  async initialize() {
    this._ensureDir(MODELS_DIR);
    this._ensureDir(SD_MODELS_DIR);
    this._ensureDir(path.dirname(STATE_FILE));
    this._loadState();
    this._loadInstalled();

    // Resume any download that was active when app closed
    if (this.state.active) {
      const dl = this.state.downloads[this.state.active];
      if (dl && dl.status === 'downloading') {
        dl.status = 'paused';
        this._saveState();
        // Auto-resume after a short delay
        setTimeout(() => this.startDownload(dl.modelId, dl.variantIndex), 1000);
      }
    }

    return this.getDownloadState();
  }

  /**
   * Start or resume a download.
   */
  async startDownload(modelId, variantIndex = 0) {
    const model = getModel(modelId);
    if (!model) throw new Error(`Model not found: ${modelId}`);

    // Skip models that use huggingface-cli (TTS/audio models) — they are
    // downloaded via tts-service.js, not the HTTP download manager.
    if (model.downloadMethod === 'huggingface-cli') {
      throw new Error(`Model ${modelId} uses huggingface-cli for download. Use the Voice settings to set it up.`);
    }

    const variant = model.variants[variantIndex];
    if (!variant) throw new Error(`Variant index ${variantIndex} not found for ${modelId}`);
    if (!variant.url) throw new Error(`No download URL for ${modelId} variant ${variantIndex}`);

    let dl = this.state.downloads[modelId];

    if (dl && dl.status === 'completed') {
      return dl;
    }

    if (!dl) {
      // Route to correct directory based on model engine type
      const targetDir = model.engineType === 'stable-diffusion' ? SD_MODELS_DIR : MODELS_DIR;
      dl = {
        modelId,
        variantIndex,
        status: 'queued',
        bytesDownloaded: 0,
        totalBytes: 0,
        filename: variant.filename,
        filepath: path.join(targetDir, variant.filename),
        url: variant.url,
        startedAt: new Date().toISOString(),
        error: null,
      };
      this.state.downloads[modelId] = dl;
    }

    // If something is already downloading, queue this one
    if (this.state.active && this.state.active !== modelId) {
      dl.status = 'queued';
      if (!this.state.queue.includes(modelId)) {
        this.state.queue.push(modelId);
      }
      this._saveState();
      this._emitState();
      return dl;
    }

    // Start the download
    dl.status = 'downloading';
    dl.error = null;
    this.state.active = modelId;
    this.retryCount = 0;
    this._saveState();
    this._emitState();

    this._startHttpDownload(dl);
    return dl;
  }

  /**
   * Pause an active download.
   */
  pauseDownload(modelId) {
    const dl = this.state.downloads[modelId];
    if (!dl || dl.status !== 'downloading') return dl;

    this._abortActive();
    dl.status = 'paused';
    this.state.active = null;
    this._saveState();
    this._emitState();
    this._processQueue();
    return dl;
  }

  /**
   * Cancel a download and delete the partial file.
   */
  cancelDownload(modelId) {
    const dl = this.state.downloads[modelId];
    if (!dl) return null;

    if (dl.status === 'downloading') {
      this._abortActive();
    }

    // Remove partial file
    const partPath = dl.filepath + '.part';
    if (fs.existsSync(partPath)) {
      fs.unlinkSync(partPath);
    }

    // Remove from queue
    this.state.queue = this.state.queue.filter(id => id !== modelId);
    if (this.state.active === modelId) {
      this.state.active = null;
    }
    delete this.state.downloads[modelId];
    this._saveState();
    this._emitState();
    this._processQueue();
    return { modelId, status: 'cancelled' };
  }

  /**
   * Delete a downloaded model file.
   */
  deleteModel(modelId, variantIndex = 0) {
    const model = getModel(modelId);
    if (!model) throw new Error(`Model not found: ${modelId}`);

    const variant = model.variants[variantIndex];
    if (!variant) throw new Error(`Variant not found`);

    const targetDir = model.engineType === 'stable-diffusion' ? SD_MODELS_DIR : MODELS_DIR;
    const filepath = path.join(targetDir, variant.filename);
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
    }

    // Remove from installed list
    const installed = this._loadInstalled();
    const idx = installed.findIndex(m => m.modelId === modelId && m.variantIndex === variantIndex);
    if (idx !== -1) {
      installed.splice(idx, 1);
      this._saveInstalled(installed);
    }

    // Remove download record
    if (this.state.downloads[modelId]) {
      delete this.state.downloads[modelId];
      this._saveState();
    }

    this._emitState();
    return { modelId, deleted: true };
  }

  /**
   * Get current state of all downloads.
   */
  getDownloadState() {
    return {
      active: this.state.active,
      queue: [...this.state.queue],
      downloads: { ...this.state.downloads },
    };
  }

  /**
   * Get list of installed model files with paths.
   */
  getInstalledModels() {
    return this._loadInstalled();
  }

  /**
   * Get the models directory path.
   */
  getModelsDir() {
    return MODELS_DIR;
  }

  /**
   * Register IPC handlers for Electron.
   */
  registerIPC(ipcMain) {
    ipcMain.handle('model:download-start', async (_event, modelId, variantIndex) => {
      return this.startDownload(modelId, variantIndex);
    });

    ipcMain.handle('model:download-pause', async (_event, modelId) => {
      return this.pauseDownload(modelId);
    });

    ipcMain.handle('model:download-cancel', async (_event, modelId) => {
      return this.cancelDownload(modelId);
    });

    ipcMain.handle('model:download-delete', async (_event, modelId, variantIndex) => {
      return this.deleteModel(modelId, variantIndex);
    });

    ipcMain.handle('model:download-state', async () => {
      return this.getDownloadState();
    });

    ipcMain.handle('model:installed-list', async () => {
      return this.getInstalledModels();
    });
  }

  // ─── Private Methods ────────────────────────────────────────────

  _startHttpDownload(dl) {
    const partPath = dl.filepath + '.part';

    // Check existing partial file for resume
    let startByte = 0;
    if (fs.existsSync(partPath)) {
      const stat = fs.statSync(partPath);
      startByte = stat.size;
      dl.bytesDownloaded = startByte;
    }

    this.lastBytesTime = Date.now();
    this.lastBytesValue = startByte;

    this._doRequest(dl.url, startByte, dl, 0);
  }

  _doRequest(url, startByte, dl, redirectCount) {
    if (redirectCount > MAX_REDIRECTS) {
      this._handleError(dl, new Error('Too many redirects'));
      return;
    }

    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {},
    };

    if (startByte > 0) {
      options.headers['Range'] = `bytes=${startByte}-`;
    }

    const req = client.get(options, (res) => {
      // Handle redirects
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
        const location = res.headers.location;
        if (!location) {
          this._handleError(dl, new Error('Redirect without location header'));
          return;
        }
        const redirectUrl = location.startsWith('http') ? location : new URL(location, url).href;
        res.resume(); // Consume response to free memory
        this._doRequest(redirectUrl, startByte, dl, redirectCount + 1);
        return;
      }

      if (res.statusCode === 416) {
        // Range not satisfiable — file is already complete
        this._completeDownload(dl);
        return;
      }

      if (res.statusCode !== 200 && res.statusCode !== 206) {
        res.resume();
        this._handleError(dl, new Error(`HTTP ${res.statusCode}`));
        return;
      }

      // Get total size
      if (res.statusCode === 200) {
        dl.totalBytes = parseInt(res.headers['content-length'], 10) || 0;
        dl.bytesDownloaded = 0;
        startByte = 0;
        // Truncate any existing partial file since server didn't honor range
        if (fs.existsSync(dl.filepath + '.part')) {
          fs.unlinkSync(dl.filepath + '.part');
        }
      } else if (res.statusCode === 206) {
        const contentRange = res.headers['content-range'];
        if (contentRange) {
          const match = contentRange.match(/bytes \d+-\d+\/(\d+)/);
          if (match) dl.totalBytes = parseInt(match[1], 10);
        }
      }

      this._saveState();

      const partPath = dl.filepath + '.part';
      const fileStream = fs.createWriteStream(partPath, { flags: startByte > 0 ? 'a' : 'w' });
      this.activeStream = fileStream;

      // Start progress timer
      this._startProgressTimer(dl);

      res.on('data', (chunk) => {
        dl.bytesDownloaded += chunk.length;
        // Update totalBytes if the server reported wrong size (e.g. after redirect)
        if (dl.totalBytes > 0 && dl.bytesDownloaded > dl.totalBytes) {
          dl.totalBytes = 0; // Reset — we don't know the real size
        }
      });

      res.pipe(fileStream);

      fileStream.on('finish', () => {
        this._stopProgressTimer();
        if (dl.status === 'downloading') {
          this._completeDownload(dl);
        }
      });

      fileStream.on('error', (err) => {
        this._stopProgressTimer();
        this._handleError(dl, err);
      });

      res.on('error', (err) => {
        this._stopProgressTimer();
        fileStream.close();
        this._handleError(dl, err);
      });
    });

    req.on('error', (err) => {
      this._handleError(dl, err);
    });

    this.activeRequest = req;
  }

  _completeDownload(dl) {
    const partPath = dl.filepath + '.part';

    // Rename .part to final filename
    if (fs.existsSync(partPath)) {
      fs.renameSync(partPath, dl.filepath);
    }

    dl.status = 'completed';
    dl.completedAt = new Date().toISOString();
    this.state.active = null;
    this._saveState();

    // Add to installed models
    const installed = this._loadInstalled();
    const existing = installed.findIndex(m => m.modelId === dl.modelId);
    const entry = {
      modelId: dl.modelId,
      variantIndex: dl.variantIndex,
      filename: dl.filename,
      filepath: dl.filepath,
      sizeBytes: dl.totalBytes || dl.bytesDownloaded,
      installedAt: new Date().toISOString(),
    };
    if (existing !== -1) {
      installed[existing] = entry;
    } else {
      installed.push(entry);
    }
    this._saveInstalled(installed);

    this._emitState();
    this.emit('download-complete', dl);
    this._processQueue();
  }

  _handleError(dl, err) {
    this._stopProgressTimer();

    if (dl.status !== 'downloading') return; // Already paused/cancelled

    this.retryCount++;
    if (this.retryCount <= MAX_RETRIES) {
      const delay = Math.pow(2, this.retryCount) * 1000; // Exponential backoff
      console.warn(`[DownloadManager] Retry ${this.retryCount}/${MAX_RETRIES} in ${delay}ms:`, err.message);
      dl.error = `Retry ${this.retryCount}/${MAX_RETRIES}: ${err.message}`;
      this._saveState();
      this._emitState();
      setTimeout(() => {
        if (dl.status === 'downloading') {
          this._startHttpDownload(dl);
        }
      }, delay);
    } else {
      dl.status = 'failed';
      dl.error = err.message;
      this.state.active = null;
      this._saveState();
      this._emitState();
      this.emit('download-failed', dl);
      this._processQueue();
    }
  }

  _abortActive() {
    this._stopProgressTimer();
    if (this.activeRequest) {
      this.activeRequest.destroy();
      this.activeRequest = null;
    }
    if (this.activeStream) {
      this.activeStream.close();
      this.activeStream = null;
    }
  }

  _processQueue() {
    if (this.state.active) return;
    if (this.state.queue.length === 0) return;

    const nextId = this.state.queue.shift();
    const dl = this.state.downloads[nextId];
    if (dl && dl.status === 'queued') {
      this.startDownload(nextId, dl.variantIndex);
    } else {
      this._saveState();
      this._processQueue();
    }
  }

  _startProgressTimer(dl) {
    this._stopProgressTimer();
    this.progressTimer = setInterval(() => {
      if (dl.status !== 'downloading') {
        this._stopProgressTimer();
        return;
      }

      const now = Date.now();
      const elapsed = (now - this.lastBytesTime) / 1000;
      const bytesDelta = dl.bytesDownloaded - this.lastBytesValue;
      const speedBps = elapsed > 0 ? bytesDelta / elapsed : 0;
      const speedMBps = speedBps / (1024 * 1024);

      const remaining = dl.totalBytes - dl.bytesDownloaded;
      const eta = speedBps > 0 ? Math.round(remaining / speedBps) : null;
      const percentage = dl.totalBytes > 0
        ? Math.min(Math.round((dl.bytesDownloaded / dl.totalBytes) * 100), 100)
        : 0;

      this.lastBytesTime = now;
      this.lastBytesValue = dl.bytesDownloaded;

      const progress = {
        modelId: dl.modelId,
        percentage,
        speedMBps: Math.round(speedMBps * 100) / 100,
        eta,
        bytesDownloaded: dl.bytesDownloaded,
        totalBytes: dl.totalBytes,
      };

      this.emit('download-progress', progress);
      this._saveState();
    }, PROGRESS_INTERVAL);
  }

  _stopProgressTimer() {
    if (this.progressTimer) {
      clearInterval(this.progressTimer);
      this.progressTimer = null;
    }
  }

  _emitState() {
    this.emit('state-changed', this.getDownloadState());
  }

  // ─── Persistence ────────────────────────────────────────────────

  _loadState() {
    try {
      if (fs.existsSync(STATE_FILE)) {
        const data = fs.readFileSync(STATE_FILE, 'utf8');
        this.state = JSON.parse(data);
      }
    } catch (err) {
      console.warn('[DownloadManager] Failed to load state:', err.message);
      this.state = { active: null, queue: [], downloads: {} };
    }
  }

  _saveState() {
    try {
      fs.writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 2), 'utf8');
    } catch (err) {
      console.warn('[DownloadManager] Failed to save state:', err.message);
    }
  }

  _loadInstalled() {
    try {
      if (fs.existsSync(INSTALLED_FILE)) {
        const data = fs.readFileSync(INSTALLED_FILE, 'utf8');
        return JSON.parse(data);
      }
    } catch (err) {
      console.warn('[DownloadManager] Failed to load installed:', err.message);
    }
    return [];
  }

  _saveInstalled(installed) {
    try {
      fs.writeFileSync(INSTALLED_FILE, JSON.stringify(installed, null, 2), 'utf8');
    } catch (err) {
      console.warn('[DownloadManager] Failed to save installed:', err.message);
    }
  }

  _ensureDir(dir) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

// Singleton instance
const downloadManager = new DownloadManager();

module.exports = {
  initialize: () => downloadManager.initialize(),
  startDownload: (modelId, variantIndex) => downloadManager.startDownload(modelId, variantIndex),
  pauseDownload: (modelId) => downloadManager.pauseDownload(modelId),
  cancelDownload: (modelId) => downloadManager.cancelDownload(modelId),
  deleteModel: (modelId, variantIndex) => downloadManager.deleteModel(modelId, variantIndex),
  getDownloadState: () => downloadManager.getDownloadState(),
  getInstalledModels: () => downloadManager.getInstalledModels(),
  getModelsDir: () => downloadManager.getModelsDir(),
  registerIPC: (ipcMain) => downloadManager.registerIPC(ipcMain),
  // Expose emitter for main process listeners
  on: (event, handler) => downloadManager.on(event, handler),
  off: (event, handler) => downloadManager.off(event, handler),
};
