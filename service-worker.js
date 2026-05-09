// Service worker — installs the PWA + serves the app shell offline.
//
// STRATEGY (changed in v1.6.17):
//   Network-FIRST for the app shell (HTML/JS/CSS), with cache as a
//   read-through fallback when offline. The old cache-first strategy
//   meant once a user installed the PWA, they kept seeing the cached
//   app.js / index.html / style.css until the cache name changed —
//   even after deploys. With network-first, every page load gets the
//   latest, and offline still works because the cache is populated.
//
//   Network-only for /api/ calls (no caching of dynamic responses).
const CACHE = 'steve-v4';
const ASSETS = ['/', '/index.html', '/style.css', '/app.js', '/manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // Network-only for API calls — no caching, no offline fallback.
  if (e.request.url.includes('/api/')) {
    e.respondWith(fetch(e.request).catch(() => new Response('Offline', { status: 503 })));
    return;
  }

  // Network-first for the app shell. Try fresh first; fall back to cache
  // only when network fails (offline / lost connection).
  e.respondWith(
    fetch(e.request)
      .then(resp => {
        // Update the cache so offline still works on the next visit.
        if (resp && resp.status === 200 && resp.type === 'basic') {
          const copy = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return resp;
      })
      .catch(() => caches.match(e.request).then(cached => cached || caches.match('/index.html')))
  );
});
