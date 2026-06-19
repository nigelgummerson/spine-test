// Service worker for offline caching — Spinal Instrumentation Plan & Record
// Cache-first strategy: serve from cache, fall back to network, update cache in background.
// Cache name includes a version hash so old caches are cleaned up on deploy.

const CACHE_NAME = 'skeletal-plan-v3.40.00-beta';
// Derive the base from the service worker's own URL so precache paths are correct
// under any deploy base — production '/spine/' and preview '/spine-test/' alike.
// (sw.js is served at <base>sw.js, so stripping the filename yields <base>.)
const BASE_PATH = self.location.pathname.replace(/sw\.js$/, '');

// Assets to pre-cache on install (the app shell + install metadata, so a freshly
// installed PWA survives going offline before the icons/manifest are fetched).
const PRECACHE_URLS = [
    BASE_PATH,
    BASE_PATH + 'index.html',
    BASE_PATH + 'manifest.webmanifest',
    BASE_PATH + 'icon-192.png',
    BASE_PATH + 'icon-512.png',
];

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

    // version.json is the freshness probe used by useVersionCheck. If the SW
    // cached it stale-while-revalidate, the running app would see its own
    // cached version and decide it is current, the UpdateBanner would never
    // fire, and the surgeon would stay on stale code forever. Always go to
    // network for this URL; only fall back to cache when offline so a
    // disconnected surgeon does not lose the rest of the app.
    if (request.url.endsWith('/version.json')) {
        event.respondWith(fetch(request).catch(() => caches.open(CACHE_NAME).then((c) => c.match(request))));
        return;
    }

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
