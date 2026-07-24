// Cortex — Advanced Temporal Memory Plugin
// Manages a Python sidecar (FastAPI + Graphiti + FalkorDB Lite) for
// structured extraction, hybrid retrieval, and temporal reasoning.

const SidecarClient = require('./sidecar-client');
const Lifecycle = require('./lifecycle');
const RetryQueue = require('./retry-queue');
const Telemetry = require('./telemetry');

const LOG = '[Cortex]';

let context = null;
let store = null;
let enabled = true;
let lifecycle = null;
let client = null;
let retryQueue = null;
let telemetry = null;
let lastUserMessage = '';
let activeGroupId = 'business'; // Current memory space: 'business', 'client:{slug}', or 'off'
let sessionFactIds = [];
let lastMessageTime = Date.now();
let sessionTimeout = null;

const SESSION_IDLE_MS = 5 * 60 * 1000; // 5 minutes

// ── Plugin Lifecycle ────────────────────────────────────────────

module.exports = {
  getActiveGroupId() { return activeGroupId; },
  getSidecarClient() { return client; },
  getActiveLLMConfig() {
    const pm = store ? store.get('provider.active', {}) : {};
    const providerType = pm.type || 'local';
    const model = pm.model || 'gpt-5.4-mini';

    // For local models, use the local engine endpoint
    if (providerType === 'local') {
      return {
        provider: 'local',
        model: model,
        api_key: 'local',
        base_url: 'http://127.0.0.1:8847/v1',
        engine_port: 8847,
      };
    }

    // For API providers, look up the API key from the vendor-specific store
    const keyMap = {
      openai: 'openai.apiKey',
      anthropic: 'anthropic.apiKey',
      google: 'gemini.apiKey',
      openrouter: 'openrouter.apiKey',
    };
    const apiKey = store ? store.get(keyMap[providerType] || 'openai.apiKey', '') : '';

    const baseUrlMap = {
      openrouter: 'https://openrouter.ai/api/v1',
    };

    return {
      provider: providerType,
      model: model,
      api_key: apiKey,
      base_url: baseUrlMap[providerType] || null,
      engine_port: 8847,
    };
  },

  activate(ctx) {
    context = ctx;
    store = ctx.store;
    enabled = true;

    console.log(`${LOG} Activating...`);

    // Register IPC event handlers for memory space management
    const { ipcMain } = require('electron');
    
    // Safe handler registration — remove existing before re-registering
    const safeHandle = (channel, handler) => {
      try { ipcMain.removeHandler(channel); } catch {}
      ipcMain.handle(channel, handler);
    };

    safeHandle('cortex:setMemorySpace', (event, groupId) => {
      activeGroupId = groupId || 'business';
      console.log(`${LOG} Memory space set to: ${activeGroupId}`);
      return { success: true, groupId: activeGroupId };
    });
    safeHandle('cortex:getMemorySpace', () => {
      return { groupId: activeGroupId };
    });
    safeHandle('cortex:getMemorySpaces', () => {
      // Return available memory spaces from store
      const spaces = store.get('cortex.memorySpaces', [
        { id: 'business', label: 'Project One', type: 'business' },
      ]);
      return { spaces, active: activeGroupId };
    });
    safeHandle('cortex:createMemorySpace', (event, { label }) => {
      const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const id = `client:${slug}`;
      const spaces = store.get('cortex.memorySpaces', [
        { id: 'business', label: 'Project One', type: 'business' },
      ]);
      // Don't create duplicates
      if (spaces.find(s => s.id === id)) {
        return { success: false, error: 'Space already exists', spaces };
      }
      spaces.push({ id, label, type: 'space' });
      store.set('cortex.memorySpaces', spaces);
      return { success: true, spaces, newId: id };
    });
    safeHandle('cortex:deleteMemorySpace', (event, { id }) => {
      if (id === 'business') return { success: false, error: 'Cannot delete business space' };
      let spaces = store.get('cortex.memorySpaces', []);
      spaces = spaces.filter(s => s.id !== id);
      store.set('cortex.memorySpaces', spaces);
      if (activeGroupId === id) activeGroupId = 'business';
      return { success: true, spaces };
    });
    safeHandle('cortex:renameMemorySpace', (event, { id, label }) => {
      if (!label || !label.trim()) return { success: false, error: 'Name cannot be empty' };
      let spaces = store.get('cortex.memorySpaces', []);
      const space = spaces.find(s => s.id === id);
      if (!space) return { success: false, error: 'Space not found' };
      space.label = label.trim();
      store.set('cortex.memorySpaces', spaces);
      return { success: true, spaces, label: space.label };
    });

    // ── Facts IPC handlers ─────────────────────────────────────────
    safeHandle('cortex:getFacts', async () => {
      try {
        const result = await client.request('GET', '/facts');
        return result || { always_on: [], pinned: [] };
      } catch { return { always_on: [], pinned: [] }; }
    });
    safeHandle('cortex:getFactsBudget', async () => {
      try {
        return await client.request('GET', '/facts/budget');
      } catch { return { tokens_used: 0, tokens_cap: 225, percent: 0, over_budget: false }; }
    });
    safeHandle('cortex:createFact', async (event, data) => {
      try {
        return await client.request('POST', '/facts', data);
      } catch (e) { return { error: e.message }; }
    });
    safeHandle('cortex:updateFact', async (event, { id, ...data }) => {
      try {
        return await client.request('PATCH', `/facts/${id}`, data);
      } catch (e) { return { error: e.message }; }
    });
    safeHandle('cortex:deleteFact', async (event, { id }) => {
      try {
        return await client.request('DELETE', `/facts/${id}`);
      } catch (e) { return { error: e.message }; }
    });
    safeHandle('cortex:confirmFact', async (event, { id }) => {
      try {
        return await client.request('POST', `/facts/${id}/confirm`);
      } catch (e) { return { error: e.message }; }
    });
    safeHandle('cortex:getStaleFacts', async () => {
      try {
        return await client.request('GET', '/facts/stale');
      } catch { return { stale: [], newly_flagged: 0 }; }
    });
    safeHandle('cortex:resolveStaleFact', async (event, { id }) => {
      try {
        return await client.request('POST', `/facts/${id}/resolve-stale`);
      } catch (e) { return { error: e.message }; }
    });
    safeHandle('cortex:getContradictions', async () => {
      try {
        return await client.request('GET', '/facts/contradictions');
      } catch { return { contradictions: [] }; }
    });
    safeHandle('cortex:acknowledgeFact', async (event, { id }) => {
      try {
        return await client.request('POST', `/facts/${id}/acknowledge`);
      } catch (e) { return { error: e.message }; }
    });
    // Analytics / Telemetry
    safeHandle('cortex:getMetrics', async () => {
      try {
        return await client.request('GET', '/metrics');
      } catch { return { exchanges: 0 }; }
    });
    safeHandle('cortex:getMetricsHistory', async () => {
      try {
        return await client.request('GET', '/metrics/history');
      } catch { return { history: [] }; }
    });
    safeHandle('cortex:getMetricsFailures', async () => {
      try {
        return await client.request('GET', '/metrics/failures');
      } catch { return { failures: [] }; }
    });
    safeHandle('cortex:logResponse', async (event, data) => {
      try {
        return await client.request('POST', '/log/response', data);
      } catch { return { success: false }; }
    });
    safeHandle('cortex:memoryMiss', async (event, data) => {
      try {
        return await client.request('POST', '/memory-miss', data);
      } catch { return { success: false }; }
    });

    safeHandle('cortex:set-setting', (event, { key, value }) => {
      store.set(key, value);
      console.log(`${LOG} Setting updated: ${key} = ${value}`);
      // Sync auto-approve to sidecar settings file
      if (key === 'cortex.autoApprove') {
        try {
          const fs = require('fs');
          const path = require('path');
          const settingsPath = path.join(require('os').homedir(), '.iimagine', 'memory', 'settings.json');
          let settings = {};
          if (fs.existsSync(settingsPath)) {
            try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')); } catch {}
          }
          settings.autoApprove = value;
          fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
        } catch (err) {
          console.warn(`${LOG} Failed to sync setting to sidecar: ${err.message}`);
        }
      }
      return { success: true };
    });

    // Initialize sidecar lifecycle manager
    lifecycle = new Lifecycle({
      pluginDir: __dirname,
      store,
      onReady: (port) => {
        client = new SidecarClient(port);
        console.log(`${LOG} Sidecar ready on port ${port}`);
        // Process retry queue when sidecar comes online
        retryQueue.processQueue(client, getLLMConfig());
      },
      onCrash: (code) => {
        console.error(`${LOG} Sidecar crashed with code ${code}`);
        client = null;
      },
    });

    // Initialize retry queue
    retryQueue = new RetryQueue(store);

    // Initialize telemetry
    telemetry = new Telemetry();

    // Start the sidecar
    lifecycle.start();

    // Ensure the embedding model is loaded in the engine.
    // This is transparent to the user — if they're using a cloud model for chat,
    // we still need the local engine running for embeddings (nomic-embed-text).
    ensureEmbeddingEngine();

    console.log(`${LOG} Activated`);
  },

  deactivate() {
    console.log(`${LOG} Deactivating...`);
    enabled = false;

    if (sessionTimeout) clearTimeout(sessionTimeout);

    // Flush telemetry before shutdown
    if (telemetry) {
      telemetry.flush();
      telemetry = null;
    }

    if (lifecycle) {
      lifecycle.stop();
      lifecycle = null;
    }

    client = null;
    console.log(`${LOG} Deactivated`);
  },

  // ── Chat Preprocess (RETRIEVAL) ─────────────────────────────

  async onChatPreprocess({ messages, assistant }) {
    if (!enabled) return { messages, assistant };

    try {
      if (!client || !lifecycle?.isReady()) {
        return { messages, assistant };
      }

      // Get the latest user message
      const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
      if (!lastUserMsg) return { messages, assistant };

      // Capture for postprocess extraction
      lastUserMessage = lastUserMsg.content || '';

      // Generate exchange_id for telemetry correlation
      const crypto = require('crypto');
      this._lastExchangeId = crypto.randomUUID();

      // Retrieve memory context
      const tokenBudget = store.get('cortex.tokenBudget', 1500);
      const citeSources = store.get('cortex.citeSources', false);
      const scopedEnabled = store.get('cortex.scopedEnabled', true);
      const analyticsEnabled = store.get('cortex.analyticsEnabled', false);
      const retrieveStart = Date.now();
      const groupId = activeGroupId || 'business';
      const result = await client.retrieve(
        lastUserMsg.content, tokenBudget, groupId, citeSources, scopedEnabled,
        analyticsEnabled ? this._lastExchangeId : null,
        null
      );
      const retrieveMs = Date.now() - retrieveStart;

      if (telemetry) telemetry.recordRetrieval(retrieveMs);

      if (!result?.context) return { messages, assistant };

      // Inject memory context as a system message
      const systemMsg = { role: 'system', content: result.context };
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
    if (!enabled) return { response, assistant };

    const userMsg = lastUserMessage;
    const exchangeId = this._lastExchangeId || null;
    lastUserMessage = '';
    this._lastExchangeId = null;

    // Reset session idle timer
    resetSessionTimer();

    // Fire-and-forget: don't block the response
    setTimeout(async () => {
      try {
        const llmConfig = getLLMConfig();
        const groupId = activeGroupId || 'business';

        // Skip extraction if memory is off for this conversation
        if (groupId === 'off') return;

        // Log response for analytics/signals (if enabled)
        const analyticsEnabled = store.get('cortex.analyticsEnabled', false);
        if (analyticsEnabled && client && lifecycle?.isReady()) {
          try {
            await client.request('POST', '/log/response', {
              exchange_id: exchangeId,
              session_id: null,
              user_message: userMsg,
              assistant_response: response,
            });
          } catch (e) {
            // Telemetry must never interfere
          }
        }

        if (!client || !lifecycle?.isReady()) {
          // Queue for later processing
          retryQueue.enqueue({ userMessage: userMsg, assistantResponse: response });
          return;
        }

        const result = await client.extract(userMsg, response, llmConfig, groupId);
        if (telemetry) telemetry.recordExtraction(true);
        if (result?.facts_stored > 0) {
          // Track session facts for reflection
        }
        // Notify user about auto-created modules
        if (result?.modules_created && result.modules_created.length > 0) {
          const names = result.modules_created.join(', ');
          const notification = `\n\n---\n🎯 *I've created a new objective: "${names}". You can add a deadline, priority, and other context in Memory → Objectives to help me give better advice around this goal.*`;
          // Append to the displayed response via IPC
          try {
            const { BrowserWindow } = require('electron');
            const win = BrowserWindow.getAllWindows()[0];
            if (win) {
              win.webContents.send('cortex:module-created', {
                modules: result.modules_created,
                message: notification,
              });
            }
          } catch (e) {
            console.log(`${LOG} Module creation notification failed: ${e.message}`);
          }
        }
      } catch (err) {
        console.error(`${LOG} Postprocess error:`, err.message);
        if (telemetry) telemetry.recordExtraction(false);
        retryQueue.enqueue({ userMessage: userMsg, assistantResponse: response });
      }
    }, 0);

    return { response, assistant };
  },

  // ── Sidebar Page (Tabbed: Objectives | My Data | Settings) ──

  renderPage(container, activeTab) {
    const isReady = lifecycle?.isReady() || false;

    if (!isReady) {
      return `
        <div class="p-6">
          <div class="flex items-center gap-3 mb-4">
            <h2 class="text-xl font-semibold text-neutral-900 dark:text-neutral-100">Memory</h2>
            <span class="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-100 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800/30">Offline</span>
          </div>
          <p class="text-sm text-neutral-500">Memory sidecar is starting or unavailable. Chat continues without memory context.</p>
        </div>
      `;
    }

    const port = lifecycle.getPort();
    const tab = activeTab || 'guide';
    return `
      <div class="flex flex-col flex-1 min-h-0">
        <div class="p-6 pb-0">
          <div class="flex items-center gap-3 mb-4">
            <h2 class="text-xl font-semibold text-neutral-900 dark:text-neutral-100">Memory</h2>
            <span class="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800/30">Online</span>
          </div>
          <div class="flex gap-1 border-b border-neutral-200/40 dark:border-neutral-700/40">
            <button data-cw-tab="guide" class="cw-tab-btn px-4 py-2 text-sm font-medium transition-all border-b-2 ${tab === 'guide' ? 'text-neutral-900 dark:text-neutral-100 border-neutral-900 dark:border-neutral-100' : 'text-neutral-500 dark:text-neutral-400 border-transparent'}">Guide</button>
            <button data-cw-tab="facts" class="cw-tab-btn px-4 py-2 text-sm font-medium transition-all border-b-2 ${tab === 'facts' ? 'text-neutral-900 dark:text-neutral-100 border-neutral-900 dark:border-neutral-100' : 'text-neutral-500 dark:text-neutral-400 border-transparent'}">Facts</button>
            <button data-cw-tab="objectives" class="cw-tab-btn px-4 py-2 text-sm font-medium transition-all border-b-2 ${tab === 'objectives' ? 'text-neutral-900 dark:text-neutral-100 border-neutral-900 dark:border-neutral-100' : 'text-neutral-500 dark:text-neutral-400 border-transparent'}">Objectives</button>
            <button data-cw-tab="kg" class="cw-tab-btn px-4 py-2 text-sm font-medium transition-all border-b-2 ${tab === 'kg' ? 'text-neutral-900 dark:text-neutral-100 border-neutral-900 dark:border-neutral-100' : 'text-neutral-500 dark:text-neutral-400 border-transparent'}">My Data</button>
            <button data-cw-tab="analytics" class="cw-tab-btn px-4 py-2 text-sm font-medium transition-all border-b-2 ${tab === 'analytics' ? 'text-neutral-900 dark:text-neutral-100 border-neutral-900 dark:border-neutral-100' : 'text-neutral-500 dark:text-neutral-400 border-transparent'}">Analytics</button>
            <button data-cw-tab="settings" class="cw-tab-btn px-4 py-2 text-sm font-medium transition-all border-b-2 ${tab === 'settings' ? 'text-neutral-900 dark:text-neutral-100 border-neutral-900 dark:border-neutral-100' : 'text-neutral-500 dark:text-neutral-400 border-transparent'}">Settings</button>
          </div>
        </div>
        <div id="cwTabContent" class="flex-1 overflow-y-auto p-6">
          ${module.exports._renderTab(tab, port)}
        </div>
      </div>
      <script>
        // Reset init guards on full page render (sidebar re-navigation)
        window.cwSwitchTab = function(t) {
          document.querySelectorAll('.cw-tab-btn').forEach(b => {
            const active = b.dataset.cwTab === t;
            b.className = 'cw-tab-btn px-4 py-2 text-sm font-medium transition-all border-b-2 ' +
              (active ? 'text-neutral-900 dark:text-neutral-100 border-neutral-900 dark:border-neutral-100' : 'text-neutral-500 dark:text-neutral-400 border-transparent');
          });
          window.api.plugins.renderPage('cortex', t).then(html => {
            // Re-render only the tab content by extracting from the full HTML
            const tmp = document.createElement('div');
            tmp.innerHTML = html;
            const content = tmp.querySelector('#cwTabContent');
            if (content) {
              document.getElementById('cwTabContent').innerHTML = content.innerHTML;
              // Execute scripts
              document.getElementById('cwTabContent').querySelectorAll('script').forEach(old => {
                const s = document.createElement('script');
                s.textContent = old.textContent;
                old.parentNode.replaceChild(s, old);
              });
            }
          });
        };
        document.querySelectorAll('.cw-tab-btn').forEach(btn => {
          btn.addEventListener('click', () => cwSwitchTab(btn.dataset.cwTab));
        });
      </script>
    `;
  },

  _renderTab(tab, port) {
    if (tab === 'guide') return module.exports._renderGuideTab(port);
    if (tab === 'facts') return module.exports._renderFactsTab(port);
    if (tab === 'objectives') return module.exports._renderObjectivesTab(port);
    if (tab === 'kg') return module.exports._renderKGTab(port);
    if (tab === 'analytics') return module.exports._renderAnalyticsTab(port);
    if (tab === 'settings') return module.exports._renderSettingsTab(port);
    return '';
  },

  _renderGuideTab(port) {
    return `
      <div class="space-y-6 max-w-2xl">
        <div>
          <h3 class="text-base font-semibold text-neutral-900 dark:text-neutral-100 mb-2">How Memory Works</h3>
          <p class="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">Memory works out of the box. Just chat — it learns from every conversation, building a picture of you, your business, and your goals over time. Everything you say is stored in memory automatically. You don't need to configure anything for it to start working.</p>
        </div>

        <div class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-5 space-y-4">
          <h4 class="text-sm font-medium text-neutral-800 dark:text-neutral-200">Facts, Objectives, and Memory — what takes priority</h4>
          <p class="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">The AI uses a priority system when giving advice. Things you've declared manually always win over things it learned automatically:</p>
          <div class="space-y-3 text-sm text-neutral-600 dark:text-neutral-400">
            <div class="flex gap-3">
              <span class="font-bold text-neutral-700 dark:text-neutral-300 mt-0.5">1.</span>
              <div><strong class="text-neutral-700 dark:text-neutral-300">Facts</strong> (highest priority) — things you've told the AI are definitely true. Your age, location, company, products, target market. The AI will never override these from conversation. If something you say in chat contradicts a Fact, the AI will flag it and ask you to update — but will keep using the Fact until you do.</div>
            </div>
            <div class="flex gap-3">
              <span class="font-bold text-neutral-700 dark:text-neutral-300 mt-0.5">2.</span>
              <div><strong class="text-neutral-700 dark:text-neutral-300">Objectives</strong> — your goals with structure: what you're working toward, deadlines, priorities. The AI can update progress automatically, but the goal itself and its deadline only change when you approve.</div>
            </div>
            <div class="flex gap-3">
              <span class="font-bold text-neutral-700 dark:text-neutral-300 mt-0.5">3.</span>
              <div><strong class="text-neutral-700 dark:text-neutral-300">Memory</strong> (lowest priority) — everything the AI picks up from conversation. Flexible, automatically managed, and subject to the AI's interpretation. Visible in the My Data tab.</div>
            </div>
          </div>
          <p class="text-sm text-neutral-500 dark:text-neutral-500 leading-relaxed">You don't need to use all three. Just chatting is already better than no memory. But the more you tell the AI directly (via Facts and Objectives), the better the advice gets — because it's working from ground truth you control, not just what it inferred from conversation.</p>
        </div>

        <div class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-5 space-y-4">
          <h4 class="text-sm font-medium text-neutral-800 dark:text-neutral-200">Facts — two types</h4>
          <p class="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">Facts live in the <strong>Facts tab</strong>. There are two types:</p>
          <div class="space-y-3 text-sm text-neutral-600 dark:text-neutral-400">
            <div class="flex gap-3">
              <span class="text-violet-500 mt-0.5">●</span>
              <div><strong class="text-neutral-700 dark:text-neutral-300">Always included</strong> — sent to the AI with every single message. Keep these to core identity (who you are, what you do, key constraints). Use stable phrasings: "born 1992" not "age 34."</div>
            </div>
            <div class="flex gap-3">
              <span class="text-violet-500 mt-0.5">●</span>
              <div><strong class="text-neutral-700 dark:text-neutral-300">Include when relevant</strong> — only surfaced when the AI thinks they're related to what you're asking. Add as many as you want ("allergic to peanuts", "uses Stripe for payments", "co-founder James handles sales"). These don't cost anything when they're not relevant.</div>
            </div>
          </div>
          <p class="text-sm text-neutral-500 dark:text-neutral-500 leading-relaxed">If a Fact gets out of date, the AI will notice and ask you about it. Facts you haven't touched in 6+ months will get a gentle "still true?" prompt. You stay in control — the AI never silently changes your Facts.</p>
        </div>

        <div class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-5 space-y-4">
          <h4 class="text-sm font-medium text-neutral-800 dark:text-neutral-200">How updates from conversation work</h4>
          <p class="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">Everything you mention in chat is always stored in memory immediately — including deadlines, priorities, and status updates. The AI can retrieve any of it.</p>
          <p class="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">But updating your <strong>Objectives modules</strong> is different — because these override everything else, changes to them require your approval:</p>
          <div class="space-y-2 text-sm text-neutral-600 dark:text-neutral-400">
            <div class="flex gap-3">
              <span class="text-emerald-500">●</span>
              <div><strong>Status, challenges, enablers</strong> — auto-update on your modules (factual, low-risk)</div>
            </div>
            <div class="flex gap-3">
              <span class="text-amber-500">●</span>
              <div><strong>Deadlines and priorities</strong> — always stored in memory, but the module only updates when you approve (these are decisions, not facts)</div>
            </div>
          </div>
          <p class="text-sm text-neutral-500 dark:text-neutral-500 leading-relaxed">Review proposed module changes in the My Data tab. Or enable "Auto-approve all updates to my Profile and Objectives" in Settings if you prefer fully hands-off.</p>
        </div>

        <div class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-5 space-y-4">
          <h4 class="text-sm font-medium text-neutral-800 dark:text-neutral-200">Process into Memory</h4>
          <p class="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">If you have documents (notes, plans, reports) that contain facts about your business, you can feed them directly into memory without chatting about them one by one.</p>
          <div class="space-y-3 text-sm text-neutral-600 dark:text-neutral-400">
            <div class="flex gap-3">
              <span class="text-neutral-400 mt-0.5">1.</span>
              <div>Go to <strong class="text-neutral-700 dark:text-neutral-300">Knowledge → Folder Connect</strong> and add a folder containing your files</div>
            </div>
            <div class="flex gap-3">
              <span class="text-neutral-400 mt-0.5">2.</span>
              <div>Click <strong class="text-neutral-700 dark:text-neutral-300">"Process into memory"</strong> on the folder</div>
            </div>
            <div class="flex gap-3">
              <span class="text-neutral-400 mt-0.5">3.</span>
              <div>Cortex reads each file, extracts facts/entities/relationships, and stores them in memory — just like it would from a conversation</div>
            </div>
          </div>
          <p class="text-sm text-neutral-500 dark:text-neutral-500 leading-relaxed"><strong>When to use this:</strong> You have an existing business plan, client brief, meeting notes, or any document with facts the AI should know. Instead of re-explaining everything in chat, point it at the file. Supports PDF, Word (.docx), Markdown (.md), plain text, and CSV files.</p>
        </div>

        <div class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-5 space-y-3">
          <h4 class="text-sm font-medium text-neutral-800 dark:text-neutral-200">What if I don't set up anything?</h4>
          <p class="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">It still works. Memory captures facts from conversation and retrieves them when relevant. Profile and Objectives are the upgrade path — they make advice more structured, quantitative, and goal-aware. But just chatting is already better than a model with no memory at all.</p>
        </div>

        <div class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-5 space-y-4">
          <h4 class="text-sm font-medium text-neutral-800 dark:text-neutral-200">Memory Spaces</h4>
          <p class="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">The purple badge in your chat input shows which <strong>memory space</strong> is active. Think of spaces as separate notebooks — facts stored in one space don't bleed into another.</p>
          <div class="space-y-3 text-sm text-neutral-600 dark:text-neutral-400">
            <div class="flex gap-3">
              <span class="text-violet-500 mt-0.5">●</span>
              <div><strong class="text-neutral-700 dark:text-neutral-300">Project One</strong> (default) — your primary memory space. Always available.</div>
            </div>
            <div class="flex gap-3">
              <span class="text-violet-500 mt-0.5">●</span>
              <div><strong class="text-neutral-700 dark:text-neutral-300">Custom spaces</strong> — create a new space for a client project, side venture, or any context you want to keep separate. Click "+ New space" in the dropdown.</div>
            </div>
            <div class="flex gap-3">
              <span class="text-neutral-400 mt-0.5">●</span>
              <div><strong class="text-neutral-700 dark:text-neutral-300">Off</strong> — temporarily disables memory. Nothing is stored or recalled. Useful for one-off conversations you don't want remembered.</div>
            </div>
          </div>
          <p class="text-sm text-neutral-500 dark:text-neutral-500 leading-relaxed"><strong>When to use spaces:</strong> If you advise multiple clients or run several projects, create a space for each. When you switch to that space, the AI only sees memory from those conversations — no cross-contamination between clients. Your default space facts (like your own preferences and constraints) are always included as context regardless of which space is active.</p>
        </div>
      </div>
    `;
  },

  _renderFactsTab(port) {
    return `
      <div class="space-y-5 max-w-2xl">
        <div>
          <p class="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">Facts are always true. The AI will never override them — they take priority over anything learned from conversation.</p>
        </div>

        <!-- Always Included -->
        <div class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-4 space-y-3">
          <div class="flex items-center justify-between">
            <h4 class="text-sm font-medium text-neutral-800 dark:text-neutral-200">Always included</h4>
            <span id="facts-budget" class="text-[11px] text-neutral-400"></span>
          </div>
          <p class="text-xs text-neutral-500 dark:text-neutral-500">These are sent to the AI with every message. Keep them to core identity — who you are, what you do.</p>
          <div id="facts-always-list" class="space-y-1.5">
            <div class="text-xs text-neutral-400">Loading...</div>
          </div>
          <div id="facts-always-add" class="pt-2">
            <div class="flex gap-2">
              <input type="text" id="facts-always-key" placeholder="Label (optional)" class="w-24 text-xs px-2 py-1.5 rounded-lg border border-neutral-200/60 dark:border-neutral-700/60 bg-transparent" />
              <input type="text" id="facts-always-value" placeholder="Fact..." class="flex-1 text-xs px-2 py-1.5 rounded-lg border border-neutral-200/60 dark:border-neutral-700/60 bg-transparent" />
              <button id="facts-always-btn" class="px-3 py-1.5 text-xs font-medium rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all">Add</button>
            </div>
            <p class="text-[10px] text-neutral-400 mt-1">Tip: use stable phrasings — "born 1992" not "age 34"</p>
          </div>
        </div>

        <!-- Include When Relevant -->
        <div class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-4 space-y-3">
          <h4 class="text-sm font-medium text-neutral-800 dark:text-neutral-200">Include when relevant</h4>
          <p class="text-xs text-neutral-500 dark:text-neutral-500">Only included when the AI thinks they're relevant to what you're asking. Add as many as you want.</p>
          <div id="facts-pinned-list" class="space-y-1.5">
            <div class="text-xs text-neutral-400">Loading...</div>
          </div>
          <div id="facts-pinned-add" class="pt-2">
            <div class="flex gap-2">
              <input type="text" id="facts-pinned-key" placeholder="Label (optional)" class="w-24 text-xs px-2 py-1.5 rounded-lg border border-neutral-200/60 dark:border-neutral-700/60 bg-transparent" />
              <input type="text" id="facts-pinned-value" placeholder="Fact..." class="flex-1 text-xs px-2 py-1.5 rounded-lg border border-neutral-200/60 dark:border-neutral-700/60 bg-transparent" />
              <button id="facts-pinned-btn" class="px-3 py-1.5 text-xs font-medium rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all">Add</button>
            </div>
          </div>
        </div>
      </div>
      <script>
      (function() {
        async function loadFacts() {
          const data = await window.api.plugins.getFacts();
          const budget = await window.api.plugins.getFactsBudget();

          // Budget indicator
          const budgetEl = document.getElementById('facts-budget');
          if (budgetEl && budget) {
            budgetEl.textContent = '~' + budget.percent + '% of context budget';
            if (budget.over_budget) budgetEl.classList.add('text-red-500');
          }

          // Always-on list
          const alwaysList = document.getElementById('facts-always-list');
          if (alwaysList && data.always_on) {
            if (data.always_on.length === 0) {
              alwaysList.innerHTML = '<div class="text-xs text-neutral-400 italic">No facts yet. Add some below.</div>';
            } else {
              alwaysList.innerHTML = data.always_on.map(f => \`
                <div class="flex items-center gap-2 group">
                  <span class="flex-1 text-xs text-neutral-700 dark:text-neutral-300">\${f.key ? '<strong>' + f.key + ':</strong> ' : ''}\${f.value}</span>
                  <button data-delete="\${f.id}" data-tier="always_on" class="facts-del opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-red-500 transition-all p-0.5"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
                </div>
              \`).join('');
            }
          }

          // Pinned list
          const pinnedList = document.getElementById('facts-pinned-list');
          if (pinnedList && data.pinned) {
            if (data.pinned.length === 0) {
              pinnedList.innerHTML = '<div class="text-xs text-neutral-400 italic">No pinned facts yet.</div>';
            } else {
              pinnedList.innerHTML = data.pinned.map(f => \`
                <div class="flex items-center gap-2 group">
                  <span class="flex-1 text-xs text-neutral-700 dark:text-neutral-300">\${f.key ? '<strong>' + f.key + ':</strong> ' : ''}\${f.value}</span>
                  <button data-delete="\${f.id}" data-tier="pinned" class="facts-del opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-red-500 transition-all p-0.5"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
                </div>
              \`).join('');
            }
          }

          // Wire delete buttons
          document.querySelectorAll('.facts-del').forEach(btn => {
            btn.addEventListener('click', async () => {
              await window.api.plugins.deleteFact({ id: btn.dataset.delete });
              loadFacts();
            });
          });
        }

        // Add always-on fact
        const alwaysBtn = document.getElementById('facts-always-btn');
        if (alwaysBtn) {
          alwaysBtn.addEventListener('click', async () => {
            const key = document.getElementById('facts-always-key').value.trim();
            const value = document.getElementById('facts-always-value').value.trim();
            if (!value) return;
            await window.api.plugins.createFact({ tier: 'always_on', key, value });
            document.getElementById('facts-always-key').value = '';
            document.getElementById('facts-always-value').value = '';
            loadFacts();
          });
          // Enter key support
          document.getElementById('facts-always-value').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') alwaysBtn.click();
          });
        }

        // Add pinned fact
        const pinnedBtn = document.getElementById('facts-pinned-btn');
        if (pinnedBtn) {
          pinnedBtn.addEventListener('click', async () => {
            const key = document.getElementById('facts-pinned-key').value.trim();
            const value = document.getElementById('facts-pinned-value').value.trim();
            if (!value) return;
            await window.api.plugins.createFact({ tier: 'pinned', key, value });
            document.getElementById('facts-pinned-key').value = '';
            document.getElementById('facts-pinned-value').value = '';
            loadFacts();
          });
          document.getElementById('facts-pinned-value').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') pinnedBtn.click();
          });
        }

        loadFacts();
      })();
      </script>
    `;
  },

  _renderObjectivesTab(port) {
    return `
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <p class="text-sm text-neutral-500 dark:text-neutral-400">SCOPED objectives — Status, Challenges, Objective, Priority, Enablers, Deadline.</p>
          <button id="cw-add-module-btn" class="px-3 py-1.5 text-sm font-medium rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all">New module</button>
        </div>
        <div id="cw-module-form" class="hidden bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-4 space-y-3">
          <div class="grid grid-cols-2 gap-3">
            <div><label class="text-xs font-medium text-neutral-600 dark:text-neutral-400">Title</label><input id="cw-mod-title" class="mt-1 w-full rounded-lg border border-neutral-200/60 dark:border-neutral-700/60 bg-transparent px-3 py-2 text-sm" placeholder="e.g., Reach 500 customers" /></div>
            <div><label class="text-xs font-medium text-neutral-600 dark:text-neutral-400">Category</label><select id="cw-mod-category" class="mt-1 w-full rounded-lg border border-neutral-200/60 dark:border-neutral-700/60 bg-transparent px-3 py-2 text-sm"><option value="Work">Work</option><option value="Personal">Personal</option></select></div>
          </div>
          <div><label class="text-xs font-medium text-neutral-600 dark:text-neutral-400">Objective (measurable target)</label><input id="cw-mod-objective" class="mt-1 w-full rounded-lg border border-neutral-200/60 dark:border-neutral-700/60 bg-transparent px-3 py-2 text-sm" placeholder="e.g., 500 paying customers by Sep 30" /></div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="text-xs font-medium text-neutral-600 dark:text-neutral-400">Priority (1-10)</label><input id="cw-mod-priority" type="range" min="1" max="10" value="5" class="mt-1 w-full" /><span id="cw-mod-priority-val" class="text-xs text-neutral-500">5</span></div>
            <div><label class="text-xs font-medium text-neutral-600 dark:text-neutral-400">Deadline</label><input id="cw-mod-deadline" type="date" class="mt-1 w-full rounded-lg border border-neutral-200/60 dark:border-neutral-700/60 bg-transparent px-3 py-2 text-sm" /></div>
          </div>
          <div><label class="text-xs font-medium text-neutral-600 dark:text-neutral-400">Current Status</label><input id="cw-mod-status" class="mt-1 w-full rounded-lg border border-neutral-200/60 dark:border-neutral-700/60 bg-transparent px-3 py-2 text-sm" placeholder="Where are you now?" /></div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="text-xs font-medium text-neutral-600 dark:text-neutral-400">Challenges</label><textarea id="cw-mod-challenges" rows="2" class="mt-1 w-full rounded-lg border border-neutral-200/60 dark:border-neutral-700/60 bg-transparent px-3 py-2 text-sm" placeholder="Obstacles, constraints"></textarea></div>
            <div><label class="text-xs font-medium text-neutral-600 dark:text-neutral-400">Enablers</label><textarea id="cw-mod-enablers" rows="2" class="mt-1 w-full rounded-lg border border-neutral-200/60 dark:border-neutral-700/60 bg-transparent px-3 py-2 text-sm" placeholder="Assets, resources, strengths"></textarea></div>
          </div>
          <div class="flex gap-2">
            <button id="cw-mod-save" class="px-3 py-1.5 text-sm rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900">Save</button>
            <button id="cw-mod-cancel" class="px-3 py-1.5 text-sm rounded-lg border border-neutral-200/60 dark:border-neutral-700/60 text-neutral-600 dark:text-neutral-400">Cancel</button>
          </div>
        </div>
        <div id="cw-modules-list" class="space-y-3"><div class="text-xs text-neutral-500">Loading...</div></div>
      </div>
      <script>
      (async () => {
        const port = ${port};
        const BASE = 'http://127.0.0.1:' + port;
        let editingId = null;

        const form = document.getElementById('cw-module-form');
        const addBtn = document.getElementById('cw-add-module-btn');
        const priorityRange = document.getElementById('cw-mod-priority');
        const priorityVal = document.getElementById('cw-mod-priority-val');

        priorityRange.addEventListener('input', () => { priorityVal.textContent = priorityRange.value; });
        addBtn.addEventListener('click', () => { editingId = null; resetForm(); form.classList.remove('hidden'); });
        document.getElementById('cw-mod-cancel').addEventListener('click', () => { form.classList.add('hidden'); });

        function resetForm() {
          document.getElementById('cw-mod-title').value = '';
          document.getElementById('cw-mod-objective').value = '';
          document.getElementById('cw-mod-priority').value = '5'; priorityVal.textContent = '5';
          document.getElementById('cw-mod-deadline').value = '';
          document.getElementById('cw-mod-status').value = '';
          document.getElementById('cw-mod-challenges').value = '';
          document.getElementById('cw-mod-enablers').value = '';
          document.getElementById('cw-mod-category').value = 'Work';
        }

        document.getElementById('cw-mod-save').addEventListener('click', async () => {
          const title = document.getElementById('cw-mod-title').value.trim();
          const objective = document.getElementById('cw-mod-objective').value.trim();
          if (!title) return;
          const priority = parseInt(priorityRange.value);
          const deadline = document.getElementById('cw-mod-deadline').value || null;
          const statusText = document.getElementById('cw-mod-status').value.trim();
          const challengesText = document.getElementById('cw-mod-challenges').value.trim();
          const enablersText = document.getElementById('cw-mod-enablers').value.trim();

          const status = statusText ? [{ text: statusText, as_of: new Date().toISOString().slice(0,10) }] : [];
          const challenges = challengesText ? challengesText.split('\\n').filter(Boolean).map(t => ({ text: t.trim() })) : [];
          const enablers = enablersText ? enablersText.split('\\n').filter(Boolean).map(t => ({ text: t.trim() })) : [];

          const body = { title, objective: objective || title, measurable_target: objective || null, priority, priority_source: 'declared', deadline, status, challenges, enablers, state: 'active' };

          if (editingId) {
            await fetch(BASE + '/modules/' + editingId, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          } else {
            await fetch(BASE + '/modules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          }
          form.classList.add('hidden');
          loadModules();
        });

        async function loadModules() {
          try {
            const res = await fetch(BASE + '/modules');
            const data = await res.json();
            const list = document.getElementById('cw-modules-list');
            const modules = data.modules || [];
            if (!modules.length) { list.innerHTML = '<div class="text-xs text-neutral-500">No objectives yet. Add one or mention a goal in chat.</div>'; return; }
            list.innerHTML = modules.map(m => renderModuleCard(m)).join('');
            list.querySelectorAll('[data-edit-mod]').forEach(btn => {
              btn.addEventListener('click', () => editModule(modules.find(x => x.id === btn.dataset.editMod)));
            });
            list.querySelectorAll('[data-del-mod]').forEach(btn => {
              btn.addEventListener('click', async () => {
                if (!confirm('Delete this module?')) return;
                await fetch(BASE + '/modules/' + btn.dataset.delMod, { method: 'DELETE' });
                loadModules();
              });
            });
          } catch (e) {
            document.getElementById('cw-modules-list').innerHTML = '<div class="text-xs text-red-500">Error loading modules</div>';
          }
        }

        function editModule(m) {
          if (!m) return;
          editingId = m.id;
          document.getElementById('cw-mod-title').value = m.title || '';
          document.getElementById('cw-mod-objective').value = m.measurable_target || m.objective || '';
          priorityRange.value = m.priority || 5; priorityVal.textContent = m.priority || 5;
          document.getElementById('cw-mod-deadline').value = m.deadline || '';
          document.getElementById('cw-mod-status').value = (m.status || []).map(s => s.text).join('; ');
          document.getElementById('cw-mod-challenges').value = (m.challenges || []).map(c => c.text).join('\\n');
          document.getElementById('cw-mod-enablers').value = (m.enablers || []).map(e => e.text).join('\\n');
          form.classList.remove('hidden');
        }

        function renderModuleCard(m) {
          const stateColors = { active: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400', expired: 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400', achieved: 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400', abandoned: 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-500' };
          const color = stateColors[m.state] || stateColors.active;
          const statusText = (m.status || []).map(s => s.text + (s.as_of ? ' ('+s.as_of+')' : '')).join('; ');
          const deadlineStr = m.deadline ? new Date(m.deadline).toLocaleDateString() : '—';
          return '<div class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-4">' +
            '<div class="flex items-start justify-between gap-2 mb-2">' +
              '<div><div class="font-medium text-sm text-neutral-900 dark:text-neutral-100">' + (m.title||'') + '</div>' +
              '<div class="text-xs text-neutral-500 mt-0.5">' + (m.measurable_target || m.objective || '') + '</div></div>' +
              '<span class="text-[10px] px-2 py-0.5 rounded-full font-medium ' + color + '">' + m.state + '</span>' +
            '</div>' +
            '<div class="grid grid-cols-3 gap-2 text-xs text-neutral-600 dark:text-neutral-400 mt-2">' +
              '<div><span class="font-medium">P:</span> ' + m.priority + '/10</div>' +
              '<div><span class="font-medium">Deadline:</span> ' + deadlineStr + '</div>' +
              '<div><span class="font-medium">Status:</span> ' + (statusText || '—') + '</div>' +
            '</div>' +
            (((m.challenges||[]).length || (m.enablers||[]).length) ? '<div class="grid grid-cols-2 gap-2 text-xs text-neutral-500 dark:text-neutral-500 mt-2">' +
              '<div><span class="font-medium">Challenges:</span> ' + (m.challenges||[]).map(c=>c.text).join('; ') + '</div>' +
              '<div><span class="font-medium">Enablers:</span> ' + (m.enablers||[]).map(e=>e.text).join('; ') + '</div>' +
            '</div>' : '') +
            '<div class="flex gap-2 mt-3 pt-2 border-t border-neutral-100 dark:border-neutral-700/30">' +
              '<button data-edit-mod="' + m.id + '" class="text-xs px-2 py-1 rounded border border-neutral-200/60 dark:border-neutral-700/60 hover:bg-neutral-50 dark:hover:bg-neutral-700/40">Edit</button>' +
              '<button data-del-mod="' + m.id + '" class="text-xs px-2 py-1 rounded border border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10">Delete</button>' +
            '</div>' +
          '</div>';
        }

        loadModules();
      })();
      </script>
    `;
  },

  _renderAnalyticsTab(port) {
    const analyticsEnabled = store.get('cortex.analyticsEnabled', false);
    if (!analyticsEnabled) {
      return `
        <div class="space-y-4 max-w-2xl">
          <div class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-5 text-center space-y-3">
            <h4 class="text-sm font-medium text-neutral-800 dark:text-neutral-200">Analytics is disabled</h4>
            <p class="text-sm text-neutral-500 dark:text-neutral-400">Enable analytics in Settings to track memory quality metrics — retrieval accuracy, recall failures, and goal awareness.</p>
            <p class="text-xs text-neutral-400">Analytics adds a small amount of processing time per interaction (local embedding checks, async) and an optional weekly audit (~$1/week using the judge model).</p>
          </div>
        </div>
      `;
    }
    return `
      <div class="space-y-4 max-w-2xl">
        <p class="text-sm text-neutral-500 dark:text-neutral-400">Memory quality metrics — rolling 7-day window. Enable the weekly audit for recall and goal-awareness scores.</p>

        <div id="analytics-kpis" class="grid grid-cols-2 gap-3">
          <div class="text-xs text-neutral-400">Loading metrics...</div>
        </div>

        <div class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-4 space-y-2">
          <h4 class="text-sm font-medium text-neutral-700 dark:text-neutral-300">Recent Failures</h4>
          <div id="analytics-failures" class="space-y-1.5 max-h-48 overflow-y-auto">
            <div class="text-xs text-neutral-400">Loading...</div>
          </div>
        </div>
      </div>
      <script>
      (function() {
        async function loadAnalytics() {
          try {
            const metrics = await window.api.plugins.getMetrics();
            const failures = await window.api.plugins.getMetricsFailures();

            const kpisEl = document.getElementById('analytics-kpis');
            if (kpisEl && metrics) {
              const cards = [
                { label: 'Exchanges', value: metrics.exchanges || 0, target: null },
                { label: 'Retrieval p95', value: (metrics.retrieval_p95_ms || 0) + 'ms', target: '<500ms' },
                { label: 'Redundant Q rate', value: (metrics.redundant_question_rate_per100 || 0) + '/100', target: '<2' },
                { label: 'Correction rate', value: (metrics.correction_rate_per100 || 0) + '/100', target: '<3' },
                { label: 'Miss journal', value: metrics.miss_count || 0, target: '↓' },
                { label: 'Extraction failures', value: (metrics.extraction_failure_rate_pct || 0) + '%', target: '<1%' },
                { label: 'Salience coverage', value: (metrics.salience_coverage_pct || 0) + '%', target: '>95%' },
                { label: 'Open contradictions', value: metrics.open_contradictions || 0, target: '0' },
                { label: 'Context recall (audit)', value: metrics.live_context_recall_pct != null ? metrics.live_context_recall_pct + '%' : '—', target: '≥85%' },
                { label: 'Brief match count', value: metrics.brief_match_count || 0, target: null },
              ];
              kpisEl.innerHTML = cards.map(c => \`
                <div class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-xl p-3">
                  <div class="text-[11px] text-neutral-500 dark:text-neutral-400">\${c.label}</div>
                  <div class="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mt-0.5">\${c.value}</div>
                  \${c.target ? '<div class="text-[10px] text-neutral-400 mt-0.5">Target: ' + c.target + '</div>' : ''}
                </div>
              \`).join('');
            }

            const failEl = document.getElementById('analytics-failures');
            if (failEl && failures?.failures) {
              if (failures.failures.length === 0) {
                failEl.innerHTML = '<div class="text-xs text-neutral-400 italic">No failures detected yet.</div>';
              } else {
                failEl.innerHTML = failures.failures.map(f => \`
                  <div class="flex items-center gap-2 text-xs">
                    <span class="\${f.type === 'miss' ? 'text-red-500' : f.type === 'redundant_question' ? 'text-amber-500' : 'text-orange-500'}">●</span>
                    <span class="text-neutral-600 dark:text-neutral-400 truncate flex-1">\${f.type}: \${f.note || f.question || f.pattern || ''}</span>
                    <span class="text-neutral-400 shrink-0">\${f.ts?.slice(0,10) || ''}</span>
                  </div>
                \`).join('');
              }
            }
          } catch (e) {
            console.warn('[Cortex:Analytics] Failed to load metrics:', e);
          }
        }
        loadAnalytics();
      })();
      </script>
    `;
  },

  _renderKGTab(port) {
    return `
      <div class="space-y-6">
        <p class="text-sm text-neutral-500 dark:text-neutral-400">Your memory data — profile, recent facts, and pending updates.</p>

        <!-- Stats Grid -->
        <div class="grid grid-cols-4 gap-3 text-sm">
          <div class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-4">
            <div class="text-2xl font-semibold text-neutral-900 dark:text-neutral-100" id="cortex-entity-count">—</div>
            <div class="text-xs text-neutral-500 dark:text-neutral-400">Entities</div>
          </div>
          <div class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-4">
            <div class="text-2xl font-semibold text-neutral-900 dark:text-neutral-100" id="cortex-edge-count">—</div>
            <div class="text-xs text-neutral-500 dark:text-neutral-400">Relationships</div>
          </div>
          <div class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-4">
            <div class="text-2xl font-semibold text-neutral-900 dark:text-neutral-100" id="cortex-fact-count">—</div>
            <div class="text-xs text-neutral-500 dark:text-neutral-400">Facts</div>
          </div>
          <div class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-4">
            <div class="text-2xl font-semibold text-neutral-900 dark:text-neutral-100" id="cortex-pending-count">—</div>
            <div class="text-xs text-neutral-500 dark:text-neutral-400">Pending</div>
          </div>
        </div>
        <!-- Profile Section -->
        <div>
          <h3 class="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">Business Profile</h3>
          <div class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-4 text-xs text-neutral-600 dark:text-neutral-400 whitespace-pre-wrap max-h-60 overflow-y-auto font-mono leading-relaxed" id="cortex-profile">Loading...</div>
        </div>
        <!-- Recent Facts -->
        <div>
          <h3 class="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">Recent Facts</h3>
          <div class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-4 space-y-2 max-h-48 overflow-y-auto" id="cortex-recent-facts">
            <div class="text-xs text-neutral-500">Loading...</div>
          </div>
        </div>
        <!-- Pending Updates -->
        <div>
          <h3 class="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">Pending Updates</h3>
          <div class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-4 space-y-2 max-h-48 overflow-y-auto" id="cortex-pending-list">
            <div class="text-xs text-neutral-500">Loading...</div>
          </div>
        </div>
      </div>
      <script>
      (async () => {
        const port = ${port};
        try {
          const res = await fetch('http://127.0.0.1:' + port + '/health');
          if (res.ok) {
            const data = await res.json();
            const entityEl = document.getElementById('cortex-entity-count');
            const edgeEl = document.getElementById('cortex-edge-count');
            const factEl = document.getElementById('cortex-fact-count');
            if (entityEl && data.entities != null) entityEl.textContent = data.entities;
            if (edgeEl && data.edges != null) edgeEl.textContent = data.edges;
            if (factEl && data.edges != null) factEl.textContent = data.edges;
          }
        } catch {}
        try {
          const res = await fetch('http://127.0.0.1:' + port + '/profile');
          if (res.ok) {
            const profile = await res.json();
            const el = document.getElementById('cortex-profile');
            if (el) {
              if (profile.rendered) { el.textContent = profile.rendered; }
              else if (profile.sections) { el.textContent = Object.entries(profile.sections).map(([k, v]) => k + ': ' + (v.summary || '')).join('\\n'); }
              else { el.textContent = JSON.stringify(profile, null, 2).slice(0, 2000); }
            }
          }
        } catch (e) { const el = document.getElementById('cortex-profile'); if (el) el.textContent = 'Error loading profile'; }
        try {
          const res = await fetch('http://127.0.0.1:' + port + '/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: '', limit: 10 }) });
          if (res.ok) {
            const data = await res.json();
            const el = document.getElementById('cortex-recent-facts');
            if (el && data.results && data.results.length > 0) {
              el.innerHTML = data.results.map(r => '<div class="text-xs text-neutral-600 dark:text-neutral-400 py-1 border-b border-neutral-100 dark:border-neutral-700/30 last:border-0">' + (r.fact || r.content || JSON.stringify(r)) + '</div>').join('');
            } else if (el) { el.innerHTML = '<div class="text-xs text-neutral-500">No facts stored yet.</div>'; }
          }
        } catch {}
        try {
          const res = await fetch('http://127.0.0.1:' + port + '/pending-updates');
          if (res.ok) {
            const data = await res.json();
            const items = Array.isArray(data) ? data : (data.updates || []);
            const countEl = document.getElementById('cortex-pending-count');
            if (countEl) countEl.textContent = items.length;
            const el = document.getElementById('cortex-pending-list');
            if (el && items.length > 0) {
              el.innerHTML = items.slice(0, 20).map(u => {
                const id = u.id || '';
                const text = u.proposed_change || u.content || u.fact || JSON.stringify(u).slice(0, 100);
                const section = u.section || '?';
                const tier = u.tier || '';
                return '<div class="flex items-start gap-2 py-1.5 border-b border-neutral-100 dark:border-neutral-700/30 last:border-0">' +
                  '<div class="flex-1 text-xs text-neutral-600 dark:text-neutral-400"><span class="text-neutral-400 dark:text-neutral-500">[' + section + (tier === 'high' ? ' ⚠' : '') + ']</span> ' + text.slice(0, 120) + '</div>' +
                  '<div class="flex gap-1 shrink-0">' +
                    '<button data-approve-id="' + id + '" class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/50">✓</button>' +
                    '<button data-reject-id="' + id + '" class="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50">✗</button>' +
                  '</div></div>';
              }).join('') + (items.length > 20 ? '<div class="text-xs text-neutral-400 pt-1">+ ' + (items.length - 20) + ' more</div>' : '');
              // Bind approve/reject
              el.querySelectorAll('[data-approve-id]').forEach(btn => {
                btn.addEventListener('click', async () => {
                  await fetch('http://127.0.0.1:' + port + '/pending-updates/' + btn.dataset.approveId + '/approve', { method: 'POST' });
                  btn.closest('.flex.items-start').remove();
                  const c = document.getElementById('cortex-pending-count');
                  if (c) c.textContent = Math.max(0, parseInt(c.textContent || '0') - 1);
                });
              });
              el.querySelectorAll('[data-reject-id]').forEach(btn => {
                btn.addEventListener('click', async () => {
                  await fetch('http://127.0.0.1:' + port + '/pending-updates/' + btn.dataset.rejectId + '/reject', { method: 'POST' });
                  btn.closest('.flex.items-start').remove();
                  const c = document.getElementById('cortex-pending-count');
                  if (c) c.textContent = Math.max(0, parseInt(c.textContent || '0') - 1);
                });
              });
            } else if (el) { el.innerHTML = '<div class="text-xs text-neutral-500">No pending updates.</div>'; }
          }
        } catch {}
      })();
      </script>
    `;
  },

  _renderSettingsTab(port) {
    return `
      <div class="space-y-4">
        <p class="text-sm text-neutral-500 dark:text-neutral-400">Cortex provides persistent memory for your conversations. All data is stored locally.</p>
        <div class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-4 space-y-4">
          <label class="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300 cursor-pointer">
            <input type="checkbox" id="cortex-cite-toggle" ${store.get('cortex.citeSources', false) ? 'checked' : ''} class="rounded" />
            Cite sources (show when facts were learned)
          </label>
          <label class="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300 cursor-pointer">
            <input type="checkbox" id="cortex-extract-toggle" ${store.get('cortex.extractionEnabled', true) ? 'checked' : ''} class="rounded" />
            <span>Save my chat data to memory</span>
          </label>
          <label class="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300 cursor-pointer">
            <input type="checkbox" id="cortex-scoped-toggle" ${store.get('cortex.scopedEnabled', true) ? 'checked' : ''} class="rounded" />
            <span>Use my Objectives as context</span>
          </label>
          <label class="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300 cursor-pointer">
            <input type="checkbox" id="cortex-autoapprove-toggle" ${store.get('cortex.autoApprove', false) ? 'checked' : ''} class="rounded" />
            <span>Auto-approve all updates to my Profile and Objectives <span class="text-neutral-400 dark:text-neutral-500">— your Profile and Objectives override any interpretation of your data by the AI. Enabling this will allow the AI to update your Profile and Objectives without your approval</span></span>
          </label>
          <label class="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300 cursor-pointer">
            <input type="checkbox" id="cortex-analytics-toggle" ${store.get('cortex.analyticsEnabled', false) ? 'checked' : ''} class="rounded" />
            <span>Enable analytics <span class="text-neutral-400 dark:text-neutral-500">— tracks memory quality metrics (retrieval accuracy, recall failures). Adds a small amount of processing time and cost per interaction. View results in the Analytics tab.</span></span>
          </label>
          <div>
            <label class="text-sm text-neutral-600 dark:text-neutral-400 block mb-1">Token budget: <span id="cortex-budget-val">${store.get('cortex.tokenBudget', 1500)}</span></label>
            <input type="range" min="500" max="3000" step="100" value="${store.get('cortex.tokenBudget', 1500)}" id="cortex-budget-range" class="w-full" />
          </div>
        </div>
        <div class="pt-3 border-t border-neutral-200/40 dark:border-neutral-700/40">
          <button id="cortex-clear-btn" class="px-4 py-2.5 rounded-lg bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all">Clear All Memory</button>
        </div>
      </div>
      <script>
      (function() {
        const citeToggle = document.getElementById('cortex-cite-toggle');
        if (citeToggle) citeToggle.addEventListener('change', () => { window.api.plugins.setSetting({ key: 'cortex.citeSources', value: citeToggle.checked }); });
        const extractToggle = document.getElementById('cortex-extract-toggle');
        if (extractToggle) extractToggle.addEventListener('change', () => { window.api.plugins.setSetting({ key: 'cortex.extractionEnabled', value: extractToggle.checked }); });
        const scopedToggle = document.getElementById('cortex-scoped-toggle');
        if (scopedToggle) scopedToggle.addEventListener('change', () => { window.api.plugins.setSetting({ key: 'cortex.scopedEnabled', value: scopedToggle.checked }); });
        const autoApproveToggle = document.getElementById('cortex-autoapprove-toggle');
        if (autoApproveToggle) autoApproveToggle.addEventListener('change', () => { window.api.plugins.setSetting({ key: 'cortex.autoApprove', value: autoApproveToggle.checked }); });
        const analyticsToggle = document.getElementById('cortex-analytics-toggle');
        if (analyticsToggle) analyticsToggle.addEventListener('change', () => { window.api.plugins.setSetting({ key: 'cortex.analyticsEnabled', value: analyticsToggle.checked }); });
        const budgetRange = document.getElementById('cortex-budget-range');
        const budgetVal = document.getElementById('cortex-budget-val');
        if (budgetRange) budgetRange.addEventListener('input', () => { budgetVal.textContent = budgetRange.value; window.api.plugins.setSetting({ key: 'cortex.tokenBudget', value: parseInt(budgetRange.value) }); });
        const clearBtn = document.getElementById('cortex-clear-btn');
        if (clearBtn) clearBtn.addEventListener('click', async () => {
          if (!confirm('Clear all memory? This cannot be undone.')) return;
          try { await fetch('http://127.0.0.1:${port}/clear', { method: 'DELETE' }); alert('Memory cleared.'); } catch { alert('Error clearing memory.'); }
        });
      })();
      </script>
    `;
  },

  // ── Settings Panel ──────────────────────────────────────────

  renderSettings(container) {
    const tokenBudget = store.get('cortex.tokenBudget', 1500);
    const extractionEnabled = store.get('cortex.extractionEnabled', true);
    const citeSources = store.get('cortex.citeSources', false);
    const isReady = lifecycle?.isReady() || false;

    return `
      <div class="space-y-4">
        <p class="text-sm text-neutral-500">
          Cortex provides persistent memory for your conversations.
          All data is stored locally.
        </p>

        <div class="flex items-center gap-2 text-sm">
          <span class="w-2 h-2 rounded-full ${isReady ? 'bg-emerald-500' : 'bg-amber-500'}"></span>
          <span class="text-neutral-700">Sidecar: ${isReady ? 'Running' : 'Offline'}</span>
        </div>

        <div class="space-y-3 pt-2">
          <div>
            <label class="text-xs text-neutral-500 block mb-1">Token Budget (context window allocation)</label>
            <input type="range" min="500" max="3000" step="100" value="${tokenBudget}"
              class="w-full" id="cortex-budget" />
            <span class="text-xs text-neutral-400">${tokenBudget} tokens</span>
          </div>

          <div class="flex items-center gap-2">
            <input type="checkbox" id="cortex-extraction" ${extractionEnabled ? 'checked' : ''} />
            <label for="cortex-extraction" class="text-sm text-neutral-700">Save my chat data to memory</label>
          </div>

          <div class="flex items-center gap-2">
            <input type="checkbox" id="cortex-citations" ${citeSources ? 'checked' : ''} />
            <label for="cortex-citations" class="text-sm text-neutral-700">Cite sources (show when facts were learned)</label>
          </div>
        </div>

        <div class="pt-3 border-t border-neutral-200/40 space-y-2">
          <button onclick="if(confirm('Clear all memory? This cannot be undone.')) { window.electronAPI?.send('cortex:clear-memory') }"
            class="px-4 py-2.5 rounded-lg bg-white/60 border border-neutral-200/50 text-sm font-medium text-neutral-700 hover:bg-white/90 transition-all shadow-sm">
            Clear All Memory
          </button>
        </div>
      </div>
    `;
  },

  // ── Slash Commands ──────────────────────────────────────────

  getCommands() {
    return [
      {
        name: '/memory',
        description: 'Show memory stats',
        execute: async () => {
          if (!client || !lifecycle?.isReady()) return '🧠 Memory: offline';
          try {
            const stats = await client.getStats();
            let msg = `🧠 Memory: ${stats.entities || 0} entities, ${stats.edges || 0} relationships, ${stats.facts || 0} facts`;
            msg += `\n📍 Active space: ${activeGroupId}`;

            // Append telemetry summary if available
            if (telemetry) {
              const weekly = telemetry.getWeeklySummary();
              if (weekly) {
                msg += `\n📊 This week: ${weekly.total_extractions} extractions (fail rate: ${weekly.extraction_failure_rate}), ${weekly.total_retrievals} retrievals (p95: ${weekly.retrieval_p95_ms}), ${weekly.sessions} sessions`;
              }
            }
            return msg;
          } catch {
            return '🧠 Memory: error fetching stats';
          }
        },
      },
      {
        name: '/forget',
        description: 'Clear all memory',
        execute: async () => {
          if (!client || !lifecycle?.isReady()) return '🧠 Memory: offline — cannot clear';
          try {
            await client.clear();
            return '🧠 Memory cleared.';
          } catch {
            return '🧠 Memory: error clearing';
          }
        },
      },
    ];
  },
};

// ── Helpers ─────────────────────────────────────────────────────

function getLLMConfig() {
  const vendor = store.get('gateway.vendor') || 'openai';
  const PROVIDER_MAP = {
    openai: { keyStore: 'openai.apiKey', provider: 'openai' },
    anthropic: { keyStore: 'anthropic.apiKey', provider: 'anthropic' },
    google: { keyStore: 'gemini.apiKey', provider: 'google' },
    openrouter: { keyStore: 'openrouter.apiKey', provider: 'openrouter' },
  };

  const cfg = PROVIDER_MAP[vendor];
  const apiKey = cfg ? store.get(cfg.keyStore) : null;
  const model = store.get('gateway.model') || 'gpt-5.4-mini';

  // Check if user is on a local model
  const activeProvider = store.get('provider.active');
  if (activeProvider?.type === 'local') {
    const enginePort = context?.getEnginePort ? context.getEnginePort() : 8847;
    return {
      provider: 'local',
      model: activeProvider.model || 'local',
      api_key: null,
      base_url: `http://127.0.0.1:${enginePort}`,
      engine_port: enginePort,
    };
  }

  return {
    provider: cfg?.provider || 'openai',
    model,
    api_key: apiKey || null,
    base_url: null,
    engine_port: context?.getEnginePort ? context.getEnginePort() : 8847,
  };
}

function resetSessionTimer() {
  if (sessionTimeout) clearTimeout(sessionTimeout);
  lastMessageTime = Date.now();

  sessionTimeout = setTimeout(async () => {
    // Session ended (5 min idle) — trigger reflection
    if (!client || !lifecycle?.isReady()) return;
    try {
      const llmConfig = getLLMConfig();
      await client.reflect(null, llmConfig);
      sessionFactIds = [];
    } catch (err) {
      console.warn(`${LOG} Reflection trigger failed:`, err.message);
    }
  }, SESSION_IDLE_MS);
}

/**
 * Ensure the embedding model (nomic-embed-text) is loaded in the engine.
 * If the engine is idle (user is on a cloud model), start it with the embed model.
 * This runs in the background — non-blocking, user never sees it.
 */
async function ensureEmbeddingEngine() {
  try {
    const path = require('path');
    const fs = require('fs');

    // Find engine-manager via require.cache (plugin-manager.js loaded us, so it's cached)
    let appDir = '';
    for (const key of Object.keys(require.cache)) {
      if (key.endsWith(path.sep + 'plugin-manager.js')) {
        appDir = path.dirname(key);
        break;
      }
    }

    if (!appDir) {
      console.log(`${LOG} Could not locate app directory — embeddings unavailable`);
      return;
    }

    const engineManager = require(path.join(appDir, 'engine-manager'));

    // Check if engine is already running
    const state = engineManager.getState();
    if (state.running) {
      console.log(`${LOG} Engine already running — embeddings available on port ${state.port}`);
      return;
    }

    // Find the nomic-embed-text model file
    const modelsDir = engineManager.getModelsDir();
    const candidates = [
      'nomic-embed-text-v1.5-f16.gguf',
      'nomic-embed-text-v1.5.f16.gguf',
    ];

    let embedModelPath = null;
    for (const name of candidates) {
      const p = path.join(modelsDir, name);
      if (fs.existsSync(p)) {
        embedModelPath = p;
        break;
      }
    }

    if (!embedModelPath) {
      console.log(`${LOG} Embedding model not found — vector search disabled, keyword search still works`);
      return;
    }

    // Start the engine with the embedding model
    console.log(`${LOG} Starting engine with embedding model...`);
    const result = await engineManager.startEngine(embedModelPath);
    if (result.success) {
      console.log(`${LOG} Embedding engine ready on port ${engineManager.getPort()}`);
    } else {
      console.warn(`${LOG} Failed to start embedding engine: ${result.error}`);
    }
  } catch (err) {
    console.warn(`${LOG} ensureEmbeddingEngine error: ${err.message}`);
  }
}
