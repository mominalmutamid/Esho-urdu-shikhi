/*
  Service worker for এসো উর্দু শিখি
  ------------------------------------------------------------------------
  Flat structure — every file sits at the repo root, no subfolders at all,
  so uploading from a phone (where folder structure can't be preserved)
  just means selecting all these files at once:

    index.html
    style.css
    app.js
    words.json     <- grows freely, the file you'll replace most often
    manifest.json
    sw.js            <- this file

  Strategy: NETWORK-FIRST for every file above, falling back to cache only
  when offline. Updating any one file — most often words.json — just means
  replacing that file and re-uploading. No cache-version bump needed.
*/

const CACHE_NAME = 'esho-urdu-shell-v4';
const SHELL_FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './words.json',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
