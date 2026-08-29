import { chromium } from 'playwright';
const BASE='http://127.0.0.1:8099';
let pass=0,fail=0;
const ok=(n,c,x='')=>{ if(c){pass++;console.log('  ok   '+n);} else {fail++;console.log('  FAIL '+n+(x?'  -> '+x:''));} };
const browser=await chromium.launch();

async function signIn(path){
  const ctx=await browser.newContext({viewport:{width:390,height:844}});
  const page=await ctx.newPage();
  await page.route('**/*',r=>r.request().url().startsWith(BASE)?r.continue():r.abort());
  await page.request.post(BASE+'/__plan',{data:{
    session:{status:401,body:{}}, 'verify-code':{body:{token:'t',uid:'u'}} }});
  await page.goto(BASE+path,{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#obNameIn');
  await page.fill('#obNameIn','Lee'); await page.fill('#obMailIn','lee@example.com');
  await page.click('#obGo'); await page.waitForSelector('#pin0');
  for(let i=0;i<6;i++) await page.fill('#pin'+i,'123456'[i]);
  await page.waitForTimeout(800);
  const joined=await page.evaluate(()=>
    (window.__ps.log.find(l=>l.fn==='joinPool')||{}).args?.[0]);
  const url=page.url();
  await ctx.close();
  return {joined,url};
}

console.log('\nInvite links');
{
  const r=await signIn('/');
  ok('the bare domain joins the pool with no code in the link',
     r.joined==='REG26X', 'joinPool got '+r.joined);
  ok('and the URL stays clean', !r.url.includes('?'), r.url);
}
{
  const r=await signIn('/?join=REG26X');
  ok('an explicit ?join= link still works', r.joined==='REG26X', String(r.joined));
  ok('and the ?join= is cleared from the address bar afterwards',
     !r.url.includes('join='), r.url);
}
{
  const r=await signIn('/?join=OTHER1');
  ok('a different code still overrides the default (second pool still possible)',
     r.joined==='OTHER1', String(r.joined));
}
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close(); process.exit(fail?1:0);
