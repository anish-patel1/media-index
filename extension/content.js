/**
 * media index — Content Script
 * Scans page DOM for media assets (images, videos, GIFs, audio)
 * and communicates with the extension popup and background service worker.
 * Bridges real-time sync events from extension to active media-index dashboard tabs.
 */

(function () {
  'use strict';

  const MEDIA_EXTENSIONS = new Set([
    'jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'avif', 'bmp', 'ico', 'tiff',
    'mp4', 'webm', 'mov', 'm4v', 'ogv', 'avi', 'mkv',
    'mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'
  ]);

  function getExtension(url) {
    try {
      const pathname = new URL(url).pathname;
      const clean = pathname.split('?')[0].split('#')[0];
      const parts = clean.split('.');
      return parts.length > 1 ? parts.pop().toLowerCase() : '';
    } catch {
      return '';
    }
  }

  function resolveUrl(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('blob:') || trimmed.startsWith('javascript:')) {
      return null;
    }
    try {
      const abs = new URL(trimmed, document.baseURI).href;
      if (abs.startsWith('http://') || abs.startsWith('https://')) {
        return abs;
      }
    } catch {
      // Invalid URL syntax
    }
    return null;
  }

  function extractUrlsFromSrcset(srcset) {
    if (!srcset) return [];
    const urls = [];
    const candidates = srcset.split(',');
    for (const candidate of candidates) {
      const parts = candidate.trim().split(/\s+/);
      if (parts[0]) {
        const resolved = resolveUrl(parts[0]);
        if (resolved) urls.push(resolved);
      }
    }
    return urls;
  }

  function extractCssBackgroundUrls(element) {
    try {
      const bg = window.getComputedStyle(element).backgroundImage;
      if (bg && bg !== 'none') {
        const matches = bg.match(/url\(['"]?(https?:\/\/[^'"]+)['"]?\)/gi);
        if (matches) {
          return matches.map(m => {
            const raw = m.replace(/^url\(['"]?/, '').replace(/['"]?\)$/, '');
            return resolveUrl(raw);
          }).filter(Boolean);
        }
      }
    } catch {}
    return [];
  }

  function scanMediaAssets() {
    const mediaMap = new Map();

    function addAsset(url, type, element, extra = {}) {
      const cleanUrl = resolveUrl(url);
      if (!cleanUrl || mediaMap.has(cleanUrl)) return;

      const ext = getExtension(cleanUrl);
      let inferredType = type;
      if (!inferredType) {
        if (['mp4', 'webm', 'mov', 'm4v', 'ogv', 'mkv'].includes(ext)) {
          inferredType = 'video';
        } else if (['gif'].includes(ext)) {
          inferredType = 'gif';
        } else if (['mp3', 'wav', 'ogg', 'm4a'].includes(ext)) {
          inferredType = 'audio';
        } else {
          inferredType = 'image';
        }
      }

      const rect = element && element.getBoundingClientRect ? element.getBoundingClientRect() : null;
      const width = extra.width || (rect ? Math.round(rect.width) : 0);
      const height = extra.height || (rect ? Math.round(rect.height) : 0);
      const alt = (element && (element.alt || element.title || element.getAttribute('aria-label'))) || '';

      mediaMap.set(cleanUrl, {
        url: cleanUrl,
        type: inferredType,
        extension: ext || 'bin',
        width,
        height,
        alt: alt.slice(0, 80)
      });
    }

    // 1. <img> tags
    document.querySelectorAll('img').forEach(img => {
      const src = img.currentSrc || img.src || img.getAttribute('data-src');
      if (src) addAsset(src, src.toLowerCase().includes('.gif') ? 'gif' : 'image', img);
      if (img.srcset) {
        extractUrlsFromSrcset(img.srcset).forEach(u => addAsset(u, 'image', img));
      }
    });

    // 2. <picture> <source> tags
    document.querySelectorAll('picture source').forEach(source => {
      if (source.srcset) {
        extractUrlsFromSrcset(source.srcset).forEach(u => addAsset(u, 'image', source));
      }
    });

    // 3. <video> tags
    document.querySelectorAll('video').forEach(video => {
      if (video.src) addAsset(video.src, 'video', video);
      if (video.poster) addAsset(video.poster, 'image', video);
      video.querySelectorAll('source').forEach(s => {
        if (s.src) addAsset(s.src, 'video', video);
      });
    });

    // 4. <audio> tags
    document.querySelectorAll('audio').forEach(audio => {
      if (audio.src) addAsset(audio.src, 'audio', audio);
      audio.querySelectorAll('source').forEach(s => {
        if (s.src) addAsset(s.src, 'audio', audio);
      });
    });

    // 5. <a> anchor links to media
    document.querySelectorAll('a[href]').forEach(a => {
      const href = a.href;
      const ext = getExtension(href);
      if (MEDIA_EXTENSIONS.has(ext)) {
        addAsset(href, null, a);
      }
    });

    // 6. CSS background-image on visible elements
    const sampleElements = document.querySelectorAll('header, div, section, hero, banner, [style*="background"]');
    sampleElements.forEach(el => {
      extractCssBackgroundUrls(el).forEach(u => addAsset(u, 'image', el));
    });

    return Array.from(mediaMap.values());
  }

  // Notify background service worker of media count on this tab
  function notifyBadgeCount() {
    try {
      const assets = scanMediaAssets();
      chrome.runtime.sendMessage({
        action: 'UPDATE_BADGE_COUNT',
        count: assets.length
      }).catch(() => {
        // Background listener may be idle, which is expected
      });
    } catch {}
  }

  // ---------------------------------------------------------------
  // Zero-Type Dashboard Detection & Proactive Identity Synchronization
  // ---------------------------------------------------------------
  function isDashboardPage() {
    try {
      const hostname = window.location.hostname.toLowerCase();
      const isKnownHost = hostname.endsWith('onrender.com') ||
        hostname === '127.0.0.1' ||
        hostname === 'localhost';
      const hasTree = !!document.getElementById('url-tree');
      const hasTitle = document.title.includes('media index') || document.title.includes('Media URL Analyzer');
      return (isKnownHost && (hasTree || hasTitle)) || (hasTree && hasTitle);
    } catch {
      return false;
    }
  }

  function syncDashboardIdentity() {
    if (!isDashboardPage()) return;
    try {
      const userId = (localStorage.getItem('mua_user_id') || 'default').trim();
      chrome.runtime.sendMessage({
        action: 'SYNC_USER_IDENTITY',
        userId,
        origin: window.location.origin,
        title: document.title
      }).catch(() => {
        // Background listener may be idle
      });
    } catch {
      // LocalStorage or messaging boundary error
    }
  }

  // Auto-sync user identification on page load & DOM updates
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(notifyBadgeCount, 800);
    setTimeout(syncDashboardIdentity, 600);
  } else {
    window.addEventListener('DOMContentLoaded', () => {
      setTimeout(notifyBadgeCount, 800);
      setTimeout(syncDashboardIdentity, 600);
    });
  }

  // Listen for storage events (e.g. if web app updates mua_user_id)
  window.addEventListener('storage', (e) => {
    if (e.key === 'mua_user_id' && e.newValue) {
      chrome.runtime.sendMessage({
        action: 'SYNC_USER_IDENTITY',
        userId: e.newValue.trim(),
        origin: window.location.origin,
        title: document.title
      }).catch(() => {});
    }
  });

  // Listen for custom dispatch events from web app (e.g. login / profile switch)
  window.addEventListener('media-index-auth-change', (e) => {
    if (e.detail && e.detail.userId) {
      chrome.runtime.sendMessage({
        action: 'SYNC_USER_IDENTITY',
        userId: String(e.detail.userId).trim(),
        origin: window.location.origin,
        title: document.title
      }).catch(() => {});
    }
  });

  // Listen for requests from popup or background service worker
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'SCAN_MEDIA') {
      const assets = scanMediaAssets();
      sendResponse({
        status: 'success',
        pageTitle: document.title,
        pageUrl: window.location.href,
        total: assets.length,
        media: assets
      });
      return false;
    }

    // Real-Time Cross-Tab Synchronization Bridge
    if (message.action === 'MEDIA_INDEX_SYNC') {
      try {
        const detail = {
          userId: message.userId,
          count: message.count,
          urls: message.urls || [],
          timestamp: message.timestamp || Date.now()
        };

        window.dispatchEvent(new CustomEvent('media-index-sync', { detail }));
        window.postMessage({
          type: 'MEDIA_INDEX_SYNC',
          ...detail
        }, '*');
      } catch (e) {
        console.warn('[media index] Dispatch sync event error:', e);
      }
      sendResponse({ status: 'ok' });
      return false;
    }

    // Dashboard State Discovery (for 1-click pairing & zero-type query)
    if (message.action === 'GET_DASHBOARD_STATE') {
      const isDashboard = isDashboardPage();
      const userId = (localStorage.getItem('mua_user_id') || 'default').trim();
      sendResponse({
        isDashboard,
        userId,
        title: document.title,
        origin: window.location.origin
      });
      return false;
    }
  });

})();
