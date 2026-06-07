# AI Plugin Generation — SDK & Rules

This document defines how AI (Cortex or external code-generation tools) should generate plugins for IIMAGINE Desktop. It serves two purposes:

1. **System prompt reference** — fed to the LLM when generating plugin code
2. **Developer documentation** — for humans who want to understand the AI generation constraints

---

## Plugin Architecture Overview

IIMAGINE Desktop uses a WordPress-style plugin system. Plugins live at `~/.iimagine/plugins/<plugin-id>/` and are loaded by the core shell on startup. Each plugin is a self-contained directory.

**Core principle:** Plugins extend the app — they cannot modify the core. They run in the main Electron process (Node.js) and can render UI by returning HTML strings that display in a sandboxed content panel.

---

## Plugin File Structure

Every AI-generated plugin MUST follow this structure:

```
~/.iimagine/plugins/<plugin-id>/
├── plugin.json       # Manifest (REQUIRED)
├── index.js          # Main entry point (REQUIRED)
├── ui.js             # Optional — UI rendering helpers
└── README.md         # Optional — what the plugin does
```

### Naming Convention
- Plugin ID: lowercase, kebab-case (e.g., `habit-tracker`, `meeting-notes`)
- No spaces, no uppercase, no special characters except hyphens

---

## Manifest Schema (plugin.json)

```json
{
  "id": "my-plugin",
  "name": "Human Readable Name",
  "version": "1.0.0",
  "description": "One-line description of what this plugin does",
  "author": "ai-generated",
  "main": "index.js",
  "hooks": {
    "sidebar": { "label": "Nav Label", "icon": "🔧" },
    "settings": true,
    "chatPreprocess": true,
    "chatPostprocess": true
  }
}
```

### Hook Definitions

| Hook | Type | Purpose |
|------|------|---------|
| `sidebar` | `{ label, icon }` | Adds a nav entry to the sidebar. Clicking it renders the plugin's page. |
| `settings` | `true` | Plugin has a settings panel accessible from the Settings page. |
| `chatPreprocess` | `true` | Plugin can modify messages BEFORE they're sent to the LLM. |
| `chatPostprocess` | `true` | Plugin can modify the LLM's response AFTER generation. |
| `mention` | `{ name, description }` | Plugin can be @-mentioned in chat to activate. |
| `commands` | `true` | Plugin provides slash commands (e.g., /save, /export). |

**Rules:**
- Only declare hooks you actually implement in index.js
- `sidebar` is the most common hook for AI-generated plugins (adds a visible page)
- `chatPreprocess`/`chatPostprocess` are for plugins that modify chat behavior

---

## Entry Point (index.js) — Exported Functions

```js
module.exports = {
  // REQUIRED — called when the plugin is enabled
  activate(context) {
    // context contains: { db, store, kbStorage, getOllamaUrl }
    // Save references you need
  },

  // REQUIRED — called when the plugin is disabled
  deactivate() {
    // Clean up any resources
  },

  // OPTIONAL — renders the plugin's full page (for sidebar plugins)
  // Returns an HTML string. The core injects this into the main content area.
  renderPage() {
    return `<div class="p-6">...</div>`;
  },

  // OPTIONAL — renders settings panel
  renderSettings() {
    return `<div>...</div>`;
  },

  // OPTIONAL — modify messages before LLM call
  async onChatPreprocess({ messages, assistant }) {
    return { messages, assistant };
  },

  // OPTIONAL — modify response after LLM call
  async onChatPostprocess({ response, assistant }) {
    return { response, assistant };
  },

  // OPTIONAL — handle IPC events from the renderer
  onEvent(eventName, data) {
    return null;
  },

  // OPTIONAL — return array of slash commands
  getCommands() {
    return [{ name: '/mycommand', description: 'Does something' }];
  }
};
```

---

## Context Object (passed to activate)

```js
{
  db,              // better-sqlite3 database instance (the app's local SQLite DB)
  store,           // electron-store instance (key-value settings persistence)
  kbStorage,       // Knowledge Base storage (collections, documents, vector search)
  getOllamaUrl,    // Function returning the Ollama URL (for local LLM calls)
}
```

### Using `store` (Persisted Settings)
```js
// Read
const value = store.get('my-plugin.someKey', defaultValue);

// Write
store.set('my-plugin.someKey', value);

// Delete
store.delete('my-plugin.someKey');
```

**Rule:** Always namespace your store keys with your plugin ID prefix.

### Using `db` (SQLite Database)
```js
// Create tables (do this in activate)
db.exec(`
  CREATE TABLE IF NOT EXISTS my_plugin_items (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    data TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

// Insert
db.prepare('INSERT INTO my_plugin_items (id, title, data) VALUES (?, ?, ?)').run(id, title, json);

// Query
const items = db.prepare('SELECT * FROM my_plugin_items ORDER BY created_at DESC').all();
```

**Rules:**
- Always prefix table names with your plugin ID: `my_plugin_tablename`
- Use `CREATE TABLE IF NOT EXISTS` — plugin may be reloaded
- Use TEXT type for IDs (generate with crypto.randomUUID() or similar)
- Store complex data as JSON strings

---

## Rendering UI (renderPage)

The `renderPage()` function returns an HTML string. The core app injects it into the main content area and executes any `<script>` tags.

### What's Available in the Rendered Page

The page runs inside Electron's renderer process with access to:
- `window.api.plugins.sendEvent(eventName, data)` — call back to your plugin's `onEvent`
- `window.api.settings.get(key)` / `window.api.settings.set(key, value)` — read/write settings
- Tailwind CSS classes (loaded via CDN in the shell)
- The full DOM of the content panel

### UI Style Requirements

All AI-generated plugins MUST match the app's design system:

**Background:** Content renders inside the existing glass shell — do NOT add your own background.

**Container:** Wrap your page in:
```html
<div class="p-6 lg:p-10 space-y-6 max-w-4xl">
  <!-- your content -->
</div>
```

**Page Title:**
```html
<h1 class="text-xl lg:text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
  Page Title
</h1>
```

**Cards:**
```html
<div class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-5 backdrop-blur-md">
  <!-- card content -->
</div>
```

**Primary Button (dark):**
```html
<button class="px-4 py-2.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm">
  Button Text
</button>
```

**Secondary Button (glass):**
```html
<button class="px-4 py-2.5 rounded-lg bg-white/60 dark:bg-neutral-700/60 border border-neutral-200/50 dark:border-neutral-600/50 text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:bg-white/90 dark:hover:bg-neutral-700/90 transition-all shadow-sm">
  Button Text
</button>
```

**Inputs:**
```html
<input type="text" class="w-full bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-4 py-2.5 text-sm text-neutral-700 dark:text-neutral-200 placeholder-neutral-400 focus:bg-white/90 dark:focus:bg-neutral-800/90 focus:outline-none transition-all shadow-sm" placeholder="..." />
```

**Text Colors:**
- Primary: `text-neutral-900 dark:text-neutral-100`
- Secondary: `text-neutral-500 dark:text-neutral-400`
- Muted: `text-neutral-400 dark:text-neutral-500`

**Empty State:**
```html
<div class="text-center py-12">
  <p class="text-4xl mb-3">📋</p>
  <p class="text-sm text-neutral-500 dark:text-neutral-400">No items yet</p>
  <button class="mt-4 px-4 py-2 ...">Add First Item</button>
</div>
```

### Script Patterns for Interactive Pages

```html
<script>
(function() {
  // Self-executing to avoid global pollution

  async function loadData() {
    const result = await window.api.plugins.sendEvent('my-plugin:get-items', {});
    renderItems(result);
  }

  function renderItems(items) {
    const container = document.getElementById('items-list');
    container.innerHTML = items.map(item => `
      <div class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-xl p-4">
        <h3 class="text-sm font-medium text-neutral-900 dark:text-neutral-100">${item.title}</h3>
      </div>
    `).join('');
  }

  // Init
  loadData();
})();
</script>
```

---

## Communication Pattern (UI ↔ Plugin Logic)

Since `renderPage()` returns HTML that runs in the renderer, and your plugin logic runs in the main process, communication uses the event system:

**From UI (renderer) → Plugin (main):**
```js
// In your rendered HTML <script>
const result = await window.api.plugins.sendEvent('my-plugin:action-name', { key: 'value' });
```

**In your plugin (index.js):**
```js
onEvent(eventName, data) {
  if (eventName === 'my-plugin:get-items') {
    return db.prepare('SELECT * FROM my_plugin_items').all();
  }
  if (eventName === 'my-plugin:add-item') {
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO my_plugin_items (id, title) VALUES (?, ?)').run(id, data.title);
    return { success: true, id };
  }
  if (eventName === 'my-plugin:delete-item') {
    db.prepare('DELETE FROM my_plugin_items WHERE id = ?').run(data.id);
    return { success: true };
  }
  return null;
}
```

**Event naming:** Always prefix with your plugin ID: `my-plugin:action-name`

---

## Security & Sandbox Rules

### ALLOWED
- Read/write to your own SQLite tables (prefixed with plugin ID)
- Read/write to electron-store (prefixed with plugin ID)
- Use `require('crypto')` for IDs and hashing
- Use `require('path')` and `require('fs')` for files within your plugin directory only
- Make HTTP requests (for fetching public data, with user awareness)
- Use the `getOllamaUrl()` to make local LLM calls
- Render arbitrary HTML in your page panel

### NOT ALLOWED
- Modifying other plugins' data or tables
- Accessing the core app's internal state directly
- Reading/writing files outside your plugin directory or `~/.iimagine/`
- Using `eval()` or `Function()` in rendered HTML
- Accessing `window.parent` or `window.top` in rendered pages
- Spawning child processes (`child_process`)
- Requiring native addons not bundled with Electron

---

## Common Plugin Patterns

### Pattern 1: Data Tracker (Sidebar Page + Storage)

A plugin that lets users track items (habits, expenses, tasks, etc.)

```
hooks: { sidebar: { label: "...", icon: "..." } }
```
- `activate`: create SQLite table
- `renderPage`: return HTML with list + add form
- `onEvent`: handle CRUD operations
- No chat hooks needed

### Pattern 2: Chat Modifier (Postprocess)

A plugin that enriches or transforms LLM responses.

```
hooks: { chatPostprocess: true, settings: true }
```
- `onChatPostprocess`: receive response, return modified response
- `renderSettings`: toggle options

### Pattern 3: Context Injector (Preprocess)

A plugin that adds context to messages before the LLM sees them.

```
hooks: { chatPreprocess: true, sidebar: { ... } }
```
- `onChatPreprocess`: inject system message with relevant context
- `renderPage`: manage the data that gets injected

### Pattern 4: Full App (Sidebar + Chat Hooks + Events)

Complex plugin combining UI, chat integration, and data management.

```
hooks: { sidebar: {...}, chatPreprocess: true, chatPostprocess: true, settings: true }
```

---

## AI Generation Guidelines

When generating a plugin from a user's natural language request:

1. **Start simple.** Most user requests map to Pattern 1 (data tracker with a page). Don't over-engineer.

2. **One plugin, one purpose.** Each plugin does one thing well. Don't combine unrelated features.

3. **Use semantic IDs.** The plugin ID should describe what it does: `habit-tracker`, `meeting-notes`, `expense-log`.

4. **Always include dark mode.** Every class that uses a light color must have a `dark:` variant.

5. **Generate working code.** The plugin must be immediately functional after file creation — no npm install, no build step, no external dependencies that aren't available in Electron's Node.js runtime.

6. **No external CDN dependencies in plugin JS.** Only use Node.js built-ins and the context APIs. The rendered HTML can use Tailwind (already loaded) and basic inline scripts.

7. **Keep it under 300 lines.** If the plugin needs more, split into `index.js` + `ui.js` helper.

8. **Handle errors gracefully.** Never throw unhandled errors — catch and return sensible defaults. A broken plugin should not crash the app.

9. **Prefix everything.** Table names, store keys, event names — all prefixed with the plugin ID.

10. **Respect the user's data.** Never delete data without confirmation. Always make data exportable if the plugin stores meaningful user content.

---

## Example: Complete AI-Generated Plugin

**User request:** "Build me a plugin that tracks my daily water intake with a goal"

### plugin.json
```json
{
  "id": "water-tracker",
  "name": "Water Tracker",
  "version": "1.0.0",
  "description": "Track daily water intake with customizable daily goal",
  "author": "ai-generated",
  "main": "index.js",
  "hooks": {
    "sidebar": { "label": "Water", "icon": "💧" },
    "settings": true
  }
}
```

### index.js
```js
const crypto = require('crypto');

let db = null;
let store = null;

module.exports = {
  activate(context) {
    db = context.db;
    store = context.store;

    db.exec(`
      CREATE TABLE IF NOT EXISTS water_tracker_logs (
        id TEXT PRIMARY KEY,
        amount_ml INTEGER NOT NULL,
        logged_at TEXT DEFAULT (datetime('now')),
        date TEXT DEFAULT (date('now'))
      )
    `);
  },

  deactivate() {
    db = null;
    store = null;
  },

  onEvent(eventName, data) {
    if (eventName === 'water-tracker:get-today') {
      const today = new Date().toISOString().split('T')[0];
      const logs = db.prepare(
        'SELECT * FROM water_tracker_logs WHERE date = ? ORDER BY logged_at DESC'
      ).all(today);
      const total = logs.reduce((sum, l) => sum + l.amount_ml, 0);
      const goal = store.get('water-tracker.dailyGoal', 2000);
      return { logs, total, goal };
    }

    if (eventName === 'water-tracker:add') {
      const id = crypto.randomUUID();
      db.prepare(
        'INSERT INTO water_tracker_logs (id, amount_ml) VALUES (?, ?)'
      ).run(id, data.amount);
      return { success: true, id };
    }

    if (eventName === 'water-tracker:delete') {
      db.prepare('DELETE FROM water_tracker_logs WHERE id = ?').run(data.id);
      return { success: true };
    }

    if (eventName === 'water-tracker:set-goal') {
      store.set('water-tracker.dailyGoal', data.goal);
      return { success: true };
    }

    return null;
  },

  renderPage() {
    return `
      <div class="p-6 lg:p-10 space-y-6 max-w-2xl">
        <h1 class="text-xl lg:text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
          💧 Water Tracker
        </h1>

        <!-- Progress -->
        <div class="bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-6 backdrop-blur-md">
          <div class="flex items-center justify-between mb-3">
            <span class="text-sm font-medium text-neutral-700 dark:text-neutral-300">Today's Progress</span>
            <span id="wt-progress-text" class="text-sm text-neutral-500 dark:text-neutral-400">0 / 2000 ml</span>
          </div>
          <div class="bg-neutral-100 dark:bg-neutral-700 rounded-full h-3 overflow-hidden">
            <div id="wt-progress-bar" class="bg-gradient-to-r from-blue-400 to-blue-600 h-3 rounded-full transition-all duration-500" style="width: 0%"></div>
          </div>
        </div>

        <!-- Quick Add -->
        <div class="flex gap-2">
          <button onclick="wtAdd(250)" class="flex-1 px-4 py-2.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm">
            +250ml
          </button>
          <button onclick="wtAdd(500)" class="flex-1 px-4 py-2.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm">
            +500ml
          </button>
          <button onclick="wtAddCustom()" class="flex-1 px-4 py-2.5 rounded-lg bg-white/60 dark:bg-neutral-700/60 border border-neutral-200/50 dark:border-neutral-600/50 text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:bg-white/90 dark:hover:bg-neutral-700/90 transition-all shadow-sm">
            Custom
          </button>
        </div>

        <!-- Log -->
        <div id="wt-log" class="space-y-2"></div>
      </div>

      <script>
      (function() {
        async function load() {
          const data = await window.api.plugins.sendEvent('water-tracker:get-today', {});
          const pct = Math.min(100, Math.round((data.total / data.goal) * 100));
          document.getElementById('wt-progress-bar').style.width = pct + '%';
          document.getElementById('wt-progress-text').textContent = data.total + ' / ' + data.goal + ' ml';

          const logEl = document.getElementById('wt-log');
          if (data.logs.length === 0) {
            logEl.innerHTML = '<p class="text-sm text-neutral-400 dark:text-neutral-500 text-center py-4">No entries today. Start drinking!</p>';
          } else {
            logEl.innerHTML = data.logs.map(l => {
              const time = new Date(l.logged_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              return '<div class="flex items-center justify-between bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-xl px-4 py-2.5">' +
                '<span class="text-sm text-neutral-700 dark:text-neutral-300">' + l.amount_ml + 'ml</span>' +
                '<span class="text-xs text-neutral-400 dark:text-neutral-500">' + time + '</span>' +
                '</div>';
            }).join('');
          }
        }

        window.wtAdd = async function(amount) {
          await window.api.plugins.sendEvent('water-tracker:add', { amount });
          load();
        };

        window.wtAddCustom = function() {
          const amount = prompt('Enter amount in ml:');
          if (amount && !isNaN(amount)) wtAdd(parseInt(amount));
        };

        load();
      })();
      </script>
    `;
  },

  renderSettings() {
    const goal = store.get('water-tracker.dailyGoal', 2000);
    return `
      <div class="space-y-3">
        <div>
          <label class="text-sm font-medium text-neutral-700 dark:text-neutral-300">Daily Goal (ml)</label>
          <input id="wt-goal-input" type="number" value="${goal}" class="mt-1 w-full bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-4 py-2.5 text-sm text-neutral-700 dark:text-neutral-200" />
        </div>
        <button onclick="(async()=>{const v=document.getElementById('wt-goal-input').value;await window.api.plugins.sendEvent('water-tracker:set-goal',{goal:parseInt(v)});})()" class="px-4 py-2 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm">
          Save Goal
        </button>
      </div>
    `;
  }
};
```

---

## Updating an Existing Plugin

When the user asks to modify an AI-generated plugin:

1. Read the existing plugin files from `~/.iimagine/plugins/<plugin-id>/`
2. Understand the current structure and data schema
3. Make targeted edits — don't regenerate the entire plugin unless major changes requested
4. Preserve existing user data (never drop tables, add columns with ALTER TABLE or new tables)
5. Write updated files back to the same directory
6. The app will hot-reload the plugin on next page navigation

---

## Plugin Marketplace (Future)

AI-generated plugins can be shared by:
1. Zipping the plugin directory
2. Uploading to a community marketplace
3. Other users download and place in their `~/.iimagine/plugins/` directory

The manifest `author: "ai-generated"` flag distinguishes community AI plugins from official ones.

---

## Limitations (Tell the User)

- Plugins run in Node.js (main process), not the browser. They CAN access the filesystem.
- The rendered UI is HTML injected into the app — it's not a separate window or iframe.
- Plugins share the same SQLite database. Table collisions are prevented by ID prefixing.
- Plugin pages are re-rendered on every navigation. State must be persisted in DB/store, not in memory.
- No real-time subscriptions or WebSocket support built-in (would need custom implementation).
- External API calls work but require the user to be online.
