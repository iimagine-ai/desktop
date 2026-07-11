// Google OAuth handler — manages the browser-based OAuth flow for desktop users
// User clicks "Connect Google" → browser opens → user approves → token saved locally

const http = require('http');
const { shell } = require('electron');
const path = require('path');
const fs = require('fs');

// Load baked-in credentials (gitignored from public repo)
function getCredentials() {
  const credPath = path.join(__dirname, 'oauth-credentials.json');
  if (!fs.existsSync(credPath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(credPath, 'utf8')).google;
}

/**
 * Run the Google OAuth flow:
 * 1. Start local HTTP server on a random port
 * 2. Open browser with Google consent screen
 * 3. Catch the redirect, exchange code for tokens
 * 4. Return the refresh token
 */
function runGoogleOAuth() {
  return new Promise((resolve, reject) => {
    const creds = getCredentials();
    if (!creds) {
      reject(new Error('OAuth credentials not found. This build does not include Google integration.'));
      return;
    }

    const { client_id, client_secret, scopes } = creds;
    let server;

    // Use a random available port
    server = http.createServer(async (req, res) => {
      if (!req.url.startsWith('/oauth/callback')) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body>Waiting for Google authorization...</body></html>');
        return;
      }

      const url = new URL(req.url, `http://localhost:${server.address().port}`);
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<html><body><h2>Authorization failed</h2><p>${error}</p><p>You can close this tab.</p></body></html>`);
        server.close();
        reject(new Error(`Google OAuth error: ${error}`));
        return;
      }

      if (!code) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body>No authorization code received.</body></html>');
        return;
      }

      // Exchange code for tokens
      try {
        const redirectUri = `http://localhost:${server.address().port}/oauth/callback`;
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id,
            client_secret,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
          }),
        });

        const tokens = await tokenRes.json();

        if (tokens.error) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`<html><body><h2>Token exchange failed</h2><p>${tokens.error_description || tokens.error}</p><p>You can close this tab.</p></body></html>`);
          server.close();
          reject(new Error(`Token exchange failed: ${tokens.error_description || tokens.error}`));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<html><body style="font-family:system-ui;text-align:center;padding:60px"><h2 style="color:#10b981">✓ Connected!</h2><p style="color:#666">Google Workspace is now connected to IIMAGINE Desktop.</p><p style="color:#999;font-size:14px">You can close this tab and return to the app.</p></body></html>');
        server.close();

        resolve({
          refresh_token: tokens.refresh_token,
          access_token: tokens.access_token,
          expires_in: tokens.expires_in,
        });
      } catch (err) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<html><body><h2>Error</h2><p>${err.message}</p></body></html>`);
        server.close();
        reject(err);
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const redirectUri = `http://localhost:${port}/oauth/callback`;

      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${encodeURIComponent(client_id)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&response_type=code` +
        `&scope=${encodeURIComponent(scopes.join(' '))}` +
        `&access_type=offline` +
        `&prompt=consent`;

      console.log(`[GoogleOAuth] Opening browser for consent (port ${port})`);
      shell.openExternal(authUrl);
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('OAuth flow timed out (5 minutes). Please try again.'));
    }, 5 * 60 * 1000);
  });
}

module.exports = { runGoogleOAuth, getCredentials };
