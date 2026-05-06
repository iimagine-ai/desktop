// Cortex Lite — Advanced Memory Plugin
// Extracts entities, relationships, and facts from conversations.
// Retrieves relevant context before generating responses.
// Works with any model the user has configured.

const memoryDb = require('./db');
const embeddings = require('./embeddings');
const extractor = require('./extractor');
const retriever = require('./retriever');
const summarizer = require('./summarizer');

const LOG = '[CortexLite]';

let context = null;
let store = null;
let enabled = true;
let extractionEnabled = true;
let lastUserMessage = ''; // Captured during preprocess for use in postprocess

// ── Plugin Lifecycle ────────────────────────────────────────────

module.exports = {
  activate(ctx) {
    context = ctx;
    store = ctx.store;
    console.log(`${LOG} Activating...`);

    // Load config
    const tokenBudget = store.get('cortex-lite.tokenBudget', 1500);
    const embeddingModel = store.get('cortex-lite.embeddingModel', 'nomic-embed-text');
    extractionEnabled = store.get('cortex-lite.extractionEnabled', true);
    const summarizeAfter = store.get('cortex-lite.summarizeAfterMessages', 10);

    // Initialize database
    const isVecAvailable = ctx.kbStorage ? ctx.kbStorage.isVecLoaded() : false;
    memoryDb.init(ctx.db, isVecAvailable);

    // Check if clear was requested from settings
    if (store.get('cortex-lite.clearRequested')) {
      memoryDb.clearAll();
      store.delete('cortex-lite.clearRequested');
      console.log(`${LOG} Memory cleared (requested from settings)`);
    }

    // Configure modules
    const ollamaUrl = ctx.getOllamaUrl ? ctx.getOllamaUrl() : 'http://localhost:11434';
    embeddings.configure(ollamaUrl, embeddingModel);
    extractor.configure(ollamaUrl, null); // null = auto-detect model
    summarizer.configure(ollamaUrl, null, summarizeAfter);
    retriever.configure({
      tokenBudget,
      maxFacts: store.get('cortex-lite.maxFactsInContext', 5),
      maxEntities: store.get('cortex-lite.maxEntitiesInContext', 8),
    });

    // Check embedding model availability (non-blocking)
    embeddings.checkAvailability().then(avail => {
      console.log(`${LOG} Embedding model available: ${avail}`);
    });

    console.log(`${LOG} Activated (budget: ${tokenBudget} tokens, extraction: ${extractionEnabled})`);
  },

  deactivate() {
    console.log(`${LOG} Deactivated`);
    enabled = false;
  },

  // ── Chat Preprocess (RETRIEVAL) ─────────────────────────────

  async onChatPreprocess({ messages, assistant }) {
    if (!enabled) return { messages, assistant };

    // Get the latest user message
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    if (!lastUserMsg) return { messages, assistant };

    // Capture for postprocess extraction
    lastUserMessage = lastUserMsg.content || '';

    try {
      const memoryContext = await retriever.buildContext(lastUserMsg.content);
      if (!memoryContext) return { messages, assistant };

      // Inject memory context as a system message at the start
      const systemMsg = {
        role: 'system',
        content: memoryContext,
      };

      // Insert after any existing system messages but before user messages
      const systemEnd = messages.findIndex(m => m.role !== 'system');
      const insertAt = systemEnd === -1 ? 0 : systemEnd;
      messages.splice(insertAt, 0, systemMsg);

      return { messages, assistant };
    } catch (err) {
      console.error(`${LOG} Preprocess error:`, err.message);
      return { messages, assistant };
    }
  },

  // ── Chat Postprocess (EXTRACTION) ───────────────────────────

  async onChatPostprocess({ response, assistant }) {
    if (!enabled || !extractionEnabled) return { response, assistant };

    // Use the user message captured during preprocess
    const userMsg = lastUserMessage;
    lastUserMessage = ''; // Reset

    // Fire-and-forget: don't block the response
    setTimeout(async () => {
      try {
        // Track messages for summarization
        if (userMsg) summarizer.addMessage('user', userMsg);
        if (response) summarizer.addMessage('assistant', response);

        // Extract entities/facts from the exchange
        const extracted = await extractor.extract(userMsg, response);
        if (extracted) {
          await extractor.processExtraction(extracted);
        }

        // Summarize if buffer is full
        if (summarizer.shouldSummarize()) {
          await summarizer.summarizeAndStore();
        }
      } catch (err) {
        console.error(`${LOG} Postprocess extraction error:`, err.message);
      }
    }, 0);

    return { response, assistant };
  },

  // ── Sidebar Page ────────────────────────────────────────────

  renderPage(container) {
    const stats = memoryDb.getStats();
    const entities = memoryDb.getEntities(30);
    const facts = memoryDb.getRecentFacts(10);

    const entityRows = entities.map(e => {
      let props = '';
      try {
        const p = JSON.parse(e.properties || '{}');
        const keys = Object.keys(p).slice(0, 2);
        if (keys.length) props = keys.map(k => `${k}: ${p[k]}`).join(', ');
      } catch {}
      return `
        <tr class="border-b border-gray-700">
          <td class="py-2 px-3 text-sm">${e.name}</td>
          <td class="py-2 px-3 text-xs text-gray-400">${e.type}</td>
          <td class="py-2 px-3 text-xs text-gray-500">${props}</td>
          <td class="py-2 px-3 text-xs text-gray-500">${e.mention_count}×</td>
        </tr>`;
    }).join('');

    const factRows = facts.map(f => `
      <div class="text-sm text-gray-300 py-1 border-b border-gray-800">
        ${f.content}
        <span class="text-xs text-gray-600 ml-2">${f.created_at?.split('T')[0] || ''}</span>
      </div>
    `).join('');

    return `
      <div class="p-6 space-y-6">
        <div class="flex items-center justify-between">
          <h2 class="text-xl font-semibold text-white">🧠 Memory</h2>
          <div class="flex gap-4 text-xs text-gray-400">
            <span>${stats.entities} entities</span>
            <span>${stats.relationships} relationships</span>
            <span>${stats.facts} facts</span>
            <span>${stats.embeddings} embeddings</span>
          </div>
        </div>

        <div>
          <h3 class="text-sm font-medium text-gray-300 mb-2">Entities</h3>
          <div class="overflow-auto max-h-64 rounded border border-gray-700">
            <table class="w-full text-left">
              <thead class="bg-gray-800 text-xs text-gray-400">
                <tr>
                  <th class="py-2 px-3">Name</th>
                  <th class="py-2 px-3">Type</th>
                  <th class="py-2 px-3">Properties</th>
                  <th class="py-2 px-3">Mentions</th>
                </tr>
              </thead>
              <tbody>${entityRows || '<tr><td colspan="4" class="py-4 px-3 text-center text-gray-500 text-sm">No entities yet. Start chatting to build memory.</td></tr>'}</tbody>
            </table>
          </div>
        </div>

        <div>
          <h3 class="text-sm font-medium text-gray-300 mb-2">Recent Facts</h3>
          <div class="overflow-auto max-h-48 rounded border border-gray-700 p-3">
            ${factRows || '<p class="text-sm text-gray-500">No facts stored yet.</p>'}
          </div>
        </div>
      </div>
    `;
  },

  // ── Settings Panel ──────────────────────────────────────────

  renderSettings(container) {
    const stats = memoryDb.getStats();
    const tokenBudget = store.get('cortex-lite.tokenBudget', 1500);
    const embModel = store.get('cortex-lite.embeddingModel', 'nomic-embed-text');
    const extractOn = store.get('cortex-lite.extractionEnabled', true);
    const summarizeAfter = store.get('cortex-lite.summarizeAfterMessages', 10);

    return `
      <div class="space-y-4">
        <p class="text-sm text-gray-400">
          Cortex Lite remembers entities, facts, and preferences from your conversations.
          All data is stored locally in SQLite.
        </p>

        <div class="grid grid-cols-2 gap-3 text-sm">
          <div class="bg-gray-800 rounded p-3">
            <div class="text-2xl font-bold text-white">${stats.entities}</div>
            <div class="text-xs text-gray-400">Entities</div>
          </div>
          <div class="bg-gray-800 rounded p-3">
            <div class="text-2xl font-bold text-white">${stats.facts}</div>
            <div class="text-xs text-gray-400">Facts</div>
          </div>
          <div class="bg-gray-800 rounded p-3">
            <div class="text-2xl font-bold text-white">${stats.relationships}</div>
            <div class="text-xs text-gray-400">Relationships</div>
          </div>
          <div class="bg-gray-800 rounded p-3">
            <div class="text-2xl font-bold text-white">${stats.embeddings}</div>
            <div class="text-xs text-gray-400">Embeddings</div>
          </div>
        </div>

        <div class="space-y-3 pt-2">
          <div>
            <label class="text-xs text-gray-400 block mb-1">Token Budget (context window allocation)</label>
            <input type="range" min="500" max="3000" step="100" value="${tokenBudget}"
              class="w-full" id="cortex-lite-budget" />
            <span class="text-xs text-gray-500">${tokenBudget} tokens</span>
          </div>

          <div>
            <label class="text-xs text-gray-400 block mb-1">Embedding Model</label>
            <input type="text" value="${embModel}" placeholder="nomic-embed-text"
              class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-white"
              id="cortex-lite-embed-model" />
          </div>

          <div>
            <label class="text-xs text-gray-400 block mb-1">Summarize after N messages</label>
            <input type="number" value="${summarizeAfter}" min="5" max="50"
              class="w-20 bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-white"
              id="cortex-lite-summarize-after" />
          </div>

          <div class="flex items-center gap-2">
            <input type="checkbox" id="cortex-lite-extraction" ${extractOn ? 'checked' : ''} />
            <label for="cortex-lite-extraction" class="text-sm text-gray-300">Enable extraction (learn from conversations)</label>
          </div>
        </div>

        <div class="pt-3 border-t border-gray-700">
          <button onclick="if(confirm('Clear all memory? This cannot be undone.')) { window.electronAPI?.send('cortex-lite:clear-memory') }"
            class="px-4 py-2 bg-red-900 hover:bg-red-800 text-red-200 text-sm rounded">
            Clear All Memory
          </button>
        </div>

        <p class="text-xs text-gray-600">
          Vector search: ${stats.vecLoaded ? '✓ enabled' : '✗ disabled (install embedding model)'}
        </p>
      </div>
    `;
  },

  // ── Slash Commands ──────────────────────────────────────────

  getCommands() {
    return [
      {
        name: '/memory',
        description: 'Show memory stats',
        execute: () => {
          const stats = memoryDb.getStats();
          return `🧠 Memory: ${stats.entities} entities, ${stats.facts} facts, ${stats.relationships} relationships, ${stats.embeddings} embeddings`;
        },
      },
      {
        name: '/forget',
        description: 'Clear all memory',
        execute: () => {
          memoryDb.clearAll();
          summarizer.reset();
          return '🧠 Memory cleared.';
        },
      },
    ];
  },
};
