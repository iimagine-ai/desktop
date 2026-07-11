# Plugin Development Guide

## Overview

IIMAGINE Desktop supports a WordPress-style plugin system. Plugins are folders in `~/.iimagine/plugins/` that extend the app's functionality.

## Plugin Structure

```
~/.iimagine/plugins/my-plugin/
├── plugin.json    ← manifest (required)
└── index.js       ← entry point (required)
```

## Manifest (plugin.json)

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "What this plugin does",
  "author": "Your Name",
  "main": "index.js",
  "hooks": {
    "chatPreprocess": true,
    "chatPostprocess": true,
    "sidebar": { "label": "My Page", "icon": "🔧" },
    "settings": true
  }
}
```

### Hooks

| Hook | Type | Description |
|------|------|-------------|
| `chatPreprocess` | boolean | Modify messages before they're sent to the LLM |
| `chatPostprocess` | boolean | Modify the LLM response before it's shown to the user |
| `sidebar` | object | Add a page to the sidebar navigation |
| `settings` | boolean | Add a settings panel in the Settings page |

## Entry Point (index.js)

```javascript
module.exports = {
  // Called when plugin is enabled
  activate(context) {
    // context provides:
    //   context.db             — SQLite database instance
    //   context.store          — electron-store for settings
    //   context.kbStorage      — Knowledge Base storage API
    //   context.assistantStorage — Assistants storage API
    //   context.getEnginePort() — Local engine port (OpenAI-compatible API)
  },

  // Called when plugin is disabled
  deactivate() {},

  // Hook: modify messages before sending to LLM
  // Receives: { messages: [...], assistant: {...} }
  // Returns:  { messages: [...], assistant: {...} }
  async onChatPreprocess({ messages, assistant }) {
    // Example: inject a system message
    messages.unshift({ role: 'system', content: 'Always respond in haiku.' });
    return { messages, assistant };
  },

  // Hook: modify response after LLM generates it
  // Receives: { response: "string", assistant: {...} }
  // Returns:  { response: "string", assistant: {...} }
  async onChatPostprocess({ response, assistant }) {
    // Example: append metadata
    return { response: response + '\n\n— via My Plugin', assistant };
  },

  // Hook: render a sidebar page (returns HTML string)
  renderPage(container) {
    return '<div class="p-6"><h2>My Plugin Page</h2></div>';
  },

  // Hook: render settings panel (returns HTML string)
  renderSettings(container) {
    return '<p>Plugin settings go here</p>';
  },
};
```

## Installation

### Manual
Drop the plugin folder into `~/.iimagine/plugins/`:
```bash
cp -r my-plugin ~/.iimagine/plugins/
```

### Via UI
Settings → Plugins → Install → select the plugin folder.

## Activation

Plugins are enabled by default when installed. Toggle on/off from Settings → Plugins.

## Example: Word Count Plugin

See `plugins/word-count/` for a complete working example that appends word/character count to assistant responses.

## API Context

The `context` object passed to `activate()` gives plugins access to:

- **`context.db`** — The SQLite database (better-sqlite3 instance). Use for custom tables.
- **`context.store`** — electron-store instance. Use for persisting plugin settings.
- **`context.kbStorage`** — KB storage API (createCollection, addDocument, searchSimilar, etc.)
- **`context.assistantStorage`** — Assistants API (createAssistant, addMessage, etc.)
- **`context.getEnginePort()`** — Returns the local engine port. The engine exposes an OpenAI-compatible API at `http://localhost:${port}/v1/`.

## Making AI Calls from Plugins

```javascript
let enginePort;

module.exports = {
  activate(context) {
    enginePort = context.getEnginePort();
  },

  async someFunction() {
    const res = await fetch(`http://localhost:${enginePort}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'current',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: false,
      }),
    });

    const data = await res.json();
    return data.choices[0].message.content;
  },
};
```

See `docs/plugin-docs/05-calling-llms.md` for complete examples including embeddings, structured extraction, and error handling.

## Security Notes

- Plugins run in the main Node.js process with full access.
- Only install plugins from trusted sources.
- Plugins can read/write the local database and file system.
