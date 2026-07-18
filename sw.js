/*
  Service worker for এসো উর্দু শিখি
  Everything (HTML, CSS, JS, vocabulary data, icons) lives inside index.html
  and manifest.json — there are no subfolders to break during a GitHub upload.

  Strategy: NETWORK-FIRST for the app shell (index.html / '/'), falling back
  to cache only when offline. This means from now on, updating the app is a
  single-file operation — just replace index.html and re-upload. There is no
  need to bump a cache version here for ordinary content changes, since the
  service worker always prefers whatever is live on the server when online.
*/

const CACHE_NAME = 'esho-urdu-shell-v1';
const SHELL_FILES = ['./', './index.html', './manifest.json'];

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
