// Client Workspace — Files Tab UI (Rewritten)
// Shows the project's files/ folder path, lists files, and provides Scan & Index.
// No folder connection UI — users simply move files into the project's files/ directory.

const path = require('path');
const fs = require('fs');
const os = require('os');

const SUPPORTED_EXTS = ['.txt', '.md', '.pdf', '.docx', '.csv'];

/**
 * Get the files/ directory path for a project.
 */
function getProjectFilesDir(projectId) {
  return path.join(os.homedir(), 'Documents', 'IIMAGINE', 'projects', projectId, 'files');
}

/**
 * Render the files section for a project.
 */
function renderFilesSection(project) {
  const filesDir = getProjectFilesDir(project.id);
  // Ensure the directory exists for display
  fs.mkdirSync(filesDir, { recursive: true });

  const files = getFilesInDir(filesDir);

  const fileRows = files.length > 0
    ? files.map(f => {
        const supported = SUPPORTED_EXTS.includes(f.ext);
        const dotClass = supported ? 'bg-emerald-400' : 'bg-neutral-300';
        return `
          <div class="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-white/40 transition-all">
            <span class="w-2 h-2 rounded-full ${dotClass} shrink-0"></span>
            <span class="text-sm font-medium text-neutral-900 truncate flex-1">${escHtml(f.name)}</span>
            <span class="text-xs text-neutral-400 shrink-0 w-14 text-right">${formatSize(f.size)}</span>
            <span class="text-xs text-neutral-400 shrink-0 w-12 text-right">${f.ext || '—'}</span>
            <span class="text-xs text-neutral-400 shrink-0 w-20 text-right">${formatDate(f.modified)}</span>
          </div>`;
      }).join('')
    : `<p class="text-sm text-neutral-500 py-4 text-center">No files yet. Move your project files here.</p>`;

  return `
    <div class="space-y-4">
      <!-- Path display -->
      <div class="bg-white/50 border border-neutral-200/40 rounded-2xl p-4">
        <div class="flex items-center gap-2">
          <iconify-icon icon="solar:folder-open-linear" class="text-lg text-neutral-500"></iconify-icon>
          <button onclick="window.cwOpenFilesFolder('${escAttr(filesDir)}')"
            class="text-sm font-medium text-neutral-900 hover:text-blue-600 transition-colors underline decoration-neutral-300 hover:decoration-blue-400 text-left truncate">
            ${escHtml(filesDir)}
          </button>
        </div>
        <p class="text-xs text-neutral-500 mt-2">
          Move your project files here. Click <strong>Scan &amp; Index</strong> for the AI to read them.
        </p>
      </div>

      <!-- Scan & Index controls -->
      <div class="flex items-center justify-between">
        <div id="cw-scan-status" class="flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-neutral-300"></span>
          <span class="text-xs text-neutral-500">Loading scan status...</span>
        </div>
        <button id="cw-scan-btn" onclick="window.cwScanIndexFiles('${escAttr(project.id)}')"
          class="px-4 py-2.5 rounded-lg bg-neutral-900 text-sm font-medium text-white hover:bg-neutral-800 transition-all shadow-sm">
          Scan &amp; Index
        </button>
      </div>

      <!-- Supported types note -->
      <div class="bg-white/40 border border-neutral-200/30 rounded-xl p-3">
        <p class="text-xs text-neutral-500">
          <strong class="text-neutral-700">Indexable types:</strong> .txt, .md, .pdf, .docx, .csv
        </p>
        <p class="text-[10px] text-neutral-400 mt-1">
          Other file types are listed but won't be indexed for AI search.
        </p>
      </div>

      <!-- File list -->
      <div class="bg-white/50 border border-neutral-200/40 rounded-2xl overflow-hidden">
        <div class="flex items-center gap-3 py-2 px-3 border-b border-neutral-200/30">
          <span class="w-2 h-2 shrink-0"></span>
          <span class="text-[10px] font-medium uppercase tracking-wider text-neutral-400 flex-1">Name</span>
          <span class="text-[10px] font-medium uppercase tracking-wider text-neutral-400 shrink-0 w-14 text-right">Size</span>
          <span class="text-[10px] font-medium uppercase tracking-wider text-neutral-400 shrink-0 w-12 text-right">Type</span>
          <span class="text-[10px] font-medium uppercase tracking-wider text-neutral-400 shrink-0 w-20 text-right">Modified</span>
        </div>
        <div class="max-h-72 overflow-y-auto divide-y divide-neutral-200/20">
          ${fileRows}
        </div>
      </div>
    </div>
  `;
}

/**
 * Get all files in the files/ directory (non-recursive, top-level only).
 */
function getFilesInDir(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter(e => e.isFile() && !e.name.startsWith('.'))
    .map(e => {
      const fullPath = path.join(dirPath, e.name);
      let stat;
      try { stat = fs.statSync(fullPath); } catch { return null; }
      return {
        name: e.name,
        ext: path.extname(e.name).toLowerCase(),
        size: stat.size,
        modified: stat.mtime.toISOString(),
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.modified) - new Date(a.modified));
}

/**
 * Returns the script block for files interactions.
 */
function getFilesScript() {
  return `
    window.cwOpenFilesFolder = function(folderPath) {
      window.api.shell.openPath(folderPath);
    };
    window.cwScanIndexFiles = async function(projectId) {
      const btn = document.getElementById('cw-scan-btn');
      if (btn) { btn.disabled = true; btn.textContent = 'Scanning...'; }
      try {
        const result = await window.api.plugins.sendEvent('cw:scan-index-files', { projectId });
        if (result && result.success) {
          if (btn) btn.textContent = 'Done ✓';
          setTimeout(() => {
            if (window.AppRouter) window.AppRouter.navigatePlugin('client-workspace', 'files');
          }, 800);
        } else {
          if (btn) { btn.textContent = 'Error'; }
          setTimeout(() => { if (btn) { btn.textContent = 'Scan & Index'; btn.disabled = false; } }, 2000);
        }
      } catch (err) {
        if (btn) { btn.textContent = 'Error'; }
        setTimeout(() => { if (btn) { btn.textContent = 'Scan & Index'; btn.disabled = false; } }, 2000);
      }
    };
    // Load scan status when files tab is shown
    window.cwLoadScanStatus = async function(projectId) {
      const el = document.getElementById('cw-scan-status');
      if (!el) return;
      try {
        const result = await window.api.plugins.sendEvent('cw:get-project-files', { projectId });
        if (result && result.lastScan) {
          const d = new Date(result.lastScan.time);
          const timeStr = d.toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
          el.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-400"></span><span class="text-xs text-neutral-500">Last scan: ' + timeStr + ' — ' + result.lastScan.count + ' file' + (result.lastScan.count !== 1 ? 's' : '') + ' indexed</span>';
        } else {
          el.innerHTML = '<span class="w-2 h-2 rounded-full bg-neutral-300"></span><span class="text-xs text-neutral-500">Not yet scanned</span>';
        }
      } catch {
        el.innerHTML = '<span class="w-2 h-2 rounded-full bg-neutral-300"></span><span class="text-xs text-neutral-500">Not yet scanned</span>';
      }
    };
  `;
}

// ── Helpers ─────────────────────────────────────────────────────

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatDate(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

function escHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escAttr(str) {
  return (str || '').replace(/'/g, "\\'").replace(/\\/g, '\\\\');
}

module.exports = { renderFilesSection, getFilesScript };
