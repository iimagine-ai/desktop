// Brave Search Plugin — Web search integration via MCP
// Manages the @modelcontextprotocol/server-brave-search MCP server
// Requires a Brave Search API key (free tier: 1,000 queries/month)

const MCP_SERVER_ID = 'brave-search';
const MCP_SERVER_CONFIG = {
  name: 'Web Search (Brave)',
  description: 'Search the web for current information via Brave Search API',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-brave-search'],
  env: {},
  transport: 'stdio',
};

let _context = null;
let _registered = false;

module.exports = {
  activate(context) {
    _context = context;
    console.log('[BraveSearch] Plugin activated');

    // Defer registration — MCP client may not be initialized yet at plugin load time
    setTimeout(() => this._ensureServerRegistered(), 500);
  },

  deactivate() {
    console.log('[BraveSearch] Plugin deactivated');
    _context = null;
  },

  _ensureServerRegistered() {
    if (_registered || !_context?.mcp) return;
    try {
      // MCP config may not be loaded yet — check safely
      const config = _context.mcp._config;
      if (!config) {
        // Retry after MCP init completes
        setTimeout(() => this._ensureServerRegistered(), 1000);
        return;
      }
      const servers = _context.mcp.getServers();
      if (servers && servers[MCP_SERVER_ID]) {
        // Server already exists — ensure it has the correct command/args
        const existing = config.servers[MCP_SERVER_ID];
        if (existing && !existing.args?.includes('@modelcontextprotocol/server-brave-search')) {
          // Fix stale config from old versions
          _context.mcp.updateServer(MCP_SERVER_ID, {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-brave-search'],
          });
          console.log('[BraveSearch] Updated MCP server config to correct package');
        }
        _registered = true;
        return;
      }
      // Register the server (won't auto-connect — user must save key)
      const apiKey = _context.store?.get('brave-search.apiKey') || '';
      _context.mcp.addServer(MCP_SERVER_ID, {
        ...MCP_SERVER_CONFIG,
        env: { BRAVE_API_KEY: apiKey },
      });
      _registered = true;
      console.log('[BraveSearch] MCP server registered');
    } catch (err) {
      console.warn('[BraveSearch] Failed to register MCP server:', err.message);
      // Retry once after delay
      if (!_registered) {
        setTimeout(() => {
          try {
            const apiKey = _context?.store?.get('brave-search.apiKey') || '';
            _context?.mcp?.addServer?.(MCP_SERVER_ID, { ...MCP_SERVER_CONFIG, env: { BRAVE_API_KEY: apiKey } });
            _registered = true;
            console.log('[BraveSearch] MCP server registered (retry)');
          } catch {}
        }, 2000);
      }
    }
  },

  // Plugin sidebar page — shows status and usage info
  renderPage() {
    return `
      <div class="flex flex-col flex-1 min-h-0">
        <div class="p-6 space-y-6">
          <div>
            <h2 class="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100 mb-1">Web Search</h2>
            <p class="text-sm text-neutral-500 dark:text-neutral-400">Search the web for current information using Brave Search</p>
          </div>

          <!-- Status Card -->
          <section class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-5 shadow-[0_2px_10px_rgb(0,0,0,0.02)] dark:shadow-[0_2px_10px_rgb(0,0,0,0.2)] backdrop-blur-md">
            <div class="flex items-center gap-3 mb-4">
              <div class="p-2 bg-white dark:bg-neutral-800 rounded-xl border border-neutral-100 dark:border-neutral-800 shadow-sm text-orange-600">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
              </div>
              <div>
                <h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Connection Status</h3>
                <p id="braveSearchStatus" class="text-xs text-neutral-500 dark:text-neutral-400">Checking...</p>
              </div>
            </div>
            <div class="flex gap-2">
              <button id="braveConnectBtn" class="px-4 py-2 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm">Connect</button>
              <button id="braveDisconnectBtn" class="hidden px-4 py-2 rounded-lg border border-neutral-200/50 dark:border-neutral-600/50 bg-white/60 dark:bg-neutral-700/60 text-sm font-medium text-neutral-600 dark:text-neutral-300 hover:bg-white/90 dark:hover:bg-neutral-700/90 transition-all">Disconnect</button>
            </div>
          </section>

          <!-- How to Use -->
          <section class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-5 shadow-[0_2px_10px_rgb(0,0,0,0.02)] dark:shadow-[0_2px_10px_rgb(0,0,0,0.2)] backdrop-blur-md">
            <h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-3">How to Use</h3>
            <div class="space-y-2 text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed">
              <p>Once connected, your AI assistant can search the web automatically when you ask questions that need current information.</p>
              <p class="font-medium text-neutral-700 dark:text-neutral-300">Try asking:</p>
              <ul class="list-disc list-inside space-y-1 ml-1">
                <li>"What's the latest news about AI?"</li>
                <li>"What's the weather in Melbourne today?"</li>
                <li>"Find recent reviews of the MacBook Pro M4"</li>
                <li>"What are the current mortgage rates in Australia?"</li>
              </ul>
              <p class="pt-2 text-neutral-400 dark:text-neutral-500">The AI decides when to search automatically based on your question. No special syntax needed.</p>
            </div>
          </section>

          <!-- Setup Info -->
          <section class="bg-blue-50/60 dark:bg-blue-900/10 border border-blue-200/40 dark:border-blue-800/30 rounded-2xl p-5">
            <h3 class="text-sm font-semibold text-blue-800 dark:text-blue-200 mb-2">Setup Required</h3>
            <div class="space-y-2 text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
              <p>This plugin requires a <strong>Brave Search API key</strong> (free tier includes 1,000 searches per month).</p>
              <ol class="list-decimal list-inside space-y-1 ml-1">
                <li>Go to Settings (sidebar) to enter your API key</li>
                <li>Get a free key from <span class="font-mono text-blue-600 dark:text-blue-400">brave.com/search/api</span></li>
                <li>Come back here and click Connect</li>
              </ol>
            </div>
          </section>
        </div>
      </div>
      <script>
        (async () => {
          const statusEl = document.getElementById('braveSearchStatus');
          const connectBtn = document.getElementById('braveConnectBtn');
          const disconnectBtn = document.getElementById('braveDisconnectBtn');

          async function updateStatus() {
            try {
              const servers = await window.api.mcp.getServers();
              const brave = servers['brave-search'];
              if (brave?.status === 'connected') {
                statusEl.textContent = 'Connected — ' + (brave.toolCount || 0) + ' tools available';
                statusEl.className = 'text-xs text-emerald-600 dark:text-emerald-400 font-medium';
                connectBtn.classList.add('hidden');
                disconnectBtn.classList.remove('hidden');
              } else if (brave?.status === 'error') {
                statusEl.textContent = 'Error: ' + (brave.error || 'Unknown');
                statusEl.className = 'text-xs text-rose-600 dark:text-rose-400';
                connectBtn.classList.remove('hidden');
                disconnectBtn.classList.add('hidden');
              } else {
                statusEl.textContent = 'Disconnected';
                statusEl.className = 'text-xs text-neutral-500 dark:text-neutral-400';
                connectBtn.classList.remove('hidden');
                disconnectBtn.classList.add('hidden');
              }
            } catch (err) {
              statusEl.textContent = 'Error checking status';
            }
          }

          connectBtn.addEventListener('click', async () => {
            connectBtn.disabled = true;
            connectBtn.textContent = 'Connecting...';
            try {
              // Ensure API key is set in env
              const apiKey = await window.api.settings.get('brave-search.apiKey');
              if (apiKey) {
                await window.api.mcp.updateServer('brave-search', { env: { BRAVE_API_KEY: apiKey } });
              }
              const result = await window.api.mcp.connect('brave-search');
              if (result?.success) {
                await updateStatus();
              } else {
                statusEl.textContent = 'Connection failed';
                statusEl.className = 'text-xs text-rose-600';
              }
            } catch (err) {
              statusEl.textContent = 'Error: ' + err.message;
              statusEl.className = 'text-xs text-rose-600';
            }
            connectBtn.disabled = false;
            connectBtn.textContent = 'Connect';
          });

          disconnectBtn.addEventListener('click', async () => {
            await window.api.mcp.disconnect('brave-search');
            await updateStatus();
          });

          await updateStatus();
        })();
      </script>
    `;
  },

  // Plugin settings page — API key configuration
  renderSettings(container) {
    return `
      <section class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-5 shadow-[0_2px_10px_rgb(0,0,0,0.02)] dark:shadow-[0_2px_10px_rgb(0,0,0,0.2)] backdrop-blur-md max-w-lg">
        <div class="flex items-center gap-2 mb-4">
          <div class="p-2 bg-white dark:bg-neutral-800 rounded-xl border border-neutral-100 dark:border-neutral-800 shadow-sm text-orange-600">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          </div>
          <div>
            <h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Brave Search API Key</h3>
            <p class="text-xs text-neutral-500 dark:text-neutral-400">Required for web search to work</p>
          </div>
        </div>

        <div class="space-y-4">
          <div>
            <label class="text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1.5 block">API Key</label>
            <input id="braveApiKeyInput" type="password" placeholder="BSA..." class="w-full bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-4 py-2.5 text-sm text-neutral-700 dark:text-neutral-200 placeholder-neutral-400 focus:outline-none font-mono" />
            <p class="text-[10px] text-neutral-400 mt-1.5">Get a free key (1,000 searches/month) from <span class="font-medium text-neutral-600 dark:text-neutral-300">brave.com/search/api</span></p>
          </div>

          <button id="braveApiKeySave" class="w-full px-4 py-2.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm">
            Save API Key
          </button>
          <p id="braveApiKeyStatus" class="text-xs text-center hidden"></p>
        </div>
      </section>
      <script>
        (async () => {
          const input = document.getElementById('braveApiKeyInput');
          const saveBtn = document.getElementById('braveApiKeySave');
          const statusEl = document.getElementById('braveApiKeyStatus');

          // Load existing key (masked)
          const savedKey = await window.api.settings.get('brave-search.apiKey');
          if (savedKey) {
            input.value = savedKey.slice(0, 6) + '••••••••';
          }

          saveBtn.addEventListener('click', async () => {
            const newKey = input.value.trim();
            if (!newKey || newKey.includes('••••')) {
              statusEl.textContent = 'Enter a new API key to save';
              statusEl.className = 'text-xs text-center text-amber-600';
              statusEl.classList.remove('hidden');
              setTimeout(() => statusEl.classList.add('hidden'), 3000);
              return;
            }

            await window.api.settings.set('brave-search.apiKey', newKey);

            // Update the MCP server env and auto-connect
            try {
              await window.api.mcp.updateServer('brave-search', { env: { BRAVE_API_KEY: newKey } });
              // Disconnect first if already connected, then reconnect with new key
              await window.api.mcp.disconnect('brave-search').catch(() => {});
              await window.api.mcp.connect('brave-search');
              statusEl.textContent = 'API key saved and Web Search connected.';
              statusEl.className = 'text-xs text-center text-emerald-600';
            } catch (err) {
              statusEl.textContent = 'Key saved but connection failed: ' + err.message;
              statusEl.className = 'text-xs text-center text-amber-600';
            }

            input.value = newKey.slice(0, 6) + '••••••••';
            statusEl.classList.remove('hidden');
            setTimeout(() => statusEl.classList.add('hidden'), 5000);
          });
        })();
      </script>
    `;
  },
};
