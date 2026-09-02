const fs=require('fs');
const html=fs.readFileSync('index.html','utf8');
// See smoke-test.js: the app's inline script is <script type="module">, so
// a literal split('<script>') matches nothing and this crashed before it
// ever rendered anything. Pull whichever <script>...</script> block has no
// src= — that's the inline app code, not the firebase-init.js include.
const blocks=[...html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)];
const inline=blocks.find(m=>!/\bsrc=/.test(m[1]||'') && m[2].trim());
if(!inline){ console.error('No inline <script> block found in index.html'); process.exit(1); }
const js=inline[2];
const out={};
const mk=(id)=>({set innerHTML(v){if(id)out[id]=v},get innerHTML(){return out[id]||''},
  textContent:'',value:'',style:{},dataset:{},
  classList:{add(){},remove(){},toggle(){},contains:()=>false},
  addEventListener(){},appendChild(){},remove(){},focus(){},scrollIntoView(){},
  closest:()=>null,setAttribute(){},querySelector:()=>mk(),querySelectorAll:()=>[]});
global.document={querySelector:(s)=>mk(s.replace('#','')),querySelectorAll:()=>[],
  createElement:()=>mk(),addEventListener(){},body:mk(),getElementById:()=>mk()};
global.window={matchMedia:()=>({matches:false}),scrollTo(){},addEventListener(){},
  location:{search:''},navigator:{}};
global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};
global.navigator={userAgent:'iPhone',standalone:false};
global.matchMedia=()=>({matches:false});
global.setInterval=()=>0; global.setTimeout=()=>0;
global.fetch=async()=>({ok:false}); global.location={reload(){},search:''};
// See smoke-test.js's comment: PS is set at runtime by firebase-init.js,
// a file this harness never loads, so boot() throws "PS is not defined"
// on its first line without a stub.
//
// NOTE: with DEMO=false (the shipped setting — see index.html's own
// comment "false once Firebase is wired up"), boot() takes the signed-out
// branch and shows onboarding rather than calling render(), so every
// count below reads zero. That is correct given no real user or
// Firestore data exists here, not a bug in this script: render-check
// only produces real numbers when index.html has DEMO=true, which is
// what it was written against. Flip DEMO to true locally to sanity-check
// layout changes, then back to false before deploying.
global.PS=new Proxy({user:null,SEASON:'2026'},{get(t,p){
  if(p in t)return t[p];
  if(typeof p!=='string')return undefined;
  if(p.startsWith('watch'))return(cb)=>{cb(p==='watchAuth'?null:[]);return()=>{};};
  return async()=>({});
}});
new Function(js)();

const slate=out['slate']||'';
console.log('cards rendered      :', (slate.match(/class="card/g)||[]).length);
console.log('live scores shown   :', (slate.match(/class="scr mono"/g)||[]).length);
console.log('consensus bars      :', (slate.match(/class="cbar"/g)||[]).length);
console.log('lock bands          :', (slate.match(/class="lockband"/g)||[]).length);
const m=slate.match(/<div class="scr mono">(\d+)<\/div>/g);
console.log('sample score values :', m?m.slice(0,4).map(x=>x.replace(/\D/g,'')).join(', '):'NONE');
const board=out['board']||'';
console.log('standings rows      :', (board.match(/class="row/g)||[]).length);
const grid=out['gridBody']||'';
console.log('pool consensus row  :', grid.includes('poolrow')?'present':'MISSING');
