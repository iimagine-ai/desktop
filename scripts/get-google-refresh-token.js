#!/usr/bin/env node
/**
 * One-time script to get a Google OAuth refresh token for the MCP server.
 * Run: node scripts/get-google-refresh-token.js
 * 
 * It will open your browser for consent, then save the refresh token to mcp.json.
 */

const http = require('http');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(
  process.env.HOME, 'Library/Application Support/iimagine-desktop/mcp.json'
);

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const env = config.servers['google-workspace'].env;

const CLIENT_ID = env.GOOGLE_WORKSPACE_CLIENT_ID || env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = env.GOOGLE_WORKSPACE_CLIENT_SECRET || env.GOOGLE_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing CLIENT_ID or CLIENT_SECRET in mcp.json');
  process.exit(1);
}

const REDIRECT_URI = 'http://localhost:9876/callback';
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/spreadsheets',
].join(' ');

// Build auth URL
const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
  `client_id=${encodeURIComponent(CLIENT_ID)}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&response_type=code` +
  `&scope=${encodeURIComponent(SCOPES)}` +
  `&access_type=offline` +
  `&prompt=consent`;

console.log('\n📋 Opening browser for Google OAuth consent...\n');
console.log('If it doesn\'t open, visit:\n', authUrl, '\n');

// Open browser
try {
  execSync(`open "${authUrl}"`);
} catch {
  console.log('(Could not auto-open browser)');
}

// Start local server to catch the callback
const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith('/callback')) {
    res.end('Waiting for callback...');
    return;
  }

  const url = new URL(req.url, 'http://localhost:9876');
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    res.end(`Error: ${error}`);
    console.error('OAuth error:', error);
    server.close();
    process.exit(1);
  }

  if (!code) {
    res.end('No code received');
    return;
  }

  console.log('✅ Got authorization code, exchanging for tokens...');

  // Exchange code for tokens
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });

    const tokens = await tokenRes.json();

    if (tokens.error) {
      res.end(`Token error: ${tokens.error_description || tokens.error}`);
      console.error('Token exchange failed:', tokens);
      server.close();
      process.exit(1);
    }

    console.log('✅ Got refresh token!');
    console.log('   Access token expires in:', tokens.expires_in, 'seconds');

    // Save refresh token to mcp.json
    config.servers['google-workspace'].env.GOOGLE_WORKSPACE_REFRESH_TOKEN = tokens.refresh_token;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));

    console.log('\n✅ Saved refresh token to mcp.json');
    console.log('   Restart the desktop app and try "show me my emails" again!\n');

    res.end('<html><body><h1>✅ Success!</h1><p>Refresh token saved. You can close this tab.</p></body></html>');
    res.writeHead(200, { 'Content-Type': 'text/html' });
  } catch (err) {
    res.end(`Fetch error: ${err.message}`);
    console.error('Exchange failed:', err);
  }

  server.close();
});

server.listen(9876, () => {
  console.log('🔌 Listening on http://localhost:9876/callback for OAuth redirect...\n');
});
