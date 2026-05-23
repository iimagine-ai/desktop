// Model Advisor — manifest-driven recommendation engine
// Reads from the remote model registry manifest (fetched via IPC)
// Replaces the old hardcoded MODEL_DATABASE approach

const QUALITY_SCORES = { 'excellent': 30, 'very-good': 20, 'good': 10 };

const CATEGORY_OPTIONS = [
  { id: 'text', label: 'Text / Chat', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' },
  { id: 'code', label: 'Coding', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>' },
  { id: 'reasoning', label: 'Reasoning', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>' },
  { id: 'multimodal', label: 'Multimodal', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>' },
  { id: 'image', label: 'Image', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>' },
  { id: 'embedding', label: 'Embedding', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>' },
];

/**
 * Get recommendations from the manifest based on hardware and selected categories.
 * @param {object} manifest - The model registry manifest
 * @param {object} hardware - { ramGB, gpu, diskFreeGB }
 * @param {string[]} categories - Selected capability categories
 * @returns {{ models: object[], message: string|null }}
 */
function getRecommendations(manifest, hardware, categories) {
  if (!manifest || !manifest.models || !manifest.models.length) {
    return { models: [], message: 'No model data available. Check your internet connection.' };
  }

  const ramGB = hardware.ramGB || 8;
  const selectedCats = categories.length ? categories : ['text'];

  // Handle "image" category: no dedicated image models exist in Ollama,
  // so fall back to multimodal models and add an explanatory note
  let imageNote = null;
  const effectiveCats = [...selectedCats];
  if (effectiveCats.includes('image') && !effectiveCats.includes('multimodal')) {
    effectiveCats.push('multimodal');
    imageNote = 'No dedicated image generation models available for local AI. Showing multimodal models that handle text and images.';
  }

  // Filter models that match at least one selected category
  const categoryMatched = manifest.models.filter(m => {
    if (m.categories.includes('embedding') && !effectiveCats.includes('embedding')) return false;
    return m.categories.some(c => effectiveCats.includes(c));
  });

  // Filter by hardware compatibility (default variant RAM requirement)
  const compatible = categoryMatched.filter(m => {
    const defaultVariant = m.variants.find(v => v.is_default) || m.variants[0];
    return defaultVariant && defaultVariant.ram_required_gb <= ramGB;
  });

  if (!compatible.length) {
    return {
      models: [],
      message: `No compatible models found for ${ramGB}GB RAM. Consider using the Private Cloud or Public Cloud options instead.`
    };
  }

  // Score and sort
  const scored = compatible.map(m => {
    let score = 0;

    // Category match bonus (0-40): more matching categories = higher score
    const matchCount = m.categories.filter(c => effectiveCats.includes(c)).length;
    score += (matchCount / effectiveCats.length) * 40;

    // Quality tier (0-30)
    score += QUALITY_SCORES[m.quality_tier] || 0;

    // Hardware fit (0-30): prefer models that use RAM well without maxing it
    const defaultVariant = m.variants.find(v => v.is_default) || m.variants[0];
    const ramRatio = defaultVariant.ram_required_gb / ramGB;
    if (ramRatio < 0.4) score += 20;
    else if (ramRatio < 0.6) score += 30;
    else if (ramRatio < 0.8) score += 25;
    else score += 10;

    // Leaderboard rank bonus (lower rank = better, max 20 points)
    const rankBonus = Math.max(0, 20 - (m.leaderboard_rank || 20));
    score += rankBonus;

    return { model: m, score };
  });

  scored.sort((a, b) => b.score - a.score);

  return { models: scored.map(s => s.model), message: imageNote };
}

/**
 * Get the pull command for a model (resolves ollama_native vs huggingface).
 * @param {object} model - Model entry from manifest
 * @returns {string} The pull command string
 */
function getPullCommand(model) {
  if (model.pull_method === 'ollama_native' && model.ollama_id) {
    return model.ollama_id;
  }
  if (model.hf_pull) {
    return model.hf_pull;
  }
  return model.ollama_id || model.id;
}

/**
 * Check if a model is compatible with given hardware.
 * @param {object} model - Model entry from manifest
 * @param {object} hardware - { ramGB, diskFreeGB }
 * @returns {{ compatible: boolean, reason: string|null }}
 */
function checkCompatibility(model, hardware) {
  const defaultVariant = model.variants.find(v => v.is_default) || model.variants[0];
  if (!defaultVariant) return { compatible: false, reason: 'No variant data' };

  if (defaultVariant.ram_required_gb > hardware.ramGB) {
    return {
      compatible: false,
      reason: `Requires ${defaultVariant.ram_required_gb}GB RAM (you have ${hardware.ramGB}GB)`
    };
  }

  if (defaultVariant.size_gb > (hardware.diskFreeGB || 999)) {
    return {
      compatible: false,
      reason: `Requires ${defaultVariant.size_gb}GB disk space (you have ${hardware.diskFreeGB}GB free)`
    };
  }

  return { compatible: true, reason: null };
}

/**
 * Filter manifest models by text search query.
 * @param {object[]} models - Array of model entries
 * @param {string} query - Search text
 * @returns {object[]} Filtered models
 */
function searchModels(models, query) {
  if (!query || !query.trim()) return models;
  const q = query.toLowerCase().trim();
  return models.filter(m =>
    m.name.toLowerCase().includes(q) ||
    m.family.toLowerCase().includes(q) ||
    m.ollama_id?.toLowerCase().includes(q) ||
    m.description.toLowerCase().includes(q) ||
    m.categories.some(c => c.includes(q))
  );
}

/**
 * Filter manifest models by category.
 * @param {object[]} models - Array of model entries
 * @param {string[]} categories - Category filter (empty = all)
 * @returns {object[]} Filtered models
 */
function filterByCategory(models, categories) {
  if (!categories || !categories.length) return models;
  return models.filter(m => m.categories.some(c => categories.includes(c)));
}

/**
 * Estimate performance for a model on given hardware.
 * @param {object} model - Model entry from manifest
 * @param {object} hardware - { ramGB, gpu }
 * @returns {{ tokensPerSec: number, speedLabel: string, speedColor: string }}
 */
function getPerformanceEstimate(model, hardware) {
  const defaultVariant = model.variants.find(v => v.is_default) || model.variants[0];
  const sizeGB = defaultVariant?.size_gb || 5;

  // Base estimate from model size (smaller = faster)
  let tokensPerSec;
  if (sizeGB <= 3) tokensPerSec = 35;
  else if (sizeGB <= 6) tokensPerSec = 20;
  else if (sizeGB <= 12) tokensPerSec = 12;
  else if (sizeGB <= 20) tokensPerSec = 6;
  else if (sizeGB <= 30) tokensPerSec = 3;
  else tokensPerSec = 1.5;

  // MoE bonus: activates fewer params per token
  if (model.is_moe) tokensPerSec *= 1.8;

  // GPU multiplier
  const gpuType = hardware.gpu?.type || 'unknown';
  if (gpuType === 'apple_silicon') tokensPerSec *= 1.8;
  else if (gpuType === 'nvidia') {
    const vram = hardware.gpu?.vramGB || 0;
    if (vram >= 16) tokensPerSec *= 2.5;
    else if (vram >= 8) tokensPerSec *= 1.8;
    else tokensPerSec *= 1.3;
  }

  tokensPerSec = Math.round(tokensPerSec);

  let speedLabel, speedColor;
  if (tokensPerSec >= 25) { speedLabel = 'Very fast'; speedColor = 'text-emerald-600'; }
  else if (tokensPerSec >= 12) { speedLabel = 'Fast'; speedColor = 'text-emerald-600'; }
  else if (tokensPerSec >= 6) { speedLabel = 'Moderate'; speedColor = 'text-amber-600'; }
  else if (tokensPerSec >= 3) { speedLabel = 'Slow'; speedColor = 'text-amber-600'; }
  else { speedLabel = 'Very slow'; speedColor = 'text-rose-600'; }

  return { tokensPerSec, speedLabel, speedColor };
}

window.ModelAdvisor = {
  CATEGORY_OPTIONS,
  getRecommendations,
  getPullCommand,
  checkCompatibility,
  searchModels,
  filterByCategory,
  getPerformanceEstimate,
};
