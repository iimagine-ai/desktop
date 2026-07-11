// Local AI Adapter — unified interface for local model inference
// Routes requests to iimagine-engine (bundled llama.cpp).
// This adapter provides a stable abstraction layer so existing IPC handlers
// work unchanged against the engine-manager backend.

const engineManager = require('./engine-manager');

/**
 * Determine which local AI backend is available.
 * Returns 'engine' | 'engine-available' | null
 */
async function getActiveBackend() {
  const engineStatus = await engineManager.getStatus();
  if (engineStatus.running) return 'engine';
  if (engineStatus.installed) return 'engine-available';
  return null;
}

/**
 * Get status of local AI (models available, engine running, etc.)
 */
async function getStatus() {
  const engineStatus = await engineManager.getStatus();
  if (engineStatus.running) {
    return {
      running: true,
      engine: 'iimagine',
      models: engineStatus.models.map(m => ({
        name: m.name,
        filename: m.filename,
        size: m.size,
        sizeGB: m.sizeGB,
      })),
      currentModel: engineStatus.currentModel,
    };
  }

  if (engineStatus.models && engineStatus.models.length > 0) {
    return {
      running: false,
      engine: 'iimagine',
      installed: engineStatus.installed,
      models: engineStatus.models.map(m => ({
        name: m.name,
        filename: m.filename,
        size: m.size,
        sizeGB: m.sizeGB,
      })),
      currentModel: null,
      needsStart: true,
    };
  }

  return { running: false, engine: null, models: [], installed: engineStatus.installed };
}

/**
 * Generate embeddings for a single text.
 * @param {string} text - text to embed
 * @param {string} model - model name (ignored — engine uses loaded model)
 * @returns {{ success: boolean, embedding: number[] | null, error?: string }}
 */
async function embed(text, model = 'nomic-embed-text') {
  const engineStatus = await engineManager.getStatus();
  if (engineStatus.running) {
    return await engineManager.embed(text);
  }
  return { success: false, error: 'No local AI engine running for embeddings' };
}

/**
 * Batch embed multiple texts with progress reporting.
 * @param {string[]} texts - array of texts to embed
 * @param {string} model - model name (ignored)
 * @param {function} onProgress - (processed, total) => void
 * @returns {Array<{ success: boolean, embedding: number[] | null }>}
 */
async function embedBatch(texts, model = 'nomic-embed-text', onProgress) {
  const results = [];
  for (let i = 0; i < texts.length; i++) {
    const result = await embed(texts[i], model);
    results.push(result);
    if (onProgress) onProgress(i + 1, texts.length);
  }
  return results;
}

/**
 * Non-streaming chat completion.
 * @param {{ model: string, messages: Array, options?: object }} params
 * @returns {{ success: boolean, message?: object, error?: string }}
 */
async function chat({ model, messages, options = {} }) {
  const engineStatus = await engineManager.getStatus();
  if (engineStatus.running) {
    const result = await engineManager.chat({ messages, stream: false, options });
    if (result.success) {
      const choice = result.data?.choices?.[0];
      return {
        success: true,
        message: choice?.message || { role: 'assistant', content: '' },
      };
    }
    return result;
  }
  return { success: false, error: 'No local AI engine running' };
}

/**
 * Streaming chat completion.
 * Returns stream info for the caller to consume.
 * @param {{ model: string, messages: Array, options?: object, signal?: AbortSignal }} params
 * @returns {{ success: boolean, stream?: AsyncGenerator, error?: string }}
 */
async function chatStream({ model, messages, options = {}, signal }) {
  const engineStatus = await engineManager.getStatus();
  if (engineStatus.running) {
    const result = await engineManager.chat({
      messages,
      stream: true,
      options: { ...options, signal },
    });
    if (!result.success) return result;

    return {
      success: true,
      engine: 'iimagine',
      format: 'openai-sse',
      response: result.response,
    };
  }

  return { success: false, error: 'No local AI engine running' };
}

/**
 * Check if a specific model is available locally.
 * @param {string} modelName
 * @returns {boolean}
 */
async function hasModel(modelName) {
  const installed = engineManager.getInstalledModels();
  return installed.some(m => m.name === modelName || m.filename === modelName);
}

/**
 * Get the best available chat model name.
 * Filters out embedding-only models.
 */
async function getBestChatModel() {
  const status = await getStatus();
  if (!status.running || !status.models.length) return null;

  const EMBED_ONLY = ['nomic-embed-text', 'all-minilm', 'mxbai-embed-large', 'snowflake-arctic-embed'];

  // For engine, the loaded model IS the chat model
  return status.currentModel || (status.models[0]?.filename || null);
}

/**
 * Ensure the engine is running with a model loaded.
 * Auto-starts with the first available GGUF model if needed.
 * @returns {{ success: boolean, error?: string }}
 */
async function ensureRunning() {
  const engineStatus = await engineManager.getStatus();

  // Already running
  if (engineStatus.running) return { success: true, engine: 'iimagine' };

  // Engine installed with models — auto-start
  if (engineStatus.installed && engineStatus.models.length > 0) {
    const firstModel = engineStatus.models[0];
    const result = await engineManager.startEngine(firstModel.path);
    if (result.success) return { success: true, engine: 'iimagine', autoStarted: true };
  }

  return { success: false, error: 'No local AI engine available' };
}

module.exports = {
  getActiveBackend,
  getStatus,
  embed,
  embedBatch,
  chat,
  chatStream,
  hasModel,
  getBestChatModel,
  ensureRunning,
};
