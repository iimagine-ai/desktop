// IIMAGINE Desktop Companion - Main Process
// Electron app with provider-based AI chat
// Iteration 1: Local AI via Ollama

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
async function checkOllama() {
  try {
    const ollamaHost = store.get('local.ollamaHost') || OLLAMA_URL;
    const res = await fetch(`${ollamaHost}/api/tags`);
    if (res.ok) {
      const data = await res.json();
      return { running: true, models: data.models || [] };
    }
    return { running: false, models: [] };
  } catch {
    return { running: false, models: [] };
  }
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
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAbwAAAG8B8aLcQwAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAADLSURBVDiNpZMxDoJAEEX/LBZewMbGxsLKA3gPj+BRPIIn8AYewMbGxoKCxAuwsXBNFnZZQPybyWTm/5nMZBZIkOQdwBnAFcCq7zMBcABwIrmStEnuSM5IziPJJckHyQ3JhGQ8lEByl2dNcgsgBbDoO0+y6CfJEsC2b0oyBnAiuQdQDCWQ3AB4BfACsOkKJJkCOAJ4A/DcF0jyBOCN5APminimum'
  );

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

async function autoEmbedCollection(collectionId) {
  if (autoEmbedRunning) return; // skip if already running
  if (!kbStorage.isVecLoaded()) return;

  const EMBED_MODEL = 'nomic-embed-text';
  const ollamaHost = store.get('local.ollamaHost') || OLLAMA_URL;

  // Check Ollama is running
  try {
    const res = await fetch(`${ollamaHost}/api/tags`);
    if (!res.ok) return;
  } catch {
    return; // Ollama not running — skip silently
  }

  // Check embedding model is available (don't auto-pull)
  try {
    const res = await fetch(`${ollamaHost}/api/tags`);
    if (!res.ok) return;
    const data = await res.json();
    const hasModel = (data.models || []).some(m =>
      m.name === EMBED_MODEL || m.name.startsWith(EMBED_MODEL + ':')
    );
    if (!hasModel) return; // model not installed — skip silently
  } catch {
    return;
  }

  // Get unembedded chunks
  const chunks = kbStorage.getUnembeddedChunks(collectionId, 5000);
  if (!chunks.length) return;

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
          const res = await fetch(`${ollamaHost}/api/embed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: EMBED_MODEL, input: chunk.content }),
          });
          if (res.ok) {
            const data = await res.json();
            const embedding = data.embeddings?.[0] || data.embedding || null;
            if (embedding) {
              kbStorage.storeEmbeddings([{
                chunkId: chunk.id,
                embedding: new Float32Array(embedding),
              }]);
              totalStored++;
            }
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
  }
}

// ── DuckDuckGo HTML Parser (fallback web search) ────────────────
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
          // OpenAI-compatible (openai, openrouter) — streaming
          const headers = { 'Content-Type': 'application/json', 'Authorization': `${config.authHeader} ${apiKey}` };
          if (vendor === 'openrouter') {
            headers['HTTP-Referer'] = 'https://iimagine.ai';
            headers['X-Title'] = 'IIMAGINE Desktop';
          }
          const res = await fetch(config.url, {
            method: 'POST',
            headers,
            body: JSON.stringify({ model: activeModel, messages, stream: true, max_completion_tokens: 4096, temperature: 0.7 }),
            signal: controller.signal,
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }));
            return { success: false, error: err.error?.message || `${vendor} error ${res.status}` };
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
                  const content = parsed.choices?.[0]?.delta?.content || '';
                  if (content) mainWindow?.webContents.send('gateway:stream-chunk', { content });
                } catch {}
              }
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
    try {
      const ollamaHost = store.get('local.ollamaHost') || OLLAMA_URL;
      const res = await fetch(`${ollamaHost}/api/tags`);
      if (!res.ok) return false;
      const data = await res.json();
      return (data.models || []).some(m => m.name === modelName || m.name.startsWith(modelName + ':'));
    } catch {
      return false;
    }
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
  ipcMain.handle('ollama:unload', async (event, modelName) => {
    try {
      const ollamaHost = store.get('local.ollamaHost') || OLLAMA_URL;
      const res = await fetch(`${ollamaHost}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelName, keep_alive: 0 }),
      });
      if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
      // Consume the response body to complete the request
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

  // Ollama — get model storage location
  ipcMain.handle('ollama:getModelLocation', async () => {
    const { homedir } = require('os');
    const home = homedir();
    // Ollama stores models in different locations per OS
    if (process.platform === 'darwin') {
      return path.join(home, '.ollama', 'models');
    } else if (process.platform === 'win32') {
      return path.join(home, '.ollama', 'models');
    } else {
      return path.join(home, '.ollama', 'models');
    }
  });

  // Ollama — open model storage location in file explorer
  ipcMain.handle('ollama:openModelLocation', async () => {
    const { homedir } = require('os');
    const modelsPath = path.join(homedir(), '.ollama', 'models');
    shell.openPath(modelsPath);
  });

  // Shell — generic open path (for notes folder, etc.)
  ipcMain.handle('shell:openPath', async (event, filePath) => {
    if (filePath) shell.openPath(filePath);
  });

  // Ollama — generate embeddings for text chunks (batch)
  ipcMain.handle('ollama:embedBatch', async (event, { model, texts }) => {
    const ollamaHost = store.get('local.ollamaHost') || OLLAMA_URL;
    const results = [];
    let processed = 0;

    for (const text of texts) {
      try {
        const res = await fetch(`${ollamaHost}/api/embed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, input: text }),
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => `HTTP ${res.status}`);
          results.push({ success: false, error: errText });
        } else {
          const data = await res.json();
          // Ollama returns { embeddings: [[...]] } for single input
          const embedding = data.embeddings?.[0] || data.embedding || null;
          results.push({ success: true, embedding });
        }
      } catch (err) {
        results.push({ success: false, error: err.message });
      }

      processed++;
      mainWindow?.webContents.send('kb:embed-progress', { processed, total: texts.length });
    }

    return results;
  });

  // Ollama — non-streaming chat
  ipcMain.handle('ollama:chat', async (event, { model, messages }) => {
    try {
      const ollamaHost = store.get('local.ollamaHost') || OLLAMA_URL;
      const numCtx = store.get('local.contextWindow') || 4096;
      const res = await fetch(`${ollamaHost}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, stream: false, options: { num_ctx: numCtx } }),
      });
      if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
      const data = await res.json();
      return { success: true, message: data.message };
    } catch (err) {
      return { success: false, error: err.message };
    }
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
    };
  });

  ipcMain.handle('ollama:setAdvancedSettings', (event, settings) => {
    if (settings.numGpu !== undefined) store.set('ollama.numGpu', settings.numGpu);
    if (settings.numThread !== undefined) store.set('ollama.numThread', settings.numThread);
    if (settings.keepAlive !== undefined) store.set('ollama.keepAlive', settings.keepAlive);
    if (settings.numCtx !== undefined) store.set('ollama.numCtx', settings.numCtx);
    return { success: true };
  });

  // Ollama — Runtime Monitoring (query running models via /api/ps)
  ipcMain.handle('ollama:getRunningModels', async () => {
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

      const ollamaHost = store.get('local.ollamaHost') || OLLAMA_URL;
      const controller = new AbortController();
      streamAbort.setActiveStreamController(controller);

      // Build options from advanced settings
      const options = toolCalling.buildOllamaOptions();
      const keepAlive = toolCalling.getKeepAlive();

      // Determine which tools to offer
      const webSearchEnabled = !!store.get('webSearch.enabled');
      const kbStats = kbStorage.getKBStats();
      const hasKBDocuments = kbStats.embeddingCount > 0;
      const tools = toolCalling.getActiveTools({ webSearchEnabled, hasKBDocuments });

      // Build request body
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

            // Check if model is making a tool call
            if (parsed.message?.tool_calls && parsed.message.tool_calls.length > 0) {
              toolCalls = parsed.message.tool_calls;
            } else {
              mainWindow?.webContents.send('ollama:stream-chunk', parsed);
              if (parsed.message?.content) fullResponse += parsed.message.content;
            }
          } catch {
            // skip malformed
          }
        }
      }

      // If model made tool calls, execute them and continue the conversation
      if (toolCalls.length > 0) {
        mainWindow?.webContents.send('ollama:stream-chunk', {
          message: { content: '\n\n🔍 *Searching...*\n\n' },
        });

        const context = { ollamaHost, kbStorage, store };
        const updatedMessages = [...messages, { role: 'assistant', content: fullResponse, tool_calls: toolCalls }];

        for (const tc of toolCalls) {
          const fnName = tc.function?.name;
          const fnArgs = tc.function?.arguments || {};
          const result = await toolCalling.executeTool(fnName, fnArgs, context);

          updatedMessages.push({
            role: 'tool',
            content: result,
          });
        }

        // Make a follow-up request with tool results (no tools this time to avoid loops)
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
              try {
                const parsed2 = JSON.parse(line2);
                mainWindow?.webContents.send('ollama:stream-chunk', parsed2);
              } catch {}
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
          const embedRes = await fetch(`${ollamaHost}/api/embed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'nomic-embed-text', input: userMessage }),
          });
          if (embedRes.ok) {
            const embedData = await embedRes.json();
            const queryVec = embedData.embeddings?.[0];
            if (queryVec) {
              console.log('[ChatRAG] Searching KB, vector dims:', queryVec.length, 'across', selections.length, 'source(s)');
              // Search across all selected collections/documents
              const results = kbStorage.searchMultiple(new Float32Array(queryVec), selections, 8);
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
      const recentHistory = (chatHistory || []).slice(-6); // Last 3 exchanges max
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

      // Fallback: Use local Ollama
      if (providerType === 'local' || !cloudApiKey) {
        // Use Ollama
        const ollamaStatus = await checkOllama();
        if (!ollamaStatus.running || !ollamaStatus.models?.length) {
          mainWindow?.webContents.send('chat:rag-done');
          return { success: false, error: 'No AI model available. Install a local model in Settings.' };
        }
        const EMBED_ONLY = ['nomic-embed-text', 'all-minilm', 'mxbai-embed-large', 'snowflake-arctic-embed'];
        const chatModels = ollamaStatus.models.filter(m => !EMBED_ONLY.some(e => m.name.startsWith(e)));
        if (!chatModels.length) {
          mainWindow?.webContents.send('chat:rag-done');
          return { success: false, error: 'No chat model available.' };
        }
        const model = pm?.model || chatModels[0].name;
        console.log('[ChatRAG] Using model:', model, 'with', messages.length, 'messages');

        const res = await fetch(`${ollamaHost}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages, stream: true, options: { num_ctx: numCtx } }),
        });
        if (!res.ok) {
          mainWindow?.webContents.send('chat:rag-done');
          return { success: false, error: `Ollama error: ${res.status}` };
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let fullResponse = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          for (const line of chunk.split('\n').filter(Boolean)) {
            try {
              const parsed = JSON.parse(line);
              if (parsed.message?.content) {
                fullResponse += parsed.message.content;
                mainWindow?.webContents.send('chat:rag-chunk', { content: parsed.message.content });
              }
            } catch {}
          }
        }
        mainWindow?.webContents.send('chat:rag-done');
        console.log('[ChatRAG] Response complete, length:', fullResponse.length, 'chars');

        // Run plugin postprocess hooks (Cortex Lite fact extraction, Client Workspace timeline, etc.)
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
          const embedRes = await fetch(`${ollamaHost}/api/embed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'nomic-embed-text', input: userMessage }),
          });
          if (embedRes.ok) {
            const embedData = await embedRes.json();
            const queryVec = embedData.embeddings?.[0];
            if (queryVec) {
              console.log('[RAG] Searching KB, vector dims:', queryVec.length, 'across', selections.length, 'source(s)');
              const results = kbStorage.searchMultiple(new Float32Array(queryVec), selections, 5);
              contextChunks = results.map(r => ({ content: r.content, docTitle: r.doc_title, distance: r.distance }));
              console.log('[RAG] Found', contextChunks.length, 'relevant chunks');
            }
          } else {
            console.warn('[RAG] Embed API returned:', embedRes.status);
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
    const renderer = pluginManager.getPageRenderer(pluginId);
    if (!renderer) return null;
    return renderer();
  });
  ipcMain.handle('plugins:event', (event, eventName, data) => {
    // Route plugin events to the appropriate plugin instance
    // Events are namespaced: 'legal:complete-setup' → plugin 'legal-companion'
    const prefix = eventName.split(':')[0];
    const pluginMap = { 'legal': 'legal-companion', 'cortex-lite': 'cortex-lite', 'cw': 'client-workspace' };
    const pluginId = pluginMap[prefix];
    if (pluginId) {
      const plugin = pluginManager.plugins.get(pluginId);
      if (plugin?.instance?.onEvent) {
        return plugin.instance.onEvent(eventName, data);
      }
    }
    return null;
  });
  ipcMain.handle('plugins:getDir', () => pluginManager.getPluginsDir());
  ipcMain.handle('plugins:uninstall', (event, id) => pluginManager.uninstall(id));

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
            signal: AbortSignal.timeout(60000),
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

  // Initialize plugin system
  pluginManager.setContext({
    db: storage.getDb(),
    store,
    kbStorage,
    assistantStorage,
    getOllamaUrl: () => store.get('local.ollamaHost') || OLLAMA_URL,
    autoEmbedCollection: (collectionId) => autoEmbedCollection(collectionId),
  });

  // Copy bundled sample plugins to user plugins dir if not present
  const samplePluginsDir = path.join(__dirname, 'plugins');
  const userPluginsDir = pluginManager.getPluginsDir();
  if (fs.existsSync(samplePluginsDir)) {
    for (const folder of fs.readdirSync(samplePluginsDir, { withFileTypes: true })) {
      if (!folder.isDirectory()) continue;
      const dest = path.join(userPluginsDir, folder.name);
      // Always sync bundled plugins (overwrite on every launch to ensure updates propagate)
      fs.cpSync(path.join(samplePluginsDir, folder.name), dest, { recursive: true });
      if (!fs.existsSync(dest)) {
        console.log(`[Plugin] Installed sample plugin: ${folder.name}`);
      }
    }
  }

  pluginManager.loadAll();
  setupIPC();
  createWindow();
  createTray();

  const user = await validateToken();
  if (user) mainWindow?.webContents.send('auth-success', user);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow) mainWindow.show();
  else createWindow();
});

app.on('before-quit', () => {
  isQuitting = true;
  storage.close();
});
