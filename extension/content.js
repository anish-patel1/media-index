/**
 * mediaIndex — Content Script
 * Scans page DOM for media assets (images, videos, GIFs, audio)
 * and communicates with the extension popup and background service worker.
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
        extension: ext.toUpperCase() || (inferredType.toUpperCase()),
        width: width > 0 ? width : null,
        height: height > 0 ? height : null,
        alt: alt.trim().slice(0, 100),
        pageTitle: document.title || window.location.hostname
      });
    }

    // 1. Scan <img> elements
    const images = document.querySelectorAll('img');
    images.forEach(img => {
      // Check currentSrc or src
      const src = img.currentSrc || img.src || img.getAttribute('data-src') || img.getAttribute('data-original');
      if (src) addAsset(src, 'image', img);

      // Check srcset
      const srcset = img.getAttribute('srcset');
      if (srcset) {
        extractUrlsFromSrcset(srcset).forEach(u => addAsset(u, 'image', img));
      }
    });

    // 2. Scan <picture> and <source>
    const sources = document.querySelectorAll('picture source, video source, audio source');
    sources.forEach(source => {
      const parentTag = source.parentElement ? source.parentElement.tagName.toLowerCase() : 'picture';
      const type = parentTag === 'video' ? 'video' : (parentTag === 'audio' ? 'audio' : 'image');

      if (source.src) addAsset(source.src, type, source);
      if (source.srcset) {
        extractUrlsFromSrcset(source.srcset).forEach(u => addAsset(u, type, source));
      }
    });

    // 3. Scan <video> elements
    const videos = document.querySelectorAll('video');
    videos.forEach(vid => {
      if (vid.src) addAsset(vid.src, 'video', vid);
      if (vid.poster) addAsset(vid.poster, 'image', vid);
    });

    // 4. Scan <a> links that point to media files
    const links = document.querySelectorAll('a[href]');
    links.forEach(a => {
      const href = a.href;
      const ext = getExtension(href);
      if (ext && MEDIA_EXTENSIONS.has(ext)) {
        addAsset(href, null, a);
      }
    });

    // 5. Scan key containers for CSS background-image
    const bgElements = document.querySelectorAll('header, banner, section, [class*="thumb"], [class*="hero"], [class*="cover"], [class*="bg-"]');
    bgElements.forEach(el => {
      const bgUrls = extractCssBackgroundUrls(el);
      bgUrls.forEach(u => addAsset(u, 'image', el));
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

  // Initial scan after DOM settles
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(notifyBadgeCount, 800);
  } else {
    window.addEventListener('DOMContentLoaded', () => setTimeout(notifyBadgeCount, 800));
  }

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
      return false; // synchronous response
    }
  });

})();
