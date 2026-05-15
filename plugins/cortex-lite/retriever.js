// Cortex Lite — Retrieval pipeline (chatPreprocess)
// Queries KG + vector DB + summaries to build context for the LLM
// Also queries project-scoped KG entities when a projectId is provided.

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

async function buildContext(userMessage, options = {}) {
  if (!userMessage || userMessage.trim().length < 2) return null;

  const { projectId } = options;
  const startTime = Date.now();
  const contextParts = [];
  let tokenCount = 0;

  // 0. Project KG entities (highest priority when a project is active)
  if (projectId) {
    const projectSection = getProjectKGContext(projectId, userMessage);
    if (projectSection) {
      const projTokens = estimateTokens(projectSection);
      if (tokenCount + projTokens <= config.tokenBudget) {
        contextParts.push(projectSection);
        tokenCount += projTokens;
      }
    }
  }

  // 1. Vector search for similar facts
  const vectorFacts = await getVectorFacts(userMessage);

  // 2. KG entity lookup by keywords
  const kgResults = getKGContext(userMessage);

  // 3. Recent summaries
  const summaries = memoryDb.getRecentSummaries(config.maxSummaries);

  // Assemble context with priority ranking
  // Priority: project KG > direct entity matches > vector facts > summaries

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

// ── Project KG Context ──────────────────────────────────────────

/**
 * Query structured project entities from the KG.
 * Returns a formatted section with requests, commitments, deadlines, etc.
 * Includes metadata (total counts, date range) so the LLM can state assumptions.
 * Entities are sorted most-recent-first within each type.
 */
function getProjectKGContext(projectId, userMessage) {
  const allEntities = memoryDb.getProjectEntities(projectId);
  if (!allEntities || allEntities.length === 0) return null;

  const queryLower = userMessage.toLowerCase();

  // Group entities by type
  const grouped = {};
  for (const entity of allEntities) {
    if (!grouped[entity.type]) grouped[entity.type] = [];
    grouped[entity.type].push(entity);
  }

  // Determine which types are relevant to the query
  const typeKeywords = {
    request: ['request', 'asked', 'want', 'feature', 'scope', 'pending', 'outstanding'],
    commitment: ['commit', 'promise', 'agreed', 'will do'],
    decision: ['decision', 'decided', 'agreed', 'confirmed'],
    issue: ['issue', 'problem', 'concern', 'bug', 'complaint'],
    deadline: ['deadline', 'due', 'when', 'date', 'timeline', 'schedule'],
    approval: ['approved', 'signed off', 'accepted', 'approval'],
    question: ['question', 'unanswered', 'asked', 'clarif'],
    quote: ['quote', 'price', 'cost', 'amount', 'how much', 'budget', 'invoice'],
    milestone: ['milestone', 'phase', 'deliverable', 'stage'],
  };

  // Check if query is broad (status, summary, overview) — include all types
  const broadKeywords = ['status', 'summary', 'overview', 'update', 'everything', 'all', 'what', 'list', 'show'];
  const isBroadQuery = broadKeywords.some(kw => queryLower.includes(kw));

  let relevantTypes = [];
  if (isBroadQuery) {
    relevantTypes = Object.keys(grouped);
  } else {
    for (const [type, keywords] of Object.entries(typeKeywords)) {
      if (grouped[type] && keywords.some(kw => queryLower.includes(kw))) {
        relevantTypes.push(type);
      }
    }
    // If no specific type matched, include all (user might be asking about a specific entity by name)
    if (relevantTypes.length === 0) {
      relevantTypes = Object.keys(grouped);
    }
  }

  const LIMIT_PER_TYPE = 10;
  const lines = [];
  const meta = { totalShown: 0, totalAvailable: 0, typesWithMore: [] };

  for (const type of relevantTypes) {
    const entities = grouped[type];
    if (!entities || entities.length === 0) continue;

    // Sort most-recent-first by created_at
    entities.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

    meta.totalAvailable += entities.length;
    const shown = entities.slice(0, LIMIT_PER_TYPE);
    meta.totalShown += shown.length;

    const typeLabel = type.charAt(0).toUpperCase() + type.slice(1) + 's';
    lines.push(`${typeLabel} (${shown.length} of ${entities.length}, most recent first):`);

    for (const e of shown) {
      let detail = `  - ${e.name}`;
      if (e.status) detail += ` [${e.status}]`;
      if (e.amount) detail += ` ($${e.amount})`;
      if (e.due_date) detail += ` (due: ${e.due_date})`;
      if (e.raised_by) detail += ` (by: ${e.raised_by})`;
      if (e.created_at) detail += ` (logged: ${e.created_at.split('T')[0] || e.created_at.split(' ')[0]})`;
      lines.push(detail);
    }
    if (entities.length > LIMIT_PER_TYPE) {
      meta.typesWithMore.push(`${type}: ${entities.length - LIMIT_PER_TYPE} more`);
    }
  }

  if (lines.length === 0) return null;

  // Build metadata header so the LLM can state assumptions accurately
  let header = `Project KG (structured entities — ${meta.totalShown} shown of ${meta.totalAvailable} total, sorted most recent first):`;
  if (meta.typesWithMore.length > 0) {
    header += `\n  [Note: truncated — ${meta.typesWithMore.join('; ')}. User can ask for more or specify a date range.]`;
  }

  return `${header}\n${lines.join('\n')}\n\n[INSTRUCTION: When responding with project data, present items in date order (most recent first). If you made assumptions about quantity, timeframe, or scope, state them briefly at the end of your response under "Assumptions".]`;
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
