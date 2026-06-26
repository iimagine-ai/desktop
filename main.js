// IIMAGINE Desktop Companion - Main Process
// Electron app with provider-based AI chat
// Local AI via bundled iimagine-engine (llama.cpp) — shows as "iimagine-engine" in Activity Monitor
// Legacy Ollama support maintained for backward compatibility

const { app, BrowserWindow, Tray, Menu, shell, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile, spawn } = require('child_process');
const Store = require('electron-store');
const storage = require('./storage');
const kbStorage = require('./kb-storage');
const assistantStorage = require('./assistant-storage');
const personaStorage = require('./persona-storage');
const pluginManager = require('./plugin-manager');
const streamAbort = require('./stream-abort');
const folderConnect = require('./folder-connect');
const promptStorage = require('./prompt-storage');
const ragPromptStorage = require('./rag-prompt-storage');
const { scanHardware } = require('./hardware-scanner');
const manifestManager = require('./manifest-manager');
const modelOrchestrator = require('./model-orchestrator');
const engineManager = require('./engine-manager');
const modelRegistry = require('./model-registry');
const localAI = require('./local-ai-adapter');
const MCPClientManager = require('./mcp-client');
const downloadManager = require('./download-manager');
const ttsService = require('./tts-service');

const mcpClient = new MCPClientManager();

const store = new Store();

// Configuration
const WEB_APP_URL_LOCAL = 'http://localhost:3000';
const WEB_APP_URL_PROD = 'https://app.iimagine.ai';
let activeWebAppUrl = WEB_APP_URL_LOCAL;

// Auth mode: disabled — app works without sign-in (open source mode)
const AUTH_REQUIRED = false;

const OLLAMA_URL = 'http://localhost:11434';
const PROTOCOL = 'iimagine-desktop';

let mainWindow = null;
let tray = null;
let isQuitting = false;

// ── Custom Protocol ─────────────────────────────────────────────
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}

// ── Single Instance Lock ────────────────────────────────────────
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine) => {
    const url = commandLine.find(arg => arg.startsWith(`${PROTOCOL}://`));
    if (url) handleProtocolUrl(url);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// ── Auth Helpers ────────────────────────────────────────────────
function handleProtocolUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.pathname === '//auth/callback' || parsed.pathname === '/auth/callback') {
      const code = parsed.searchParams.get('code');
      if (code) exchangeCodeForToken(code);
    }
  } catch (err) {
    console.error('Failed to parse protocol URL:', err);
  }
}

async function exchangeCodeForToken(code) {
  try {
    const res = await fetch(`${activeWebAppUrl}/api/auth/desktop-token`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });

    if (!res.ok) {
      const err = await res.json();
      mainWindow?.webContents.send('auth-error', err.error || 'Authentication failed');
      return;
    }

    const data = await res.json();
    store.set('auth.token', data.token);
    store.set('auth.tokenId', data.tokenId);
    store.set('auth.user', data.user);
    store.set('auth.serverUrl', activeWebAppUrl);
    mainWindow?.webContents.send('auth-success', data.user);
  } catch (err) {
    console.error('Token exchange failed:', err);
    mainWindow?.webContents.send('auth-error', 'Connection failed');
  }
}

async function validateToken() {
  // If auth is not required, return a local guest user
  if (!AUTH_REQUIRED) {
    const guestUser = { email: 'Local User', isGuest: true };
    store.set('auth.user', guestUser);
    return guestUser;
  }

  const token = store.get('auth.token');
  if (!token) return null;

  const savedUrl = store.get('auth.serverUrl');
  if (savedUrl) activeWebAppUrl = savedUrl;

  try {
    const res = await fetch(`${activeWebAppUrl}/api/auth/desktop-token`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      store.delete('auth.token');
      store.delete('auth.tokenId');
      store.delete('auth.user');
      return null;
    }
    const data = await res.json();
    store.set('auth.user', data.user);
    return data.user;
  } catch {
    return store.get('auth.user') || null;
  }
}

// ── Ollama Helpers ──────────────────────────────────────────────
// NOTE: These now route through local-ai-adapter (engine-manager first, Ollama fallback).
async function checkOllama() {
  const status = await localAI.getStatus();
  if (status.running) {
    return { running: true, models: status.models, engine: status.engine };
  }
  return { running: false, models: [] };
}

async function installOllama() {
  return new Promise((resolve) => {
    if (process.platform === 'darwin') {
      // macOS: use the official install script
      const child = spawn('bash', ['-c', 'curl -fsSL https://ollama.com/install.sh | sh'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });

      child.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true });
        } else {
          resolve({ success: false, error: stderr || `Exit code ${code}` });
        }
      });

      child.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
    } else if (process.platform === 'linux') {
      const child = spawn('bash', ['-c', 'curl -fsSL https://ollama.com/install.sh | sh'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderr = '';
      child.stderr.on('data', (d) => { stderr += d.toString(); });

      child.on('close', (code) => {
        resolve(code === 0 ? { success: true } : { success: false, error: stderr || `Exit code ${code}` });
      });

      child.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
    } else {
      resolve({ success: false, error: 'Auto-install not supported on this platform. Please install from ollama.com/download' });
    }
  });
}

let activePullController = null;

async function pullModel(modelName) {
  try {
    const ollamaHost = store.get('local.ollamaHost') || OLLAMA_URL;
    activePullController = new AbortController();
    const res = await fetch(`${ollamaHost}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName, stream: true }),
      signal: activePullController.signal,
    });

    if (!res.ok) {
      throw new Error(`Ollama pull error: ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter(Boolean);

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          mainWindow?.webContents.send('ollama:pull-progress', {
            status: parsed.status,
            total: parsed.total || 0,
            completed: parsed.completed || 0,
          });
        } catch {
          // skip malformed
        }
      }
    }

    mainWindow?.webContents.send('ollama:pull-done', { success: true });
    activePullController = null;
    return { success: true };
  } catch (err) {
    activePullController = null;
    if (err.name === 'AbortError') {
      mainWindow?.webContents.send('ollama:pull-done', { success: false, error: 'Download cancelled' });
      return { success: false, error: 'Download cancelled' };
    }
    mainWindow?.webContents.send('ollama:pull-done', { success: false, error: err.message });
    return { success: false, error: err.message };
  }
}

// ── Window & Tray ───────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 650,
    minWidth: 600,
    minHeight: 450,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 12 },
    backgroundColor: '#ffffff',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Clear cache to ensure fresh assets load
  mainWindow.webContents.session.clearCache().then(() => {
    mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  // Use dedicated tray icons for crisp menu bar rendering
  const trayIconPath = path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'trayIcon.png');
  const trayIcon2xPath = path.join(__dirname, 'assets', 'trayIcon@2x.png');

  let icon;
  if (process.platform !== 'win32' && fs.existsSync(trayIcon2xPath)) {
    // Load @2x for Retina displays, Electron picks the right one
    icon = nativeImage.createFromPath(trayIconPath);
    const icon2x = nativeImage.createFromPath(trayIcon2xPath);
    icon.addRepresentation({ scaleFactor: 2.0, buffer: icon2x.toPNG() });
  } else {
    icon = nativeImage.createFromPath(trayIconPath).resize({ width: 22, height: 22 });
  }

  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open IIMAGINE', click: () => mainWindow?.show() },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
  ]);

  tray.setToolTip('IIMAGINE Desktop');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => mainWindow?.show());
}

// ── CSV Parser ──────────────────────────────────────────────────
function parseCsvToReadableText(raw) {
  const lines = raw.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (!lines.length) return raw;

  const parseLine = (line) => {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result.map(cell => {
      const t = cell.trim();
      return (t.startsWith('"') && t.endsWith('"'))
        ? t.slice(1, -1).replace(/""/g, '"').trim()
        : t;
    });
  };

  const rows = lines.map(parseLine);
  const headers = rows[0] || [];
  const dataRows = rows.slice(1);

  let text = `CSV CONTENT\n\nColumns: ${headers.join(' | ')}\n\n`;
  const max = Math.min(dataRows.length, 500);
  for (let i = 0; i < max; i++) {
    const row = dataRows[i];
    if (headers.length === row.length && headers.length > 0) {
      const pairs = headers.map((h, idx) => `${h}: ${row[idx]}`);
      text += `Row ${i + 1}: ${pairs.join(' | ')}\n`;
    } else {
      text += `Row ${i + 1}: ${row.join(' | ')}\n`;
    }
  }
  if (dataRows.length > max) {
    text += `\n... ${dataRows.length - max} more rows not shown ...\n`;
  }
  return text;
}

// ── Auto-Embed (fire-and-forget after add/update) ───────────────
let autoEmbedRunning = false;

const EMBED_MODEL_FILENAME = 'nomic-embed-text-v1.5-f16.gguf';

async function autoEmbedCollection(collectionId) {
  if (autoEmbedRunning) return; // skip if already running
  if (!kbStorage.isVecLoaded()) return;

  // Check embedding model is downloaded locally
  const modelsDir = engineManager.getModelsDir();
  const embedModelPath = path.join(modelsDir, EMBED_MODEL_FILENAME);
  if (!fs.existsSync(embedModelPath)) {
    console.log('[AutoEmbed] Embedding model not found. Download "Nomic Embed Text" from Settings > Models to enable KB search.');
    return;
  }

  // Get unembedded chunks
  const chunks = kbStorage.getUnembeddedChunks(collectionId, 5000);
  if (!chunks.length) return;

  // Remember which chat model was running so we can restore it
  const engineStatus = engineManager.getStatus();
  const previousModel = engineStatus.currentModel || null;

  console.log(`[AutoEmbed] Starting embedding for collection ${collectionId} (${chunks.length} chunks)`);

  // Switch engine to embedding model
  const startResult = await engineManager.startEngine(embedModelPath);
  if (!startResult.success) {
    console.warn('[AutoEmbed] Failed to start embedding engine:', startResult.error);
    return;
  }

  autoEmbedRunning = true;
  mainWindow?.webContents.send('kb:auto-embed-start', {
    collectionId,
    total: chunks.length,
  });

  const BATCH_SIZE = 10;
  let totalStored = 0;

  try {
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);

      for (const chunk of batch) {
        try {
          const result = await engineManager.embed(chunk.content);
          if (result.success && result.embedding) {
            kbStorage.storeEmbeddings([{
              chunkId: chunk.id,
              embedding: new Float32Array(result.embedding),
            }]);
            totalStored++;
          }
        } catch {
          // skip individual failures
        }
      }

      const processed = Math.min(i + BATCH_SIZE, chunks.length);
      mainWindow?.webContents.send('kb:auto-embed-progress', {
        collectionId,
        processed,
        total: chunks.length,
      });
    }
  } finally {
    autoEmbedRunning = false;
    mainWindow?.webContents.send('kb:auto-embed-done', {
      collectionId,
      embedded: totalStored,
      total: chunks.length,
    });

    // Restore previous chat model if one was running before embedding
    if (previousModel && previousModel !== embedModelPath) {
      console.log(`[AutoEmbed] Restoring previous model: ${path.basename(previousModel)}`);
      engineManager.startEngine(previousModel).catch(err =>
        console.warn('[AutoEmbed] Failed to restore previous model:', err.message)
      );
    }
  }
}

// ── Embed Query for KB Search ───────────────────────────────────
// Uses the nomic-embed-text model via iimagine-engine for vector search.
// Temporarily switches the engine to the embedding model, embeds the query,
// then restores the previous chat model.
async function embedQueryForSearch(text) {
  if (!kbStorage.isVecLoaded()) return null;

  const modelsDir = engineManager.getModelsDir();
  const embedModelPath = path.join(modelsDir, EMBED_MODEL_FILENAME);
  if (!fs.existsSync(embedModelPath)) {
    console.log('[EmbedQuery] Embedding model not found — KB vector search unavailable.');
    return null;
  }

  // Remember current model so we can restore it after embedding
  const engineStatus = engineManager.getStatus();
  const previousModel = engineStatus.currentModel || null;

  // Start embedding model (stops current model if different)
  const startResult = await engineManager.startEngine(embedModelPath);
  if (!startResult.success) {
    console.warn('[EmbedQuery] Failed to start embedding engine:', startResult.error);
    return null;
  }

  let queryVec = null;
  try {
    const result = await engineManager.embed(text);
    if (result.success && result.embedding) {
      queryVec = new Float32Array(result.embedding);
    }
  } catch (err) {
    console.warn('[EmbedQuery] Embed failed:', err.message);
  }

  // Restore previous chat model (fire and forget)
  if (previousModel && previousModel !== embedModelPath) {
    engineManager.startEngine(previousModel).catch(err =>
      console.warn('[EmbedQuery] Failed to restore previous model:', err.message)
    );
  }

  return queryVec;
}
function parseDuckDuckGoResults(html) {
  const results = [];
  // Match result blocks: <a class="result__a" href="...">title</a> and <a class="result__snippet">snippet</a>
  const linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

  const links = [...html.matchAll(linkRegex)];
  const snippets = [...html.matchAll(snippetRegex)];

  for (let i = 0; i < Math.min(links.length, 8); i++) {
    const url = links[i][1] || '';
    const title = (links[i][2] || '').replace(/<[^>]*>/g, '').trim();
    const snippet = snippets[i] ? snippets[i][1].replace(/<[^>]*>/g, '').trim() : '';

    if (title && url) {
      // DuckDuckGo wraps URLs in a redirect — extract the actual URL
      let cleanUrl = url;
      const uddg = url.match(/uddg=([^&]+)/);
      if (uddg) cleanUrl = decodeURIComponent(uddg[1]);

      results.push({ title, url: cleanUrl, snippet });
    }
  }
  return results;
}

// ── IPC Handlers ────────────────────────────────────────────────
function setupIPC() {
  // Auth
  ipcMain.handle('auth:login', (event, url) => {
    if (url) activeWebAppUrl = url;
    shell.openExternal(`${activeWebAppUrl}/auth/desktop-callback`);
  });

  ipcMain.handle('auth:exchangeCode', async (event, code) => {
    try {
      await exchangeCodeForToken(code);
      return { success: true };
    } catch (err) {
      return { error: err.message || 'Exchange failed' };
    }
  });

  ipcMain.handle('auth:getUser', () => store.get('auth.user') || null);
  ipcMain.handle('auth:getToken', () => store.get('auth.token') || null);
  ipcMain.handle('auth:isRequired', () => AUTH_REQUIRED);

  ipcMain.handle('auth:logout', () => {
    store.delete('auth.token');
    store.delete('auth.tokenId');
    store.delete('auth.user');
    return true;
  });

  ipcMain.handle('auth:validate', async () => await validateToken());

  // Ollama — status
  ipcMain.handle('ollama:status', async () => await checkOllama());

  // Vertex AI — streaming chat via server proxy
  ipcMain.handle('vertex:chat', async (event, { messages, model, region }) => {
    const token = store.get('auth.token');
    const serverUrl = store.get('auth.serverUrl') || activeWebAppUrl;
    if (!token) return { success: false, error: 'Not authenticated' };

    try {
      const res = await fetch(`${serverUrl}/api/desktop/vertex-chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ messages, model, region }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        return { success: false, error: err.error || `Server error ${res.status}` };
      }

      // Parse SSE stream
      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter(l => l.startsWith('data: '));

        for (const line of lines) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            mainWindow?.webContents.send('vertex:stream-done');
          } else {
            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                mainWindow?.webContents.send('vertex:stream-chunk', parsed);
              } else if (parsed.error) {
                mainWindow?.webContents.send('vertex:stream-done');
                return { success: false, error: parsed.error };
              }
            } catch { /* skip malformed */ }
          }
        }
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Ollama — install engine
  ipcMain.handle('ollama:install', async () => await installOllama());

  // AI Gateway — image generation
  ipcMain.handle('gateway:generateImage', async (event, { prompt, model, aspectRatio }) => {
    const token = store.get('auth.token');
    const serverUrl = store.get('auth.serverUrl') || activeWebAppUrl;
    if (!token) return { success: false, error: 'Not authenticated' };

    try {
      const res = await fetch(`${serverUrl}/api/desktop/gateway-image`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ prompt, model, aspectRatio }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        return { success: false, error: err.error || `Server error ${res.status}` };
      }

      const data = await res.json();
      return { success: true, image: data.image, mediaType: data.mediaType, model: data.model };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // AI Gateway — streaming chat via server proxy OR direct provider call
  ipcMain.handle('gateway:chat', async (event, { messages, model }) => {
    // Inject active persona system prompt
    const activePersonaGw = personaStorage.getActivePersona();
    if (activePersonaGw && activePersonaGw.custom_instructions) {
      const hasSystem = messages.some(m => m.role === 'system');
      if (!hasSystem) {
        messages.unshift({ role: 'system', content: activePersonaGw.custom_instructions });
      } else {
        const sysIdx = messages.findIndex(m => m.role === 'system');
        messages[sysIdx].content = activePersonaGw.custom_instructions + '\n\n' + messages[sysIdx].content;
      }
    }

    const controller = new AbortController();
    streamAbort.setActiveStreamController(controller);
    const vendor = store.get('gateway.vendor') || 'openai';
    const PROVIDER_CONFIG = {
      openai: { url: 'https://api.openai.com/v1/chat/completions', keyStore: 'openai.apiKey', authHeader: 'Bearer' },
      anthropic: { url: 'https://api.anthropic.com/v1/messages', keyStore: 'anthropic.apiKey', isAnthropic: true },
      google: { url: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent', keyStore: 'gemini.apiKey', isGemini: true },
      openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions', keyStore: 'openrouter.apiKey', authHeader: 'Bearer' },
    };
    const config = PROVIDER_CONFIG[vendor];
    const apiKey = config ? store.get(config.keyStore) : null;
    const activeModel = model || store.get('gateway.model') || 'gpt-5.4-mini';

    if (apiKey && config) {
      try {
        if (config.isAnthropic) {
          // Anthropic streaming
          const systemMsg = messages.find(m => m.role === 'system');
          const nonSystemMsgs = messages.filter(m => m.role !== 'system');
          const body = { model: activeModel, messages: nonSystemMsgs, max_tokens: 4096, stream: true };
          if (systemMsg) body.system = systemMsg.content;

          const res = await fetch(config.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }));
            return { success: false, error: err.error?.message || `Anthropic error ${res.status}` };
          }
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value);
            const lines = chunk.split('\n').filter(l => l.startsWith('data: '));
            for (const line of lines) {
              const data = line.slice(6).trim();
              if (data === '[DONE]') { mainWindow?.webContents.send('gateway:stream-done'); }
              else {
                try {
                  const parsed = JSON.parse(data);
                  if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                    mainWindow?.webContents.send('gateway:stream-chunk', { content: parsed.delta.text });
                  }
                } catch {}
              }
            }
          }
          mainWindow?.webContents.send('gateway:stream-done');
          return { success: true };

        } else if (config.isGemini) {
          // Gemini non-streaming (Gemini streaming uses different format, use non-stream for simplicity)
          const url = config.url.replace('{model}', activeModel) + `?key=${apiKey}`;
          const contents = messages.filter(m => m.role !== 'system').map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          }));
          const systemMsg = messages.find(m => m.role === 'system');
          if (systemMsg) contents.unshift({ role: 'user', parts: [{ text: systemMsg.content }] });

          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents }),
            signal: controller.signal,
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }));
            return { success: false, error: err.error?.message || `Gemini error ${res.status}` };
          }
          const data = await res.json();
          const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
          if (content) mainWindow?.webContents.send('gateway:stream-chunk', { content });
          mainWindow?.webContents.send('gateway:stream-done');
          return { success: true };

        } else {
          // OpenAI-compatible (openai, openrouter) — streaming with tool calling
          const toolCalling = require('./tool-calling');
          const webSearchEnabled = !!store.get('webSearch.enabled') || !!store.get('local.webSearchEnabled');
          const kbStats = kbStorage.getKBStats();
          const hasKBDocuments = kbStats.embeddingCount > 0;
          const tools = toolCalling.getActiveTools({ webSearchEnabled, hasKBDocuments });

          // Merge MCP tools (from connected integrations)
          const mcpTools = mcpClient.getToolsAsOpenAIFunctions();
          const allTools = [...tools, ...mcpTools];

          // If MCP tools are available, add a system hint so the LLM knows to use them
          if (mcpTools.length > 0) {
            const connectedServers = Object.entries(mcpClient.getServers())
              .filter(([_, s]) => s.status === 'connected')
              .map(([id, s]) => `${s.name} (${s.description})`)
              .join(', ');
            const mcpHint = `\n\nYou have direct access to the following connected integrations: ${connectedServers}. When the user asks to read emails, check calendar, search docs, etc., use the appropriate mcp_* tool — do NOT use rag_search for external service queries.`;
            const sysIdx = messages.findIndex(m => m.role === 'system');
            if (sysIdx >= 0) {
              messages[sysIdx].content += mcpHint;
            } else {
              messages.unshift({ role: 'system', content: `You are a helpful assistant.${mcpHint}` });
            }
          }

          const headers = { 'Content-Type': 'application/json', 'Authorization': `${config.authHeader} ${apiKey}` };
          if (vendor === 'openrouter') {
            headers['HTTP-Referer'] = 'https://iimagine.ai';
            headers['X-Title'] = 'IIMAGINE Desktop';
          }
          const requestBody = { model: activeModel, messages, stream: true, max_completion_tokens: 4096, temperature: 0.7 };
          if (allTools.length > 0) {
            requestBody.tools = allTools;
            requestBody.tool_choice = 'auto';
            console.log(`[gateway:chat] Sending ${allTools.length} tools to ${activeModel} (${tools.length} built-in + ${mcpTools.length} MCP)`);
          }

          const res = await fetch(config.url, {
            method: 'POST',
            headers,
            body: JSON.stringify(requestBody),
            signal: controller.signal,
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }));
            return { success: false, error: err.error?.message || `${vendor} error ${res.status}` };
          }
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let gwFullContent = '';
          let gwToolCallChunks = [];
          let sseBuffer = ''; // Buffer for incomplete SSE lines across chunks

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            sseBuffer += decoder.decode(value, { stream: true });
            const sseLines = sseBuffer.split('\n');
            // Keep the last element (may be incomplete)
            sseBuffer = sseLines.pop() || '';
            for (const line of sseLines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith('data:')) continue;
              const data = trimmed.slice(trimmed.startsWith('data: ') ? 6 : 5).trim();
              if (data === '[DONE]') break;
              try {
                const parsed = JSON.parse(data);
                const delta = parsed.choices?.[0]?.delta;
                // Detect tool calls
                if (delta?.tool_calls) {
                  for (const tc of delta.tool_calls) {
                    const idx = tc.index ?? 0;
                    if (!gwToolCallChunks[idx]) gwToolCallChunks[idx] = { id: '', name: '', arguments: '' };
                    if (tc.id) gwToolCallChunks[idx].id = tc.id;
                    if (tc.function?.name) gwToolCallChunks[idx].name += tc.function.name;
                    if (tc.function?.arguments) gwToolCallChunks[idx].arguments += tc.function.arguments;
                  }
                }
                const content = delta?.content || '';
                if (content) {
                  gwFullContent += content;
                  mainWindow?.webContents.send('gateway:stream-chunk', { content });
                }
              } catch {}
            }
          }

          // If tool calls detected, execute and do follow-up
          if (gwToolCallChunks.length > 0) {
            console.log('[gateway:chat] Tool calls detected:', gwToolCallChunks.map(tc => ({ name: tc.name, argsLen: tc.arguments.length })));
            // Show appropriate action indicator based on tool types
            const hasMCPTools = gwToolCallChunks.some(tc => tc.name.startsWith('mcp_'));
            const indicator = hasMCPTools ? '\n\n⚡ *Running action...*\n\n' : '\n\n🔍 *Searching...*\n\n';
            mainWindow?.webContents.send('gateway:stream-chunk', { content: indicator });
            const context = { store, kbStorage };
            const updatedMessages = [...messages];
            const assistantToolCalls = gwToolCallChunks.map((tc, i) => ({
              id: tc.id || `call_${i}`,
              type: 'function',
              function: { name: tc.name, arguments: tc.arguments },
            }));
            updatedMessages.push({ role: 'assistant', content: gwFullContent || null, tool_calls: assistantToolCalls });

            for (const tc of assistantToolCalls) {
              let args = {};
              try { args = JSON.parse(tc.function.arguments); } catch {}
              console.log(`[gateway:chat] Executing tool: ${tc.function.name}`, args);

              // Skip if tool name is empty (streaming didn't capture it)
              if (!tc.function.name) {
                console.error('[gateway:chat] Empty tool name — SSE chunk may have been lost');
                updatedMessages.push({ role: 'tool', tool_call_id: tc.id, content: 'Error: tool name not captured' });
                continue;
              }

              let toolResult;
              // Check if this is an MCP tool call
              const mcpParsed = mcpClient.parseToolCallName(tc.function.name);
              if (mcpParsed) {
                // Check if this is a write operation requiring user approval
                if (mcpClient.isWriteOperation(mcpParsed.toolName)) {
                  // Send confirmation request to renderer and wait for response
                  const serverName = mcpClient.getServers()[mcpParsed.serverId]?.name || mcpParsed.serverId;
                  mainWindow?.webContents.send('gateway:stream-chunk', { content: `\n\n⏸️ **Approval needed:** ${serverName} wants to run \`${mcpParsed.toolName}\`\n` });
                  // For now, auto-approve (TODO: implement interactive approval UI)
                  // In future: emit event, wait for renderer response
                }

                // Route to MCP server
                const mcpResult = await mcpClient.callTool(mcpParsed.serverId, mcpParsed.toolName, args);
                if (mcpResult.success) {
                  // Extract text content from MCP response
                  const content = mcpResult.result?.content;
                  if (Array.isArray(content)) {
                    toolResult = content.map(c => c.text || JSON.stringify(c)).join('\n');
                  } else {
                    toolResult = JSON.stringify(mcpResult.result);
                  }
                } else {
                  toolResult = `MCP tool error: ${mcpResult.error}`;
                }
              } else {
                // Built-in tool execution
                toolResult = await toolCalling.executeTool(tc.function.name, args, context);
              }
              updatedMessages.push({ role: 'tool', tool_call_id: tc.id, content: toolResult || '' });
            }

            // Follow-up request — include tools so LLM can chain (e.g. search → read)
            // Clear the indicator text before streaming follow-up
            mainWindow?.webContents.send('gateway:clear-indicator');
            const followBody = { model: activeModel, messages: updatedMessages, stream: true, max_completion_tokens: 4096, temperature: 0.7 };
            if (allTools.length > 0) { followBody.tools = allTools; followBody.tool_choice = 'auto'; }
            let followRes;
            try {
              followRes = await fetch(config.url, {
                method: 'POST',
                headers,
                body: JSON.stringify(followBody),
                signal: controller.signal,
              });
            } catch (fetchErr) {
              console.error('[gateway:chat] Follow-up fetch failed:', fetchErr.message);
              mainWindow?.webContents.send('gateway:stream-chunk', { content: '\n\nI encountered a network error while processing. Please try again.' });
              followRes = null;
            }
            if (followRes?.ok) {
              // Follow-up streaming with tool chaining (max 5 additional rounds)
              let chainDepth = 0;
              const maxChainDepth = store.get('integrations.maxActionSteps') || 10;
              let currentRes = followRes;
              let lastRoundHadToolCalls = false;
              try {
                while (currentRes.ok && chainDepth < maxChainDepth) {
                  const fReader = currentRes.body.getReader();
                  let fBuffer = '';
                  let fContent = '';
                  let fToolChunks = [];

                  while (true) {
                    const { done: d2, value: v2 } = await fReader.read();
                    if (d2) break;
                    fBuffer += decoder.decode(v2, { stream: true });
                    const fLines = fBuffer.split('\n');
                    fBuffer = fLines.pop() || '';
                    for (const fLine of fLines) {
                      const fTrimmed = fLine.trim();
                      if (!fTrimmed.startsWith('data:')) continue;
                      const fData = fTrimmed.slice(fTrimmed.startsWith('data: ') ? 6 : 5).trim();
                      if (fData === '[DONE]') break;
                      try {
                        const fParsed = JSON.parse(fData);
                        const fDelta = fParsed.choices?.[0]?.delta;
                        if (fDelta?.tool_calls) {
                          for (const tc of fDelta.tool_calls) {
                            const idx = tc.index ?? 0;
                            if (!fToolChunks[idx]) fToolChunks[idx] = { id: '', name: '', arguments: '' };
                            if (tc.id) fToolChunks[idx].id = tc.id;
                            if (tc.function?.name) fToolChunks[idx].name += tc.function.name;
                            if (tc.function?.arguments) fToolChunks[idx].arguments += tc.function.arguments;
                          }
                        }
                        const text = fDelta?.content || '';
                        if (text) { fContent += text; mainWindow?.webContents.send('gateway:stream-chunk', { content: text }); }
                      } catch {}
                    }
                  }

                  // If no tool calls in this round, we're done
                  if (!fToolChunks.length) { lastRoundHadToolCalls = false; break; }

                  lastRoundHadToolCalls = true;

                  // Execute chained tool calls
                  console.log(`[gateway:chat] Chained tool calls (depth ${chainDepth + 1}):`, fToolChunks.map(tc => tc.name));
                  mainWindow?.webContents.send('gateway:stream-chunk', { content: '\n\n⚡ *Running action...*\n\n' });
                  const chainAssistantCalls = fToolChunks.map((tc, i) => ({ id: tc.id || `call_chain_${i}`, type: 'function', function: { name: tc.name, arguments: tc.arguments } }));
                  updatedMessages.push({ role: 'assistant', content: fContent || null, tool_calls: chainAssistantCalls });

                  for (const tc of chainAssistantCalls) {
                    let args = {}; try { args = JSON.parse(tc.function.arguments); } catch {}
                    console.log(`[gateway:chat] Chained tool: ${tc.function.name}`, args);
                    if (!tc.function.name) { updatedMessages.push({ role: 'tool', tool_call_id: tc.id, content: 'Error: empty tool name' }); continue; }
                    let toolResult;
                    const mcpParsed = mcpClient.parseToolCallName(tc.function.name);
                    if (mcpParsed) {
                      const mcpResult = await mcpClient.callTool(mcpParsed.serverId, mcpParsed.toolName, args);
                      if (mcpResult.success) {
                        const content = mcpResult.result?.content;
                        toolResult = Array.isArray(content) ? content.map(c => c.text || JSON.stringify(c)).join('\n') : JSON.stringify(mcpResult.result);
                      } else { toolResult = `MCP tool error: ${mcpResult.error}`; }
                    } else {
                      toolResult = await toolCalling.executeTool(tc.function.name, args, context);
                    }
                    updatedMessages.push({ role: 'tool', tool_call_id: tc.id, content: toolResult || '' });
                  }

                  // Next round — clear indicator before making next LLM call
                  mainWindow?.webContents.send('gateway:clear-indicator');
                  chainDepth++;

                  // If we've hit the depth limit, don't make another fetch — fall through to the fallback message
                  if (chainDepth >= maxChainDepth) {
                    console.log(`[gateway:chat] Chain depth limit reached (${maxChainDepth})`);
                    break;
                  }

                  const nextBody = { model: activeModel, messages: updatedMessages, stream: true, max_completion_tokens: 4096, temperature: 0.7, tools: allTools, tool_choice: 'auto' };
                  currentRes = await fetch(config.url, { method: 'POST', headers, body: JSON.stringify(nextBody), signal: controller.signal });

                  if (!currentRes.ok) {
                    console.error(`[gateway:chat] Chained fetch failed: ${currentRes.status} ${currentRes.statusText}`);
                    break;
                  }
                }
              } catch (chainErr) {
                console.error('[gateway:chat] Error in tool chain loop:', chainErr.message);
                mainWindow?.webContents.send('gateway:clear-indicator');
                mainWindow?.webContents.send('gateway:stream-chunk', { content: '\n\nAn error occurred while processing the action chain. Please try again.' });
              }

              // If the loop ended because of depth limit or fetch error WHILE tools were still needed, send fallback
              if (lastRoundHadToolCalls) {
                mainWindow?.webContents.send('gateway:clear-indicator');
                mainWindow?.webContents.send('gateway:stream-chunk', { content: '\n\nI completed several steps but ran out of processing rounds. Send another message and I\'ll continue where I left off.' });
              }
            } else if (followRes && !followRes.ok) {
              console.error(`[gateway:chat] Follow-up response error: ${followRes.status}`);
              mainWindow?.webContents.send('gateway:stream-chunk', { content: '\n\nI ran the action but couldn\'t generate a follow-up response. The action may have completed — please check and let me know if you need more help.' });
            }
          }

          mainWindow?.webContents.send('gateway:stream-done');
          return { success: true };
        }
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    // Fallback: use server proxy (requires auth)
    const token = store.get('auth.token');
    const serverUrl = store.get('auth.serverUrl') || activeWebAppUrl;
    if (!token) return { success: false, error: 'No API key configured. Add your OpenAI key in Settings → Public Cloud.' };

    try {
      const res = await fetch(`${serverUrl}/api/desktop/gateway-chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ messages, model }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        return { success: false, error: err.error || `Server error ${res.status}` };
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter(l => l.startsWith('data: '));

        for (const line of lines) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            mainWindow?.webContents.send('gateway:stream-done');
          } else {
            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                mainWindow?.webContents.send('gateway:stream-chunk', parsed);
              } else if (parsed.error) {
                mainWindow?.webContents.send('gateway:stream-done');
                return { success: false, error: parsed.error };
              }
            } catch { /* skip malformed */ }
          }
        }
      }

      return { success: true };
    } catch (err) {
      if (err.name === 'AbortError') {
        mainWindow?.webContents.send('gateway:stream-done');
        return { success: false, error: 'Stream aborted by user' };
      }
      return { success: false, error: err.message };
    } finally {
      streamAbort.clearActiveStreamController();
    }
  });

  // Ollama — pull model (streaming progress via events)
  ipcMain.handle('ollama:pull', async (event, modelName) => await pullModel(modelName));

  ipcMain.handle('ollama:cancelPull', () => {
    if (activePullController) {
      activePullController.abort();
      activePullController = null;
      return { success: true };
    }
    return { success: false };
  });

  // Ollama — check if a specific model is available
  ipcMain.handle('ollama:hasModel', async (event, modelName) => {
    return await localAI.hasModel(modelName);
  });

  // Ollama — delete a model
  ipcMain.handle('ollama:delete', async (event, modelName) => {
    try {
      const ollamaHost = store.get('local.ollamaHost') || OLLAMA_URL;
      const res = await fetch(`${ollamaHost}/api/delete`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName }),
      });
      if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Ollama — unload a model from memory (frees RAM/VRAM)
  // For iimagine-engine: stops the engine process entirely
  ipcMain.handle('ollama:unload', async (event, modelName) => {
    // If engine is running, stop it (equivalent of unloading)
    const engineStatus = await engineManager.getStatus();
    if (engineStatus.running) {
      return await engineManager.stopEngine();
    }
    // Fallback: Ollama keep_alive: 0
    try {
      const ollamaHost = store.get('local.ollamaHost') || OLLAMA_URL;
      const res = await fetch(`${ollamaHost}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelName, keep_alive: 0 }),
      });
      if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
      await res.text();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Ollama — test connection to a custom host
  ipcMain.handle('ollama:testConnection', async (event, host) => {
    try {
      const url = host.replace(/\/$/, '');
      const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
      const data = await res.json();
      return { success: true, models: (data.models || []).length };
    } catch (err) {
      return { success: false, error: err.message || 'Connection failed' };
    }
  });

  // Ollama — get model storage location (now returns engine models dir as primary)
  ipcMain.handle('ollama:getModelLocation', async () => {
    // Primary: iimagine-engine models directory
    return engineManager.getModelsDir();
  });

  // Ollama — open model storage location in file explorer
  ipcMain.handle('ollama:openModelLocation', async () => {
    const modelsPath = engineManager.getModelsDir();
    shell.openPath(modelsPath);
  });

  // Shell — generic open path (for notes folder, etc.)
  ipcMain.handle('shell:openPath', async (event, filePath) => {
    if (filePath) shell.openPath(filePath);
  });

  // Shell — open external URL in default browser
  ipcMain.handle('shell:openExternal', async (event, url) => {
    if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
      shell.openExternal(url);
    }
  });

  // Hardware scanner
  ipcMain.handle('hardware:scan', async () => await scanHardware());

  // Model registry manifest
  ipcMain.handle('manifest:get', () => manifestManager.getManifest());
  ipcMain.handle('manifest:checkUpdate', () => manifestManager.checkUpdate());
  ipcMain.handle('manifest:dismissUpdate', () => manifestManager.dismissUpdate());

  // ── Model Orchestrator — instant swap & preloading ────────────
  const sendModelEvent = (channel, data) => {
    mainWindow?.webContents.send(channel, data);
  };

  ipcMain.handle('model:switch', async (event, targetModel) => {
    return await modelOrchestrator.switchModel(targetModel, sendModelEvent);
  });

  ipcMain.handle('model:preload', async (event, targetModel) => {
    modelOrchestrator.preloadModel(targetModel, sendModelEvent);
    return { success: true };
  });

  ipcMain.handle('model:keepAlive', async (event, modelName) => {
    await modelOrchestrator.keepAlive(modelName);
    return { success: true };
  });

  ipcMain.handle('model:getState', async () => {
    return await modelOrchestrator.syncState();
  });

  ipcMain.handle('model:getLoadedModels', async () => {
    return await modelOrchestrator.getLoadedModels();
  });

  // Ollama — generate embeddings for text chunks (batch)
  // Now routes through local-ai-adapter (engine-manager first, Ollama fallback)
  ipcMain.handle('ollama:embedBatch', async (event, { model, texts }) => {
    const results = await localAI.embedBatch(texts, model, (processed, total) => {
      mainWindow?.webContents.send('kb:embed-progress', { processed, total });
    });
    return results;
  });

  // Ollama — non-streaming chat
  // Now routes through local-ai-adapter (engine-manager first, Ollama fallback)
  ipcMain.handle('ollama:chat', async (event, { model, messages }) => {
    return await localAI.chat({ model, messages });
  });

  // Ollama — Advanced Settings (stored for use by chatStream and other Ollama calls)
  // NOTE: These values should be injected into the 'ollama:chatStream' handler's options object
  // when making requests to Ollama's /api/chat endpoint. The settings are:
  //   numGpu → options.num_gpu, numThread → options.num_thread,
  //   keepAlive → keep_alive (top-level param), numCtx → options.num_ctx
  ipcMain.handle('ollama:getAdvancedSettings', () => {
    return {
      numGpu: store.get('ollama.numGpu', 'auto'),
      numThread: store.get('ollama.numThread', 'auto'),
      keepAlive: store.get('ollama.keepAlive', '5m'),
      numCtx: store.get('ollama.numCtx', 'auto'),
      reasoning: store.get('ollama.reasoning', false),
      toolsEnabled: store.get('ollama.toolsEnabled', true),
    };
  });

  ipcMain.handle('ollama:setAdvancedSettings', (event, settings) => {
    if (settings.numGpu !== undefined) store.set('ollama.numGpu', settings.numGpu);
    if (settings.numThread !== undefined) store.set('ollama.numThread', settings.numThread);
    if (settings.keepAlive !== undefined) store.set('ollama.keepAlive', settings.keepAlive);
    if (settings.numCtx !== undefined) store.set('ollama.numCtx', settings.numCtx);
    if (settings.reasoning !== undefined) store.set('ollama.reasoning', settings.reasoning);
    if (settings.toolsEnabled !== undefined) store.set('ollama.toolsEnabled', settings.toolsEnabled);
    return { success: true };
  });

  // Ollama — Runtime Monitoring (query running models)
  // Now routes through local-ai-adapter
  ipcMain.handle('ollama:getRunningModels', async () => {
    const engineStatus = await engineManager.getStatus();
    if (engineStatus.running) {
      // Engine only runs one model at a time
      return { models: engineStatus.currentModel ? [{ name: engineStatus.currentModel, engine: 'iimagine' }] : [] };
    }
    // Fallback: Ollama
    try {
      const ollamaHost = store.get('local.ollamaHost') || OLLAMA_URL;
      const res = await fetch(`${ollamaHost}/api/ps`);
      if (!res.ok) return { models: [] };
      const data = await res.json();
      return { models: data.models || [] };
    } catch {
      return { models: [] };
    }
  });

  // ── IIMAGINE Engine (llama.cpp) — replaces Ollama ─────────────
  // These handlers use the bundled iimagine-engine binary.
  // Shows as "iimagine-engine" in Activity Monitor instead of "ollama".

  ipcMain.handle('engine:status', async () => {
    return await engineManager.getStatus();
  });

  ipcMain.handle('engine:start', async (event, { modelPath, options }) => {
    const result = await engineManager.startEngine(modelPath, options);
    if (result.success) {
      mainWindow?.webContents.send('engine:started', { model: modelPath });
    }
    return result;
  });

  ipcMain.handle('engine:stop', async () => {
    return await engineManager.stopEngine();
  });

  ipcMain.handle('engine:switch', async (event, { modelPath, options }) => {
    mainWindow?.webContents.send('engine:switching', { model: modelPath });
    const result = await engineManager.switchModel(modelPath, options);
    if (result.success) {
      mainWindow?.webContents.send('engine:started', { model: modelPath });
    }
    return result;
  });

  ipcMain.handle('engine:getModelsDir', () => {
    return engineManager.getModelsDir();
  });

  ipcMain.handle('engine:getInstalledModels', () => {
    return engineManager.getInstalledModels();
  });

  ipcMain.handle('engine:deleteModel', (event, filename) => {
    return engineManager.deleteModel(filename);
  });

  ipcMain.handle('engine:getRegistry', () => {
    // The live manifest (cache → remote → bundled) is the source of truth for
    // the catalog. Fall back to the static registry only if the manifest is
    // unavailable, so the browser/advisor always have data.
    const manifestModels = manifestManager.getModels();
    if (manifestModels && manifestModels.length > 0) {
      return manifestModels;
    }
    return modelRegistry.getAllModels();
  });

  // Engine — download model from HuggingFace
  let activeDownloadController = null;

  ipcMain.handle('engine:downloadModel', async (event, { url, filename }) => {
    activeDownloadController = new AbortController();

    const onProgress = (downloaded, total) => {
      mainWindow?.webContents.send('engine:download-progress', {
        filename,
        downloaded,
        total,
        percent: total > 0 ? Math.round((downloaded / total) * 100) : 0,
      });
    };

    const result = await engineManager.downloadModel(url, filename, onProgress, activeDownloadController.signal);
    activeDownloadController = null;

    mainWindow?.webContents.send('engine:download-done', {
      filename,
      success: result.success,
      error: result.error,
    });

    return result;
  });

  ipcMain.handle('engine:cancelDownload', () => {
    if (activeDownloadController) {
      activeDownloadController.abort();
      activeDownloadController = null;
      return { success: true };
    }
    return { success: false };
  });

  // ── SD Engine — local image generation (stable-diffusion.cpp) ────────────

  const sdEngine = require('./sd-engine-manager');

  ipcMain.handle('sd:status', () => {
    return sdEngine.getStatus();
  });

  ipcMain.handle('sd:getInstalledModels', () => {
    return sdEngine.getInstalledModels();
  });

  ipcMain.handle('sd:getModelsDir', () => {
    return sdEngine.getModelsDir();
  });

  ipcMain.handle('sd:txt2img', async (event, params) => {
    const onProgress = (progress) => {
      mainWindow?.webContents.send('sd:progress', progress);
    };

    const result = await sdEngine.txt2img({ ...params, onProgress });

    if (result.success && result.imagePath) {
      // Read the generated image and return as base64
      const imageBuffer = fs.readFileSync(result.imagePath);
      const base64 = imageBuffer.toString('base64');
      return {
        success: true,
        image: base64,
        mediaType: 'image/png',
        imagePath: result.imagePath,
        filename: result.filename,
      };
    }
    return result;
  });

  ipcMain.handle('sd:img2img', async (event, params) => {
    const onProgress = (progress) => {
      mainWindow?.webContents.send('sd:progress', progress);
    };

    // If inputImage is base64 data, save to temp file first
    let inputImagePath = params.inputImagePath;
    if (params.inputImageBase64 && !inputImagePath) {
      inputImagePath = sdEngine.saveTempInput(params.inputImageBase64, 'png');
    }

    const result = await sdEngine.img2img({
      ...params,
      inputImagePath,
      onProgress,
    });

    if (result.success && result.imagePath) {
      const imageBuffer = fs.readFileSync(result.imagePath);
      const base64 = imageBuffer.toString('base64');
      return {
        success: true,
        image: base64,
        mediaType: 'image/png',
        imagePath: result.imagePath,
        filename: result.filename,
      };
    }
    return result;
  });

  ipcMain.handle('sd:cancel', () => {
    return sdEngine.cancelGeneration();
  });

  ipcMain.handle('sd:deleteModel', (event, filename) => {
    return sdEngine.deleteModel(filename);
  });

  ipcMain.handle('sd:cleanup', () => {
    sdEngine.cleanupTempFiles();
    return { success: true };
  });

  // SD model download — routes to ~/.iimagine/sd-models/
  let activeSdDownloadController = null;

  ipcMain.handle('sd:downloadModel', async (event, { url, filename }) => {
    activeSdDownloadController = new AbortController();
    const sdModelsDir = sdEngine.getModelsDir();
    const targetPath = path.join(sdModelsDir, filename);
    const tempPath = targetPath + '.downloading';

    const onProgress = (downloaded, total) => {
      mainWindow?.webContents.send('sd:download-progress', {
        filename,
        downloaded,
        total,
        percent: total > 0 ? Math.round((downloaded / total) * 100) : 0,
      });
    };

    try {
      const res = await fetch(url, { signal: activeSdDownloadController.signal });
      if (!res.ok) {
        return { success: false, error: `Download failed: HTTP ${res.status}` };
      }

      const totalSize = parseInt(res.headers.get('content-length') || '0');
      const writer = fs.createWriteStream(tempPath);
      const reader = res.body.getReader();
      let downloaded = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        writer.write(Buffer.from(value));
        downloaded += value.length;
        onProgress(downloaded, totalSize);
      }

      writer.end();
      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });

      fs.renameSync(tempPath, targetPath);
      activeSdDownloadController = null;

      mainWindow?.webContents.send('sd:download-done', { filename, success: true });
      return { success: true, path: targetPath, filename };
    } catch (err) {
      try { fs.unlinkSync(tempPath); } catch {}
      activeSdDownloadController = null;

      const error = err.name === 'AbortError' ? 'Download cancelled' : err.message;
      mainWindow?.webContents.send('sd:download-done', { filename, success: false, error });
      return { success: false, error };
    }
  });

  ipcMain.handle('sd:cancelDownload', () => {
    if (activeSdDownloadController) {
      activeSdDownloadController.abort();
      activeSdDownloadController = null;
      return { success: true };
    }
    return { success: false };
  });

  // Engine — streaming chat (OpenAI-compatible)
  ipcMain.handle('engine:chatStream', async (event, { messages }) => {
    const toolCalling = require('./tool-calling');
    const controller = new AbortController();
    streamAbort.setActiveStreamController(controller);

    try {
      // Inject active persona
      const activePersona = personaStorage.getActivePersona();
      if (activePersona && activePersona.custom_instructions) {
        const hasSystem = messages.some(m => m.role === 'system');
        if (!hasSystem) {
          messages.unshift({ role: 'system', content: activePersona.custom_instructions });
        } else {
          const sysIdx = messages.findIndex(m => m.role === 'system');
          messages[sysIdx].content = activePersona.custom_instructions + '\n\n' + messages[sysIdx].content;
        }
      }

      // Auto-start engine if not running
      const engineStatus = await engineManager.getStatus();
      const modelFilename = store.get('provider.active')?.model || store.get('local.selectedModel');
      if (!engineStatus.running && modelFilename) {
        const modelsDir = engineManager.getModelsDir();
        let modelPath = path.join(modelsDir, modelFilename);
        if (!fs.existsSync(modelPath) && !modelFilename.endsWith('.gguf')) {
          modelPath = path.join(modelsDir, modelFilename + '.gguf');
        }
        if (fs.existsSync(modelPath)) {
          console.log('[engine:chatStream] Auto-starting engine with:', modelFilename);
          const startResult = await engineManager.startEngine(modelPath, {
            onProgress: (p) => mainWindow?.webContents.send('engine:loadProgress', p),
          });
          if (!startResult.success) {
            mainWindow?.webContents.send('engine:loadProgress', { phase: 'error', percent: 0, label: '' });
            return { success: false, error: `Failed to start AI engine: ${startResult.error}` };
          }
          console.log('[engine:chatStream] Engine started on port:', startResult.port || 8847);
          // Engine is up; the first request still pays a one-time prompt-processing cost.
          mainWindow?.webContents.send('engine:loadProgress', {
            phase: 'generating', percent: 97, label: 'Generating first response…',
          });
        } else {
          return { success: false, error: `Model file not found: ${modelFilename}. Download it from Settings → Models.` };
        }
      } else if (!engineStatus.running && !modelFilename) {
        return { success: false, error: 'No local model selected. Download and select a model in Settings → Models.' };
      } else if (engineStatus.running && modelFilename) {
        // Check if we need to switch models
        const modelsDir = engineManager.getModelsDir();
        let modelPath = path.join(modelsDir, modelFilename);
        if (!fs.existsSync(modelPath) && !modelFilename.endsWith('.gguf')) {
          modelPath = path.join(modelsDir, modelFilename + '.gguf');
        }
        if (engineStatus.currentModel !== modelPath && fs.existsSync(modelPath)) {
          console.log('[engine:chatStream] Switching model to:', modelFilename);
          await engineManager.stopEngine();
          await new Promise(r => setTimeout(r, 500));
          const startResult = await engineManager.startEngine(modelPath, {
            onProgress: (p) => mainWindow?.webContents.send('engine:loadProgress', p),
          });
          if (!startResult.success) {
            mainWindow?.webContents.send('engine:loadProgress', { phase: 'error', percent: 0, label: '' });
            return { success: false, error: `Failed to start AI engine: ${startResult.error}` };
          }
          mainWindow?.webContents.send('engine:loadProgress', {
            phase: 'generating', percent: 97, label: 'Generating first response…',
          });
        }
      }

      const numCtx = store.get('ollama.numCtx', '4096');
      const toolsEnabled = store.get('ollama.toolsEnabled', true);
      const webSearchEnabled = !!store.get('webSearch.enabled') || !!store.get('local.webSearchEnabled');
      const kbStats = kbStorage.getKBStats();
      const hasKBDocuments = kbStats.embeddingCount > 0;
      const tools = toolsEnabled ? toolCalling.getActiveTools({ webSearchEnabled, hasKBDocuments }) : [];

      const result = await engineManager.chat({
        messages,
        stream: true,
        options: {
          max_tokens: parseInt(numCtx) || 4096,
          signal: controller.signal,
          tools: tools.length > 0 ? tools : undefined,
        },
      });

      if (!result.success) {
        return { success: false, error: result.error };
      }

      // Stream the response (OpenAI SSE format)
      const reader = result.response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';
      let toolCallChunks = []; // Accumulate tool call deltas
      let finalStats = null;   // Captured token usage / timings from final chunk(s)

      const captureStats = (parsed) => {
        if (parsed?.usage) finalStats = { ...(finalStats || {}), usage: parsed.usage };
        if (parsed?.timings) finalStats = { ...(finalStats || {}), timings: parsed.timings };
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            break;
          }
          try {
            const parsed = JSON.parse(data);
            captureStats(parsed);
            const delta = parsed.choices?.[0]?.delta;
            const finishReason = parsed.choices?.[0]?.finish_reason;

            // Detect tool calls in OpenAI streaming format
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index || 0;
                if (!toolCallChunks[idx]) {
                  toolCallChunks[idx] = { id: tc.id || '', name: '', arguments: '' };
                }
                if (tc.function?.name) toolCallChunks[idx].name = tc.function.name;
                if (tc.function?.arguments) toolCallChunks[idx].arguments += tc.function.arguments;
              }
            }

            // Regular content. (Thinking/reasoning is force-disabled at the engine via
            // --reasoning-budget 0, so the answer arrives directly in `content`. We do
            // NOT surface `reasoning_content` — that's the model's chain-of-thought.)
            const content = delta?.content || '';
            if (content) {
              // Strip Gemma 4 special tokens that leak through (e.g. <unused35>, <unused0>)
              const cleaned = content.replace(/<unused\d+>|<tool_response\|>|<\/tool_response>|\[multimodal\]/g, '');
              if (cleaned) {
                fullContent += cleaned;
                mainWindow?.webContents.send('ollama:stream-chunk', {
                  message: { content: cleaned },
                });
              }
            }
          } catch {}
        }
      }

      // If tool calls were detected, execute them and do a follow-up
      if (toolCallChunks.length > 0) {
        mainWindow?.webContents.send('ollama:stream-chunk', { message: { content: '\n\n🔍 *Searching...*\n\n' } });

        const context = { store, kbStorage };
        const updatedMessages = [...messages];
        
        // Add assistant message with tool_calls
        const assistantToolCalls = toolCallChunks.map((tc, i) => ({
          id: tc.id || `call_${i}`,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments },
        }));
        updatedMessages.push({ role: 'assistant', content: fullContent || null, tool_calls: assistantToolCalls });

        // Execute each tool and add results
        for (const tc of assistantToolCalls) {
          let args = {};
          try { args = JSON.parse(tc.function.arguments); } catch {}
          console.log(`[engine:chatStream] Executing tool: ${tc.function.name}`, args);
          const toolResult = await toolCalling.executeTool(tc.function.name, args, context);
          updatedMessages.push({ role: 'tool', tool_call_id: tc.id, content: toolResult });
        }

        // Follow-up request with tool results (no tools this time to avoid loops)
        const followUpResult = await engineManager.chat({
          messages: updatedMessages,
          stream: true,
          options: {
            max_tokens: parseInt(numCtx) || 4096,
            signal: controller.signal,
          },
        });

        if (followUpResult.success) {
          const followReader = followUpResult.response.body.getReader();
          let followBuffer = '';
          while (true) {
            const { done: d2, value: v2 } = await followReader.read();
            if (d2) break;
            followBuffer += decoder.decode(v2, { stream: true });
            const followLines = followBuffer.split('\n');
            followBuffer = followLines.pop() || '';
            for (const fLine of followLines) {
              if (!fLine.startsWith('data: ')) continue;
              const fData = fLine.slice(6).trim();
              if (fData === '[DONE]') break;
              try {
                const fParsed = JSON.parse(fData);
                captureStats(fParsed);
                const fContent = fParsed.choices?.[0]?.delta?.content || '';
                if (fContent) {
                  const fCleaned = fContent.replace(/<unused\d+>|<tool_response\|>|<\/tool_response>|\[multimodal\]/g, '');
                  if (fCleaned) {
                    mainWindow?.webContents.send('ollama:stream-chunk', { message: { content: fCleaned } });
                  }
                }
              } catch {}
            }
          }
        }
      }

      // Emit per-response token stats (used by the chat UI) before signalling done.
      if (finalStats) {
        const usage = finalStats.usage || {};
        const timings = finalStats.timings || {};
        mainWindow?.webContents.send('engine:stats', {
          completionTokens: usage.completion_tokens ?? timings.predicted_n ?? null,
          promptTokens: usage.prompt_tokens ?? timings.prompt_n ?? null,
          tokensPerSecond: typeof timings.predicted_per_second === 'number'
            ? timings.predicted_per_second
            : null,
        });
      }

      mainWindow?.webContents.send('ollama:stream-done');
      return { success: true };
    } catch (err) {
      if (err.name === 'AbortError') {
        mainWindow?.webContents.send('ollama:stream-done');
        return { success: false, error: 'Stream aborted by user' };
      }
      return { success: false, error: err.message };
    } finally {
      streamAbort.clearActiveStreamController();
    }
  });

  // Engine — embeddings
  ipcMain.handle('engine:embed', async (event, { text }) => {
    return await engineManager.embed(text);
  });

  ipcMain.handle('engine:embedBatch', async (event, { texts }) => {
    const results = [];
    let processed = 0;

    for (const text of texts) {
      const result = await engineManager.embed(text);
      results.push(result);
      processed++;
      mainWindow?.webContents.send('kb:embed-progress', { processed, total: texts.length });
    }

    return results;
  });

  ipcMain.handle('engine:isInstalled', () => {
    return engineManager.isEngineInstalled();
  });

  ipcMain.handle('engine:health', async () => {
    return await engineManager.healthCheck();
  });

  // ── Local AI — unified interface (engine-first, Ollama fallback) ──
  // This is the preferred API for new renderer code.
  ipcMain.handle('localAI:status', async () => {
    const status = await localAI.getStatus();
    console.log('[localAI:status]', JSON.stringify({ running: status.running, engine: status.engine, modelCount: status.models?.length, installed: status.installed }));
    return status;
  });

  ipcMain.handle('localAI:ensureRunning', async () => {
    return await localAI.ensureRunning();
  });

  ipcMain.handle('localAI:embed', async (event, { text, model }) => {
    return await localAI.embed(text, model);
  });

  ipcMain.handle('localAI:chat', async (event, { model, messages, options }) => {
    return await localAI.chat({ model, messages, options });
  });

  ipcMain.handle('localAI:hasModel', async (event, modelName) => {
    return await localAI.hasModel(modelName);
  });

  ipcMain.handle('localAI:getBestChatModel', async () => {
    return await localAI.getBestChatModel();
  });

  // Ollama — streaming chat
  ipcMain.handle('ollama:chatStream', async (event, { model, messages }) => {
    const toolCalling = require('./tool-calling');
    try {
      // Inject active persona system prompt
      const activePersona = personaStorage.getActivePersona();
      if (activePersona && activePersona.custom_instructions) {
        const hasSystem = messages.some(m => m.role === 'system');
        if (!hasSystem) {
          messages.unshift({ role: 'system', content: activePersona.custom_instructions });
        } else {
          const sysIdx = messages.findIndex(m => m.role === 'system');
          messages[sysIdx].content = activePersona.custom_instructions + '\n\n' + messages[sysIdx].content;
        }
      }

      // Ensure engine is running (auto-starts if needed)
      const ensureResult = await localAI.ensureRunning();

      // Try iimagine-engine first (primary path)
      const engineStatus = await engineManager.getStatus();
      if (engineStatus.running) {
        const controller = new AbortController();
        streamAbort.setActiveStreamController(controller);

        const numCtx = store.get('ollama.numCtx', '4096');
        const result = await engineManager.chat({
          messages,
          stream: true,
          options: {
            max_tokens: parseInt(numCtx) || 4096,
            signal: controller.signal,
          },
        });

        if (!result.success) {
          streamAbort.clearActiveStreamController();
          return { success: false, error: result.error };
        }

        // Stream the response (OpenAI SSE format → ollama:stream-chunk for compatibility)
        const reader = result.response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finalStats = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') break;
            try {
              const parsed = JSON.parse(data);
              if (parsed?.usage) finalStats = { ...(finalStats || {}), usage: parsed.usage };
              if (parsed?.timings) finalStats = { ...(finalStats || {}), timings: parsed.timings };
              const content = parsed.choices?.[0]?.delta?.content || '';
              if (content) {
                const cleaned = content.replace(/<unused\d+>|<tool_response\|>|<\/tool_response>|\[multimodal\]/g, '');
                if (cleaned) {
                  mainWindow?.webContents.send('ollama:stream-chunk', {
                    message: { content: cleaned },
                  });
                }
              }
            } catch {}
          }
        }

        if (finalStats) {
          const usage = finalStats.usage || {};
          const timings = finalStats.timings || {};
          mainWindow?.webContents.send('engine:stats', {
            completionTokens: usage.completion_tokens ?? timings.predicted_n ?? null,
            promptTokens: usage.prompt_tokens ?? timings.prompt_n ?? null,
            tokensPerSecond: typeof timings.predicted_per_second === 'number'
              ? timings.predicted_per_second
              : null,
          });
        }

        mainWindow?.webContents.send('ollama:stream-done');
        streamAbort.clearActiveStreamController();
        return { success: true };
      }

      // Fallback: try Ollama (legacy support)
      const ollamaHost = store.get('local.ollamaHost') || OLLAMA_URL;
      const controller = new AbortController();
      streamAbort.setActiveStreamController(controller);

      const options = toolCalling.buildOllamaOptions();
      const keepAlive = toolCalling.getKeepAlive();
      const toolsEnabled = store.get('ollama.toolsEnabled', true);
      const webSearchEnabled = !!store.get('webSearch.enabled');
      const kbStats = kbStorage.getKBStats();
      const hasKBDocuments = kbStats.embeddingCount > 0;
      const tools = toolsEnabled ? toolCalling.getActiveTools({ webSearchEnabled, hasKBDocuments }) : [];

      const body = { model, messages, stream: true, options };
      if (keepAlive !== '5m') body.keep_alive = keepAlive;
      if (tools.length > 0) body.tools = tools;

      const res = await fetch(`${ollamaHost}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Ollama error: ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullResponse = '';
      let toolCalls = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.message?.tool_calls && parsed.message.tool_calls.length > 0) {
              toolCalls = parsed.message.tool_calls;
            } else {
              mainWindow?.webContents.send('ollama:stream-chunk', parsed);
              if (parsed.message?.content) fullResponse += parsed.message.content;
            }
          } catch {}
        }
      }

      if (toolCalls.length > 0) {
        mainWindow?.webContents.send('ollama:stream-chunk', { message: { content: '\n\n🔍 *Searching...*\n\n' } });
        const context = { ollamaHost, kbStorage, store };
        const updatedMessages = [...messages, { role: 'assistant', content: fullResponse, tool_calls: toolCalls }];
        for (const tc of toolCalls) {
          const fnName = tc.function?.name;
          const fnArgs = tc.function?.arguments || {};
          const result = await toolCalling.executeTool(fnName, fnArgs, context);
          updatedMessages.push({ role: 'tool', content: result });
        }
        const followUpBody = { model, messages: updatedMessages, stream: true, options };
        if (keepAlive !== '5m') followUpBody.keep_alive = keepAlive;
        const followUpRes = await fetch(`${ollamaHost}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(followUpBody),
          signal: controller.signal,
        });
        if (followUpRes.ok) {
          const followReader = followUpRes.body.getReader();
          while (true) {
            const { done: d2, value: v2 } = await followReader.read();
            if (d2) break;
            const chunk2 = decoder.decode(v2);
            const lines2 = chunk2.split('\n').filter(Boolean);
            for (const line2 of lines2) {
              try { mainWindow?.webContents.send('ollama:stream-chunk', JSON.parse(line2)); } catch {}
            }
          }
        }
      }

      mainWindow?.webContents.send('ollama:stream-done');
      return { success: true };
    } catch (err) {
      if (err.name === 'AbortError') {
        mainWindow?.webContents.send('ollama:stream-done');
        return { success: false, error: 'Stream aborted by user' };
      }
      return { success: false, error: err.message };
    } finally {
      streamAbort.clearActiveStreamController();
    }
  });

  // Settings
  ipcMain.handle('settings:get', (event, key) => store.get(key));
  ipcMain.handle('settings:set', (event, key, value) => { store.set(key, value); return true; });
  // Chat — stop/abort active stream
  ipcMain.handle('chat:stop', () => {
    const aborted = streamAbort.abortActiveStream();
    mainWindow?.webContents.send('chat:stream-stopped');
    return { success: aborted };
  });

  // Chat — pick file via native dialog
  ipcMain.handle('chat:pickFile', async () => {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      title: 'Attach a file',
      filters: [
        { name: 'All Supported', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'txt', 'md', 'csv', 'json', 'js', 'ts', 'py', 'html', 'css', 'xml', 'yaml', 'yml', 'log', 'pdf', 'docx'] },
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
        { name: 'Documents', extensions: ['txt', 'md', 'csv', 'json', 'js', 'ts', 'py', 'html', 'css', 'xml', 'yaml', 'yml', 'log', 'pdf', 'docx'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  // Chat — read file for attachment (image or document)
  ipcMain.handle('chat:readFile', async (event, filePath) => {
    try {
      const ext = path.extname(filePath).toLowerCase();
      const filename = path.basename(filePath);
      const stat = fs.statSync(filePath);

      const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
      const textExts = ['.txt', '.md', '.csv', '.json', '.js', '.ts', '.py', '.html', '.css', '.xml', '.yaml', '.yml', '.log'];

      if (imageExts.includes(ext)) {
        // 10MB limit for images
        if (stat.size > 10 * 1024 * 1024) {
          return { error: `Image too large (${(stat.size / 1024 / 1024).toFixed(1)}MB). Max 10MB.` };
        }
        const buffer = fs.readFileSync(filePath);
        const base64 = buffer.toString('base64');
        const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
        return { type: 'image', base64, mimeType: mimeMap[ext] || 'image/png', filename };
      } else if (ext === '.pdf') {
        // 20MB limit for PDFs
        if (stat.size > 20 * 1024 * 1024) {
          return { error: `PDF too large (${(stat.size / 1024 / 1024).toFixed(1)}MB). Max 20MB.` };
        }
        try {
          const pdfParse = require('pdf-parse');
          const buffer = fs.readFileSync(filePath);
          const data = await pdfParse(buffer);
          const text = data.text?.trim();
          if (!text) {
            return { error: 'Could not extract text from this PDF. It may be a scanned image PDF.' };
          }
          // Truncate to ~100K chars to avoid overwhelming context window
          const truncated = text.length > 100000 ? text.slice(0, 100000) + '\n\n[... document truncated ...]' : text;
          return { type: 'document', text: truncated, filename };
        } catch (pdfErr) {
          return { error: `PDF extraction failed: ${pdfErr.message}` };
        }
      } else if (ext === '.docx') {
        // 20MB limit for DOCX
        if (stat.size > 20 * 1024 * 1024) {
          return { error: `File too large (${(stat.size / 1024 / 1024).toFixed(1)}MB). Max 20MB.` };
        }
        try {
          const mammoth = require('mammoth');
          const result = await mammoth.extractRawText({ path: filePath });
          const text = result.value?.trim();
          if (!text) {
            return { error: 'Could not extract text from this DOCX file.' };
          }
          const truncated = text.length > 100000 ? text.slice(0, 100000) + '\n\n[... document truncated ...]' : text;
          return { type: 'document', text: truncated, filename };
        } catch (docxErr) {
          return { error: `DOCX extraction failed: ${docxErr.message}` };
        }
      } else if (textExts.includes(ext)) {
        // 1MB limit for text files
        if (stat.size > 1 * 1024 * 1024) {
          return { error: `File too large (${(stat.size / 1024 / 1024).toFixed(1)}MB). Max 1MB for text files.` };
        }
        const text = fs.readFileSync(filePath, 'utf-8');
        return { type: 'document', text, filename };
      } else {
        return { error: `Unsupported file type: ${ext}` };
      }
    } catch (err) {
      return { error: `Failed to read file: ${err.message}` };
    }
  });


  // Storage — Conversations
  ipcMain.handle('storage:createConversation', (event, data) => storage.createConversation(data));
  ipcMain.handle('storage:getConversations', (event, limit) => storage.getConversations(limit));
  ipcMain.handle('storage:getConversationsForProject', (event, projectId, limit) => storage.getConversationsForProject(projectId, limit));
  ipcMain.handle('storage:getConversation', (event, id) => storage.getConversation(id));
  ipcMain.handle('storage:updateConversationTitle', (event, id, title) => storage.updateConversationTitle(id, title));
  ipcMain.handle('storage:updateConversationCollection', (event, id, collectionId) => storage.updateConversationCollection(id, collectionId));
  ipcMain.handle('storage:updateConversationKBSelections', (event, id, selections) => storage.updateConversationKBSelections(id, selections));
  ipcMain.handle('storage:deleteConversation', (event, id) => storage.deleteConversation(id));

  // Storage — Messages
  ipcMain.handle('storage:addMessage', (event, data) => storage.addMessage(data));
  ipcMain.handle('storage:getMessages', (event, conversationId, limit) => storage.getMessages(conversationId, limit));

  // Storage — Knowledge Graph
  ipcMain.handle('storage:upsertEntity', (event, data) => storage.upsertEntity(data));
  ipcMain.handle('storage:getEntities', (event, entityType, limit) => storage.getEntities(entityType, limit));
  ipcMain.handle('storage:addRelationship', (event, data) => storage.addRelationship(data));
  ipcMain.handle('storage:getRelationships', (event, entityId) => storage.getRelationships(entityId));

  // Storage — Stats
  ipcMain.handle('storage:getStats', () => storage.getStats());
  ipcMain.handle('storage:getDbPath', () => storage.getDbPath());

  // Storage — Media
  ipcMain.handle('media:save', async (event, { id, type, prompt, model, filename, mediaType, base64Data }) => {
    const mediaDir = storage.getMediaDir();
    const filePath = path.join(mediaDir, filename);
    const buffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(filePath, buffer);
    return storage.saveMedia({ id, type, prompt, model, filename, mediaType, fileSize: buffer.length });
  });

  ipcMain.handle('media:saveVideo', async (event, { id, prompt, model, filename, uint8Array }) => {
    const mediaDir = storage.getMediaDir();
    const filePath = path.join(mediaDir, filename);
    const buffer = Buffer.from(uint8Array);
    fs.writeFileSync(filePath, buffer);
    return storage.saveMedia({ id, type: 'video', prompt, model, filename, mediaType: 'video/mp4', fileSize: buffer.length });
  });

  ipcMain.handle('media:list', (event, type, limit) => storage.listMedia(type, limit));
  ipcMain.handle('media:get', (event, id) => storage.getMedia(id));
  ipcMain.handle('media:delete', (event, id) => storage.deleteMedia(id));
  ipcMain.handle('media:getPath', (event, filename) => {
    return path.join(storage.getMediaDir(), filename);
  });
  ipcMain.handle('media:getStats', () => storage.getMediaStats());
  ipcMain.handle('media:getDir', () => storage.getMediaDir());

  // Knowledge Base
  ipcMain.handle('kb:createCollection', (event, data) => kbStorage.createCollection(data));
  ipcMain.handle('kb:getCollections', () => kbStorage.getCollections());
  ipcMain.handle('kb:getCollection', (event, id) => kbStorage.getCollection(id));
  ipcMain.handle('kb:updateCollection', (event, id, data) => kbStorage.updateCollection(id, data));
  ipcMain.handle('kb:deleteCollection', (event, id) => kbStorage.deleteCollection(id));

  ipcMain.handle('kb:addDocument', async (event, data) => {
    const result = kbStorage.addDocument(data);
    // Fire-and-forget: auto-embed new chunks
    autoEmbedCollection(data.collectionId).catch(err =>
      console.warn('[KB] Auto-embed after add failed:', err.message)
    );
    return result;
  });
  ipcMain.handle('kb:getDocuments', (event, collectionId) => kbStorage.getDocuments(collectionId));
  ipcMain.handle('kb:getDocument', (event, id) => kbStorage.getDocument(id));
  ipcMain.handle('kb:updateDocument', async (event, id, data) => {
    const result = kbStorage.updateDocument(id, data);
    if (result) {
      // Fire-and-forget: auto-embed any new/changed chunks
      const doc = kbStorage.getDocument(id);
      if (doc) {
        autoEmbedCollection(doc.collection_id).catch(err =>
          console.warn('[KB] Auto-embed after update failed:', err.message)
        );
      }
    }
    return result;
  });
  ipcMain.handle('kb:deleteDocument', (event, id) => kbStorage.deleteDocument(id));

  ipcMain.handle('kb:storeEmbeddings', (event, items) => {
    // Convert plain arrays back to Float32Array
    const converted = items.map(i => ({
      chunkId: i.chunkId,
      embedding: new Float32Array(i.embedding),
    }));
    return kbStorage.storeEmbeddings(converted);
  });
  ipcMain.handle('kb:getUnembeddedChunks', (event, collectionId, limit) => kbStorage.getUnembeddedChunks(collectionId, limit));
  ipcMain.handle('kb:searchSimilar', (event, { embedding, collectionId, topK }) => {
    const vec = new Float32Array(embedding);
    return kbStorage.searchSimilar(vec, collectionId, topK);
  });
  ipcMain.handle('kb:getStats', () => kbStorage.getKBStats());
  ipcMain.handle('kb:isVecLoaded', () => kbStorage.isVecLoaded());
  ipcMain.handle('kb:hasEmbedModel', () => {
    const modelsDir = engineManager.getModelsDir();
    const embedModelPath = path.join(modelsDir, EMBED_MODEL_FILENAME);
    return fs.existsSync(embedModelPath);
  });

  // Assistants
  ipcMain.handle('asst:create', (event, data) => assistantStorage.createAssistant(data));

  // Chat RAG — KB-augmented chat for the general chat page
  ipcMain.handle('chat:ragSend', async (event, { conversationId, userMessage, collectionId, kbSelections, chatHistory, fullContext }) => {
    try {
      // ── DIAGNOSTIC: Chat Submit State ──────────────────────────
      const activePlugins = pluginManager.getAll().filter(p => p.enabled).map(p => p.name);
      const cwPlugin = pluginManager.getAll().find(p => p.id === 'client-workspace');
      const cwInstance = cwPlugin?.hasInstance ? pluginManager.plugins?.get('client-workspace')?.instance : null;
      const activeProject = cwInstance?.getActiveProject?.() || null;
      console.log('═══════════════════════════════════════════════════════');
      console.log('[Chat:Submit] PATH: KB RAG');
      console.log('[Chat:Submit] Query:', userMessage?.slice(0, 80));
      console.log('[Chat:Submit] Active plugins:', activePlugins.join(', '));
      console.log('[Chat:Submit] KB selections:', JSON.stringify(kbSelections || [{ collectionId }]));
      console.log('[Chat:Submit] Active project:', activeProject ? `"${activeProject.name}" (${activeProject.id})` : 'NONE');
      console.log('[Chat:Submit] Chat history length:', (chatHistory || []).length);
      console.log('[Chat:Submit] Model:', store.get('provider.active')?.model || 'auto');
      const _dV = store.get('gateway.vendor') || 'openai';
      const _dM = store.get('gateway.model') || 'NONE';
      const _dT = store.get('provider.active')?.type || 'local';
      const _dKS = { openai: 'openai.apiKey', anthropic: 'anthropic.apiKey', google: 'gemini.apiKey', openrouter: 'openrouter.apiKey' };
      const _dHK = !!store.get(_dKS[_dV]);
      const _dWillCloud = _dM !== 'NONE' && _dHK && _dT !== 'local';
      console.log('[Chat:Submit] UI selected: vendor=' + _dV + ' model=' + _dM + ' type=' + _dT);
      console.log('[Chat:Submit] API key for ' + _dV + ':', _dHK ? 'YES' : '⚠️  MISSING');
      console.log('[Chat:Submit] Will use:', _dWillCloud ? _dV + '/' + _dM : 'LOCAL OLLAMA');
      if (!_dWillCloud && _dM !== 'NONE' && !_dHK) {
        console.log('⚠️⚠️⚠️  MODEL MISMATCH: Selected ' + _dV + '/' + _dM + ' but API key MISSING — will fall back to LOCAL OLLAMA!');
      }
      console.log('═══════════════════════════════════════════════════════');
      // ── END DIAGNOSTIC ─────────────────────────────────────────

      console.log('[ChatRAG] Starting KB chat, selections:', JSON.stringify(kbSelections || [{ collectionId }]), 'fullContext:', !!fullContext);
      const ollamaHost = store.get('local.ollamaHost') || OLLAMA_URL;
      const numCtx = store.get('local.contextWindow') || 4096;

      // RAG: retrieve relevant KB chunks from all selected sources
      let contextChunks = [];
      const selections = kbSelections && kbSelections.length > 0
        ? kbSelections
        : (collectionId ? [{ collectionId }] : []);

      if (fullContext && selections.length > 0) {
        // FULL CONTEXT MODE: Load all document content directly (skip vector search)
        console.log('[ChatRAG:FullContext] Loading all documents for', selections.length, 'source(s)');
        for (const sel of selections) {
          if (sel.collectionId) {
            const docs = kbStorage.getDocumentsWithContent(sel.collectionId);
            for (const doc of docs) {
              if (sel.documentId && doc.id !== sel.documentId) continue;
              contextChunks.push({ content: doc.content, docTitle: doc.title, distance: 0 });
            }
          }
        }
        console.log('[ChatRAG:FullContext] Loaded', contextChunks.length, 'documents, total chars:', contextChunks.reduce((sum, c) => sum + c.content.length, 0));
      } else if (selections.length > 0 && kbStorage.isVecLoaded()) {
        try {
          console.log('[ChatRAG] Embedding query for KB search...');
          const queryVec = await embedQueryForSearch(userMessage);
          if (queryVec) {
            console.log('[ChatRAG] Searching KB, vector dims:', queryVec.length, 'across', selections.length, 'source(s)');
            // Search across all selected collections/documents
            const results = kbStorage.searchMultiple(queryVec, selections, 8);
            contextChunks = results.map(r => ({ content: r.content, docTitle: r.doc_title, distance: r.distance }));

              // RECENCY WINDOW: Always include the 3 most recent chunks from the collection
              // so that recent comms are never missed regardless of semantic similarity
              try {
                const db = storage.getDb();
                for (const sel of selections) {
                  const collId = sel.collectionId || sel.documentId;
                  if (!collId || !db) continue;
                  const recent = db.prepare(
                    'SELECT c.content, d.title as doc_title FROM kb_chunks c JOIN kb_documents d ON c.document_id = d.id WHERE c.collection_id = ? ORDER BY c.rowid DESC LIMIT 3'
                  ).all(collId);
                  const existingKeys = new Set(contextChunks.map(c => c.content.slice(0, 80)));
                  for (const r of recent) {
                    if (!existingKeys.has(r.content.slice(0, 80))) {
                      contextChunks.unshift({ content: r.content, docTitle: r.doc_title + ' (recent)', distance: null });
                    }
                  }
                }
              } catch (recErr) {
                console.warn('[ChatRAG] Recency window failed:', recErr.message);
              }

              console.log('[ChatRAG] Found', contextChunks.length, 'relevant chunks');
              contextChunks.forEach((c, i) => {
                console.log(`[ChatRAG] Chunk ${i}: "${c.docTitle}" (distance: ${c.distance?.toFixed(4) || 'recent'}) — ${c.content.substring(0, 100)}...`);
              });
          }
        } catch (err) {
          console.warn('[ChatRAG] KB search failed:', err.message);
        }
      }

      // Build system prompt with KB context
      let systemContent = 'You are a knowledge base assistant. Your primary job is to answer questions based on the documents provided to you and any remembered conversation context.';
      if (contextChunks.length > 0) {
        const kbContext = contextChunks.map(c =>
          `[Source: ${c.docTitle}]\n${c.content}`
        ).join('\n\n---\n\n');

        if (fullContext) {
          // Full Context mode: stronger instruction to find and quote specific answers
          systemContent = `You are a document search assistant with access to the COMPLETE text of the user's documents below. The user is asking you to find specific information within these documents.

CRITICAL INSTRUCTIONS:
1. Search the ENTIRE document thoroughly for the answer. Do not skim.
2. When you find the relevant section, QUOTE the exact text from the document. Use quotation marks.
3. If the user asks "what did I say" or "what was my response", find THEIR words/messages and quote them directly.
4. If the user asks about what someone else said, find that person's exact words and quote them.
5. Always include the surrounding context so the answer makes sense.
6. If you cannot find the specific information after searching the full document, say "I searched the entire document but could not find [specific thing]."
7. NEVER paraphrase when the user is asking for specific quotes or responses. Give them the exact text.

FULL DOCUMENT CONTENT:

${kbContext}

END OF DOCUMENT`;
        } else {
          // RAG mode: use context-aware prompt from RAG prompt storage
          const isCommsKB = selections.some(s => (s.collectionId || '').startsWith('cw_project_'));
          const ragPromptContent = ragPromptStorage.getActivePromptContent({
            isCommsKB,
            isKBSelected: true,
            isProjectActive: !!store.get('client-workspace.activeProjectId'),
          });
          const ragInstruction = ragPromptContent || 'You are a helpful assistant. Answer questions using the documents below. If the answer is in the documents, use it and cite the source. If the documents don\'t contain the answer, say so.';
          systemContent = `${ragInstruction}

DOCUMENTS FROM KNOWLEDGE BASE:

${kbContext}

END OF DOCUMENTS`;
        }
        console.log('[ChatRAG] System prompt length:', systemContent.length, 'chars', fullContext ? '(FULL CONTEXT MODE)' : '(RAG MODE)');
      } else {
        console.log('[ChatRAG] WARNING: No context chunks found, responding without KB context');
      }

      // Build messages array with system prompt
      // IMPORTANT: Limit chat history to avoid overwhelming small models.
      // The system prompt with KB context must remain dominant.
      const historyLimit = store.get('chat.historyMessages') || 6;
      const recentHistory = (chatHistory || []).slice(-historyLimit);
      let messages = [
        { role: 'system', content: systemContent },
        ...recentHistory,
      ];

      // Run plugin preprocess hooks (Cortex Lite memory injection, Client Workspace context, etc.)
      try {
        const preprocessed = await pluginManager.runChatPreprocess({ messages, assistant: null });
        messages = preprocessed.messages || messages;
        console.log('[ChatRAG] After plugin preprocess: messages count =', messages.length, ', roles:', messages.map(m => m.role).join(', '));
      } catch (err) {
        console.warn('[ChatRAG] Plugin preprocess error:', err.message);
      }

      console.log('[ChatRAG] Sending', messages.length, 'messages to model (trimmed from', (chatHistory || []).length, '). Roles:', messages.map(m => m.role).join(', '));

      // Determine which provider to use — reuse the active provider logic
      const pm = store.get('provider.active');
      const providerType = pm?.type || 'local';

      // Check if a cloud provider (OpenAI, Anthropic, etc.) is configured
      const vendor = store.get('gateway.vendor') || 'openai';
      const PROVIDER_CONFIG = {
        openai: { url: 'https://api.openai.com/v1/chat/completions', keyStore: 'openai.apiKey', authHeader: 'Bearer' },
        anthropic: { url: 'https://api.anthropic.com/v1/messages', keyStore: 'anthropic.apiKey', isAnthropic: true },
        google: { url: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent', keyStore: 'gemini.apiKey', isGemini: true },
        openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions', keyStore: 'openrouter.apiKey', authHeader: 'Bearer' },
      };
      const cloudConfig = PROVIDER_CONFIG[vendor];
      const cloudApiKey = cloudConfig ? store.get(cloudConfig.keyStore) : null;
      const gatewayModel = store.get('gateway.model');

      // Use cloud provider if configured and has API key AND user selected cloud
      // CRITICAL: Respect the user's model selection. If type is 'local', use Ollama.
      if (gatewayModel && cloudApiKey && cloudConfig && providerType !== 'local') {
        console.log('[ChatRAG] Using cloud provider:', vendor, 'model:', gatewayModel);

        if (cloudConfig.isAnthropic) {
          // Anthropic
          const systemMsgs = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
          const nonSystemMsgs = messages.filter(m => m.role !== 'system');
          const res = await fetch(cloudConfig.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': cloudApiKey, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({ model: gatewayModel, max_tokens: 4096, system: systemMsgs, messages: nonSystemMsgs, stream: false }),
          });
          if (!res.ok) {
            const errText = await res.text().catch(() => '');
            console.error('[ChatRAG] Anthropic error:', res.status, errText.slice(0, 200));
            mainWindow?.webContents.send('chat:rag-done');
            return { success: false, error: `Anthropic error: ${res.status}` };
          }
          const data = await res.json();
          const fullResponse = data.content?.[0]?.text || '';
          mainWindow?.webContents.send('chat:rag-chunk', { content: fullResponse });
          mainWindow?.webContents.send('chat:rag-done');
          console.log('[ChatRAG] Response complete, length:', fullResponse.length, 'chars');
          try { await pluginManager.runChatPostprocess({ response: fullResponse, assistant: null }); } catch (err) { console.warn('[ChatRAG] Plugin postprocess error:', err.message); }
          return { success: true, contextUsed: contextChunks.length };

        } else if (cloudConfig.isGemini) {
          // Gemini
          const url = cloudConfig.url.replace('{model}', gatewayModel) + `?key=${cloudApiKey}`;
          const contents = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
          const systemInstruction = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
          const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents, systemInstruction: { parts: [{ text: systemInstruction }] } }) });
          if (!res.ok) { mainWindow?.webContents.send('chat:rag-done'); return { success: false, error: `Gemini error: ${res.status}` }; }
          const data = await res.json();
          const fullResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
          mainWindow?.webContents.send('chat:rag-chunk', { content: fullResponse });
          mainWindow?.webContents.send('chat:rag-done');
          console.log('[ChatRAG] Response complete, length:', fullResponse.length, 'chars');
          try { await pluginManager.runChatPostprocess({ response: fullResponse, assistant: null }); } catch (err) { console.warn('[ChatRAG] Plugin postprocess error:', err.message); }
          return { success: true, contextUsed: contextChunks.length };

        } else {
          // OpenAI-compatible (openai, openrouter) — streaming
          const headers = { 'Content-Type': 'application/json', 'Authorization': `${cloudConfig.authHeader} ${cloudApiKey}` };
          if (vendor === 'openrouter') { headers['HTTP-Referer'] = 'https://iimagine.ai'; headers['X-Title'] = 'IIMAGINE Desktop'; }
          const res = await fetch(cloudConfig.url, {
            method: 'POST',
            headers,
            body: JSON.stringify({ model: gatewayModel, messages, stream: true }),
          });
          if (!res.ok) {
            const errText = await res.text().catch(() => '');
            console.error('[ChatRAG] OpenAI error:', res.status, errText.slice(0, 200));
            mainWindow?.webContents.send('chat:rag-done');
            return { success: false, error: `${vendor} error: ${res.status}` };
          }
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let fullResponse = '';
          let buffer = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              const data = line.slice(6);
              if (data === '[DONE]') break;
              try {
                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content;
                if (content) { fullResponse += content; mainWindow?.webContents.send('chat:rag-chunk', { content }); }
              } catch {}
            }
          }
          mainWindow?.webContents.send('chat:rag-done');
          console.log('[ChatRAG] Response complete, length:', fullResponse.length, 'chars');
          try { await pluginManager.runChatPostprocess({ response: fullResponse, assistant: null }); } catch (err) { console.warn('[ChatRAG] Plugin postprocess error:', err.message); }
          return { success: true, contextUsed: contextChunks.length };
        }
      }

      // Fallback: Use local iimagine-engine (llama.cpp)
      if (providerType === 'local' || !cloudApiKey) {
        const engineStatus = await engineManager.getStatus();
        const modelFilename = pm?.model || store.get('local.selectedModel');

        if (!modelFilename) {
          mainWindow?.webContents.send('chat:rag-done');
          return { success: false, error: 'No local model selected. Download and select a model in Settings → Models.' };
        }

        // Resolve model path from filename
        const modelsDir = engineManager.getModelsDir();
        // Handle case where filename might not have .gguf extension
        let modelPath = path.join(modelsDir, modelFilename);
        if (!fs.existsSync(modelPath) && !modelFilename.endsWith('.gguf')) {
          modelPath = path.join(modelsDir, modelFilename + '.gguf');
        }

        if (!fs.existsSync(modelPath)) {
          mainWindow?.webContents.send('chat:rag-done');
          return { success: false, error: `Model file not found: ${modelFilename}. Download it from Settings → Models.` };
        }

        // Start engine if not running, or switch model if different
        if (!engineStatus.running || engineStatus.currentModel !== modelPath) {
          console.log('[ChatRAG] Starting iimagine-engine with:', modelFilename);

          // If engine is running with a different model, stop it first and wait for port release
          if (engineStatus.running && engineStatus.currentModel !== modelPath) {
            console.log('[ChatRAG] Stopping current engine to switch models...');
            await engineManager.stopEngine();
            // Brief delay to let the OS release the port
            await new Promise(r => setTimeout(r, 500));
          }

          const startResult = await engineManager.startEngine(modelPath);
          if (!startResult.success) {
            console.error('[ChatRAG] Engine start failed:', startResult.error);
            mainWindow?.webContents.send('chat:rag-done');
            return { success: false, error: `Failed to start AI engine: ${startResult.error}` };
          }
          console.log('[ChatRAG] Engine started successfully on port:', startResult.port || 8847);
        }

        console.log('[ChatRAG] Using local engine with model:', modelFilename);

        // Send chat via engine (OpenAI-compatible streaming)
        const chatResult = await engineManager.chat({ messages, stream: true, options: { num_ctx: numCtx } });
        if (!chatResult.success) {
          mainWindow?.webContents.send('chat:rag-done');
          return { success: false, error: chatResult.error };
        }

        const reader = chatResult.response.body.getReader();
        const decoder = new TextDecoder();
        let fullResponse = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          for (const line of chunk.split('\n').filter(l => l.startsWith('data: '))) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') break;
            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content || '';
              if (content) {
                const cleaned = content.replace(/<unused\d+>|<tool_response\|>|<\/tool_response>|\[multimodal\]/g, '');
                if (cleaned) {
                  fullResponse += cleaned;
                  mainWindow?.webContents.send('chat:rag-chunk', { content: cleaned });
                }
              }
            } catch {}
          }
        }

        mainWindow?.webContents.send('chat:rag-done');
        console.log('[ChatRAG] Response complete, length:', fullResponse.length, 'chars');

        // Run plugin postprocess hooks
        try {
          await pluginManager.runChatPostprocess({ response: fullResponse, assistant: null });
        } catch (err) {
          console.warn('[ChatRAG] Plugin postprocess error:', err.message);
        }

        return { success: true, contextUsed: contextChunks.length };
      }

      // For non-local providers, inject KB context into the regular provider stream
      // The chat page will fall back to the normal provider stream with augmented messages
      mainWindow?.webContents.send('chat:rag-done');
      return { success: true, contextUsed: contextChunks.length, augmentedMessages: messages };

    } catch (err) {
      console.error('[ChatRAG] Error:', err);
      mainWindow?.webContents.send('chat:rag-done');
      return { success: false, error: err.message };
    }
  });

  // Estimate token count for Full Context mode
  ipcMain.handle('chat:ragEstimateFullContext', async (event, selections) => {
    try {
      let totalChars = 0;
      let docCount = 0;
      const selArray = selections || [];
      for (const sel of selArray) {
        if (sel.collectionId) {
          const docs = kbStorage.getDocumentsWithContent(sel.collectionId);
          for (const doc of docs) {
            if (sel.documentId && doc.id !== sel.documentId) continue;
            totalChars += (doc.content || '').length;
            docCount++;
          }
        }
      }
      return { totalChars, docCount };
    } catch (err) {
      console.warn('[ChatRAG:Estimate] Error:', err.message);
      return { totalChars: 0, docCount: 0 };
    }
  });

  ipcMain.handle('asst:list', () => assistantStorage.getAssistants());
  ipcMain.handle('asst:get', (event, id) => assistantStorage.getAssistant(id));
  ipcMain.handle('asst:update', (event, id, data) => assistantStorage.updateAssistant(id, data));
  ipcMain.handle('asst:delete', (event, id) => assistantStorage.deleteAssistant(id));

  ipcMain.handle('asst:createConversation', (event, data) => assistantStorage.createConversation(data));
  ipcMain.handle('asst:getConversations', (event, assistantId) => assistantStorage.getConversations(assistantId));
  ipcMain.handle('asst:deleteConversation', (event, id) => assistantStorage.deleteConversation(id));
  ipcMain.handle('asst:addMessage', (event, data) => assistantStorage.addMessage(data));
  ipcMain.handle('asst:getMessages', (event, conversationId, limit) => assistantStorage.getMessages(conversationId, limit));

  // Assistant RAG chat — embed query, search KB, build context, stream response
  ipcMain.handle('asst:ragChat', async (event, { assistantId, conversationId, userMessage }) => {
    try {
      console.log('[RAG] Starting chat for assistant:', assistantId);
      const assistant = assistantStorage.getAssistant(assistantId);
      if (!assistant) return { success: false, error: 'Assistant not found' };

      const ollamaHost = store.get('local.ollamaHost') || OLLAMA_URL;
      const numCtx = store.get('local.contextWindow') || 4096;

      // Save user message
      assistantStorage.addMessage({ conversationId, role: 'user', content: userMessage });

      // RAG: retrieve relevant KB chunks if collection is linked
      let contextChunks = [];
      // Support new kb_selections JSON or legacy collection_id
      let selections = [];
      if (assistant.kb_selections) {
        try { selections = JSON.parse(assistant.kb_selections); } catch {}
      } else if (assistant.collection_id) {
        selections = [{ collectionId: assistant.collection_id }];
      }

      if (selections.length > 0 && kbStorage.isVecLoaded()) {
        try {
          console.log('[RAG] Embedding query for KB search...');
          const queryVec = await embedQueryForSearch(userMessage);
          if (queryVec) {
            console.log('[RAG] Searching KB, vector dims:', queryVec.length, 'across', selections.length, 'source(s)');
            const results = kbStorage.searchMultiple(queryVec, selections, 5);
            contextChunks = results.map(r => ({ content: r.content, docTitle: r.doc_title, distance: r.distance }));
            console.log('[RAG] Found', contextChunks.length, 'relevant chunks');
          }
        } catch (err) {
          console.warn('[RAG] KB search failed:', err.message);
        }
      }

      // Build system prompt with KB context
      let systemContent = assistant.system_prompt || 'You are a helpful assistant.';
      if (contextChunks.length > 0) {
        const kbContext = contextChunks.map((c, i) =>
          `[Source: ${c.docTitle}]\n${c.content}`
        ).join('\n\n---\n\n');
        systemContent += `\n\nUse the following knowledge base context to inform your response. If the context is relevant, use it. If not, respond based on your general knowledge.\n\n--- KNOWLEDGE BASE CONTEXT ---\n${kbContext}\n--- END CONTEXT ---`;
      }

      // Get conversation history (last 20 messages to keep context manageable)
      const history = assistantStorage.getMessages(conversationId, 20);
      const messages = [
        { role: 'system', content: systemContent },
        ...history.map(m => ({ role: m.role, content: m.content })),
      ];

      // Check Ollama
      console.log('[RAG] Checking Ollama...');
      const ollamaStatus = await checkOllama();
      if (!ollamaStatus.running || !ollamaStatus.models?.length) {
        console.log('[RAG] No Ollama models available');
        mainWindow?.webContents.send('asst:stream-done');
        return { success: false, error: 'No AI model available. Install a local model in Settings.' };
      }

      const EMBED_ONLY_MODELS = ['nomic-embed-text', 'all-minilm', 'mxbai-embed-large', 'snowflake-arctic-embed'];
      const chatModels = ollamaStatus.models.filter(m => !EMBED_ONLY_MODELS.some(e => m.name.startsWith(e)));
      if (!chatModels.length) {
        console.log('[RAG] No chat models available (only embedding models found)');
        mainWindow?.webContents.send('asst:stream-done');
        return { success: false, error: 'No chat model available. You only have embedding models installed. Pull a chat model like gemma2:2b from Settings.' };
      }

      const model = assistant.model_preference || chatModels[0].name;

      // Run plugin preprocess hooks
      const preprocessed = await pluginManager.runChatPreprocess({ messages, assistant });
      const finalMessages = preprocessed.messages || messages;

      console.log('[RAG] Sending to Ollama model:', model, 'messages:', finalMessages.length);

      const res = await fetch(`${ollamaHost}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: finalMessages, stream: true, options: { num_ctx: numCtx } }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => `HTTP ${res.status}`);
        console.error('[RAG] Ollama chat error:', errText);
        mainWindow?.webContents.send('asst:stream-done');
        return { success: false, error: `Ollama error: ${errText}` };
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullResponse = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.message?.content) {
              fullResponse += parsed.message.content;
              mainWindow?.webContents.send('asst:stream-chunk', { content: parsed.message.content });
            }
          } catch {}
        }
      }

      console.log('[RAG] Response complete, length:', fullResponse.length);

      // Run plugin postprocess hooks
      const postprocessed = await pluginManager.runChatPostprocess({ response: fullResponse, assistant });
      const finalResponse = postprocessed.response || fullResponse;

      // If plugins modified the response, send the final version to UI
      if (finalResponse !== fullResponse) {
        mainWindow?.webContents.send('asst:stream-chunk', { content: finalResponse.slice(fullResponse.length) });
      }

      mainWindow?.webContents.send('asst:stream-done');

      // Save assistant response
      assistantStorage.addMessage({
        conversationId, role: 'assistant', content: finalResponse,
        contextChunks: contextChunks.length > 0 ? contextChunks : null,
      });
      return { success: true, contextUsed: contextChunks.length };

    } catch (err) {
      console.error('[RAG] Unhandled error:', err);
      mainWindow?.webContents.send('asst:stream-done');
      return { success: false, error: err.message || 'Unknown error' };
    }
  });

  // Plugins
  ipcMain.handle('plugins:list', () => pluginManager.getAll());
  ipcMain.handle('plugins:setEnabled', (event, id, enabled) => pluginManager.setEnabled(id, enabled));
  ipcMain.handle('plugins:getSidebarItems', () => pluginManager.getSidebarItems());
  ipcMain.handle('plugins:renderPage', (event, pluginId) => {
    try {
      const renderer = pluginManager.getPageRenderer(pluginId);
      if (!renderer) return null;
      return renderer();
    } catch (err) {
      console.error(`[Plugin] renderPage error for ${pluginId}:`, err.message);
      pluginManager._logError(pluginId, `renderPage crash: ${err.message}`);
      return `<div class="p-6"><div class="bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-2xl p-5"><h3 class="text-sm font-medium text-rose-700 dark:text-rose-400 mb-2">Plugin Error</h3><p class="text-xs text-rose-600 dark:text-rose-500">${err.message}</p><p class="text-xs text-neutral-500 dark:text-neutral-400 mt-3">Try saying "fix the ${pluginId} plugin" in chat.</p></div></div>`;
    }
  });
  ipcMain.handle('plugins:event', (event, eventName, data) => {
    // Route plugin events to the appropriate plugin instance
    // Events are namespaced: 'legal:complete-setup' → plugin 'legal-companion'
    const prefix = eventName.split(':')[0];
    const pluginMap = { 'legal': 'legal-companion', 'cortex-lite': 'cortex-lite', 'cw': 'client-workspace' };
    let pluginId = pluginMap[prefix];

    // Also check AI-generated plugins (their events use plugin-id as prefix)
    if (!pluginId) {
      const matched = pluginManager.plugins.get(prefix);
      if (matched?.instance?.onEvent) pluginId = prefix;
    }

    if (pluginId) {
      const plugin = pluginManager.plugins.get(pluginId);
      if (plugin?.instance?.onEvent) {
        try {
          return plugin.instance.onEvent(eventName, data);
        } catch (err) {
          console.error(`[Plugin] Event handler error (${eventName}):`, err.message);
          pluginManager._logError(pluginId, `onEvent(${eventName}) crash: ${err.message}`);
          return { __pluginError: err.message };
        }
      }
    }
    return null;
  });
  ipcMain.handle('plugins:getDir', () => pluginManager.getPluginsDir());
  ipcMain.handle('plugins:openFolder', (event, pluginId) => {
    const dir = pluginManager.getPluginsDir();
    const pluginPath = require('path').join(dir, pluginId);
    require('electron').shell.openPath(pluginPath);
  });
  ipcMain.handle('plugins:uninstall', (event, id) => pluginManager.uninstall(id));

  // Plugin file operations — sandboxed to ~/.iimagine/plugin-data/<pluginId>/
  ipcMain.handle('plugins:fileSave', (event, { pluginId, filename, base64Data }) => {
    const dataDir = path.join(os.homedir(), '.iimagine', 'plugin-data', pluginId);
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const safeName = path.basename(filename);
    const filePath = path.join(dataDir, safeName);
    try {
      const buffer = Buffer.from(base64Data, 'base64');
      fs.writeFileSync(filePath, buffer);
      return { success: true, path: filePath, filename: safeName };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('plugins:fileList', (event, { pluginId }) => {
    const dataDir = path.join(os.homedir(), '.iimagine', 'plugin-data', pluginId);
    try {
      if (!fs.existsSync(dataDir)) return [];
      return fs.readdirSync(dataDir).map(f => {
        const stats = fs.statSync(path.join(dataDir, f));
        return { filename: f, size: stats.size, modified: stats.mtime };
      });
    } catch { return []; }
  });

  ipcMain.handle('plugins:fileRead', (event, { pluginId, filename }) => {
    const dataDir = path.join(os.homedir(), '.iimagine', 'plugin-data', pluginId);
    const safeName = path.basename(filename);
    const filePath = path.join(dataDir, safeName);
    try {
      if (!fs.existsSync(filePath)) return { success: false, error: 'Not found' };
      const buffer = fs.readFileSync(filePath);
      return { success: true, base64: buffer.toString('base64'), filename: safeName };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('plugins:fileDelete', (event, { pluginId, filename }) => {
    const dataDir = path.join(os.homedir(), '.iimagine', 'plugin-data', pluginId);
    const safeName = path.basename(filename);
    const filePath = path.join(dataDir, safeName);
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('plugins:fileGetPath', (event, { pluginId, filename }) => {
    const dataDir = path.join(os.homedir(), '.iimagine', 'plugin-data', pluginId);
    const safeName = path.basename(filename);
    return path.join(dataDir, safeName);
  });
  ipcMain.handle('plugins:checkLicense', async (event, pluginId) => {
    return await pluginManager.checkLicense(pluginId);
  });
  ipcMain.handle('plugins:getAllLicenses', () => {
    return pluginManager.getLicenseChecker().getAllCached();
  });

  // Plugin chat hooks
  ipcMain.handle('plugins:chatPreprocess', async (event, data) => {
    // ── DIAGNOSTIC: Standard Chat (no KB) ────────────────────────
    const activePlugins = pluginManager.getAll().filter(p => p.enabled).map(p => p.name);
    const cwPlugin = pluginManager.getAll().find(p => p.id === 'client-workspace');
    const cwInstance = cwPlugin?.hasInstance ? pluginManager.plugins?.get('client-workspace')?.instance : null;
    const activeProject = cwInstance?.getActiveProject?.() || null;
    const lastMsg = [...(data.messages || [])].reverse().find(m => m.role === 'user');
    console.log('═══════════════════════════════════════════════════════');
    console.log('[Chat:Submit] PATH: Standard (no KB)');
    console.log('[Chat:Submit] Query:', lastMsg?.content?.slice(0, 80) || '(empty)');
    console.log('[Chat:Submit] Active plugins:', activePlugins.join(', '));
    console.log('[Chat:Submit] Active project:', activeProject ? `"${activeProject.name}" (${activeProject.id})` : 'NONE');
    console.log('[Chat:Submit] Messages count:', (data.messages || []).length);
    console.log('[Chat:Submit] Mentions:', JSON.stringify(data.mentions || []));
    console.log('[Chat:Submit] Model:', store.get('provider.active')?.model || 'auto');
    console.log('═══════════════════════════════════════════════════════');
    // ── END DIAGNOSTIC ───────────────────────────────────────────
    return await pluginManager.runChatPreprocess(data);
  });
  ipcMain.handle('plugins:chatPostprocess', async (event, data) => {
    return await pluginManager.runChatPostprocess(data);
  });
  ipcMain.handle('plugins:getCommands', () => pluginManager.getCommands());
  ipcMain.handle('plugins:getMentions', () => pluginManager.getMentions());

  // Agent — non-streaming LLM calls for planning and task execution
  // Uses the same provider the user has active (respects their model selection)
  async function agentChat(messages) {
    const gatewayModel = store.get('gateway.model'); // e.g. "gpt-5-mini"
    const vendor = store.get('gateway.vendor') || 'openai'; // e.g. "anthropic"

    const PROVIDER_CONFIG = {
      openai: { url: 'https://api.openai.com/v1/chat/completions', keyStore: 'openai.apiKey', authHeader: 'Bearer' },
      anthropic: { url: 'https://api.anthropic.com/v1/messages', keyStore: 'anthropic.apiKey', isAnthropic: true },
      google: { url: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent', keyStore: 'gemini.apiKey', isGemini: true },
      openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions', keyStore: 'openrouter.apiKey', authHeader: 'Bearer' },
    };

    const config = PROVIDER_CONFIG[vendor];
    const apiKey = config ? store.get(config.keyStore) : null;

    if (gatewayModel && apiKey && config) {
      console.log('[Agent] Calling', vendor, 'directly with model:', gatewayModel);
      try {
        let res, content;

        if (config.isAnthropic) {
          // Extract system message from messages array
          const systemMsg = messages.find(m => m.role === 'system');
          const nonSystemMsgs = messages.filter(m => m.role !== 'system');
          const body = { model: gatewayModel, messages: nonSystemMsgs, max_tokens: 4096, temperature: 0.7 };
          if (systemMsg) body.system = systemMsg.content;

          res = await fetch(config.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(60000),
          });
          if (!res.ok) {
            const errBody = await res.text().catch(() => '');
            console.log('[Agent] Anthropic returned status:', res.status, errBody.substring(0, 200));
            if (res.status === 401) return '__ERROR__:Invalid Anthropic API key. Check Settings → Public Cloud.';
          } else {
            const data = await res.json();
            content = data.content?.[0]?.text || '';
          }
        } else if (config.isGemini) {
          const url = config.url.replace('{model}', gatewayModel) + `?key=${apiKey}`;
          // Convert messages to Gemini format
          const contents = messages.filter(m => m.role !== 'system').map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          }));
          // Prepend system as a user message if present
          const systemMsg = messages.find(m => m.role === 'system');
          if (systemMsg) contents.unshift({ role: 'user', parts: [{ text: systemMsg.content }] });

          res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents }),
            signal: AbortSignal.timeout(60000),
          });
          if (!res.ok) {
            const errBody = await res.text().catch(() => '');
            console.log('[Agent] Gemini returned status:', res.status, errBody.substring(0, 200));
            if (res.status === 400 || res.status === 403) return '__ERROR__:Invalid Gemini API key. Check Settings → Public Cloud.';
          } else {
            const data = await res.json();
            content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
          }
        } else {
          // OpenAI-compatible (openai, openrouter)
          const headers = { 'Content-Type': 'application/json', 'Authorization': `${config.authHeader} ${apiKey}` };
          if (vendor === 'openrouter') {
            headers['HTTP-Referer'] = 'https://iimagine.ai';
            headers['X-Title'] = 'IIMAGINE Desktop';
          }
          res = await fetch(config.url, {
            method: 'POST',
            headers,
            body: JSON.stringify({ model: gatewayModel, messages, max_completion_tokens: 4096, temperature: 0.7 }),
            signal: AbortSignal.timeout(120000),
          });
          if (!res.ok) {
            const errBody = await res.text().catch(() => '');
            console.log(`[Agent] ${vendor} returned status:`, res.status, errBody.substring(0, 200));
            if (res.status === 401) return `__ERROR__:Invalid ${vendor} API key. Check Settings → Public Cloud.`;
          } else {
            const data = await res.json();
            content = data.choices?.[0]?.message?.content || '';
          }
        }

        if (content) {
          console.log('[Agent] Response length:', content.length);
          return content;
        }
      } catch (err) {
        console.log('[Agent] Fetch failed:', err.message);
      }
    }

    // Fallback: use Ollama directly (local models)
    const ollamaHost = store.get('local.ollamaHost') || OLLAMA_URL;
    const activeModel = store.get('activeModel');
    let model = null;
    try {
      const tagsRes = await fetch(`${ollamaHost}/api/tags`);
      if (tagsRes.ok) {
        const tagsData = await tagsRes.json();
        const allModels = tagsData.models || [];
        const EMBED_ONLY = ['nomic-embed-text', 'all-minilm', 'mxbai-embed-large', 'snowflake-arctic-embed', 'bge-'];
        const chatModels = allModels.filter(m => !EMBED_ONLY.some(e => m.name.startsWith(e)));
        if (activeModel) {
          const match = chatModels.find(m => m.name === activeModel);
          if (match) model = match.name;
        }
        if (!model && chatModels.length > 0) model = chatModels[0].name;
      }
    } catch {
      console.log('[Agent] Ollama not reachable');
      return null;
    }

    if (!model) {
      console.log('[Agent] No model available');
      return null;
    }

    console.log('[Agent] Using Ollama model:', model);
    const numCtx = store.get('local.contextWindow') || 4096;
    try {
      const res = await fetch(`${ollamaHost}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, stream: false, options: { num_ctx: numCtx } }),
      });
      if (res.ok) {
        const data = await res.json();
        return data.message?.content || null;
      }
    } catch {}
    return null;
  }

  ipcMain.handle('agent:plan', async (event, messages) => {
    try {
      const content = await agentChat(messages);
      if (content?.startsWith('__ERROR__:')) {
        return { content: null, error: content.slice(10) };
      }
      if (content) return { content };
      return { content: null, error: 'No model available' };
    } catch (err) {
      console.error('[Agent:plan] Error:', err.message);
      return { content: null, error: err.message };
    }
  });

  ipcMain.handle('agent:execute', async (event, messages) => {
    try {
      const content = await agentChat(messages);
      if (content?.startsWith('__ERROR__:')) {
        return { content: null, error: content.slice(10) };
      }
      if (content) return { content };
      return { content: null, error: 'No model available' };
    } catch (err) {
      console.error('[Agent:execute] Error:', err.message);
      return { content: null, error: err.message };
    }
  });

  // ── Plugin Generator — AI-powered plugin creation ───────────────
  const pluginGenerator = require('./plugin-generator');
  pluginGenerator.setAgentChat(agentChat);
  pluginGenerator.setPluginManager(pluginManager);

  ipcMain.handle('pluginGen:generate', async (event, userRequest, existingPluginId) => {
    return await pluginGenerator.generate(userRequest, existingPluginId);
  });

  ipcMain.handle('pluginGen:detectIntent', (event, message) => {
    return pluginGenerator.detectIntent(message);
  });

  ipcMain.handle('pluginGen:delete', (event, pluginId) => {
    return pluginGenerator.delete(pluginId);
  });

  ipcMain.handle('pluginGen:listGenerated', () => {
    return pluginGenerator.listGenerated();
  });

  // Emit sidebar refresh to renderer after plugin changes
  ipcMain.handle('pluginGen:refreshSidebar', () => {
    if (mainWindow) {
      mainWindow.webContents.send('plugins:sidebarChanged');
    }
    return { success: true };
  });
  // ── End Plugin Generator ───────────────────────────────────────

  ipcMain.handle('plugins:install', async (event) => {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select plugin folder',
    });
    if (result.canceled || !result.filePaths.length) return { canceled: true };
    return pluginManager.install(result.filePaths[0]);
  });

  // File dialog for document upload
  ipcMain.handle('kb:openFileDialog', async () => {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Documents', extensions: ['pdf', 'docx', 'txt', 'csv', 'md'] },
      ],
    });
    if (result.canceled) return { canceled: true, files: [] };

    const files = [];
    for (const filePath of result.filePaths) {
      const ext = path.extname(filePath).toLowerCase();
      const filename = path.basename(filePath);
      const buffer = fs.readFileSync(filePath);

      if (ext === '.txt' || ext === '.md') {
        files.push({ filename, content: buffer.toString('utf-8'), type: ext.slice(1) });
      } else if (ext === '.csv') {
        try {
          const content = parseCsvToReadableText(buffer.toString('utf-8'));
          files.push({ filename, content, type: 'csv' });
        } catch (err) {
          console.error('[KB] CSV parse error:', err.message);
          files.push({ filename, content: buffer.toString('utf-8'), type: 'csv' });
        }
      } else if (ext === '.pdf') {
        try {
          const pdfParse = require('pdf-parse');
          const pdfData = await pdfParse(buffer);
          files.push({ filename, content: pdfData.text || '', type: 'pdf' });
        } catch (err) {
          console.error('[KB] PDF parse error:', err.message);
          files.push({ filename, content: '[PDF parsing failed — copy and paste the text instead]', type: 'pdf' });
        }
      } else if (ext === '.docx') {
        try {
          const mammoth = require('mammoth');
          const result = await mammoth.extractRawText({ buffer });
          files.push({ filename, content: result.value || '', type: 'docx' });
        } catch (err) {
          console.error('[KB] DOCX parse error:', err.message);
          files.push({ filename, content: '[DOCX parsing failed — copy and paste the text instead]', type: 'docx' });
        }
      }
    }
    return { canceled: false, files };
  });

  // Read files from drag-and-drop (receives file paths from renderer)
  ipcMain.handle('kb:readDroppedFiles', async (event, filePaths) => {
    if (!filePaths || !filePaths.length) return { files: [] };
    console.log('[KB] readDroppedFiles called with', filePaths.length, 'paths:', filePaths);

    const files = [];
    const SUPPORTED_EXTS = ['.txt', '.md', '.csv', '.pdf', '.docx'];

    for (const filePath of filePaths) {
      try {
        const ext = path.extname(filePath).toLowerCase();
        if (!SUPPORTED_EXTS.includes(ext)) {
          console.log('[KB] Skipping unsupported file:', filePath);
          continue;
        }

        const filename = path.basename(filePath);
        const buffer = fs.readFileSync(filePath);

        if (ext === '.txt' || ext === '.md') {
          files.push({ filename, content: buffer.toString('utf-8'), type: ext.slice(1) });
        } else if (ext === '.csv') {
          try {
            const content = parseCsvToReadableText(buffer.toString('utf-8'));
            files.push({ filename, content, type: 'csv' });
          } catch (err) {
            console.error('[KB] CSV parse error:', err.message);
            files.push({ filename, content: buffer.toString('utf-8'), type: 'csv' });
          }
        } else if (ext === '.pdf') {
          try {
            const pdfParse = require('pdf-parse');
            const pdfData = await pdfParse(buffer);
            files.push({ filename, content: pdfData.text || '', type: 'pdf' });
          } catch (err) {
            console.error('[KB] PDF parse error:', err.message);
            files.push({ filename, content: '[PDF parsing failed]', type: 'pdf' });
          }
        } else if (ext === '.docx') {
          try {
            const mammoth = require('mammoth');
            const result = await mammoth.extractRawText({ buffer });
            files.push({ filename, content: result.value || '', type: 'docx' });
          } catch (err) {
            console.error('[KB] DOCX parse error:', err.message);
            files.push({ filename, content: '[DOCX parsing failed]', type: 'docx' });
          }
        }
      } catch (err) {
        console.error('[KB] Error reading dropped file:', filePath, err.message);
      }
    }

    return { files };
  });

  // AI Gateway — video generation
  ipcMain.handle('gateway:generateVideo', async (event, { prompt, model, aspectRatio, duration }) => {
    const token = store.get('auth.token');
    const serverUrl = store.get('auth.serverUrl') || activeWebAppUrl;
    if (!token) return { success: false, error: 'Not authenticated' };

    try {
      const res = await fetch(`${serverUrl}/api/desktop/gateway-video`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ prompt, model, aspectRatio, duration }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        return { success: false, error: err.error || `Server error ${res.status}` };
      }

      // Video comes back as binary (mp4)
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('video') || contentType.includes('octet-stream')) {
        const arrayBuf = await res.arrayBuffer();
        const uint8 = new Uint8Array(arrayBuf);
        return { success: true, video: Array.from(uint8), mediaType: 'video/mp4', model };
      }

      // Fallback: JSON response with base64 or error
      const data = await res.json();
      if (data.video) {
        return { success: true, video: data.video, mediaType: data.mediaType || 'video/mp4', model: data.model || model };
      }
      return { success: false, error: data.error || 'No video in response' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── Folder Connect ──────────────────────────────────────────────
  ipcMain.handle('folder:add', async () => {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Connect a Folder',
    });
    if (result.canceled || !result.filePaths.length) return { canceled: true };
    const folderPath = result.filePaths[0];

    // Check if already connected
    const existing = folderConnect.getFolders().find(f => f.path === folderPath);
    if (existing) return { error: 'Folder already connected' };

    const folder = folderConnect.addFolder(folderPath);

    // Index in background, then auto-embed
    folderConnect.indexFolder(folder.id, (progress) => {
      mainWindow?.webContents.send('folder:index-progress', progress);
      if (progress.done) {
        mainWindow?.webContents.send('folder:index-done', { folderId: folder.id });
        // Trigger auto-embed for the new collection
        autoEmbedCollection(folder.id);
      }
    });

    // Start watching for changes
    folderConnect.startWatching(folder.id, (progress) => {
      mainWindow?.webContents.send('folder:index-progress', progress);
    });

    return folder;
  });

  ipcMain.handle('folder:list', () => folderConnect.getFolders());

  ipcMain.handle('folder:remove', (event, id) => {
    folderConnect.removeFolder(id);
    return { success: true };
  });

  ipcMain.handle('folder:reindex', async (event, id) => {
    const result = await folderConnect.indexFolder(id, (progress) => {
      mainWindow?.webContents.send('folder:index-progress', progress);
      if (progress.done) {
        mainWindow?.webContents.send('folder:index-done', { folderId: id });
        // Trigger auto-embed after re-indexing
        autoEmbedCollection(id);
      }
    });
    return result;
  });

  // ── Prompt Manager ──────────────────────────────────────────────
  ipcMain.handle('prompts:create', (event, data) => promptStorage.createPrompt(data));
  ipcMain.handle('prompts:list', () => promptStorage.getPrompts());
  ipcMain.handle('prompts:update', (event, id, data) => promptStorage.updatePrompt(id, data));
  ipcMain.handle('prompts:delete', (event, id) => promptStorage.deletePrompt(id));
  ipcMain.handle('prompts:search', (event, query) => promptStorage.searchPrompts(query));

  // ── RAG Prompts (context-aware system prompts) ─────────────────
  ipcMain.handle('rag-prompts:list', () => ragPromptStorage.getAll());
  ipcMain.handle('rag-prompts:list-by-category', (event, category) => ragPromptStorage.getByCategory(category));
  ipcMain.handle('rag-prompts:get', (event, id) => ragPromptStorage.getPrompt(id));
  ipcMain.handle('rag-prompts:create', (event, data) => ragPromptStorage.createPrompt(data));
  ipcMain.handle('rag-prompts:update', (event, id, data) => ragPromptStorage.updatePrompt(id, data));
  ipcMain.handle('rag-prompts:delete', (event, id) => ragPromptStorage.deletePrompt(id));
  ipcMain.handle('rag-prompts:get-active', (event, category) => ragPromptStorage.getActivePromptId(category));
  ipcMain.handle('rag-prompts:set-active', (event, category, promptId) => {
    ragPromptStorage.setActivePromptId(category, promptId);
    return true;
  });

  // ── Personas ────────────────────────────────────────────────────
  ipcMain.handle('persona:create', (event, data) => personaStorage.createPersona(data));
  ipcMain.handle('persona:list', () => personaStorage.getPersonas());
  ipcMain.handle('persona:getActive', () => personaStorage.getActivePersona());
  ipcMain.handle('persona:update', (event, id, data) => personaStorage.updatePersona(id, data));
  ipcMain.handle('persona:delete', (event, id) => personaStorage.deletePersona(id));
  ipcMain.handle('persona:activate', (event, id) => personaStorage.activatePersona(id));
  ipcMain.handle('persona:deactivate', () => personaStorage.deactivateAll());

  // ── Web Search ──────────────────────────────────────────────────
  ipcMain.handle('websearch:search', async (event, query) => {
    if (!query || !query.trim()) return [];

    const token = store.get('auth.token');
    const serverUrl = store.get('auth.serverUrl') || activeWebAppUrl;

    // Try backend API first
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${serverUrl}/api/desktop/web-search`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query: query.trim() }),
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) {
        const data = await res.json();
        return data.results || [];
      }
    } catch (err) {
      console.warn('[WebSearch] Backend unavailable:', err.message);
    }

    // Fallback: DuckDuckGo HTML scrape
    try {
      const encoded = encodeURIComponent(query.trim());
      const res = await fetch(`https://html.duckduckgo.com/html/?q=${encoded}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; IIMAGINE Desktop/1.0)' },
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) return [];
      const html = await res.text();
      return parseDuckDuckGoResults(html);
    } catch (err) {
      console.warn('[WebSearch] DuckDuckGo fallback failed:', err.message);
      return [];
    }
  });
}

// ── macOS protocol handler ──────────────────────────────────────
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleProtocolUrl(url);
});

// ── App Lifecycle ───────────────────────────────────────────────
app.whenReady().then(async () => {
  storage.init();
  kbStorage.init(storage.getDb());
  assistantStorage.init(storage.getDb());
  personaStorage.init(storage.getDb());
  folderConnect.init(storage.getDb(), kbStorage);
  promptStorage.init(storage.getDb());
  ragPromptStorage.init(storage.getDb(), store);

  // Initialize model registry manifest (non-blocking remote fetch)
  manifestManager.initialize().catch(err => {
    console.warn('[App] Manifest init warning:', err.message);
  });

  // Initialize GGUF download manager
  downloadManager.initialize().catch(err => {
    console.warn('[App] Download manager init warning:', err.message);
  });

  // Forward download progress events to renderer
  downloadManager.on('download-progress', (progress) => {
    mainWindow?.webContents.send('model:download-progress', progress);
  });
  downloadManager.on('state-changed', (state) => {
    mainWindow?.webContents.send('model:download-state-changed', state);
  });
  downloadManager.on('download-complete', (dl) => {
    mainWindow?.webContents.send('model:download-complete', dl);
  });
  downloadManager.on('download-failed', (dl) => {
    mainWindow?.webContents.send('model:download-failed', dl);
  });

  // Initialize plugin system
  // Define gatewayChat as a variable so it can reference agentChat (defined above)
  const pluginGatewayChat = async (messages) => {
    try {
      console.log('[Plugin:gatewayChat] Calling with', messages.length, 'messages, content type:', typeof messages[0]?.content === 'object' ? 'vision-array' : 'text');
      const gatewayModel = store.get('gateway.model');
      const vendor = store.get('gateway.vendor') || 'openai';
      const PROVIDER_CONFIG = {
        openai: { url: 'https://api.openai.com/v1/chat/completions', keyStore: 'openai.apiKey', authHeader: 'Bearer' },
        anthropic: { url: 'https://api.anthropic.com/v1/messages', keyStore: 'anthropic.apiKey', isAnthropic: true },
        openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions', keyStore: 'openrouter.apiKey', authHeader: 'Bearer' },
      };
      const config = PROVIDER_CONFIG[vendor];
      const apiKey = config ? store.get(config.keyStore) : null;
      if (!apiKey || !config) {
        console.log('[Plugin:gatewayChat] No API key configured for', vendor);
        return null;
      }

      const headers = { 'Content-Type': 'application/json', 'Authorization': `${config.authHeader} ${apiKey}` };
      const res = await fetch(config.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: gatewayModel, messages, max_completion_tokens: 4096, temperature: 0.7 }),
        signal: AbortSignal.timeout(120000),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.log('[Plugin:gatewayChat] API error:', res.status, errText.substring(0, 200));
        return null;
      }
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || '';
      console.log('[Plugin:gatewayChat] Success, response length:', content.length);
      return content;
    } catch (err) {
      console.error('[Plugin:gatewayChat] Exception:', err.message);
      return null;
    }
  };

  pluginManager.setContext({
    db: storage.getDb(),
    store,
    kbStorage,
    assistantStorage,
    getOllamaUrl: () => store.get('local.ollamaHost') || OLLAMA_URL,
    autoEmbedCollection: (collectionId) => autoEmbedCollection(collectionId),
    gatewayChat: pluginGatewayChat,
    // File helpers for plugins — sandboxed to ~/.iimagine/plugin-data/<pluginId>/
    files: {
      /**
       * Save a file to the plugin's sandboxed data directory.
       * @param {string} pluginId - the plugin's ID
       * @param {string} filename - target filename
       * @param {Buffer|string} data - file contents (Buffer for binary, string for text)
       * @returns {{ success: boolean, path?: string, error?: string }}
       */
      save(pluginId, filename, data) {
        const dataDir = path.join(os.homedir(), '.iimagine', 'plugin-data', pluginId);
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        const safeName = path.basename(filename); // prevent path traversal
        const filePath = path.join(dataDir, safeName);
        try {
          fs.writeFileSync(filePath, data);
          return { success: true, path: filePath };
        } catch (err) {
          return { success: false, error: err.message };
        }
      },
      /**
       * Read a file from the plugin's sandboxed data directory.
       * @param {string} pluginId - the plugin's ID
       * @param {string} filename - filename to read
       * @returns {{ success: boolean, data?: Buffer, error?: string }}
       */
      read(pluginId, filename) {
        const dataDir = path.join(os.homedir(), '.iimagine', 'plugin-data', pluginId);
        const safeName = path.basename(filename);
        const filePath = path.join(dataDir, safeName);
        try {
          if (!fs.existsSync(filePath)) return { success: false, error: 'File not found' };
          const data = fs.readFileSync(filePath);
          return { success: true, data };
        } catch (err) {
          return { success: false, error: err.message };
        }
      },
      /**
       * List files in the plugin's data directory.
       * @param {string} pluginId - the plugin's ID
       * @returns {string[]}
       */
      list(pluginId) {
        const dataDir = path.join(os.homedir(), '.iimagine', 'plugin-data', pluginId);
        try {
          if (!fs.existsSync(dataDir)) return [];
          return fs.readdirSync(dataDir);
        } catch { return []; }
      },
      /**
       * Delete a file from the plugin's data directory.
       * @param {string} pluginId - the plugin's ID
       * @param {string} filename - filename to delete
       */
      delete(pluginId, filename) {
        const dataDir = path.join(os.homedir(), '.iimagine', 'plugin-data', pluginId);
        const safeName = path.basename(filename);
        const filePath = path.join(dataDir, safeName);
        try {
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          return { success: true };
        } catch (err) {
          return { success: false, error: err.message };
        }
      },
      /**
       * Get the absolute path to the plugin's data directory.
       * @param {string} pluginId
       */
      getDir(pluginId) {
        const dataDir = path.join(os.homedir(), '.iimagine', 'plugin-data', pluginId);
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        return dataDir;
      },
    },
  });

  // Copy bundled sample plugins to user plugins dir if not present
  const samplePluginsDir = path.join(__dirname, 'plugins');
  const userPluginsDir = pluginManager.getPluginsDir();

  function copyDirFromAsar(src, dest) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        copyDirFromAsar(srcPath, destPath);
      } else {
        fs.writeFileSync(destPath, fs.readFileSync(srcPath));
      }
    }
  }

  if (fs.existsSync(samplePluginsDir)) {
    for (const folder of fs.readdirSync(samplePluginsDir, { withFileTypes: true })) {
      if (!folder.isDirectory()) continue;
      const src = path.join(samplePluginsDir, folder.name);
      const dest = path.join(userPluginsDir, folder.name);
      try {
        if (fs.existsSync(dest)) {
          fs.rmSync(dest, { recursive: true, force: true });
        }
        copyDirFromAsar(src, dest);
        console.log(`[Plugin] Synced bundled plugin: ${folder.name}`);
      } catch (err) {
        console.warn(`[Plugin] Failed to sync ${folder.name}:`, err.message);
      }
    }
  }

  pluginManager.loadAll();
  setupIPC();

  // Register download manager IPC handlers
  downloadManager.registerIPC(ipcMain);

  // Register TTS service IPC handlers
  ttsService.registerIPC(ipcMain);
  ttsService.initialize().catch(err => console.warn('[TTS] Init error:', err.message));

  // Initialize MCP client (background — don't block window creation)
  mcpClient.init().catch(err => console.error('[MCP] Init error:', err.message));

  // ── MCP IPC Handlers ──────────────────────────────────────────────
  ipcMain.handle('mcp:getServers', () => mcpClient.getServers());
  ipcMain.handle('mcp:connect', async (event, serverId) => {
    try {
      const result = await mcpClient.connect(serverId);
      return result;
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  ipcMain.handle('mcp:disconnect', async (event, serverId) => {
    await mcpClient.disconnect(serverId);
    return { success: true };
  });
  ipcMain.handle('mcp:getTools', () => mcpClient.getAllTools());
  ipcMain.handle('mcp:getToolsOpenAI', () => mcpClient.getToolsAsOpenAIFunctions());
  ipcMain.handle('mcp:callTool', async (event, serverId, toolName, args) => {
    return await mcpClient.callTool(serverId, toolName, args);
  });
  ipcMain.handle('mcp:parseToolName', (event, fullName) => mcpClient.parseToolCallName(fullName));
  ipcMain.handle('mcp:addServer', (event, id, config) => {
    mcpClient.addServer(id, config);
    return { success: true };
  });
  ipcMain.handle('mcp:removeServer', (event, id) => {
    mcpClient.removeServer(id);
    return { success: true };
  });
  ipcMain.handle('mcp:updateServer', (event, id, updates) => {
    try {
      mcpClient.updateServer(id, updates);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── Google OAuth IPC Handler ─────────────────────────────────────────
  ipcMain.handle('google:connect', async () => {
    const { runGoogleOAuth, getCredentials } = require('./google-oauth');
    const creds = getCredentials();
    if (!creds) return { success: false, error: 'Google OAuth credentials not available in this build.' };

    try {
      const tokens = await runGoogleOAuth();
      // Save refresh token to MCP config so the Google Workspace server uses it
      mcpClient.updateServer('google-workspace', {
        env: {
          GOOGLE_WORKSPACE_CLIENT_ID: creds.client_id,
          GOOGLE_WORKSPACE_CLIENT_SECRET: creds.client_secret,
          GOOGLE_WORKSPACE_REFRESH_TOKEN: tokens.refresh_token,
          GOOGLE_CLIENT_ID: creds.client_id,
          GOOGLE_CLIENT_SECRET: creds.client_secret,
        },
        enabled: true,
        autoConnect: true,
      });
      // Auto-connect after OAuth
      await mcpClient.connect('google-workspace');
      return { success: true, toolCount: mcpClient.getServers()['google-workspace']?.toolCount || 0 };
    } catch (err) {
      console.error('[GoogleOAuth] Failed:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('google:disconnect', async () => {
    try {
      await mcpClient.disconnect('google-workspace');
      mcpClient.updateServer('google-workspace', {
        env: {
          GOOGLE_WORKSPACE_CLIENT_ID: '',
          GOOGLE_WORKSPACE_CLIENT_SECRET: '',
          GOOGLE_WORKSPACE_REFRESH_TOKEN: '',
          GOOGLE_CLIENT_ID: '',
          GOOGLE_CLIENT_SECRET: '',
        },
        enabled: false,
        autoConnect: false,
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('google:status', () => {
    const server = mcpClient.getServers()['google-workspace'];
    return {
      connected: server?.status === 'connected',
      toolCount: server?.toolCount || 0,
      hasCredentials: !!require('./google-oauth').getCredentials(),
    };
  });

  createWindow();
  createTray();

  const user = await validateToken();
  if (user) mainWindow?.webContents.send('auth-success', user);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Ensure engine is stopped when app quits
app.on('will-quit', async (event) => {
  event.preventDefault();
  ttsService.shutdown();
  await mcpClient.shutdown();
  await engineManager.stopEngine();
  app.exit(0);
});

app.on('activate', () => {
  if (mainWindow) mainWindow.show();
  else createWindow();
});

app.on('before-quit', () => {
  isQuitting = true;
  storage.close();
});
