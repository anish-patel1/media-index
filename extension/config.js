/**
 * media index — Centralized Configuration (Single Source of Truth)
 * 
 * Live cloud backend: https://media-index.onrender.com
 * Local development backend: http://127.0.0.1:5000
 */
const CONFIG = {
  // Live Cloud Backend (Default for regular users)
  PRODUCTION_API_BASE: 'https://media-index.onrender.com',

  // Local Development Backend (for Developer Mode)
  DEFAULT_DEV_API_BASE: 'http://127.0.0.1:5000',

  // Fallback for backwards compatibility
  DEFAULT_API_BASE: 'https://media-index.onrender.com',

  // Default User ID namespace (used internally)
  DEFAULT_USER_ID: 'default',

  // Endpoints (relative paths)
  ENDPOINTS: {
    ingest: '/api/import',
    single: '/api/urls',
    ping: '/api/tree',
    dashboard: '/'
  },

  // Extension timeouts & timing (including cold-start parameters)
  BADGE_TIMEOUT_MS: 2500,
  QUICK_PING_TIMEOUT_MS: 3500,
  COLD_START_TIMEOUT_MS: 60000,
  PING_INTERVAL_MS: 4000,

  /**
   * Resolves the active backend API URL given chrome.storage.local values
   * @param {Object} storageData - Object containing devModeEnabled, devApiUrl, apiUrl
   * @returns {string} Fully qualified base URL without trailing slash
   */
  resolveApiUrl: function (storageData = {}) {
    if (storageData && storageData.devModeEnabled) {
      const devUrl = (storageData.devApiUrl || storageData.apiUrl || CONFIG.DEFAULT_DEV_API_BASE).trim();
      return devUrl.replace(/\/+$/, '');
    }
    return CONFIG.PRODUCTION_API_BASE.replace(/\/+$/, '');
  },

  /**
   * Helper to check if a URL points to cloud hosting domain
   * @param {string} url 
   * @returns {boolean}
   */
  isCloudHost: function (url) {
    if (!url) return false;
    try {
      const host = new URL(url).hostname.toLowerCase();
      return host.endsWith('onrender.com') || host.includes('media-index');
    } catch {
      return url.toLowerCase().includes('onrender.com');
    }
  },

  // Backwards compatibility alias
  isRenderHost: function (url) {
    return CONFIG.isCloudHost(url);
  }
};

// Export for module systems or Service Worker environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONFIG;
}
