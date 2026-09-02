const fs=require('fs');
const html=fs.readFileSync('index.html','utf8');
// The app's inline script is tagged <script type="module">, not bare
// <script>, so a literal split('<script>') finds nothing and this whole
// file used to crash before ever running a single check. Match any
// <script ...>...</script> block and take the one with no src= (the
// inline app code, not the firebase-init.js <script src> include).
const blocks=[...html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)];
const inline=blocks.find(m=>!/\bsrc=/.test(m[1]||'') && m[2].trim());
if(!inline){ console.error('No inline <script> block found in index.html'); process.exit(1); }
const js=inline[2];

const mk=()=>({innerHTML:'',textContent:'',value:'',style:{},dataset:{},
  classList:{add(){},remove(){},toggle(){},contains(){return false}},
  addEventListener(){},appendChild(){},remove(){},focus(){},
  scrollIntoView(){},closest(){return null},getAttribute(){return null},
  setAttribute(){},querySelector(){return mk()},querySelectorAll(){return []}});
const doc={querySelector:()=>mk(),querySelectorAll:()=>[],
  createElement:()=>mk(),addEventListener(){},body:mk(),
  getElementById:()=>mk(),documentElement:mk()};
global.document=doc;
global.window={matchMedia:()=>({matches:false}),scrollTo(){},
  addEventListener(){},location:{search:''},navigator:{}};
/* In a browser, a bare `addEventListener(...)` at top level IS
   window.addEventListener — the global object is the window. Under Node
   it is an undefined identifier, and the app has several. Stubbing only
   window.addEventListener meant execution stopped at the first bare one
   with a ReferenceError, which this harness then printed and EXITED 0
   over: everything after that line — boot(), the whole data layer, the
   onboarding — was never exercised, while README.md points here as the
   way to catch a blank screen. */
global.addEventListener=()=>{};
global.removeEventListener=()=>{};
global.innerWidth=390; global.innerHeight=844;
global.requestAnimationFrame=(f)=>{ return 0; };
global.queueMicrotask=()=>{};
global.Intl=Intl;
global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};
global.navigator={userAgent:'iPhone',standalone:false,serviceWorker:undefined};
global.matchMedia=()=>({matches:false});
global.setInterval=()=>0; global.setTimeout=(f)=>0;
global.Notification=undefined;
global.confirm=()=>true; global.alert=()=>{};
global.fetch=async()=>({ok:false});
global.location={reload(){},search:''};
// The inline script is a module-scope closure over the bare identifier
// PS, set at runtime by firebase-init.js (window.PS = ...) — a separate
// file this harness never loads. Without a stub, boot()'s very first
// line (PS.watchAuth(...)) throws "PS is not defined" before a single
// real code path runs. watchAuth firing once with no user is exactly
// what a real signed-out visitor's first callback looks like, so it
// walks boot() into the real showOnboarding() path instead of masking
// it; everything else is a harmless async no-op since this lightweight
// harness — unlike scripts/test/app-serve.mjs — isn't simulating
// Firestore data, only catching syntax/boot-time errors.
global.PS=new Proxy({user:null,SEASON:'2026'},{get(t,p){
  if(p in t)return t[p];
  if(typeof p!=='string')return undefined;
  if(p.startsWith('watch'))return(cb)=>{cb(p==='watchAuth'?null:[]);return()=>{};};
  return async()=>({});
}});

/* EXIT NON-ZERO ON FAILURE.

   This used to print the error and exit 0, so it could never gate
   anything: check.sh, a git hook, or CI would all see success. A smoke
   test that cannot fail is a smoke test that does not exist. */
try{ new Function(js)(); console.log('RAN CLEAN — no runtime error'); }
catch(e){
  console.log('ERROR:', e.constructor.name, '|', e.message);
  const st=(e.stack||'').split('\n').slice(0,4).join('\n'); console.log(st);
  process.exit(1);
}
