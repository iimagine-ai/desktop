// Cortex Lite — Retrieval pipeline (chatPreprocess)
// Queries KG + vector DB + summaries to build context for the LLM

const memoryDb = require('./db');
const embeddings = require('./embeddings');

const LOG = '[CortexLite:Retrieve]';

// Default config
let config = {
  tokenBudget: 1500,
  maxFacts: 5,
  maxEntities: 8,
  maxSummaries: 3,
};

function configure(opts) {
  config = { ...config, ...opts };
}

async function buildContext(userMessage) {
  if (!userMessage || userMessage.trim().length < 2) return null;

  const startTime = Date.now();
  const contextParts = [];
  let tokenCount = 0;

  // 1. Vector search for similar facts
  const vectorFacts = await getVectorFacts(userMessage);

  // 2. KG entity lookup by keywords
  const kgResults = getKGContext(userMessage);

  // 3. Recent summaries
  const summaries = memoryDb.getRecentSummaries(config.maxSummaries);

  // Assemble context with priority ranking
  // Priority: direct entity matches > vector facts > summaries

  // Add entity context
  if (kgResults.entities.length > 0) {
    const entitySection = formatEntities(kgResults.entities);
    const entityTokens = estimateTokens(entitySection);
    if (tokenCount + entityTokens <= config.tokenBudget) {
      contextParts.push(entitySection);
      tokenCount += entityTokens;
    }
  }

  // Add relationship context
  if (kgResults.relationships.length > 0) {
    const relSection = formatRelationships(kgResults.relationships);
    const relTokens = estimateTokens(relSection);
    if (tokenCount + relTokens <= config.tokenBudget) {
      contextParts.push(relSection);
      tokenCount += relTokens;
    }
  }

  // Add vector-matched facts
  if (vectorFacts.length > 0) {
    const factSection = formatFacts(vectorFacts);
    const factTokens = estimateTokens(factSection);
    if (tokenCount + factTokens <= config.tokenBudget) {
      contextParts.push(factSection);
      tokenCount += factTokens;
    }
  }

  // Add keyword-matched facts (fallback if no vector results)
  if (vectorFacts.length === 0 && kgResults.keywordFacts.length > 0) {
    const kwSection = formatFacts(kgResults.keywordFacts);
    const kwTokens = estimateTokens(kwSection);
    if (tokenCount + kwTokens <= config.tokenBudget) {
      contextParts.push(kwSection);
      tokenCount += kwTokens;
    }
  }

  // Add summaries
  if (summaries.length > 0) {
    const sumSection = formatSummaries(summaries);
    const sumTokens = estimateTokens(sumSection);
    if (tokenCount + sumTokens <= config.tokenBudget) {
      contextParts.push(sumSection);
      tokenCount += sumTokens;
    }
  }

  const elapsed = Date.now() - startTime;

  if (contextParts.length === 0) {
    return null;
  }

  const context = `[Memory Context]\n${contextParts.join('\n\n')}\n[End Memory Context]`;
  console.log(`${LOG} Built context: ${tokenCount} tokens, ${elapsed}ms`);
  return context;
}

async function getVectorFacts(message) {
  if (!embeddings.isAvailable()) return [];

  try {
    const queryEmb = await embeddings.generateEmbedding(message);
    if (!queryEmb) return [];

    const results = memoryDb.searchByEmbedding(queryEmb, config.maxFacts);
    return results.map(r => r.content);
  } catch (err) {
    console.warn(`${LOG} Vector search failed:`, err.message);
    return [];
  }
}

function getKGContext(message) {
  // Extract keywords (simple approach: split on spaces, filter short words)
  const words = message.toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 3);

  const entities = [];
  const relationships = [];
  const keywordFacts = [];
  const seenEntityIds = new Set();

  // Search entities by keyword
  for (const word of words.slice(0, 5)) { // limit to 5 keywords
    const matches = memoryDb.searchEntities(word);
    for (const entity of matches) {
      if (seenEntityIds.has(entity.id)) continue;
      seenEntityIds.add(entity.id);
      entities.push(entity);

      // Get 1-hop relationships
      if (entities.length <= config.maxEntities) {
        const rels = memoryDb.getRelationshipsForEntity(entity.id);
        relationships.push(...rels.slice(0, 3));
      }
    }
    if (entities.length >= config.maxEntities) break;
  }

  // Keyword search in facts (fallback for when vector search unavailable)
  for (const word of words.slice(0, 3)) {
    const facts = memoryDb.searchFactsByKeyword(word);
    for (const fact of facts) {
      if (!keywordFacts.includes(fact.content)) {
        keywordFacts.push(fact.content);
      }
    }
    if (keywordFacts.length >= config.maxFacts) break;
  }

  return { entities: entities.slice(0, config.maxEntities), relationships, keywordFacts: keywordFacts.slice(0, config.maxFacts) };
}

// ── Formatting ──────────────────────────────────────────────────

function formatEntities(entities) {
  if (!entities.length) return '';
  const lines = entities.map(e => {
    let props = '';
    try {
      const p = JSON.parse(e.properties || '{}');
      const keys = Object.keys(p).slice(0, 3);
      if (keys.length) props = ` (${keys.map(k => `${k}: ${p[k]}`).join(', ')})`;
    } catch {}
    return `- ${e.name} [${e.type}]${props}`;
  });
  return `Known entities:\n${lines.join('\n')}`;
}

function formatRelationships(relationships) {
  if (!relationships.length) return '';
  // Deduplicate
  const seen = new Set();
  const lines = [];
  for (const r of relationships) {
    const key = `${r.source_name}-${r.type}-${r.target_name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`- ${r.source_name} → ${r.type} → ${r.target_name}`);
  }
  return lines.length ? `Relationships:\n${lines.slice(0, 6).join('\n')}` : '';
}

function formatFacts(facts) {
  if (!facts.length) return '';
  const lines = facts.map(f => `- ${f}`);
  return `Remembered facts:\n${lines.join('\n')}`;
}

function formatSummaries(summaries) {
  if (!summaries.length) return '';
  const lines = summaries.map(s => `- ${s.summary}`);
  return `Recent conversation context:\n${lines.join('\n')}`;
}

function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

module.exports = {
  configure,
  buildContext,
};
