# Troubleshooting

Common issues and solutions when developing plugins.

## Plugin Not Loading

### Symptoms
- Plugin doesn't appear in Settings → Plugins
- No activation log in the terminal

### Causes and Fixes

**Missing or invalid `plugin.json`:**
```bash
# Check the file exists and is valid JSON
cat ~/.iimagine/plugins/my-plugin/plugin.json | python3 -m json.tool
```

Common JSON errors:
- Trailing commas
- Missing quotes around keys
- Single quotes instead of double quotes

**Wrong folder location:**
```bash
# Must be in this exact path:
~/.iimagine/plugins/my-plugin/plugin.json

# NOT:
~/.iimagine/plugins/my-plugin/src/plugin.json  # nested too deep
~/.iimagine/my-plugin/plugin.json              # wrong parent folder
```

**Missing main file:**
```bash
# The file referenced in plugin.json "main" field must exist
ls ~/.iimagine/plugins/my-plugin/index.js
```

**Folder is not a directory:**
```bash
# The plugin manager only scans directories, not files
# Make sure you didn't accidentally create a file named "my-plugin"
ls -la ~/.iimagine/plugins/
```

---

## Old Cached Version Running

### Symptoms
- You edited your plugin but the old behavior persists
- Console shows old log messages

### Fix

The most common cause: you edited files in your development folder but the app loads from `~/.iimagine/plugins/`.

```bash
# Delete the runtime copy
rm -rf ~/.iimagine/plugins/my-plugin

# Copy your updated version
cp -r /path/to/dev/my-plugin ~/.iimagine/plugins/

# Restart the app
```

Or use a symlink during development:
```bash
rm -rf ~/.iimagine/plugins/my-plugin
ln -sf /path/to/dev/my-plugin ~/.iimagine/plugins/my-plugin
```

### Node.js require cache

The plugin manager clears the require cache before loading:
```javascript
delete require.cache[require.resolve(mainFile)];
```

This handles the main file, but if your plugin has sub-modules, they might be cached. Restart the app to clear all caches.

---

## 400 Errors from Ollama

### Symptoms
- `LLM request failed: 400`
- Plugin works with some models but not others

### Common Causes

**Using an embedding model for chat:**
```javascript
// WRONG — nomic-embed-text is an embedding model, not a chat model
await fetch(`${ollamaUrl}/api/chat`, {
  body: JSON.stringify({ model: 'nomic-embed-text', messages: [...] })
});

// RIGHT — use a chat model
await fetch(`${ollamaUrl}/api/chat`, {
  body: JSON.stringify({ model: 'llama3', messages: [...] })
});
```

**Using a chat model for embeddings:**
```javascript
// WRONG — llama3 doesn't support /api/embeddings
await fetch(`${ollamaUrl}/api/embeddings`, {
  body: JSON.stringify({ model: 'llama3', prompt: 'text' })
});

// RIGHT — use an embedding model
await fetch(`${ollamaUrl}/api/embeddings`, {
  body: JSON.stringify({ model: 'nomic-embed-text', prompt: 'text' })
});
```

**Model not pulled:**
```bash
# Check what's installed
curl http://localhost:11434/api/tags | python3 -m json.tool

# Pull a model if needed
ollama pull llama3
ollama pull nomic-embed-text
```

### Auto-Detect Pattern

Filter models by type to avoid mismatches:
```javascript
async function getDefaultChatModel() {
  const res = await fetch(`${ollamaUrl}/api/tags`);
  const data = await res.json();
  const embeddingPatterns = ['embed', 'nomic-embed', 'mxbai-embed', 'bge-'];
  
  const chatModels = data.models.filter(m => {
    const name = m.name.toLowerCase();
    return !embeddingPatterns.some(p => name.includes(p));
  });
  
  return chatModels[0]?.name || null;
}
```

---

## require() Errors

### Symptoms
- `Cannot find module './helper'`
- `MODULE_NOT_FOUND` errors

### Fixes

**Relative paths must be correct:**
```javascript
// If your structure is:
// my-plugin/
//   index.js
//   lib/helper.js

// In index.js:
const helper = require('./lib/helper');  // ✓
const helper = require('lib/helper');    // ✗ wrong
const helper = require('../helper');     // ✗ wrong
```

**File extension:**
```javascript
// Node.js resolves .js automatically, but be explicit if using other extensions
const data = require('./config.json');   // ✓ works for JSON
const mod = require('./helper');         // ✓ resolves to helper.js
```

---

## Plugin Crashes on Activate

### Symptoms
- `[Plugin] Failed to activate my-plugin: <error>`
- Plugin shows as loaded but not active

### Debugging

Check the terminal where `npm start` runs. All plugin errors are logged there.

```javascript
// Add defensive error handling in activate()
activate(context) {
  try {
    // Your initialization code
    this.db = context.db;
    this.createTables();
  } catch (err) {
    console.error('[MyPlugin] Activation failed:', err);
    // Don't re-throw — let the plugin manager handle it
  }
}
```

### Common Activate Errors

**Database table already exists with different schema:**
```javascript
// Always use IF NOT EXISTS
db.exec('CREATE TABLE IF NOT EXISTS ...');

// For ALTER TABLE, catch the "duplicate column" error
try {
  db.exec('ALTER TABLE myplugin_data ADD COLUMN new_col TEXT');
} catch (err) {
  if (!err.message.includes('duplicate column')) throw err;
}
```

**Context is undefined:**
```javascript
// The plugin manager passes an empty object if context isn't set yet
activate(context) {
  // Always check before using
  const ollamaUrl = context.getOllamaUrl ? context.getOllamaUrl() : 'http://localhost:11434';
  const db = context.db; // might be undefined in edge cases
  if (!db) {
    console.warn('[MyPlugin] No database available');
    return;
  }
}
```

---

## Viewing Plugin Logs

All `console.log`, `console.warn`, and `console.error` calls from plugins appear in the terminal where you started the app.

```bash
# Start the app from terminal to see logs
cd desktop-companion
npm start
```

### Recommended Logging Pattern

```javascript
const LOG = '[MyPlugin]';

module.exports = {
  activate(context) {
    console.log(`${LOG} Activating...`);
    // ... setup ...
    console.log(`${LOG} Activated successfully`);
  },

  async onChatPreprocess({ messages, assistant }) {
    console.log(`${LOG} Preprocess: ${messages.length} messages`);
    // ...
  },
};
```

### Log Levels

- `console.log` — Normal operation info
- `console.warn` — Non-fatal issues (model not found, fallback used)
- `console.error` — Errors that need attention

---

## Hook Not Firing

### Symptoms
- Your `onChatPreprocess` or `onChatPostprocess` never runs
- No log output from your hook function

### Checklist

1. **Is the hook declared in `plugin.json`?**
   ```json
   "hooks": { "chatPreprocess": true }
   ```

2. **Is the plugin enabled?**
   Check Settings → Plugins. The toggle must be on.

3. **Is the function exported correctly?**
   ```javascript
   module.exports = {
     onChatPreprocess({ messages, assistant }) { ... },  // ✓
   };
   ```

4. **Is another plugin's @mention routing active?**
   If the user typed `@otherplugin`, only that plugin's hooks run. Your plugin is skipped.

5. **Did the function throw before your log?**
   Add a log as the very first line:
   ```javascript
   async onChatPreprocess({ messages, assistant }) {
     console.log('[MyPlugin] Hook fired!');  // First line
     // ... rest of logic
   }
   ```

---

## Settings Not Persisting

### Symptoms
- Values reset after app restart
- `store.get()` returns the default value

### Fixes

**Are you using the right key prefix?**
```javascript
// Make sure you're reading the same key you wrote
store.set('my-plugin.tokenBudget', 2000);
store.get('my-plugin.tokenBudget', 1500);  // ✓ same key

store.set('myPlugin.tokenBudget', 2000);
store.get('my-plugin.tokenBudget', 1500);  // ✗ different key!
```

**Are you saving from the UI?**
If your settings panel has inputs but no save logic, values won't persist. You need event handlers that call `store.set()`:

```javascript
// In your renderSettings HTML:
`<button onclick="window.api.settings.set('my-plugin.budget', 
  document.getElementById('budget-input').value)">Save</button>`
```

---

## sqlite-vec Not Available

### Symptoms
- `isVecLoaded()` returns `false`
- Vector search returns empty results

### Cause

The sqlite-vec extension might not be compiled for your platform, or it failed to load.

### Workaround

Always check before using vector features:
```javascript
const vecAvailable = context.kbStorage ? context.kbStorage.isVecLoaded() : false;

if (vecAvailable) {
  // Use vector search
} else {
  // Fall back to keyword search
  const results = db.prepare(
    'SELECT * FROM myplugin_facts WHERE content LIKE ? LIMIT 5'
  ).all(`%${keyword}%`);
}
```

---

## Quick Diagnostic Checklist

| Issue | Check |
|-------|-------|
| Plugin not showing up | `ls ~/.iimagine/plugins/my-plugin/plugin.json` |
| Old version running | Delete `~/.iimagine/plugins/my-plugin/`, re-copy, restart |
| Hook not firing | Check manifest `hooks` object, check plugin is enabled |
| 400 from Ollama | Verify model type matches endpoint (chat vs embedding) |
| Crash on activate | Check terminal logs, add try/catch in `activate()` |
| Settings lost | Verify key prefix matches between get/set calls |
| No logs visible | Run app from terminal with `npm start` |
