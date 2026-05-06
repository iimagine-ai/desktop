// Cortex Lite — Extraction pipeline (chatPostprocess)
// Sends user+assistant exchange to LLM, extracts entities/relationships/facts

const memoryDb = require('./db');
const embeddings = require('./embeddings');

const LOG = '[CortexLite:Extract]';

let ollamaUrl = 'http://localhost:11434';
let chatModel = null; // Will be determined from active provider

function configure(url, model) {
  ollamaUrl = url || 'http://localhost:11434';
  chatModel = model;
}

const EXTRACTION_PROMPT = `You are a memory extraction system. Your job is to read a conversation exchange and extract structured information that helps an AI remember the user over time.

Extract:
1. Entities — people, places, topics, goals, preferences, habits, tools, organizations
2. Relationships — how entities relate to each other
3. Facts — atomic statements worth remembering about the user
4. Preferences — communication style, interests, dislikes

Rules:
- Only extract information that is clearly stated or strongly implied
- Use simple, consistent entity types: person, goal, preference, topic, habit, tool, organization, location, fact
- Keep fact statements short and atomic (one idea per fact)
- If nothing meaningful to extract, return empty arrays

Output ONLY valid JSON (no markdown, no code fences):
{
  "entities": [
    { "type": "person", "name": "Name", "properties": { "key": "value" } }
  ],
  "relationships": [
    { "source": "Entity A name", "target": "Entity B name", "type": "relationship_type" }
  ],
  "facts": [
    "Short factual statement about the user"
  ]
}`;

async function extract(userMessage, assistantResponse) {
  if (!userMessage || userMessage.trim().length < 5) return null;

  const conversationText = `User: ${userMessage}\nAssistant: ${assistantResponse || '(no response yet)'}`;

  try {
    // Determine which model to use
    const model = chatModel || await getDefaultModel();
    if (!model) {
      console.warn(`${LOG} No model available for extraction`);
      return null;
    }

    const res = await fetch(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'user', content: `${EXTRACTION_PROMPT}\n\n---\n\n${conversationText}` },
        ],
        stream: false,
        options: { temperature: 0.1, num_predict: 1500 },
      }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.warn(`${LOG} LLM request failed: ${res.status} — ${errBody.slice(0, 200)}`);
      return null;
    }

    const data = await res.json();
    const raw = (data.message?.content || '').trim();

    return parseExtractionResponse(raw);
  } catch (err) {
    console.error(`${LOG} Extraction error:`, err.message);
    return null;
  }
}

function parseExtractionResponse(raw) {
  if (!raw) return null;

  // Strip code fences if present
  let json = raw;
  if (json.startsWith('```')) {
    json = json.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  }

  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object') return null;

    return {
      entities: Array.isArray(parsed.entities) ? parsed.entities : [],
      relationships: Array.isArray(parsed.relationships) ? parsed.relationships : [],
      facts: Array.isArray(parsed.facts) ? parsed.facts : [],
    };
  } catch (err) {
    // Try to find JSON object in the response
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        return {
          entities: Array.isArray(parsed.entities) ? parsed.entities : [],
          relationships: Array.isArray(parsed.relationships) ? parsed.relationships : [],
          facts: Array.isArray(parsed.facts) ? parsed.facts : [],
        };
      } catch {}
    }
    console.warn(`${LOG} Failed to parse extraction JSON:`, err.message);
    return null;
  }
}

async function processExtraction(extracted) {
  if (!extracted) return { entities: 0, relationships: 0, facts: 0 };

  let entityCount = 0;
  let relCount = 0;
  let factCount = 0;

  // Map entity names to IDs for relationship resolution
  const nameToId = new Map();

  // Upsert entities
  for (const entity of extracted.entities) {
    if (!entity.name || !entity.type) continue;
    const id = memoryDb.upsertEntity({
      type: entity.type.toLowerCase(),
      name: entity.name,
      properties: entity.properties || {},
      confidence: 1.0,
    });
    nameToId.set(entity.name, id);
    entityCount++;
  }

  // Upsert relationships
  for (const rel of extracted.relationships) {
    if (!rel.source || !rel.target || !rel.type) continue;
    const sourceId = nameToId.get(rel.source);
    const targetId = nameToId.get(rel.target);
    if (sourceId && targetId) {
      memoryDb.upsertRelationship({
        sourceId,
        targetId,
        type: rel.type,
        properties: {},
      });
      relCount++;
    }
  }

  // Store facts and generate embeddings
  for (const factText of extracted.facts) {
    if (!factText || factText.length < 5) continue;
    const factId = memoryDb.addFact({
      content: factText,
      source: new Date().toISOString(),
      entityIds: [],
    });
    factCount++;

    // Generate and store embedding (non-blocking)
    if (embeddings.isAvailable()) {
      const emb = await embeddings.generateEmbedding(factText);
      if (emb) {
        memoryDb.storeFactEmbedding(factId, emb);
      }
    }
  }

  console.log(`${LOG} Processed: ${entityCount} entities, ${relCount} relationships, ${factCount} facts`);
  return { entities: entityCount, relationships: relCount, facts: factCount };
}

async function getDefaultModel() {
  try {
    const res = await fetch(`${ollamaUrl}/api/tags`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.models || data.models.length === 0) return null;

    // Skip embedding-only models (nomic-embed-text, mxbai-embed, etc.)
    const embeddingPatterns = ['embed', 'nomic-embed', 'mxbai-embed', 'bge-'];
    const chatModels = data.models.filter(m => {
      const name = m.name.toLowerCase();
      return !embeddingPatterns.some(p => name.includes(p));
    });

    if (chatModels.length > 0) {
      console.log(`${LOG} Auto-detected chat model: ${chatModels[0].name}`);
      return chatModels[0].name;
    }

    // Fallback to first model if no chat models found
    console.warn(`${LOG} No chat models found, trying: ${data.models[0].name}`);
    return data.models[0].name;
  } catch (err) {
    console.warn(`${LOG} Failed to get models:`, err.message);
    return null;
  }
}

module.exports = {
  configure,
  extract,
  processExtraction,
};
