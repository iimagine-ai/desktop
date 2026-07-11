// Preload script — exposes safe APIs to the renderer process
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Auth
  auth: {
    login: (url) => ipcRenderer.invoke('auth:login', url),
    exchangeCode: (code) => ipcRenderer.invoke('auth:exchangeCode', code),
    getUser: () => ipcRenderer.invoke('auth:getUser'),
    getToken: () => ipcRenderer.invoke('auth:getToken'),
    isRequired: () => ipcRenderer.invoke('auth:isRequired'),
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
    generateImage: (prompt, model, aspectRatio) => ipcRenderer.invoke('gateway:generateImage', { prompt, model, aspectRatio }),
    generateVideo: (prompt, model, aspectRatio, duration) => ipcRenderer.invoke('gateway:generateVideo', { prompt, model, aspectRatio, duration }),
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
    updateConversationCollection: (id, collectionId) => ipcRenderer.invoke('storage:updateConversationCollection', id, collectionId),
    updateConversationKBSelections: (id, selections) => ipcRenderer.invoke('storage:updateConversationKBSelections', id, selections),
    deleteConversation: (id) => ipcRenderer.invoke('storage:deleteConversation', id),
    // Messages
    addMessage: (data) => ipcRenderer.invoke('storage:addMessage', data),
    getMessages: (conversationId, limit) => ipcRenderer.invoke('storage:getMessages', conversationId, limit),
    // Knowledge Graph
    upsertEntity: (data) => ipcRenderer.invoke('storage:upsertEntity', data),
    getEntities: (entityType, limit) => ipcRenderer.invoke('storage:getEntities', entityType, limit),
    addRelationship: (data) => ipcRenderer.invoke('storage:addRelationship', data),
    getRelationships: (entityId) => ipcRenderer.invoke('storage:getRelationships', entityId),
    // Stats
    getStats: () => ipcRenderer.invoke('storage:getStats'),
    getDbPath: () => ipcRenderer.invoke('storage:getDbPath'),
  },

  // Media — local file storage
  media: {
    save: (data) => ipcRenderer.invoke('media:save', data),
    saveVideo: (data) => ipcRenderer.invoke('media:saveVideo', data),
    list: (type, limit) => ipcRenderer.invoke('media:list', type, limit),
    get: (id) => ipcRenderer.invoke('media:get', id),
    delete: (id) => ipcRenderer.invoke('media:delete', id),
    getPath: (filename) => ipcRenderer.invoke('media:getPath', filename),
    getStats: () => ipcRenderer.invoke('media:getStats'),
    getDir: () => ipcRenderer.invoke('media:getDir'),
  },

  // Chat RAG — KB-augmented chat for general chat page
  chatRag: {
    send: (data) => ipcRenderer.invoke('chat:ragSend', data),
    estimateFullContext: (selections) => ipcRenderer.invoke('chat:ragEstimateFullContext', selections),
    onChunk: (cb) => ipcRenderer.on('chat:rag-chunk', (_, data) => cb(data)),
    onDone: (cb) => ipcRenderer.on('chat:rag-done', () => cb()),
  },
  // Chat — stop/abort active stream
  chat: {
    stop: () => ipcRenderer.invoke('chat:stop'),
    onStreamStopped: (cb) => ipcRenderer.on('chat:stream-stopped', () => cb()),
    readFile: (filePath) => ipcRenderer.invoke('chat:readFile', filePath),
    pickFile: () => ipcRenderer.invoke('chat:pickFile'),
  },

  // Knowledge Base — local vector-enabled KB
  kb: {
    // Collections
    createCollection: (data) => ipcRenderer.invoke('kb:createCollection', data),
    getCollections: () => ipcRenderer.invoke('kb:getCollections'),
    getCollection: (id) => ipcRenderer.invoke('kb:getCollection', id),
    updateCollection: (id, data) => ipcRenderer.invoke('kb:updateCollection', id, data),
    deleteCollection: (id) => ipcRenderer.invoke('kb:deleteCollection', id),
    // Documents
    addDocument: (data) => ipcRenderer.invoke('kb:addDocument', data),
    getDocuments: (collectionId) => ipcRenderer.invoke('kb:getDocuments', collectionId),
    getDocument: (id) => ipcRenderer.invoke('kb:getDocument', id),
    updateDocument: (id, data) => ipcRenderer.invoke('kb:updateDocument', id, data),
    deleteDocument: (id) => ipcRenderer.invoke('kb:deleteDocument', id),
    // Embeddings & Search
    storeEmbeddings: (items) => ipcRenderer.invoke('kb:storeEmbeddings', items),
    getUnembeddedChunks: (collectionId, limit) => ipcRenderer.invoke('kb:getUnembeddedChunks', collectionId, limit),
    searchSimilar: (data) => ipcRenderer.invoke('kb:searchSimilar', data),
    getStats: () => ipcRenderer.invoke('kb:getStats'),
    isVecLoaded: () => ipcRenderer.invoke('kb:isVecLoaded'),
    hasEmbedModel: () => ipcRenderer.invoke('kb:hasEmbedModel'),
    // File dialog
    openFileDialog: () => ipcRenderer.invoke('kb:openFileDialog'),
    readDroppedFiles: (filePaths) => ipcRenderer.invoke('kb:readDroppedFiles', filePaths),
    // Get file path from dropped File object (Electron 33+ requires webUtils)
    getFilePath: (file) => webUtils.getPathForFile(file),
    // Embed progress events
    onEmbedProgress: (cb) => ipcRenderer.on('kb:embed-progress', (_, data) => cb(data)),
    // Auto-embed events
    onAutoEmbedStart: (cb) => ipcRenderer.on('kb:auto-embed-start', (_, data) => cb(data)),
    onAutoEmbedProgress: (cb) => ipcRenderer.on('kb:auto-embed-progress', (_, data) => cb(data)),
    onAutoEmbedDone: (cb) => ipcRenderer.on('kb:auto-embed-done', (_, data) => cb(data)),
  },

  // Assistants — custom GPT-like AI assistants
  assistants: {
    create: (data) => ipcRenderer.invoke('asst:create', data),
    list: () => ipcRenderer.invoke('asst:list'),
    get: (id) => ipcRenderer.invoke('asst:get', id),
    update: (id, data) => ipcRenderer.invoke('asst:update', id, data),
    delete: (id) => ipcRenderer.invoke('asst:delete', id),
    createConversation: (data) => ipcRenderer.invoke('asst:createConversation', data),
    getConversations: (assistantId) => ipcRenderer.invoke('asst:getConversations', assistantId),
    deleteConversation: (id) => ipcRenderer.invoke('asst:deleteConversation', id),
    addMessage: (data) => ipcRenderer.invoke('asst:addMessage', data),
    getMessages: (conversationId, limit) => ipcRenderer.invoke('asst:getMessages', conversationId, limit),
    ragChat: (data) => ipcRenderer.invoke('asst:ragChat', data),
    onStreamChunk: (cb) => ipcRenderer.on('asst:stream-chunk', (_, data) => cb(data)),
    onStreamDone: (cb) => ipcRenderer.on('asst:stream-done', () => cb()),
    removeStreamListeners: () => {
      ipcRenderer.removeAllListeners('asst:stream-chunk');
      ipcRenderer.removeAllListeners('asst:stream-done');
    },
  },

  // Plugins
  plugins: {
    list: () => ipcRenderer.invoke('plugins:list'),
    setEnabled: (id, enabled) => ipcRenderer.invoke('plugins:setEnabled', id, enabled),
    getSidebarItems: () => ipcRenderer.invoke('plugins:getSidebarItems'),
    renderPage: (pluginId) => ipcRenderer.invoke('plugins:renderPage', pluginId),
    sendEvent: (event, data) => ipcRenderer.invoke('plugins:event', event, data),
    getDir: () => ipcRenderer.invoke('plugins:getDir'),
    openFolder: (pluginId) => ipcRenderer.invoke('plugins:openFolder', pluginId),
    install: () => ipcRenderer.invoke('plugins:install'),
    uninstall: (id) => ipcRenderer.invoke('plugins:uninstall', id),
    chatPreprocess: (data) => ipcRenderer.invoke('plugins:chatPreprocess', data),
    chatPostprocess: (data) => ipcRenderer.invoke('plugins:chatPostprocess', data),
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

  // Google OAuth — one-click connect for Google Workspace
  google: {
    connect: () => ipcRenderer.invoke('google:connect'),
    disconnect: () => ipcRenderer.invoke('google:disconnect'),
    status: () => ipcRenderer.invoke('google:status'),
  },

  // Folders — connect local folders to KB
  folders: {
    add: () => ipcRenderer.invoke('folder:add'),
    list: () => ipcRenderer.invoke('folder:list'),
    remove: (id) => ipcRenderer.invoke('folder:remove', id),
    reindex: (id) => ipcRenderer.invoke('folder:reindex', id),
    processKG: (id) => ipcRenderer.invoke('folder:processKG', id),
    onProgress: (cb) => ipcRenderer.on('folder:index-progress', (_, data) => cb(data)),
    onDone: (cb) => ipcRenderer.on('folder:index-done', (_, data) => cb(data)),
    onEmbedStart: (cb) => ipcRenderer.on('kb:auto-embed-start', (_, data) => cb(data)),
    onEmbedProgress: (cb) => ipcRenderer.on('kb:auto-embed-progress', (_, data) => cb(data)),
    onEmbedDone: (cb) => ipcRenderer.on('kb:auto-embed-done', (_, data) => cb(data)),
    onCortexProgress: (cb) => ipcRenderer.on('folder:cortex-progress', (_, data) => cb(data)),
  },

  // Prompts — reusable prompt templates
  prompts: {
    create: (data) => ipcRenderer.invoke('prompts:create', data),
    list: () => ipcRenderer.invoke('prompts:list'),
    update: (id, data) => ipcRenderer.invoke('prompts:update', id, data),
    delete: (id) => ipcRenderer.invoke('prompts:delete', id),
    search: (query) => ipcRenderer.invoke('prompts:search', query),
  },

  // RAG Prompts — context-aware system prompts for KB chat
  ragPrompts: {
    list: () => ipcRenderer.invoke('rag-prompts:list'),
    listByCategory: (category) => ipcRenderer.invoke('rag-prompts:list-by-category', category),
    get: (id) => ipcRenderer.invoke('rag-prompts:get', id),
    create: (data) => ipcRenderer.invoke('rag-prompts:create', data),
    update: (id, data) => ipcRenderer.invoke('rag-prompts:update', id, data),
    delete: (id) => ipcRenderer.invoke('rag-prompts:delete', id),
    getActive: (category) => ipcRenderer.invoke('rag-prompts:get-active', category),
    setActive: (category, promptId) => ipcRenderer.invoke('rag-prompts:set-active', category, promptId),
  },

  // Personas — AI persona management
  personas: {
    create: (data) => ipcRenderer.invoke('persona:create', data),
    list: () => ipcRenderer.invoke('persona:list'),
    getActive: () => ipcRenderer.invoke('persona:getActive'),
    update: (id, data) => ipcRenderer.invoke('persona:update', id, data),
    delete: (id) => ipcRenderer.invoke('persona:delete', id),
    activate: (id) => ipcRenderer.invoke('persona:activate', id),
    deactivate: () => ipcRenderer.invoke('persona:deactivate'),
  },

  // Web Search
  webSearch: {
    search: (query) => ipcRenderer.invoke('websearch:search', query),
    isEnabled: () => ipcRenderer.invoke('settings:get', 'webSearch.enabled'),
  },

  agent: {
    plan: (messages) => ipcRenderer.invoke('agent:plan', messages),
    execute: (messages) => ipcRenderer.invoke('agent:execute', messages),
  },

  // Shell — open files/folders in system
  shell: {
    openPath: (filePath) => ipcRenderer.invoke('shell:openPath', filePath),
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
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
