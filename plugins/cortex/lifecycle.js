// Cortex Sidecar Lifecycle Manager
// Manages the Python FastAPI sidecar process: spawn, health-check, crash recovery, shutdown.
//
// State machine: Spawning → HealthCheck → Ready → Running / Degraded
// Crash recovery: one auto-restart attempt before entering Degraded state.

const { spawn } = require('child_process');
const path = require('path');
const net = require('net');

const LOG = '[Cortex:Lifecycle]';

const HEALTH_POLL_INTERVAL_MS = 500;
const HEALTH_TIMEOUT_MS = 30000;
const SHUTDOWN_GRACE_MS = 10000;

class Lifecycle {
  constructor({ pluginDir, store, onReady, onCrash }) {
    this._pluginDir = pluginDir;
    this._store = store;
    this._onReady = onReady;
    this._onCrash = onCrash;
    this._process = null;
    this._port = null;
    this._state = 'idle'; // idle | spawning | health-check | ready | degraded
    this._restartAttempts = 0;
    this._healthInterval = null;
    this._healthStartTime = null;
  }

  // ── Public API ──────────────────────────────────────────────

  async start() {
    if (this._state === 'ready' || this._state === 'spawning') return;

    this._state = 'spawning';
    this._port = await this._findFreePort();

    console.log(`${LOG} Spawning sidecar on port ${this._port}`);

    try {
      this._spawnProcess();
      this._startHealthPolling();
    } catch (err) {
      console.error(`${LOG} Spawn failed:`, err.message);
      this._state = 'degraded';
    }
  }

  stop() {
    this._state = 'idle';
    this._stopHealthPolling();
    this._killProcess();
  }

  isReady() {
    return this._state === 'ready';
  }

  getPort() {
    return this._port;
  }

  getState() {
    return this._state;
  }

  // ── Process Management ──────────────────────────────────────

  _spawnProcess() {
    const sidecarDir = path.join(this._pluginDir, 'sidecar');

    const fs = require('fs');
    const os = require('os');

    // Resolve the source plugin directory — this is where the working .venv lives.
    // The user-dir copy (in ~/.iimagine/plugins/cortex/) has a broken venv
    // because Electron's file copy strips symlinks and execute permissions.
    let sourceDir = null;

    // Strategy 1: Walk up from plugin-manager.js (works when loaded from user dir)
    try {
      const pmPath = require.resolve('../../plugin-manager');
      const appDir = path.dirname(pmPath);
      const candidate = path.join(appDir, 'plugins', 'cortex');
      if (fs.existsSync(path.join(candidate, 'sidecar', 'run.py'))) {
        sourceDir = candidate;
      }
    } catch {}

    // Strategy 2: Known development path (fallback for this machine)
    if (!sourceDir) {
      const devPath = path.join(os.homedir(), 'Documents', 'iia-28', 'desktop-companion', 'plugins', 'cortex');
      if (fs.existsSync(path.join(devPath, 'sidecar', 'run.py'))) {
        sourceDir = devPath;
      }
    }

    // Strategy 3: Use pluginDir itself (if it has the sidecar)
    if (!sourceDir && fs.existsSync(path.join(this._pluginDir, 'sidecar', 'run.py'))) {
      sourceDir = this._pluginDir;
    }

    if (!sourceDir) {
      console.error(`${LOG} Cannot locate sidecar source directory`);
      this._state = 'degraded';
      if (this._onCrash) this._onCrash(-1);
      return;
    }

    // Determine Python binary: source venv > user venv > system python3
    const sourceVenv = path.join(sourceDir, '.venv', 'bin', 'python');
    const userVenv = path.join(this._pluginDir, '.venv', 'bin', 'python');
    const systemPython = process.platform === 'win32' ? 'python' : 'python3';

    let pythonBin = systemPython;
    if (fs.existsSync(sourceVenv)) {
      // Check if it's executable (not a broken copy)
      try {
        fs.accessSync(sourceVenv, fs.constants.X_OK);
        pythonBin = sourceVenv;
      } catch {
        // Source venv exists but not executable — try to fix permissions
        try {
          fs.chmodSync(sourceVenv, 0o755);
          pythonBin = sourceVenv;
        } catch {}
      }
    } else if (fs.existsSync(userVenv)) {
      try {
        fs.accessSync(userVenv, fs.constants.X_OK);
        pythonBin = userVenv;
      } catch {
        try {
          fs.chmodSync(userVenv, 0o755);
          pythonBin = userVenv;
        } catch {}
      }
    }

    console.log(`${LOG} Python: ${pythonBin}`);
    console.log(`${LOG} Source dir: ${sourceDir}`);

    this._process = spawn(pythonBin, ['-m', 'sidecar.run', '--port', String(this._port)], {
      cwd: sourceDir,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this._process.stdout.on('data', (data) => {
      const line = data.toString().trim();
      if (line) console.log(`${LOG} [stdout] ${line}`);
    });

    this._process.stderr.on('data', (data) => {
      const line = data.toString().trim();
      if (line) console.warn(`${LOG} [stderr] ${line}`);
    });

    this._process.on('exit', (code, signal) => {
      console.warn(`${LOG} Process exited: code=${code}, signal=${signal}`);
      this._process = null;

      if (this._state === 'idle') return; // Expected shutdown

      // Crash detected — attempt one restart
      if (this._restartAttempts < 1) {
        this._restartAttempts++;
        console.log(`${LOG} Attempting restart (attempt ${this._restartAttempts})`);
        this._state = 'spawning';
        setTimeout(() => this.start(), 1000);
      } else {
        this._state = 'degraded';
        if (this._onCrash) this._onCrash(code);
      }
    });

    this._process.on('error', (err) => {
      console.error(`${LOG} Process error:`, err.message);
      this._process = null;
      this._state = 'degraded';
      if (this._onCrash) this._onCrash(-1);
    });
  }

  _killProcess() {
    if (!this._process) return;

    const proc = this._process;
    this._process = null;

    // SIGTERM first
    try {
      proc.kill('SIGTERM');
    } catch {}

    // Force kill after grace period
    const forceKill = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {}
    }, SHUTDOWN_GRACE_MS);

    proc.on('exit', () => {
      clearTimeout(forceKill);
    });
  }

  // ── Health Polling ──────────────────────────────────────────

  _startHealthPolling() {
    this._state = 'health-check';
    this._healthStartTime = Date.now();

    this._healthInterval = setInterval(async () => {
      const elapsed = Date.now() - this._healthStartTime;

      if (elapsed > HEALTH_TIMEOUT_MS) {
        console.error(`${LOG} Health check timeout (${HEALTH_TIMEOUT_MS}ms)`);
        this._stopHealthPolling();

        // Retry once
        if (this._restartAttempts < 1) {
          this._restartAttempts++;
          this._killProcess();
          setTimeout(() => this.start(), 1000);
        } else {
          this._state = 'degraded';
          if (this._onCrash) this._onCrash(-1);
        }
        return;
      }

      try {
        const res = await fetch(`http://127.0.0.1:${this._port}/health`, {
          signal: AbortSignal.timeout(2000),
        });
        if (res.ok) {
          console.log(`${LOG} Health check passed (${elapsed}ms)`);
          this._stopHealthPolling();
          this._state = 'ready';
          this._restartAttempts = 0; // Reset on success
          if (this._onReady) this._onReady(this._port);
        }
      } catch {
        // Not ready yet — keep polling
      }
    }, HEALTH_POLL_INTERVAL_MS);
  }

  _stopHealthPolling() {
    if (this._healthInterval) {
      clearInterval(this._healthInterval);
      this._healthInterval = null;
    }
  }

  // ── Port Assignment ─────────────────────────────────────────

  _findFreePort() {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        server.close(() => resolve(port));
      });
      server.on('error', reject);
    });
  }
}

module.exports = Lifecycle;
