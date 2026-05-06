// Cortex Lite — Embedding generation via Ollama
// Uses the active Ollama instance to generate 768-dim embeddings

const LOG = '[CortexLite:Embed]';

let ollamaUrl = 'http://localhost:11434';
let embeddingModel = 'nomic-embed-text';
let available = false;

function configure(url, model) {
  ollamaUrl = url || 'http://localhost:11434';
  embeddingModel = model || 'nomic-embed-text';
}

async function checkAvailability() {
  try {
    const res = await fetch(`${ollamaUrl}/api/tags`);
    if (!res.ok) { available = false; return false; }
    const data = await res.json();
    const models = (data.models || []).map(m => m.name.split(':')[0]);
    available = models.includes(embeddingModel);
    if (!available) {
      console.log(`${LOG} Model "${embeddingModel}" not found. Available: ${models.join(', ')}`);
    }
    return available;
  } catch (err) {
    console.warn(`${LOG} Ollama not reachable:`, err.message);
    available = false;
    return false;
  }
}

async function generateEmbedding(text) {
  if (!available) return null;
  if (!text || !text.trim()) return null;

  try {
    const res = await fetch(`${ollamaUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: embeddingModel, prompt: text.slice(0, 2000) }),
    });

    if (!res.ok) {
      console.warn(`${LOG} Embedding request failed: ${res.status}`);
      return null;
    }

    const data = await res.json();
    if (data.embedding && Array.isArray(data.embedding)) {
      return data.embedding;
    }
    return null;
  } catch (err) {
    console.warn(`${LOG} Embedding error:`, err.message);
    return null;
  }
}

async function generateEmbeddings(texts) {
  const results = [];
  for (const text of texts) {
    const emb = await generateEmbedding(text);
    results.push(emb);
  }
  return results;
}

function isAvailable() {
  return available;
}

module.exports = {
  configure,
  checkAvailability,
  generateEmbedding,
  generateEmbeddings,
  isAvailable,
};
