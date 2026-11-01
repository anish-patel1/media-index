/**
 * media index — Background Service Worker (Manifest V3)
 * Handles context menus, badge counts, async API communication,
 * cloud cold-start wake-up recovery, and real-time state synchronization.
 */

try {
  importScripts('config.js');
} catch (e) {
  console.warn('[media index] Could not import config.js:', e);
}

const PRODUCTION_API = (typeof CONFIG !== 'undefined' && CONFIG.PRODUCTION_API_BASE)
  ? CONFIG.PRODUCTION_API_BASE
  : 'https://media-index.onrender.com';

const DEFAULT_DEV_API = (typeof CONFIG !== 'undefined' && CONFIG.DEFAULT_DEV_API_BASE)
  ? CONFIG.DEFAULT_DEV_API_BASE
  : 'http://127.0.0.1:5000';

const DEFAULT_USER_ID = (typeof CONFIG !== 'undefined' && CONFIG.DEFAULT_USER_ID)
  ? CONFIG.DEFAULT_USER_ID
  : 'default';

// ---------------------------------------------------------------
// Helper: read config from storage with smart environment resolution
// ---------------------------------------------------------------
async function getConfig() {
  const stored = await chrome.storage.local.get(['apiUrl', 'devModeEnabled', 'devApiUrl', 'userId']);
  let apiBase;
  if (typeof CONFIG !== 'undefined' && typeof CONFIG.resolveApiUrl === 'function') {
    apiBase = CONFIG.resolveApiUrl(stored);
  } else {
    apiBase = stored.devModeEnabled ? (stored.devApiUrl || DEFAULT_DEV_API) : PRODUCTION_API;
  }

  return {
    apiBase: (apiBase || PRODUCTION_API).replace(/\/+$/, ''),
    userId: (stored.userId || DEFAULT_USER_ID).trim(),
    devModeEnabled: !!stored.devModeEnabled
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
    if (durationMs > 0) {
      setTimeout(() => chrome.action.setBadgeText({ tabId, text: '' }).catch(() => { }), durationMs);
    }
  } catch (e) {
    console.warn('[media index] Badge error:', e);
  }
}

// ---------------------------------------------------------------
// Helper: Origin Matcher (Treats 127.0.0.1 and localhost as equivalent)
// ---------------------------------------------------------------
function originsMatch(urlA, urlB) {
  try {
    const a = new URL(urlA);
    const b = new URL(urlB);
    if (a.origin === b.origin) return true;
    const isALocal = a.hostname === '127.0.0.1' || a.hostname === 'localhost';
    const isBLocal = b.hostname === '127.0.0.1' || b.hostname === 'localhost';
    if (isALocal && isBLocal && a.port === b.port && a.protocol === b.protocol) {
      return true;
    }
  } catch {}
  return false;
}

// ---------------------------------------------------------------
// Helper: Broadcast Real-Time Sync Event to Open Dashboard Tabs
// ---------------------------------------------------------------
async function broadcastSyncEvent(apiBase, userId, count, addedUrls = []) {
  try {
    const tabs = await chrome.tabs.query({});
    const syncPayload = {
      action: 'MEDIA_INDEX_SYNC',
      apiBase,
      userId,
      count,
      urls: addedUrls,
      timestamp: Date.now()
    };

    for (const tab of tabs) {
      if (!tab.url || !tab.id) continue;
      try {
        const isMatchedOrigin = originsMatch(tab.url, apiBase);
        const isTitleMatch = tab.title && (tab.title.toLowerCase().includes('media index') || tab.title.toLowerCase().includes('media url analyzer'));

        if (isMatchedOrigin || isTitleMatch) {
          chrome.tabs.sendMessage(tab.id, syncPayload, () => {
            if (chrome.runtime.lastError) {
              chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['content.js']
              }).then(() => {
                chrome.tabs.sendMessage(tab.id, syncPayload).catch(() => {});
              }).catch(() => {});
            }
          });
        }
      } catch (e) {
        console.debug('[media index] broadcast tab check note:', e);
      }
    }
  } catch (err) {
    console.debug('[media index] broadcastSyncEvent note:', err);
  }
}

// ---------------------------------------------------------------
// Helper: Ping with Cloud Cold-Start Wake-up Recovery
// ---------------------------------------------------------------
async function pingOrWakeupServer(apiBase, onWakingCallback = null) {
  // Quick initial check (5s) using /api/tree
  try {
    const quickRes = await fetch(`${apiBase}/api/tree`, {
      signal: AbortSignal.timeout(5000)
    });
    if (quickRes.ok) {
      return { online: true, wokeUp: false };
    }
  } catch {}

  const isCloud = (typeof CONFIG !== 'undefined' && typeof CONFIG.isCloudHost === 'function')
    ? CONFIG.isCloudHost(apiBase)
    : apiBase.includes('onrender.com');

  if (onWakingCallback) {
    onWakingCallback(isCloud);
  }

  // Polling loop for cloud instance spin-up (up to 60s)
  const maxWaitMs = (typeof CONFIG !== 'undefined' && CONFIG.COLD_START_TIMEOUT_MS) || 60000;
  const intervalMs = (typeof CONFIG !== 'undefined' && CONFIG.PING_INTERVAL_MS) || 4000;
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    await new Promise(res => setTimeout(res, intervalMs));
    try {
      const retryRes = await fetch(`${apiBase}/api/tree`, {
        signal: AbortSignal.timeout(6000)
      });
      if (retryRes.ok) {
        return { online: true, wokeUp: true };
      }
    } catch {}
  }

  return { online: false, timeout: true };
}

// ---------------------------------------------------------------
// Helper: POST a single URL to /api/urls
// ---------------------------------------------------------------
async function submitSingleUrl(url, apiBase, userId, timeoutMs = 8000) {
  const response = await fetch(`${apiBase}/api/urls`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': userId
    },
    body: JSON.stringify({ url }),
    signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined
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
async function submitBatchUrls(urls, apiBase, userId, timeoutMs = 25000) {
  const response = await fetch(`${apiBase}/api/import`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': userId
    },
    body: JSON.stringify({ urls }),
    signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || `HTTP ${response.status}`);
  }
  return response.json();
}

// ---------------------------------------------------------------
// 1. Context Menu Setup on Install & Startup
// ---------------------------------------------------------------
function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'send_media_to_index',
      title: 'Send to media index',
      contexts: ['image', 'video', 'audio', 'link']
    }, () => {
      if (chrome.runtime.lastError) {
        console.debug('[media index] Context menu creation note:', chrome.runtime.lastError);
      }
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  setupContextMenus();

  // Initialize smart defaults
  chrome.storage.local.get(['devModeEnabled', 'devApiUrl', 'apiUrl', 'userId'], (res) => {
    const updates = {};
    if (res.devModeEnabled === undefined) updates.devModeEnabled = false;
    if (!res.devApiUrl) updates.devApiUrl = DEFAULT_DEV_API;
    if (!res.apiUrl) updates.apiUrl = res.devModeEnabled ? (res.devApiUrl || DEFAULT_DEV_API) : PRODUCTION_API;
    if (!res.userId) updates.userId = DEFAULT_USER_ID;
    if (Object.keys(updates).length > 0) {
      chrome.storage.local.set(updates);
    }
  });
});

chrome.runtime.onStartup.addListener(() => {
  setupContextMenus();
});

// ---------------------------------------------------------------
// 2. Context Menu Click Handler (Direct with Cold-Start Resilience)
// ---------------------------------------------------------------
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'send_media_to_index') return;

  const targetUrl = info.srcUrl || info.linkUrl || info.pageUrl;
  if (!targetUrl || targetUrl.startsWith('data:') || targetUrl.startsWith('blob:') || targetUrl.startsWith('javascript:')) {
    notify('Nothing to Send', 'Right-click directly on an image, video, or media link.');
    return;
  }

  let targetApi = PRODUCTION_API;
  let targetUser = DEFAULT_USER_ID;

  try {
    const config = await getConfig();
    targetApi = config.apiBase;
    targetUser = config.userId;

    if (tab?.id) await flashBadge(tab.id, '...', '#6558dd', 0);

    let data = null;
    let wasWokenUp = false;

    // Direct attempt first for instant response when server is awake (<=6s)
    try {
      data = await submitSingleUrl(targetUrl, targetApi, targetUser, 6000);
    } catch (directErr) {
      console.log('[media index] Direct submission attempt paused, running connection recovery:', directErr.message);

      const isCloud = (typeof CONFIG !== 'undefined' && typeof CONFIG.isCloudHost === 'function')
        ? CONFIG.isCloudHost(targetApi)
        : targetApi.includes('onrender.com');

      if (tab?.id) flashBadge(tab.id, '⏳', '#f59e0b', 0);
      if (isCloud) {
        notify(
          'Connecting to Server...',
          'Cloud server is starting up. Ingestion queued and will save automatically.'
        );
      }

      const pingStatus = await pingOrWakeupServer(targetApi);
      if (!pingStatus.online) {
        throw new Error(`Could not reach media index at ${targetApi}. Please check server status.`);
      }

      wasWokenUp = true;
      data = await submitSingleUrl(targetUrl, targetApi, targetUser, 10000);
    }

    const isDup = data?.is_duplicate || false;
    const label = isDup ? 'Already in Library' : (wasWokenUp ? 'Server Awake & Saved!' : 'Saved!');
    const urlShort = targetUrl.length > 60 ? targetUrl.slice(0, 57) + '...' : targetUrl;

    notify(label, urlShort);

    if (tab?.id) {
      await flashBadge(tab.id, isDup ? '=' : '✓', isDup ? '#8b5cf6' : '#10b981', 3000);
    }

    // Real-Time Sync notification to active dashboard tabs
    await broadcastSyncEvent(targetApi, targetUser, 1, [targetUrl]);

  } catch (err) {
    console.error('[media index] Context menu submission failed:', err);
    notify('Send Failed', `Error: ${err.message}`);
    if (tab?.id) await flashBadge(tab.id, '✗', '#ef4444', 4000);
  }
});

// ---------------------------------------------------------------
// 3. Message Listener (from popup and content scripts)
// ---------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // Zero-Type User Identity Sync from Web Dashboard
  if (message.action === 'SYNC_USER_IDENTITY') {
    const detectedUserId = (message.userId || DEFAULT_USER_ID).trim();
    chrome.storage.local.set({ userId: detectedUserId }, () => {
      console.log('[media index] Auto-synced user identity from dashboard:', detectedUserId);
    });
    sendResponse({ status: 'ok', userId: detectedUserId });
    return false;
  }

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
      let targetApi = PRODUCTION_API;
      let targetUser = DEFAULT_USER_ID;

      try {
        const config = await getConfig();
        targetApi = config.apiBase;
        targetUser = config.userId;
        const urls = (message.urls || []).filter(Boolean);

        if (!urls.length) {
          sendResponse({ status: 'error', message: 'No URLs provided.' });
          return;
        }

        const data = await submitBatchUrls(urls, targetApi, targetUser);

        if (data && data.status === 'success') {
          // Trigger real-time sync across dashboard tabs
          broadcastSyncEvent(targetApi, targetUser, urls.length, urls);

          sendResponse({
            status: 'success',
            imported: data.imported ?? urls.length,
            merged: data.merged ?? 0,
            total_processed: data.total_processed ?? urls.length
          });
        } else {
          sendResponse({
            status: 'error',
            message: (data && data.message) || 'Server returned non-success status.'
          });
        }
      } catch (err) {
        console.error('[media index] SUBMIT_URLS failed:', err);
        sendResponse({
          status: 'error',
          message: `Could not connect to media index at ${targetApi}: ${err.message}`
        });
      }
    })();
    return true; // Keep message channel open for async response
  }

  // Server connectivity check from popup
  if (message.action === 'CHECK_CONNECTION') {
    (async () => {
      try {
        const { apiBase, devModeEnabled } = await getConfig();
        const isCloud = (typeof CONFIG !== 'undefined' && typeof CONFIG.isCloudHost === 'function')
          ? CONFIG.isCloudHost(apiBase)
          : apiBase.includes('onrender.com');

        try {
          const quickRes = await fetch(`${apiBase}/api/tree`, {
            signal: AbortSignal.timeout(4500)
          });
          if (quickRes.ok) {
            sendResponse({
              connected: true,
              apiBase,
              devModeEnabled,
              isCloud,
              wakingUp: false
            });
            return;
          }
        } catch (quickErr) {
          sendResponse({
            connected: false,
            apiBase,
            devModeEnabled,
            isCloud,
            wakingUp: isCloud,
            error: quickErr.message || 'Unreachable'
          });
          return;
        }

        sendResponse({
          connected: false,
          apiBase,
          devModeEnabled,
          isCloud,
          wakingUp: isCloud,
          error: 'Bad response'
        });
      } catch (err) {
        sendResponse({ connected: false, error: err.message, wakingUp: false });
      }
    })();
    return true;
  }
});
