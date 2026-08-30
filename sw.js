/* ============================================================
   Weekly NFL Pick’em — service worker

   BUMP THIS NUMBER EVERY SINGLE TIME YOU DEPLOY.
   If you forget, people stay on the old version. This one line
   is the difference between updates working and not working.
   ============================================================ */
const VERSION = 'v1.1.0';
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

/* ============================================================
   PUSH

   This service worker had no push handler at all, and FCM is bound to
   THIS worker — getToken() is passed the registration from
   navigator.serviceWorker.ready, which is sw.js. firebase-messaging-sw.js
   sits in the repo with the correct code and is never registered by
   anything, so it has never run.

   A Web Push message is only displayed if a service worker calls
   showNotification() itself. With no handler, every reminder the system
   sent — the tiered kickoff alerts, the weekly results, the whole alerts
   feature — arrived and displayed nothing. That is why turning alerts on
   said "Done" and then nothing ever happened.
   ============================================================ */
self.addEventListener('push', e => {
  let p = {};
  try { p = e.data ? e.data.json() : {}; }
  catch { p = { notification: { body: (e.data && e.data.text()) || '' } }; }

  // FCM v1 delivers webpush payloads as {notification, fcmOptions, data};
  // be liberal, because a malformed payload showing nothing is the exact
  // failure this handler exists to end.
  const n = p.notification || p.data || {};
  const link = (p.fcmOptions && p.fcmOptions.link) ||
               (p.data && p.data.link) || './index.html';

  e.waitUntil(self.registration.showNotification(
    n.title || "Weekly NFL Pick'em",
    {
      body: n.body || '',
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      tag: n.tag || 'pickem',
      renotify: n.renotify === true || n.renotify === 'true',
      data: { link }
    }));
});

/* Tapping a reminder should land you in the app, on the tab you already
   had open if there is one, rather than opening a second copy. */
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const link = (e.notification.data && e.notification.data.link) || './index.html';
  e.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of open) {
      if ('focus' in c) {
        await c.focus();
        if ('navigate' in c) { try { await c.navigate(link); } catch (_) {} }
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(link);
  })());
});

// Lets the page force an immediate swap when the user taps "Update now".
self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
