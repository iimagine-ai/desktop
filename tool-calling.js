// Tool Calling — defines built-in tools and handles tool execution
// Uses the OpenAI function calling format.
// When a model supports tools, it can decide to call them instead of responding directly.

const Store = require('electron-store');
const store = new Store();

// ── Tool Definitions (OpenAI function calling format) ───────────

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web for current information. Use when the user asks about recent events, current data, or anything that requires up-to-date information.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query to look up on the web',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rag_search',
      description: 'Search the user\'s local knowledge base documents for relevant information. Use when the user asks about their own documents, notes, or uploaded files.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query to find relevant documents in the knowledge base',
          },
        },
        required: ['query'],
      },
    },
  },
];

// ── Tool Execution ──────────────────────────────────────────────

/**
 * Execute a tool call and return the result
 * @param {string} toolName - name of the tool to execute
 * @param {object} args - arguments passed by the model
 * @param {object} context - { kbStorage, store }
 * @returns {Promise<string>} - tool result as a string
 */
async function executeTool(toolName, args, context) {
  if (toolName === 'web_search') {
    return await executeWebSearch(args.query, context);
  } else if (toolName === 'rag_search') {
    return await executeRagSearch(args.query, context);
  }
  return `Unknown tool: ${toolName}`;
}

async function executeWebSearch(query, context) {
  if (!query) return 'No search query provided.';

  const token = store.get('auth.token');
  const serverUrl = store.get('auth.serverUrl') || 'http://localhost:3000';

  // Try backend API
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${serverUrl}/api/desktop/web-search`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(10000),
    });

    if (res.ok) {
      const data = await res.json();
      const results = data.results || [];
      if (results.length === 0) return `No web results found for: "${query}"`;
      return results.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`).join('\n\n');
    }
  } catch {}

  // Fallback: DuckDuckGo
  try {
    const encoded = encodeURIComponent(query);
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encoded}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; IIMAGINE Desktop/1.0)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return `Web search failed for: "${query}"`;
    const html = await res.text();
    return parseDuckDuckGoResults(html);
  } catch (err) {
    return `Web search failed: ${err.message}`;
  }
}

function parseDuckDuckGoResults(html) {
  const results = [];
  const regex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi;
  const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/gi;
  let match;
  while ((match = regex.exec(html)) !== null && results.length < 5) {
    const url = match[1];
    const title = match[2].replace(/<[^>]*>/g, '').trim();
    results.push({ title, url, snippet: '' });
  }
  let i = 0;
  while ((match = snippetRegex.exec(html)) !== null && i < results.length) {
    results[i].snippet = match[1].replace(/<[^>]*>/g, '').trim();
    i++;
  }
  if (results.length === 0) return 'No results found.';
  return results.map((r, idx) => `[${idx + 1}] ${r.title}\n${r.url}\n${r.snippet}`).join('\n\n');
}

async function executeRagSearch(query, context) {
  if (!query) return 'No search query provided.';
  const { kbStorage } = context;
  const localAI = require('./local-ai-adapter');

  if (!kbStorage || !kbStorage.isVecLoaded()) {
    return 'Knowledge base vector search is not available.';
  }

  // Generate embedding for the query via local-ai-adapter
  try {
    const embedResult = await localAI.embed(query);
    if (!embedResult.success || !embedResult.embedding) {
      return 'Failed to generate embedding for search query.';
    }

    const queryVec = new Float32Array(embedResult.embedding);
    const results = kbStorage.searchSimilar(queryVec, null, 5);

    if (!results.length) return `No relevant documents found for: "${query}"`;

    return results.map((r, i) => {
      const source = r.doc_title ? `[Source: ${r.doc_title}]` : '';
      return `[${i + 1}] ${source}\n${r.content}`;
    }).join('\n\n---\n\n');
  } catch (err) {
    return `Knowledge base search failed: ${err.message}`;
  }
}

// ── Helpers ─────────────────────────────────────────────────────

/**
 * Get the tools array to include in chat requests
 * Only returns tools if web search is enabled or KB has documents
 * @param {object} context - { webSearchEnabled, hasKBDocuments }
 * @returns {Array} tools to pass to the model
 */
function getActiveTools(context) {
  const tools = [];
  if (context.webSearchEnabled) {
    tools.push(TOOLS[0]); // web_search
  }
  if (context.hasKBDocuments) {
    tools.push(TOOLS[1]); // rag_search
  }
  return tools;
}

/**
 * Build the engine options object from advanced settings
 * @returns {object} options for engine chat
 */
function buildEngineOptions() {
  const options = {};
  const numCtx = store.get('local.contextWindow', 'auto');

  if (numCtx !== 'auto') options.num_ctx = parseInt(numCtx, 10);

  return options;
}

/**
 * Get the keep_alive value from settings
 * @returns {string} keep_alive value
 */
function getKeepAlive() {
  return store.get('engine.keepAlive', '2m');
}

module.exports = {
  TOOLS,
  getActiveTools,
  executeTool,
  buildEngineOptions,
  getKeepAlive,
};
