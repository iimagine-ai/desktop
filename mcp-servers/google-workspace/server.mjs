#!/usr/bin/env node
/**
 * IIMAGINE Google Workspace MCP Server (self-hosted, no third-party dependencies)
 * Provides Gmail, Calendar, Drive, Docs, and Sheets tools via Google REST APIs.
 * Runs as stdio MCP server — spawned by the desktop app's MCP client.
 * 
 * Environment variables:
 *   GOOGLE_WORKSPACE_CLIENT_ID
 *   GOOGLE_WORKSPACE_CLIENT_SECRET
 *   GOOGLE_WORKSPACE_REFRESH_TOKEN
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// ─── Auth ────────────────────────────────────────────────────────────────────

const CLIENT_ID = process.env.GOOGLE_WORKSPACE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_WORKSPACE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_WORKSPACE_REFRESH_TOKEN;

let accessToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpiry - 60000) return accessToken;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`Token refresh failed: ${data.error_description || data.error}`);
  accessToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in * 1000);
  return accessToken;
}

async function gapi(url, opts = {}) {
  const token = await getAccessToken();
  const res = await fetch(url, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...opts.headers },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google API ${res.status}: ${err.slice(0, 500)}`);
  }
  return res.json();
}

// ─── Tool Implementations ────────────────────────────────────────────────────

async function gmailSearch({ query, max_results = 10 }) {
  const data = await gapi(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${max_results}`);
  if (!data.messages?.length) return 'No emails found.';
  const results = [];
  for (const msg of data.messages.slice(0, max_results)) {
    const detail = await gapi(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`);
    const headers = detail.payload?.headers || [];
    const subject = headers.find(h => h.name === 'Subject')?.value || '(no subject)';
    const from = headers.find(h => h.name === 'From')?.value || '';
    const date = headers.find(h => h.name === 'Date')?.value || '';
    results.push(`• ${subject}\n  From: ${from}\n  Date: ${date}\n  ID: ${msg.id}`);
  }
  return results.join('\n\n');
}

async function gmailRead({ message_id }) {
  const detail = await gapi(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${message_id}?format=full`);
  const headers = detail.payload?.headers || [];
  const subject = headers.find(h => h.name === 'Subject')?.value || '';
  const from = headers.find(h => h.name === 'From')?.value || '';
  const date = headers.find(h => h.name === 'Date')?.value || '';
  // Extract body
  let body = '';
  const parts = detail.payload?.parts || [detail.payload];
  for (const part of parts) {
    if (part?.mimeType === 'text/plain' && part?.body?.data) {
      body = Buffer.from(part.body.data, 'base64url').toString('utf8');
      break;
    }
  }
  if (!body && detail.payload?.body?.data) {
    body = Buffer.from(detail.payload.body.data, 'base64url').toString('utf8');
  }
  return `Subject: ${subject}\nFrom: ${from}\nDate: ${date}\n\n${body.slice(0, 3000)}`;
}

async function gmailSend({ to, subject, body }) {
  const raw = Buffer.from(
    `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`
  ).toString('base64url');
  const result = await gapi('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    body: JSON.stringify({ raw }),
  });
  return `Email sent. Message ID: ${result.id}`;
}

async function calendarList({ time_min, time_max, max_results = 10 }) {
  const now = new Date().toISOString();
  const params = new URLSearchParams({
    timeMin: time_min || now,
    timeMax: time_max || new Date(Date.now() + 7 * 86400000).toISOString(),
    maxResults: String(max_results),
    singleEvents: 'true',
    orderBy: 'startTime',
  });
  const data = await gapi(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`);
  if (!data.items?.length) return 'No events found.';
  return data.items.map(e => {
    const start = e.start?.dateTime || e.start?.date || '';
    const end = e.end?.dateTime || e.end?.date || '';
    return `• ${e.summary || '(no title)'}\n  Start: ${start}\n  End: ${end}\n  ID: ${e.id}`;
  }).join('\n\n');
}

async function calendarCreate({ summary, start, end, description, location }) {
  const event = {
    summary,
    description: description || '',
    location: location || '',
    start: { dateTime: start, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    end: { dateTime: end, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
  };
  const result = await gapi('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    body: JSON.stringify(event),
  });
  return `Event created: "${result.summary}" (${result.start?.dateTime})\nID: ${result.id}`;
}

async function driveSearch({ query, max_results = 10 }) {
  const params = new URLSearchParams({
    q: query,
    pageSize: String(max_results),
    fields: 'files(id,name,mimeType,modifiedTime,webViewLink)',
  });
  const data = await gapi(`https://www.googleapis.com/drive/v3/files?${params}`);
  if (!data.files?.length) return 'No files found.';
  return data.files.map(f => `• ${f.name}\n  Type: ${f.mimeType}\n  Modified: ${f.modifiedTime}\n  Link: ${f.webViewLink}\n  ID: ${f.id}`).join('\n\n');
}

async function driveList({ folder_id, max_results = 20 }) {
  const q = folder_id ? `'${folder_id}' in parents and trashed=false` : 'trashed=false';
  const params = new URLSearchParams({
    q,
    pageSize: String(max_results),
    fields: 'files(id,name,mimeType,modifiedTime)',
    orderBy: 'modifiedTime desc',
  });
  const data = await gapi(`https://www.googleapis.com/drive/v3/files?${params}`);
  if (!data.files?.length) return 'No files found.';
  return data.files.map(f => `• ${f.name} (${f.mimeType}) — ${f.modifiedTime}\n  ID: ${f.id}`).join('\n');
}

async function docsRead({ document_id }) {
  const doc = await gapi(`https://docs.googleapis.com/v1/documents/${document_id}`);
  // Extract plain text from document body
  let text = '';
  for (const el of doc.body?.content || []) {
    if (el.paragraph) {
      for (const elem of el.paragraph.elements || []) {
        if (elem.textRun?.content) text += elem.textRun.content;
      }
    }
  }
  return `Title: ${doc.title}\n\n${text.slice(0, 5000)}`;
}

async function sheetsRead({ spreadsheet_id, range }) {
  const r = encodeURIComponent(range || 'Sheet1');
  const data = await gapi(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheet_id}/values/${r}`);
  if (!data.values?.length) return 'No data found.';
  return data.values.map(row => row.join('\t')).join('\n');
}

async function sheetsWrite({ spreadsheet_id, range, values }) {
  const r = encodeURIComponent(range);
  const result = await gapi(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheet_id}/values/${r}?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    body: JSON.stringify({ values }),
  });
  return `Updated ${result.updatedCells} cells in range ${result.updatedRange}`;
}

async function sheetsAddTab({ spreadsheet_id, title }) {
  const result = await gapi(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheet_id}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      requests: [{ addSheet: { properties: { title } } }],
    }),
  });
  const newSheet = result.replies?.[0]?.addSheet?.properties;
  return `Created new tab "${newSheet?.title}" (sheetId: ${newSheet?.sheetId}) in spreadsheet ${spreadsheet_id}`;
}

// ─── Tool Definitions ────────────────────────────────────────────────────────

const TOOLS = [
  { name: 'gmail_search', description: 'Search Gmail messages', inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Gmail search query (e.g. "from:boss newer_than:1d")' }, max_results: { type: 'number', description: 'Max results (default 10)' } }, required: ['query'] } },
  { name: 'gmail_read', description: 'Read a specific email by message ID', inputSchema: { type: 'object', properties: { message_id: { type: 'string', description: 'Gmail message ID' } }, required: ['message_id'] } },
  { name: 'gmail_send', description: 'Send an email', inputSchema: { type: 'object', properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } }, required: ['to', 'subject', 'body'] } },
  { name: 'calendar_list_events', description: 'List upcoming calendar events', inputSchema: { type: 'object', properties: { time_min: { type: 'string', description: 'ISO start time' }, time_max: { type: 'string', description: 'ISO end time' }, max_results: { type: 'number' } } } },
  { name: 'calendar_create_event', description: 'Create a calendar event', inputSchema: { type: 'object', properties: { summary: { type: 'string' }, start: { type: 'string', description: 'ISO datetime' }, end: { type: 'string', description: 'ISO datetime' }, description: { type: 'string' }, location: { type: 'string' } }, required: ['summary', 'start', 'end'] } },
  { name: 'drive_search', description: 'Search Google Drive files. Query uses Google Drive API syntax: name contains \'keyword\' and mimeType = \'application/vnd.google-apps.spreadsheet\'. Use AND between clauses. For spreadsheets use mimeType=application/vnd.google-apps.spreadsheet, for docs use application/vnd.google-apps.document.', inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Drive search query using Google Drive API syntax, e.g. "name contains \'BVM\' and mimeType = \'application/vnd.google-apps.spreadsheet\'"' }, max_results: { type: 'number' } }, required: ['query'] } },
  { name: 'drive_list_files', description: 'List recent files in Drive', inputSchema: { type: 'object', properties: { folder_id: { type: 'string', description: 'Optional folder ID' }, max_results: { type: 'number' } } } },
  { name: 'docs_read', description: 'Read a Google Doc content', inputSchema: { type: 'object', properties: { document_id: { type: 'string', description: 'Google Doc ID' } }, required: ['document_id'] } },
  { name: 'sheets_read', description: 'Read data from a Google Sheet', inputSchema: { type: 'object', properties: { spreadsheet_id: { type: 'string' }, range: { type: 'string', description: 'A1 notation range (e.g. Sheet1!A1:D10)' } }, required: ['spreadsheet_id'] } },
  { name: 'sheets_write', description: 'Write data to a Google Sheet', inputSchema: { type: 'object', properties: { spreadsheet_id: { type: 'string' }, range: { type: 'string' }, values: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: '2D array of values' } }, required: ['spreadsheet_id', 'range', 'values'] } },
  { name: 'sheets_add_tab', description: 'Add a new tab/sheet to an existing spreadsheet. Use this BEFORE writing to a new tab name.', inputSchema: { type: 'object', properties: { spreadsheet_id: { type: 'string' }, title: { type: 'string', description: 'Name for the new tab' } }, required: ['spreadsheet_id', 'title'] } },
];

const TOOL_HANDLERS = {
  gmail_search: gmailSearch,
  gmail_read: gmailRead,
  gmail_send: gmailSend,
  calendar_list_events: calendarList,
  calendar_create_event: calendarCreate,
  drive_search: driveSearch,
  drive_list_files: driveList,
  docs_read: docsRead,
  sheets_read: sheetsRead,
  sheets_write: sheetsWrite,
  sheets_add_tab: sheetsAddTab,
};

// ─── MCP Server Setup ────────────────────────────────────────────────────────

const server = new Server(
  { name: 'iimagine-google-workspace', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const handler = TOOL_HANDLERS[name];
  if (!handler) {
    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  }
  try {
    if (!REFRESH_TOKEN) {
      return { content: [{ type: 'text', text: 'Google Workspace not connected. Please connect via Settings → Integrations.' }], isError: true };
    }
    const result = await handler(args || {});
    return { content: [{ type: 'text', text: result }] };
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
  }
});

// Start
const transport = new StdioServerTransport();
await server.connect(transport);
