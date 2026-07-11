# Getting Started — Build a Plugin in 5 Minutes

## Overview

IIMAGINE Desktop uses a WordPress-style plugin system. Plugins are plain Node.js modules that live in `~/.iimagine/plugins/` and extend the app with custom hooks, sidebar pages, settings panels, and slash commands.

## File Structure

Every plugin is a folder with two required files:

```
~/.iimagine/plugins/my-plugin/
├── plugin.json    ← manifest (required)
└── index.js       ← entry point (required)
```

You can add as many supporting files as you need (see cortex-lite for a multi-file example).

## Step 1: Create the Manifest

Create `~/.iimagine/plugins/hello-world/plugin.json`:

```json
{
  "id": "hello-world",
  "name": "Hello World",
  "version": "1.0.0",
  "description": "Appends a greeting to every response",
  "author": "Your Name",
  "main": "index.js",
  "hooks": {
    "chatPostprocess": true
  }
}
```

The `id` must be unique and match the folder name. The `hooks` object tells the plugin manager which lifecycle events your plugin participates in.

## Step 2: Create the Entry Point

Create `~/.iimagine/plugins/hello-world/index.js`:

```javascript
module.exports = {
  activate(context) {
    console.log('[HelloWorld] Plugin activated');
  },

  deactivate() {
    console.log('[HelloWorld] Plugin deactivated');
  },

  async onChatPostprocess({ response, assistant }) {
    return { response: response + '\n\n👋 Hello from my plugin!', assistant };
  },
};
```

## Step 3: Install and Test

### Option A: Manual Install

```bash
# Your plugin folder is already in the right place:
# ~/.iimagine/plugins/hello-world/
```

### Option B: Via the UI

1. Open Settings → Plugins
2. Click "Install"
3. Select your plugin folder

### Testing

1. Restart the app (or reload if in development)
2. Send any message to an assistant
3. You should see "👋 Hello from my plugin!" appended to every response

## Step 4: Iterate

During development, edit your files and restart the app. The plugin manager clears the `require` cache on each activation, so your changes take effect immediately on restart.

## What's Next?

| Guide | What You'll Learn |
|-------|-------------------|
| [02 — Manifest Reference](./02-manifest-reference.md) | Every field in plugin.json |
| [03 — Context API](./03-context-api.md) | Database, settings, KB, engine access |
| [04 — Hooks Reference](./04-hooks-reference.md) | All available hooks in detail |
| [05 — Calling LLMs](./05-calling-llms.md) | Making AI calls from plugins |
| [06 — Database Patterns](./06-database-patterns.md) | SQLite tables, migrations, vectors |
| [07 — UI Guide](./07-ui-guide.md) | Building sidebar pages and settings panels |

## Example Plugins

- **word-count** — Minimal plugin. Appends word/character count to responses. ~30 lines of code.
- **cortex-lite** — Advanced plugin. Knowledge graph, vector search, entity extraction, sidebar page, settings panel, slash commands. Multi-file architecture.
