// Plugin Generator — AI-powered plugin creation from natural language
// Takes a user's description and generates a working plugin (manifest + code)
// Uses the existing agentChat infrastructure for LLM calls

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const LOG = '[PluginGen]';

// Forbidden patterns in generated code
const FORBIDDEN_PATTERNS = [
  /\beval\s*\(/,
  /new\s+Function\s*\(/,
  /child_process/,
  /require\s*\(\s*['"]child_process['"]\s*\)/,
  /process\.exit/,
  /process\.kill/,
  /require\s*\(\s*['"]electron['"]\s*\)/,
];

// System prompt for the LLM — defines the contract for generated plugins
const SYSTEM_PROMPT = `You are a plugin generator for IIMAGINE Desktop, an Electron app. You generate complete, working plugins from user descriptions.

## Output Format

You MUST output exactly two code blocks:

1. A JSON code block labeled \`plugin.json\` containing the manifest
2. A JavaScript code block labeled \`index.js\` containing the plugin code

Example output format:

\`\`\`json plugin.json
{
  "id": "my-plugin",
  ...
}
\`\`\`

\`\`\`javascript index.js
const crypto = require('crypto');
module.exports = { ... };
\`\`\`

## Plugin Rules

### Manifest (plugin.json)
- id: lowercase kebab-case, descriptive (e.g., "expense-tracker", "habit-log")
- name: human-readable title
- version: "1.0.0"
- description: one-line summary
- author: "ai-generated"
- main: "index.js"
- hooks: object declaring which hooks the plugin uses
  - sidebar: { label: "Nav Label", icon: "<svg>...</svg>" } — adds a sidebar nav entry. The icon MUST be an inline SVG string (Lucide-style: width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"). NEVER use emojis — they are inconsistent across platforms and look out of place.
  - settings: true — if plugin has configurable settings
  - chatPreprocess: true — if plugin modifies messages before LLM
  - chatPostprocess: true — if plugin modifies responses after LLM

### Entry Point (index.js)
- Must export: activate(context), deactivate()
- context provides: { db, store, kbStorage, getOllamaUrl, gatewayChat, files }
- IMPORTANT: Store the context reference in activate() so onEvent can use it:
  let ctx = null;
  function activate(context) { ctx = context; ... }
  async function onEvent(eventName, data) { const result = await ctx.gatewayChat(messages); ... }
- For sidebar plugins: must export renderPage() returning an HTML string
- For settings: must export renderSettings() returning an HTML string
- For events: must export onEvent(eventName, data)

### Data Storage
- Use context.db (better-sqlite3) for structured data
- Use context.store (electron-store) for settings/preferences
- Table names MUST be prefixed with plugin id using underscores: "expense_tracker_items"
- Store keys MUST be prefixed: "expense-tracker.someKey"
- Use CREATE TABLE IF NOT EXISTS in activate()

### File Upload & Storage
- Plugins can save and read files using the sandboxed file API
- Files are stored per-plugin at ~/.iimagine/plugin-data/<plugin-id>/
- From rendered HTML scripts, use these APIs:
  - Upload/save: await window.api.plugins.fileSave('plugin-id', filename, base64Data)
  - List files: await window.api.plugins.fileList('plugin-id')
  - Read file: await window.api.plugins.fileRead('plugin-id', filename) → { base64 }
  - Delete: await window.api.plugins.fileDelete('plugin-id', filename)
- To handle file input from the user, use a standard HTML <input type="file"> and read it as base64:
  const file = inputEl.files[0];
  const reader = new FileReader();
  reader.onload = async (e) => {
    const base64 = e.target.result.split(',')[1];
    await window.api.plugins.fileSave('plugin-id', file.name, base64);
  };
  reader.readAsDataURL(file);
- From the onEvent handler (backend): use context.files.save(pluginId, filename, data), context.files.read(pluginId, filename), context.files.list(pluginId), context.files.delete(pluginId, filename)
- To display an uploaded image in the UI, read it back as base64 and use a data: URL

### AI Vision (Analyzing Images with GPT)
- Plugins can send images to the AI model for analysis using the gateway chat API
- This works with vision-capable models (GPT-4o, GPT-5, etc.)
- From rendered HTML scripts, send a message with an image:
  const result = await window.api.plugins.sendEvent('plugin-id:analyze-image', { base64, prompt });
- In the onEvent handler, use ctx.gatewayChat (stored from activate):
  let ctx = null;
  function activate(context) { ctx = context; }
  async function onEvent(eventName, data) {
    if (eventName === 'plugin-id:analyze-image') {
      const { base64, prompt } = data;
      const messages = [
        { role: 'user', content: [
          { type: 'text', text: prompt || 'Describe this image' },
          { type: 'image_url', image_url: { url: \`data:image/png;base64,\${base64}\` } }
        ]}
      ];
      const response = await ctx.gatewayChat(messages);
      return { success: true, analysis: response };
    }
  }
- ctx.gatewayChat(messages) sends messages to the active cloud AI model and returns the text response
- This supports the OpenAI vision message format with content arrays containing text and image_url parts
- Use this for: image analysis, OCR, object detection, document parsing, visual Q&A
- IMPORTANT: Always check if ctx is available before calling gatewayChat (user may not have a cloud model configured)

### UI Rendering (renderPage returns HTML string)
- Use Tailwind CSS classes (already loaded globally)
- Support dark mode: every light class needs a dark: variant
- Page wrapper: <div class="p-6 lg:p-10 space-y-6 max-w-4xl">
- Cards: bg-white/50 dark:bg-neutral-800/50 border border-neutral-200/40 dark:border-neutral-700/40 rounded-2xl p-5 backdrop-blur-md
- Primary button: px-4 py-2.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-all shadow-sm
- Secondary button: px-4 py-2.5 rounded-lg bg-white/60 dark:bg-neutral-700/60 border border-neutral-200/50 dark:border-neutral-600/50 text-sm font-medium text-neutral-700 dark:text-neutral-300
- Input: w-full bg-white/60 dark:bg-neutral-800/60 border border-neutral-200/50 dark:border-neutral-700/50 rounded-xl px-4 py-2.5 text-sm text-neutral-700 dark:text-neutral-200 placeholder-neutral-400 focus:outline-none
- Text primary: text-neutral-900 dark:text-neutral-100
- Text secondary: text-neutral-500 dark:text-neutral-400

### Icons (MANDATORY — no emojis)
- All icons MUST be inline SVG using the Lucide icon style
- SVG format: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">...</svg>
- NEVER use emoji characters (✅, 🔨, ✏️, etc.) — they look inconsistent across platforms
- The sidebar icon in plugin.json hooks.sidebar.icon must be an SVG string
- Common icon paths for reference:
  - Checkmark/habit: <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
  - Chart/stats: <path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/>
  - Dollar/expense: <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
  - Calendar/time: <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
  - Note/journal: <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/>
  - List/tasks: <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
  - Timer/clock: <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
  - Water/droplet: <path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>
- Choose an icon that visually represents the plugin's purpose

### Communication (UI ↔ Plugin Logic)
- From rendered HTML scripts: await window.api.plugins.sendEvent('plugin-id:action', data)
- In index.js: handle in onEvent(eventName, data) { ... return result; }
- Event names must be prefixed with plugin id: "expense-tracker:add-item"

### Script Tags in renderPage
- Wrap all scripts in (function(){ ... })() to avoid global pollution
- Use window.functionName = ... to expose handlers needed by onclick attributes
- Always load data on init by calling your get event
- CRITICAL: After any mutation (add, delete, update), you MUST re-render the page. Use this pattern:
  async function refresh() {
    const html = await window.api.plugins.renderPage('PLUGIN_ID');
    if (html) {
      const container = document.currentScript?.closest('[class*="p-6"]')?.parentNode 
        || document.querySelector('#builderPreviewContent') 
        || document.querySelector('#pluginContent')
        || document.querySelector('#mainContent');
      if (container) { container.innerHTML = html; container.querySelectorAll('script').forEach(s => { const n = document.createElement('script'); n.textContent = s.textContent; s.parentNode.replaceChild(n, s); }); }
    }
  }
- This ensures data changes are immediately visible in both the normal page view and the builder preview panel.

### Security Rules
- NO eval(), NO new Function(), NO child_process
- NO require('electron') or require('fs') outside plugin dir
- Use require('crypto') for generating IDs (crypto.randomUUID())
- Catch all errors gracefully — never throw unhandled

### Important
- Generate complete, working code. Not pseudocode.
- The plugin must work immediately after file creation — no build step.
- Keep total code under 250 lines. If complex, prioritize core functionality.
- Use simple, reliable patterns. Prefer innerHTML rendering over complex frameworks.
- ALWAYS include the onEvent handler for data operations. Every plugin with a sidebar MUST persist data using the event system (window.api.plugins.sendEvent → onEvent). A UI without backend persistence is broken.
- NEVER generate UI-only plugins. If the plugin has add/create/save buttons, it MUST have corresponding onEvent handlers that write to SQLite.`;

class PluginGenerator {
  constructor() {
    this._agentChat = null; // injected from main.js
    this._pluginManager = null;
  }

  /**
   * Set the LLM call function (the existing agentChat from main.js)
   */
  setAgentChat(fn) {
    this._agentChat = fn;
  }

  /**
   * Set the plugin manager reference for install/reload
   */
  setPluginManager(pm) {
    this._pluginManager = pm;
  }

  /**
   * Generate a new plugin from a user's natural language description.
   * @param {string} userRequest — what the user wants (e.g., "track my daily water intake")
   * @param {string} [existingPluginId] — if modifying an existing plugin, pass its ID
   * @returns {{ success: boolean, pluginId?: string, pluginName?: string, error?: string }}
   */
  async generate(userRequest, existingPluginId) {
    if (!this._agentChat) {
      return { success: false, error: 'No LLM available. Configure a model in Settings.' };
    }

    console.log(`${LOG} Generating plugin for: "${userRequest.slice(0, 80)}"`);

    try {
      // Build messages for the LLM
      const messages = this._buildMessages(userRequest, existingPluginId);

      // Call LLM
      const response = await this._agentChat(messages);
      if (!response) {
        return { success: false, error: 'LLM returned empty response. Try again or switch to a more capable model.' };
      }
      if (response.startsWith('__ERROR__:')) {
        return { success: false, error: response.slice(10) };
      }

      // Parse the response into manifest + code
      const parsed = this._parseResponse(response);
      if (!parsed.success) {
        return { success: false, error: parsed.error };
      }

      // Validate
      const validation = this._validate(parsed.manifest, parsed.indexJs);
      if (!validation.valid) {
        console.log(`${LOG} Validation failed:`, validation.errors.join(', '));
        // Try self-correction: feed errors back to LLM
        const corrected = await this._selfCorrect(userRequest, response, validation.errors);
        if (!corrected.success) {
          return { success: false, error: `Generated plugin has issues: ${validation.errors.join('; ')}` };
        }
        parsed.manifest = corrected.manifest;
        parsed.indexJs = corrected.indexJs;
      }

      // Write files
      const pluginId = parsed.manifest.id;
      const writeResult = this._writePlugin(pluginId, parsed.manifest, parsed.indexJs);
      if (!writeResult.success) {
        return { success: false, error: writeResult.error };
      }

      // Install/reload in plugin manager
      if (this._pluginManager) {
        try {
          // If already loaded, deactivate first
          if (this._pluginManager.plugins.has(pluginId)) {
            this._pluginManager._deactivate(pluginId);
            this._pluginManager.plugins.delete(pluginId);
          }

          // Read the manifest and activate directly (files are already in the plugins dir)
          const pluginsDir = this._pluginManager.getPluginsDir();
          const manifestPath = path.join(pluginsDir, pluginId, 'plugin.json');
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
          manifest._dir = path.join(pluginsDir, pluginId);

          // Register and activate
          this._pluginManager.plugins.set(pluginId, { manifest, instance: null, enabled: true });
          this._pluginManager._activate(pluginId);

          // Persist enabled state
          const Store = require('electron-store');
          const store = new Store();
          const enabledMap = store.get('plugins.enabled', {});
          enabledMap[pluginId] = true;
          store.set('plugins.enabled', enabledMap);

          console.log(`${LOG} Plugin installed and activated: ${pluginId}`);
        } catch (err) {
          console.warn(`${LOG} Install error (plugin files written but not loaded):`, err.message);
        }
      }

      console.log(`${LOG} Success — generated "${parsed.manifest.name}" (${pluginId})`);
      return {
        success: true,
        pluginId,
        pluginName: parsed.manifest.name,
        sidebarLabel: parsed.manifest.hooks?.sidebar?.label || null,
      };
    } catch (err) {
      console.error(`${LOG} Generation error:`, err.message);
      return { success: false, error: `Generation failed: ${err.message}` };
    }
  }

  /**
   * Build the messages array for the LLM call
   */
  _buildMessages(userRequest, existingPluginId) {
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
    ];

    // If modifying an existing plugin, include the current code as context
    if (existingPluginId && this._pluginManager) {
      const existing = this._readExistingPlugin(existingPluginId);
      if (existing) {
        // Check if plugin has an activation error — include it for the LLM to fix
        const pluginError = this._pluginManager.getPluginError(existingPluginId);
        const errorContext = pluginError
          ? `\n\nThis plugin currently has a bug that prevents it from loading. The error is:\n\`\`\`\n${pluginError}\n\`\`\`\n\nPlease fix this error as part of your modifications.`
          : '';

        messages.push({
          role: 'user',
          content: `Here is my existing plugin that I want to modify:\n\n**plugin.json:**\n\`\`\`json\n${JSON.stringify(existing.manifest, null, 2)}\n\`\`\`\n\n**index.js:**\n\`\`\`javascript\n${existing.indexJs}\n\`\`\`${errorContext}\n\nPlease modify it according to this request: ${userRequest}\n\nIMPORTANT: Keep the same plugin ID. Do NOT drop existing database tables — add new columns with ALTER TABLE or create new tables instead.`,
        });
      } else {
        messages.push({ role: 'user', content: `Create a plugin that: ${userRequest}` });
      }
    } else {
      messages.push({ role: 'user', content: `Create a plugin that: ${userRequest}` });
    }

    return messages;
  }

  /**
   * Read an existing plugin's files from disk
   */
  _readExistingPlugin(pluginId) {
    if (!this._pluginManager) return null;
    const pluginsDir = this._pluginManager.getPluginsDir();
    const pluginDir = path.join(pluginsDir, pluginId);

    try {
      const manifestPath = path.join(pluginDir, 'plugin.json');
      const indexPath = path.join(pluginDir, 'index.js');

      if (!fs.existsSync(manifestPath) || !fs.existsSync(indexPath)) return null;

      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      const indexJs = fs.readFileSync(indexPath, 'utf-8');
      return { manifest, indexJs };
    } catch {
      return null;
    }
  }

  /**
   * Parse the LLM response to extract plugin.json and index.js
   */
  _parseResponse(response) {
    try {
      // Extract plugin.json from code block
      const manifestMatch = response.match(/```(?:json)?[\s]*(?:plugin\.json)?\s*\n([\s\S]*?)```/);
      if (!manifestMatch) {
        return { success: false, error: 'Could not find plugin.json in LLM response' };
      }

      // Extract index.js from code block
      const codeMatch = response.match(/```(?:javascript|js)?[\s]*(?:index\.js)?\s*\n([\s\S]*?)```/g);
      if (!codeMatch || codeMatch.length < 2) {
        // Try alternate: find the second code block
        const allBlocks = [...response.matchAll(/```(?:javascript|js|json)?[\s]*(?:[\w.]*?)?\s*\n([\s\S]*?)```/g)];
        if (allBlocks.length < 2) {
          return { success: false, error: 'Could not find index.js code block in LLM response' };
        }
        // First block is manifest, second is code
        const manifest = JSON.parse(allBlocks[0][1].trim());
        const indexJs = allBlocks[1][1].trim();
        return { success: true, manifest, indexJs };
      }

      // Parse manifest from first match
      const manifestStr = manifestMatch[1].trim();
      const manifest = JSON.parse(manifestStr);

      // Parse code from the second code block (skip the json one)
      const secondBlock = codeMatch[codeMatch.length - 1];
      const indexJs = secondBlock.replace(/```(?:javascript|js)?[\s]*(?:index\.js)?\s*\n/, '').replace(/```$/, '').trim();

      return { success: true, manifest, indexJs };
    } catch (err) {
      return { success: false, error: `Failed to parse LLM response: ${err.message}` };
    }
  }

  /**
   * Validate the generated plugin
   */
  _validate(manifest, indexJs) {
    const errors = [];

    // Manifest checks
    if (!manifest.id || typeof manifest.id !== 'string') errors.push('Missing or invalid manifest.id');
    if (!manifest.name) errors.push('Missing manifest.name');
    if (!manifest.version) errors.push('Missing manifest.version');
    if (!manifest.main) errors.push('Missing manifest.main');
    if (manifest.id && !/^[a-z0-9-]+$/.test(manifest.id)) errors.push('Plugin id must be lowercase kebab-case');

    // Code checks
    if (!indexJs.includes('activate')) errors.push('index.js must export activate()');
    if (!indexJs.includes('deactivate')) errors.push('index.js must export deactivate()');
    if (!indexJs.includes('module.exports')) errors.push('index.js must use module.exports');

    // Security checks
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(indexJs)) {
        errors.push(`Forbidden pattern detected: ${pattern.source}`);
      }
    }

    // If sidebar hook declared, check for renderPage
    if (manifest.hooks?.sidebar && !indexJs.includes('renderPage')) {
      errors.push('Sidebar hook declared but renderPage() not found');
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Attempt self-correction by feeding errors back to the LLM
   */
  async _selfCorrect(userRequest, previousResponse, errors) {
    console.log(`${LOG} Attempting self-correction...`);

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Create a plugin that: ${userRequest}` },
      { role: 'assistant', content: previousResponse },
      {
        role: 'user',
        content: `The generated plugin has these issues:\n${errors.map(e => `- ${e}`).join('\n')}\n\nPlease fix these issues and output the corrected plugin.json and index.js code blocks.`,
      },
    ];

    const response = await this._agentChat(messages);
    if (!response || response.startsWith('__ERROR__:')) {
      return { success: false };
    }

    const parsed = this._parseResponse(response);
    if (!parsed.success) return { success: false };

    const validation = this._validate(parsed.manifest, parsed.indexJs);
    if (!validation.valid) {
      console.log(`${LOG} Self-correction still has errors:`, validation.errors);
      return { success: false };
    }

    return { success: true, manifest: parsed.manifest, indexJs: parsed.indexJs };
  }

  /**
   * Write plugin files to disk
   */
  _writePlugin(pluginId, manifest, indexJs) {
    try {
      const pluginsDir = this._pluginManager
        ? this._pluginManager.getPluginsDir()
        : path.join(require('electron').app.getPath('home'), '.iimagine', 'plugins');

      const pluginDir = path.join(pluginsDir, pluginId);

      // Backup existing if present
      if (fs.existsSync(pluginDir)) {
        const historyDir = path.join(pluginDir, '.history');
        if (!fs.existsSync(historyDir)) fs.mkdirSync(historyDir, { recursive: true });
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupDir = path.join(historyDir, timestamp);
        fs.mkdirSync(backupDir, { recursive: true });

        // Copy current files to backup
        const filesToBackup = ['plugin.json', 'index.js'];
        for (const file of filesToBackup) {
          const src = path.join(pluginDir, file);
          if (fs.existsSync(src)) {
            fs.copyFileSync(src, path.join(backupDir, file));
          }
        }

        // Prune old backups (keep max 5)
        const backups = fs.readdirSync(historyDir).sort().reverse();
        for (const old of backups.slice(5)) {
          fs.rmSync(path.join(historyDir, old), { recursive: true, force: true });
        }
      } else {
        fs.mkdirSync(pluginDir, { recursive: true });
      }

      // Write manifest
      fs.writeFileSync(
        path.join(pluginDir, 'plugin.json'),
        JSON.stringify(manifest, null, 2),
        'utf-8'
      );

      // Write code
      fs.writeFileSync(path.join(pluginDir, 'index.js'), indexJs, 'utf-8');

      console.log(`${LOG} Files written to ${pluginDir}`);
      return { success: true, dir: pluginDir };
    } catch (err) {
      return { success: false, error: `Failed to write plugin files: ${err.message}` };
    }
  }

  /**
   * Delete an AI-generated plugin
   */
  delete(pluginId) {
    if (this._pluginManager) {
      this._pluginManager.uninstall(pluginId);
      return { success: true };
    }
    return { success: false, error: 'Plugin manager not available' };
  }

  /**
   * List AI-generated plugins
   */
  listGenerated() {
    if (!this._pluginManager) return [];
    return this._pluginManager.getAll().filter(p => {
      // Check if it's AI-generated by reading the manifest
      const pluginsDir = this._pluginManager.getPluginsDir();
      const manifestPath = path.join(pluginsDir, p.id, 'plugin.json');
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        return manifest.author === 'ai-generated';
      } catch {
        return false;
      }
    });
  }

  /**
   * Check if a user message is a plugin generation request
   * Returns { isPluginRequest: boolean, action: 'create'|'modify'|'delete', pluginId? }
   */
  detectIntent(message) {
    const lower = message.toLowerCase().trim();

    // Delete patterns
    const deleteMatch = lower.match(/(?:delete|remove|uninstall)\s+(?:my\s+|the\s+)?(?:plugin\s+)?["']?([a-z0-9 -]+)["']?\s*(?:plugin)?/);
    if (deleteMatch) {
      const id = deleteMatch[1].trim().replace(/\s+/g, '-');
      return { isPluginRequest: true, action: 'delete', pluginId: id };
    }

    // Modify patterns
    const modifyPatterns = [
      /(?:update|change|modify|edit|fix|improve|add .+ to)\s+(?:my\s+|the\s+)?(.+?)\s+plugin/,
      /(?:in|on)\s+(?:my\s+|the\s+)?(.+?)\s+plugin[,:]?\s+(.+)/,
      /^fix\s+(?:my\s+|the\s+)?(.+?)(?:\s+plugin)?$/,
    ];
    for (const pattern of modifyPatterns) {
      const match = lower.match(pattern);
      if (match) {
        const id = match[1].trim().replace(/\s+/g, '-');
        return { isPluginRequest: true, action: 'modify', pluginId: id };
      }
    }

    // Create patterns
    const createPatterns = [
      /^(?:build|create|make|generate)\s+(?:me\s+)?a?\s*plugin/,
      /^(?:build|create|make|generate)\s+(?:me\s+)?a?\s*(?:tool|page|tracker|dashboard|app|widget|timer|log|journal|counter|calculator|list|board|chart)/,
      /^(?:i want|i need|can you (?:build|create|make))\s+a?\s*plugin/,
      /^(?:i want|i need)\s+a?\s*(?:tool|page|tracker|dashboard|app|widget|timer|log|journal|counter|calculator|list|board|chart)/,
      /^add\s+a\s+(?:page|tool|tracker|plugin)\s+(?:that|which|for|to)/,
      /^(?:build|create|make|generate)\s+(?:me\s+)?a\s+\w+\s+(?:tracker|plugin|tool|page|dashboard|app|widget|timer|log|journal|counter|calculator|list|board|chart)/,
    ];
    for (const pattern of createPatterns) {
      if (pattern.test(lower)) {
        return { isPluginRequest: true, action: 'create' };
      }
    }

    // Check if message references a known AI-generated plugin — treat as modify
    if (this._pluginManager) {
      const generated = this.listGenerated();
      for (const plugin of generated) {
        const nameWords = plugin.name.toLowerCase().replace(/[^a-z0-9 ]/g, '');
        const idWords = plugin.id.replace(/-/g, ' ');
        if (lower.includes(nameWords) || lower.includes(idWords) || lower.includes(plugin.id)) {
          return { isPluginRequest: true, action: 'modify', pluginId: plugin.id };
        }
      }
    }

    return { isPluginRequest: false };
  }
}

module.exports = new PluginGenerator();
