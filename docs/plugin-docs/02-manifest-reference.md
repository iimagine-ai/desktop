# Manifest Reference — plugin.json

The manifest file declares your plugin's identity, entry point, and which hooks it uses. The plugin manager reads this file during discovery.

## Complete Schema

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "Short description of what this plugin does",
  "author": "Your Name",
  "main": "index.js",
  "hooks": {
    "chatPreprocess": true,
    "chatPostprocess": true,
    "sidebar": { "label": "My Page", "icon": "🔧" },
    "settings": true,
    "mention": { "name": "myplugin", "description": "What happens when user types @myplugin" }
  }
}
```

## Field Reference

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier. Must match the folder name. Use lowercase with hyphens (e.g., `my-plugin`). |
| `name` | string | Human-readable display name shown in the UI. |
| `version` | string | Semver version string (e.g., `1.0.0`). |
| `main` | string | Relative path to the entry point file. Almost always `"index.js"`. |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `description` | string | One-line description shown in Settings → Plugins. |
| `author` | string | Plugin author name. |
| `hooks` | object | Declares which hooks this plugin implements. See below. |

## Hooks Object

The `hooks` object tells the plugin manager which lifecycle events your plugin participates in. Only declare hooks you actually implement — the plugin manager uses this for efficient routing.

### chatPreprocess

```json
"chatPreprocess": true
```

**Type:** `boolean`

When `true`, the plugin manager will call your `onChatPreprocess()` function before messages are sent to the LLM. Used for injecting context, modifying user input, or adding system messages.

### chatPostprocess

```json
"chatPostprocess": true
```

**Type:** `boolean`

When `true`, the plugin manager will call your `onChatPostprocess()` function after the LLM generates a response. Used for appending metadata, triggering side effects, or transforming output.

### sidebar

```json
"sidebar": { "label": "Memory", "icon": "🧠" }
```

**Type:** `object`

Adds a navigation item to the app's sidebar. Clicking it renders your plugin's page.

| Property | Type | Description |
|----------|------|-------------|
| `label` | string | Text shown in the sidebar nav. Falls back to `name` if omitted. |
| `icon` | string | Emoji or character shown next to the label. Defaults to `🔌`. |

### settings

```json
"settings": true
```

**Type:** `boolean`

When `true`, your plugin gets a settings panel in Settings → Plugins → (your plugin). The plugin manager calls your `renderSettings()` function to get the HTML.

### mention

```json
"mention": { "name": "memory", "description": "Search memory for relevant context" }
```

**Type:** `object`

Registers your plugin as an @-mentionable entity. When a user types `@memory` in the chat input, your plugin's preprocess/postprocess hooks are invoked exclusively (instead of all plugins).

| Property | Type | Description |
|----------|------|-------------|
| `name` | string | The mention trigger (without @). Falls back to the plugin `id`. |
| `description` | string | Shown in the mention autocomplete dropdown. |

## Versioning

Use semantic versioning:

- **Patch** (1.0.0 → 1.0.1): Bug fixes, no API changes
- **Minor** (1.0.0 → 1.1.0): New features, backward compatible
- **Major** (1.0.0 → 2.0.0): Breaking changes, schema migrations

The version is displayed in the plugin list UI and can be used for migration logic in your `activate()` function.

## Real Examples

### Minimal (word-count)

```json
{
  "id": "word-count",
  "name": "Word Count",
  "version": "1.0.0",
  "description": "Adds word and character count to assistant responses",
  "author": "IIMAGINE",
  "main": "index.js",
  "hooks": {
    "chatPostprocess": true,
    "settings": true
  }
}
```

### Full-featured (cortex-lite)

```json
{
  "id": "cortex-lite",
  "name": "Cortex Lite",
  "version": "1.0.0",
  "description": "Advanced memory — remembers entities, preferences, and facts across conversations",
  "author": "IIMAGINE",
  "main": "index.js",
  "hooks": {
    "chatPreprocess": true,
    "chatPostprocess": true,
    "sidebar": { "label": "Memory", "icon": "🧠" },
    "settings": true
  }
}
```

## Validation Rules

- `id` must be a valid folder name (no spaces, no special characters except hyphens)
- `main` must point to an existing `.js` file relative to the plugin folder
- If `hooks` is omitted or empty, the plugin loads but does nothing
- Unknown hook keys are silently ignored (forward compatibility)
