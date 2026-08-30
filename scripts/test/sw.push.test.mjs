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
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
