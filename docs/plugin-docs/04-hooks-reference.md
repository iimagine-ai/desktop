# Hooks Reference

Hooks are the primary way plugins interact with the app's chat pipeline and UI. Declare hooks in your `plugin.json` manifest, then implement the corresponding functions in your entry point.

## chatPreprocess

**Manifest:** `"chatPreprocess": true`  
**Function:** `onChatPreprocess({ messages, assistant })`  
**Returns:** `{ messages, assistant }`

Called before messages are sent to the LLM. Use this to inject system messages, modify user input, add retrieved context, or transform the conversation.

### Signature

```javascript
async onChatPreprocess({ messages, assistant }) {
  // messages: Array of { role: 'system'|'user'|'assistant', content: string }
  // assistant: Object with assistant config (name, model, systemPrompt, etc.)
  
  return { messages, assistant };
}
```

### Example: Inject a System Message

```javascript
async onChatPreprocess({ messages, assistant }) {
  messages.unshift({
    role: 'system',
    content: 'Always respond in bullet points.',
  });
  return { messages, assistant };
}
```

### Example: Add Retrieved Context (cortex-lite pattern)

```javascript
async onChatPreprocess({ messages, assistant }) {
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
  if (!lastUserMsg) return { messages, assistant };

  const context = await retriever.buildContext(lastUserMsg.content);
  if (!context) return { messages, assistant };

  // Insert after existing system messages
  const systemEnd = messages.findIndex(m => m.role !== 'system');
  const insertAt = systemEnd === -1 ? 0 : systemEnd;
  messages.splice(insertAt, 0, { role: 'system', content: context });

  return { messages, assistant };
}
```

### Important Notes

- Always return `{ messages, assistant }` even if you don't modify them
- Hooks run sequentially — your modifications are visible to the next plugin
- If you throw an error, the plugin manager catches it and continues with unmodified data
- Keep this hook fast — it blocks the response

---

## chatPostprocess

**Manifest:** `"chatPostprocess": true`  
**Function:** `onChatPostprocess({ response, assistant })`  
**Returns:** `{ response, assistant }`

Called after the LLM generates a response, before it's shown to the user. Use this to append metadata, trigger background work, or transform the output.

### Signature

```javascript
async onChatPostprocess({ response, assistant }) {
  // response: string — the LLM's generated text
  // assistant: Object with assistant config
  
  return { response, assistant };
}
```

### Example: Append Metadata (word-count pattern)

```javascript
async onChatPostprocess({ response, assistant }) {
  if (!response) return { response, assistant };

  const words = response.trim().split(/\s+/).length;
  const chars = response.length;
  const footer = `\n\n---\n📊 ${words} words · ${chars} chars`;

  return { response: response + footer, assistant };
}
```

### Example: Fire-and-Forget Background Work (cortex-lite pattern)

```javascript
async onChatPostprocess({ response, assistant }) {
  // Don't block the response — do extraction in background
  setTimeout(async () => {
    try {
      const extracted = await extractor.extract(userMessage, response);
      if (extracted) {
        await extractor.processExtraction(extracted);
      }
    } catch (err) {
      console.error('[MyPlugin] Background error:', err.message);
    }
  }, 0);

  // Return immediately
  return { response, assistant };
}
```

### Important Notes

- Return the response promptly — don't do heavy work synchronously
- Use `setTimeout(..., 0)` for non-blocking background tasks
- Hooks run sequentially — your modifications are visible to the next plugin

---

## sidebar

**Manifest:** `"sidebar": { "label": "My Page", "icon": "🧠" }`  
**Function:** `renderPage(container)`  
**Returns:** HTML string

Adds a page to the app's sidebar navigation. When the user clicks your sidebar item, `renderPage()` is called and the returned HTML is rendered in the main content area.

### Signature

```javascript
renderPage(container) {
  // container: reference to the DOM container (for future use)
  // Return an HTML string
  return '<div class="p-6"><h2>My Page</h2></div>';
}
```

### Example: Data Dashboard (cortex-lite pattern)

```javascript
renderPage(container) {
  const stats = memoryDb.getStats();
  const entities = memoryDb.getEntities(30);

  const rows = entities.map(e => `
    <tr class="border-b border-gray-700">
      <td class="py-2 px-3 text-sm">${e.name}</td>
      <td class="py-2 px-3 text-xs text-gray-400">${e.type}</td>
      <td class="py-2 px-3 text-xs text-gray-500">${e.mention_count}×</td>
    </tr>
  `).join('');

  return `
    <div class="p-6 space-y-6">
      <h2 class="text-xl font-semibold text-white">🧠 Memory</h2>
      <div class="flex gap-4 text-xs text-gray-400">
        <span>${stats.entities} entities</span>
        <span>${stats.facts} facts</span>
      </div>
      <table class="w-full text-left">
        <thead class="bg-gray-800 text-xs text-gray-400">
          <tr><th class="py-2 px-3">Name</th><th class="py-2 px-3">Type</th><th class="py-2 px-3">Mentions</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}
```

### Important Notes

- The HTML is rendered inside the app's main content area
- Tailwind CSS classes are available (loaded via CDN)
- The page re-renders each time the user navigates to it
- See [07 — UI Guide](./07-ui-guide.md) for styling patterns

---

## settings

**Manifest:** `"settings": true`  
**Function:** `renderSettings(container)`  
**Returns:** HTML string

Adds a settings panel for your plugin in Settings → Plugins. Use this for configuration UI.

### Signature

```javascript
renderSettings(container) {
  return '<p class="text-sm text-gray-400">No configuration needed.</p>';
}
```

### Example: Configuration Panel (cortex-lite pattern)

```javascript
renderSettings(container) {
  const tokenBudget = store.get('cortex-lite.tokenBudget', 1500);
  const extractOn = store.get('cortex-lite.extractionEnabled', true);

  return `
    <div class="space-y-4">
      <div>
        <label class="text-xs text-gray-400 block mb-1">Token Budget</label>
        <input type="range" min="500" max="3000" step="100" value="${tokenBudget}"
          class="w-full" id="cortex-lite-budget" />
        <span class="text-xs text-gray-500">${tokenBudget} tokens</span>
      </div>
      <div class="flex items-center gap-2">
        <input type="checkbox" id="cortex-lite-extraction" ${extractOn ? 'checked' : ''} />
        <label for="cortex-lite-extraction" class="text-sm text-gray-300">
          Enable extraction
        </label>
      </div>
    </div>
  `;
}
```

---

## mention

**Manifest:** `"mention": { "name": "memory", "description": "Search memory" }`  
**Function:** Uses `onChatPreprocess` / `onChatPostprocess`

Registers your plugin as an @-mentionable entity. When a user types `@memory` in the chat input, only your plugin's preprocess/postprocess hooks run (instead of all plugins).

### How It Works

1. User types `@memory what do you know about my project?`
2. The app detects the mention and routes to your plugin exclusively
3. Your `onChatPreprocess` runs (only yours, not other plugins)
4. The LLM generates a response
5. Your `onChatPostprocess` runs (only yours)

### Manifest Declaration

```json
{
  "hooks": {
    "chatPreprocess": true,
    "chatPostprocess": true,
    "mention": {
      "name": "memory",
      "description": "Search memory for relevant context about this topic"
    }
  }
}
```

The `name` appears in the autocomplete dropdown when the user types `@`. The `description` is shown as helper text.

---

## getCommands() — Slash Commands

**Not declared in manifest** — just export the function.  
**Function:** `getCommands()`  
**Returns:** Array of command objects

Register slash commands that users can invoke by typing `/commandname` in the chat input.

### Signature

```javascript
getCommands() {
  return [
    {
      name: '/memory',
      description: 'Show memory stats',
      execute: () => {
        const stats = memoryDb.getStats();
        return `🧠 ${stats.entities} entities, ${stats.facts} facts`;
      },
    },
    {
      name: '/forget',
      description: 'Clear all memory',
      execute: () => {
        memoryDb.clearAll();
        return '🧠 Memory cleared.';
      },
    },
  ];
}
```

### Command Object

| Property | Type | Description |
|----------|------|-------------|
| `name` | string | The command trigger including `/` prefix |
| `description` | string | Shown in the command autocomplete |
| `execute` | function | Called when the user runs the command. Return a string to display. |

### Important Notes

- Commands are collected from all active plugins
- The `execute` function can be sync or async
- Return a string to display as a system message in the chat
- Commands are re-collected each time the plugin manager queries them
