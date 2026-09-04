import { chromium } from 'playwright';
const B='http://127.0.0.1:8098';
const browser=await chromium.launch();
const run = async (label) => {
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2});
  const page=await ctx.newPage();
  await page.route('**/*',r=>r.request().url().startsWith(B)?r.continue():r.abort());
  const errs=[]; page.on('pageerror',e=>errs.push(String(e)));
  await page.request.post(B+'/__plan',{data:{signedOut:true, noPool:true, delay:{joinPool:2500}}});
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(1100);
  await page.fill('#obNameIn','Lee').catch(()=>{});
  await page.fill('#obMailIn','lee@example.com').catch(()=>{});
  await page.waitForTimeout(150);
  await page.click('#obGo').catch(()=>{});
  await page.waitForTimeout(700);
  for(let i=0;i<6;i++){ await page.fill(`#pin${i}`,String(i+1)).catch(()=>{}); await page.waitForTimeout(50); }
  await page.waitForTimeout(120);
  await page.click('#obGo').catch(()=>{});
  await page.waitForTimeout(1000);   // squarely inside the race window
  const digits = await page.evaluate(()=>[...Array(6)].map((_,i)=>(document.getElementById('pin'+i)||{}).value||'').join(''));
  const btn = await page.locator('#obGo').innerText().catch(()=>'?');
  const head = (await page.locator('#obBody').innerText().catch(()=>'')).split('\n')[1]||'';
  console.log(`${label}  digits=${JSON.stringify(digits)}  button=${JSON.stringify(btn)}  screen=${JSON.stringify(head)}`);
  await page.screenshot({path:`/tmp/pin_${label}.png`});
  await ctx.close();
  return {digits, btn};
};
await run('now');
await browser.close();
