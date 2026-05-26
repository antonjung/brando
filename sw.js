const VERSION = '2.0.2';
const CACHE = `brando-v${VERSION}`;
const ASSETS = [
  'css/styles.css',
  'js/app.js',
  'manifest.json',
  'icons/icon.svg',
  'icons/brando.png',
];

// These are always fetched fresh from network (with cache fallback offline)
const NETWORK_FIRST = ['/', '/index.html', 'index.html', 'version.js'];

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

  const url = new URL(e.request.url);

  // Always network-first for index.html and version.js
  if (NETWORK_FIRST.some(p => url.pathname.endsWith(p) || url.pathname === '/brando/' || url.pathname === '/brando')) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }

  // Cache CDN resources
  if (url.hostname.includes('cdnjs') || url.hostname.includes('unpkg') || url.hostname.includes('jsdelivr')) {
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

  // Cache-first for everything else
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
