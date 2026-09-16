const CACHE_PREFIX = 'nim-rush-shell-';
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const SHELL = ['/', '/manifest.webmanifest', '/icon.svg'];
const CACHEABLE_PREFIXES = [
  '/atlas/manifests/',
  '/atlas/characters/',
  '/atlas/pay-harbor/',
  '/atlas/audio/',
];
const NEVER_CACHE_PREFIXES = ['/atlas/api/', '/admin/', '/live'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key)))));
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  const url = new URL(event.request.url);
  if (NEVER_CACHE_PREFIXES.some((prefix) => url.pathname.startsWith(prefix)) || !CACHEABLE_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return;
  event.respondWith(caches.match(event.request).then((cached) => {
    const network = fetch(event.request).then((response) => {
      if (response.ok) void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
      return response;
    }).catch(() => cached ?? Response.error());
    return cached ?? network;
  }));
});
