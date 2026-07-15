/*
  Service worker for এসো উর্দু শিখি
  Everything (HTML, CSS, JS, vocabulary data, icons) now lives inside
  index.html and manifest.json — there are no subfolders left to break
  during a GitHub upload. Simple cache-first app shell strategy.

  Bump CACHE_VERSION whenever you edit index.html or manifest.json,
  otherwise returning visitors may keep seeing the old cached version.
*/

const CACHE_VERSION = 'euk-v2';
const SHELL_CACHE = `esho-urdu-shell-${CACHE_VERSION}`;

const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        const clone = response.clone();
        caches.open(SHELL_CACHE).then((cache) => cache.put(event.request, clone));
        return response;
      });
    })
  );
});
