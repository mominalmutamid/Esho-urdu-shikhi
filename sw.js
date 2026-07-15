/*
  Service worker for এসো উর্দু শিখি
  Strategy:
    - App shell (HTML/CSS/JS/icons): cache-first, so the app opens instantly offline.
    - data/words.json: network-first with cache fallback, so a vocabulary update
      (you editing the JSON and redeploying) reaches users quickly when online,
      but the app still works fully offline on the last cached copy.

  Bump CACHE_VERSION whenever you change any cached file, otherwise browsers
  may keep serving the old cached version.
*/

const CACHE_VERSION = 'euk-v1';
const SHELL_CACHE = `esho-urdu-shell-${CACHE_VERSION}`;
const DATA_CACHE = `esho-urdu-data-${CACHE_VERSION}`;

const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
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
      keys
        .filter((key) => key !== SHELL_CACHE && key !== DATA_CACHE)
        .map((key) => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // Data file: network-first, fall back to cache offline.
  if (url.pathname.endsWith('/data/words.json')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(DATA_CACHE).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // App shell: cache-first, fall back to network, then update the cache.
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
