// Model Advisor — manifest-driven recommendation engine
// Reads from the model registry manifest (fetched via IPC)
// Supports both new format (from model-registry.js) and legacy format

const CATEGORY_OPTIONS = [
  { id: 'text', label: 'Text / Chat', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' },
  { id: 'code', label: 'Coding', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>' },
  { id: 'reasoning', label: 'Reasoning', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>' },
  { id: 'multimodal', label: 'Multimodal', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>' },
  { id: 'audio', label: 'Voice / TTS', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>' },
  { id: 'embedding', label: 'Embedding', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>' },
];

// ─── Helpers for format-agnostic field access ───────────────────
function getDefaultVariant(model) {
  return model.variants.find(v => v.isDefault || v.is_default) || model.variants[0];
}

function getVariantRAM(variant) {
  return variant.ramRequired || variant.ram_required_gb || 0;
}

function getVariantSize(variant) {
  return variant.sizeGB || variant.size_gb || 0;
}

/**
 * Get recommendations based on hardware and selected categories.
 */
function getRecommendations(manifest, hardware, categories) {
  if (!manifest || !manifest.models || !manifest.models.length) {
    return { models: [], message: 'No model data available. Check your internet connection.' };
  }

  const ramGB = hardware.aiMemoryGB || hardware.ramGB || 8;
  const selectedCats = categories.length ? categories : ['text'];

  // Filter models that match at least one selected category
  const categoryMatched = manifest.models.filter(m => {
    if (m.categories.includes('embedding') && !selectedCats.includes('embedding')) return false;
    return m.categories.some(c => selectedCats.includes(c));
  });

  // Filter by hardware compatibility
  const compatible = categoryMatched.filter(m => {
    const v = getDefaultVariant(m);
    return v && getVariantRAM(v) <= ramGB;
  });

  if (!compatible.length) {
    return {
      models: [],
      message: `No compatible models found for ${ramGB}GB RAM. Consider using the Public Cloud option instead.`
    };
  }

  // Score and sort
  const scored = compatible.map(m => {
    let score = 0;
    const v = getDefaultVariant(m);
    const size = getVariantSize(v);
    const ram = getVariantRAM(v);

    // Category match bonus (0-40)
    const matchCount = m.categories.filter(c => selectedCats.includes(c)).length;
    score += (matchCount / selectedCats.length) * 40;

    // Size-based quality proxy (0-30): bigger models are generally better
    if (size >= 15) score += 30;
    else if (size >= 8) score += 25;
    else if (size >= 4) score += 20;
    else score += 10;

    // Hardware fit (0-30): prefer models that use RAM well without maxing it
    const ramRatio = ram / ramGB;
    if (ramRatio < 0.4) score += 20;
    else if (ramRatio < 0.6) score += 30;
    else if (ramRatio < 0.8) score += 25;
    else score += 10;

    return { model: m, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return { models: scored.map(s => s.model), message: null };
}

/**
 * Check if a model is compatible with given hardware.
 */
function checkCompatibility(model, hardware) {
  const v = getDefaultVariant(model);
  if (!v) return { compatible: false, reason: 'No variant data' };

  const ram = getVariantRAM(v);
  const size = getVariantSize(v);

  if (ram > (hardware.aiMemoryGB || hardware.ramGB || 8)) {
    return { compatible: false, reason: `Requires ${ram}GB RAM (you have ${hardware.aiMemoryGB || hardware.ramGB}GB)` };
  }

  if (size > (hardware.diskFreeGB || 999)) {
    return { compatible: false, reason: `Requires ${size}GB disk (you have ${hardware.diskFreeGB}GB free)` };
  }

  return { compatible: true, reason: null };
}

/**
 * Filter models by text search query.
 */
function searchModels(models, query) {
  if (!query || !query.trim()) return models;
  const q = query.toLowerCase().trim();
  return models.filter(m =>
    m.name.toLowerCase().includes(q) ||
    (m.family || '').toLowerCase().includes(q) ||
    m.id?.toLowerCase().includes(q) ||
    m.description.toLowerCase().includes(q) ||
    m.categories.some(c => c.includes(q))
  );
}

/**
 * Filter models by category.
 */
function filterByCategory(models, categories) {
  if (!categories || !categories.length) return models;
  return models.filter(m => m.categories.some(c => categories.includes(c)));
}

/**
 * Estimate performance for a model on given hardware.
 */
function getPerformanceEstimate(model, hardware) {
  const v = getDefaultVariant(model);
  const sizeGB = getVariantSize(v);

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
  const gpuType = hardware?.gpu?.type || 'unknown';
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
  checkCompatibility,
  searchModels,
  filterByCategory,
  getPerformanceEstimate,
};
