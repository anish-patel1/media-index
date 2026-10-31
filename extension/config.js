/**
 * media index — Centralized Configuration (Single Source of Truth)
 * 
 * Edit DEFAULT_API_BASE here to change the default backend URL for both development and production.
 * This default can also be overridden at runtime via the Extension Options page (chrome.storage.local).
 */
const CONFIG = {
  // Default API base URL for media index backend
  DEFAULT_API_BASE: 'http://127.0.0.1:5000',

  // Default User ID namespace (must match static/js/app.js)
  DEFAULT_USER_ID: 'default',

  // Endpoints (relative paths)
  ENDPOINTS: {
    ingest: '/api/import',
    single: '/api/urls',
    ping: '/api/tree',
    dashboard: '/'
  },

  // Extension timeouts & timing
  BADGE_TIMEOUT_MS: 2500,
  PING_TIMEOUT_MS: 3000
};

// Export for module systems or Service Worker environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONFIG;
}

