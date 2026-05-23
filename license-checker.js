// License Checker — validates plugin licenses against the IIMAGINE web app
// Called by plugin-manager.js before activating paid plugins.
//
// Flow:
// 1. Check local cached license (electron-store)
// 2. If valid_until hasn't passed → plugin works (no network call)
// 3. If approaching expiry or expired → call /api/desktop/license/validate
// 4. If validation succeeds → update local cache, plugin works
// 5. If validation fails → plugin pauses (data preserved)

const Store = require('electron-store');

const store = new Store();

const LICENSE_CACHE_KEY = 'licenses'; // store.get('licenses') → { pluginId: { ... } }

class LicenseChecker {
  constructor() {
    this._serverUrl = null;
  }

  /**
   * Set the server URL (called from main.js after auth)
   */
  setServerUrl(url) {
    this._serverUrl = url;
  }

  /**
   * Get the server URL
   */
  _getServerUrl() {
    return this._serverUrl || store.get('auth.serverUrl') || 'https://app.iimagine.ai';
  }

  /**
   * Check if a plugin is licensed (or free).
   * Returns: { valid: boolean, reason?: string, license?: object }
   */
  async check(pluginId, pluginManifest) {
    // Free plugins always pass
    if (this._isFreePlugin(pluginManifest)) {
      return { valid: true, reason: 'free' };
    }

    // Check local cache first
    const cached = this._getCachedLicense(pluginId);
    if (cached && this._isValid(cached)) {
      return { valid: true, license: cached };
    }

    // If no auth token, can't validate remotely
    const token = store.get('auth.token');
    if (!token) {
      // If we have a cached license that's expired, report it
      if (cached) {
        return { valid: false, reason: 'expired', license: cached };
      }
      return { valid: false, reason: 'no_license' };
    }

    // Try remote validation
    try {
      const result = await this._validateRemote(pluginId, token);
      if (result.valid) {
        this._cacheLicense(pluginId, result.license);
        return { valid: true, license: result.license };
      }
      return { valid: false, reason: result.reason || 'invalid', license: result.license };
    } catch (err) {
      console.warn(`[License] Remote validation failed for ${pluginId}:`, err.message);
      // If we have a cached license that hasn't expired, allow offline use
      if (cached && this._isValid(cached)) {
        return { valid: true, license: cached, offline: true };
      }
      // If cached but expired, deny
      if (cached) {
        return { valid: false, reason: 'expired_offline', license: cached };
      }
      return { valid: false, reason: 'validation_failed' };
    }
  }

  /**
   * Check if a plugin manifest indicates it's free (no license needed)
   */
  _isFreePlugin(manifest) {
    // Plugins bundled with the app that don't require payment
    const FREE_PLUGINS = ['word-count', 'privacy-proxy'];
    if (FREE_PLUGINS.includes(manifest?.id)) return true;
    if (manifest?.pricing === 'free') return true;
    return false;
  }

  /**
   * Get cached license from electron-store
   */
  _getCachedLicense(pluginId) {
    const licenses = store.get(LICENSE_CACHE_KEY, {});
    return licenses[pluginId] || null;
  }

  /**
   * Cache a license locally
   */
  _cacheLicense(pluginId, license) {
    const licenses = store.get(LICENSE_CACHE_KEY, {});
    licenses[pluginId] = {
      ...license,
      cached_at: new Date().toISOString(),
    };
    store.set(LICENSE_CACHE_KEY, licenses);
  }

  /**
   * Check if a cached license is still valid (not expired)
   */
  _isValid(license) {
    if (!license || !license.valid_until) return false;
    if (license.status !== 'active' && license.status !== 'trial') return false;
    const validUntil = new Date(license.valid_until);
    return validUntil > new Date();
  }

  /**
   * Check if license is approaching expiry (within 3 days)
   */
  _isApproachingExpiry(license) {
    if (!license || !license.valid_until) return false;
    const validUntil = new Date(license.valid_until);
    const threeDaysFromNow = new Date();
    threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
    return validUntil < threeDaysFromNow;
  }

  /**
   * Call the web app to validate/refresh a license
   */
  async _validateRemote(pluginId, token) {
    const serverUrl = this._getServerUrl();
    const res = await fetch(`${serverUrl}/api/desktop/license/validate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ pluginId }),
    });

    if (!res.ok) {
      if (res.status === 401) {
        throw new Error('Authentication expired');
      }
      throw new Error(`Server returned ${res.status}`);
    }

    return await res.json();
  }

  /**
   * Get all cached licenses (for UI display)
   */
  getAllCached() {
    return store.get(LICENSE_CACHE_KEY, {});
  }

  /**
   * Clear cached license for a plugin
   */
  clearCache(pluginId) {
    const licenses = store.get(LICENSE_CACHE_KEY, {});
    delete licenses[pluginId];
    store.set(LICENSE_CACHE_KEY, licenses);
  }

  /**
   * Clear all cached licenses
   */
  clearAllCache() {
    store.set(LICENSE_CACHE_KEY, {});
  }
}

module.exports = new LicenseChecker();
