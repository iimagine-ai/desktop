// TTS Service — manages MOSS-TTS inference via Python sidecar (mlx-audio)
// Provides: text-to-speech generation, voice cloning, model management

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { EventEmitter } = require('events');

const TTS_DIR = path.join(os.homedir(), '.iimagine', 'tts');
const TTS_VENV = path.join(TTS_DIR, 'venv');
const TTS_OUTPUT_DIR = path.join(TTS_DIR, 'output');
const VOICE_CLIPS_DIR = path.join(TTS_DIR, 'voice-clips');
const TTS_PORT = 9876;

class TTSService extends EventEmitter {
  constructor() {
    super();
    this.process = null;
    this.ready = false;
    this.activeModel = null;
    this.settings = {
      autoplay: false,
      voiceCloneAudioPath: null,
      model: null, // 'moss-tts-nano', 'moss-tts-local-transformer', 'moss-tts-v1.5-gguf'
    };
  }

  // ─── Public API ─────────────────────────────────────────────────

  async initialize() {
    this._ensureDir(TTS_DIR);
    this._ensureDir(TTS_OUTPUT_DIR);
    this._ensureDir(VOICE_CLIPS_DIR);
    await this._loadSettings();
    return { ready: this.ready, model: this.activeModel };
  }

  /**
   * Check if the TTS Python environment is set up.
   */
  async checkSetup() {
    const pythonPath = this._getPythonPath();
    const hasPython = fs.existsSync(pythonPath);
    const hasTransformers = hasPython && this._checkPackage('transformers');
    return {
      hasPython,
      hasMlxAudio: hasTransformers, // kept for backward compat
      venvPath: TTS_VENV,
      ready: hasPython && hasTransformers,
    };
  }

  /**
   * Install the TTS Python environment (one-time setup).
   * Creates a venv and installs mlx-audio.
   */
  async setup(progressCallback) {
    try {
      if (progressCallback) progressCallback({ step: 'venv', message: 'Creating Python environment...' });

      // Find system python3
      const python3 = this._findSystemPython();
      if (!python3) {
        throw new Error('Python 3 not found. Please install Python 3.10+ from python.org');
      }

      // Create venv
      if (!fs.existsSync(TTS_VENV)) {
        execSync(`"${python3}" -m venv "${TTS_VENV}"`, { timeout: 30000 });
      }

      if (progressCallback) progressCallback({ step: 'pip', message: 'Installing mlx-audio (this may take a few minutes)...' });

      const pip = this._getPipPath();
      // Install mlx-audio which bundles MOSS-TTS support for Apple Silicon
      execSync(`"${pip}" install --upgrade pip`, { timeout: 60000 });
      execSync(`"${pip}" install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu`, { timeout: 600000 });
      execSync(`"${pip}" install transformers==5.0.0 soundfile huggingface-hub`, { timeout: 300000 });

      if (progressCallback) progressCallback({ step: 'model', message: 'Downloading TTS model...' });

      // Download the selected model (or default to Nano) via huggingface_hub Python API
      const model = this.settings.model || 'moss-tts-nano';
      const repoMap = {
        'moss-tts-nano': 'OpenMOSS-Team/MOSS-TTS-Nano',
        'moss-tts-local-transformer': 'OpenMOSS-Team/MOSS-TTS-Local-Transformer',
        'moss-tts-v1.5': 'OpenMOSS-Team/MOSS-TTS-v1.5',
      };
      const repo = repoMap[model] || repoMap['moss-tts-nano'];
      const pythonPath = this._getPythonPath();
      execSync(`"${pythonPath}" -c "from huggingface_hub import snapshot_download; snapshot_download('${repo}')"`, { timeout: 600000 }); // 10 min timeout for large models

      if (progressCallback) progressCallback({ step: 'done', message: 'TTS environment ready' });
      return { success: true };
    } catch (err) {
      console.error('[TTSService] Setup failed:', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Generate speech from text using the active TTS model.
   * Returns: { audioPath, duration }
   */
  async synthesize(text, options = {}) {
    if (!text || !text.trim()) return null;

    const model = options.model || this.settings.model || 'moss-tts-nano';
    const referenceAudio = options.referenceAudio || this.settings.voiceCloneAudioPath;
    const outputFile = path.join(TTS_OUTPUT_DIR, `tts-${Date.now()}.wav`);

    const pythonPath = this._getPythonPath();
    if (!fs.existsSync(pythonPath)) {
      throw new Error('TTS not set up. Run setup first.');
    }

    // Map model IDs to mlx-audio model names
    const modelMap = {
      'moss-tts-nano': 'OpenMOSS-Team/MOSS-TTS-Nano',
      'moss-tts-local-transformer': 'OpenMOSS-Team/MOSS-TTS-Local-Transformer',
      'moss-tts-v1.5-gguf': 'OpenMOSS-Team/MOSS-TTS-v1.5',
    };

    const mlxModel = modelMap[model] || modelMap['moss-tts-nano'];

    // Build the Python script inline
    const script = this._buildSynthScript(mlxModel, text, outputFile, referenceAudio);
    const scriptPath = path.join(TTS_DIR, 'synth-tmp.py');
    fs.writeFileSync(scriptPath, script, 'utf8');

    return new Promise((resolve, reject) => {
      const proc = spawn(pythonPath, [scriptPath], {
        env: { ...process.env, PATH: `${path.dirname(pythonPath)}:${process.env.PATH}` },
        timeout: 120000,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.stderr.on('data', (d) => { stderr += d.toString(); });

      proc.on('close', (code) => {
        // Clean up temp script
        try { fs.unlinkSync(scriptPath); } catch {}

        if (code === 0 && fs.existsSync(outputFile)) {
          resolve({ audioPath: outputFile, model });
        } else {
          reject(new Error(`TTS synthesis failed (code ${code}): ${stderr.slice(-500)}`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`TTS process error: ${err.message}`));
      });
    });
  }

  /**
   * Set a voice clone reference audio file.
   */
  async setVoiceClone(audioFilePath) {
    if (!audioFilePath || !fs.existsSync(audioFilePath)) {
      throw new Error('Audio file not found');
    }
    const ext = path.extname(audioFilePath);
    const dest = path.join(VOICE_CLIPS_DIR, `voice-clone${ext}`);
    fs.copyFileSync(audioFilePath, dest);
    this.settings.voiceCloneAudioPath = dest;
    await this._saveSettings();
    return { path: dest };
  }

  /**
   * Clear the voice clone reference.
   */
  async clearVoiceClone() {
    if (this.settings.voiceCloneAudioPath && fs.existsSync(this.settings.voiceCloneAudioPath)) {
      fs.unlinkSync(this.settings.voiceCloneAudioPath);
    }
    this.settings.voiceCloneAudioPath = null;
    await this._saveSettings();
  }

  /**
   * Update TTS settings.
   */
  async updateSettings(newSettings) {
    Object.assign(this.settings, newSettings);
    await this._saveSettings();
    return this.settings;
  }

  /**
   * Get current TTS settings.
   */
  getSettings() {
    return { ...this.settings };
  }

  /**
   * Get the recommended TTS model based on available RAM (after accounting for the active LLM).
   */
  getRecommendedModel(hardware, activeLLMRamGB = 0) {
    const available = (hardware.aiMemoryGB || hardware.ramGB || 8) - activeLLMRamGB - 2; // 2GB OS buffer
    if (available >= 12) return 'moss-tts-v1.5-gguf';
    if (available >= 6) return 'moss-tts-local-transformer';
    return 'moss-tts-nano';
  }

  /**
   * Register IPC handlers for Electron.
   */
  registerIPC(ipcMain) {
    ipcMain.handle('tts:check-setup', async () => this.checkSetup());
    ipcMain.handle('tts:setup', async (_event, progressCallbackId) => this.setup());
    ipcMain.handle('tts:synthesize', async (_event, text, options) => this.synthesize(text, options));
    ipcMain.handle('tts:set-voice-clone', async (_event, audioPath) => this.setVoiceClone(audioPath));
    ipcMain.handle('tts:clear-voice-clone', async () => this.clearVoiceClone());
    ipcMain.handle('tts:get-settings', async () => this.getSettings());
    ipcMain.handle('tts:update-settings', async (_event, settings) => this.updateSettings(settings));
    ipcMain.handle('tts:get-recommended-model', async (_event, hardware, llmRam) => this.getRecommendedModel(hardware, llmRam));
  }

  // ─── Private Methods ────────────────────────────────────────────

  _buildSynthScript(model, text, outputPath, referenceAudio) {
    // Escape text for Python string
    const escapedText = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
    const refLine = referenceAudio
      ? `reference_audio = "${referenceAudio.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
      : 'reference_audio = None';

    return `
import sys
import soundfile as sf

text = "${escapedText}"
model_name = "${model}"
output_path = "${outputPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"
${refLine}

try:
    from transformers import AutoModel, AutoProcessor
    import torch

    processor = AutoProcessor.from_pretrained(model_name, trust_remote_code=True)
    model = AutoModel.from_pretrained(model_name, trust_remote_code=True, dtype=torch.float32)
    model.eval()

    conversations = [[processor.build_user_message(text=text)]]
    batch = processor(conversations, mode="generation")
    input_ids = batch["input_ids"]
    attention_mask = batch["attention_mask"]

    with torch.no_grad():
        outputs = model.generate(input_ids=input_ids, attention_mask=attention_mask, max_new_tokens=2048)

    for message in processor.decode(outputs):
        audio = message.audio_codes_list[0].numpy()
        sf.write(output_path, audio, processor.model_config.sampling_rate)
        break

    print("OK")
except Exception as e:
    print(f"Error: {e}", file=sys.stderr)
    sys.exit(1)
`;
  }

  _findSystemPython() {
    const candidates = ['python3', 'python'];
    for (const cmd of candidates) {
      try {
        const version = execSync(`${cmd} --version 2>&1`, { encoding: 'utf8', timeout: 5000 });
        if (version.includes('3.')) return cmd;
      } catch {}
    }
    // Check common paths
    const paths = ['/usr/bin/python3', '/usr/local/bin/python3', '/opt/homebrew/bin/python3'];
    for (const p of paths) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  _getPythonPath() {
    return path.join(TTS_VENV, 'bin', 'python3');
  }

  _getPipPath() {
    return path.join(TTS_VENV, 'bin', 'pip');
  }

  _checkPackage(packageName) {
    try {
      const pythonPath = this._getPythonPath();
      execSync(`"${pythonPath}" -c "import ${packageName}"`, { timeout: 10000 });
      return true;
    } catch {
      return false;
    }
  }

  async _loadSettings() {
    const settingsPath = path.join(TTS_DIR, 'settings.json');
    try {
      if (fs.existsSync(settingsPath)) {
        const data = fs.readFileSync(settingsPath, 'utf8');
        Object.assign(this.settings, JSON.parse(data));
      }
    } catch (err) {
      console.warn('[TTSService] Failed to load settings:', err.message);
    }
  }

  async _saveSettings() {
    const settingsPath = path.join(TTS_DIR, 'settings.json');
    try {
      fs.writeFileSync(settingsPath, JSON.stringify(this.settings, null, 2), 'utf8');
    } catch (err) {
      console.warn('[TTSService] Failed to save settings:', err.message);
    }
  }

  _ensureDir(dir) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

// Singleton
const ttsService = new TTSService();

module.exports = {
  initialize: () => ttsService.initialize(),
  checkSetup: () => ttsService.checkSetup(),
  setup: (cb) => ttsService.setup(cb),
  synthesize: (text, opts) => ttsService.synthesize(text, opts),
  setVoiceClone: (path) => ttsService.setVoiceClone(path),
  clearVoiceClone: () => ttsService.clearVoiceClone(),
  updateSettings: (s) => ttsService.updateSettings(s),
  getSettings: () => ttsService.getSettings(),
  getRecommendedModel: (hw, ram) => ttsService.getRecommendedModel(hw, ram),
  registerIPC: (ipcMain) => ttsService.registerIPC(ipcMain),
};
