/* ============================================================
   Weekly NFL Pick’em — service worker

   BUMP THIS NUMBER EVERY SINGLE TIME YOU DEPLOY.
   If you forget, people stay on the old version. This one line
   is the difference between updates working and not working.
   ============================================================ */
const VERSION = 'v1.17.0';
const CACHE = `poolsheet-${VERSION}`;

/* Files cached on install. Keep this list short — anything not
   listed still works, it just comes from the network. */
/* './index.html' is deliberately NOT here, and neither is it the app's
   start_url any more. Cloudflare Pages canonicalises /index.html to /, so
   requesting it follows a REDIRECT — and a redirected response is the one
   thing a service worker may not hand back for a navigation. See the
   navigation guard in the fetch handler. './' is the canonical URL and
   redirects nowhere. */
const SHELL = [
  './',
  './firebase-init.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', e => {
  /* Deliberately NOT calling self.skipWaiting() here.

     It used to, which quietly defeated the whole update mechanism: a new
     worker activated the instant it installed and claimed every client,
     firing `controllerchange`, and firebase-init.js reloads the page on
     that event. So a deploy while somebody was mid-week ranking their
     confidence picks reloaded the page underneath them and threw away
     anything not yet written. The "Update now" prompt was decorative —
     the swap had already happened before the button could be tapped, and
     the new worker never sat in `waiting` for it to act on.

     The page now decides when to swap, by posting SKIP_WAITING (see the
     message handler at the bottom). */
  /* One entry at a time, not addAll().

     addAll() is all-or-nothing: if any single URL 404s — a renamed
     icon, a file not yet live on a fresh Pages deploy — the whole
     thing rejects, the .catch() below swallowed it, and install
     "succeeded" with an EMPTY cache. The offline fallback then matched
     nothing and respondWith(undefined) gave the browser's network
     error page. Better to cache the five that worked. */
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(SHELL.map(u => c.add(u).catch(() => {})));
  })());
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
  const sameOrigin = url.origin === self.location.origin;

  /* ---- NEVER CACHED ------------------------------------------------
     Anything that carries identity or live state. This list is the
     first thing to check when something "won't log out" or "won't
     refresh".

     /api/* was NOT here, and it was the worst bug in this file.
     `/api/session` is a GET whose path ends in neither .html nor .js
     nor a slash, so it fell through to the cache-first branch below and
     was stored PERMANENTLY — response body `{token, uid}`, where token
     is a Firebase custom token that expires in one hour.

     Three things followed, none of them obvious from the symptom:

       1. Signing out did not sign you out. Sign out deletes the server
          session and reloads; boot() then re-fetched /api/session, got
          the cached 200 with the OLD token, and signed the same person
          straight back in. On a shared iPad the next person to open the
          app was signed in as the previous player, with their picks and
          their standings row.
       2. Every returning player was sent back to the PIN screen every
          week, forever. The whole point of /api/session is to survive
          Safari evicting IndexedDB after 7 days — but the cached token
          was minted weeks ago, signInWithCustomToken rejected it, the
          error was swallowed, and the worker would never re-fetch.
       3. A 401 from the very first visit (before anyone had signed in)
          was cached too, so automatic session restore was dead from
          the first launch and never recovered.

     None of this is visible in a normal deploy, because bumping VERSION
     does not help: the new worker never activates (see the update
     prompt in firebase-init.js). */
  if (sameOrigin && url.pathname.startsWith('/api/')) return;

  // Firebase / Google live endpoints — always the network.
  if (url.hostname.includes('googleapis.com') ||
      url.hostname.includes('firebaseio.com')) return;

  /* ---- IMMUTABLE VENDOR CODE ---------------------------------------
     The Firebase SDK is imported from a VERSIONED gstatic URL, so its
     bytes can never change under us. It used to be excluded from the
     cache entirely, which is why "offline support" did not exist: with
     no SDK the module import fails, window.PS is never created, and the
     app dies on boot with no network. Caching it by URL is safe
     precisely because the version is in the path. */
  const immutable = url.hostname.includes('gstatic.com') &&
                    /\/firebasejs\/\d/.test(url.pathname);

  const isShell = sameOrigin &&
                  (req.mode === 'navigate' ||
                   url.pathname.endsWith('.html') ||
                   url.pathname.endsWith('.js') ||
                   url.pathname.endsWith('/'));

  /* Only cache what we should still be serving in a week's time. A
     `fetch()` promise RESOLVES for 404 and 503 — it only rejects when
     the network itself fails — and neither branch used to check, so a
     momentary 404 during a Cloudflare Pages deploy could be stored as
     the permanent answer for an icon, and a Cloudflare 5xx error page
     could become the offline fallback for the whole app. */
  const store = async (res) => {
    if (!res || !res.ok || res.type === 'opaque') return;
    try { (await caches.open(CACHE)).put(req, res.clone()); } catch (_) {}
  };

  /* A NAVIGATION MAY NEVER BE ANSWERED WITH A REDIRECTED RESPONSE.

     Safari enforces this and says so in as many words: "Response served by
     service worker has redirections". The whole app then fails to open,
     with no way back in except deleting the Home Screen icon.

     It happened because the manifest's start_url was './index.html' while
     Cloudflare Pages canonicalises /index.html to /. So every launch of the
     installed app was a navigation whose fetch followed a redirect, and
     handing that back from here is a network error in WebKit. start_url is
     './' now, which fixes new installs — but anyone who installed the old
     one keeps launching /index.html until they reinstall, and any future
     redirect (apex to www, http to https, a trailing slash) would do the
     same thing again.

     So sanitise instead of relying on the manifest: rebuilding the response
     from its own body, status and headers produces an identical answer with
     the redirect flag cleared. Only ever does work when the flag is set. */
  const noRedirect = async (res) => {
    if (!res || req.mode !== 'navigate' || !res.redirected) return res;
    const body = await res.blob();
    return new Response(body, { status: res.status,
      statusText: res.statusText, headers: res.headers });
  };

  if (isShell) {
    /* STALE-WHILE-REVALIDATE for app code.

       This was NETWORK FIRST, and on a phone that is the difference
       between an app and a website. index.html is ~195KB and
       firebase-init.js is another 39KB, and network-first means every
       single launch AWAITS both over whatever signal the person happens
       to have before the browser is allowed to paint one pixel. Players
       reported 10-15 seconds of white screen opening the installed app
       on 4G, then the loading cover on top of that — and the cached copy
       that would have rendered instantly was sitting right there
       untouched the whole time, because nothing consulted it until the
       network had already failed.

       Now: answer from cache IMMEDIATELY when there is a cached copy, and
       refresh it in the background for next time. Launch becomes as fast
       as the phone can parse the file, offline included.

       The tradeoff is one launch of staleness after a deploy, and this
       app already has the machinery for exactly that: the background
       fetch below re-caches the new bytes, the waiting worker triggers
       the "Update now" prompt (see registerSW in firebase-init.js), and
       tapping it posts SKIP_WAITING and reloads into the new version.
       Anyone who does not tap it gets the update on their next launch.
       That is a far better deal than making all 50 players wait out a
       network round trip every time they open the app to check a score. */
    e.respondWith((async () => {
      const hit = await caches.match(req);
      const fresh = fetch(req).then(res => { store(res); return res; })
                              .catch(() => null);
      if (hit) {
        // Don't let the background refresh die with the response we just
        // returned — waitUntil keeps the worker alive long enough to
        // finish writing the new bytes for next launch.
        e.waitUntil(fresh);
        return await noRedirect(hit);
      }
      return (await noRedirect(await fresh)) ||
             (await noRedirect(await caches.match('./'))) ||
             new Response('Offline', { status: 503,
               headers: { 'Content-Type': 'text/plain' } });
    })());
    return;
  }

  if (immutable || sameOrigin) {
    /* CACHE FIRST for icons, fonts, images and the pinned SDK — they
       rarely change, and when they do, the VERSION bump clears them. */
    e.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      try {
        const fresh = await fetch(req);
        await store(fresh);
        return fresh;
      } catch {
        return new Response('', { status: 504 });
      }
    })());
  }
  // Anything else third-party: left entirely alone.
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
  /* FCM's raw wire payload uses snake_case `fcm_options`; only the JS SDK
     camel-cases it to `fcmOptions`. Reading just the camel-case spelling
     meant the link was always missing and every notification tap landed
     on the fallback rather than where the message pointed. */
  const link = (p.fcm_options && p.fcm_options.link) ||
               (p.fcmOptions && p.fcmOptions.link) ||
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
