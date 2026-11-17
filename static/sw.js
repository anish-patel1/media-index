/**
 * media index — Service Worker
 * App-Shell cache for instant zero-latency page loads and branded warm-up screen
 * during Render free-tier cold starts.
 */

const CACHE_NAME = 'media-index-shell-v1';
const PRECACHE_ASSETS = [
    '/',
    '/static/favicon.png',
    '/static/favicon.ico',
    '/static/css/style.css',
    '/static/js/app.js'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(PRECACHE_ASSETS).catch((err) => {
                console.warn('[SW] Pre-caching asset failed:', err);
            });
        }).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Never cache API, thumbnail, or extension sync requests
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/sw.js')) {
        return;
    }

    // Navigation request (HTML document)
    // Instant cache fallback when Render dyno is sleeping
    if (event.request.mode === 'navigate') {
        event.respondWith(
            // Try network with 1.8s timeout, then fall back immediately to cached shell
            new Promise((resolve) => {
                let resolved = false;
                const timer = setTimeout(async () => {
                    if (!resolved) {
                        resolved = true;
                        const cached = await caches.match('/');
                        if (cached) {
                            resolve(cached);
                        }
                    }
                }, 1800);

                fetch(event.request)
                    .then((networkResponse) => {
                        if (!resolved) {
                            resolved = true;
                            clearTimeout(timer);
                            if (networkResponse && networkResponse.status === 200) {
                                const copy = networkResponse.clone();
                                caches.open(CACHE_NAME).then((cache) => cache.put('/', copy));
                            }
                            resolve(networkResponse);
                        }
                    })
                    .catch(async () => {
                        if (!resolved) {
                            resolved = true;
                            clearTimeout(timer);
                            const cached = await caches.match('/');
                            if (cached) {
                                resolve(cached);
                            }
                        }
                    });
            })
        );
        return;
    }

    // Static assets: Cache-first with background network update
    event.respondWith(
        caches.match(event.request).then((cached) => {
            if (cached) {
                fetch(event.request).then((networkResponse) => {
                    if (networkResponse && networkResponse.status === 200) {
                        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
                    }
                }).catch(() => {});
                return cached;
            }
            return fetch(event.request);
        })
    );
});
