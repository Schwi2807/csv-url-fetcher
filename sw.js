// Bump VERSION on every deploy so installed copies pick up new files.
// PREFIX must be unique per app: every app on <user>.github.io shares one origin and one CacheStorage.
const PREFIX = 'csv-url-fetcher-';
const VERSION = PREFIX + 'v4';
const ASSETS = [
  './', 'index.html', 'style.css', 'core.js', 'app.js', 'errors.js', 'zip.js', 'render.js', 'fetcher.js', 'vendor/papaparse.min.js', 'sample.csv', 'proxy/worker.js', 'manifest.webmanifest',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
  'modules/ui.js', 'modules/viewer.js', 'vendor/pdf.min.js', 'vendor/pdf.worker.min.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION)
    .then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Cache-first: works fully offline after the first online launch.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch (err) {
      if (req.mode === 'navigate') return (await cache.match('./')) || (await cache.match('index.html'));
      throw err;
    }
  })());
});
