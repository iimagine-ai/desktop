// Model Advisor — recommends the best local LLM based on hardware + use case
// Pure client-side logic, no server calls needed

const MODEL_DATABASE = [
  // --- Gemma 4 family (April 2026, Apache 2.0) ---
  {
    id: 'gemma4:e2b', name: 'Gemma 4 E2B', family: 'gemma4', params: '2B',
    sizeGB: 7.2, minRAM: 8, idealRAM: 12, needsGPU: false,
    speed: 'fast', quality: 'good', architecture: 'moe',
    strengths: ['chat', 'writing'], weaknesses: [],
    description: 'Google\'s latest edge model. MoE architecture delivers strong quality at low compute. Multimodal (text + images).',
  },
  {
    id: 'gemma4:e4b', name: 'Gemma 4 E4B', family: 'gemma4', params: '4B',
    sizeGB: 9.6, minRAM: 12, idealRAM: 16, needsGPU: false,
    speed: 'fast', quality: 'very-good', architecture: 'moe',
    strengths: ['chat', 'writing', 'coding', 'analysis'], weaknesses: [],
    description: 'Best balance of quality and speed for 12-16GB machines. MoE with 128K context. Multimodal.',
  },
  {
    id: 'gemma4:26b', name: 'Gemma 4 26B MoE', family: 'gemma4', params: '26B',
    sizeGB: 18, minRAM: 24, idealRAM: 32, needsGPU: false,
    speed: 'moderate', quality: 'excellent', architecture: 'moe',
    strengths: ['chat', 'writing', 'coding', 'analysis'], weaknesses: [],
    description: 'MoE model — only activates ~3.8B params per token. 27B-class intelligence at 4B compute cost. 256K context.',
  },
  {
    id: 'gemma4:31b', name: 'Gemma 4 31B Dense', family: 'gemma4', params: '31B',
    sizeGB: 20, minRAM: 32, idealRAM: 48, needsGPU: true,
    speed: 'moderate', quality: 'excellent', architecture: 'dense',
    strengths: ['chat', 'writing', 'coding', 'analysis'], weaknesses: [],
    description: 'Google\'s strongest open model. Dense architecture, 256K context. Top-3 on public benchmarks.',
  },
  // --- GPT-OSS (OpenAI open-source, 2025) ---
  {
    id: 'gpt-oss:20b', name: 'GPT-OSS 20B', family: 'gpt-oss', params: '20B',
    sizeGB: 14, minRAM: 20, idealRAM: 32, needsGPU: false,
    speed: 'moderate', quality: 'excellent', architecture: 'dense',
    strengths: ['chat', 'coding', 'analysis'], weaknesses: [],
    description: 'OpenAI\'s open-weight model. Strong reasoning and agentic workflows. 128K context.',
  },
  // --- Qwen 3 family (Alibaba) ---
  {
    id: 'qwen3:4b', name: 'Qwen 3 4B', family: 'qwen', params: '4B',
    sizeGB: 2.6, minRAM: 8, idealRAM: 12, needsGPU: false,
    speed: 'fast', quality: 'good', architecture: 'dense',
    strengths: ['coding', 'analysis', 'chat'], weaknesses: [],
    description: 'Alibaba\'s compact model. Strong at coding and multilingual tasks.',
  },
  {
    id: 'qwen3:8b', name: 'Qwen 3 8B', family: 'qwen', params: '8B',
    sizeGB: 5.2, minRAM: 10, idealRAM: 16, needsGPU: false,
    speed: 'moderate', quality: 'very-good', architecture: 'dense',
    strengths: ['coding', 'analysis', 'chat'], weaknesses: [],
    description: 'Excellent for coding and analytical tasks. Strong reasoning. 128K context.',
  },
  {
    id: 'qwen3:30b', name: 'Qwen 3 30B', family: 'qwen', params: '30B',
    sizeGB: 18, minRAM: 24, idealRAM: 32, needsGPU: true,
    speed: 'moderate', quality: 'excellent', architecture: 'moe',
    strengths: ['coding', 'analysis', 'chat', 'writing'], weaknesses: [],
    description: 'MoE architecture. Widely considered the best all-round local model in 2026.',
  },
  // --- Gemma 3 family (still solid options) ---
  {
    id: 'gemma3:4b', name: 'Gemma 3 4B', family: 'gemma3', params: '4B',
    sizeGB: 3.0, minRAM: 8, idealRAM: 12, needsGPU: false,
    speed: 'fast', quality: 'good', architecture: 'dense',
    strengths: ['chat', 'writing', 'analysis'], weaknesses: [],
    description: 'Previous-gen but still capable. Good starting point for 8GB machines.',
  },
  {
    id: 'gemma3:12b', name: 'Gemma 3 12B', family: 'gemma3', params: '12B',
    sizeGB: 8.1, minRAM: 12, idealRAM: 16, needsGPU: false,
    speed: 'moderate', quality: 'very-good', architecture: 'dense',
    strengths: ['chat', 'writing', 'analysis', 'coding'], weaknesses: [],
    description: 'High quality across all tasks. 128K context. Proven reliable.',
  },
  // --- Llama family (Meta) ---
  {
    id: 'llama3.2:3b', name: 'Llama 3.2 3B', family: 'llama', params: '3B',
    sizeGB: 2.0, minRAM: 6, idealRAM: 8, needsGPU: false,
    speed: 'fast', quality: 'good', architecture: 'dense',
    strengths: ['chat', 'writing'], weaknesses: ['coding'],
    description: 'Meta\'s compact model. Strong conversational ability for its size.',
  },
  {
    id: 'llama3.1:8b', name: 'Llama 3.1 8B', family: 'llama', params: '8B',
    sizeGB: 4.7, minRAM: 10, idealRAM: 16, needsGPU: false,
    speed: 'moderate', quality: 'very-good', architecture: 'dense',
    strengths: ['chat', 'writing', 'coding'], weaknesses: [],
    description: 'Meta\'s workhorse model. Reliable across all tasks. 128K context.',
  },
  // --- Phi 4 (Microsoft) ---
  {
    id: 'phi4-mini', name: 'Phi 4 Mini', family: 'phi', params: '3.8B',
    sizeGB: 2.5, minRAM: 6, idealRAM: 8, needsGPU: false,
    speed: 'fast', quality: 'good', architecture: 'dense',
    strengths: ['coding', 'analysis'], weaknesses: [],
    description: 'Microsoft\'s compact model. Punches above its weight for coding and reasoning.',
  },
  {
    id: 'phi4', name: 'Phi 4', family: 'phi', params: '14B',
    sizeGB: 9.1, minRAM: 12, idealRAM: 16, needsGPU: false,
    speed: 'moderate', quality: 'very-good', architecture: 'dense',
    strengths: ['coding', 'analysis', 'chat'], weaknesses: [],
    description: 'Microsoft\'s best compact text model. Strong reasoning at modest size.',
  },
  // --- Mistral ---
  {
    id: 'mistral:7b', name: 'Mistral 7B', family: 'mistral', params: '7B',
    sizeGB: 4.1, minRAM: 10, idealRAM: 16, needsGPU: false,
    speed: 'moderate', quality: 'very-good', architecture: 'dense',
    strengths: ['coding', 'analysis'], weaknesses: [],
    description: 'French AI lab\'s flagship small model. Efficient and capable.',
  },
  // --- Large models (32GB+ RAM) ---
  {
    id: 'qwen3:32b', name: 'Qwen 3 32B', family: 'qwen', params: '32B',
    sizeGB: 20, minRAM: 32, idealRAM: 48, needsGPU: true,
    speed: 'slow', quality: 'excellent', architecture: 'dense',
    strengths: ['coding', 'analysis', 'chat', 'writing'], weaknesses: [],
    description: 'Top-tier local model for users with powerful machines.',
  },
  {
    id: 'llama3.3:70b', name: 'Llama 3.3 70B', family: 'llama', params: '70B',
    sizeGB: 43, minRAM: 48, idealRAM: 64, needsGPU: true,
    speed: 'slow', quality: 'excellent', architecture: 'dense',
    strengths: ['chat', 'writing', 'coding', 'analysis'], weaknesses: [],
    description: 'Near frontier-model quality. Requires high-end hardware.',
  },
  // --- Embedding model (always recommended alongside a chat model) ---
  {
    id: 'nomic-embed-text', name: 'Nomic Embed Text', family: 'nomic', params: '137M',
    sizeGB: 0.3, minRAM: 4, idealRAM: 4, needsGPU: false,
    speed: 'very-fast', quality: 'n/a', architecture: 'dense',
    strengths: ['embeddings'], weaknesses: [],
    description: 'Required for Knowledge Base search. Tiny footprint.',
    isEmbedding: true,
  },
];

const USE_CASES = [
  { id: 'chat', label: 'General chat', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>', description: 'Conversations, Q&A, brainstorming' },
  { id: 'coding', label: 'Coding', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>', description: 'Write, debug, and explain code' },
  { id: 'writing', label: 'Writing', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>', description: 'Emails, articles, creative writing' },
  { id: 'analysis', label: 'Analysis', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>', description: 'Data analysis, research, reasoning' },
];

const RAM_OPTIONS = [
  { value: 4, label: '4 GB' },
  { value: 8, label: '8 GB' },
  { value: 12, label: '12 GB' },
  { value: 16, label: '16 GB' },
  { value: 24, label: '24 GB' },
  { value: 32, label: '32 GB' },
  { value: 48, label: '48 GB' },
  { value: 64, label: '64 GB' },
  { value: 128, label: '128 GB or more' },
];

const GPU_OPTIONS = [
  { value: 'none', label: 'No dedicated GPU' },
  { value: 'apple-m1', label: 'Apple M1 / M2' },
  { value: 'apple-m3', label: 'Apple M3 / M4' },
  { value: 'apple-m-pro', label: 'Apple M Pro / Max / Ultra' },
  { value: 'nvidia-low', label: 'NVIDIA (4-6GB VRAM)' },
  { value: 'nvidia-mid', label: 'NVIDIA (8-12GB VRAM)' },
  { value: 'nvidia-high', label: 'NVIDIA (16GB VRAM)' },
  { value: 'nvidia-ultra', label: 'NVIDIA (24GB+ VRAM)' },
  { value: 'amd', label: 'AMD GPU' },
  { value: 'unknown', label: 'Not sure' },
];

function getRecommendations(ramGB, gpu, useCases) {
  // Filter models that can run on this hardware
  const runnable = MODEL_DATABASE.filter(m => {
    if (m.isEmbedding) return false;
    if (ramGB < m.minRAM) return false;
    if (m.needsGPU && gpu === 'none') return false;
    return true;
  });

  if (!runnable.length) {
    return { primary: null, alternative: null, embedding: MODEL_DATABASE.find(m => m.isEmbedding), message: 'Your hardware may not support local AI models. Consider using the Regional Cloud or Cloud Models options in Settings.' };
  }

  // Score each model based on use case fit and hardware match
  const scored = runnable.map(m => {
    let score = 0;

    // Use case match (0-40 points)
    const selectedCases = useCases.length ? useCases : ['chat'];
    for (const uc of selectedCases) {
      if (m.strengths.includes(uc)) score += 40 / selectedCases.length;
      if (m.weaknesses.includes(uc)) score -= 20;
    }

    // Quality bonus (0-25 points)
    const qualityScores = { 'basic': 5, 'good': 12, 'very-good': 20, 'excellent': 25 };
    score += qualityScores[m.quality] || 0;

    // Speed bonus — faster is better for UX (0-15 points)
    const speedScores = { 'very-fast': 15, 'fast': 12, 'moderate': 7, 'slow': 2 };
    score += speedScores[m.speed] || 0;

    // Hardware fit — prefer models that use available RAM well without maxing it out (0-20 points)
    const ramUsageRatio = m.sizeGB / ramGB;
    if (ramUsageRatio < 0.3) score += 10; // Comfortable fit
    else if (ramUsageRatio < 0.5) score += 20; // Good utilization
    else if (ramUsageRatio < 0.7) score += 15; // Tight but fine
    else score += 5; // Will work but might be slow

    // GPU bonus — if user has a good GPU, prefer larger models
    if (gpu.startsWith('apple-m') || gpu.startsWith('nvidia')) {
      if (m.params.includes('B')) {
        const paramNum = parseFloat(m.params);
        if (paramNum >= 7) score += 5; // Reward larger models when GPU is available
      }
    }

    return { model: m, score };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  const primary = scored[0]?.model || null;
  // Pick an alternative that's different from primary (different family or size)
  const alternative = scored.find(s => s.model.id !== primary?.id && s.model.family !== primary?.family)?.model || scored[1]?.model || null;
  const embedding = MODEL_DATABASE.find(m => m.isEmbedding);

  return { primary, alternative, embedding };
}

function getPerformanceEstimate(model, ramGB, gpu) {
  if (!model) return null;

  let tokensPerSec = 0;
  const paramNum = parseFloat(model.params) || 1;

  // Base estimate from model size
  if (paramNum <= 2) tokensPerSec = 40;
  else if (paramNum <= 4) tokensPerSec = 25;
  else if (paramNum <= 8) tokensPerSec = 15;
  else if (paramNum <= 16) tokensPerSec = 8;
  else if (paramNum <= 32) tokensPerSec = 4;
  else tokensPerSec = 2;

  // GPU multiplier
  if (gpu === 'apple-m3' || gpu === 'apple-m-pro') tokensPerSec *= 2.0;
  else if (gpu === 'apple-m1') tokensPerSec *= 1.5;
  else if (gpu === 'nvidia-high') tokensPerSec *= 2.5;
  else if (gpu === 'nvidia-ultra') tokensPerSec *= 3.0;
  else if (gpu === 'nvidia-mid') tokensPerSec *= 1.8;
  else if (gpu === 'nvidia-low') tokensPerSec *= 1.3;

  // RAM pressure penalty
  const ramUsageRatio = model.sizeGB / ramGB;
  if (ramUsageRatio > 0.7) tokensPerSec *= 0.6;
  else if (ramUsageRatio > 0.5) tokensPerSec *= 0.8;

  tokensPerSec = Math.round(tokensPerSec);

  // Translate to user-friendly terms
  let speedLabel, speedColor;
  if (tokensPerSec >= 30) { speedLabel = 'Very fast'; speedColor = 'text-emerald-600'; }
  else if (tokensPerSec >= 15) { speedLabel = 'Fast'; speedColor = 'text-emerald-600'; }
  else if (tokensPerSec >= 8) { speedLabel = 'Moderate'; speedColor = 'text-amber-600'; }
  else if (tokensPerSec >= 4) { speedLabel = 'Slow'; speedColor = 'text-amber-600'; }
  else { speedLabel = 'Very slow'; speedColor = 'text-rose-600'; }

  // Words per minute (rough: 1 token ≈ 0.75 words)
  const wordsPerMin = Math.round(tokensPerSec * 0.75 * 60);

  return { tokensPerSec, wordsPerMin, speedLabel, speedColor };
}

window.ModelAdvisor = {
  MODEL_DATABASE,
  USE_CASES,
  RAM_OPTIONS,
  GPU_OPTIONS,
  getRecommendations,
  getPerformanceEstimate,
};
