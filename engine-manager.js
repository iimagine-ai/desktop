// IIMAGINE Engine Manager — manages bundled llama-server (llama.cpp) process
// Bundled llama.cpp binary. Shows as "iimagine-engine" in Activity Monitor.
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

// Keep-alive idle timer
let idleTimer = null;
let lastActivityTime = Date.now();

/**
 * Parse keep-alive setting string to milliseconds.
 * Supports: '0', '5m', '30m', '1h', '24h', '-1'
 */
function parseKeepAlive(value) {
  if (!value || value === '-1') return -1; // Never unload
  if (value === '0') return 0; // Unload immediately
  const match = value.match(/^(\d+)(m|h)$/);
  if (!match) return 5 * 60 * 1000; // Default 5 minutes
  const num = parseInt(match[1]);
  const unit = match[2];
  return unit === 'h' ? num * 60 * 60 * 1000 : num * 60 * 1000;
}

/**
 * Reset the idle timer. Call this after every chat/embed request.
 */
function resetIdleTimer() {
  lastActivityTime = Date.now();
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }

  const keepAlive = store.get('engine.keepAlive', '5m');
  const ms = parseKeepAlive(keepAlive);

  if (ms === -1) return; // Never unload
  if (ms === 0) {
    // Unload immediately after response completes
    stopEngine();
    return;
  }

  idleTimer = setTimeout(() => {
    if (engineProcess && isReady) {
      console.log(`[Engine] Idle timeout (${keepAlive}) — stopping engine to free memory`);
      stopEngine();
    }
  }, ms);
}

// Paths
const ENGINE_BINARY_NAME = process.platform === 'win32' ? 'iimagine-engine.exe' : 'iimagine-engine';
const MODELS_DIR_NAME = 'models';

/**
 * Check if NVIDIA GPU is available (Windows only — used to select CUDA binary)
 */
function hasNvidiaGpu() {
  if (process.platform !== 'win32') return false;
  try {
    execSync('nvidia-smi', { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the path to the engine binary.
 * In dev: looks in desktop-companion/bin/
 * In production: looks in app.asar.unpacked/bin/ or Resources/bin/
 * On Windows: prefers bin/cuda/iimagine-engine.exe if NVIDIA GPU detected
 */
function getEnginePath() {
  const isDev = !require('electron')?.app?.isPackaged;

  if (isDev) {
    // In dev, check for CUDA variant on Windows
    if (process.platform === 'win32' && hasNvidiaGpu()) {
      const cudaPath = path.join(__dirname, 'bin', 'cuda', ENGINE_BINARY_NAME);
      if (fs.existsSync(cudaPath)) {
        console.log(`[Engine] Dev path (CUDA): ${cudaPath}`);
        return cudaPath;
      }
    }
    const devPath = path.join(__dirname, 'bin', ENGINE_BINARY_NAME);
    console.log(`[Engine] Dev path: ${devPath}`);
    return devPath;
  }

  // Production: binary is in Resources/bin/ (unpacked from asar)
  const resourcesPath = process.resourcesPath || path.join(__dirname, '..', '..', 'Resources');

  // On Windows, prefer CUDA binary if GPU is present
  if (process.platform === 'win32' && hasNvidiaGpu()) {
    const cudaPath = path.join(resourcesPath, 'bin', 'cuda', ENGINE_BINARY_NAME);
    if (fs.existsSync(cudaPath)) {
      console.log(`[Engine] Production path (CUDA): ${cudaPath}, exists: true`);
      return cudaPath;
    }
  }

  const prodPath = path.join(resourcesPath, 'bin', ENGINE_BINARY_NAME);
  console.log(`[Engine] Production path: ${prodPath}, exists: ${fs.existsSync(prodPath)}`);
  return prodPath;
}

/**
 * Get the models directory where GGUF files are stored.
 * Uses ~/.iimagine/models/ on all platforms (shared with download-manager)
 */
function getModelsDir() {
  const modelsPath = path.join(os.homedir(), '.iimagine', 'models');

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
    // On Windows, X_OK doesn't work for .exe files — just check existence
    if (process.platform === 'win32') {
      fs.accessSync(enginePath, fs.constants.F_OK);
    } else {
      fs.accessSync(enginePath, fs.constants.X_OK);
    }
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
    // Engine binary not found, but still report any downloaded models
    const models = getInstalledModels();
    return { running: false, installed: false, models };
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
  const numGpu = options.numGpu || store.get('engine.numGpu', 'auto');
  const numThread = options.numThread || store.get('engine.numThread', 'auto');
  const numCtx = options.numCtx || store.get('engine.numCtx', '4096');
  // Reasoning ("thinking") toggle. Default OFF = fast, model answers directly.
  // When ON, the model is allowed to stream chain-of-thought before the answer,
  // which is slower but can improve quality on hard prompts.
  const reasoningEnabled = options.reasoning ?? store.get('engine.reasoning', false);

  // Detect model family from the filename so we can apply model-specific launch flags
  // (Gemma/Qwen use the chat-template `enable_thinking` kwarg and have recommended sampling).
  const modelFile = path.basename(modelPath).toLowerCase();
  const isGemma = modelFile.includes('gemma');
  const isQwen = modelFile.includes('qwen');
  const supportsThinkingKwarg = isGemma || isQwen;

  // Optional progress callback so callers (e.g. the chat UI) can show a load bar.
  // Same Node process, so passing a function is fine. Phases only ever move forward.
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;

  // Build command args for llama-server
  const args = [
    '--model', modelPath,
    '--port', String(port),
    '--host', '127.0.0.1',
    '--ctx-size', numCtx === 'auto' ? '4096' : String(numCtx),
    '--fit', 'on',
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

  // Performance optimizations
  args.push('--flash-attn', 'on');  // Flash attention (free speed boost; also required for quantized KV cache)
  args.push('--cache-type-k', 'q8_0'); // Quantize KV cache to ~half the memory. On memory-
  args.push('--cache-type-v', 'q8_0'); // constrained machines (e.g. 16GB unified) this avoids
                                       // pressure/swap that slows generation. Needs flash-attn on.
  args.push('--batch-size', '512'); // Faster first-token latency for short prompts
  args.push('--no-warmup');         // Skip the slow empty-run warmup so the server
                                    // starts listening quickly (esp. large models on
                                    // memory-constrained machines). First real request
                                    // pays a small one-time cost instead.

  // Gemma's recommended sampling defaults (temp 1.0, top_p 0.95, top_k 64). These set the
  // server's defaults; per-request values still override. Other families keep engine defaults.
  if (isGemma) {
    args.push('--temp', '1.0');
    args.push('--top-p', '0.95');
    args.push('--top-k', '64');
  }

  // Thinking/reasoning control. Default OFF = fast, model answers directly.
  // Gemma/Qwen gate thinking via the chat template's `enable_thinking` kwarg (the model-
  // sanctioned mechanism — stops the chain-of-thought from being generated at all). Other
  // families fall back to `--reasoning-budget 0` (forces an immediate end to thinking).
  if (supportsThinkingKwarg) {
    args.push('--chat-template-kwargs', JSON.stringify({ enable_thinking: reasoningEnabled }));
  } else if (!reasoningEnabled) {
    args.push('--reasoning-budget', '0');
  }

  return new Promise((resolve) => {
    try {
      const engineDir = path.dirname(enginePath);
      const env = { ...process.env };

      // Set library path so the engine finds its shared libraries
      if (process.platform === 'darwin') {
        env.DYLD_LIBRARY_PATH = engineDir + (env.DYLD_LIBRARY_PATH ? ':' + env.DYLD_LIBRARY_PATH : '');
      } else if (process.platform === 'win32') {
        // Windows: prepend engine dir to PATH so DLLs are found (works for both CPU and CUDA dirs)
        env.PATH = engineDir + ';' + (env.PATH || '');
      } else if (process.platform === 'linux') {
        env.LD_LIBRARY_PATH = engineDir + (env.LD_LIBRARY_PATH ? ':' + env.LD_LIBRARY_PATH : '');
      }

      console.log(`[Engine] Starting: ${enginePath} (${engineDir.includes('cuda') ? 'CUDA' : 'CPU'})`);

      engineProcess = spawn(enginePath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
      });

      let startupOutput = '';
      let startupTimer = null;

      // Cold-start progress phases, surfaced to the optional onProgress callback so the
      // UI can render a load bar. Each phase has a baseline percent; phases only advance
      // forward (never regress) regardless of output ordering.
      const PROGRESS_PHASES = {
        starting: { percent: 8,  label: 'Starting AI engine…' },
        loading:  { percent: 35, label: 'Loading model into memory…' },
        context:  { percent: 75, label: 'Allocating context…' },
        ready:    { percent: 95, label: 'Almost ready…' },
      };
      const PHASE_ORDER = ['starting', 'loading', 'context', 'ready'];
      let currentPhaseIdx = -1;
      const emitProgress = (phase) => {
        if (!onProgress) return;
        const idx = PHASE_ORDER.indexOf(phase);
        if (idx <= currentPhaseIdx) return; // never go backwards
        currentPhaseIdx = idx;
        const info = PROGRESS_PHASES[phase];
        try { onProgress({ phase, percent: info.percent, label: info.label }); } catch {}
      };
      emitProgress('starting');

      // Activity-based startup timeout: a large model can take a while to load from
      // disk, but as long as the engine keeps emitting load progress we shouldn't kill
      // it. We only fail if there's no new output for STARTUP_INACTIVITY_MS, capped by
      // an absolute STARTUP_MAX_MS ceiling.
      const STARTUP_INACTIVITY_MS = 90000;
      const STARTUP_MAX_MS = 300000;
      const startedAt = Date.now();

      const failStartup = (reason) => {
        if (!isStarting) return;
        isStarting = false;
        if (startupTimer) { clearTimeout(startupTimer); startupTimer = null; }
        if (engineProcess) {
          engineProcess.kill();
          engineProcess = null;
        }
        resolve({ success: false, error: `${reason}. Output: ${startupOutput.slice(-500)}` });
      };

      const resetStartupTimer = () => {
        if (startupTimer) clearTimeout(startupTimer);
        startupTimer = setTimeout(() => {
          failStartup('Engine startup timed out (no progress)');
        }, STARTUP_INACTIVITY_MS);
      };

      const handleStartupChunk = (text) => {
        startupOutput += text;

        // Enforce absolute ceiling so a perpetually-chatty-but-never-ready engine
        // can't hang forever.
        if (Date.now() - startedAt > STARTUP_MAX_MS) {
          failStartup('Engine startup timed out (max wait exceeded)');
          return;
        }

        // Engine still making progress — keep waiting.
        resetStartupTimer();

        // Surface load milestones to the UI. These substrings are emitted by the
        // engine's own load logs ("load:", "llama_context:") before it starts serving.
        if (/llama_context:|n_ctx/.test(text)) {
          emitProgress('context');
        } else if (/load:|llama_model_loader|load_tensors/.test(text)) {
          emitProgress('loading');
        }

        // llama-server prints "server is listening on ..." when ready
        if (text.includes('listening') || text.includes('HTTP server listening')) {
          if (startupTimer) { clearTimeout(startupTimer); startupTimer = null; }
          emitProgress('ready');
          isReady = true;
          isStarting = false;
          currentModel = modelPath;
          enginePort = port;
          resolve({ success: true, port });
        }
      };

      engineProcess.stdout.on('data', (data) => handleStartupChunk(data.toString()));
      engineProcess.stderr.on('data', (data) => handleStartupChunk(data.toString()));

      engineProcess.on('error', (err) => {
        isStarting = false;
        isReady = false;
        engineProcess = null;
        if (startupTimer) { clearTimeout(startupTimer); startupTimer = null; }
        resolve({ success: false, error: err.message });
      });

      engineProcess.on('close', (code) => {
        const wasReady = isReady;
        isReady = false;
        isStarting = false;
        currentModel = null;
        engineProcess = null;
        if (startupTimer) { clearTimeout(startupTimer); startupTimer = null; }
        if (!wasReady) {
          resolve({ success: false, error: `Engine exited with code ${code}. Output: ${startupOutput.slice(-500)}` });
        }
      });

      // Kick off the activity-based startup timer (reset on each output chunk above).
      resetStartupTimer();

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

  // Clear idle timer
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }

  const proc = engineProcess;
  engineProcess = null;
  isReady = false;
  currentModel = null;

  return new Promise((resolve) => {
    proc.on('close', () => {
      resolve({ success: true });
    });

    proc.kill('SIGTERM');

    // Force kill after 5 seconds
    setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch {}
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

  // Ask llama-server to include token usage in the final streamed chunk so the UI
  // can show tokens used / tokens-per-second. (timings are included by default.)
  if (stream) {
    body.stream_options = { include_usage: true };
  }

  // Pass tools if provided (OpenAI function calling format)
  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools;
  }

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
      resetIdleTimer();
      return { success: true, data };
    }

    // Return the response for streaming
    resetIdleTimer();
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
    resetIdleTimer();
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
  getPort: () => enginePort,
};
