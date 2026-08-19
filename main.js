// IIMAGINE Desktop Companion - Main Process
// Electron app with provider-based AI chat
// Local AI via bundled iimagine-engine (llama.cpp) — shows as "iimagine-engine" in Activity Monitor

const { app, BrowserWindow, Tray, Menu, shell, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile, spawn } = require('child_process');
const Store = require('electron-store');
const storage = require('./storage');
const pluginManager = require('./plugin-manager');
const skillsManager = require('./skills-manager');
const streamAbort = require('./stream-abort');
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

// Auth mode: disabled — app works without sign-in (open source mode)
const AUTH_REQUIRED = false;

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
  // Protocol handler — reserved for future Cloud plugin OAuth flow
  try {
    const parsed = new URL(url);
    // Future: handle OAuth callbacks for Cloud plugin here
    console.log('[Protocol] Received URL:', parsed.pathname);
  } catch (err) {
    console.error('Failed to parse protocol URL:', err);
  }
}

async function validateToken() {
  // Auth disabled — always return guest user
  const guestUser = { email: 'Local User', isGuest: true };
  store.set('auth.user', guestUser);
  return guestUser;
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

// ── IPC Handlers ────────────────────────────────────────────────
function setupIPC() {
  // Auth — open source mode (no sign-in required)
  ipcMain.handle('auth:getUser', () => store.get('auth.user') || { email: 'Local User', isGuest: true });
  ipcMain.handle('auth:getToken', () => store.get('auth.token') || null);
  ipcMain.handle('auth:isRequired', () => AUTH_REQUIRED);
  ipcMain.handle('auth:validate', async () => await validateToken());

  // Legacy auth handlers — no-op stubs for renderer compatibility
  ipcMain.handle('auth:login', () => {});
  ipcMain.handle('auth:exchangeCode', () => ({ error: 'Auth disabled in open source mode' }));
  ipcMain.handle('auth:logout', () => {
    store.delete('auth.token');
    store.delete('auth.tokenId');
    store.delete('auth.user');
    return true;
  });

  // AI Gateway — streaming chat via server proxy OR direct provider call
  ipcMain.handle('gateway:chat', async (event, { messages, model }) => {

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
          
          
          const tools = toolCalling.getActiveTools({ webSearchEnabled, hasKBDocuments: false });

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
            const context = { store };
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
    const serverUrl = store.get('auth.serverUrl') || 'https://app.iimagine.ai';
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

  // Shell — pick folder via native dialog
  ipcMain.handle('shell:pickFolder', async (event, title) => {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: title || 'Select folder',
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
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

  // ── IIMAGINE Engine (llama.cpp) ─────────────────────────────────
  // These handlers use the bundled iimagine-engine binary.
  // Shows as "iimagine-engine" in Activity Monitor.

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

  // Engine — streaming chat (OpenAI-compatible)
  ipcMain.handle('engine:chatStream', async (event, { messages }) => {
    const toolCalling = require('./tool-calling');
    const controller = new AbortController();
    streamAbort.setActiveStreamController(controller);

    try {
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

      const numCtx = store.get('local.contextWindow', '4096');
      const toolsEnabled = store.get('local.toolsEnabled', false);
      const webSearchEnabled = !!store.get('webSearch.enabled') || !!store.get('local.webSearchEnabled');
      
      
      const tools = toolsEnabled ? toolCalling.getActiveTools({ webSearchEnabled, hasKBDocuments: false }) : [];

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
                mainWindow?.webContents.send('localAI:stream-chunk', {
                  message: { content: cleaned },
                });
              }
            }
          } catch {}
        }
      }

      // If tool calls were detected, execute them and do a follow-up
      if (toolCallChunks.length > 0) {
        mainWindow?.webContents.send('localAI:stream-chunk', { message: { content: '\n\n🔍 *Searching...*\n\n' } });

        const context = { store };
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
                    mainWindow?.webContents.send('localAI:stream-chunk', { message: { content: fCleaned } });
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

      mainWindow?.webContents.send('localAI:stream-done');
      return { success: true };
    } catch (err) {
      if (err.name === 'AbortError') {
        mainWindow?.webContents.send('localAI:stream-done');
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

  // ── Local AI — unified interface (engine-first) ──
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

  // Local AI — streaming chat (legacy IPC name kept for renderer compat)
  ipcMain.handle('localAI:chatStream', async (event, { model, messages }) => {
    const toolCalling = require('./tool-calling');
    try {
      // Ensure engine is running (auto-starts if needed)
      const ensureResult = await localAI.ensureRunning();

      // Try iimagine-engine first (primary path)
      const engineStatus = await engineManager.getStatus();
      if (engineStatus.running) {
        const controller = new AbortController();
        streamAbort.setActiveStreamController(controller);

        const numCtx = store.get('local.contextWindow', '4096');
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

        // Stream the response (OpenAI SSE format)
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
                  mainWindow?.webContents.send('localAI:stream-chunk', {
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

        mainWindow?.webContents.send('localAI:stream-done');
        streamAbort.clearActiveStreamController();
        return { success: true };
      }

      // Engine not running — cannot stream
      return { success: false, error: 'No local AI engine running. Download and select a model in Settings.' };
    } catch (err) {
      if (err.name === 'AbortError') {
        mainWindow?.webContents.send('localAI:stream-done');
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



  // ── Plugin Generator — AI-powered plugin creation ───────────────
  const pluginGenerator = require('./plugin-generator');
  // agentChat: non-streaming chat function for plugin generator
  // Uses the engine if available, falls back to gateway
  const agentChat = async (messages) => {
    try {
      const engineStatus = await engineManager.getStatus();
      if (engineStatus.running) {
        const result = await engineManager.chat({ messages, stream: false });
        if (result.success) return result.content || result.message?.content || null;
      }
      // Fallback to gateway (defined below in pluginGatewayChat pattern)
      const vendor = store.get('gateway.vendor') || 'openai';
      const PROVIDER_CONFIG = {
        openai: { url: 'https://api.openai.com/v1/chat/completions', keyStore: 'openai.apiKey', authHeader: 'Bearer' },
        anthropic: { url: 'https://api.anthropic.com/v1/messages', keyStore: 'anthropic.apiKey', isAnthropic: true },
        openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions', keyStore: 'openrouter.apiKey', authHeader: 'Bearer' },
      };
      const config = PROVIDER_CONFIG[vendor];
      const apiKey = config ? store.get(config.keyStore) : null;
      if (!apiKey || !config) return null;
      const res = await fetch(config.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `${config.authHeader} ${apiKey}` },
        body: JSON.stringify({ model: store.get('gateway.model') || 'gpt-4o-mini', messages, stream: false }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.choices?.[0]?.message?.content || null;
    } catch { return null; }
  };
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

  // ── Plugins ─────────────────────────────────────────────────────
  ipcMain.handle('plugins:list', () => pluginManager.getAll());
  ipcMain.handle('plugins:setEnabled', (event, id, enabled) => pluginManager.setEnabled(id, enabled));
  ipcMain.handle('plugins:getSidebarItems', () => pluginManager.getSidebarItems());
  ipcMain.handle('plugins:renderPage', (event, pluginId) => {
    const renderer = pluginManager.getPageRenderer(pluginId);
    if (!renderer) return null;
    // renderPage returns HTML string (or object with html property)
    try { return renderer(); } catch { return null; }
  });
  ipcMain.handle('plugins:renderSettings', (event, pluginId) => {
    const plugin = pluginManager.plugins.get(pluginId);
    if (!plugin?.instance?.renderSettings) return null;
    try {
      // Support both patterns:
      // 1. renderSettings(container) — sets container.innerHTML (legacy)
      // 2. renderSettings() — returns HTML string directly (preferred)
      const mock = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
      const result = plugin.instance.renderSettings(mock);
      // If the function returned a string, use that; otherwise use mock.innerHTML
      if (typeof result === 'string' && result.trim()) return result;
      return mock.innerHTML || null;
    } catch { return null; }
  });
  ipcMain.handle('plugins:event', async (event, eventName, data) => {
    // Plugin events — route to plugins that listen for this event
    for (const [id, p] of pluginManager.plugins) {
      if (p.enabled && p.instance?.onEvent) {
        try {
          const result = await p.instance.onEvent(eventName, data);
          if (result !== undefined && result !== null) return result;
        } catch (err) {
          console.warn(`[Plugin] ${id} onEvent error:`, err.message);
        }
      }
    }
    return null;
  });
  ipcMain.handle('plugins:getDir', () => pluginManager.getPluginsDir());
  ipcMain.handle('plugins:openFolder', (event, pluginId) => {
    const pluginPath = path.join(pluginManager.getPluginsDir(), pluginId);
    if (fs.existsSync(pluginPath)) shell.openPath(pluginPath);
  });
  ipcMain.handle('plugins:uninstall', (event, id) => pluginManager.uninstall(id));
  ipcMain.handle('plugins:chatPreprocess', (event, data) => pluginManager.runChatPreprocess(data));
  ipcMain.handle('plugins:chatPostprocess', (event, data) => pluginManager.runChatPostprocess(data));
  ipcMain.handle('plugins:modelRegister', () => pluginManager.runModelRegister());
  ipcMain.handle('plugins:providerRegister', async () => {
    const providers = await pluginManager.runProviderRegister();
    pluginManager.setProviders(providers);
    return [...providers.keys()]; // Return plugin IDs that registered providers
  });
  ipcMain.handle('plugins:providerChat', async (event, { pluginId, messages, model }) => {
    const provider = pluginManager.getProvider(pluginId);
    if (!provider) return { success: false, error: `No provider registered for plugin: ${pluginId}` };
    try {
      const result = await provider.chat(messages, model);
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  ipcMain.handle('plugins:getCommands', () => pluginManager.getCommands());
  ipcMain.handle('plugins:getMentions', () => pluginManager.getMentions());
  ipcMain.handle('plugins:checkLicense', (event, pluginId) => pluginManager.checkLicense(pluginId));
  ipcMain.handle('plugins:getAllLicenses', () => pluginManager.getLicenseChecker().getAllLicenses());
  // Plugin file operations (sandboxed per plugin)
  ipcMain.handle('plugins:fileSave', async (event, { pluginId, filename, base64Data }) => {
    const dir = path.join(app.getPath('home'), '.iimagine', 'plugin-data', pluginId);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, filename);
    fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
    return { success: true, path: filePath };
  });
  ipcMain.handle('plugins:fileList', async (event, { pluginId }) => {
    const dir = path.join(app.getPath('home'), '.iimagine', 'plugin-data', pluginId);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).map(f => ({ name: f, size: fs.statSync(path.join(dir, f)).size }));
  });
  ipcMain.handle('plugins:fileRead', async (event, { pluginId, filename }) => {
    const filePath = path.join(app.getPath('home'), '.iimagine', 'plugin-data', pluginId, filename);
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath).toString('base64');
  });
  ipcMain.handle('plugins:fileDelete', async (event, { pluginId, filename }) => {
    const filePath = path.join(app.getPath('home'), '.iimagine', 'plugin-data', pluginId, filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return { success: true };
  });
  ipcMain.handle('plugins:fileGetPath', async (event, { pluginId, filename }) => {
    return path.join(app.getPath('home'), '.iimagine', 'plugin-data', pluginId, filename);
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


}

// ── macOS protocol handler ──────────────────────────────────────
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleProtocolUrl(url);
});

// ── App Lifecycle ───────────────────────────────────────────────
app.whenReady().then(async () => {
  storage.init();

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
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('model:download-progress', progress);
  });
  downloadManager.on('state-changed', (state) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('model:download-state-changed', state);
  });
  downloadManager.on('download-complete', (dl) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('model:download-complete', dl);
  });
  downloadManager.on('download-failed', (dl) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('model:download-failed', dl);
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
    mcp: mcpClient,
    getEnginePort: () => engineManager.getPort(),
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
      // Skip iimagine-cloud until web app endpoints are deployed
      if (folder.name === 'iimagine-cloud') continue;
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
  skillsManager.loadAll();
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
  // Give child processes time to terminate cleanly
  setTimeout(() => app.exit(0), 600);
});

app.on('activate', () => {
  if (mainWindow) mainWindow.show();
  else createWindow();
});

app.on('before-quit', () => {
  isQuitting = true;
  storage.close();
});
