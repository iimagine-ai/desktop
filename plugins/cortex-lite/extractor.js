// Cortex Lite — Extraction pipeline (chatPostprocess)
// Sends user+assistant exchange to LLM, extracts entities/relationships/facts
// Uses the same cloud model as chat (not local Ollama)

const memoryDb = require('./db');
const embeddings = require('./embeddings');

const LOG = '[CortexLite:Extract]';

let ollamaUrl = 'http://localhost:11434';
let chatModel = null; // Will be determined from active provider
let cloudConfig = null; // { vendor, apiKey, model, url, authHeader, isAnthropic, isGemini }

function configure(url, model, cloud) {
  ollamaUrl = url || 'http://localhost:11434';
  chatModel = model;
  cloudConfig = cloud || null;
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

const PROJECT_EXTRACTION_PROMPT = `You are a professional services project tracker. Extract structured information from a client communication that helps track project status, commitments, requests, and financials.

Entity types to extract:
- "request": Something the client has asked for (name = brief description, status = "pending")
- "commitment": A promise made by either party (name = brief description, raised_by = who made it: "client" or "provider")
- "decision": Something agreed upon by both parties (name = brief description)
- "issue": A problem, concern, or complaint raised (name = brief description, raised_by = "client" or "provider")
- "deadline": A date or timeframe mentioned (name = brief description, due_date = date if mentioned e.g. "2026-06-30")
- "approval": Something signed off or accepted (name = brief description)
- "question": An open question needing an answer (name = brief description, status = "unanswered")
- "quote": A price quoted for work (name = what it's for, amount = numeric value if mentioned)
- "milestone": A named phase or deliverable (name = milestone name, due_date = date if mentioned, amount = value if mentioned)

Rules:
- Only extract what is clearly stated or strongly implied
- For amount fields: extract numeric value only (e.g. 500 not "$500")
- For due_date fields: use ISO format YYYY-MM-DD if a specific date is mentioned, otherwise omit
- For status fields on requests: use "pending" by default
- Keep names short and descriptive (under 10 words)
- If nothing meaningful to extract, return empty arrays

Output ONLY valid JSON (no markdown, no code fences):
{
  "entities": [
    { "type": "request", "name": "Add dark mode to settings", "status": "pending" },
    { "type": "quote", "name": "Dark mode implementation", "amount": 500 },
    { "type": "commitment", "name": "Deliver phase 1 by Friday", "raised_by": "provider" },
    { "type": "deadline", "name": "Phase 1 delivery", "due_date": "2026-05-30" }
  ],
  "facts": [
    "Client requested dark mode feature on 2026-05-14"
  ]
}`;

async function extract(userMessage, assistantResponse) {
  if (!userMessage || userMessage.trim().length < 5) return null;

  const conversationText = `User: ${userMessage}\nAssistant: ${assistantResponse || '(no response yet)'}`;

  try {
    // Use cloud provider if configured (same model as chat)
    if (cloudConfig && cloudConfig.apiKey) {
      return await extractViaCloud(conversationText);
    }

    // Fallback to local Ollama
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
    console.warn(`${LOG} Extraction error:`, err.message);
    return null;
  }
}

/**
 * Extract project-scoped entities from a client communication.
 * Uses the PROJECT_EXTRACTION_PROMPT instead of the general one.
 */
async function extractProject(commText) {
  if (!commText || commText.trim().length < 5) return null;

  try {
    if (cloudConfig && cloudConfig.apiKey) {
      return await extractViaCloudWithPrompt(PROJECT_EXTRACTION_PROMPT, commText);
    }

    const model = chatModel || await getDefaultModel();
    if (!model) return null;

    const res = await fetch(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'user', content: `${PROJECT_EXTRACTION_PROMPT}\n\n---\n\n${commText}` },
        ],
        stream: false,
        options: { temperature: 0.1, num_predict: 1500 },
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const raw = (data.message?.content || '').trim();
    return parseExtractionResponse(raw);
  } catch (err) {
    console.warn(`${LOG} Project extraction error:`, err.message);
    return null;
  }
}

async function extractViaCloudWithPrompt(prompt, text) {
  const { vendor, apiKey, model, url, authHeader, isAnthropic, isGemini } = cloudConfig;
  const fullPrompt = `${prompt}\n\n---\n\n${text}`;

  try {
    let raw = '';

    if (isAnthropic) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: fullPrompt }], max_tokens: 1500, temperature: 0.1 }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      raw = data.content?.[0]?.text || '';
    } else if (isGemini) {
      const geminiUrl = url.replace('{model}', model) + `?key=${apiKey}`;
      const res = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: fullPrompt }] }], generationConfig: { temperature: 0.1, maxOutputTokens: 1500 } }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } else {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `${authHeader || 'Bearer'} ${apiKey}` },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: fullPrompt }], max_completion_tokens: 1500, temperature: 0.1, stream: false }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      raw = data.choices?.[0]?.message?.content || '';
    }

    return parseExtractionResponse(raw.trim());
  } catch (err) {
    console.warn(`${LOG} Cloud project extraction error:`, err.message);
    return null;
  }
}

async function extractViaCloud(conversationText) {
  const { vendor, apiKey, model, url, authHeader, isAnthropic, isGemini } = cloudConfig;
  const messages = [{ role: 'user', content: `${EXTRACTION_PROMPT}\n\n---\n\n${conversationText}` }];

  console.log(`${LOG} Using cloud: ${vendor}/${model}`);

  try {
    let raw = '';

    if (isAnthropic) {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({ model, messages, max_tokens: 1500, temperature: 0.1 }),
      });
      if (!res.ok) { console.warn(`${LOG} Anthropic failed: ${res.status}`); return null; }
      const data = await res.json();
      raw = data.content?.[0]?.text || '';
    } else if (isGemini) {
      const geminiUrl = url.replace('{model}', model) + `?key=${apiKey}`;
      const contents = [{ role: 'user', parts: [{ text: `${EXTRACTION_PROMPT}\n\n---\n\n${conversationText}` }] }];
      const res = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents, generationConfig: { temperature: 0.1, maxOutputTokens: 1500 } }),
      });
      if (!res.ok) { console.warn(`${LOG} Gemini failed: ${res.status}`); return null; }
      const data = await res.json();
      raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } else {
      // OpenAI-compatible (OpenAI, OpenRouter)
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `${authHeader || 'Bearer'} ${apiKey}`,
        },
        body: JSON.stringify({ model, messages, max_completion_tokens: 1500, temperature: 0.1, stream: false }),
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        console.warn(`${LOG} Cloud failed: ${res.status} — ${errBody.slice(0, 300)}`);
        return null;
      }
      const data = await res.json();
      raw = data.choices?.[0]?.message?.content || '';
    }

    return parseExtractionResponse(raw.trim());
  } catch (err) {
    console.warn(`${LOG} Cloud extraction error:`, err.message);
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

  // Aggressive cleanup: strip everything before first { and after last }
  const firstBrace = json.indexOf('{');
  const lastBrace = json.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    json = json.slice(firstBrace, lastBrace + 1);
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
    // Try to find the outermost JSON object using brace matching
    const startIdx = raw.indexOf('{');
    if (startIdx === -1) {
      console.warn(`${LOG} No JSON object found in response`);
      return null;
    }

    // Find matching closing brace (handles nested objects)
    let depth = 0;
    let endIdx = -1;
    for (let i = startIdx; i < raw.length; i++) {
      if (raw[i] === '{') depth++;
      else if (raw[i] === '}') {
        depth--;
        if (depth === 0) { endIdx = i; break; }
      }
    }

    if (endIdx !== -1) {
      try {
        const parsed = JSON.parse(raw.slice(startIdx, endIdx + 1));
        return {
          entities: Array.isArray(parsed.entities) ? parsed.entities : [],
          relationships: Array.isArray(parsed.relationships) ? parsed.relationships : [],
          facts: Array.isArray(parsed.facts) ? parsed.facts : [],
        };
      } catch {}
    }

    console.warn(`${LOG} Failed to parse extraction JSON:`, err.message, '— raw start:', raw.slice(0, 100));
    return null;
  }
}

async function processExtraction(extracted, projectId) {
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
      projectId: projectId || null,
      status: entity.status || null,
      amount: entity.amount !== undefined ? entity.amount : null,
      dueDate: entity.due_date || null,
      raisedBy: entity.raised_by || null,
    });
    nameToId.set(entity.name, id);
    entityCount++;
  }

  // Upsert relationships (only for non-project extractions — project prompt doesn't return relationships)
  if (extracted.relationships) {
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
  extractProject,
  processExtraction,
};
