// Client Workspace — Unified Kanban UI
// Shows all tasks marked on_kanban=1 across all projects in a 3-column board

const cwDb = require('./db');

const COLUMNS = [
  { id: 'todo', label: 'To Do' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'done', label: 'Done' },
];

/**
 * Render the unified kanban board (all projects).
 */
function renderKanbanSection() {
  const tasks = cwDb.getKanbanTasks();

  const columns = COLUMNS.map(col => {
    const colTasks = tasks.filter(t => t.status === col.id);
    const cards = colTasks.map(t => renderKanbanCard(t)).join('');
    const count = colTasks.length;

    return `
      <div class="flex-1 min-w-[200px] flex flex-col">
        <div class="flex items-center justify-between mb-2 px-1">
          <span class="text-xs font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">${col.label}</span>
          <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-400">${count}</span>
        </div>
        <div class="flex-1 space-y-2 min-h-[120px] p-2 rounded-xl bg-neutral-50/50 dark:bg-neutral-800/30 border border-neutral-200/30 dark:border-neutral-700/30"
          id="cw-kanban-col-${col.id}"
          ondragover="event.preventDefault(); this.classList.add('ring-2','ring-neutral-300','dark:ring-neutral-600')"
          ondragleave="this.classList.remove('ring-2','ring-neutral-300','dark:ring-neutral-600')"
          ondrop="window.cwKanbanDrop(event, '${col.id}'); this.classList.remove('ring-2','ring-neutral-300','dark:ring-neutral-600')">
          ${cards || '<p class="text-xs text-neutral-400 dark:text-neutral-500 text-center py-4">No tasks</p>'}
        </div>
      </div>`;
  }).join('');

  const emptyMsg = tasks.length === 0
    ? '<p class="text-sm text-neutral-500 dark:text-neutral-400 text-center py-6">No tasks on the kanban yet. Open a project and click the ★ icon on tasks to add them here.</p>'
    : '';

  return `
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <div>
          <h3 class="text-sm font-medium text-neutral-700 dark:text-neutral-300">Unified Kanban</h3>
          <p class="text-xs text-neutral-400 dark:text-neutral-500">Tasks from all projects — drag to change status</p>
        </div>
        <span class="text-xs text-neutral-500 dark:text-neutral-400">${tasks.length} task${tasks.length !== 1 ? 's' : ''}</span>
      </div>
      ${emptyMsg}
      ${tasks.length > 0 ? `<div class="flex gap-3 overflow-x-auto">${columns}</div>` : ''}
    </div>
  `;
}

function renderKanbanCard(task) {
  const dueStr = task.due_date
    ? `<span class="text-[10px] text-neutral-400 dark:text-neutral-500">${task.due_date}</span>`
    : '';
  const descStr = task.description
    ? `<p class="text-xs text-neutral-500 dark:text-neutral-400 mt-1 line-clamp-2">${escHtml(task.description)}</p>`
    : '';
  const projectLabel = task.project_name
    ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-400">${escHtml(task.project_name)}</span>`
    : '';

  return `
    <div class="bg-white/70 dark:bg-neutral-700/50 border border-neutral-200/40 dark:border-neutral-600/40 rounded-xl p-3 cursor-grab group transition-all hover:shadow-sm"
      draggable="true"
      ondragstart="window.cwKanbanDrag(event, '${task.id}')"
      id="cw-kanban-task-${task.id}">
      <div class="flex items-start justify-between gap-1">
        <span class="text-sm font-medium text-neutral-900 dark:text-neutral-100 flex-1">${escHtml(task.title)}</span>
        <button onclick="window.cwKanbanRemove('${task.id}')" title="Remove from Kanban"
          class="opacity-0 group-hover:opacity-100 p-0.5 rounded text-neutral-400 hover:text-rose-500 dark:hover:text-rose-400 transition-all shrink-0">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      ${descStr}
      <div class="flex items-center gap-2 mt-1.5">
        ${projectLabel}
        ${dueStr}
      </div>
    </div>`;
}

/**
 * Returns the script block for kanban interactions.
 */
function getKanbanScript() {
  return `
    window._cwKanbanDragId = null;

    window.cwKanbanDrag = function(event, taskId) {
      window._cwKanbanDragId = taskId;
      event.dataTransfer.effectAllowed = 'move';
      event.target.style.opacity = '0.5';
      setTimeout(() => { event.target.style.opacity = '1'; }, 0);
    };
    window.cwKanbanDrop = async function(event, newStatus) {
      event.preventDefault();
      const taskId = window._cwKanbanDragId;
      if (!taskId) return;
      await window.api.plugins.sendEvent('cw:update-task', { id: taskId, status: newStatus });
      window._cwKanbanDragId = null;
      if (window.AppRouter) window.AppRouter.navigatePlugin('client-workspace', 'kanban');
    };
    window.cwKanbanRemove = async function(id) {
      await window.api.plugins.sendEvent('cw:toggle-task-kanban', { id, onKanban: 0 });
      if (window.AppRouter) window.AppRouter.navigatePlugin('client-workspace', 'kanban');
    };
  `;
}

function escHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = { renderKanbanSection, getKanbanScript };
