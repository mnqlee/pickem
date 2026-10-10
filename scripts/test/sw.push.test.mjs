/* Loads the real sw.js in a stubbed worker global and fires real push
   payload shapes at it. Proves a notification is actually displayed. */
import fs from 'node:fs';
const src = fs.readFileSync('/root/work/pickem/sw.js','utf8');

let pass=0, fail=0;
const ok=(n,c,x='')=>{ if(c){pass++;console.log('  ok   '+n);} else {fail++;console.log('  FAIL '+n+(x?'  -> '+x:''));} };

function run(payload){
  const handlers={}; const shown=[];
  const self={
    addEventListener:(t,f)=>{handlers[t]=f},
    skipWaiting(){}, clients:{claim(){},matchAll:async()=>[],openWindow:async()=>{}},
    registration:{ showNotification:(title,opts)=>{shown.push({title,opts}); return Promise.resolve();} },
  };
  const caches={open:async()=>({addAll:async()=>{},put:async()=>{},match:async()=>null}),
                keys:async()=>[],delete:async()=>{},match:async()=>null};
  new Function('self','caches','fetch','Response','URL', src)
    (self, caches, async()=>({clone:()=>({})}), class{}, URL);
  const waits=[];
  handlers.push({ data:{ json:()=>payload, text:()=>JSON.stringify(payload) },
                  waitUntil:p=>waits.push(p) });
  return {shown, handlers, waits};
}

console.log('\nService worker push handling');
{
  // Exactly what FCM HTTP v1 delivers for worker/live.js's push()
  const r = run({ notification:{title:'Last call, 3 games',body:'Kickoff in 25 minutes.',
                                tag:'Last call, 3 games', renotify:true},
                  fcmOptions:{link:'/index.html'} });
  ok('a push event displays a notification', r.shown.length===1, JSON.stringify(r.shown));
  ok('with the right title', r.shown[0]?.title==='Last call, 3 games');
  ok('with the body', /Kickoff in 25 minutes/.test(r.shown[0]?.opts.body||''));
  ok('and an icon so it is not a blank grey box', !!r.shown[0]?.opts.icon);
  ok('urgent alerts re-alert rather than silently replacing', r.shown[0]?.opts.renotify===true);
  ok('the click target is carried through', r.shown[0]?.opts.data.link==='/index.html');
}
{
  const r = run({ data:{ title:'Week 4 final', body:'You finished 2nd.' } });
  ok('a data-only payload still displays', r.shown.length===1 && r.shown[0].title==='Week 4 final');
}
{
  const r = run({});
  ok('an empty payload falls back to the app name rather than nothing',
     r.shown.length===1 && /Pick/.test(r.shown[0].title), JSON.stringify(r.shown));
}
{
  const handlers={}; const self={addEventListener:(t,f)=>{handlers[t]=f},skipWaiting(){},
    clients:{claim(){},matchAll:async()=>[],openWindow:async()=>{}},registration:{showNotification:async()=>{}}};
  new Function('self','caches','fetch','Response','URL',src)
    (self,{open:async()=>({}),keys:async()=>[],match:async()=>null},async()=>({}),class{},URL);
  ok('a notificationclick handler exists', typeof handlers.notificationclick==='function');
  let closed=false, opened=null;
  const ev={ notification:{close:()=>{closed=true}, data:{link:'/index.html'}}, waitUntil:p=>p };
  self.clients.openWindow = async l => { opened=l; };
  handlers.notificationclick(ev);
  ok('tapping closes the notification', closed);
}
/* ------------------------------------------------------------------ */
console.log('\nWhat the worker is allowed to cache');

function boot(fetchStub){
  const put=[]; const handlers={};
  const self={ addEventListener:(t,f)=>{handlers[t]=f}, skipWaiting(){},
    location:{origin:'https://x.com'},
    clients:{claim(){},matchAll:async()=>[],openWindow:async()=>{}},
    registration:{showNotification:async()=>{}} };
  const caches={ open:async()=>({ add:async()=>{},
      put:async(req)=>{ put.push(String(req&&req.url||req)); } }),
    keys:async()=>[], delete:async()=>{}, match:async()=>null };
  new Function('self','caches','fetch','Response','URL',src)
    (self, caches, fetchStub, class{constructor(){}}, URL);
  const hit=(url,mode='cors')=>{ let p=null;
    handlers.fetch({ request:{url,method:'GET',mode}, respondWith:x=>{p=x;} });
    return p; };
  return {put,handlers,hit};
}

{
  /* THE BUG THIS LOCKS OUT. /api/session is a GET whose path ends in
     neither .html nor .js nor a slash, so it fell through to the
     cache-first branch and was stored PERMANENTLY. Its body is a
     Firebase custom token that expires in an hour.

     Three consequences, none of them obvious from the symptom:
       - Signing out did not sign you out. The reload re-fetched
         /api/session, got the cached 200 with the OLD token, and signed
         the same person straight back in. On a shared iPad, the next
         person was signed in as the previous player.
       - Every returning player was sent back to the PIN screen every
         week, forever: the cached token was weeks old, Firebase
         rejected it, the error was swallowed, and the worker would
         never re-fetch.
       - A 401 from the first-ever visit was cached too, so automatic
         session restore was dead from day one.

     Bumping VERSION does not help, because the new worker does not
     activate until every window of the app is closed. */
  const t = boot(async () => ({ ok:true, clone:()=>({}) }));
  ok('the fetch handler exists', typeof t.handlers.fetch === 'function');
  ok('/api/session is never intercepted', t.hit('https://x.com/api/session') === null);
  ok('/api/logout is never intercepted', t.hit('https://x.com/api/logout') === null);
  ok('nor any other /api/ route', t.hit('https://x.com/api/verify-code') === null);
  ok('the page itself is still handled', t.hit('https://x.com/','navigate') !== null);
}
{
  /* A fetch() promise RESOLVES for 404 and 503 — it only rejects when
     the network itself fails. Neither branch checked, so a momentary
     404 during a Pages deploy could become the permanent answer for an
     icon, recoverable only by a VERSION bump AND a full worker swap. */
  const t = boot(async () => ({ ok:false, status:404, clone:()=>({}) }));
  await t.hit('https://x.com/icons/icon-192.png');
  ok('a 404 is never written to the cache', t.put.length === 0, t.put.join(','));
}

{
  /* A NAVIGATION ANSWERED WITH A REDIRECTED RESPONSE KILLS THE APP IN SAFARI.

     "Safari can't open the page. The error was: Response served by service
     worker has redirections." The installed app would not launch at all,
     and the only way back in was deleting the Home Screen icon.

     Cause: manifest start_url was './index.html', and Cloudflare Pages
     canonicalises /index.html to /. So every launch was a navigation whose
     fetch followed a redirect, and WebKit refuses that from a worker.
     start_url is './' now, but this asserts the WORKER never hands one
     back either — anyone still on the old install keeps requesting
     /index.html, and apex-to-www or http-to-https would do it again. */
  const body = 'hello';
  const redirected = {
    ok:true, status:200, statusText:'OK', headers:{}, redirected:true,
    clone:()=>({ ok:true, status:200 }),
    blob:async()=>body
  };
  const t = boot(async () => redirected);
  const res = await t.hit('https://x.com/index.html','navigate');
  ok('a navigation never returns a redirected response',
     res && res.redirected !== true, 'redirected=' + (res && res.redirected));
  ok('and the answer itself still comes back', !!res);

  // A non-navigation is left exactly as it was — no needless rebuilding.
  const t2 = boot(async () => redirected);
  const sub = await t2.hit('https://x.com/firebase-init.js','cors');
  ok('a sub-resource is passed through untouched', sub === redirected);
}
{
  /* './index.html' must not be precached: adding it follows the same
     redirect, and the offline fallback should be the canonical './'. */
  const shell = src.slice(src.indexOf('const SHELL'), src.indexOf('];', src.indexOf('const SHELL')));
  ok('index.html is not in the precache list', !shell.includes("'./index.html'"), shell);
  ok('the canonical root is', shell.includes("'./'"));
  ok('the offline fallback is the root, not index.html',
     src.includes("caches.match('./')") && !src.includes("caches.match('./index.html')"));
}

/* ------------------------------------------------------------------ */
/* THE MESSAGE HANDLER: two jobs, and they must not have eaten each
   other. It has taken SKIP_WAITING since the update prompt was built;
   answering VERSION is new, and the Settings card prints whatever comes
   back. A handler that replied but had stopped calling skipWaiting()
   would leave every phone with an Update button that does nothing, and
   nothing else in the suite would notice: the browser tests run against
   a stub, so this file is the only place the real worker is executed. */
console.log('\nService worker messages');
{
  const boot2 = () => {
    const handlers = {}; let skipped = 0;
    const self = { addEventListener:(t,f)=>{handlers[t]=f},
      skipWaiting(){ skipped++; },
      clients:{claim(){},matchAll:async()=>[],openWindow:async()=>{}},
      registration:{showNotification:async()=>{}} };
    new Function('self','caches','fetch','Response','URL',src)
      (self,{open:async()=>({}),keys:async()=>[],match:async()=>null,delete:async()=>{}},
       async()=>({}),class{},URL);
    return { handlers, skipped: () => skipped };
  };
  const VER = (src.match(/const VERSION = '([^']+)'/) || [])[1];
  ok('sw.js declares a version at all', !!VER, String(VER));

  {
    const t = boot2();
    ok('a message handler exists', typeof t.handlers.message === 'function');
    t.handlers.message({ data: 'SKIP_WAITING' });
    ok('SKIP_WAITING still swaps the worker in', t.skipped() === 1, String(t.skipped()));
  }
  {
    /* THE PORT ROUTE, which is what the page actually uses. */
    const t = boot2();
    const got = [];
    t.handlers.message({ data: { type: 'VERSION' },
                         ports: [{ postMessage: m => got.push(m) }] });
    ok('a VERSION ask is answered on the port it arrived on', got.length === 1,
       JSON.stringify(got));
    ok('with the version this file declares', got[0] && got[0].version === VER,
       JSON.stringify(got[0]));
    ok('and the cache name, which encodes the same number',
       !!got[0] && got[0].cache === 'poolsheet-' + VER, JSON.stringify(got[0]));
    ok('asking the version does NOT swap the worker in', t.skipped() === 0,
       String(t.skipped()));
  }
  {
    /* THE FALLBACK ROUTE: a client that posts without a MessageChannel
       still gets an answer, rather than being silently ignored. */
    const t = boot2();
    const got = [];
    t.handlers.message({ data: { type: 'VERSION' },
                         source: { postMessage: m => got.push(m) } });
    ok('a caller with no port is answered through e.source', got.length === 1,
       JSON.stringify(got));
    ok('and gets the same version', got[0] && got[0].version === VER,
       JSON.stringify(got[0]));
  }
  {
    /* Anything else must be ignored rather than throwing inside the
       worker, which would take the fetch handler down with it. */
    const t = boot2();
    let threw = null;
    try {
      t.handlers.message({ data: null });
      t.handlers.message({ data: { type: 'SOMETHING_ELSE' } });
      t.handlers.message({ data: { type: 'VERSION' } });   // no port, no source
    } catch (e) { threw = String(e); }
    ok('an unknown or malformed message is ignored quietly', threw === null, threw);
    ok('and none of it swapped the worker in', t.skipped() === 0, String(t.skipped()));
  }
}

/* ------------------------------------------------------------------ */
console.log('\nv1.43.1: a new version reaches every phone');
{
  /* A player's iPhone kept opening a v1.41 page through several full
     closes after v1.43 shipped. The new worker must take over on install,
     install fresh files from the server, and refresh pages against it. */
  const handlers={}, fetched=[], put=[]; let skipped=0;
  const self={ addEventListener:(t,f)=>{handlers[t]=f}, skipWaiting:async()=>{skipped++;},
    location:{origin:'https://x.com'}, clients:{claim(){},matchAll:async()=>[],openWindow:async()=>{}},
    registration:{showNotification:async()=>{}} };
  const cache={ add:async()=>{}, put:async(k)=>{ put.push(String(k&&k.url||k)); }, match:async()=>null };
  const caches={ open:async()=>cache, keys:async()=>[], delete:async()=>{}, match:async()=>null };
  const fetchStub=async(u,o)=>{ fetched.push({u:String(u&&u.url||u), cache:o&&o.cache}); return {ok:true,clone(){return this;}}; };
  new Function('self','caches','fetch','Response','URL',src)(self,caches,fetchStub,class{constructor(){}},URL);
  const waits=[]; handlers.install({ waitUntil:p=>waits.push(p) }); await Promise.all(waits);
  ok('a new version takes over as soon as it installs', skipped===1, String(skipped));
  const shellFetch=fetched.filter(f=>/\.\/|\.js|\.json|\.png/.test(f.u));
  ok('and installs every file fresh from the server, never the phone\'s old copy',
     shellFetch.length>=5 && shellFetch.every(f=>f.cache==='reload'), JSON.stringify(shellFetch.slice(0,3)));
  ok('the app page itself is among them', put.includes('./'), JSON.stringify(put));
  fetched.length=0;
  let p=null; handlers.fetch({ request:{url:'https://x.com/',method:'GET',mode:'navigate'}, respondWith:x=>{p=x;}, waitUntil:()=>{} });
  await p; await new Promise(r=>setTimeout(r,10));
  ok('opening the app checks the server for a newer page, never a stale browser copy',
     fetched.length>0 && fetched.every(f=>f.cache==='no-cache'), JSON.stringify(fetched));
  const v=(src.match(/const VERSION = '([^']+)'/)||[])[1];
  const page=fs.readFileSync(new URL('../../index.html', import.meta.url).pathname,'utf8');
  const pv=(page.match(/<meta name="app-version" content="([^"]+)">/)||[])[1];
  ok('the page carries the same version as sw.js, so they cannot drift apart', !!v && v===pv, `${pv} vs ${v}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
