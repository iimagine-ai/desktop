// IIMAGINE Engine Manager — manages bundled llama-server (llama.cpp) process
// Replaces Ollama dependency. Shows as "iimagine-engine" in Activity Monitor.
// MIT licensed llama.cpp binary, renamed and bundled inside the app.

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const Store = require('electron-store');

const store = new Store();

// Engine state
let engineProcess = null;
let enginePort = 8847; // Default port for iimagine-engine
let currentModel = null;
let isStarting = false;
let isReady = false;

// Paths
const ENGINE_BINARY_NAME = process.platform === 'win32' ? 'iimagine-engine.exe' : 'iimagine-engine';
const MODELS_DIR_NAME = 'models';

/**
 * Get the path to the engine binary.
 * In dev: looks in desktop-companion/bin/
 * In production: looks in app.asar.unpacked/bin/ or Resources/bin/
 */
function getEnginePath() {
  const isDev = !require('electron')?.app?.isPackaged;

  if (isDev) {
    return path.join(__dirname, 'bin', ENGINE_BINARY_NAME);
  }

  // Production: binary is in Resources/bin/ (unpacked from asar)
  const resourcesPath = process.resourcesPath || path.join(__dirname, '..', '..', 'Resources');
  return path.join(resourcesPath, 'bin', ENGINE_BINARY_NAME);
}

/**
 * Get the models directory where GGUF files are stored.
 * Uses ~/Library/Application Support/iimagine-desktop/models on macOS
 * Uses %APPDATA%/iimagine-desktop/models on Windows
 */
function getModelsDir() {
  const appData = process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support', 'iimagine-desktop')
    : process.platform === 'win32'
      ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'iimagine-desktop')
      : path.join(os.homedir(), '.local', 'share', 'iimagine-desktop');

  const modelsPath = path.join(appData, MODELS_DIR_NAME);

  // Ensure directory exists
  if (!fs.existsSync(modelsPath)) {
    fs.mkdirSync(modelsPath, { recursive: true });
  }

  return modelsPath;
}

/**
 * Get list of installed models (GGUF files in models directory)
 */
function getInstalledModels() {
  const modelsDir = getModelsDir();
  try {
    const files = fs.readdirSync(modelsDir);
    return files
      .filter(f => f.endsWith('.gguf'))
      .map(f => {
        const filePath = path.join(modelsDir, f);
        const stats = fs.statSync(filePath);
        const name = f.replace('.gguf', '');
        return {
          name,
          filename: f,
          path: filePath,
          size: stats.size,
          sizeGB: Math.round((stats.size / (1024 ** 3)) * 100) / 100,
          modified: stats.mtime,
        };
      });
  } catch {
    return [];
  }
}

/**
 * Check if the engine binary exists and is executable
 */
function isEngineInstalled() {
  const enginePath = getEnginePath();
  try {
    fs.accessSync(enginePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get engine status
 */
async function getStatus() {
  if (!isEngineInstalled()) {
    return { running: false, installed: false, models: [] };
  }

  if (engineProcess && isReady) {
    const models = getInstalledModels();
    return {
      running: true,
      installed: true,
      models,
      currentModel,
      port: enginePort,
    };
  }

  // Check if engine is responding (might have been started externally)
  try {
    const res = await fetch(`http://127.0.0.1:${enginePort}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) {
      isReady = true;
      const models = getInstalledModels();
      return { running: true, installed: true, models, currentModel, port: enginePort };
    }
  } catch {
    // Not running
  }

  return { running: false, installed: true, models: getInstalledModels(), currentModel: null };
}

/**
 * Start the engine with a specific model loaded.
 * llama-server can only serve one model at a time.
 * @param {string} modelPath - full path to the GGUF file
 * @param {object} options - { numGpu, numThread, numCtx, port }
 */
async function startEngine(modelPath, options = {}) {
  if (isStarting) {
    return { success: false, error: 'Engine is already starting' };
  }

  // If already running with same model, just return
  if (engineProcess && isReady && currentModel === modelPath) {
    return { success: true, alreadyRunning: true };
  }

  // If running with different model, stop first
  if (engineProcess) {
    await stopEngine();
  }

  const enginePath = getEnginePath();
  if (!fs.existsSync(enginePath)) {
    return { success: false, error: 'Engine binary not found. Please install the AI engine.' };
  }

  if (!fs.existsSync(modelPath)) {
    return { success: false, error: `Model file not found: ${modelPath}` };
  }

  isStarting = true;
  isReady = false;

  const port = options.port || enginePort;
  const numGpu = options.numGpu || store.get('ollama.numGpu', 'auto');
  const numThread = options.numThread || store.get('ollama.numThread', 'auto');
  const numCtx = options.numCtx || store.get('ollama.numCtx', '4096');

  // Build command args for llama-server
  const args = [
    '--model', modelPath,
    '--port', String(port),
    '--host', '127.0.0.1',
    '--ctx-size', numCtx === 'auto' ? '4096' : String(numCtx),
  ];

  // GPU layers
  if (numGpu && numGpu !== 'auto') {
    args.push('--n-gpu-layers', String(numGpu));
  } else {
    // Auto: offload all layers to GPU (Metal on macOS)
    args.push('--n-gpu-layers', '999');
  }

  // CPU threads
  if (numThread && numThread !== 'auto') {
    args.push('--threads', String(numThread));
  }

  // Enable embeddings endpoint
  args.push('--embedding');

  return new Promise((resolve) => {
    try {
      const engineDir = path.dirname(enginePath);
      const env = { ...process.env };

      // Set library path so the engine finds its shared libraries
      if (process.platform === 'darwin') {
        env.DYLD_LIBRARY_PATH = engineDir + (env.DYLD_LIBRARY_PATH ? ':' + env.DYLD_LIBRARY_PATH : '');
      } else if (process.platform === 'linux') {
        env.LD_LIBRARY_PATH = engineDir + (env.LD_LIBRARY_PATH ? ':' + env.LD_LIBRARY_PATH : '');
      }

      engineProcess = spawn(enginePath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
      });

      let startupOutput = '';

      engineProcess.stdout.on('data', (data) => {
        const text = data.toString();
        startupOutput += text;

        // llama-server prints "server is listening on ..." when ready
        if (text.includes('listening') || text.includes('HTTP server listening')) {
          isReady = true;
          isStarting = false;
          currentModel = modelPath;
          enginePort = port;
          resolve({ success: true, port });
        }
      });

      engineProcess.stderr.on('data', (data) => {
        const text = data.toString();
        startupOutput += text;

        // llama-server also logs to stderr
        if (text.includes('listening') || text.includes('HTTP server listening')) {
          isReady = true;
          isStarting = false;
          currentModel = modelPath;
          enginePort = port;
          resolve({ success: true, port });
        }
      });

      engineProcess.on('error', (err) => {
        isStarting = false;
        isReady = false;
        engineProcess = null;
        resolve({ success: false, error: err.message });
      });

      engineProcess.on('close', (code) => {
        isReady = false;
        isStarting = false;
        currentModel = null;
        engineProcess = null;
        if (!isReady) {
          resolve({ success: false, error: `Engine exited with code ${code}. Output: ${startupOutput.slice(-500)}` });
        }
      });

      // Timeout: if not ready in 30 seconds, fail
      setTimeout(() => {
        if (isStarting) {
          isStarting = false;
          if (engineProcess) {
            engineProcess.kill();
            engineProcess = null;
          }
          resolve({ success: false, error: `Engine startup timed out. Output: ${startupOutput.slice(-500)}` });
        }
      }, 30000);

    } catch (err) {
      isStarting = false;
      resolve({ success: false, error: err.message });
    }
  });
}

/**
 * Stop the engine process
 */
async function stopEngine() {
  if (!engineProcess) return { success: true };

  return new Promise((resolve) => {
    engineProcess.on('close', () => {
      engineProcess = null;
      isReady = false;
      currentModel = null;
      resolve({ success: true });
    });

    engineProcess.kill('SIGTERM');

    // Force kill after 5 seconds
    setTimeout(() => {
      if (engineProcess) {
        engineProcess.kill('SIGKILL');
        engineProcess = null;
        isReady = false;
        currentModel = null;
      }
      resolve({ success: true });
    }, 5000);
  });
}

/**
 * Switch to a different model (stop → start with new model)
 */
async function switchModel(modelPath, options = {}) {
  await stopEngine();
  return await startEngine(modelPath, options);
}

/**
 * Chat completion via the engine's OpenAI-compatible endpoint
 * @param {object} params - { messages, stream, options }
 */
async function chat({ messages, stream = false, options = {} }) {
  if (!isReady) {
    return { success: false, error: 'Engine not running. Start a model first.' };
  }

  const body = {
    messages,
    stream,
    temperature: options.temperature || 0.7,
    max_tokens: options.max_tokens || 4096,
  };

  try {
    const res = await fetch(`http://127.0.0.1:${enginePort}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (!res.ok) {
      const err = await res.text().catch(() => `HTTP ${res.status}`);
      return { success: false, error: err };
    }

    if (!stream) {
      const data = await res.json();
      return { success: true, data };
    }

    // Return the response for streaming
    return { success: true, response: res };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { success: false, error: 'Aborted' };
    }
    return { success: false, error: err.message };
  }
}

/**
 * Generate embeddings via the engine's embedding endpoint
 * @param {string} text - text to embed
 */
async function embed(text) {
  if (!isReady) {
    return { success: false, error: 'Engine not running' };
  }

  try {
    const res = await fetch(`http://127.0.0.1:${enginePort}/v1/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: text,
        model: 'default', // llama-server uses whatever model is loaded
      }),
    });

    if (!res.ok) {
      return { success: false, error: `HTTP ${res.status}` };
    }

    const data = await res.json();
    const embedding = data.data?.[0]?.embedding || null;
    return { success: true, embedding };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Delete a model file from disk
 */
function deleteModel(filename) {
  const modelsDir = getModelsDir();
  const filePath = path.join(modelsDir, filename);

  if (!filePath.startsWith(modelsDir)) {
    return { success: false, error: 'Invalid path' };
  }

  try {
    if (fs.existsSync(filePath)) {
      // If this model is currently loaded, stop the engine first
      if (currentModel === filePath) {
        stopEngine();
      }
      fs.unlinkSync(filePath);
      return { success: true };
    }
    return { success: false, error: 'File not found' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Download a GGUF model from HuggingFace or direct URL
 * Streams download with progress reporting
 * @param {string} url - direct URL to GGUF file
 * @param {string} filename - target filename
 * @param {function} onProgress - (downloaded, total) => void
 * @param {AbortSignal} signal - for cancellation
 */
async function downloadModel(url, filename, onProgress, signal) {
  const modelsDir = getModelsDir();
  const targetPath = path.join(modelsDir, filename);
  const tempPath = targetPath + '.downloading';

  try {
    const res = await fetch(url, { signal });
    if (!res.ok) {
      return { success: false, error: `Download failed: HTTP ${res.status}` };
    }

    const totalSize = parseInt(res.headers.get('content-length') || '0');
    const writer = fs.createWriteStream(tempPath);
    const reader = res.body.getReader();

    let downloaded = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      writer.write(Buffer.from(value));
      downloaded += value.length;

      if (onProgress) {
        onProgress(downloaded, totalSize);
      }
    }

    writer.end();

    // Wait for write to finish
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    // Rename temp file to final
    fs.renameSync(tempPath, targetPath);

    return { success: true, path: targetPath, filename };
  } catch (err) {
    // Clean up temp file
    try { fs.unlinkSync(tempPath); } catch {}

    if (err.name === 'AbortError') {
      return { success: false, error: 'Download cancelled' };
    }
    return { success: false, error: err.message };
  }
}

/**
 * Get the engine's health/readiness
 */
async function healthCheck() {
  if (!engineProcess || !isReady) return false;
  try {
    const res = await fetch(`http://127.0.0.1:${enginePort}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Get current engine state
 */
function getState() {
  return {
    running: isReady,
    starting: isStarting,
    currentModel,
    port: enginePort,
    pid: engineProcess?.pid || null,
  };
}

module.exports = {
  getEnginePath,
  getModelsDir,
  getInstalledModels,
  isEngineInstalled,
  getStatus,
  startEngine,
  stopEngine,
  switchModel,
  chat,
  embed,
  deleteModel,
  downloadModel,
  healthCheck,
  getState,
};
