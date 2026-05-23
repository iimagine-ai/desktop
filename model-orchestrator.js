// Model Orchestrator — handles instant model swapping with preloading
// Manages keep_alive, eviction, warming, and progress reporting
// Runs in the Main process (Node.js)

const Store = require('electron-store');
const store = new Store();

const OLLAMA_URL = 'http://localhost:11434';

// State
let currentLoadedModel = null;
let preloadingModel = null;
let preloadAbortController = null;

function getOllamaHost() {
  return store.get('local.ollamaHost') || OLLAMA_URL;
}

/**
 * Get list of models currently loaded in memory
 */
async function getLoadedModels() {
  try {
    const res = await fetch(`${getOllamaHost()}/api/ps`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.models || [];
  } catch {
    return [];
  }
}

/**
 * Instantly evict a model from memory (keep_alive: 0)
 * On Apple Silicon this takes ~0.05s. On Windows it varies.
 */
async function evictModel(modelName) {
  if (!modelName) return { success: true };
  try {
    const res = await fetch(`${getOllamaHost()}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelName, prompt: '', keep_alive: 0 }),
    });
    if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
    // Consume response body
    const reader = res.body.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Warm a model into memory by sending an empty generate request
 * with a long keep_alive. This forces Ollama to load the model.
 * Returns timing info for the UI.
 */
async function warmModel(modelName, signal) {
  const startTime = Date.now();
  try {
    const res = await fetch(`${getOllamaHost()}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelName,
        prompt: '',
        keep_alive: '2m',
      }),
      signal,
    });
    if (!res.ok) {
      return { success: false, error: `HTTP ${res.status}`, durationMs: Date.now() - startTime };
    }
    // Consume the streaming response (Ollama streams even empty generates)
    const reader = res.body.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
    const durationMs = Date.now() - startTime;
    currentLoadedModel = modelName;
    return { success: true, durationMs };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { success: false, error: 'Preload cancelled', durationMs: Date.now() - startTime };
    }
    return { success: false, error: err.message, durationMs: Date.now() - startTime };
  }
}

/**
 * Switch models: evict current → warm new model
 * Sends progress events to the renderer via the provided sender function.
 * @param {string} targetModel - model to switch to
 * @param {function} sendEvent - (channel, data) => void
 * @returns {object} result with timing
 */
async function switchModel(targetModel, sendEvent) {
  // Cancel any in-progress preload
  if (preloadAbortController) {
    preloadAbortController.abort();
    preloadAbortController = null;
    preloadingModel = null;
  }

  // If already loaded, just extend keep_alive
  if (currentLoadedModel === targetModel) {
    sendEvent('model:switch-complete', { model: targetModel, durationMs: 0, alreadyLoaded: true });
    return { success: true, durationMs: 0, alreadyLoaded: true };
  }

  // Notify UI that switch is starting
  sendEvent('model:switch-start', { model: targetModel, previousModel: currentLoadedModel });

  // Step 1: Evict current model (instant on Apple Silicon)
  if (currentLoadedModel) {
    sendEvent('model:switch-progress', { phase: 'evicting', model: currentLoadedModel });
    await evictModel(currentLoadedModel);
  }

  // Step 2: Warm the new model
  sendEvent('model:switch-progress', { phase: 'loading', model: targetModel });
  const result = await warmModel(targetModel, null);

  if (result.success) {
    sendEvent('model:switch-complete', {
      model: targetModel,
      durationMs: result.durationMs,
      alreadyLoaded: false,
    });
  } else {
    sendEvent('model:switch-error', {
      model: targetModel,
      error: result.error,
      durationMs: result.durationMs,
    });
  }

  return result;
}

/**
 * Preload a model in the background (e.g. on hover or tab switch).
 * If another model is currently loaded, evicts it first.
 * Non-blocking — fires and forgets, reports via events.
 */
async function preloadModel(targetModel, sendEvent) {
  // Already loaded or already preloading this model
  if (currentLoadedModel === targetModel) return;
  if (preloadingModel === targetModel) return;

  // Cancel previous preload if different model
  if (preloadAbortController) {
    preloadAbortController.abort();
    preloadAbortController = null;
  }

  preloadingModel = targetModel;
  preloadAbortController = new AbortController();

  sendEvent('model:preload-start', { model: targetModel });

  // Evict current if needed
  if (currentLoadedModel) {
    await evictModel(currentLoadedModel);
    currentLoadedModel = null;
  }

  // Warm the target
  const result = await warmModel(targetModel, preloadAbortController.signal);
  preloadingModel = null;
  preloadAbortController = null;

  if (result.success) {
    sendEvent('model:preload-complete', { model: targetModel, durationMs: result.durationMs });
  }
  // If cancelled or failed, silently ignore
}

/**
 * Extend keep_alive for the currently loaded model.
 * Call this periodically or on user activity to prevent auto-unload.
 */
async function keepAlive(modelName) {
  if (!modelName) modelName = currentLoadedModel;
  if (!modelName) return;
  try {
    const res = await fetch(`${getOllamaHost()}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelName, prompt: '', keep_alive: '2m' }),
    });
    if (res.ok) {
      const reader = res.body.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    }
  } catch {
    // silent
  }
}

/**
 * Sync state: check what's actually loaded in Ollama right now
 */
async function syncState() {
  const loaded = await getLoadedModels();
  if (loaded.length > 0) {
    currentLoadedModel = loaded[0].name || loaded[0].model;
  } else {
    currentLoadedModel = null;
  }
  return { currentLoadedModel, loadedModels: loaded };
}

/**
 * Get current orchestrator state
 */
function getState() {
  return {
    currentLoadedModel,
    preloadingModel,
  };
}

module.exports = {
  getLoadedModels,
  evictModel,
  warmModel,
  switchModel,
  preloadModel,
  keepAlive,
  syncState,
  getState,
};
