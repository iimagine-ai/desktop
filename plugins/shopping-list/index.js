const crypto = require('crypto');

let db = null;
const TABLE = 'shopping_list_items';

function activate(context) {
  db = context.db;

  // Check if table exists with wrong schema from a previous AI-generated version
  const tableInfo = db.prepare(`PRAGMA table_info(${TABLE})`).all();
  if (tableInfo.length > 0) {
    const hasBought = tableInfo.some(col => col.name === 'bought');
    if (!hasBought) {
      // Old table exists with different columns — migrate it
      // Try to preserve any existing item names
      const hasName = tableInfo.some(col => col.name === 'name');
      const hasItem = tableInfo.some(col => col.name === 'item');
      const nameCol = hasName ? 'name' : hasItem ? 'item' : null;

      if (nameCol) {
        // Preserve data: rename old table, create new, copy data
        db.exec(`ALTER TABLE ${TABLE} RENAME TO ${TABLE}_old`);
        db.exec(`CREATE TABLE ${TABLE} (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          bought INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now'))
        )`);
        db.exec(`INSERT INTO ${TABLE} (id, name, bought) SELECT COALESCE(id, hex(randomblob(8))), ${nameCol}, 0 FROM ${TABLE}_old`);
        db.exec(`DROP TABLE ${TABLE}_old`);
      } else {
        // No recognizable name column — start fresh
        db.exec(`DROP TABLE ${TABLE}`);
        db.exec(`CREATE TABLE ${TABLE} (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          bought INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now'))
        )`);
      }
    }
  } else {
    db.exec(`CREATE TABLE ${TABLE} (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      bought INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )`);
  }
}

function deactivate() {
  db = null;
}

function onEvent(eventName, data) {
  if (eventName === 'shopping-list:get-items') {
    const items = db.prepare(`SELECT * FROM ${TABLE} ORDER BY bought ASC, created_at DESC`).all();
    return { items };
  }

  if (eventName === 'shopping-list:add-item') {
    const { name } = data;
    if (!name || !name.trim()) return { error: 'Item name is required' };
    const id = crypto.randomUUID();
    db.prepare(`INSERT INTO ${TABLE} (id, name) VALUES (?, ?)`).run(id, name.trim());
    const items = db.prepare(`SELECT * FROM ${TABLE} ORDER BY bought ASC, created_at DESC`).all();
    return { success: true, items };
  }

  if (eventName === 'shopping-list:toggle-item') {
    const { id } = data;
    db.prepare(`UPDATE ${TABLE} SET bought = CASE WHEN bought = 1 THEN 0 ELSE 1 END WHERE id = ?`).run(id);
    const items = db.prepare(`SELECT * FROM ${TABLE} ORDER BY bought ASC, created_at DESC`).all();
    return { success: true, items };
  }

  if (eventName === 'shopping-list:delete-item') {
    const { id } = data;
    db.prepare(`DELETE FROM ${TABLE} WHERE id = ?`).run(id);
    const items = db.prepare(`SELECT * FROM ${TABLE} ORDER BY bought ASC, created_at DESC`).all();
    return { success: true, items };
  }

  if (eventName === 'shopping-list:clear-bought') {
    db.prepare(`DELETE FROM ${TABLE} WHERE bought = 1`).run();
    const items = db.prepare(`SELECT * FROM ${TABLE} ORDER BY bought ASC, created_at DESC`).all();
    return { success: true, items };
  }

  if (eventName === 'shopping-list:reset-all') {
    db.prepare(`UPDATE ${TABLE} SET bought = 0`).run();
    const items = db.prepare(`SELECT * FROM ${TABLE} ORDER BY bought ASC, created_at DESC`).all();
    return { success: true, items };
  }

  return { error: 'Unknown event' };
}

function renderPage() {
  const items = db.prepare(`SELECT * FROM ${TABLE} ORDER BY bought ASC, created_at DESC`).all();
  const boughtCount = items.filter(i => i.bought).length;
  const totalCount = items.length;

  const itemsHtml = items.map(item => {
    const checked = item.bought ? 'checked' : '';
    const lineThrough = item.bought ? 'line-through opacity-50' : '';
    return `
      <div class="flex items-center gap-3 py-2.5 px-3 rounded-xl hover:bg-neutral-100/60 dark:hover:bg-neutral-700/30 transition-colors group">
        <input type="checkbox" ${checked} onchange="window.slToggle('${item.id}')"
          class="w-4.5 h-4.5 rounded-md border-neutral-300 dark:border-neutral-600 text-neutral-900 dark:text-neutral-100 focus:ring-neutral-500 cursor-pointer accent-neutral-700 dark:accent-neutral-300" />
        <span class="flex-1 text-sm text-neutral-800 dark:text-neutral-200 ${lineThrough}">${escapeHtml(item.name)}</span>
        <button onclick="window.slDelete('${item.id}')"
          class="opacity-0 group-hover:opacity-100 p-1 rounded-md text-neutral-400 hover:text-red-500 dark:hover:text-red-400 transition-all">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
        </button>
      </div>`;
  }).join('');

  const emptyState = totalCount === 0 ? `
    <div class="text-center py-12 text-neutral-400 dark:text-neutral-500">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" class="mx-auto mb-3 opacity-50"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
      <p class="text-sm">No items yet. Add something above.</p>
    </div>` : '';

  const actionsHtml = totalCount > 0 ? `
    <div class="flex gap-2 mt-4">
      ${boughtCount > 0 ? `<button onclick="window.slClearBought()" class="px-3 py-1.5 rounded-lg bg-white/60 dark:bg-neutral-700/60 border border-neutral-200/50 dark:border-neutral-600/50 text-xs font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-600 transition-all">Clear bought (${boughtCount})</button>` : ''}
      <button onclick="window.slResetAll()" class="px-3 py-1.5 rounded-lg bg-white/60 dark:bg-neutral-700/60 border border-neutral-200/50 dark:border-neutral-600/50 text-xs font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-600 transition-all">Uncheck all (reuse list)</button>
    </div>` : '';

  return `
    <div class="p-6 lg:p-10 space-y-6 max-w-4xl">
      <div>
        <h1 class="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">Shopping List</h1>
        <p class="text-sm text-neutral-500 dark:text-neutral-400 mt-1">Add items, check them off, and reuse the list next time.</p>
      </div>

      <div class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-5 backdrop-blur-md">
        <form onsubmit="window.slAdd(event)" class="flex gap-3">
          <input id="sl-input" type="text" placeholder="Add an item..."
            class="flex-1 bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-4 py-2.5 text-sm text-neutral-700 dark:text-neutral-200 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-600" />
          <button type="submit"
            class="px-4 py-2.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm">Add</button>
        </form>
      </div>

      <div class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-5 backdrop-blur-md">
        ${totalCount > 0 ? `<p class="text-xs text-neutral-400 dark:text-neutral-500 mb-3">${boughtCount} of ${totalCount} bought</p>` : ''}
        <div class="divide-y divide-neutral-100 dark:divide-neutral-700/50">
          ${itemsHtml}
        </div>
        ${emptyState}
        ${actionsHtml}
      </div>
    </div>

    <script>
    (function() {
      async function refresh() {
        const html = await window.api.plugins.renderPage('shopping-list');
        if (html) {
          const container = document.querySelector('#builderPreviewContent')
            || document.querySelector('#pluginContent')
            || document.querySelector('#mainContent');
          if (container) {
            container.innerHTML = html;
            container.querySelectorAll('script').forEach(function(s) {
              var n = document.createElement('script');
              n.textContent = s.textContent;
              s.parentNode.replaceChild(n, s);
            });
          }
        }
      }

      window.slAdd = async function(e) {
        e.preventDefault();
        var input = document.getElementById('sl-input');
        var name = input.value.trim();
        if (!name) return;
        await window.api.plugins.sendEvent('shopping-list:add-item', { name: name });
        await refresh();
      };

      window.slToggle = async function(id) {
        await window.api.plugins.sendEvent('shopping-list:toggle-item', { id: id });
        await refresh();
      };

      window.slDelete = async function(id) {
        await window.api.plugins.sendEvent('shopping-list:delete-item', { id: id });
        await refresh();
      };

      window.slClearBought = async function() {
        await window.api.plugins.sendEvent('shopping-list:clear-bought', {});
        await refresh();
      };

      window.slResetAll = async function() {
        await window.api.plugins.sendEvent('shopping-list:reset-all', {});
        await refresh();
      };
    })();
    </script>`;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = { activate, deactivate, onEvent, renderPage };
