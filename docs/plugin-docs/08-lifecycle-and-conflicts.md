# Plugin Lifecycle and Conflicts

Understanding how plugins are discovered, loaded, and how multiple plugins interact.

## Lifecycle Stages

```
Discovery → Load → Activate → Hook Execution → Deactivate
```

### 1. Discovery

On app startup, the plugin manager scans `~/.iimagine/plugins/` for folders containing a valid `plugin.json`.

```
~/.iimagine/plugins/
├── word-count/
│   ├── plugin.json  ✓ discovered
│   └── index.js
├── cortex-lite/
│   ├── plugin.json  ✓ discovered
│   └── index.js
├── random-file.txt  ✗ ignored (not a directory)
└── broken-plugin/
    └── readme.md    ✗ ignored (no plugin.json)
```

### 2. Load

For each discovered plugin:
1. Parse `plugin.json` to get the manifest
2. Check the enabled/disabled state from `electron-store` (`plugins.enabled` map)
3. Register the plugin in the internal map

Plugins are **enabled by default** when first discovered. The user can disable them from Settings → Plugins.

### 3. Activate

For each enabled plugin:
1. Resolve the `main` file path (e.g., `~/.iimagine/plugins/my-plugin/index.js`)
2. Clear the `require` cache for that file (allows hot-reloading)
3. `require()` the module
4. Call `instance.activate(context)` with the shared context object

```javascript
// What the plugin manager does internally:
delete require.cache[require.resolve(mainFile)];
const instance = require(mainFile);
instance.activate(context);
```

### 4. Hook Execution

During normal app operation, hooks are called as events occur:
- User sends a message → `runChatPreprocess()` → LLM → `runChatPostprocess()`
- User navigates to plugin page → `renderPage()`
- User opens plugin settings → `renderSettings()`
- User types `/` → `getCommands()` collected from all plugins

### 5. Deactivate

When a plugin is disabled (via Settings toggle) or the app shuts down:
1. Call `instance.deactivate()` if it exists
2. Set `instance` to `null`
3. Update the enabled state in electron-store

## Hook Chaining

When multiple plugins declare the same hook, they run **sequentially** in discovery order.

### chatPreprocess Chain

```
User message
  → Plugin A.onChatPreprocess({ messages, assistant })
  → Plugin B.onChatPreprocess({ messages, assistant })  ← receives A's modifications
  → Plugin C.onChatPreprocess({ messages, assistant })  ← receives A+B's modifications
  → Final messages sent to LLM
```

### chatPostprocess Chain

```
LLM response
  → Plugin A.onChatPostprocess({ response, assistant })
  → Plugin B.onChatPostprocess({ response, assistant })  ← receives A's modifications
  → Plugin C.onChatPostprocess({ response, assistant })  ← receives A+B's modifications
  → Final response shown to user
```

### What This Means

- Each plugin receives the **output of the previous plugin**
- Order matters — plugins discovered first run first
- If Plugin A adds a system message, Plugin B will see it in the messages array
- If Plugin A appends text to the response, Plugin B will see the appended text

### Error Isolation

If a plugin throws an error during hook execution:
- The error is caught and logged
- The **unmodified data** from before that plugin ran is passed to the next plugin
- The app continues normally

```javascript
// Plugin manager's internal error handling:
try {
  result = await plugin.instance.onChatPreprocess(result);
} catch (err) {
  console.warn(`[Plugin] ${plugin.id} chatPreprocess error:`, err.message);
  // result remains unchanged, next plugin gets the pre-error state
}
```

## Mention-Based Routing

When a user @-mentions a specific plugin, **only that plugin's hooks run** (not all plugins):

```
User: @memory what do you know about my project?
  → Only cortex-lite.onChatPreprocess runs
  → LLM generates response
  → Only cortex-lite.onChatPostprocess runs
```

This prevents conflicts when the user explicitly targets a plugin.

## Plugin Enable/Disable Persistence

The enabled state is stored in electron-store under `plugins.enabled`:

```json
{
  "plugins.enabled": {
    "word-count": true,
    "cortex-lite": true,
    "my-broken-plugin": false
  }
}
```

- New plugins default to `true` (enabled)
- Toggling in the UI calls `pluginManager.setEnabled(id, bool)`
- The state persists across app restarts

## Load Order

Plugins are loaded in the order `fs.readdirSync()` returns them, which is typically **alphabetical by folder name**. If you need a specific order, prefix folder names:

```
~/.iimagine/plugins/
├── 01-context-provider/   ← runs first
├── 02-memory/             ← runs second
└── 99-word-count/         ← runs last
```

In practice, most plugins are independent and order doesn't matter.

## Cached Plugin Issue

During development, you might have plugins in two places:

1. **Source:** `desktop-companion/plugins/my-plugin/` (your development copy)
2. **Runtime:** `~/.iimagine/plugins/my-plugin/` (where the app actually loads from)

The app **only loads from `~/.iimagine/plugins/`**. If you edit your source copy but forget to copy it to the runtime location, you'll see stale behavior.

### Solutions

**Option A:** Develop directly in `~/.iimagine/plugins/`

```bash
cd ~/.iimagine/plugins/my-plugin
# Edit files here directly
```

**Option B:** Symlink during development

```bash
ln -sf /path/to/desktop-companion/plugins/my-plugin ~/.iimagine/plugins/my-plugin
```

**Option C:** Copy after changes

```bash
cp -r desktop-companion/plugins/my-plugin ~/.iimagine/plugins/
```

### Clearing Stale Cache

If a plugin seems stuck on old behavior:

```bash
# Delete the runtime copy and re-copy
rm -rf ~/.iimagine/plugins/my-plugin
cp -r /path/to/source/my-plugin ~/.iimagine/plugins/
```

Then restart the app. The plugin manager clears Node's `require` cache on activation, so a restart is sufficient.

## Multiple Plugins Using the Same Hook

This is fine and expected. Common scenarios:

| Scenario | Behavior |
|----------|----------|
| Two plugins with `chatPostprocess` | Both run sequentially, each sees the other's changes |
| Two plugins with `sidebar` | Both get sidebar items, user can navigate to either |
| Two plugins with `settings` | Both get settings panels in the plugin settings area |
| Two plugins with `mention` using the same name | Last one discovered wins (avoid this) |

### Avoiding Conflicts

- **Don't assume you're the only preprocess plugin** — check if your system message already exists before adding it
- **Don't strip content added by other plugins** — only modify what you own
- **Use unique identifiers** in your injected content so you can find/update it later
