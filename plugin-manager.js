// Plugin Manager — WordPress-style plugin system
// Discovers, loads, and manages plugins from ~/.iimagine/plugins/
//
// Plugin structure:
//   ~/.iimagine/plugins/my-plugin/
//     plugin.json    — manifest (name, version, description, author, main, hooks)
//     index.js       — main entry point, exports activate/deactivate functions
//
// Plugin manifest (plugin.json):
// {
//   "id": "my-plugin",
//   "name": "My Plugin",
//   "version": "1.0.0",
//   "description": "Does something useful",
//   "author": "Dev Name",
//   "main": "index.js",
//   "hooks": {
//     "sidebar": { "label": "My Page", "icon": "🔧" },
//     "settings": true,
//     "chatPreprocess": true,
//     "chatPostprocess": true,
//     "mention": { "name": "my-plugin", "description": "What this plugin does when mentioned" }
//   }
// }
//
// Plugin entry (index.js) exports:
// {
//   activate(context)    — called when plugin is enabled
//   deactivate()         — called when plugin is disabled
//   onChatPreprocess?({ messages, assistant }) → { messages }
//   onChatPostprocess?({ response, assistant }) → { response }
//   renderPage?(container) — renders sidebar page content
//   renderSettings?(container) — renders settings panel
// }

const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const Store = require('electron-store');
const licenseChecker = require('./license-checker');

const store = new Store();

class PluginManager {
  constructor() {
    this.plugins = new Map(); // id → { manifest, instance, enabled }
    this.pluginsDir = path.join(app.getPath('home'), '.iimagine', 'plugins');
    this._context = null;
  }

  // Set the context that plugins receive on activation
  setContext(context) {
    this._context = context;
  }

  getPluginsDir() {
    if (!fs.existsSync(this.pluginsDir)) {
      fs.mkdirSync(this.pluginsDir, { recursive: true });
    }
    return this.pluginsDir;
  }

  // Discover all plugins in the plugins directory
  discover() {
    const dir = this.getPluginsDir();
    const entries = [];

    try {
      const folders = fs.readdirSync(dir, { withFileTypes: true });
      for (const folder of folders) {
        if (!folder.isDirectory()) continue;
        const manifestPath = path.join(dir, folder.name, 'plugin.json');
        if (!fs.existsSync(manifestPath)) continue;

        try {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
          manifest.id = manifest.id || folder.name;
          manifest._dir = path.join(dir, folder.name);
          entries.push(manifest);
        } catch (err) {
          console.warn(`[Plugin] Failed to parse ${manifestPath}:`, err.message);
        }
      }
    } catch (err) {
      console.warn('[Plugin] Failed to read plugins dir:', err.message);
    }

    return entries;
  }

  // Load and activate all enabled plugins
  loadAll() {
    const manifests = this.discover();
    const enabledMap = store.get('plugins.enabled', {});

    for (const manifest of manifests) {
      const enabled = enabledMap[manifest.id] !== false; // enabled by default
      this.plugins.set(manifest.id, { manifest, instance: null, enabled });

      if (enabled) {
        this._activate(manifest.id);
      }
    }

    console.log(`[Plugin] Loaded ${this.plugins.size} plugins, ${[...this.plugins.values()].filter(p => p.enabled).length} active`);
  }

  _activate(pluginId) {
    const plugin = this.plugins.get(pluginId);
    if (!plugin || plugin.instance) return;

    try {
      const mainFile = path.join(plugin.manifest._dir, plugin.manifest.main || 'index.js');
      if (!fs.existsSync(mainFile)) {
        console.warn(`[Plugin] ${pluginId}: main file not found at ${mainFile}`);
        return;
      }

      // Clear require cache to allow reloading
      delete require.cache[require.resolve(mainFile)];
      const instance = require(mainFile);

      if (typeof instance.activate === 'function') {
        instance.activate(this._context || {});
      }

      plugin.instance = instance;
      plugin.enabled = true;
      console.log(`[Plugin] Activated: ${plugin.manifest.name} v${plugin.manifest.version}`);
    } catch (err) {
      console.error(`[Plugin] Failed to activate ${pluginId}:`, err.message);
      plugin.instance = null;
    }
  }

  _deactivate(pluginId) {
    const plugin = this.plugins.get(pluginId);
    if (!plugin || !plugin.instance) return;

    try {
      if (typeof plugin.instance.deactivate === 'function') {
        plugin.instance.deactivate();
      }
    } catch (err) {
      console.warn(`[Plugin] Error deactivating ${pluginId}:`, err.message);
    }

    plugin.instance = null;
    plugin.enabled = false;
    console.log(`[Plugin] Deactivated: ${plugin.manifest.name}`);
  }

  // Enable/disable a plugin and persist state
  setEnabled(pluginId, enabled) {
    const enabledMap = store.get('plugins.enabled', {});
    enabledMap[pluginId] = enabled;
    store.set('plugins.enabled', enabledMap);

    if (enabled) {
      this._activate(pluginId);
    } else {
      this._deactivate(pluginId);
    }
  }

  // Check license for a paid plugin (async, called from IPC)
  async checkLicense(pluginId) {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return { valid: false, reason: 'not_found' };
    return await licenseChecker.check(pluginId, plugin.manifest);
  }

  // Get license checker instance (for IPC handlers)
  getLicenseChecker() {
    return licenseChecker;
  }

  // Get list of all plugins with status
  getAll() {
    return [...this.plugins.values()].map(p => ({
      id: p.manifest.id,
      name: p.manifest.name,
      version: p.manifest.version,
      description: p.manifest.description,
      author: p.manifest.author,
      enabled: p.enabled,
      hooks: p.manifest.hooks || {},
      hasInstance: !!p.instance,
    }));
  }

  // Get active plugins that have a specific hook
  getWithHook(hookName) {
    return [...this.plugins.values()]
      .filter(p => p.enabled && p.instance && p.manifest.hooks?.[hookName])
      .map(p => ({ id: p.manifest.id, manifest: p.manifest, instance: p.instance }));
  }

  // Get all plugins that can be @-mentioned
  getMentions() {
    const mentions = [
      // Built-in @agent mention — always available
      { pluginId: '__agent__', name: 'agent', description: 'Break task into steps and execute sequentially' },
    ];
    for (const [id, plugin] of this.plugins) {
      if (!plugin.enabled || !plugin.instance) continue;
      if (plugin.manifest.hooks?.mention) {
        mentions.push({
          pluginId: id,
          name: plugin.manifest.hooks.mention.name || id,
          description: plugin.manifest.hooks.mention.description || plugin.manifest.description || '',
        });
      }
    }
    return mentions;
  }

  // Run chat preprocess hooks (modify messages before sending to LLM)
  async runChatPreprocess(data) {
    let result = { ...data };

    // If specific mentions are provided, only run those plugins
    if (data.mentions && data.mentions.length > 0) {
      for (const mention of data.mentions) {
        const plugin = this.plugins.get(mention.pluginId);
        if (plugin?.enabled && plugin?.instance?.onChatPreprocess) {
          try {
            result = await plugin.instance.onChatPreprocess(result);
          } catch (err) {
            console.warn(`[Plugin] ${mention.pluginId} mention preprocess error:`, err.message);
          }
        }
      }
      return result;
    }

    // Otherwise run all plugins with chatPreprocess hook (existing behavior)
    const preprocessPlugins = this.getWithHook('chatPreprocess');
    console.log(`[Plugin] Running chatPreprocess on ${preprocessPlugins.length} plugins: ${preprocessPlugins.map(p => p.id).join(', ')}`);
    for (const p of preprocessPlugins) {
      try {
        if (typeof p.instance.onChatPreprocess === 'function') {
          result = await p.instance.onChatPreprocess(result);
        }
      } catch (err) {
        console.warn(`[Plugin] ${p.id} chatPreprocess error:`, err.message);
      }
    }
    return result;
  }

  // Run chat postprocess hooks (modify response after LLM)
  async runChatPostprocess(data) {
    let result = data;

    // If specific mentions are provided, only run those plugins
    if (data.mentions && data.mentions.length > 0) {
      for (const mention of data.mentions) {
        const plugin = this.plugins.get(mention.pluginId);
        if (plugin?.enabled && plugin?.instance?.onChatPostprocess) {
          try {
            result = await plugin.instance.onChatPostprocess(result);
          } catch (err) {
            console.warn(`[Plugin] ${mention.pluginId} mention postprocess error:`, err.message);
          }
        }
      }
      return result;
    }

    // Otherwise run all plugins with chatPostprocess hook
    for (const p of this.getWithHook('chatPostprocess')) {
      try {
        if (typeof p.instance.onChatPostprocess === 'function') {
          result = await p.instance.onChatPostprocess(result);
        }
      } catch (err) {
        console.warn(`[Plugin] ${p.id} chatPostprocess error:`, err.message);
      }
    }
    return result;
  }

  // Get all registered slash commands from plugins
  getCommands() {
    const commands = [];
    for (const [id, plugin] of this.plugins) {
      if (!plugin.enabled || !plugin.instance) continue;
      if (typeof plugin.instance.getCommands === 'function') {
        try {
          const cmds = plugin.instance.getCommands();
          if (Array.isArray(cmds)) {
            commands.push(...cmds.map(c => ({ ...c, pluginId: id })));
          }
        } catch (err) {
          console.warn(`[Plugin] ${id} getCommands error:`, err.message);
        }
      }
    }
    return commands;
  }

  // Get sidebar items from plugins
  getSidebarItems() {
    return this.getWithHook('sidebar').map(p => ({
      id: p.manifest.id,
      label: p.manifest.hooks.sidebar.label || p.manifest.name,
      icon: p.manifest.hooks.sidebar.icon || '🔌',
    }));
  }

  // Render a plugin's page
  getPageRenderer(pluginId) {
    const plugin = this.plugins.get(pluginId);
    if (!plugin?.instance?.renderPage) return null;
    return plugin.instance.renderPage;
  }

  // Render a plugin's settings
  getSettingsRenderer(pluginId) {
    const plugin = this.plugins.get(pluginId);
    if (!plugin?.instance?.renderSettings) return null;
    return plugin.instance.renderSettings;
  }

  // Install a plugin from a directory path (copy to plugins dir)
  install(sourcePath) {
    const manifestPath = path.join(sourcePath, 'plugin.json');
    if (!fs.existsSync(manifestPath)) {
      return { success: false, error: 'No plugin.json found' };
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const destDir = path.join(this.getPluginsDir(), manifest.id || path.basename(sourcePath));

    if (fs.existsSync(destDir)) {
      fs.rmSync(destDir, { recursive: true });
    }

    // Copy plugin directory
    fs.cpSync(sourcePath, destDir, { recursive: true });

    // Reload
    manifest._dir = destDir;
    this.plugins.set(manifest.id, { manifest, instance: null, enabled: true });
    this._activate(manifest.id);

    const enabledMap = store.get('plugins.enabled', {});
    enabledMap[manifest.id] = true;
    store.set('plugins.enabled', enabledMap);

    return { success: true, id: manifest.id };
  }

  // Uninstall a plugin
  uninstall(pluginId) {
    this._deactivate(pluginId);
    this.plugins.delete(pluginId);

    const dir = path.join(this.getPluginsDir(), pluginId);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true });
    }

    const enabledMap = store.get('plugins.enabled', {});
    delete enabledMap[pluginId];
    store.set('plugins.enabled', enabledMap);

    return true;
  }
}

module.exports = new PluginManager();
