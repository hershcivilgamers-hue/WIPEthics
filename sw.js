// =============================================================================
// sw.js — service worker for installability + offline resilience.
//
// Strategy is NETWORK-FIRST for same-origin GETs: this app is under active
// development, so it must NEVER serve stale code while online. The cache is only
// a fallback — after one online visit the app shell and the modules that loaded
// are cached, so a later OFFLINE reload still opens (server-mode data then shows
// its own "can't reach the server" state, which the app already handles).
//
// Cross-origin requests (the Worker API, Google Fonts) are left entirely alone —
// straight to network, never cached here.
// =============================================================================

const CACHE = 'cairo-shell-v1';
const SHELL = ['./', 'index.html', 'favicon.svg', 'manifest.webmanifest'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return; // API/fonts: hands off

  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res && res.ok) {
        const c = await caches.open(CACHE);
        c.put(req, res.clone()); // refresh the fallback copy
      }
      return res;
    } catch (err) {
      const cached = await caches.match(req);
      if (cached) return cached;
      if (req.mode === 'navigate') return (await caches.match('index.html')) || (await caches.match('./'));
      throw err;
    }
  })());
});
