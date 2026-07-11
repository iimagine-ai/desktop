// MCP Client Manager — spawns and manages MCP server processes
// Provides tool discovery and execution for the chat pipeline

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

class MCPClientManager {
  constructor() {
    this._sessions = new Map(); // serverId → { process, client, tools[], status }
    this._config = null;
    this._configPath = null;
    this._sdk = null; // Lazy-loaded ESM SDK
  }

  /**
   * Initialize — load config, optionally auto-connect enabled servers
   */
  async init() {
    this._configPath = path.join(app.getPath('userData'), 'mcp.json');
    this._config = this._loadConfig();
    console.log('[MCP] Initialized with', Object.keys(this._config.servers).length, 'configured servers');

    // Auto-connect any servers marked as enabled + autoConnect
    for (const [id, server] of Object.entries(this._config.servers)) {
      if (server.enabled && server.autoConnect) {
        try {
          await this.connect(id);
        } catch (err) {
          console.error(`[MCP] Auto-connect failed for ${id}:`, err.message);
        }
      }
    }
  }

  /**
   * Load or create the MCP config file
   */
  _loadConfig() {
    const defaultConfig = {
      servers: {
        'google-workspace': {
          name: 'Google Workspace',
          description: 'Gmail, Calendar, Docs, Sheets, Drive',
          command: process.execPath,
          args: [path.join(__dirname, 'mcp-servers', 'google-workspace', 'server.mjs')],
          env: {
            GOOGLE_WORKSPACE_CLIENT_ID: '',
            GOOGLE_WORKSPACE_CLIENT_SECRET: '',
            GOOGLE_WORKSPACE_REFRESH_TOKEN: ''
          },
          transport: 'stdio',
          enabled: false,
          autoConnect: false,
          category: 'productivity'
        },
        'filesystem': {
          name: 'Local Files',
          description: 'Read and search files on your computer',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '~/Documents'],
          env: { PATH: process.env.PATH || '' },
          transport: 'stdio',
          enabled: false,
          autoConnect: false,
          category: 'local'
        },
        'brave-search': {
          name: 'Web Search',
          description: 'Search the web via Brave Search',
          command: path.join(app.getPath('home'), '.local/bin/uvx'),
          args: ['mcp-server-brave-search'],
          env: { BRAVE_API_KEY: '' },
          transport: 'stdio',
          enabled: false,
          autoConnect: false,
          category: 'search'
        }
      }
    };

    try {
      if (fs.existsSync(this._configPath)) {
        const raw = fs.readFileSync(this._configPath, 'utf8');
        const parsed = JSON.parse(raw);
        // Merge with defaults (add new servers user doesn't have)
        for (const [id, server] of Object.entries(defaultConfig.servers)) {
          if (!parsed.servers[id]) {
            parsed.servers[id] = server;
          }
        }
        return parsed;
      }
    } catch (err) {
      console.error('[MCP] Config read error:', err.message);
    }

    // Write default config
    this._saveConfig(defaultConfig);
    return defaultConfig;
  }

  _saveConfig(config) {
    try {
      const dir = path.dirname(this._configPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this._configPath, JSON.stringify(config || this._config, null, 2));
    } catch (err) {
      console.error('[MCP] Config save error:', err.message);
    }
  }

  /**
   * Lazy-load the ESM MCP SDK (since we're in CJS)
   */
  async _getSDK() {
    if (!this._sdk) {
      const clientMod = await import('@modelcontextprotocol/sdk/client/index.js');
      const stdioMod = await import('@modelcontextprotocol/sdk/client/stdio.js');
      this._sdk = {
        Client: clientMod.Client,
        StdioClientTransport: stdioMod.StdioClientTransport
      };
    }
    return this._sdk;
  }

  /**
   * Connect to an MCP server by its config ID
   */
  async connect(serverId) {
    const serverConfig = this._config.servers[serverId];
    if (!serverConfig) throw new Error(`Server "${serverId}" not found in config`);

    // Disconnect existing if running
    if (this._sessions.has(serverId)) {
      await this.disconnect(serverId);
    }

    console.log(`[MCP] Connecting to ${serverId} (${serverConfig.name})...`);

    try {
      const sdk = await this._getSDK();
      const { Client } = sdk;
      const { StdioClientTransport } = sdk;

      // Resolve ~ in args
      const resolvedArgs = (serverConfig.args || []).map(arg =>
        arg.replace(/^~/, app.getPath('home'))
      );

      // Build environment
      const env = { ...process.env, ...(serverConfig.env || {}) };

      // Create transport
      const transport = new StdioClientTransport({
        command: serverConfig.command,
        args: resolvedArgs,
        env
      });

      // Create client
      const client = new Client(
        { name: 'iimagine-desktop', version: '1.0.0' },
        { capabilities: {} }
      );

      // Connect
      await client.connect(transport);

      // Discover tools
      const toolsResult = await client.listTools();
      const tools = toolsResult.tools || [];

      console.log(`[MCP] Connected to ${serverId} — ${tools.length} tools available`);

      // Store session
      this._sessions.set(serverId, {
        client,
        transport,
        tools,
        status: 'connected',
        connectedAt: Date.now()
      });

      // Update config status
      serverConfig.enabled = true;
      this._saveConfig();

      return { success: true, tools: tools.map(t => ({ name: t.name, description: t.description })) };
    } catch (err) {
      console.error(`[MCP] Connection failed for ${serverId}:`, err.message);
      this._sessions.set(serverId, { client: null, transport: null, tools: [], status: 'error', error: err.message });
      throw err;
    }
  }

  /**
   * Disconnect from a server
   */
  async disconnect(serverId) {
    const session = this._sessions.get(serverId);
    if (!session) return;

    try {
      if (session.client) {
        await session.client.close();
      }
    } catch (err) {
      console.warn(`[MCP] Disconnect warning for ${serverId}:`, err.message);
    }

    this._sessions.delete(serverId);

    // Update config
    if (this._config.servers[serverId]) {
      this._config.servers[serverId].enabled = false;
      this._saveConfig();
    }

    console.log(`[MCP] Disconnected from ${serverId}`);
  }

  /**
   * Get all configured servers with their current status
   */
  getServers() {
    const servers = {};
    for (const [id, config] of Object.entries(this._config.servers)) {
      const session = this._sessions.get(id);
      servers[id] = {
        ...config,
        status: session?.status || 'disconnected',
        error: session?.error || null,
        toolCount: session?.tools?.length || 0,
        connectedAt: session?.connectedAt || null
      };
    }
    return servers;
  }

  /**
   * Get all tools from all connected servers (for LLM tool injection)
   */
  getAllTools() {
    const tools = [];
    for (const [serverId, session] of this._sessions) {
      if (session.status !== 'connected') continue;
      for (const tool of session.tools) {
        tools.push({
          serverId,
          serverName: this._config.servers[serverId]?.name || serverId,
          name: tool.name,
          description: tool.description || '',
          inputSchema: tool.inputSchema || { type: 'object', properties: {} }
        });
      }
    }
    return tools;
  }

  /**
   * Convert MCP tools to OpenAI function-calling format
   */
  getToolsAsOpenAIFunctions() {
    return this.getAllTools().map(tool => ({
      type: 'function',
      function: {
        name: `mcp_${tool.serverId}_${tool.name}`,
        description: `[${tool.serverName}] ${tool.description}`,
        parameters: tool.inputSchema
      }
    }));
  }

  /**
   * Execute a tool call on a specific server
   */
  async callTool(serverId, toolName, args) {
    const session = this._sessions.get(serverId);
    if (!session || session.status !== 'connected') {
      throw new Error(`Server "${serverId}" is not connected`);
    }

    console.log(`[MCP] Calling tool ${serverId}:${toolName}`, JSON.stringify(args).slice(0, 200));

    try {
      const result = await session.client.callTool({ name: toolName, arguments: args });
      return { success: true, result };
    } catch (err) {
      console.error(`[MCP] Tool call failed (${serverId}:${toolName}):`, err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Check if a tool call is a "write" operation that requires user confirmation
   * Write operations: send, create, delete, update, write, post, modify, remove
   */
  isWriteOperation(toolName) {
    const writePatterns = /^(send|create|delete|update|write|post|modify|remove|add|insert|put|patch|move|archive|trash)/i;
    return writePatterns.test(toolName);
  }

  /**
   * Parse an OpenAI-format tool call name back to serverId + toolName
   * Format: mcp_<serverId>_<toolName>
   */
  parseToolCallName(fullName) {
    if (!fullName.startsWith('mcp_')) return null;
    const withoutPrefix = fullName.slice(4); // remove "mcp_"
    // Find which server ID matches
    for (const serverId of this._sessions.keys()) {
      if (withoutPrefix.startsWith(serverId + '_')) {
        const toolName = withoutPrefix.slice(serverId.length + 1);
        return { serverId, toolName };
      }
    }
    return null;
  }

  /**
   * Add a custom server configuration
   */
  addServer(id, config) {
    this._config.servers[id] = {
      name: config.name || id,
      description: config.description || '',
      command: config.command,
      args: config.args || [],
      env: config.env || {},
      transport: config.transport || 'stdio',
      enabled: false,
      autoConnect: false,
      category: 'custom'
    };
    this._saveConfig();
    return this._config.servers[id];
  }

  /**
   * Remove a server configuration
   */
  removeServer(id) {
    if (this._sessions.has(id)) {
      this.disconnect(id);
    }
    delete this._config.servers[id];
    this._saveConfig();
  }

  /**
   * Update server config (e.g. env vars for API keys)
   */
  updateServer(id, updates) {
    if (!this._config.servers[id]) throw new Error(`Server ${id} not found`);
    Object.assign(this._config.servers[id], updates);
    this._saveConfig();
    return this._config.servers[id];
  }

  /**
   * Shutdown all connections (call on app quit)
   */
  async shutdown() {
    console.log('[MCP] Shutting down all connections...');
    for (const serverId of this._sessions.keys()) {
      await this.disconnect(serverId);
    }
  }
}

module.exports = MCPClientManager;
