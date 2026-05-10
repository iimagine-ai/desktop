// Legal Companion — Legal Entity Extraction
// Extends Cortex Lite's extraction with legal-specific entity types

const legalDb = require('./db');
const LOG = '[Legal:Extract]';

let ollamaUrl = 'http://localhost:11434';
let activeMatterId = null;

function configure(url) {
  ollamaUrl = url;
}

function setActiveMatter(matterId) {
  activeMatterId = matterId;
}

// Extract legal entities from a conversation exchange
async function extractLegalEntities(userMessage, assistantResponse) {
  if (!activeMatterId || !userMessage) return;

  const matter = legalDb.getMatter(activeMatterId);
  if (!matter) return;

  const combined = `User: ${userMessage}\nAssistant: ${assistantResponse || ''}`;

  // Only extract if the conversation seems to contain legal content
  if (combined.length < 50) return;

  try {
    const prompt = buildExtractionPrompt(combined, matter);
    const result = await callOllama(prompt);
    if (result) {
      processExtraction(result, activeMatterId);
    }
  } catch (err) {
    console.warn(`${LOG} Extraction failed:`, err.message);
  }
}

function buildExtractionPrompt(text, matter) {
  return `You are a legal information extractor. Analyze the following conversation and extract structured legal information.

Context: This is a ${matter.practice_area || 'legal'} matter in ${matter.jurisdiction || 'unknown jurisdiction'}.

Extract ONLY information that is explicitly stated. Do not infer or assume.

Return a JSON object with these fields (include only fields where you found data):
{
  "deadlines": [{ "description": "...", "date": "YYYY-MM-DD or description", "type": "filing|limitation|compliance|court|contractual" }],
  "legal_issues": [{ "description": "...", "area_of_law": "..." }],
  "obligations": [{ "party": "...", "description": "...", "due_date": "..." }],
  "key_facts": ["..."]
}

If no legal information is found, return: {}

Conversation:
${text.slice(0, 2000)}

JSON output:`;
}

async function callOllama(prompt) {
  try {
    // Get the currently loaded model from Ollama
    let modelName = null;
    try {
      const psResp = await fetch(`${ollamaUrl}/api/ps`);
      if (psResp.ok) {
        const psData = await psResp.json();
        if (psData.models && psData.models.length > 0) {
          modelName = psData.models[0].name;
        }
      }
    } catch {}

    if (!modelName) {
      console.warn(`${LOG} No model loaded in Ollama, skipping extraction`);
      return null;
    }

    const response = await fetch(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelName,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        options: { temperature: 0.1 },
      }),
    });

    if (!response.ok) return null;
    const data = await response.json();
    const content = data.message?.content || '';

    // Try to parse JSON from the response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.warn(`${LOG} Ollama call failed:`, err.message);
    return null;
  }
}

function processExtraction(data, matterId) {
  if (!data || typeof data !== 'object') return;

  // Log deadlines
  if (Array.isArray(data.deadlines) && data.deadlines.length > 0) {
    for (const d of data.deadlines) {
      legalDb.logActivity(matterId, 'deadline_extracted', 
        `Deadline: ${d.description} (${d.date || 'no date'})`,
        { type: d.type, date: d.date });
    }
    console.log(`${LOG} Extracted ${data.deadlines.length} deadlines`);
  }

  // Log legal issues
  if (Array.isArray(data.legal_issues) && data.legal_issues.length > 0) {
    for (const issue of data.legal_issues) {
      legalDb.logActivity(matterId, 'issue_identified',
        `Issue: ${issue.description}`,
        { area_of_law: issue.area_of_law });
    }
    console.log(`${LOG} Extracted ${data.legal_issues.length} legal issues`);
  }

  // Log key facts
  if (Array.isArray(data.key_facts) && data.key_facts.length > 0) {
    for (const fact of data.key_facts) {
      legalDb.logActivity(matterId, 'fact_noted', fact);
    }
  }
}

module.exports = { configure, setActiveMatter, extractLegalEntities };
