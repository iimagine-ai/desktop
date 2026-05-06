// Cortex Lite — Conversation summarizer
// Generates compressed summaries after N messages to maintain long-term context

const memoryDb = require('./db');

const LOG = '[CortexLite:Summarize]';

let ollamaUrl = 'http://localhost:11434';
let chatModel = null;
let messageBuffer = [];
let summarizeThreshold = 10;

function configure(url, model, threshold) {
  ollamaUrl = url || 'http://localhost:11434';
  chatModel = model;
  summarizeThreshold = threshold || 10;
}

function addMessage(role, content) {
  messageBuffer.push({ role, content, timestamp: new Date().toISOString() });
}

function getBufferSize() {
  return messageBuffer.length;
}

function shouldSummarize() {
  return messageBuffer.length >= summarizeThreshold;
}

async function summarizeAndStore() {
  if (messageBuffer.length < 4) return null; // Need at least a few exchanges

  try {
    const model = chatModel || await getDefaultModel();
    if (!model) {
      console.warn(`${LOG} No model available for summarization`);
      return null;
    }

    // Build conversation text from buffer
    const conversationText = messageBuffer
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 300)}`)
      .join('\n');

    const res = await fetch(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: 'Summarize this conversation in 2-3 sentences. Focus on key topics discussed, decisions made, and any personal information shared by the user. Be concise.',
          },
          { role: 'user', content: conversationText },
        ],
        stream: false,
        options: { temperature: 0.3, num_predict: 200 },
      }),
    });

    if (!res.ok) {
      console.warn(`${LOG} Summarization request failed: ${res.status}`);
      return null;
    }

    const data = await res.json();
    const summary = (data.message?.content || '').trim();

    if (summary) {
      const tokenEstimate = Math.ceil(summary.length / 4);
      memoryDb.addSummary({
        summary,
        messageCount: messageBuffer.length,
        tokenEstimate,
      });
      console.log(`${LOG} Stored summary (${messageBuffer.length} messages → ${tokenEstimate} tokens)`);

      // Clear buffer after summarizing
      messageBuffer = [];
      return summary;
    }

    return null;
  } catch (err) {
    console.error(`${LOG} Summarization error:`, err.message);
    return null;
  }
}

async function getDefaultModel() {
  try {
    const res = await fetch(`${ollamaUrl}/api/tags`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.models || data.models.length === 0) return null;

    // Skip embedding-only models
    const embeddingPatterns = ['embed', 'nomic-embed', 'mxbai-embed', 'bge-'];
    const chatModels = data.models.filter(m => {
      const name = m.name.toLowerCase();
      return !embeddingPatterns.some(p => name.includes(p));
    });

    return chatModels.length > 0 ? chatModels[0].name : null;
  } catch {
    return null;
  }
}

function reset() {
  messageBuffer = [];
}

module.exports = {
  configure,
  addMessage,
  getBufferSize,
  shouldSummarize,
  summarizeAndStore,
  reset,
};
