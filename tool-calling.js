// Tool Calling — defines built-in tools and handles tool execution
// Uses the OpenAI function calling format.
// When a model supports tools, it can decide to call them instead of responding directly.
// NOTE: Built-in web search removed — MCP-based Brave Search replaces it.

const Store = require('electron-store');
const store = new Store();

// ── Tool Definitions (OpenAI function calling format) ───────────

const TOOLS = [];

// ── Tool Execution ──────────────────────────────────────────────

/**
 * Execute a tool call and return the result
 * @param {string} toolName - name of the tool to execute
 * @param {object} args - arguments passed by the model
 * @param {object} context - { kbStorage, store }
 * @returns {Promise<string>} - tool result as a string
 */
async function executeTool(toolName, args, context) {
  return `Unknown tool: ${toolName}`;
}

// ── Helpers ─────────────────────────────────────────────────────

/**
 * Get the tools array to include in chat requests
 * Built-in tools removed — MCP integrations handle tool injection separately.
 * @returns {Array} tools to pass to the model
 */
function getActiveTools() {
  return [];
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
