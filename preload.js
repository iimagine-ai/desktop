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

  // Ollama
  ollama: {
    status: () => ipcRenderer.invoke('ollama:status'),
    install: () => ipcRenderer.invoke('ollama:install'),
    pull: (modelName) => ipcRenderer.invoke('ollama:pull', modelName),
    cancelPull: () => ipcRenderer.invoke('ollama:cancelPull'),
    hasModel: (modelName) => ipcRenderer.invoke('ollama:hasModel', modelName),
    delete: (modelName) => ipcRenderer.invoke('ollama:delete', modelName),
    unload: (modelName) => ipcRenderer.invoke('ollama:unload', modelName),
    chat: (model, messages) => ipcRenderer.invoke('ollama:chat', { model, messages }),
    chatStream: (model, messages) => ipcRenderer.invoke('ollama:chatStream', { model, messages }),
    embedBatch: (model, texts) => ipcRenderer.invoke('ollama:embedBatch', { model, texts }),
    testConnection: (host) => ipcRenderer.invoke('ollama:testConnection', host),
    getModelLocation: () => ipcRenderer.invoke('ollama:getModelLocation'),
    openModelLocation: () => ipcRenderer.invoke('ollama:openModelLocation'),
    onStreamChunk: (cb) => ipcRenderer.on('ollama:stream-chunk', (_, chunk) => cb(chunk)),
    onStreamDone: (cb) => ipcRenderer.on('ollama:stream-done', () => cb()),
    onPullProgress: (cb) => ipcRenderer.on('ollama:pull-progress', (_, data) => cb(data)),
    onPullDone: (cb) => ipcRenderer.on('ollama:pull-done', (_, data) => cb(data)),
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
    onChunk: (cb) => ipcRenderer.on('chat:rag-chunk', (_, data) => cb(data)),
    onDone: (cb) => ipcRenderer.on('chat:rag-done', () => cb()),
  },
  // Chat — stop/abort active stream
  chat: {
    stop: () => ipcRenderer.invoke('chat:stop'),
    onStreamStopped: (cb) => ipcRenderer.on('chat:stream-stopped', () => cb()),
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
    getDir: () => ipcRenderer.invoke('plugins:getDir'),
    install: () => ipcRenderer.invoke('plugins:install'),
    uninstall: (id) => ipcRenderer.invoke('plugins:uninstall', id),
    chatPreprocess: (data) => ipcRenderer.invoke('plugins:chatPreprocess', data),
    chatPostprocess: (data) => ipcRenderer.invoke('plugins:chatPostprocess', data),
    getCommands: () => ipcRenderer.invoke('plugins:getCommands'),
    getMentions: () => ipcRenderer.invoke('plugins:getMentions'),
  },

  agent: {
    plan: (messages) => ipcRenderer.invoke('agent:plan', messages),
    execute: (messages) => ipcRenderer.invoke('agent:execute', messages),
  },
});
