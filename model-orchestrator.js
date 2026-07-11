// Model Orchestrator — handles instant model swapping with preloading
// Manages model loading, eviction, warming, and progress reporting
// Routes through iimagine-engine (engine-manager)
// Runs in the Main process (Node.js)

const engineManager = require('./engine-manager');

// State
let currentLoadedModel = null;
let preloadingModel = null;
let preloadAbortController = null;

/**
 * Get list of models currently loaded in memory
 */
async function getLoadedModels() {
  const status = await engineManager.getStatus();
  if (status.running && status.currentModel) {
    return [{ name: status.currentModel, engine: 'iimagine' }];
  }
  return [];
}

/**
 * Instantly evict a model from memory (stop engine)
 */
async function evictModel(modelName) {
  if (!modelName) return { success: true };
  return await engineManager.stopEngine();
}

/**
 * Warm a model into memory by starting the engine with it.
 * Returns timing info for the UI.
 */
async function warmModel(modelName, signal) {
  const startTime = Date.now();
  try {
    const result = await engineManager.startEngine(modelName);
    const durationMs = Date.now() - startTime;
    if (result.success) {
      currentLoadedModel = modelName;
      return { success: true, durationMs };
    }
    return { success: false, error: result.error || 'Failed to start engine', durationMs };
  } catch (err) {
    return { success: false, error: err.message, durationMs: Date.now() - startTime };
  }
}

/**
 * Switch models: stop current → start new model
 * Sends progress events to the renderer via the provided sender function.
 * @param {string} targetModel - model path to switch to
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

  // If already loaded, no-op
  if (currentLoadedModel === targetModel) {
    sendEvent('model:switch-complete', { model: targetModel, durationMs: 0, alreadyLoaded: true });
    return { success: true, durationMs: 0, alreadyLoaded: true };
  }

  // Notify UI that switch is starting
  sendEvent('model:switch-start', { model: targetModel, previousModel: currentLoadedModel });

  // Step 1: Stop current engine
  if (currentLoadedModel) {
    sendEvent('model:switch-progress', { phase: 'evicting', model: currentLoadedModel });
    await engineManager.stopEngine();
  }

  // Step 2: Start engine with new model
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
 * Non-blocking — fires and forgets, reports via events.
 */
async function preloadModel(targetModel, sendEvent) {
  if (currentLoadedModel === targetModel) return;
  if (preloadingModel === targetModel) return;

  if (preloadAbortController) {
    preloadAbortController.abort();
    preloadAbortController = null;
  }

  preloadingModel = targetModel;
  preloadAbortController = new AbortController();

  sendEvent('model:preload-start', { model: targetModel });

  if (currentLoadedModel) {
    await engineManager.stopEngine();
    currentLoadedModel = null;
  }

  const result = await warmModel(targetModel, preloadAbortController.signal);
  preloadingModel = null;
  preloadAbortController = null;

  if (result.success) {
    sendEvent('model:preload-complete', { model: targetModel, durationMs: result.durationMs });
  }
}

/**
 * Keep-alive is a no-op for iimagine-engine (process stays alive until stopped).
 */
async function keepAlive(modelName) {
  // Engine process stays running — no keep-alive needed
}

/**
 * Sync state: check what's actually loaded right now
 */
async function syncState() {
  const status = await engineManager.getStatus();
  if (status.running && status.currentModel) {
    currentLoadedModel = status.currentModel;
  } else {
    currentLoadedModel = null;
  }
  return { currentLoadedModel, loadedModels: currentLoadedModel ? [{ name: currentLoadedModel }] : [] };
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
