// Model Registry — maps model names to HuggingFace GGUF download URLs
// Replaces Ollama's model registry. All models are GGUF format from HuggingFace.

/**
 * Registry of recommended models with direct GGUF download URLs.
 * Each model has variants (quantization levels) for different hardware.
 */
const MODEL_REGISTRY = {
  // ─── Chat Models ──────────────────────────────────────────────
  'llama-3.2-3b': {
    name: 'Llama 3.2 3B',
    description: 'Fast, capable small model. Great for most tasks on any hardware.',
    categories: ['text', 'code'],
    variants: [
      {
        quantization: 'Q4_K_M',
        filename: 'llama-3.2-3b-instruct-q4_k_m.gguf',
        url: 'https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf',
        sizeGB: 2.0,
        ramRequired: 4,
        isDefault: true,
      },
      {
        quantization: 'Q8_0',
        filename: 'llama-3.2-3b-instruct-q8_0.gguf',
        url: 'https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q8_0.gguf',
        sizeGB: 3.4,
        ramRequired: 6,
      },
    ],
  },

  'llama-3.1-8b': {
    name: 'Llama 3.1 8B',
    description: 'Excellent balance of quality and speed. Recommended for 16GB+ RAM.',
    categories: ['text', 'code'],
    variants: [
      {
        quantization: 'Q4_K_M',
        filename: 'llama-3.1-8b-instruct-q4_k_m.gguf',
        url: 'https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF/resolve/main/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf',
        sizeGB: 4.9,
        ramRequired: 8,
        isDefault: true,
      },
      {
        quantization: 'Q8_0',
        filename: 'llama-3.1-8b-instruct-q8_0.gguf',
        url: 'https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF/resolve/main/Meta-Llama-3.1-8B-Instruct-Q8_0.gguf',
        sizeGB: 8.5,
        ramRequired: 12,
      },
    ],
  },

  'qwen-2.5-7b': {
    name: 'Qwen 2.5 7B',
    description: 'Strong multilingual model with excellent reasoning.',
    categories: ['text', 'code'],
    variants: [
      {
        quantization: 'Q4_K_M',
        filename: 'qwen-2.5-7b-instruct-q4_k_m.gguf',
        url: 'https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q4_K_M.gguf',
        sizeGB: 4.7,
        ramRequired: 8,
        isDefault: true,
      },
    ],
  },

  'mistral-7b': {
    name: 'Mistral 7B',
    description: 'Fast and efficient. Good for general conversation.',
    categories: ['text'],
    variants: [
      {
        quantization: 'Q4_K_M',
        filename: 'mistral-7b-instruct-v0.3-q4_k_m.gguf',
        url: 'https://huggingface.co/bartowski/Mistral-7B-Instruct-v0.3-GGUF/resolve/main/Mistral-7B-Instruct-v0.3-Q4_K_M.gguf',
        sizeGB: 4.4,
        ramRequired: 8,
        isDefault: true,
      },
    ],
  },

  'phi-3-mini': {
    name: 'Phi 3 Mini (3.8B)',
    description: 'Microsoft\'s compact model. Surprisingly capable for its size.',
    categories: ['text', 'code'],
    variants: [
      {
        quantization: 'Q4_K_M',
        filename: 'phi-3-mini-4k-instruct-q4_k_m.gguf',
        url: 'https://huggingface.co/bartowski/Phi-3-mini-4k-instruct-GGUF/resolve/main/Phi-3-mini-4k-instruct-Q4_K_M.gguf',
        sizeGB: 2.4,
        ramRequired: 4,
        isDefault: true,
      },
    ],
  },

  'gemma-2-9b': {
    name: 'Gemma 2 9B',
    description: 'Google\'s open model. Strong at reasoning and instruction following.',
    categories: ['text', 'code'],
    variants: [
      {
        quantization: 'Q4_K_M',
        filename: 'gemma-2-9b-it-q4_k_m.gguf',
        url: 'https://huggingface.co/bartowski/gemma-2-9b-it-GGUF/resolve/main/gemma-2-9b-it-Q4_K_M.gguf',
        sizeGB: 5.8,
        ramRequired: 10,
        isDefault: true,
      },
    ],
  },

  // ─── Code Models ──────────────────────────────────────────────
  'deepseek-coder-v2-lite': {
    name: 'DeepSeek Coder V2 Lite',
    description: 'Specialized for code generation and understanding.',
    categories: ['code'],
    variants: [
      {
        quantization: 'Q4_K_M',
        filename: 'deepseek-coder-v2-lite-instruct-q4_k_m.gguf',
        url: 'https://huggingface.co/bartowski/DeepSeek-Coder-V2-Lite-Instruct-GGUF/resolve/main/DeepSeek-Coder-V2-Lite-Instruct-Q4_K_M.gguf',
        sizeGB: 9.0,
        ramRequired: 12,
        isDefault: true,
      },
    ],
  },

  // ─── Embedding Models ─────────────────────────────────────────
  'nomic-embed-text': {
    name: 'Nomic Embed Text',
    description: 'High-quality text embeddings for knowledge base search.',
    categories: ['embedding'],
    variants: [
      {
        quantization: 'F16',
        filename: 'nomic-embed-text-v1.5-f16.gguf',
        url: 'https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF/resolve/main/nomic-embed-text-v1.5.f16.gguf',
        sizeGB: 0.27,
        ramRequired: 1,
        isDefault: true,
      },
    ],
  },

  'all-minilm-l6': {
    name: 'All MiniLM L6',
    description: 'Tiny, fast embedding model. Good for basic similarity search.',
    categories: ['embedding'],
    variants: [
      {
        quantization: 'F32',
        filename: 'all-minilm-l6-v2-f32.gguf',
        url: 'https://huggingface.co/leliuga/all-MiniLM-L6-v2-GGUF/resolve/main/all-MiniLM-L6-v2.F32.gguf',
        sizeGB: 0.09,
        ramRequired: 1,
        isDefault: true,
      },
    ],
  },
};

/**
 * Get all models in the registry
 */
function getAllModels() {
  return Object.entries(MODEL_REGISTRY).map(([id, model]) => ({
    id,
    ...model,
  }));
}

/**
 * Get a specific model by ID
 */
function getModel(id) {
  const model = MODEL_REGISTRY[id];
  if (!model) return null;
  return { id, ...model };
}

/**
 * Get the default variant for a model
 */
function getDefaultVariant(modelId) {
  const model = MODEL_REGISTRY[modelId];
  if (!model) return null;
  return model.variants.find(v => v.isDefault) || model.variants[0];
}

/**
 * Find a registry entry by filename (for matching installed files to registry)
 */
function findByFilename(filename) {
  for (const [id, model] of Object.entries(MODEL_REGISTRY)) {
    const variant = model.variants.find(v => v.filename === filename);
    if (variant) return { id, model, variant };
  }
  return null;
}

/**
 * Get models filtered by category
 */
function getModelsByCategory(category) {
  return getAllModels().filter(m => m.categories.includes(category));
}

module.exports = {
  MODEL_REGISTRY,
  getAllModels,
  getModel,
  getDefaultVariant,
  findByFilename,
  getModelsByCategory,
};
