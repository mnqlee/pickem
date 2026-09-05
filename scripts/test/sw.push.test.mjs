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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
