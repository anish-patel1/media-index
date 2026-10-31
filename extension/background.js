/**
 * media index — Background Service Worker (Manifest V3)
 * Handles context menus, badge counts, and async API communication.
 */

try {
  importScripts('config.js');
} catch (e) {
  console.warn('[media index] Could not import config.js:', e);
}

const DEFAULT_API_BASE = (typeof CONFIG !== 'undefined' && CONFIG.DEFAULT_API_BASE)
  ? CONFIG.DEFAULT_API_BASE
  : 'http://127.0.0.1:5000';

// ---------------------------------------------------------------
// Helper: read config from storage with fallback defaults
// ---------------------------------------------------------------
async function getConfig() {
  const config = await chrome.storage.local.get(['apiUrl', 'userId']);
  return {
    apiBase: config.apiUrl || DEFAULT_API_BASE,
    userId: config.userId || (typeof CONFIG !== 'undefined' ? CONFIG.DEFAULT_USER_ID : 'default')
  };
}

// ---------------------------------------------------------------
// Helper: show a Chrome notification with a title and message
// ---------------------------------------------------------------
function notify(title, message, type = 'basic') {
  try {
    chrome.notifications.create('mediaindex_' + Date.now(), {
      type,
      iconUrl: 'icons/icon-48.png',
      title: `media index — ${title}`,
      message
    });
  } catch (e) {
    console.warn('[media index] Notification error:', e);
  }
}

// ---------------------------------------------------------------
// Helper: set badge on a tab temporarily, then clear it
// ---------------------------------------------------------------
async function flashBadge(tabId, text, color, durationMs = 2500) {
  if (!tabId) return;
  try {
    await chrome.action.setBadgeText({ tabId, text });
    await chrome.action.setBadgeBackgroundColor({ tabId, color });
    setTimeout(() => chrome.action.setBadgeText({ tabId, text: '' }).catch(() => { }), durationMs);
  } catch (e) {
    console.warn('[media index] Badge error:', e);
  }
}

// ---------------------------------------------------------------
// Helper: POST a single URL to /api/urls
// ---------------------------------------------------------------
async function submitSingleUrl(url, apiBase, userId) {
  const response = await fetch(`${apiBase}/api/urls`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': userId
    },
    body: JSON.stringify({ url })
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || `HTTP ${response.status}`);
  }
  return response.json();
}

// ---------------------------------------------------------------
// Helper: POST a batch of URLs to /api/import
// ---------------------------------------------------------------
async function submitBatchUrls(urls, apiBase, userId) {
  const response = await fetch(`${apiBase}/api/import`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': userId
    },
    body: JSON.stringify({ urls })
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || `HTTP ${response.status}`);
  }
  return response.json();
}

// ---------------------------------------------------------------
// 1. Context Menu Setup on Install
// ---------------------------------------------------------------
chrome.runtime.onInstalled.addListener(() => {
  // Remove any stale menu first to avoid duplicate errors
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'send_media_to_index',
      title: 'Send to media index',
      contexts: ['image', 'video', 'audio', 'link']
    });
  });

  // Set default api URL if not already stored
  chrome.storage.local.get(['apiUrl'], (res) => {
    if (!res.apiUrl) {
      chrome.storage.local.set({ apiUrl: DEFAULT_API_BASE });
    }
  });
});

// ---------------------------------------------------------------
// 2. Context Menu Click Handler
// ---------------------------------------------------------------
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'send_media_to_index') return;

  const targetUrl = info.srcUrl || info.linkUrl || info.pageUrl;
  if (!targetUrl || targetUrl.startsWith('data:') || targetUrl.startsWith('blob:')) {
    notify('Nothing to Send', 'Right-click directly on an image, video, or media link.');
    return;
  }

  try {
    const { apiBase, userId } = await getConfig();

    // Pre-flight connection check
    let serverUp = false;
    try {
      const ping = await fetch(`${apiBase}/api/tree`, {
        signal: AbortSignal.timeout(3000)
      });
      serverUp = ping.ok;
    } catch {
      serverUp = false;
    }

    if (!serverUp) {
      notify(
        'Server Offline',
        `Cannot reach media index at ${apiBase}. Make sure app.py is running, then try again.`
      );
      if (tab?.id) await flashBadge(tab.id, '!', '#ef4444', 4000);
      return;
    }

    // Send the URL
    const data = await submitSingleUrl(targetUrl, apiBase, userId);

    const isDup = data.is_duplicate || false;
    const label = isDup ? 'Already in Library' : 'Saved!';
    const urlShort = targetUrl.length > 60 ? targetUrl.slice(0, 57) + '...' : targetUrl;

    notify(label, urlShort);

    if (tab?.id) {
      await flashBadge(tab.id, isDup ? '=' : '✓', isDup ? '#8b5cf6' : '#10b981', 3000);
    }

  } catch (err) {
    console.error('[media index] Context menu submission failed:', err);
    notify('Send Failed', `Error: ${err.message}. Is media index (app.py) running?`);
    if (tab?.id) await flashBadge(tab.id, '✗', '#ef4444', 4000);
  }
});

// ---------------------------------------------------------------
// 3. Message Listener (from popup and content scripts)
// ---------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // Badge count update from content script
  if (message.action === 'UPDATE_BADGE_COUNT') {
    if (sender.tab?.id) {
      const count = message.count || 0;
      chrome.action.setBadgeText({
        tabId: sender.tab.id,
        text: count > 0 ? (count > 99 ? '99+' : String(count)) : ''
      }).catch(() => { });
      chrome.action.setBadgeBackgroundColor({
        tabId: sender.tab.id,
        color: '#6558dd'
      }).catch(() => { });
    }
    sendResponse({ status: 'ok' });
    return false;
  }

  // Batch URL submission from popup
  if (message.action === 'SUBMIT_URLS') {
    (async () => {
      try {
        const { apiBase, userId } = await getConfig();
        const urls = (message.urls || []).filter(Boolean);

        if (!urls.length) {
          sendResponse({ status: 'error', message: 'No URLs provided.' });
          return;
        }

        const data = await submitBatchUrls(urls, apiBase, userId);

        if (data.status === 'success') {
          sendResponse({
            status: 'success',
            imported: data.imported ?? urls.length,
            merged: data.merged ?? 0,
            total_processed: data.total_processed ?? urls.length
          });
        } else {
          sendResponse({
            status: 'error',
            message: data.message || 'Server returned non-success status.'
          });
        }
      } catch (err) {
        console.error('[media index] SUBMIT_URLS failed:', err);
        sendResponse({
          status: 'error',
          message: `Could not connect to media index. Is app.py running? (${err.message})`
        });
      }
    })();
    return true; // Keep message channel open for async response
  }

  // Server connectivity check from popup
  if (message.action === 'CHECK_CONNECTION') {
    (async () => {
      try {
        const { apiBase } = await getConfig();
        const response = await fetch(`${apiBase}/api/tree`, {
          signal: AbortSignal.timeout(3000)
        });
        if (response.ok) {
          sendResponse({ connected: true, apiBase });
        } else {
          sendResponse({ connected: false, error: `HTTP ${response.status}` });
        }
      } catch (err) {
        sendResponse({ connected: false, error: err.message });
      }
    })();
    return true;
  }
});
