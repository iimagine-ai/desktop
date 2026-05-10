// Client Workspace — UI Rendering
// Renders sidebar pages and settings panel HTML.
// Full CRUD for documents: view, edit, delete, status toggle.

const cwDb = require('./db');
const { renderCommsSection, getCommsScript } = require('./comms-ui');

/**
 * Render the project list view (no active project selected).
 */
function renderProjectList(activeProjectId) {
  const stats = cwDb.getStats();
  const projects = cwDb.getAllProjects();

  const projectRows = projects.map(p => {
    const isSelected = p.id === activeProjectId;
    const docCount = cwDb.getDocumentsForProject(p.id).length;

    return `
      <div class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-4 hover:bg-white/80 dark:hover:bg-neutral-700/60 transition-all cursor-pointer ${isSelected ? 'ring-2 ring-neutral-900 dark:ring-neutral-300' : ''}"
        onclick="window.cwSelectProject('${p.id}')">
        <div class="flex items-center justify-between mb-1">
          <h3 class="text-sm font-medium text-neutral-900 dark:text-neutral-100">${p.name}</h3>
          ${isSelected ? '<span class="text-xs bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 px-2 py-0.5 rounded-full">selected</span>' : ''}
        </div>
        <div class="flex gap-3 text-xs text-neutral-500 dark:text-neutral-400">
          <span>${docCount} docs</span>
          ${p.client_name ? `<span>${p.client_name}</span>` : (p.client_email ? `<span>${p.client_email}</span>` : '')}
          <span>${p.created_at?.split('T')[0] || ''}</span>
        </div>
      </div>`;
  }).join('');

  return `
    <div class="p-6 space-y-6">
      <div class="flex items-center justify-between">
        <h2 class="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Projects</h2>
        <button onclick="window.cwShowCreateProject()"
          class="px-4 py-2.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm">
          + New Project
        </button>
      </div>

      <div class="flex gap-4 text-xs text-neutral-500 dark:text-neutral-400">
        <span>${stats.projects} projects</span>
        <span>${stats.documents} documents</span>
        <span>${stats.activeProjects} active</span>
      </div>

      <div class="space-y-3">
        ${projectRows || '<p class="text-sm text-neutral-500 dark:text-neutral-400">No projects yet. Create one to get started.</p>'}
      </div>
    </div>

    <!-- Create Project Modal -->
    <div id="cw-create-modal" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm">
      <div class="bg-white/90 dark:bg-neutral-800/90 backdrop-blur-xl border border-neutral-200/60 dark:border-neutral-700/60 rounded-2xl p-6 w-full max-w-md shadow-xl">
        <h3 class="text-base font-semibold text-neutral-900 dark:text-neutral-100 mb-4">New Project</h3>
        <div class="space-y-3">
          <div>
            <label class="text-xs font-medium text-neutral-500 dark:text-neutral-400 block mb-1">Project Name *</label>
            <input type="text" id="cw-new-name" placeholder="e.g. Acme Corp — Codebase Merge"
              class="w-full bg-white/60 dark:bg-neutral-700/60 border border-neutral-200/50 dark:border-neutral-600/50 rounded-xl px-4 py-2 text-sm text-neutral-700 dark:text-neutral-300 placeholder-neutral-400 dark:placeholder-neutral-500 focus:bg-white/90 dark:focus:bg-neutral-700/90 focus:outline-none transition-all shadow-sm" />
          </div>
          <div>
            <label class="text-xs font-medium text-neutral-500 dark:text-neutral-400 block mb-1">Client Name</label>
            <input type="text" id="cw-new-client-name" placeholder="e.g. John Smith"
              class="w-full bg-white/60 dark:bg-neutral-700/60 border border-neutral-200/50 dark:border-neutral-600/50 rounded-xl px-4 py-2 text-sm text-neutral-700 dark:text-neutral-300 placeholder-neutral-400 dark:placeholder-neutral-500 focus:bg-white/90 dark:focus:bg-neutral-700/90 focus:outline-none transition-all shadow-sm" />
          </div>
          <div>
            <label class="text-xs font-medium text-neutral-500 dark:text-neutral-400 block mb-1">Client Email</label>
            <input type="email" id="cw-new-email" placeholder="client@example.com"
              class="w-full bg-white/60 dark:bg-neutral-700/60 border border-neutral-200/50 dark:border-neutral-600/50 rounded-xl px-4 py-2 text-sm text-neutral-700 dark:text-neutral-300 placeholder-neutral-400 dark:placeholder-neutral-500 focus:bg-white/90 dark:focus:bg-neutral-700/90 focus:outline-none transition-all shadow-sm" />
          </div>
          <div>
            <label class="text-xs font-medium text-neutral-500 dark:text-neutral-400 block mb-1">Notes</label>
            <textarea id="cw-new-notes" rows="6" placeholder="Project context, requirements, scope..."
              class="w-full bg-white/60 dark:bg-neutral-700/60 border border-neutral-200/50 dark:border-neutral-600/50 rounded-xl px-4 py-2 text-sm text-neutral-700 dark:text-neutral-300 placeholder-neutral-400 dark:placeholder-neutral-500 focus:bg-white/90 dark:focus:bg-neutral-700/90 focus:outline-none transition-all shadow-sm resize-none"></textarea>
          </div>
        </div>
        <div class="flex justify-end gap-2 mt-4">
          <button onclick="window.cwHideCreateProject()"
            class="px-4 py-2.5 rounded-lg bg-white/60 dark:bg-neutral-700/60 border border-neutral-200/50 dark:border-neutral-600/50 text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:bg-white/90 dark:hover:bg-neutral-700/90 transition-all shadow-sm">
            Cancel
          </button>
          <button onclick="window.cwCreateProject()"
            class="px-4 py-2.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm">
            Create
          </button>
        </div>
      </div>
    </div>

    <script>
      window.cwShowCreateProject = function() {
        document.getElementById('cw-create-modal').classList.remove('hidden');
        setTimeout(() => document.getElementById('cw-new-name').focus(), 100);
      };
      window.cwHideCreateProject = function() {
        document.getElementById('cw-create-modal').classList.add('hidden');
      };
      window.cwCreateProject = async function() {
        const name = document.getElementById('cw-new-name').value.trim();
        if (!name) { document.getElementById('cw-new-name').focus(); return; }
        const clientName = document.getElementById('cw-new-client-name').value.trim();
        const email = document.getElementById('cw-new-email').value.trim();
        const notes = document.getElementById('cw-new-notes').value.trim();
        await window.api.plugins.sendEvent('cw:create-project', { name, clientName: clientName || null, clientEmail: email || null, notes: notes || null });
        window.cwHideCreateProject();
        if (window.AppRouter) window.AppRouter.navigatePlugin('client-workspace');
      };
      window.cwSelectProject = async function(id) {
        await window.api.plugins.sendEvent('cw:select-project', { id });
        if (window.AppRouter) window.AppRouter.navigatePlugin('client-workspace');
      };
    </script>
  `;
}


/**
 * Render the project detail view with full document CRUD.
 */
function renderProjectDetail(project) {
  const documents = cwDb.getDocumentsForProject(project.id);
  const timeline = cwDb.getTimeline(project.id, 20);

  const docRows = documents.map(d => {
    const statusLabel = d.status === 'final' ? 'final' : 'draft';
    const statusClass = d.status === 'final'
      ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
      : 'bg-neutral-100 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-400';
    return `
      <div class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-xl p-3 hover:bg-white/80 dark:hover:bg-neutral-700/60 transition-all group">
        <div class="flex items-center justify-between">
          <span class="text-sm font-medium text-neutral-900 dark:text-neutral-100 cursor-pointer flex-1 truncate" onclick="window.cwOpenDocument('${d.id}')">${d.title}</span>
          <div class="flex items-center gap-1.5">
            <span class="text-[10px] px-2 py-0.5 rounded-full ${statusClass}">${statusLabel}</span>
            <button onclick="window.cwToggleDocStatus('${d.id}', '${d.status === 'final' ? 'draft' : 'final'}')" title="Toggle status"
              class="opacity-0 group-hover:opacity-100 p-1 rounded text-neutral-400 dark:text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 transition-all">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </button>
            <button onclick="window.cwDeleteDocument('${d.id}', '${d.title.replace(/'/g, "\\'")}')" title="Delete"
              class="opacity-0 group-hover:opacity-100 p-1 rounded text-neutral-400 dark:text-neutral-500 hover:text-rose-500 dark:hover:text-rose-400 transition-all">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </div>
        <div class="text-xs text-neutral-500 dark:text-neutral-400 mt-1">${d.updated_at?.split('T')[0] || ''}</div>
      </div>`;
  }).join('');

  const timelineRows = timeline.map(t => `
    <div class="flex gap-2 text-xs py-1.5 border-b border-neutral-100 dark:border-neutral-700/50 last:border-0">
      <span class="text-neutral-400 dark:text-neutral-500 whitespace-nowrap">${t.created_at?.split('T')[0] || ''}</span>
      <span class="text-neutral-700 dark:text-neutral-300">${t.summary}</span>
    </div>
  `).join('');

  return `
    <div class="p-6 space-y-6">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <button onclick="window.cwDeselectProject()"
            class="text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <h2 class="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">${project.name}</h2>
        </div>
        <div class="flex gap-2">
          <button onclick="window.cwEditProject('${project.id}')"
            class="px-3 py-2 rounded-lg bg-white/60 dark:bg-neutral-700/60 border border-neutral-200/50 dark:border-neutral-600/50 text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:bg-white/90 dark:hover:bg-neutral-700/90 transition-all">
            Edit
          </button>
          <button onclick="window.cwArchiveProject('${project.id}')"
            class="px-3 py-2 rounded-lg bg-white/60 dark:bg-neutral-700/60 border border-neutral-200/50 dark:border-neutral-600/50 text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:bg-white/90 dark:hover:bg-neutral-700/90 transition-all">
            Archive
          </button>
          <button onclick="window.cwDeleteProject('${project.id}', '${project.name.replace(/'/g, "\\'")}')"
            class="px-3 py-2 rounded-lg bg-white/60 dark:bg-neutral-700/60 border border-neutral-200/50 dark:border-neutral-600/50 text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-all">
            Delete
          </button>
        </div>
      </div>

      ${project.notes ? `<p class="text-sm text-neutral-500 dark:text-neutral-400">${project.notes}</p>` : ''}
      ${project.client_name ? `<p class="text-xs text-neutral-400 dark:text-neutral-500">Client: ${project.client_name}${project.client_email ? ' (' + project.client_email + ')' : ''}</p>` : (project.client_email ? `<p class="text-xs text-neutral-400 dark:text-neutral-500">Client: ${project.client_email}</p>` : '')}

      <!-- Tabs -->
      <div class="flex gap-1 border-b border-neutral-200/40 dark:border-neutral-700/40">
        <button onclick="window.cwSwitchTab('docs')" id="cw-tab-docs" class="cw-tab px-4 py-2 text-sm font-medium text-neutral-900 dark:text-neutral-100 border-b-2 border-neutral-900 dark:border-neutral-100">Documents</button>
        <button onclick="window.cwSwitchTab('comms')" id="cw-tab-comms" class="cw-tab px-4 py-2 text-sm font-medium text-neutral-500 dark:text-neutral-400 border-b-2 border-transparent hover:text-neutral-700 dark:hover:text-neutral-300">Comms</button>
        <button onclick="window.cwSwitchTab('timeline')" id="cw-tab-timeline" class="cw-tab px-4 py-2 text-sm font-medium text-neutral-500 dark:text-neutral-400 border-b-2 border-transparent hover:text-neutral-700 dark:hover:text-neutral-300">Timeline</button>
      </div>

      <!-- Documents Tab -->
      <div id="cw-panel-docs" class="cw-panel">
        <div class="space-y-2">
          ${docRows || '<p class="text-sm text-neutral-500 dark:text-neutral-400">No documents yet. Save an AI response from chat to create one.</p>'}
        </div>
      </div>

      <!-- Comms Tab -->
      <div id="cw-panel-comms" class="cw-panel hidden">
        ${renderCommsSection(project)}
      </div>

      <!-- Timeline Tab -->
      <div id="cw-panel-timeline" class="cw-panel hidden">
        <div class="max-h-64 overflow-auto rounded-xl border border-neutral-200/40 dark:border-neutral-700/40 p-3 bg-white/30 dark:bg-neutral-800/30">
          ${timelineRows || '<p class="text-sm text-neutral-500 dark:text-neutral-400">No activity yet.</p>'}
        </div>
      </div>
    </div>

    <!-- Document Viewer/Editor Modal -->
    <div id="cw-doc-viewer" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div class="bg-white/95 dark:bg-neutral-800/95 backdrop-blur-xl border border-neutral-200/60 dark:border-neutral-700/60 rounded-2xl w-full max-w-2xl h-[75vh] shadow-xl flex flex-col overflow-hidden">
        <div class="flex items-center justify-between px-5 py-3 border-b border-neutral-200/40 dark:border-neutral-700/40 shrink-0">
          <input id="cw-doc-title-input" type="text" class="text-sm font-semibold text-neutral-900 dark:text-neutral-100 bg-transparent border-none outline-none flex-1 mr-3 placeholder-neutral-400" placeholder="Document title" />
          <div class="flex items-center gap-2 shrink-0">
            <button id="cw-doc-save" class="px-3 py-1.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-xs font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all">Save</button>
            <button id="cw-doc-copy" class="px-3 py-1.5 rounded-lg bg-white/60 dark:bg-neutral-700/60 border border-neutral-200/50 dark:border-neutral-600/50 text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:bg-white/90 dark:hover:bg-neutral-700/90 transition-all">Copy</button>
            <button id="cw-doc-close" class="px-3 py-1.5 rounded-lg bg-white/60 dark:bg-neutral-700/60 border border-neutral-200/50 dark:border-neutral-600/50 text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:bg-white/90 dark:hover:bg-neutral-700/90 transition-all">Close</button>
          </div>
        </div>
        <textarea id="cw-doc-content" class="flex-1 overflow-y-auto p-5 text-sm text-neutral-800 dark:text-neutral-200 bg-transparent border-none outline-none resize-none w-full min-h-[400px]" placeholder="Document content..."></textarea>
      </div>
    </div>

    <!-- Edit Project Modal -->
    <div id="cw-edit-project-modal" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm">
      <div class="bg-white/90 dark:bg-neutral-800/90 backdrop-blur-xl border border-neutral-200/60 dark:border-neutral-700/60 rounded-2xl p-6 w-full max-w-md shadow-xl">
        <h3 class="text-base font-semibold text-neutral-900 dark:text-neutral-100 mb-4">Edit Project</h3>
        <div class="space-y-3">
          <div>
            <label class="text-xs font-medium text-neutral-500 dark:text-neutral-400 block mb-1">Project Name *</label>
            <input type="text" id="cw-edit-name" value="${project.name}"
              class="w-full bg-white/60 dark:bg-neutral-700/60 border border-neutral-200/50 dark:border-neutral-600/50 rounded-xl px-4 py-2 text-sm text-neutral-700 dark:text-neutral-300 placeholder-neutral-400 focus:bg-white/90 dark:focus:bg-neutral-700/90 focus:outline-none transition-all shadow-sm" />
          </div>
          <div>
            <label class="text-xs font-medium text-neutral-500 dark:text-neutral-400 block mb-1">Client Email</label>
            <input type="email" id="cw-edit-email" value="${project.client_email || ''}"
              class="w-full bg-white/60 dark:bg-neutral-700/60 border border-neutral-200/50 dark:border-neutral-600/50 rounded-xl px-4 py-2 text-sm text-neutral-700 dark:text-neutral-300 placeholder-neutral-400 focus:bg-white/90 dark:focus:bg-neutral-700/90 focus:outline-none transition-all shadow-sm" />
          </div>
          <div>
            <label class="text-xs font-medium text-neutral-500 dark:text-neutral-400 block mb-1">Notes</label>
            <textarea id="cw-edit-notes" rows="3"
              class="w-full bg-white/60 dark:bg-neutral-700/60 border border-neutral-200/50 dark:border-neutral-600/50 rounded-xl px-4 py-2 text-sm text-neutral-700 dark:text-neutral-300 placeholder-neutral-400 focus:bg-white/90 dark:focus:bg-neutral-700/90 focus:outline-none transition-all shadow-sm resize-none">${project.notes || ''}</textarea>
          </div>
        </div>
        <div class="flex justify-end gap-2 mt-4">
          <button onclick="document.getElementById('cw-edit-project-modal').classList.add('hidden')"
            class="px-4 py-2.5 rounded-lg bg-white/60 dark:bg-neutral-700/60 border border-neutral-200/50 dark:border-neutral-600/50 text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:bg-white/90 dark:hover:bg-neutral-700/90 transition-all shadow-sm">
            Cancel
          </button>
          <button onclick="window.cwSaveProjectEdit('${project.id}')"
            class="px-4 py-2.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm">
            Save
          </button>
        </div>
      </div>
    </div>

    <script>
      window._cwCurrentDocId = null;

      window.cwSwitchTab = function(tab) {
        document.querySelectorAll('.cw-panel').forEach(p => p.classList.add('hidden'));
        document.querySelectorAll('.cw-tab').forEach(t => {
          t.classList.remove('text-neutral-900', 'dark:text-neutral-100', 'border-neutral-900', 'dark:border-neutral-100');
          t.classList.add('text-neutral-500', 'dark:text-neutral-400', 'border-transparent');
        });
        document.getElementById('cw-panel-' + tab).classList.remove('hidden');
        const activeTab = document.getElementById('cw-tab-' + tab);
        activeTab.classList.remove('text-neutral-500', 'dark:text-neutral-400', 'border-transparent');
        activeTab.classList.add('text-neutral-900', 'dark:text-neutral-100', 'border-neutral-900', 'dark:border-neutral-100');
      };

      ${getCommsScript()}

      window.cwDeselectProject = async function() {
        await window.api.plugins.sendEvent('cw:deselect-project', {});
        if (window.AppRouter) window.AppRouter.navigatePlugin('client-workspace');
      };
      window.cwArchiveProject = async function(id) {
        if (!confirm('Archive this project?')) return;
        await window.api.plugins.sendEvent('cw:archive-project', { id });
        if (window.AppRouter) window.AppRouter.navigatePlugin('client-workspace');
      };
      window.cwDeleteProject = async function(id, name) {
        if (!confirm('Permanently delete "' + name + '" and all its documents? This cannot be undone.')) return;
        await window.api.plugins.sendEvent('cw:delete-project', { id });
        if (window.AppRouter) window.AppRouter.navigatePlugin('client-workspace');
      };
      window.cwEditProject = function(id) {
        document.getElementById('cw-edit-project-modal').classList.remove('hidden');
        setTimeout(() => document.getElementById('cw-edit-name').focus(), 100);
      };
      window.cwSaveProjectEdit = async function(id) {
        const name = document.getElementById('cw-edit-name').value.trim();
        if (!name) return;
        const clientEmail = document.getElementById('cw-edit-email').value.trim();
        const notes = document.getElementById('cw-edit-notes').value.trim();
        await window.api.plugins.sendEvent('cw:update-project', { id, name, clientEmail: clientEmail || null, notes: notes || null });
        document.getElementById('cw-edit-project-modal').classList.add('hidden');
        if (window.AppRouter) window.AppRouter.navigatePlugin('client-workspace');
      };
      window.cwOpenDocument = async function(id) {
        const doc = await window.api.plugins.sendEvent('cw:open-document', { id });
        if (!doc) return;
        window._cwCurrentDocId = id;
        const viewer = document.getElementById('cw-doc-viewer');
        const titleInput = document.getElementById('cw-doc-title-input');
        const contentEl = document.getElementById('cw-doc-content');
        const saveBtn = document.getElementById('cw-doc-save');
        const copyBtn = document.getElementById('cw-doc-copy');
        const closeBtn = document.getElementById('cw-doc-close');
        titleInput.value = doc.title || '';
        contentEl.value = doc.content || '';
        viewer.classList.remove('hidden');
        closeBtn.onclick = () => { viewer.classList.add('hidden'); window._cwCurrentDocId = null; };
        viewer.onclick = (e) => { if (e.target === viewer) { viewer.classList.add('hidden'); window._cwCurrentDocId = null; } };
        copyBtn.onclick = () => {
          navigator.clipboard.writeText(contentEl.value || '');
          copyBtn.textContent = 'Copied';
          setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
        };
        saveBtn.onclick = async () => {
          const newTitle = titleInput.value.trim();
          const newContent = contentEl.value;
          if (!newTitle) { titleInput.focus(); return; }
          await window.api.plugins.sendEvent('cw:update-document', { id: window._cwCurrentDocId, title: newTitle, content: newContent });
          saveBtn.textContent = 'Saved';
          setTimeout(() => { saveBtn.textContent = 'Save'; }, 1500);
          if (window.AppRouter) window.AppRouter.navigatePlugin('client-workspace');
        };
      };
      window.cwToggleDocStatus = async function(id, newStatus) {
        await window.api.plugins.sendEvent('cw:update-document', { id, status: newStatus });
        if (window.AppRouter) window.AppRouter.navigatePlugin('client-workspace');
      };
      window.cwDeleteDocument = async function(id, title) {
        if (!confirm('Delete document "' + title + '"?')) return;
        await window.api.plugins.sendEvent('cw:delete-document', { id });
        if (window.AppRouter) window.AppRouter.navigatePlugin('client-workspace');
      };
    </script>
  `;
}

/**
 * Render the settings panel.
 */
function renderSettings(activeProjectId) {
  const stats = cwDb.getStats();
  const activeProject = activeProjectId ? cwDb.getProject(activeProjectId) : null;

  return `
    <div class="space-y-4">
      <p class="text-sm text-neutral-500 dark:text-neutral-400">
        Client Workspace helps you manage projects, save AI-generated documents,
        and track work timelines. All data is stored locally.
      </p>

      <div class="grid grid-cols-2 gap-3 text-sm">
        <div class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-xl p-3">
          <div class="text-2xl font-bold text-neutral-900 dark:text-neutral-100">${stats.projects}</div>
          <div class="text-xs text-neutral-500 dark:text-neutral-400">Projects</div>
        </div>
        <div class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-xl p-3">
          <div class="text-2xl font-bold text-neutral-900 dark:text-neutral-100">${stats.documents}</div>
          <div class="text-xs text-neutral-500 dark:text-neutral-400">Documents</div>
        </div>
        <div class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-xl p-3">
          <div class="text-2xl font-bold text-neutral-900 dark:text-neutral-100">${stats.activeProjects}</div>
          <div class="text-xs text-neutral-500 dark:text-neutral-400">Active</div>
        </div>
        <div class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-xl p-3">
          <div class="text-2xl font-bold text-neutral-900 dark:text-neutral-100">${stats.timeEntries}</div>
          <div class="text-xs text-neutral-500 dark:text-neutral-400">Time Entries</div>
        </div>
      </div>

      <div class="pt-2">
        <label class="text-xs font-medium text-neutral-500 dark:text-neutral-400 block mb-1">Active Project</label>
        <p class="text-sm text-neutral-900 dark:text-neutral-100">${activeProject ? activeProject.name : 'None selected'}</p>
      </div>

      <div class="pt-3 border-t border-neutral-200/40 dark:border-neutral-700/40">
        <p class="text-xs text-neutral-400 dark:text-neutral-500">
          Tip: Use /project [name] in chat to switch projects. Save AI responses
          using the save icon on message bubbles.
        </p>
      </div>
    </div>
  `;
}

module.exports = {
  renderProjectList,
  renderProjectDetail,
  renderSettings,
};
