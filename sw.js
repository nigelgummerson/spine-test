// Service worker for offline caching — Spinal Instrumentation Plan & Record
//
// Per-request strategy:
//   - version.json  → network-first (freshness probe for useVersionCheck).
//   - navigations (the HTML document) → network-first, cache fallback. This is
//     what makes a deploy land on the FIRST reload: the entry document is always
//     fetched fresh, so it references the new content-hashed asset graph. (The
//     old stale-while-revalidate served a cached index.html, which referenced the
//     OLD assets, so a deploy needed two reloads — the "double-reload gotcha".)
//   - everything else (content-hashed assets, icons, fonts) → stale-while-
//     revalidate: instant from cache, refreshed in the background.
// Cache name includes the app version so old caches are cleaned up on deploy.

const CACHE_NAME = 'skeletal-plan-v3.48.00-beta';
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
    // Cache each URL independently rather than cache.addAll(), which rejects the
    // whole install (and leaves the app with no offline cache) if any single URL
    // 404s. A missing icon must not break the app shell on a locked-down machine.
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url)))),
    );
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

    // Navigations (the HTML document) → network-first so a deploy lands on the
    // first reload. Fall back to the cached app shell when offline. The app is a
    // client-routed SPA (?data=, ?tab=, ?demo=), so the shell is a valid response
    // for any in-scope navigation.
    if (request.mode === 'navigate') {
        // Share links carry the full clinical case payload in the URL (?data=…).
        // Caching such a navigation would persist the patient data as a Cache
        // Storage key — clinical data-at-rest outside the app's AES encryption and
        // its 24h auto-clear, plus unbounded per-link cache growth on shared
        // hospital machines. So: never write a data-bearing navigation to the
        // cache, and normalise every cached navigation to the bare shell URL
        // (key = BASE_PATH, query stripped) so query variants share one entry and
        // no payload is ever recorded as a key.
        const navUrl = new URL(request.url);
        const hasPatientData = navUrl.searchParams.has('data');
        event.respondWith(
            fetch(request)
                .then((networkResponse) => {
                    if (networkResponse.ok && !hasPatientData) {
                        const copy = networkResponse.clone();
                        // Key on the query-less shell URL, not the navigated request.
                        caches.open(CACHE_NAME).then((cache) => cache.put(BASE_PATH, copy));
                    }
                    return networkResponse;
                })
                .catch(async () => {
                    const cache = await caches.open(CACHE_NAME);
                    return (
                        (await cache.match(BASE_PATH)) ||
                        (await cache.match(BASE_PATH + 'index.html')) ||
                        Response.error()
                    );
                }),
        );
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
