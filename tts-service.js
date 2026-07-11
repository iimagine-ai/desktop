// TTS Service — persistent Kokoro server for low-latency speech synthesis
// Architecture: spawns a Python HTTP server on first use, keeps it alive, sends requests via HTTP

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { EventEmitter } = require('events');

const TTS_DIR = path.join(os.homedir(), '.iimagine', 'tts');
const TTS_VENV = path.join(TTS_DIR, 'venv');
const TTS_OUTPUT_DIR = path.join(TTS_DIR, 'output');
const VOICE_CLIPS_DIR = path.join(TTS_DIR, 'voice-clips');
const TTS_PORT = 9876;
const SERVER_SCRIPT = path.join(TTS_DIR, 'kokoro-server.py');

class TTSService extends EventEmitter {
  constructor() {
    super();
    this.serverProcess = null;
    this.serverReady = false;
    this.serverStarting = false;
    this.settings = {
      autoplay: false,
      voiceCloneAudioPath: null,
      model: 'kokoro',
      voice: 'af_heart',
    };
  }

  // ─── Public API ─────────────────────────────────────────────────

  async initialize() {
    this._ensureDir(TTS_DIR);
    this._ensureDir(TTS_OUTPUT_DIR);
    this._ensureDir(VOICE_CLIPS_DIR);
    await this._loadSettings();
    // Start server in background (don't block app startup)
    this._ensureServerRunning().catch(err => {
      console.warn('[TTS] Server startup deferred:', err.message);
    });
    return { ready: true, model: 'kokoro' };
  }

  async checkSetup() {
    const pythonPath = this._getPythonPath();
    const hasPython = fs.existsSync(pythonPath);
    const hasKokoro = hasPython && this._checkPackage('kokoro');
    return {
      hasPython,
      hasMlxAudio: hasKokoro,
      venvPath: TTS_VENV,
      ready: hasPython && hasKokoro,
    };
  }

  async setup(progressCallback) {
    try {
      if (progressCallback) progressCallback({ step: 'venv', message: 'Creating Python environment...' });
      const python3 = this._findSystemPython();
      if (!python3) throw new Error('Python 3 not found. Please install Python 3.10+');

      if (!fs.existsSync(TTS_VENV)) {
        execSync(`"${python3}" -m venv "${TTS_VENV}"`, { timeout: 30000 });
      }

      if (progressCallback) progressCallback({ step: 'pip', message: 'Installing Kokoro TTS...' });
      const pip = this._getPipPath();
      execSync(`"${pip}" install --upgrade pip`, { timeout: 60000 });
      execSync(`"${pip}" install kokoro soundfile numpy`, { timeout: 300000 });

      if (progressCallback) progressCallback({ step: 'done', message: 'TTS environment ready' });
      return { success: true };
    } catch (err) {
      console.error('[TTS] Setup failed:', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Generate speech from text. Uses persistent HTTP server for low latency.
   * Returns: { audioPath, duration }
   */
  async synthesize(text, options = {}) {
    if (!text || !text.trim()) return null;

    // Strip markdown/emoji for cleaner speech
    const cleanText = text.replace(/[*_~`#>\[\]()]/g, '').replace(/\n+/g, ' ').trim();
    if (!cleanText) return null;

    const voice = options.voice || this.settings.voice || 'af_heart';
    const outputFile = path.join(TTS_OUTPUT_DIR, `tts-${Date.now()}.wav`);

    console.log(`[TTS] Synthesizing "${cleanText.slice(0, 50)}..." with voice=${voice}`);

    // Ensure server is running
    await this._ensureServerRunning();

    // Send request to persistent server
    const result = await this._httpPost('/synthesize', {
      text: cleanText,
      voice,
      output_path: outputFile,
    });

    if (result.ok && fs.existsSync(outputFile)) {
      console.log(`[TTS] Done in ${result.elapsed}s — ${outputFile} (${result.duration}s audio)`);
      return { audioPath: outputFile, model: 'kokoro', duration: result.duration };
    } else {
      throw new Error(`TTS synthesis failed: ${result.error || 'unknown error'}`);
    }
  }

  async setVoiceClone(audioFilePath) {
    if (!audioFilePath || !fs.existsSync(audioFilePath)) throw new Error('Audio file not found');
    const ext = path.extname(audioFilePath);
    const dest = path.join(VOICE_CLIPS_DIR, `voice-clone${ext}`);
    fs.copyFileSync(audioFilePath, dest);
    this.settings.voiceCloneAudioPath = dest;
    await this._saveSettings();
    return { path: dest };
  }

  async clearVoiceClone() {
    if (this.settings.voiceCloneAudioPath && fs.existsSync(this.settings.voiceCloneAudioPath)) {
      fs.unlinkSync(this.settings.voiceCloneAudioPath);
    }
    this.settings.voiceCloneAudioPath = null;
    await this._saveSettings();
  }

  async updateSettings(newSettings) {
    Object.assign(this.settings, newSettings);
    await this._saveSettings();
    return this.settings;
  }

  getSettings() {
    return { ...this.settings };
  }

  getRecommendedModel() {
    return 'kokoro'; // Only one model now
  }

  /**
   * Gracefully shut down the TTS server (called on app quit).
   */
  shutdown() {
    if (this.serverProcess) {
      console.log('[TTS] Shutting down server...');
      const pid = this.serverProcess.pid;
      try {
        // Kill the entire process group to avoid orphans
        process.kill(-pid, 'SIGTERM');
      } catch {
        try { this.serverProcess.kill('SIGKILL'); } catch {}
      }
      this.serverProcess = null;
      this.serverReady = false;
    }
  }

  registerIPC(ipcMain) {
    ipcMain.handle('tts:check-setup', async () => this.checkSetup());
    ipcMain.handle('tts:setup', async () => this.setup());
    ipcMain.handle('tts:synthesize', async (_event, text, options) => {
      console.log('[TTS] IPC synthesize called, text length:', text?.length);
      return this.synthesize(text, options);
    });
    ipcMain.handle('tts:set-voice-clone', async (_event, audioPath) => this.setVoiceClone(audioPath));
    ipcMain.handle('tts:clear-voice-clone', async () => this.clearVoiceClone());
    ipcMain.handle('tts:get-settings', async () => this.getSettings());
    ipcMain.handle('tts:update-settings', async (_event, settings) => this.updateSettings(settings));
    ipcMain.handle('tts:get-recommended-model', async () => this.getRecommendedModel());
  }

  // ─── Private: Server Management ────────────────────────────────

  async _ensureServerRunning() {
    // Already running? Check health
    if (this.serverReady) {
      try {
        const health = await this._httpGet('/health');
        if (health.ok) return;
      } catch {}
      // Server died, restart
      this.serverReady = false;
      this.serverProcess = null;
    }

    // Already starting? Wait for it
    if (this.serverStarting) {
      return this._waitForServer();
    }

    this.serverStarting = true;

    const pythonPath = this._getPythonPath();
    if (!fs.existsSync(pythonPath)) {
      this.serverStarting = false;
      throw new Error('TTS not set up. Run setup first.');
    }
    if (!fs.existsSync(SERVER_SCRIPT)) {
      this.serverStarting = false;
      throw new Error('Kokoro server script not found at ' + SERVER_SCRIPT);
    }

    console.log('[TTS] Starting Kokoro server...');

    this.serverProcess = spawn(pythonPath, [SERVER_SCRIPT], {
      env: { ...process.env, PATH: `${path.dirname(pythonPath)}:${process.env.PATH}` },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });

    this.serverProcess.stderr.on('data', (d) => {
      const msg = d.toString().trim();
      if (msg && !msg.includes('UserWarning') && !msg.includes('FutureWarning')) {
        console.error('[TTS:stderr]', msg);
      }
    });

    this.serverProcess.on('exit', (code) => {
      console.log(`[TTS] Server exited (code ${code})`);
      this.serverReady = false;
      this.serverProcess = null;
    });

    // Wait for READY signal on stdout
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('TTS server startup timed out (30s)'));
      }, 30000);

      this.serverProcess.stdout.on('data', (d) => {
        const line = d.toString();
        if (line.includes('READY')) {
          clearTimeout(timeout);
          this.serverReady = true;
          this.serverStarting = false;
          console.log('[TTS] Server ready');
          resolve();
        }
        // Forward logs
        if (line.includes('[KokoroServer]')) {
          console.log('[TTS]', line.trim());
        }
      });
    });
  }

  async _waitForServer(maxWait = 30000) {
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      if (this.serverReady) return;
      await new Promise(r => setTimeout(r, 200));
    }
    throw new Error('TTS server did not become ready in time');
  }

  _httpGet(urlPath) {
    return new Promise((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${TTS_PORT}${urlPath}`, { timeout: 5000 }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch { reject(new Error('Invalid JSON from TTS server')); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('TTS server timeout')); });
    });
  }

  _httpPost(urlPath, body) {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(body);
      const options = {
        hostname: '127.0.0.1',
        port: TTS_PORT,
        path: urlPath,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        timeout: 60000, // 60s for synthesis
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch { reject(new Error('Invalid JSON from TTS server')); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('TTS synthesis timeout')); });
      req.write(payload);
      req.end();
    });
  }

  // ─── Private: Utility ───────────────────────────────────────────

  _findSystemPython() {
    const candidates = ['python3', 'python'];
    for (const cmd of candidates) {
      try {
        const version = execSync(`${cmd} --version 2>&1`, { encoding: 'utf8', timeout: 5000 });
        if (version.includes('3.')) return cmd;
      } catch {}
    }
    const paths = ['/usr/bin/python3', '/usr/local/bin/python3', '/opt/homebrew/bin/python3'];
    for (const p of paths) { if (fs.existsSync(p)) return p; }
    return null;
  }

  _getPythonPath() { return path.join(TTS_VENV, 'bin', 'python3'); }
  _getPipPath() { return path.join(TTS_VENV, 'bin', 'pip'); }

  _checkPackage(packageName) {
    try {
      execSync(`"${this._getPythonPath()}" -c "import ${packageName}"`, { timeout: 10000 });
      return true;
    } catch { return false; }
  }

  async _loadSettings() {
    const settingsPath = path.join(TTS_DIR, 'settings.json');
    try {
      if (fs.existsSync(settingsPath)) {
        Object.assign(this.settings, JSON.parse(fs.readFileSync(settingsPath, 'utf8')));
      }
    } catch (err) { console.warn('[TTS] Failed to load settings:', err.message); }
  }

  async _saveSettings() {
    const settingsPath = path.join(TTS_DIR, 'settings.json');
    try { fs.writeFileSync(settingsPath, JSON.stringify(this.settings, null, 2), 'utf8'); }
    catch (err) { console.warn('[TTS] Failed to save settings:', err.message); }
  }

  _ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

// Singleton
const ttsService = new TTSService();

module.exports = {
  initialize: () => ttsService.initialize(),
  checkSetup: () => ttsService.checkSetup(),
  setup: (cb) => ttsService.setup(cb),
  synthesize: (text, opts) => ttsService.synthesize(text, opts),
  setVoiceClone: (p) => ttsService.setVoiceClone(p),
  clearVoiceClone: () => ttsService.clearVoiceClone(),
  updateSettings: (s) => ttsService.updateSettings(s),
  getSettings: () => ttsService.getSettings(),
  getRecommendedModel: () => ttsService.getRecommendedModel(),
  registerIPC: (ipcMain) => ttsService.registerIPC(ipcMain),
  shutdown: () => ttsService.shutdown(),
};
