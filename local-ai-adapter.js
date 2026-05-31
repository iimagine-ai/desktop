// Local AI Adapter — unified interface for local model inference
// Routes requests to iimagine-engine (primary) or Ollama (legacy fallback).
// This adapter allows existing IPC handlers to work unchanged while
// the underlying engine transitions from Ollama to llama.cpp.
//
// Priority: iimagine-engine → Ollama → error
// The renderer doesn't need to know which backend is active.

const Store = require('electron-store');
const engineManager = require('./engine-manager');

const store = new Store();
const OLLAMA_URL = 'http://localhost:11434';

/**
 * Determine which local AI backend is available.
 * Returns 'engine' | 'ollama' | null
 */
async function getActiveBackend() {
  // Check iimagine-engine first (preferred)
  const engineStatus = await engineManager.getStatus();
  if (engineStatus.running) return 'engine';

  // Check if engine is installed but not started
  if (engineStatus.installed) {
    // Engine is installed but not running — we can start it
    return 'engine-available';
  }

  // Fallback: check Ollama
  try {
    const ollamaHost = store.get('local.ollamaHost') || OLLAMA_URL;
    const res = await fetch(`${ollamaHost}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) return 'ollama';
  } catch {}

  return null;
}

/**
 * Get status of local AI (models available, engine running, etc.)
 * Unified response format regardless of backend.
 */
async function getStatus() {
  // Try iimagine-engine first
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

  // No iimagine models found — return empty (don't fall back to Ollama)
  return { running: false, engine: null, models: [], installed: engineStatus.installed };
}

/**
 * Generate embeddings for a single text.
 * Uses engine-manager if running, falls back to Ollama.
 * @param {string} text - text to embed
 * @param {string} model - model name (ignored for engine, used for Ollama)
 * @returns {{ success: boolean, embedding: number[] | null, error?: string }}
 */
async function embed(text, model = 'nomic-embed-text') {
  // Try iimagine-engine first
  const engineStatus = await engineManager.getStatus();
  if (engineStatus.running) {
    const result = await engineManager.embed(text);
    return result;
  }

  // Fallback: Ollama
  try {
    const ollamaHost = store.get('local.ollamaHost') || OLLAMA_URL;
    const res = await fetch(`${ollamaHost}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: text }),
    });
    if (!res.ok) {
      return { success: false, error: `Ollama embed error: HTTP ${res.status}` };
    }
    const data = await res.json();
    const embedding = data.embeddings?.[0] || data.embedding || null;
    return { success: true, embedding };
  } catch (err) {
    return { success: false, error: `No local AI available for embeddings: ${err.message}` };
  }
}

/**
 * Batch embed multiple texts with progress reporting.
 * @param {string[]} texts - array of texts to embed
 * @param {string} model - model name (for Ollama fallback)
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
  // Try iimagine-engine first
  const engineStatus = await engineManager.getStatus();
  if (engineStatus.running) {
    const result = await engineManager.chat({ messages, stream: false, options });
    if (result.success) {
      // Normalize to Ollama-like response format for compatibility
      const choice = result.data?.choices?.[0];
      return {
        success: true,
        message: choice?.message || { role: 'assistant', content: '' },
      };
    }
    return result;
  }

  // Fallback: Ollama
  try {
    const ollamaHost = store.get('local.ollamaHost') || OLLAMA_URL;
    const numCtx = store.get('local.contextWindow') || 4096;
    const res = await fetch(`${ollamaHost}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: false, options: { num_ctx: numCtx, ...options } }),
    });
    if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
    const data = await res.json();
    return { success: true, message: data.message };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Streaming chat completion.
 * Returns an async generator that yields content chunks.
 * @param {{ model: string, messages: Array, options?: object, signal?: AbortSignal }} params
 * @returns {{ success: boolean, stream?: AsyncGenerator, error?: string }}
 */
async function chatStream({ model, messages, options = {}, signal }) {
  // Try iimagine-engine first
  const engineStatus = await engineManager.getStatus();
  if (engineStatus.running) {
    const result = await engineManager.chat({
      messages,
      stream: true,
      options: { ...options, signal },
    });
    if (!result.success) return result;

    // Return a reader that yields content chunks in a normalized format
    return {
      success: true,
      engine: 'iimagine',
      format: 'openai-sse', // data: {...}\n\n with [DONE]
      response: result.response,
    };
  }

  // Fallback: Ollama streaming
  try {
    const ollamaHost = store.get('local.ollamaHost') || OLLAMA_URL;
    const numCtx = store.get('local.contextWindow') || 4096;
    const res = await fetch(`${ollamaHost}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        options: { num_ctx: numCtx, ...options },
      }),
      signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => `HTTP ${res.status}`);
      return { success: false, error: `Ollama error: ${errText}` };
    }

    return {
      success: true,
      engine: 'ollama',
      format: 'ollama-ndjson', // {"message":{"content":"..."}}\n per line
      response: res,
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { success: false, error: 'Stream aborted' };
    }
    return { success: false, error: err.message };
  }
}

/**
 * Check if a specific model is available locally.
 * @param {string} modelName
 * @returns {boolean}
 */
async function hasModel(modelName) {
  // Check engine models (GGUF files)
  const installed = engineManager.getInstalledModels();
  if (installed.some(m => m.name === modelName || m.filename === modelName)) {
    return true;
  }

  // Check Ollama
  try {
    const ollamaHost = store.get('local.ollamaHost') || OLLAMA_URL;
    const res = await fetch(`${ollamaHost}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const data = await res.json();
      return (data.models || []).some(m => m.name === modelName || m.name.startsWith(modelName));
    }
  } catch {}

  return false;
}

/**
 * Get the best available chat model name.
 * Filters out embedding-only models.
 */
async function getBestChatModel() {
  const status = await getStatus();
  if (!status.running || !status.models.length) return null;

  const EMBED_ONLY = ['nomic-embed-text', 'all-minilm', 'mxbai-embed-large', 'snowflake-arctic-embed'];

  if (status.engine === 'iimagine') {
    // For engine, the loaded model IS the chat model
    return status.currentModel || (status.models[0]?.filename || null);
  }

  // For Ollama, filter out embedding models
  const chatModels = status.models.filter(m => !EMBED_ONLY.some(e => m.name.startsWith(e)));
  return chatModels.length > 0 ? chatModels[0].name : null;
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

  // Check Ollama as fallback
  try {
    const ollamaHost = store.get('local.ollamaHost') || OLLAMA_URL;
    const res = await fetch(`${ollamaHost}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) return { success: true, engine: 'ollama' };
  } catch {}

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
