/* ============================================================================
   UNIMPOSSIBLE — service worker

   Strategy: NETWORK-FIRST, cache as fallback.

   Why not cache-first (the more common choice)? Cache-first serves the stored
   copy immediately, which is marginally faster — but it also means a freshly
   deployed update won't appear until the cache is invalidated. That's a bad
   trade while the game is being actively developed and tested.

   Network-first still gives full offline play (if the network fails, the cached
   copy is served), but a live visit always gets the newest files.

   NOTE: this file must live at the SITE ROOT. A service worker can only control
   pages at or below its own directory, so sw.js in a subfolder could not cache
   index.html.
   ============================================================================ */

const CACHE = 'unimpossible-v20';

const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './game/styles.css',
  './game/game.js',
  './game/words.json',
  './images/icon-180.png',
  './images/icon-192.png',
  './images/icon-512.png',
  './images/favicon-32.png',
];

// Pre-cache the app shell so the game works offline on first revisit.
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .catch(() => {})          // a missing optional asset shouldn't break install
      .then(() => self.skipWaiting())
  );
});

// Drop caches from older versions.
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first; fall back to cache when offline.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        // stash a fresh copy for offline use
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() =>
        caches.match(e.request).then((hit) => hit || caches.match('./index.html'))
      )
  );
});
