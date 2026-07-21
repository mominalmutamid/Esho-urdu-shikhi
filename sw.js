/*
  Service worker for এসো উর্দু শিখি
  ------------------------------------------------------------------------
  Structure (back to split files, since the real problem was GitHub's
  drag-and-drop uploader flattening folders — not the folders themselves):

    index.html            app shell (HTML, references css/js below)
    css/style.css
    js/app.js
    data/words.json         <- grows freely, no effect on shell size
    manifest.json           <- icons embedded as base64, no icon files needed
    sw.js                    <- this file

  Strategy: NETWORK-FIRST for every one of the files above, falling back to
  cache only when offline. This means updating ANY file — the dictionary,
  the styling, the logic — just means replacing that one file and
  re-uploading. No cache-version bump needed, no waiting, nothing else to
  touch here.
*/

const CACHE_NAME = 'esho-urdu-shell-v3';
const SHELL_FILES = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './data/words.json',
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
