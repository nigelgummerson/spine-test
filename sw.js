// Service worker for offline caching — Spinal Instrumentation Plan & Record
// Cache-first strategy: serve from cache, fall back to network, update cache in background.
// Cache name includes a version hash so old caches are cleaned up on deploy.

const CACHE_NAME = 'skeletal-plan-v3.32.01-beta';
const BASE_PATH = '/spine/';

// Assets to pre-cache on install (the app shell)
const PRECACHE_URLS = [BASE_PATH, BASE_PATH + 'index.html'];

self.addEventListener('install', (event) => {
    // Skip waiting so the new SW activates immediately
    self.skipWaiting();
    event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)));
});

self.addEventListener('activate', (event) => {
    // Clean up old caches from previous versions
    event.waitUntil(
        caches
            .keys()
            .then((keys) =>
                Promise.all(
                    keys
                        .filter((key) => key.startsWith('skeletal-plan-') && key !== CACHE_NAME)
                        .map((key) => caches.delete(key)),
                ),
            )
            .then(() => self.clients.claim()),
    );
});

self.addEventListener('fetch', (event) => {
    const { request } = event;

    // Only handle GET requests for same-origin resources
    if (request.method !== 'GET') return;
    if (!request.url.startsWith(self.location.origin)) return;

    // Skip chrome-extension and other non-http(s) schemes
    if (!request.url.startsWith('http')) return;

    event.respondWith(
        caches.open(CACHE_NAME).then(async (cache) => {
            const cachedResponse = await cache.match(request);

            // Stale-while-revalidate: return cached version immediately,
            // fetch fresh version in background to update cache
            const fetchPromise = fetch(request)
                .then((networkResponse) => {
                    // Only cache successful responses
                    if (networkResponse.ok) {
                        cache.put(request, networkResponse.clone());
                    }
                    return networkResponse;
                })
                .catch(() => {
                    // Network failed — cachedResponse (if any) is already being returned
                    return undefined;
                });

            // Return cached response immediately, or wait for network
            return cachedResponse || fetchPromise;
        }),
    );
});
