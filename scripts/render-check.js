const fs=require('fs');
const html=fs.readFileSync('index.html','utf8');
const js=html.split('<script>')[1].split('</script>')[0];
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
