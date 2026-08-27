const fs=require('fs');
const html=fs.readFileSync('index.html','utf8');
const js=html.split('<script>')[1].split('</script>')[0];

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
global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};
global.navigator={userAgent:'iPhone',standalone:false,serviceWorker:undefined};
global.matchMedia=()=>({matches:false});
global.setInterval=()=>0; global.setTimeout=(f)=>0;
global.Notification=undefined;
global.confirm=()=>true; global.alert=()=>{};
global.fetch=async()=>({ok:false});
global.location={reload(){},search:''};

try{ new Function(js)(); console.log('RAN CLEAN — no runtime error'); }
catch(e){ console.log('ERROR:', e.constructor.name, '|', e.message);
  const st=(e.stack||'').split('\n').slice(0,4).join('\n'); console.log(st); }
