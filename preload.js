// Preload script — exposes safe APIs to the renderer process
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Auth
  auth: {
    getUser: () => ipcRenderer.invoke('auth:getUser'),
    getToken: () => ipcRenderer.invoke('auth:getToken'),
    isRequired: () => ipcRenderer.invoke('auth:isRequired'),
    // Legacy stubs — kept for renderer compatibility
    login: () => ipcRenderer.invoke('auth:login'),
    exchangeCode: (code) => ipcRenderer.invoke('auth:exchangeCode', code),
    logout: () => ipcRenderer.invoke('auth:logout'),
    validate: () => ipcRenderer.invoke('auth:validate'),
    onSuccess: (cb) => ipcRenderer.on('auth-success', (_, user) => cb(user)),
    onError: (cb) => ipcRenderer.on('auth-error', (_, error) => cb(error)),
  },



  // Model Orchestrator — instant swap & preloading
  modelSwap: {
    switch: (modelName) => ipcRenderer.invoke('model:switch', modelName),
    preload: (modelName) => ipcRenderer.invoke('model:preload', modelName),
    keepAlive: (modelName) => ipcRenderer.invoke('model:keepAlive', modelName),
    getState: () => ipcRenderer.invoke('model:getState'),
    getLoadedModels: () => ipcRenderer.invoke('model:getLoadedModels'),
    onSwitchStart: (cb) => ipcRenderer.on('model:switch-start', (_, data) => cb(data)),
    onSwitchProgress: (cb) => ipcRenderer.on('model:switch-progress', (_, data) => cb(data)),
    onSwitchComplete: (cb) => ipcRenderer.on('model:switch-complete', (_, data) => cb(data)),
    onSwitchError: (cb) => ipcRenderer.on('model:switch-error', (_, data) => cb(data)),
    onPreloadStart: (cb) => ipcRenderer.on('model:preload-start', (_, data) => cb(data)),
    onPreloadComplete: (cb) => ipcRenderer.on('model:preload-complete', (_, data) => cb(data)),
  },

  // IIMAGINE Engine (bundled llama.cpp — shows as "iimagine-engine" in Activity Monitor)
  engine: {
    status: () => ipcRenderer.invoke('engine:status'),
    start: (modelPath, options) => ipcRenderer.invoke('engine:start', { modelPath, options }),
    stop: () => ipcRenderer.invoke('engine:stop'),
    switch: (modelPath, options) => ipcRenderer.invoke('engine:switch', { modelPath, options }),
    getModelsDir: () => ipcRenderer.invoke('engine:getModelsDir'),
    getInstalledModels: () => ipcRenderer.invoke('engine:getInstalledModels'),
    deleteModel: (filename) => ipcRenderer.invoke('engine:deleteModel', filename),
    getRegistry: () => ipcRenderer.invoke('engine:getRegistry'),
    downloadModel: (url, filename) => ipcRenderer.invoke('engine:downloadModel', { url, filename }),
    cancelDownload: () => ipcRenderer.invoke('engine:cancelDownload'),
    chatStream: (messages) => ipcRenderer.invoke('engine:chatStream', { messages }),
    embed: (text) => ipcRenderer.invoke('engine:embed', { text }),
    embedBatch: (texts) => ipcRenderer.invoke('engine:embedBatch', { texts }),
    isInstalled: () => ipcRenderer.invoke('engine:isInstalled'),
    health: () => ipcRenderer.invoke('engine:health'),
    onDownloadProgress: (cb) => ipcRenderer.on('engine:download-progress', (_, data) => cb(data)),
    onDownloadDone: (cb) => ipcRenderer.on('engine:download-done', (_, data) => cb(data)),
    onStarted: (cb) => ipcRenderer.on('engine:started', (_, data) => cb(data)),
    onSwitching: (cb) => ipcRenderer.on('engine:switching', (_, data) => cb(data)),
    onLoadProgress: (cb) => ipcRenderer.on('engine:loadProgress', (_, data) => cb(data)),
    onStats: (cb) => ipcRenderer.on('engine:stats', (_, data) => cb(data)),
  },

  // Local AI — unified interface (preferred for new code)
  // Routes through iimagine-engine.
  localAI: {
    status: () => ipcRenderer.invoke('localAI:status'),
    ensureRunning: () => ipcRenderer.invoke('localAI:ensureRunning'),
    embed: (text, model) => ipcRenderer.invoke('localAI:embed', { text, model }),
    chat: (model, messages, options) => ipcRenderer.invoke('localAI:chat', { model, messages, options }),
    hasModel: (modelName) => ipcRenderer.invoke('localAI:hasModel', modelName),
    getBestChatModel: () => ipcRenderer.invoke('localAI:getBestChatModel'),
    // Streaming uses engine channels
    chatStream: (messages) => ipcRenderer.invoke('engine:chatStream', { messages }),
    onStreamChunk: (cb) => ipcRenderer.on('localAI:stream-chunk', (_, chunk) => cb(chunk)),
    onStreamDone: (cb) => ipcRenderer.on('localAI:stream-done', () => cb()),
    // Model management (delegates to engine)
    getModelsDir: () => ipcRenderer.invoke('engine:getModelsDir'),
    getInstalledModels: () => ipcRenderer.invoke('engine:getInstalledModels'),
    getRegistry: () => ipcRenderer.invoke('engine:getRegistry'),
    downloadModel: (url, filename) => ipcRenderer.invoke('engine:downloadModel', { url, filename }),
    cancelDownload: () => ipcRenderer.invoke('engine:cancelDownload'),
    deleteModel: (filename) => ipcRenderer.invoke('engine:deleteModel', filename),
    onDownloadProgress: (cb) => ipcRenderer.on('engine:download-progress', (_, data) => cb(data)),
    onDownloadDone: (cb) => ipcRenderer.on('engine:download-done', (_, data) => cb(data)),
  },

  // Vertex AI (regional cloud)
  vertex: {
    chat: (messages, model, region) => ipcRenderer.invoke('vertex:chat', { messages, model, region }),
    onStreamChunk: (cb) => ipcRenderer.on('vertex:stream-chunk', (_, chunk) => cb(chunk)),
    onStreamDone: (cb) => ipcRenderer.on('vertex:stream-done', () => cb()),
  },

  // AI Gateway (cloud models, no privacy guarantee)
  gateway: {
    chat: (messages, model) => ipcRenderer.invoke('gateway:chat', { messages, model }),
    onStreamChunk: (cb) => ipcRenderer.on('gateway:stream-chunk', (_, chunk) => cb(chunk)),
    onStreamDone: (cb) => ipcRenderer.on('gateway:stream-done', () => cb()),
    onClearIndicator: (cb) => ipcRenderer.on('gateway:clear-indicator', () => cb()),
  },

  // Settings
  settings: {
    get: (key) => ipcRenderer.invoke('settings:get', key),
    set: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  },

  // Storage — local SQLite
  storage: {
    // Conversations
    createConversation: (data) => ipcRenderer.invoke('storage:createConversation', data),
    getConversations: (limit) => ipcRenderer.invoke('storage:getConversations', limit),
    getConversationsForProject: (projectId, limit) => ipcRenderer.invoke('storage:getConversationsForProject', projectId, limit),
    getConversation: (id) => ipcRenderer.invoke('storage:getConversation', id),
    updateConversationTitle: (id, title) => ipcRenderer.invoke('storage:updateConversationTitle', id, title),
    deleteConversation: (id) => ipcRenderer.invoke('storage:deleteConversation', id),
    // Messages
    addMessage: (data) => ipcRenderer.invoke('storage:addMessage', data),
    getMessages: (conversationId, limit) => ipcRenderer.invoke('storage:getMessages', conversationId, limit),
    // Stats
    getStats: () => ipcRenderer.invoke('storage:getStats'),
    getDbPath: () => ipcRenderer.invoke('storage:getDbPath'),
  },


  // Chat — stop/abort active stream
  chat: {
    stop: () => ipcRenderer.invoke('chat:stop'),
    onStreamStopped: (cb) => ipcRenderer.on('chat:stream-stopped', () => cb()),
    readFile: (filePath) => ipcRenderer.invoke('chat:readFile', filePath),
    pickFile: () => ipcRenderer.invoke('chat:pickFile'),
  },

  // Plugins
  plugins: {
    list: () => ipcRenderer.invoke('plugins:list'),
    setEnabled: (id, enabled) => ipcRenderer.invoke('plugins:setEnabled', id, enabled),
    getSidebarItems: () => ipcRenderer.invoke('plugins:getSidebarItems'),
    renderPage: (pluginId) => ipcRenderer.invoke('plugins:renderPage', pluginId),
    renderSettings: (pluginId) => ipcRenderer.invoke('plugins:renderSettings', pluginId),
    sendEvent: (event, data) => ipcRenderer.invoke('plugins:event', event, data),
    getDir: () => ipcRenderer.invoke('plugins:getDir'),
    openFolder: (pluginId) => ipcRenderer.invoke('plugins:openFolder', pluginId),
    install: () => ipcRenderer.invoke('plugins:install'),
    uninstall: (id) => ipcRenderer.invoke('plugins:uninstall', id),
    chatPreprocess: (data) => ipcRenderer.invoke('plugins:chatPreprocess', data),
    chatPostprocess: (data) => ipcRenderer.invoke('plugins:chatPostprocess', data),
    modelRegister: () => ipcRenderer.invoke('plugins:modelRegister'),
    providerRegister: () => ipcRenderer.invoke('plugins:providerRegister'),
    providerChat: (pluginId, messages, model) => ipcRenderer.invoke('plugins:providerChat', { pluginId, messages, model }),
    getCommands: () => ipcRenderer.invoke('plugins:getCommands'),
    getMentions: () => ipcRenderer.invoke('plugins:getMentions'),
    checkLicense: (pluginId) => ipcRenderer.invoke('plugins:checkLicense', pluginId),
    getAllLicenses: () => ipcRenderer.invoke('plugins:getAllLicenses'),
    // File operations — sandboxed per plugin
    fileSave: (pluginId, filename, base64Data) => ipcRenderer.invoke('plugins:fileSave', { pluginId, filename, base64Data }),
    fileList: (pluginId) => ipcRenderer.invoke('plugins:fileList', { pluginId }),
    fileRead: (pluginId, filename) => ipcRenderer.invoke('plugins:fileRead', { pluginId, filename }),
    fileDelete: (pluginId, filename) => ipcRenderer.invoke('plugins:fileDelete', { pluginId, filename }),
    fileGetPath: (pluginId, filename) => ipcRenderer.invoke('plugins:fileGetPath', { pluginId, filename }),
  },

  // Skills — knowledge injection via /skill-name
  skills: {
    list: () => ipcRenderer.invoke('skills:list'),
    autocomplete: () => ipcRenderer.invoke('skills:autocomplete'),
    getContent: (slug) => ipcRenderer.invoke('skills:getContent', slug),
    buildContext: (slugs) => ipcRenderer.invoke('skills:buildContext', slugs),
  },

  // Plugin Generator — AI-powered plugin creation
  pluginGen: {
    generate: (userRequest, existingPluginId) => ipcRenderer.invoke('pluginGen:generate', userRequest, existingPluginId),
    detectIntent: (message) => ipcRenderer.invoke('pluginGen:detectIntent', message),
    delete: (pluginId) => ipcRenderer.invoke('pluginGen:delete', pluginId),
    listGenerated: () => ipcRenderer.invoke('pluginGen:listGenerated'),
    refreshSidebar: () => ipcRenderer.invoke('pluginGen:refreshSidebar'),
    onSidebarChanged: (cb) => ipcRenderer.on('plugins:sidebarChanged', () => cb()),
  },

  // MCP — Model Context Protocol integrations
  mcp: {
    getServers: () => ipcRenderer.invoke('mcp:getServers'),
    connect: (serverId) => ipcRenderer.invoke('mcp:connect', serverId),
    disconnect: (serverId) => ipcRenderer.invoke('mcp:disconnect', serverId),
    getTools: () => ipcRenderer.invoke('mcp:getTools'),
    getToolsOpenAI: () => ipcRenderer.invoke('mcp:getToolsOpenAI'),
    callTool: (serverId, toolName, args) => ipcRenderer.invoke('mcp:callTool', serverId, toolName, args),
    parseToolName: (fullName) => ipcRenderer.invoke('mcp:parseToolName', fullName),
    addServer: (id, config) => ipcRenderer.invoke('mcp:addServer', id, config),
    removeServer: (id) => ipcRenderer.invoke('mcp:removeServer', id),
    updateServer: (id, updates) => ipcRenderer.invoke('mcp:updateServer', id, updates),
  },

  agent: {
    plan: (messages) => ipcRenderer.invoke('agent:plan', messages),
    execute: (messages) => ipcRenderer.invoke('agent:execute', messages),
  },

  // Shell — open files/folders in system
  shell: {
    openPath: (filePath) => ipcRenderer.invoke('shell:openPath', filePath),
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
    pickFolder: (title) => ipcRenderer.invoke('shell:pickFolder', title),
  },

  // Hardware scanner
  hardware: {
    scan: () => ipcRenderer.invoke('hardware:scan'),
  },

  // Model registry manifest
  manifest: {
    get: () => ipcRenderer.invoke('manifest:get'),
    checkUpdate: () => ipcRenderer.invoke('manifest:checkUpdate'),
    dismissUpdate: () => ipcRenderer.invoke('manifest:dismissUpdate'),
  },

  // Model Downloads — GGUF direct download from HuggingFace
  downloads: {
    start: (modelId, variantIndex) => ipcRenderer.invoke('model:download-start', modelId, variantIndex),
    pause: (modelId) => ipcRenderer.invoke('model:download-pause', modelId),
    cancel: (modelId) => ipcRenderer.invoke('model:download-cancel', modelId),
    delete: (modelId, variantIndex) => ipcRenderer.invoke('model:download-delete', modelId, variantIndex),
    getState: () => ipcRenderer.invoke('model:download-state'),
    getInstalled: () => ipcRenderer.invoke('model:installed-list'),
    onProgress: (cb) => ipcRenderer.on('model:download-progress', (_, data) => cb(data)),
    onStateChanged: (cb) => ipcRenderer.on('model:download-state-changed', (_, data) => cb(data)),
    onComplete: (cb) => ipcRenderer.on('model:download-complete', (_, data) => cb(data)),
    onFailed: (cb) => ipcRenderer.on('model:download-failed', (_, data) => cb(data)),
  },

  // TTS (Text-to-Speech) — MOSS-TTS via mlx-audio
  tts: {
    checkSetup: () => ipcRenderer.invoke('tts:check-setup'),
    setup: () => ipcRenderer.invoke('tts:setup'),
    synthesize: (text, options) => ipcRenderer.invoke('tts:synthesize', text, options),
    setVoiceClone: (audioPath) => ipcRenderer.invoke('tts:set-voice-clone', audioPath),
    clearVoiceClone: () => ipcRenderer.invoke('tts:clear-voice-clone'),
    getSettings: () => ipcRenderer.invoke('tts:get-settings'),
    updateSettings: (settings) => ipcRenderer.invoke('tts:update-settings', settings),
    getRecommendedModel: (hardware, llmRam) => ipcRenderer.invoke('tts:get-recommended-model', hardware, llmRam),
  },
});
