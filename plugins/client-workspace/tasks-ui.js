// Client Workspace — Tasks UI (Flat List with Pin-to-Kanban)
// Renders a simple task list with CRUD + a pin icon to add tasks to the unified kanban

const cwDb = require('./db');

const STATUS_LABELS = { todo: 'To Do', in_progress: 'In Progress', done: 'Done' };
const STATUS_COLORS = {
  todo: 'bg-neutral-100 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300',
  in_progress: 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',
  done: 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400',
};

/**
 * Render the task list for a project (flat list, not kanban).
 */
function renderTasksSection(project) {
  const tasks = cwDb.getTasks(project.id);

  const taskCards = tasks.map(t => {
    const statusLabel = STATUS_LABELS[t.status] || t.status;
    const statusClass = STATUS_COLORS[t.status] || STATUS_COLORS.todo;
    const dueStr = t.due_date ? `<span class="text-[10px] text-neutral-400 dark:text-neutral-500">${t.due_date}</span>` : '';
    const descStr = t.description
      ? `<p class="text-xs text-neutral-500 dark:text-neutral-400 mt-1 line-clamp-2">${escHtml(t.description)}</p>`
      : '';
    const pinned = t.on_kanban ? 1 : 0;
    const pinClass = pinned
      ? 'text-neutral-900 dark:text-neutral-100'
      : 'text-neutral-300 dark:text-neutral-600 hover:text-neutral-500 dark:hover:text-neutral-400';
    const pinTitle = pinned ? 'Remove from Kanban' : 'Add to Kanban';

    return `
      <div class="bg-white/60 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-xl p-3 group transition-all hover:bg-white/80 dark:hover:bg-neutral-700/60">
        <div class="flex items-start gap-2">
          <button onclick="window.cwToggleKanban('${t.id}', ${pinned ? 0 : 1})" title="${pinTitle}"
            class="mt-0.5 shrink-0 p-1 rounded transition-all ${pinClass}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="${pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/></svg>
          </button>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium text-neutral-900 dark:text-neutral-100 cursor-pointer truncate" onclick="window.cwEditTask('${t.id}')">${escHtml(t.title)}</span>
              <span class="text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${statusClass}">${statusLabel}</span>
            </div>
            ${descStr}
            ${dueStr}
          </div>
          <div class="flex items-center gap-0.5 shrink-0">
            <button onclick="window.cwEditTask('${t.id}')" title="Edit"
              class="opacity-0 group-hover:opacity-100 p-1 rounded text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300 transition-all">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button onclick="window.cwDeleteTask('${t.id}')" title="Delete"
              class="opacity-0 group-hover:opacity-100 p-1 rounded text-neutral-400 hover:text-rose-500 dark:hover:text-rose-400 transition-all">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>
      </div>`;
  }).join('');

  return `
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <span class="text-xs text-neutral-500 dark:text-neutral-400">${tasks.length} task${tasks.length !== 1 ? 's' : ''} · ★ = on kanban</span>
        <button onclick="window.cwShowTaskForm('${project.id}')"
          class="px-4 py-2.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm">
          + Add Task
        </button>
      </div>

      <!-- Add Task Form (hidden) -->
      <div id="cw-task-form" class="hidden bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-4 space-y-3">
        <div>
          <label class="text-xs font-medium text-neutral-500 dark:text-neutral-400 block mb-1">Title *</label>
          <input type="text" id="cw-task-title" placeholder="Task title..."
            class="w-full bg-white/60 dark:bg-neutral-700/60 border border-neutral-200/50 dark:border-neutral-600/50 rounded-xl px-4 py-2 text-sm text-neutral-700 dark:text-neutral-300 placeholder-neutral-400 dark:placeholder-neutral-500 focus:bg-white/90 dark:focus:bg-neutral-700/90 focus:outline-none transition-all shadow-sm" />
        </div>
        <div>
          <label class="text-xs font-medium text-neutral-500 dark:text-neutral-400 block mb-1">Description (optional)</label>
          <textarea id="cw-task-desc" rows="2" placeholder="Details..."
            class="w-full bg-white/60 dark:bg-neutral-700/60 border border-neutral-200/50 dark:border-neutral-600/50 rounded-xl px-4 py-2 text-sm text-neutral-700 dark:text-neutral-300 placeholder-neutral-400 dark:placeholder-neutral-500 focus:bg-white/90 dark:focus:bg-neutral-700/90 focus:outline-none transition-all shadow-sm resize-none"></textarea>
        </div>
        <div>
          <label class="text-xs font-medium text-neutral-500 dark:text-neutral-400 block mb-1">Due Date (optional)</label>
          <input type="date" id="cw-task-due"
            class="bg-white/60 dark:bg-neutral-700/60 border border-neutral-200/50 dark:border-neutral-600/50 rounded-xl px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300 focus:outline-none transition-all shadow-sm" />
        </div>
        <div class="flex justify-end gap-2">
          <button onclick="window.cwHideTaskForm()"
            class="px-4 py-2.5 rounded-lg bg-white/60 dark:bg-neutral-700/60 border border-neutral-200/50 dark:border-neutral-600/50 text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:bg-white/90 dark:hover:bg-neutral-700/90 transition-all shadow-sm">
            Cancel
          </button>
          <button onclick="window.cwCreateTask('${project.id}')"
            class="px-4 py-2.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm">
            Create
          </button>
        </div>
      </div>

      <!-- Edit Task Modal -->
      <div id="cw-task-edit-modal" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm">
        <div class="bg-white/90 dark:bg-neutral-800/90 backdrop-blur-xl border border-neutral-200/60 dark:border-neutral-700/60 rounded-2xl p-6 w-full max-w-md shadow-xl">
          <h3 class="text-base font-semibold text-neutral-900 dark:text-neutral-100 mb-4">Edit Task</h3>
          <div class="space-y-3">
            <div>
              <label class="text-xs font-medium text-neutral-500 dark:text-neutral-400 block mb-1">Title *</label>
              <input type="text" id="cw-task-edit-title"
                class="w-full bg-white/60 dark:bg-neutral-700/60 border border-neutral-200/50 dark:border-neutral-600/50 rounded-xl px-4 py-2 text-sm text-neutral-700 dark:text-neutral-300 focus:bg-white/90 dark:focus:bg-neutral-700/90 focus:outline-none transition-all shadow-sm" />
            </div>
            <div>
              <label class="text-xs font-medium text-neutral-500 dark:text-neutral-400 block mb-1">Description</label>
              <textarea id="cw-task-edit-desc" rows="3"
                class="w-full bg-white/60 dark:bg-neutral-700/60 border border-neutral-200/50 dark:border-neutral-600/50 rounded-xl px-4 py-2 text-sm text-neutral-700 dark:text-neutral-300 focus:bg-white/90 dark:focus:bg-neutral-700/90 focus:outline-none transition-all shadow-sm resize-none"></textarea>
            </div>
            <div>
              <label class="text-xs font-medium text-neutral-500 dark:text-neutral-400 block mb-1">Status</label>
              <select id="cw-task-edit-status"
                class="bg-white/60 dark:bg-neutral-700/60 border border-neutral-200/50 dark:border-neutral-600/50 rounded-xl px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300 focus:outline-none transition-all shadow-sm">
                <option value="todo">To Do</option>
                <option value="in_progress">In Progress</option>
                <option value="done">Done</option>
              </select>
            </div>
            <div>
              <label class="text-xs font-medium text-neutral-500 dark:text-neutral-400 block mb-1">Due Date</label>
              <input type="date" id="cw-task-edit-due"
                class="bg-white/60 dark:bg-neutral-700/60 border border-neutral-200/50 dark:border-neutral-600/50 rounded-xl px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300 focus:outline-none transition-all shadow-sm" />
            </div>
          </div>
          <div class="flex justify-between mt-4">
            <button onclick="window.cwDeleteTaskFromEdit()"
              class="px-4 py-2.5 rounded-lg bg-white/60 dark:bg-neutral-700/60 border border-neutral-200/50 dark:border-neutral-600/50 text-sm font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-all shadow-sm">
              Delete
            </button>
            <div class="flex gap-2">
              <button onclick="window.cwHideTaskEdit()"
                class="px-4 py-2.5 rounded-lg bg-white/60 dark:bg-neutral-700/60 border border-neutral-200/50 dark:border-neutral-600/50 text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:bg-white/90 dark:hover:bg-neutral-700/90 transition-all shadow-sm">
                Cancel
              </button>
              <button onclick="window.cwSaveTaskEdit()"
                class="px-4 py-2.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm">
                Save
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Task List -->
      <div class="space-y-2">
        ${taskCards || '<p class="text-sm text-neutral-500 dark:text-neutral-400">No tasks yet. Add one to get started.</p>'}
      </div>
    </div>
  `;
}

/**
 * Returns the script block for task interactions.
 */
function getTasksScript() {
  return `
    window._cwEditTaskId = null;

    window.cwShowTaskForm = function(projectId) {
      document.getElementById('cw-task-form').classList.remove('hidden');
      setTimeout(() => document.getElementById('cw-task-title').focus(), 100);
    };
    window.cwHideTaskForm = function() {
      document.getElementById('cw-task-form').classList.add('hidden');
      document.getElementById('cw-task-title').value = '';
      document.getElementById('cw-task-desc').value = '';
      document.getElementById('cw-task-due').value = '';
    };
    window.cwCreateTask = async function(projectId) {
      const title = document.getElementById('cw-task-title').value.trim();
      if (!title) { document.getElementById('cw-task-title').focus(); return; }
      const description = document.getElementById('cw-task-desc').value.trim() || null;
      const dueDate = document.getElementById('cw-task-due').value || null;
      await window.api.plugins.sendEvent('cw:create-task', { projectId, title, description, dueDate });
      window.cwHideTaskForm();
      if (window.AppRouter) window.AppRouter.navigatePlugin('client-workspace', 'tasks');
    };
    window.cwDeleteTask = async function(id) {
      if (!confirm('Delete this task?')) return;
      await window.api.plugins.sendEvent('cw:delete-task', { id });
      if (window.AppRouter) window.AppRouter.navigatePlugin('client-workspace', 'tasks');
    };
    window.cwToggleKanban = async function(id, onKanban) {
      await window.api.plugins.sendEvent('cw:toggle-task-kanban', { id, onKanban });
      if (window.AppRouter) window.AppRouter.navigatePlugin('client-workspace', 'tasks');
    };
    window.cwEditTask = async function(id) {
      const task = await window.api.plugins.sendEvent('cw:get-task', { id });
      if (!task) return;
      window._cwEditTaskId = id;
      document.getElementById('cw-task-edit-title').value = task.title || '';
      document.getElementById('cw-task-edit-desc').value = task.description || '';
      document.getElementById('cw-task-edit-status').value = task.status || 'todo';
      document.getElementById('cw-task-edit-due').value = task.due_date || '';
      document.getElementById('cw-task-edit-modal').classList.remove('hidden');
      setTimeout(() => document.getElementById('cw-task-edit-title').focus(), 100);
    };
    window.cwHideTaskEdit = function() {
      document.getElementById('cw-task-edit-modal').classList.add('hidden');
      window._cwEditTaskId = null;
    };
    window.cwSaveTaskEdit = async function() {
      const id = window._cwEditTaskId;
      if (!id) return;
      const title = document.getElementById('cw-task-edit-title').value.trim();
      if (!title) { document.getElementById('cw-task-edit-title').focus(); return; }
      const description = document.getElementById('cw-task-edit-desc').value.trim() || null;
      const status = document.getElementById('cw-task-edit-status').value || 'todo';
      const dueDate = document.getElementById('cw-task-edit-due').value || null;
      await window.api.plugins.sendEvent('cw:update-task', { id, title, description, status, dueDate });
      window.cwHideTaskEdit();
      if (window.AppRouter) window.AppRouter.navigatePlugin('client-workspace', 'tasks');
    };
    window.cwDeleteTaskFromEdit = async function() {
      const id = window._cwEditTaskId;
      if (!id) return;
      if (!confirm('Delete this task?')) return;
      await window.api.plugins.sendEvent('cw:delete-task', { id });
      window.cwHideTaskEdit();
      if (window.AppRouter) window.AppRouter.navigatePlugin('client-workspace', 'tasks');
    };
  `;
}

function escHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = { renderTasksSection, getTasksScript };
