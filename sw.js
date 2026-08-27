/* ============================================================
   Weekly NFL Pick’em — service worker

   BUMP THIS NUMBER EVERY SINGLE TIME YOU DEPLOY.
   If you forget, people stay on the old version. This one line
   is the difference between updates working and not working.
   ============================================================ */
const VERSION = 'v1.0.0';
const CACHE = `poolsheet-${VERSION}`;

/* Files cached on install. Keep this list short — anything not
   listed still works, it just comes from the network. */
const SHELL = [
  './',
  './index.html',
  './firebase-init.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', e => {
  // Take over immediately instead of waiting for every tab to close.
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {})
  );
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    // Delete every cache that isn't the current version.
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never cache Firebase / Google APIs — always live.
  if (url.hostname.includes('googleapis.com') ||
      url.hostname.includes('firebaseio.com') ||
      url.hostname.includes('gstatic.com')) return;

  const isShell = req.mode === 'navigate' ||
                  url.pathname.endsWith('.html') ||
                  url.pathname.endsWith('.js') ||
                  url.pathname.endsWith('/');

  if (isShell) {
    /* NETWORK FIRST for app code.
       This is why updates land quickly: we always try the network,
       and only fall back to cache when the phone is offline. */
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const c = await caches.open(CACHE);
        c.put(req, fresh.clone());
        return fresh;
      } catch {
        return (await caches.match(req)) || (await caches.match('./index.html'));
      }
    })());
  } else {
    /* CACHE FIRST for icons, fonts, images — they rarely change,
       and when they do, the VERSION bump clears them. */
    e.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      try {
        const fresh = await fetch(req);
        const c = await caches.open(CACHE);
        c.put(req, fresh.clone());
        return fresh;
      } catch {
        return new Response('', { status: 504 });
      }
    })());
  }
});

// Lets the page force an immediate swap when the user taps "Update now".
self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
