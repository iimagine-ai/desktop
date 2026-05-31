// Model Registry — maps model names to HuggingFace GGUF download URLs
// All models are GGUF format from bartowski on HuggingFace.
// Last updated: 2026-05-31

/**
 * Registry of recommended models with direct GGUF download URLs.
 * Each model has variants (quantization levels) for different hardware.
 *
 * Source: https://huggingface.co/bartowski (trusted GGUF quantizer)
 * URL pattern: https://huggingface.co/bartowski/{repo}/resolve/main/{filename}
 */
const MODEL_REGISTRY = {
  // ─── Gemma 4 (Google) — Latest, multimodal MoE architecture ───
  'gemma-4-e2b': {
    name: 'Gemma 4 E2B',
    description: 'Google\'s edge MoE model. 2B active params from 9B total. Fast and efficient.',
    categories: ['text', 'multimodal'],
    family: 'gemma',
    variants: [
      {
        quantization: 'Q4_K_M',
        filename: 'google_gemma-4-E2B-it-Q4_K_M.gguf',
        url: 'https://huggingface.co/bartowski/google_gemma-4-E2B-it-GGUF/resolve/main/google_gemma-4-E2B-it-Q4_K_M.gguf',
        sizeGB: 3.46,
        ramRequired: 6,
        isDefault: true,
      },
      {
        quantization: 'Q8_0',
        filename: 'google_gemma-4-E2B-it-Q8_0.gguf',
        url: 'https://huggingface.co/bartowski/google_gemma-4-E2B-it-GGUF/resolve/main/google_gemma-4-E2B-it-Q8_0.gguf',
        sizeGB: 4.97,
        ramRequired: 8,
      },
    ],
  },

  'gemma-4-e4b': {
    name: 'Gemma 4 E4B',
    description: 'Google\'s mid-range MoE. 4B active params from 9B total. Great quality/speed balance.',
    categories: ['text', 'multimodal'],
    family: 'gemma',
    variants: [
      {
        quantization: 'Q4_K_M',
        filename: 'google_gemma-4-E4B-it-Q4_K_M.gguf',
        url: 'https://huggingface.co/bartowski/google_gemma-4-E4B-it-GGUF/resolve/main/google_gemma-4-E4B-it-Q4_K_M.gguf',
        sizeGB: 5.41,
        ramRequired: 8,
        isDefault: true,
      },
      {
        quantization: 'Q8_0',
        filename: 'google_gemma-4-E4B-it-Q8_0.gguf',
        url: 'https://huggingface.co/bartowski/google_gemma-4-E4B-it-GGUF/resolve/main/google_gemma-4-E4B-it-Q8_0.gguf',
        sizeGB: 8.03,
        ramRequired: 12,
      },
    ],
  },

  'gemma-4-27b-a4b': {
    name: 'Gemma 4 27B-A4B',
    description: 'Google\'s large MoE. 4B active from 26B total. High quality with MoE efficiency.',
    categories: ['text', 'multimodal'],
    family: 'gemma',
    variants: [
      {
        quantization: 'Q4_K_M',
        filename: 'google_gemma-4-26B-A4B-it-Q4_K_M.gguf',
        url: 'https://huggingface.co/bartowski/google_gemma-4-26B-A4B-it-GGUF/resolve/main/google_gemma-4-26B-A4B-it-Q4_K_M.gguf',
        sizeGB: 17.04,
        ramRequired: 20,
        isDefault: true,
      },
      {
        quantization: 'Q8_0',
        filename: 'google_gemma-4-26B-A4B-it-Q8_0.gguf',
        url: 'https://huggingface.co/bartowski/google_gemma-4-26B-A4B-it-GGUF/resolve/main/google_gemma-4-26B-A4B-it-Q8_0.gguf',
        sizeGB: 26.86,
        ramRequired: 32,
      },
    ],
  },

  'gemma-4-31b': {
    name: 'Gemma 4 31B',
    description: 'Google\'s dense 31B model. Maximum quality, needs 24GB+ RAM.',
    categories: ['text', 'multimodal'],
    family: 'gemma',
    variants: [
      {
        quantization: 'Q4_K_M',
        filename: 'google_gemma-4-31B-it-Q4_K_M.gguf',
        url: 'https://huggingface.co/bartowski/google_gemma-4-31B-it-GGUF/resolve/main/google_gemma-4-31B-it-Q4_K_M.gguf',
        sizeGB: 19.60,
        ramRequired: 24,
        isDefault: true,
      },
      {
        quantization: 'Q8_0',
        filename: 'google_gemma-4-31B-it-Q8_0.gguf',
        url: 'https://huggingface.co/bartowski/google_gemma-4-31B-it-GGUF/resolve/main/google_gemma-4-31B-it-Q8_0.gguf',
        sizeGB: 32.64,
        ramRequired: 36,
      },
    ],
  },

  // ─── Qwen 3 (Alibaba) — Strong multilingual, reasoning, code ──
  'qwen3-8b': {
    name: 'Qwen 3 8B',
    description: 'Alibaba\'s latest 8B. Excellent reasoning and multilingual support.',
    categories: ['text', 'code'],
    family: 'qwen',
    variants: [
      {
        quantization: 'Q4_K_M',
        filename: 'Qwen_Qwen3-8B-Q4_K_M.gguf',
        url: 'https://huggingface.co/bartowski/Qwen_Qwen3-8B-GGUF/resolve/main/Qwen_Qwen3-8B-Q4_K_M.gguf',
        sizeGB: 5.03,
        ramRequired: 8,
        isDefault: true,
      },
      {
        quantization: 'Q8_0',
        filename: 'Qwen_Qwen3-8B-Q8_0.gguf',
        url: 'https://huggingface.co/bartowski/Qwen_Qwen3-8B-GGUF/resolve/main/Qwen_Qwen3-8B-Q8_0.gguf',
        sizeGB: 8.71,
        ramRequired: 12,
      },
    ],
  },

  'qwen3-14b': {
    name: 'Qwen 3 14B',
    description: 'Alibaba\'s mid-size model. Strong at complex reasoning and code.',
    categories: ['text', 'code'],
    family: 'qwen',
    variants: [
      {
        quantization: 'Q4_K_M',
        filename: 'Qwen_Qwen3-14B-Q4_K_M.gguf',
        url: 'https://huggingface.co/bartowski/Qwen_Qwen3-14B-GGUF/resolve/main/Qwen_Qwen3-14B-Q4_K_M.gguf',
        sizeGB: 9.00,
        ramRequired: 12,
        isDefault: true,
      },
      {
        quantization: 'Q8_0',
        filename: 'Qwen_Qwen3-14B-Q8_0.gguf',
        url: 'https://huggingface.co/bartowski/Qwen_Qwen3-14B-GGUF/resolve/main/Qwen_Qwen3-14B-Q8_0.gguf',
        sizeGB: 15.70,
        ramRequired: 20,
      },
    ],
  },

  'qwen3.6-35b-a3b': {
    name: 'Qwen 3.6 35B-A3B',
    description: 'Alibaba\'s MoE powerhouse. 3B active from 35B total. Top-tier quality with MoE speed.',
    categories: ['text', 'code', 'multimodal'],
    family: 'qwen',
    variants: [
      {
        quantization: 'Q4_K_M',
        filename: 'Qwen_Qwen3.6-35B-A3B-Q4_K_M.gguf',
        url: 'https://huggingface.co/bartowski/Qwen_Qwen3.6-35B-A3B-GGUF/resolve/main/Qwen_Qwen3.6-35B-A3B-Q4_K_M.gguf',
        sizeGB: 22.29,
        ramRequired: 26,
        isDefault: true,
      },
      {
        quantization: 'Q8_0',
        filename: 'Qwen_Qwen3.6-35B-A3B-Q8_0.gguf',
        url: 'https://huggingface.co/bartowski/Qwen_Qwen3.6-35B-A3B-GGUF/resolve/main/Qwen_Qwen3.6-35B-A3B-Q8_0.gguf',
        sizeGB: 37.81,
        ramRequired: 42,
      },
    ],
  },

  // ─── Llama (Meta) — Industry standard open models ─────────────
  'llama-3.1-8b': {
    name: 'Llama 3.1 8B',
    description: 'Meta\'s workhorse model. Excellent balance of quality and speed.',
    categories: ['text', 'code'],
    family: 'llama',
    variants: [
      {
        quantization: 'Q4_K_M',
        filename: 'Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf',
        url: 'https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF/resolve/main/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf',
        sizeGB: 4.92,
        ramRequired: 8,
        isDefault: true,
      },
      {
        quantization: 'Q8_0',
        filename: 'Meta-Llama-3.1-8B-Instruct-Q8_0.gguf',
        url: 'https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF/resolve/main/Meta-Llama-3.1-8B-Instruct-Q8_0.gguf',
        sizeGB: 8.54,
        ramRequired: 12,
      },
    ],
  },

  'llama-3.3-70b': {
    name: 'Llama 3.3 70B',
    description: 'Meta\'s flagship. Near-GPT-4 quality. Needs 48GB+ RAM.',
    categories: ['text', 'code'],
    family: 'llama',
    variants: [
      {
        quantization: 'Q4_K_M',
        filename: 'Llama-3.3-70B-Instruct-Q4_K_M.gguf',
        url: 'https://huggingface.co/bartowski/Llama-3.3-70B-Instruct-GGUF/resolve/main/Llama-3.3-70B-Instruct-Q4_K_M.gguf',
        sizeGB: 42.52,
        ramRequired: 48,
        isDefault: true,
      },
    ],
  },

  // ─── Mistral (Mistral AI) — Fast, efficient European models ───
  'mistral-small-3.1-24b': {
    name: 'Mistral Small 3.1 24B',
    description: 'Mistral\'s latest small model. Multimodal, fast, strong at instruction following.',
    categories: ['text', 'multimodal'],
    family: 'mistral',
    variants: [
      {
        quantization: 'Q4_K_M',
        filename: 'mistralai_Mistral-Small-3.1-24B-Instruct-2503-Q4_K_M.gguf',
        url: 'https://huggingface.co/bartowski/mistralai_Mistral-Small-3.1-24B-Instruct-2503-GGUF/resolve/main/mistralai_Mistral-Small-3.1-24B-Instruct-2503-Q4_K_M.gguf',
        sizeGB: 14.33,
        ramRequired: 18,
        isDefault: true,
      },
      {
        quantization: 'Q8_0',
        filename: 'mistralai_Mistral-Small-3.1-24B-Instruct-2503-Q8_0.gguf',
        url: 'https://huggingface.co/bartowski/mistralai_Mistral-Small-3.1-24B-Instruct-2503-GGUF/resolve/main/mistralai_Mistral-Small-3.1-24B-Instruct-2503-Q8_0.gguf',
        sizeGB: 25.05,
        ramRequired: 30,
      },
    ],
  },

  // ─── DeepSeek (DeepSeek AI) — Reasoning specialists ───────────
  'deepseek-r1-distill-8b': {
    name: 'DeepSeek R1 Distill 8B',
    description: 'DeepSeek R1 reasoning distilled into Llama 8B. Chain-of-thought built in.',
    categories: ['text', 'reasoning'],
    family: 'deepseek',
    variants: [
      {
        quantization: 'Q4_K_M',
        filename: 'DeepSeek-R1-Distill-Llama-8B-Q4_K_M.gguf',
        url: 'https://huggingface.co/bartowski/DeepSeek-R1-Distill-Llama-8B-GGUF/resolve/main/DeepSeek-R1-Distill-Llama-8B-Q4_K_M.gguf',
        sizeGB: 4.92,
        ramRequired: 8,
        isDefault: true,
      },
      {
        quantization: 'Q8_0',
        filename: 'DeepSeek-R1-Distill-Llama-8B-Q8_0.gguf',
        url: 'https://huggingface.co/bartowski/DeepSeek-R1-Distill-Llama-8B-GGUF/resolve/main/DeepSeek-R1-Distill-Llama-8B-Q8_0.gguf',
        sizeGB: 8.54,
        ramRequired: 12,
      },
    ],
  },

  'deepseek-r1-distill-14b': {
    name: 'DeepSeek R1 Distill 14B',
    description: 'DeepSeek R1 reasoning distilled into Qwen 14B. Excellent for complex problems.',
    categories: ['text', 'reasoning'],
    family: 'deepseek',
    variants: [
      {
        quantization: 'Q4_K_M',
        filename: 'DeepSeek-R1-Distill-Qwen-14B-Q4_K_M.gguf',
        url: 'https://huggingface.co/bartowski/DeepSeek-R1-Distill-Qwen-14B-GGUF/resolve/main/DeepSeek-R1-Distill-Qwen-14B-Q4_K_M.gguf',
        sizeGB: 8.99,
        ramRequired: 12,
        isDefault: true,
      },
      {
        quantization: 'Q8_0',
        filename: 'DeepSeek-R1-Distill-Qwen-14B-Q8_0.gguf',
        url: 'https://huggingface.co/bartowski/DeepSeek-R1-Distill-Qwen-14B-GGUF/resolve/main/DeepSeek-R1-Distill-Qwen-14B-Q8_0.gguf',
        sizeGB: 15.70,
        ramRequired: 20,
      },
    ],
  },

  // ─── Phi (Microsoft) — Compact, efficient models ──────────────
  'phi-4': {
    name: 'Phi 4 (14B)',
    description: 'Microsoft\'s latest. Punches well above its weight at reasoning and code.',
    categories: ['text', 'code'],
    family: 'phi',
    variants: [
      {
        quantization: 'Q4_K_M',
        filename: 'phi-4-Q4_K_M.gguf',
        url: 'https://huggingface.co/bartowski/phi-4-GGUF/resolve/main/phi-4-Q4_K_M.gguf',
        sizeGB: 9.05,
        ramRequired: 12,
        isDefault: true,
      },
      {
        quantization: 'Q8_0',
        filename: 'phi-4-Q8_0.gguf',
        url: 'https://huggingface.co/bartowski/phi-4-GGUF/resolve/main/phi-4-Q8_0.gguf',
        sizeGB: 15.58,
        ramRequired: 20,
      },
    ],
  },

  'phi-4-mini': {
    name: 'Phi 4 Mini (3.8B)',
    description: 'Microsoft\'s tiny powerhouse. Surprisingly capable for 4GB RAM machines.',
    categories: ['text', 'code'],
    family: 'phi',
    variants: [
      {
        quantization: 'Q4_K_M',
        filename: 'microsoft_Phi-4-mini-instruct-Q4_K_M.gguf',
        url: 'https://huggingface.co/bartowski/microsoft_Phi-4-mini-instruct-GGUF/resolve/main/microsoft_Phi-4-mini-instruct-Q4_K_M.gguf',
        sizeGB: 2.49,
        ramRequired: 4,
        isDefault: true,
      },
      {
        quantization: 'Q8_0',
        filename: 'microsoft_Phi-4-mini-instruct-Q8_0.gguf',
        url: 'https://huggingface.co/bartowski/microsoft_Phi-4-mini-instruct-GGUF/resolve/main/microsoft_Phi-4-mini-instruct-Q8_0.gguf',
        sizeGB: 4.08,
        ramRequired: 6,
      },
    ],
  },

  // ─── Qwen 3 30B MoE — Efficient large model ──────────────────
  'qwen3-30b-a3b': {
    name: 'Qwen 3 30B-A3B',
    description: 'Alibaba\'s MoE model. 3B active from 30B total. High quality with low RAM usage.',
    categories: ['text', 'code'],
    family: 'qwen',
    variants: [
      {
        quantization: 'Q4_K_M',
        filename: 'Qwen_Qwen3-30B-A3B-Q4_K_M.gguf',
        url: 'https://huggingface.co/bartowski/Qwen_Qwen3-30B-A3B-GGUF/resolve/main/Qwen_Qwen3-30B-A3B-Q4_K_M.gguf',
        sizeGB: 18.63,
        ramRequired: 22,
        isDefault: true,
      },
      {
        quantization: 'Q8_0',
        filename: 'Qwen_Qwen3-30B-A3B-Q8_0.gguf',
        url: 'https://huggingface.co/bartowski/Qwen_Qwen3-30B-A3B-GGUF/resolve/main/Qwen_Qwen3-30B-A3B-Q8_0.gguf',
        sizeGB: 32.48,
        ramRequired: 36,
      },
    ],
  },

  // ─── Embedding Models ─────────────────────────────────────────
  'nomic-embed-text': {
    name: 'Nomic Embed Text',
    description: 'High-quality text embeddings for knowledge base search.',
    categories: ['embedding'],
    family: 'embedding',
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
    family: 'embedding',
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

/**
 * Get models filtered by family
 */
function getModelsByFamily(family) {
  return getAllModels().filter(m => m.family === family);
}

/**
 * Get models that fit within a RAM budget
 */
function getModelsForRAM(availableRAM) {
  return getAllModels().filter(m => {
    const defaultVariant = m.variants.find(v => v.isDefault) || m.variants[0];
    return defaultVariant.ramRequired <= availableRAM;
  });
}

/**
 * Get recommended models for a given RAM amount, sorted by quality tier
 */
function getRecommendedModels(availableRAM) {
  const compatible = getModelsForRAM(availableRAM)
    .filter(m => !m.categories.includes('embedding'));

  // Sort by size descending (bigger = generally better quality)
  return compatible.sort((a, b) => {
    const aDefault = a.variants.find(v => v.isDefault) || a.variants[0];
    const bDefault = b.variants.find(v => v.isDefault) || b.variants[0];
    return bDefault.sizeGB - aDefault.sizeGB;
  });
}

module.exports = {
  MODEL_REGISTRY,
  getAllModels,
  getModel,
  getDefaultVariant,
  findByFilename,
  getModelsByCategory,
  getModelsByFamily,
  getModelsForRAM,
  getRecommendedModels,
};
