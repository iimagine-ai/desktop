// Client Workspace — Notes UI
// Renders the Notes tab: list .md files from disk, create/edit/delete notes.

const os = require('os');
const path = require('path');

function escHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  return `${month}/${day} ${hours}:${mins}`;
}

/**
 * Render the notes section for a project.
 */
function renderNotesSection(project) {
  const notesPath = path.join(os.homedir(), 'Documents', 'IIMAGINE', 'projects', project.id, 'notes');

  return `
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <span class="text-xs text-neutral-500 dark:text-neutral-400">Markdown notes stored on disk</span>
        <button onclick="window.cwShowNewNote()"
          class="px-4 py-2.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm">
          + New Note
        </button>
      </div>

      <!-- New Note Form (hidden by default) -->
      <div id="cw-new-note-form" class="hidden bg-white/60 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-xl p-4 space-y-3">
        <input type="text" id="cw-note-title" placeholder="Note title"
          class="w-full bg-white/60 dark:bg-neutral-700/60 border border-neutral-200/50 dark:border-neutral-600/50 rounded-xl px-4 py-2 text-sm text-neutral-700 dark:text-neutral-300 placeholder-neutral-400 dark:placeholder-neutral-500 focus:outline-none transition-all" />
        <textarea id="cw-note-content" rows="6" placeholder="Write your note in markdown..."
          class="w-full bg-white/60 dark:bg-neutral-700/60 border border-neutral-200/50 dark:border-neutral-600/50 rounded-xl px-4 py-2 text-sm text-neutral-700 dark:text-neutral-300 placeholder-neutral-400 dark:placeholder-neutral-500 focus:outline-none transition-all resize-none"></textarea>
        <div class="flex justify-end gap-2">
          <button onclick="window.cwHideNewNote()"
            class="px-3 py-2 rounded-lg bg-white/60 dark:bg-neutral-700/60 border border-neutral-200/50 dark:border-neutral-600/50 text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:bg-white/90 dark:hover:bg-neutral-700/90 transition-all">Cancel</button>
          <button onclick="window.cwCreateNote('${project.id}')"
            class="px-3 py-2 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-xs font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all">Save Note</button>
        </div>
      </div>

      <!-- Notes List -->
      <div id="cw-notes-list" class="space-y-2">
        <p class="text-xs text-neutral-400 dark:text-neutral-500">Loading notes...</p>
      </div>

      <!-- Folder Path -->
      <div class="pt-2 border-t border-neutral-200/30 dark:border-neutral-700/30">
        <p class="text-[10px] text-neutral-400 dark:text-neutral-500">
          <span class="cursor-pointer hover:text-neutral-600 dark:hover:text-neutral-300 underline" onclick="window.cwOpenNotesFolder('${project.id}')">${escHtml(notesPath)}</span>
          <span class="ml-1 opacity-60">— click to open in Finder</span>
        </p>
      </div>
    </div>

    <!-- Note Editor Modal -->
    <div id="cw-note-editor" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div class="bg-white/95 dark:bg-neutral-800/95 backdrop-blur-xl border border-neutral-200/60 dark:border-neutral-700/60 rounded-2xl w-full max-w-2xl h-[75vh] shadow-xl flex flex-col overflow-hidden">
        <div class="flex items-center justify-between px-5 py-3 border-b border-neutral-200/40 dark:border-neutral-700/40 shrink-0">
          <span id="cw-note-editor-title" class="text-sm font-semibold text-neutral-900 dark:text-neutral-100 truncate"></span>
          <div class="flex items-center gap-2 shrink-0">
            <button onclick="window.cwSaveEditNote()" class="px-3 py-1.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-xs font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all">Save</button>
            <button onclick="window.cwDeleteNote()" class="px-3 py-1.5 rounded-lg bg-white/60 dark:bg-neutral-700/60 border border-neutral-200/50 dark:border-neutral-600/50 text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-all">Delete</button>
            <button onclick="window.cwCloseNoteEditor()" class="px-3 py-1.5 rounded-lg bg-white/60 dark:bg-neutral-700/60 border border-neutral-200/50 dark:border-neutral-600/50 text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:bg-white/90 dark:hover:bg-neutral-700/90 transition-all">Close</button>
          </div>
        </div>
        <textarea id="cw-note-editor-content" class="flex-1 overflow-y-auto p-5 text-sm text-neutral-800 dark:text-neutral-200 bg-transparent border-none outline-none resize-none w-full font-mono" placeholder="Note content..."></textarea>
      </div>
    </div>
  `;
}

/**
 * Returns the script block for notes functionality.
 */
function getNotesScript() {
  return `
    window._cwNoteProjectId = null;
    window._cwNoteFilename = null;

    window.cwShowNewNote = function() {
      document.getElementById('cw-new-note-form').classList.remove('hidden');
      setTimeout(() => document.getElementById('cw-note-title').focus(), 100);
    };
    window.cwHideNewNote = function() {
      document.getElementById('cw-new-note-form').classList.add('hidden');
      document.getElementById('cw-note-title').value = '';
      document.getElementById('cw-note-content').value = '';
    };
    window.cwCreateNote = async function(projectId) {
      const title = document.getElementById('cw-note-title').value.trim();
      if (!title) { document.getElementById('cw-note-title').focus(); return; }
      const content = document.getElementById('cw-note-content').value;
      const result = await window.api.plugins.sendEvent('cw:create-note', { projectId, title, content });
      if (result && result.success) {
        window.cwHideNewNote();
        window.cwLoadNotes(projectId);
      } else {
        alert(result?.error || 'Failed to create note');
      }
    };
    window.cwLoadNotes = async function(projectId) {
      window._cwNoteProjectId = projectId;
      const container = document.getElementById('cw-notes-list');
      if (!container) return;
      const notes = await window.api.plugins.sendEvent('cw:get-notes', { projectId });
      if (!notes || notes.length === 0) {
        container.innerHTML = '<p class="text-sm text-neutral-500 dark:text-neutral-400">No notes yet. Create one to get started.</p>';
        return;
      }
      container.innerHTML = notes.map(function(n) {
        const modified = n.modified ? new Date(n.modified) : null;
        const dateStr = modified ? (String(modified.getMonth()+1).padStart(2,'0') + '/' + String(modified.getDate()).padStart(2,'0') + ' ' + String(modified.getHours()).padStart(2,'0') + ':' + String(modified.getMinutes()).padStart(2,'0')) : '';
        const preview = (n.preview || '').substring(0, 100);
        return '<div class="bg-white/60 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-xl p-3 hover:bg-white/80 dark:hover:bg-neutral-700/60 transition-all cursor-pointer" onclick="window.cwOpenNote(\\'' + n.filename + '\\')">' +
          '<div class="flex items-center justify-between mb-1">' +
          '<span class="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate">' + n.title + '</span>' +
          '<span class="text-[10px] text-neutral-400 dark:text-neutral-500 shrink-0 ml-2">' + dateStr + '</span>' +
          '</div>' +
          '<p class="text-xs text-neutral-500 dark:text-neutral-400 line-clamp-2">' + preview + '</p>' +
          '</div>';
      }).join('');
    };
    window.cwOpenNote = async function(filename) {
      const note = await window.api.plugins.sendEvent('cw:get-note', { projectId: window._cwNoteProjectId, filename });
      if (!note) return;
      window._cwNoteFilename = filename;
      document.getElementById('cw-note-editor-title').textContent = note.title;
      document.getElementById('cw-note-editor-content').value = note.content || '';
      document.getElementById('cw-note-editor').classList.remove('hidden');
    };
    window.cwSaveEditNote = async function() {
      const content = document.getElementById('cw-note-editor-content').value;
      const result = await window.api.plugins.sendEvent('cw:update-note', { projectId: window._cwNoteProjectId, filename: window._cwNoteFilename, content });
      if (result && result.success) {
        window.cwCloseNoteEditor();
        window.cwLoadNotes(window._cwNoteProjectId);
      } else {
        alert(result?.error || 'Failed to save note');
      }
    };
    window.cwDeleteNote = async function() {
      if (!confirm('Delete this note? This cannot be undone.')) return;
      const result = await window.api.plugins.sendEvent('cw:delete-note', { projectId: window._cwNoteProjectId, filename: window._cwNoteFilename });
      if (result && result.success) {
        window.cwCloseNoteEditor();
        window.cwLoadNotes(window._cwNoteProjectId);
      }
    };
    window.cwCloseNoteEditor = function() {
      document.getElementById('cw-note-editor').classList.add('hidden');
      window._cwNoteFilename = null;
    };
    window.cwOpenNotesFolder = async function(projectId) {
      const notesPath = await window.api.plugins.sendEvent('cw:get-notes-path', { projectId });
      if (notesPath) window.api.shell.openPath(notesPath);
    };
  `;
}

module.exports = { renderNotesSection, getNotesScript };
