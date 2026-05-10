// Provider abstraction layer
// All provider types implement the same interface so the chat UI
// doesn't know or care which one is active.

const OLLAMA_URL = 'http://localhost:11434';

// ── Provider Interface ──────────────────────────────────────────
// {
//   type: 'local' | 'vertex' | 'api-key'
//   name: string
//   privacyLevel: 'local' | 'regional' | 'third-party'
//   status: 'ready' | 'not-configured' | 'downloading' | 'error'
//   chat(messages) → stream via IPC
// }

// ── Embedding-only models to exclude from chat ─────────────────
const EMBED_ONLY_MODELS = ['nomic-embed-text', 'all-minilm', 'mxbai-embed-large', 'snowflake-arctic-embed', 'bge-'];

function isEmbeddingModel(name) {
  return EMBED_ONLY_MODELS.some(prefix => name.startsWith(prefix));
}

class LocalProvider {
  constructor(modelName) {
    this.type = 'local';
    this.name = modelName;
    this.privacyLevel = 'local';
    this.status = 'ready';
    this.privacyColor = '#22c55e'; // green — local, nothing leaves your machine
    this.privacyLabel = '';
  }

  async chat(messages) {
    return window.api.ollama.chatStream(this.name, messages);
  }
}

// ── Provider Manager ────────────────────────────────────────────
// Tracks all configured providers and the active selection.

const ProviderManager = {
  providers: [],
  activeProvider: null,

  // Refresh local providers from Ollama model list
  async refreshLocal() {
    await this.loadHiddenModels();
    const status = await window.api.ollama.status();
    // Remove old local providers
    this.providers = this.providers.filter(p => p.type !== 'local');

    if (status.running && status.models?.length) {
      for (const m of status.models) {
        // Skip embedding-only models — they can't chat
        if (isEmbeddingModel(m.name)) continue;
        this.providers.push(new LocalProvider(m.name));
      }
    }

    // Restore Vertex provider from saved settings (if not already present)
    if (!this.providers.find(p => p.type === 'vertex')) {
      const savedRegion = await window.api.settings.get('vertex.region');
      const savedModel = await window.api.settings.get('vertex.model');
      if (savedRegion && savedModel) {
        const modelInfo = window.VERTEX_MODELS?.find(m => m.id === savedModel);
        const regionInfo = window.VERTEX_REGIONS?.find(r => r.id === savedRegion);
        if (modelInfo && regionInfo) {
          this.providers.push(new window.VertexProvider(savedModel, modelInfo.name, regionInfo.name));
        }
      }
    }

    // Restore Gateway provider from saved settings (if not already present)
    if (!this.providers.find(p => p.type === 'gateway')) {
      const savedGateway = await window.api.settings.get('gateway.model');
      if (savedGateway) {
        const modelInfo = window.GATEWAY_MODELS?.find(m => m.id === savedGateway);
        if (modelInfo) {
          this.providers.push(new window.GatewayProvider(savedGateway, modelInfo.name));
        }
      }
    }

    // Restore active from settings or pick first available
    const savedActive = await window.api.settings.get('activeModel');
    if (savedActive) {
      this.activeProvider = this.providers.find(p => p.name === savedActive) || this.providers[0] || null;
    } else {
      this.activeProvider = this.providers[0] || null;
    }
  },

  setActive(name) {
    const found = this.providers.find(p => p.name === name);
    if (found) {
      this.activeProvider = found;
      window.api.settings.set('activeModel', name);
      // Sync provider.active so the backend RAG path knows which type to use
      window.api.settings.set('provider.active', {
        type: found.type,
        model: found.modelId || found.name,
      });
    }
  },

  getReady() {
    const hidden = this._hiddenModels || [];
    return this.providers.filter(p => p.status === 'ready' && !hidden.includes(p.name));
  },

  async loadHiddenModels() {
    this._hiddenModels = await window.api.settings.get('hiddenModels') || [];
  },

  async toggleModelVisibility(modelName) {
    if (!this._hiddenModels) this._hiddenModels = [];
    const idx = this._hiddenModels.indexOf(modelName);
    if (idx >= 0) {
      this._hiddenModels.splice(idx, 1);
    } else {
      this._hiddenModels.push(modelName);
    }
    await window.api.settings.set('hiddenModels', this._hiddenModels);
  },

  isModelHidden(modelName) {
    return (this._hiddenModels || []).includes(modelName);
  },

  getOllamaStatus() {
    return window.api.ollama.status();
  }
};

// Make available globally for other modules
window.ProviderManager = ProviderManager;
window.LocalProvider = LocalProvider;

// ── Vertex AI Models & Regions ──────────────────────────────────

const VERTEX_MODELS = [
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Fast and affordable' },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', description: 'Best reasoning' },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', description: 'Previous gen, solid' },
];

const VERTEX_REGIONS = [
  { id: 'us-central1', name: 'US Central (Iowa)' },
  { id: 'us-east4', name: 'US East (Virginia)' },
  { id: 'europe-west1', name: 'Europe West (Belgium)' },
  { id: 'europe-west4', name: 'Europe West (Netherlands)' },
  { id: 'asia-southeast1', name: 'Asia Southeast (Singapore)' },
  { id: 'australia-southeast1', name: 'Australia (Sydney)' },
  { id: 'northamerica-northeast1', name: 'Canada (Montréal)' },
];

class VertexProvider {
  constructor(modelId, modelName, region) {
    this.type = 'vertex';
    this.name = `${modelName} (${region})`;
    this.modelId = modelId;
    this.region = region;
    this.privacyLevel = 'regional';
    this.status = 'ready';
    this.privacyColor = '#f59e0b'; // amber — secure cloud, data stays in your region
    this.privacyLabel = '';
  }

  async chat(messages) {
    return window.api.vertex.chat(messages, this.modelId, this.region);
  }
}

window.VertexProvider = VertexProvider;
window.VERTEX_MODELS = VERTEX_MODELS;
window.VERTEX_REGIONS = VERTEX_REGIONS;

// ── AI Gateway Models (Cloud, no privacy) ───────────────────────

const GATEWAY_MODELS = [
  // OpenAI
  { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini', vendor: 'openai' },
  { id: 'gpt-5.4-nano', name: 'GPT-5.4 Nano', vendor: 'openai' },
  { id: 'gpt-5.4', name: 'GPT-5.4', vendor: 'openai' },
  { id: 'gpt-5.5', name: 'GPT-5.5', vendor: 'openai' },
  { id: 'gpt-5-mini', name: 'GPT-5 Mini', vendor: 'openai' },
  { id: 'o4-mini', name: 'o4-mini (reasoning)', vendor: 'openai' },
  { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', vendor: 'openai' },
  { id: 'gpt-4.1', name: 'GPT-4.1', vendor: 'openai' },
  // Anthropic
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', vendor: 'anthropic' },
  { id: 'claude-haiku-4-20250514', name: 'Claude Haiku 4', vendor: 'anthropic' },
  { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', vendor: 'anthropic' },
  // Google Gemini
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', vendor: 'google' },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', vendor: 'google' },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', vendor: 'google' },
  // OpenRouter
  { id: 'openrouter/auto', name: 'OpenRouter Auto', vendor: 'openrouter' },
];

class GatewayProvider {
  constructor(modelId, modelName) {
    this.type = 'gateway';
    this.name = modelName;
    this.modelId = modelId;
    this.privacyLevel = 'third-party';
    this.status = 'ready';
    this.privacyColor = '#ef4444'; // red — unsecure cloud, no data privacy guarantee
    this.privacyLabel = '';
  }

  async chat(messages) {
    return window.api.gateway.chat(messages, this.modelId);
  }
}

window.GatewayProvider = GatewayProvider;
window.GATEWAY_MODELS = GATEWAY_MODELS;
