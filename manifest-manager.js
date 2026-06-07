// Manifest Manager — fetch, cache, and serve the model registry manifest
// Handles: remote fetch → local cache → bundled fallback

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const REMOTE_URL = 'https://raw.githubusercontent.com/iimagine-ai/model-registry/main/model-registry.json';
const FETCH_TIMEOUT = 5000;
const BUNDLED_PATH = path.join(__dirname, 'model-registry-bundled.json');

let cachedManifest = null;
let manifestVersion = null;
let updateAvailable = false;
let newModelCount = 0;

/**
 * Get the path for the locally cached manifest file.
 */
function getCachePath() {
  const userDataPath = app?.getPath('userData') || path.join(require('os').homedir(), '.iimagine');
  return path.join(userDataPath, 'model-registry-cache.json');
}

/**
 * Initialize the manifest manager. Call on app startup.
 * Loads from cache immediately, then fetches remote in background.
 */
async function initialize() {
  // Load from cache or bundled (instant, no network)
  cachedManifest = loadFromCache() || loadBundled();
  manifestVersion = cachedManifest?.version || null;

  // Fetch remote in background (non-blocking)
  fetchRemote().catch(err => {
    console.warn('[ManifestManager] Remote fetch failed, using cached:', err.message);
  });

  return cachedManifest;
}

/**
 * Get the current manifest (cached or bundled).
 * Lazily loads from cache/bundled if initialize() hasn't run yet, so callers
 * (e.g. the download manager) never get a null manifest.
 */
function getManifest() {
  if (!cachedManifest) {
    cachedManifest = loadFromCache() || loadBundled();
    manifestVersion = cachedManifest?.version || null;
  }
  return cachedManifest;
}

/**
 * Get the full list of models in the active manifest.
 * This is the single source of truth for the catalog (browse) and downloads.
 */
function getModels() {
  return getManifest()?.models || [];
}

/**
 * Look up a single model by id.
 * Tolerates engine-style ids like "qwen3-8b:latest" by stripping the tag.
 */
function getModel(id) {
  if (!id) return null;
  const models = getModels();
  const exact = models.find(m => m.id === id);
  if (exact) return exact;
  const cleanId = String(id).toLowerCase().split(':')[0];
  return models.find(m => String(m.id).toLowerCase() === cleanId) || null;
}

/**
 * Find a model + variant by GGUF filename (used to match installed files
 * back to the registry).
 */
function findByFilename(filename) {
  for (const model of getModels()) {
    const variant = (model.variants || []).find(v => v.filename === filename);
    if (variant) return { id: model.id, model, variant };
  }
  return null;
}

/**
 * Check if an update is available.
 * Returns: { hasUpdate, newModelCount, currentVersion, remoteVersion }
 */
function checkUpdate() {
  return {
    hasUpdate: updateAvailable,
    newModelCount,
    currentVersion: manifestVersion,
  };
}

/**
 * Load manifest from local cache file.
 */
function loadFromCache() {
  try {
    const cachePath = getCachePath();
    if (fs.existsSync(cachePath)) {
      const data = fs.readFileSync(cachePath, 'utf8');
      const manifest = JSON.parse(data);
      if (manifest && manifest.version && manifest.models) {
        console.log('[ManifestManager] Loaded from cache, version:', manifest.version);
        return manifest;
      }
    }
  } catch (err) {
    console.warn('[ManifestManager] Cache read failed:', err.message);
  }
  return null;
}

/**
 * Load the bundled fallback manifest (ships with the app).
 */
function loadBundled() {
  try {
    const data = fs.readFileSync(BUNDLED_PATH, 'utf8');
    const manifest = JSON.parse(data);
    console.log('[ManifestManager] Loaded bundled manifest, version:', manifest.version);
    return manifest;
  } catch (err) {
    console.error('[ManifestManager] Failed to load bundled manifest:', err.message);
    return { version: '0000-00-00', categories: [], models: [] };
  }
}

/**
 * Fetch the remote manifest and update cache if newer.
 */
async function fetchRemote() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const res = await fetch(REMOTE_URL, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const remoteManifest = await res.json();

    if (!remoteManifest || !remoteManifest.version || !remoteManifest.models) {
      throw new Error('Invalid manifest format');
    }

    // Compare versions (date string comparison works for YYYY-MM-DD format)
    const isNewer = remoteManifest.version > (manifestVersion || '0000-00-00');

    if (isNewer) {
      // Calculate new models
      const currentIds = new Set((cachedManifest?.models || []).map(m => m.id));
      const newModels = remoteManifest.models.filter(m => !currentIds.has(m.id));
      newModelCount = newModels.length;
      updateAvailable = true;

      // Update cache
      cachedManifest = remoteManifest;
      manifestVersion = remoteManifest.version;
      saveToCache(remoteManifest);

      console.log(`[ManifestManager] Updated to version ${remoteManifest.version} (${newModelCount} new models)`);
    } else {
      console.log('[ManifestManager] Manifest is up to date, version:', manifestVersion);
    }
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      throw new Error('Fetch timed out');
    }
    throw err;
  }
}

/**
 * Save manifest to local cache file.
 */
function saveToCache(manifest) {
  try {
    const cachePath = getCachePath();
    const dir = path.dirname(cachePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(cachePath, JSON.stringify(manifest, null, 2), 'utf8');
  } catch (err) {
    console.warn('[ManifestManager] Cache write failed:', err.message);
  }
}

/**
 * Dismiss the update notification (resets until next version change).
 */
function dismissUpdate() {
  updateAvailable = false;
  newModelCount = 0;
}

module.exports = {
  initialize,
  getManifest,
  getModels,
  getModel,
  findByFilename,
  checkUpdate,
  dismissUpdate,
};
