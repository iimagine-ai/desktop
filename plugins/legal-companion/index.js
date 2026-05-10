// Legal Companion — Main Plugin Entry Point
// AI-powered legal workflows with matter management

const legalDb = require('./db');
const templates = require('./templates');
const contextBuilder = require('./context-builder');
const extractor = require('./extractor');

const LOG = '[Legal]';

let context = null;
let store = null;
let activeMatterId = null;
let lastUserMessage = '';

module.exports = {
  activate(ctx) {
    context = ctx;
    store = ctx.store;
    console.log(`${LOG} Activating...`);

    // Initialize database
    legalDb.init(ctx.db);

    // Configure extractor
    const ollamaUrl = ctx.getOllamaUrl ? ctx.getOllamaUrl() : 'http://localhost:11434';
    extractor.configure(ollamaUrl);

    // Restore active matter from store
    activeMatterId = store.get('legal-companion.activeMatter', null);
    if (activeMatterId) {
      extractor.setActiveMatter(activeMatterId);
      const matter = legalDb.getMatter(activeMatterId);
      if (!matter) {
        activeMatterId = null;
        store.delete('legal-companion.activeMatter');
      }
    }

    console.log(`${LOG} Activated. Active matter: ${activeMatterId || 'none'}`);
  },

  deactivate() {
    console.log(`${LOG} Deactivated`);
  },

  // ── Chat Preprocess (inject matter context) ───────────────────

  async onChatPreprocess({ messages, assistant }) {
    if (!activeMatterId) return { messages, assistant };

    // Capture user message for postprocess
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    lastUserMessage = lastUserMsg?.content || '';

    try {
      const legalContext = contextBuilder.buildMatterContext(activeMatterId);
      if (!legalContext) return { messages, assistant };

      // Inject after existing system messages
      const systemMsg = { role: 'system', content: legalContext };
      const systemEnd = messages.findIndex(m => m.role !== 'system');
      const insertAt = systemEnd === -1 ? 0 : systemEnd;
      messages.splice(insertAt, 0, systemMsg);

      return { messages, assistant };
    } catch (err) {
      console.error(`${LOG} Preprocess error:`, err.message);
      return { messages, assistant };
    }
  },

  // ── Chat Postprocess (extract legal entities + log activity) ────

  async onChatPostprocess({ response, assistant }) {
    if (!activeMatterId) return { response, assistant };

    const userMsg = lastUserMessage;
    lastUserMessage = '';

    // Log user message to timeline
    if (userMsg) {
      const userSummary = userMsg.length > 100 ? userMsg.substring(0, 100) + '...' : userMsg;
      legalDb.logActivity(activeMatterId, 'user_message', `You: ${userSummary}`);
    }

    // Log AI response to timeline
    if (response) {
      const aiSummary = response.length > 100 ? response.substring(0, 100) + '...' : response;
      legalDb.logActivity(activeMatterId, 'ai_response', `AI: ${aiSummary}`);
    }

    // Auto-save substantial AI responses as outputs (drafts)
    if (response && response.length > 300) {
      const title = userMsg
        ? (userMsg.length > 60 ? userMsg.substring(0, 60) + '...' : userMsg)
        : 'AI Response';
      legalDb.saveOutput(activeMatterId, {
        output_type: 'draft',
        title: title,
        content: response,
        prompt_used: userMsg || null,
        model_used: 'local',
      });
    }

    // Fire-and-forget extraction (non-blocking, may fail silently)
    setTimeout(async () => {
      try {
        await extractor.extractLegalEntities(userMsg, response);
      } catch (err) {
        console.warn(`${LOG} Postprocess error:`, err.message);
      }
    }, 0);

    return { response, assistant };
  },

  // ── Sidebar Page (Matters List + Detail) ──────────────────────

  renderPage(container) {
    const profile = legalDb.getProfile();
    const matters = legalDb.getAllMatters();
    const stats = legalDb.getStats();

    // If no setup, show setup prompt
    if (!profile || !profile.setup_complete) {
      return renderSetupPage(profile);
    }

    // If active matter, show detail view
    if (activeMatterId) {
      const matter = legalDb.getMatter(activeMatterId);
      if (matter) return renderMatterDetail(matter);
    }

    // Otherwise show matters list
    return renderMattersList(matters, stats);
  },

  // ── Settings Panel ────────────────────────────────────────────

  renderSettings(container) {
    const profile = legalDb.getProfile();
    const stats = legalDb.getStats();

    let areas = [];
    try { areas = JSON.parse(profile?.practice_areas || '[]'); } catch {}
    let jurisdictions = [];
    try { jurisdictions = JSON.parse(profile?.jurisdictions || '[]'); } catch {}

    return `
      <div class="space-y-4">
        <p class="text-sm text-gray-400">
          Legal Companion — AI-powered legal workflows with matter management.
          All client data stays on your machine.
        </p>

        <div class="grid grid-cols-2 gap-3 text-sm">
          <div class="bg-gray-800 rounded p-3">
            <div class="text-2xl font-bold text-white">${stats.active}</div>
            <div class="text-xs text-gray-400">Active Matters</div>
          </div>
          <div class="bg-gray-800 rounded p-3">
            <div class="text-2xl font-bold text-white">${stats.outputs}</div>
            <div class="text-xs text-gray-400">Outputs Generated</div>
          </div>
          <div class="bg-gray-800 rounded p-3">
            <div class="text-2xl font-bold text-white">${stats.documents}</div>
            <div class="text-xs text-gray-400">Documents</div>
          </div>
          <div class="bg-gray-800 rounded p-3">
            <div class="text-2xl font-bold text-white">${stats.matters}</div>
            <div class="text-xs text-gray-400">Total Matters</div>
          </div>
        </div>

        <div class="space-y-2 pt-2">
          <h4 class="text-sm font-medium text-gray-300">Practice Profile</h4>
          <div class="text-sm text-gray-400">
            <p>Firm: ${profile?.firm_name || 'Not set'}</p>
            <p>Role: ${profile?.role || 'Not set'}</p>
            <p>Areas: ${areas.join(', ') || 'Not set'}</p>
            <p>Jurisdictions: ${jurisdictions.join(', ') || 'Not set'}</p>
            <p>Citation: ${profile?.citation_format || 'AGLC4'}</p>
          </div>
        </div>

        <div class="pt-3 border-t border-gray-700">
          <button onclick="window.api.plugins.sendEvent('legal:reset-setup', {}).then(function() { return window.api.plugins.renderPage('legal-companion'); }).then(function(html) { if (html) document.querySelector('#mainContent').innerHTML = html; })"
            class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm rounded">
            Re-run Setup Wizard
          </button>
        </div>
      </div>
    `;
  },

  // ── Slash Commands ────────────────────────────────────────────

  getCommands() {
    return [
      {
        name: '/matter',
        description: 'Switch active matter or show current',
        execute: (args) => {
          if (!args) {
            if (!activeMatterId) return '⚖️ No active matter. Use /new-matter to create one.';
            const m = legalDb.getMatter(activeMatterId);
            return m ? `⚖️ Active matter: ${m.name} (${m.practice_area || 'General'}, ${m.status})` : '⚖️ No active matter.';
          }
          // Search by name
          const matters = legalDb.getAllMatters();
          const match = matters.find(m => m.name.toLowerCase().includes(args.toLowerCase()));
          if (match) {
            activeMatterId = match.id;
            store.set('legal-companion.activeMatter', match.id);
            extractor.setActiveMatter(match.id);
            return `⚖️ Switched to: ${match.name}`;
          }
          return `⚖️ No matter found matching "${args}". Available: ${matters.map(m => m.name).join(', ')}`;
        },
      },
      {
        name: '/new-matter',
        description: 'Create a new matter',
        execute: (args) => {
          if (!args) return '⚖️ Usage: /new-matter [Matter Name]';
          const id = legalDb.createMatter({ name: args });
          activeMatterId = id;
          store.set('legal-companion.activeMatter', id);
          extractor.setActiveMatter(id);
          return `⚖️ Created matter: "${args}". Now active. Use /matter-edit to add details.`;
        },
      },
      {
        name: '/time',
        description: 'Generate a time entry from description',
        execute: (args) => {
          if (!args) return '⚖️ Usage: /time [description of work performed]';
          if (!activeMatterId) return '⚖️ No active matter. Use /matter to select one first.';
          // Return the template prompt filled with context — the LLM will process it
          const matter = legalDb.getMatter(activeMatterId);
          const profile = legalDb.getProfile();
          const filled = templates.fillTemplate('time_entry', matter, profile);
          return filled ? `${filled.prompt}\n${args}` : `Convert to time entry: ${args}`;
        },
      },
      {
        name: '/template',
        description: 'List available legal templates',
        execute: (args) => {
          const cats = templates.getCategories();
          if (!args) {
            const list = cats.map(c => {
              const t = templates.getByCategory(c);
              return `**${c}** (${t.length}): ${t.map(x => x.label).join(', ')}`;
            }).join('\n');
            return `⚖️ Legal Templates:\n${list}\n\nUse /template [id] to use a template.`;
          }
          const tmpl = templates.getById(args);
          if (!tmpl) return `⚖️ Template "${args}" not found. Use /template to see all.`;
          const matter = activeMatterId ? legalDb.getMatter(activeMatterId) : null;
          const profile = legalDb.getProfile();
          const filled = templates.fillTemplate(args, matter, profile);
          return filled ? filled.prompt : tmpl.prompt;
        },
      },
      {
        name: '/matters',
        description: 'List all matters',
        execute: () => {
          const matters = legalDb.getAllMatters();
          if (matters.length === 0) return '⚖️ No matters yet. Use /new-matter to create one.';
          const list = matters.map(m => {
            const active = m.id === activeMatterId ? ' ← active' : '';
            return `- ${m.name} [${m.status}]${m.practice_area ? ` (${m.practice_area})` : ''}${active}`;
          }).join('\n');
          return `⚖️ Matters:\n${list}`;
        },
      },
      {
        name: '/summarize',
        description: 'Generate a summary of the active matter',
        execute: () => {
          if (!activeMatterId) return '⚖️ No active matter.';
          const matter = legalDb.getMatter(activeMatterId);
          const profile = legalDb.getProfile();
          const filled = templates.fillTemplate('matter_summary', matter, profile);
          return filled ? filled.prompt : '⚖️ Could not generate summary template.';
        },
      },
    ];
  },

  // ── Public API (for IPC handlers) ─────────────────────────────

  onEvent(eventName, data) {
    switch (eventName) {
      case 'legal:complete-setup':
        legalDb.updateProfile(data);
        // Re-render the page by returning success
        return { success: true };
      case 'legal:select-matter':
        activeMatterId = data;
        store.set('legal-companion.activeMatter', data);
        extractor.setActiveMatter(data);
        return { success: true };
      case 'legal:back-to-list':
        activeMatterId = null;
        store.delete('legal-companion.activeMatter');
        return { success: true };
      case 'legal:create-matter':
        const id = legalDb.createMatter(data);
        activeMatterId = id;
        store.set('legal-companion.activeMatter', id);
        extractor.setActiveMatter(id);
        return { success: true, id };
      case 'legal:reset-setup':
        legalDb.updateProfile({ setup_complete: 0 });
        return { success: true };
      default:
        return null;
    }
  },

  getActiveMatterId() { return activeMatterId; },
  setActiveMatter(id) {
    activeMatterId = id;
    store.set('legal-companion.activeMatter', id);
    extractor.setActiveMatter(id);
  },
  getDb() { return legalDb; },
  getTemplates() { return templates; },
};

// ── UI Renderers ──────────────────────────────────────────────────

function renderSetupPage(profile) {
  return `
    <div class="p-6 space-y-6">
      <div class="text-center py-8">
        <div class="text-4xl mb-4">⚖️</div>
        <h2 class="text-xl font-semibold text-white mb-2">Legal Companion Setup</h2>
        <p class="text-gray-400 text-sm max-w-md mx-auto">
          Configure your practice profile to personalize AI responses for your legal work.
          All data stays on your machine.
        </p>
      </div>

      <div class="max-w-md mx-auto space-y-4">
        <div>
          <label class="text-xs text-gray-400 block mb-1">Firm Name</label>
          <input type="text" id="legal-setup-firm" value="${profile?.firm_name || ''}"
            class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white"
            placeholder="Your firm name" />
        </div>
        <div>
          <label class="text-xs text-gray-400 block mb-1">Your Role</label>
          <select id="legal-setup-role" class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white">
            <option value="">Select...</option>
            <option value="Principal" ${profile?.role === 'Principal' ? 'selected' : ''}>Principal</option>
            <option value="Partner" ${profile?.role === 'Partner' ? 'selected' : ''}>Partner</option>
            <option value="Associate" ${profile?.role === 'Associate' ? 'selected' : ''}>Associate</option>
            <option value="Paralegal" ${profile?.role === 'Paralegal' ? 'selected' : ''}>Paralegal</option>
            <option value="In-house Counsel" ${profile?.role === 'In-house Counsel' ? 'selected' : ''}>In-house Counsel</option>
          </select>
        </div>
        <div>
          <label class="text-xs text-gray-400 block mb-1">Primary Jurisdiction</label>
          <input type="text" id="legal-setup-jurisdiction" value=""
            class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white"
            placeholder="e.g. NSW, Australia" />
        </div>
        <div>
          <label class="text-xs text-gray-400 block mb-1">Citation Format</label>
          <select id="legal-setup-citation" class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white">
            <option value="AGLC4">AGLC4 (Australia)</option>
            <option value="Bluebook">Bluebook (US)</option>
            <option value="OSCOLA">OSCOLA (UK)</option>
            <option value="McGill">McGill (Canada)</option>
          </select>
        </div>
        <button id="legal-setup-submit" class="w-full px-4 py-2 bg-white text-black font-medium text-sm rounded hover:bg-gray-200">
          Complete Setup
        </button>
      </div>
    </div>
    <script>
      (function() {
        var mc = document.querySelector('#mainContent');
        var btn = document.getElementById('legal-setup-submit');
        if (btn) btn.onclick = function() {
          var data = {
            firm_name: document.getElementById('legal-setup-firm').value,
            role: document.getElementById('legal-setup-role').value,
            jurisdictions: JSON.stringify([document.getElementById('legal-setup-jurisdiction').value].filter(Boolean)),
            citation_format: document.getElementById('legal-setup-citation').value,
            setup_complete: 1
          };
          window.api.plugins.sendEvent('legal:complete-setup', data).then(function() {
            return window.api.plugins.renderPage('legal-companion');
          }).then(function(html) { if (html && mc) mc.innerHTML = html; });
        };
      })();
    </script>
  `;
}

function renderMattersList(matters, stats) {
  const matterRows = matters.map(m => {
    const statusColors = {
      active: 'bg-green-500', intake: 'bg-blue-500', discovery: 'bg-cyan-500',
      negotiation: 'bg-yellow-500', mediation: 'bg-orange-500', trial_prep: 'bg-red-500',
      settled: 'bg-teal-500', completed: 'bg-gray-500',
    };
    const color = statusColors[m.status] || 'bg-gray-500';
    const isActive = m.id === activeMatterId;

    return `
      <div class="p-3 rounded border ${isActive ? 'border-white/30 bg-gray-800' : 'border-gray-700 hover:border-gray-600'} cursor-pointer"
        data-matter-id="${m.id}">
        <div class="flex items-center gap-2">
          <span class="w-2 h-2 rounded-full ${color}"></span>
          <span class="text-sm font-medium text-white flex-1">${m.name}</span>
          ${isActive ? '<span class="text-xs text-gray-400">active</span>' : ''}
        </div>
        <div class="text-xs text-gray-500 mt-1">
          ${m.practice_area || 'General'}${m.jurisdiction ? ` • ${m.jurisdiction}` : ''}
          ${m.next_deadline ? ` • Due: ${m.next_deadline}` : ''}
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="p-6 space-y-4">
      <div class="flex items-center justify-between">
        <h2 class="text-xl font-semibold text-white">⚖️ Matters</h2>
        <button id="legal-new-matter-btn"
          class="px-3 py-1.5 bg-white text-black text-xs font-medium rounded hover:bg-gray-200">
          + New Matter
        </button>
      </div>

      <div id="legal-new-matter-form" class="hidden space-y-2 p-3 rounded border border-gray-700 bg-gray-800">
        <input type="text" id="legal-new-matter-name" placeholder="Matter name (e.g. Smith v Jones)"
          class="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-white" />
        <div class="flex gap-2">
          <button id="legal-new-matter-save" class="px-3 py-1.5 bg-white text-black text-xs font-medium rounded hover:bg-gray-200">Create</button>
          <button id="legal-new-matter-cancel" class="px-3 py-1.5 bg-gray-700 text-gray-300 text-xs rounded hover:bg-gray-600">Cancel</button>
        </div>
      </div>

      <div class="flex gap-3 text-xs text-gray-400">
        <span>${stats.active} active</span>
        <span>${stats.outputs} outputs</span>
        <span>${stats.documents} docs</span>
      </div>

      <div class="space-y-2">
        ${matterRows || '<p class="text-sm text-gray-500 py-4 text-center">No matters yet. Create one to get started.</p>'}
      </div>
    </div>
    <script>
      (function() {
        var mc = document.querySelector('#mainContent');
        // New matter button
        var newBtn = document.getElementById('legal-new-matter-btn');
        var newForm = document.getElementById('legal-new-matter-form');
        var newInput = document.getElementById('legal-new-matter-name');
        var saveBtn = document.getElementById('legal-new-matter-save');
        var cancelBtn = document.getElementById('legal-new-matter-cancel');
        if (newBtn) newBtn.onclick = function() { newForm.classList.remove('hidden'); newInput.focus(); };
        if (cancelBtn) cancelBtn.onclick = function() { newForm.classList.add('hidden'); newInput.value = ''; };
        if (saveBtn) saveBtn.onclick = function() {
          var name = newInput.value.trim();
          if (!name) return;
          window.api.plugins.sendEvent('legal:create-matter', {name: name}).then(function() {
            return window.api.plugins.renderPage('legal-companion');
          }).then(function(html) { if (html && mc) mc.innerHTML = html; });
        };
        if (newInput) newInput.onkeydown = function(e) { if (e.key === 'Enter') saveBtn.click(); };
        // Matter selection
        var items = document.querySelectorAll('[data-matter-id]');
        items.forEach(function(el) {
          el.onclick = function() {
            var id = el.getAttribute('data-matter-id');
            window.api.plugins.sendEvent('legal:select-matter', id).then(function() {
              return window.api.plugins.renderPage('legal-companion');
            }).then(function(html) { if (html && mc) mc.innerHTML = html; });
          };
        });
      })();
    </script>
  `;
}

function renderMatterDetail(matter) {
  const outputs = legalDb.getOutputsForMatter(matter.id).slice(0, 10);
  const timeline = legalDb.getTimeline(matter.id, 10);
  const docs = legalDb.getDocumentsForMatter(matter.id);

  const outputRows = outputs.map(o => `
    <div class="text-sm py-2 border-b border-gray-800">
      <div class="flex justify-between">
        <span class="text-gray-200">${o.title}</span>
        <span class="text-xs text-gray-500">${o.status}</span>
      </div>
      <span class="text-xs text-gray-500">${o.output_type} • ${o.created_at?.split('T')[0] || ''}</span>
    </div>
  `).join('');

  const timelineRows = timeline.map(t => `
    <div class="text-xs py-1.5 border-b border-gray-800 text-gray-400">
      <span class="text-gray-500">${t.created_at?.split('T')[0] || ''}</span> — ${t.summary}
    </div>
  `).join('');

  return `
    <div class="p-6 space-y-4">
      <div class="flex items-center gap-2">
        <button id="legal-back-btn"
          class="text-gray-400 hover:text-white text-sm">← Back</button>
        <h2 class="text-lg font-semibold text-white flex-1">${matter.name}</h2>
      </div>

      <div class="grid grid-cols-2 gap-2 text-xs text-gray-400">
        ${matter.practice_area ? `<span>Area: ${matter.practice_area}</span>` : ''}
        ${matter.jurisdiction ? `<span>Jurisdiction: ${matter.jurisdiction}</span>` : ''}
        ${matter.client_name ? `<span>Client: ${matter.client_name}</span>` : ''}
        ${matter.opposing_party ? `<span>Opposing: ${matter.opposing_party}</span>` : ''}
        ${matter.status ? `<span>Status: ${matter.status}</span>` : ''}
        ${matter.next_deadline ? `<span>Deadline: ${matter.next_deadline}</span>` : ''}
      </div>

      <div>
        <h3 class="text-sm font-medium text-gray-300 mb-2">Outputs (${outputs.length})</h3>
        <div class="max-h-40 overflow-auto rounded border border-gray-700 p-2">
          ${outputRows || '<p class="text-xs text-gray-500">No outputs yet. Chat within this matter to generate work product.</p>'}
        </div>
      </div>

      <div>
        <h3 class="text-sm font-medium text-gray-300 mb-2">Timeline</h3>
        <div class="max-h-32 overflow-auto rounded border border-gray-700 p-2">
          ${timelineRows || '<p class="text-xs text-gray-500">No activity yet.</p>'}
        </div>
      </div>

      <div>
        <h3 class="text-sm font-medium text-gray-300 mb-2">Documents (${docs.length})</h3>
        <div class="max-h-24 overflow-auto rounded border border-gray-700 p-2">
          ${docs.length > 0 ? docs.map(d => `<div class="text-xs text-gray-400 py-1">${d.name} [${d.category || 'uncategorized'}]</div>`).join('') : '<p class="text-xs text-gray-500">No documents linked.</p>'}
        </div>
      </div>
    </div>
    <script>
      (function() {
        var mc = document.querySelector('#mainContent');
        var backBtn = document.getElementById('legal-back-btn');
        if (backBtn) backBtn.onclick = function() {
          window.api.plugins.sendEvent('legal:back-to-list', {}).then(function() {
            return window.api.plugins.renderPage('legal-companion');
          }).then(function(html) { if (html && mc) mc.innerHTML = html; });
        };
      })();
    </script>
  `;
}
