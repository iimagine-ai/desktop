// Client Workspace — Communications Log UI
// Renders the Comms tab in project detail: log form + list of entries.

const cwDb = require('./db');

/**
 * Render the communications section for a project.
 */
function renderCommsSection(project) {
  const comms = cwDb.getComms(project.id, 50);

  const commRows = comms.map(c => {
    const sourceLabel = { whatsapp: 'WhatsApp', email: 'Email', slack: 'Slack', phone: 'Phone', sms: 'SMS', other: 'Other' }[c.source] || c.source;
    const preview = c.content.length > 120 ? c.content.slice(0, 120) + '...' : c.content;
    return `
      <div class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-xl p-3 group">
        <div class="flex items-center justify-between mb-1">
          <div class="flex items-center gap-2">
            <span class="text-[10px] px-2 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-400">${sourceLabel}</span>
            <span class="text-xs text-neutral-400 dark:text-neutral-500">${c.comm_date}</span>
          </div>
          <div class="flex items-center gap-1">
            <button onclick="window.cwViewComm('${c.id}')" title="View full"
              class="opacity-0 group-hover:opacity-100 p-1 rounded text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300 transition-all">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
            <button onclick="window.cwDeleteComm('${c.id}')" title="Delete"
              class="opacity-0 group-hover:opacity-100 p-1 rounded text-neutral-400 hover:text-rose-500 dark:hover:text-rose-400 transition-all">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </div>
        <p class="text-xs text-neutral-700 dark:text-neutral-300 whitespace-pre-line line-clamp-3">${escHtml(preview)}</p>
      </div>`;
  }).join('');

  const today = new Date().toISOString().split('T')[0];

  return `
    <div class="space-y-4">
      <!-- Log New Communication -->
      <div class="flex gap-2">
        <button onclick="window.cwShowCommForm()" id="cw-comm-add-btn"
          class="flex-1 px-4 py-2.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm">
          + Log Communication
        </button>
        <button onclick="window.cwReindexComms('${project.id}')" id="cw-comm-reindex-btn" title="Re-index all comms for AI search"
          class="px-3 py-2.5 rounded-lg bg-white/60 dark:bg-neutral-700/60 border border-neutral-200/50 dark:border-neutral-600/50 text-sm text-neutral-600 dark:text-neutral-400 hover:bg-white/90 dark:hover:bg-neutral-700/90 transition-all shadow-sm">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
        </button>
      </div>

      <!-- Add Comm Form (hidden by default) -->
      <div id="cw-comm-form" class="hidden bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-4 space-y-3">
        <div class="flex gap-3">
          <div class="flex-1">
            <label class="text-xs font-medium text-neutral-500 dark:text-neutral-400 block mb-1">Source</label>
            <select id="cw-comm-source"
              class="w-full bg-white/60 dark:bg-neutral-700/60 border border-neutral-200/50 dark:border-neutral-600/50 rounded-xl px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300 focus:outline-none transition-all shadow-sm">
              <option value="whatsapp">WhatsApp</option>
              <option value="email">Email</option>
              <option value="slack">Slack</option>
              <option value="phone">Phone</option>
              <option value="sms">SMS</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label class="text-xs font-medium text-neutral-500 dark:text-neutral-400 block mb-1">Date</label>
            <input type="date" id="cw-comm-date" value="${today}"
              class="bg-white/60 dark:bg-neutral-700/60 border border-neutral-200/50 dark:border-neutral-600/50 rounded-xl px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300 focus:outline-none transition-all shadow-sm" />
          </div>
        </div>
        <div>
          <label class="text-xs font-medium text-neutral-500 dark:text-neutral-400 block mb-1">Content (paste conversation, email thread, or notes)</label>
          <textarea id="cw-comm-content" rows="12" placeholder="Paste your WhatsApp export, email thread, or meeting notes here..."
            class="w-full bg-white/60 dark:bg-neutral-700/60 border border-neutral-200/50 dark:border-neutral-600/50 rounded-xl px-4 py-3 text-sm text-neutral-700 dark:text-neutral-300 placeholder-neutral-400 dark:placeholder-neutral-500 focus:bg-white/90 dark:focus:bg-neutral-700/90 focus:outline-none transition-all shadow-sm resize-y min-h-[200px]"></textarea>
        </div>
        <div class="flex justify-end gap-2">
          <button onclick="window.cwHideCommForm()"
            class="px-4 py-2.5 rounded-lg bg-white/60 dark:bg-neutral-700/60 border border-neutral-200/50 dark:border-neutral-600/50 text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:bg-white/90 dark:hover:bg-neutral-700/90 transition-all shadow-sm">
            Cancel
          </button>
          <button onclick="window.cwSaveComm('${project.id}')"
            class="px-4 py-2.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm">
            Save
          </button>
        </div>
      </div>

      <!-- Comms List -->
      <div class="space-y-2">
        ${commRows || '<p class="text-sm text-neutral-500 dark:text-neutral-400">No communications logged yet. Paste a WhatsApp export or email thread to get started.</p>'}
      </div>
    </div>

    <!-- View Comm Modal -->
    <div id="cw-comm-viewer" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div class="bg-white/95 dark:bg-neutral-800/95 backdrop-blur-xl border border-neutral-200/60 dark:border-neutral-700/60 rounded-2xl w-full max-w-2xl h-[75vh] shadow-xl flex flex-col overflow-hidden">
        <div class="flex items-center justify-between px-5 py-3 border-b border-neutral-200/40 dark:border-neutral-700/40 shrink-0">
          <div class="flex items-center gap-2">
            <span id="cw-comm-view-source" class="text-[10px] px-2 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-400"></span>
            <span id="cw-comm-view-date" class="text-xs text-neutral-400"></span>
          </div>
          <div class="flex items-center gap-2">
            <button id="cw-comm-view-copy" class="px-3 py-1.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-xs font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all">Copy</button>
            <button id="cw-comm-view-close" class="px-3 py-1.5 rounded-lg bg-white/60 dark:bg-neutral-700/60 border border-neutral-200/50 dark:border-neutral-600/50 text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:bg-white/90 dark:hover:bg-neutral-700/90 transition-all">Close</button>
          </div>
        </div>
        <div id="cw-comm-view-content" class="flex-1 overflow-y-auto p-5 text-sm text-neutral-800 dark:text-neutral-200 whitespace-pre-wrap"></div>
      </div>
    </div>
  `;
}

/**
 * Returns the script block for comms interactions.
 */
function getCommsScript() {
  return `
    window.cwReindexComms = async function(projectId) {
      const btn = document.getElementById('cw-comm-reindex-btn');
      btn.disabled = true;
      btn.innerHTML = '<span class="text-xs">Indexing...</span>';
      try {
        const result = await window.api.plugins.sendEvent('cw:reindex-comms', { projectId });
        if (result && result.success) {
          btn.innerHTML = '<span class="text-xs text-green-600 dark:text-green-400">✓ ' + result.indexed + ' indexed</span>';
        } else {
          btn.innerHTML = '<span class="text-xs text-red-500">Failed</span>';
        }
      } catch (e) {
        btn.innerHTML = '<span class="text-xs text-red-500">Error</span>';
      }
      setTimeout(() => {
        btn.disabled = false;
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>';
      }, 3000);
    };
    window.cwShowCommForm = function() {
      document.getElementById('cw-comm-form').classList.remove('hidden');
      document.getElementById('cw-comm-add-btn').classList.add('hidden');
      setTimeout(() => document.getElementById('cw-comm-content').focus(), 100);
    };
    window.cwHideCommForm = function() {
      document.getElementById('cw-comm-form').classList.add('hidden');
      document.getElementById('cw-comm-add-btn').classList.remove('hidden');
    };
    window.cwSaveComm = async function(projectId) {
      const content = document.getElementById('cw-comm-content').value.trim();
      if (!content) { document.getElementById('cw-comm-content').focus(); return; }
      const source = document.getElementById('cw-comm-source').value;
      const commDate = document.getElementById('cw-comm-date').value;
      await window.api.plugins.sendEvent('cw:add-comm', { projectId, source, content, commDate });
      if (window.AppRouter) window.AppRouter.navigatePlugin('client-workspace', 'comms');
    };
    window.cwDeleteComm = async function(id) {
      if (!confirm('Delete this communication entry?')) return;
      await window.api.plugins.sendEvent('cw:delete-comm', { id });
      if (window.AppRouter) window.AppRouter.navigatePlugin('client-workspace', 'comms');
    };
    window.cwViewComm = async function(id) {
      const comm = await window.api.plugins.sendEvent('cw:open-comm', { id });
      if (!comm) return;
      const viewer = document.getElementById('cw-comm-viewer');
      const sourceLabel = { whatsapp: 'WhatsApp', email: 'Email', slack: 'Slack', phone: 'Phone', sms: 'SMS', other: 'Other' }[comm.source] || comm.source;
      document.getElementById('cw-comm-view-source').textContent = sourceLabel;
      document.getElementById('cw-comm-view-date').textContent = comm.comm_date;
      document.getElementById('cw-comm-view-content').textContent = comm.content;
      viewer.classList.remove('hidden');
      document.getElementById('cw-comm-view-close').onclick = () => viewer.classList.add('hidden');
      viewer.onclick = (e) => { if (e.target === viewer) viewer.classList.add('hidden'); };
      document.getElementById('cw-comm-view-copy').onclick = () => {
        navigator.clipboard.writeText(comm.content);
        document.getElementById('cw-comm-view-copy').textContent = 'Copied';
        setTimeout(() => { document.getElementById('cw-comm-view-copy').textContent = 'Copy'; }, 1500);
      };
    };
  `;
}

function escHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = { renderCommsSection, getCommsScript };
