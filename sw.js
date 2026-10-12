// Network-first public shell with a scoped offline fallback.
const CACHE_NAME = 'tulis-learn-v5';
const STATIC_ASSETS = [
  './', './index.html', './app.js', './api-contract.js', './local-api.js',
  './review-store.js', './vendor/ts-fsrs.js', './favicon.svg', './icon-192.png', './icon-512.png', './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key.startsWith('tulis-learn-') && key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  url.hash = '';
  url.search = '';

  // Only cache the public shell within this installation's scope.
  const base = new URL('./', self.location.href);
  const assets = new Set(STATIC_ASSETS.map(asset => new URL(asset, base).href));
  if (event.request.method !== 'GET' || url.origin !== base.origin || !assets.has(url.href)) {
    return;
  }

  const refresh = fetch(event.request).then(async response => {
    if (response.ok && response.type !== 'opaque') {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(url.href, response.clone());
    }
    return response;
  });
  event.waitUntil(refresh.catch(() => {}));
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    if (event.request.mode === 'navigate') {
      try { return await refresh; }
      catch { return await cache.match(url.href) || await cache.match(new URL('./index.html', base).href) || Response.error(); }
    }
    try { return await refresh; }
    catch { return await cache.match(url.href) || Response.error(); }
  })());
});
