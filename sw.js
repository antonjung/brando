const VERSION = '1.0.30';
const CACHE = `brando-v${VERSION}`;
const ASSETS = [
  '.',
  'index.html',
  'version.js',
  'css/styles.css',
  'js/app.js',
  'manifest.json',
  'icons/icon.svg',
  'icons/brando.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // Cache CDN resources
  if (e.request.url.includes('cdnjs') || e.request.url.includes('unpkg') || e.request.url.includes('jsdelivr')) {
    e.respondWith(
      caches.open(CACHE).then(async c => {
        const cached = await c.match(e.request);
        if (cached) return cached;
        const res = await fetch(e.request);
        c.put(e.request, res.clone());
        return res;
      })
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});

// Triggered by app to skip the waiting phase and activate immediately
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
