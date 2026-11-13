const CACHE = 'md-welders-shell-v1';
const SHELL = './';
const STATIC_DESTINATIONS = new Set(['script', 'style', 'image', 'font']);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.add(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('md-welders-shell-') && key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) caches.open(CACHE).then(cache => cache.put(SHELL, response.clone()));
      return response;
    }).catch(async () => (await caches.match(request)) || (await caches.match(SHELL))));
    return;
  }

  if (!STATIC_DESTINATIONS.has(request.destination)) return;
  event.respondWith(caches.match(request).then(async cached => {
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) caches.open(CACHE).then(cache => cache.put(request, response.clone()));
    return response;
  }));
});
