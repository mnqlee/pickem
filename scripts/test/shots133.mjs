/* Screenshots of the REAL app, not a mockup — served by app-serve.mjs
   with a plan that puts each new state on screen. */
import { chromium } from 'playwright';
const BASE='http://127.0.0.1:8098';
const b=await chromium.launch();
const out=[];
async function shot(name, plan, act){
  const ctx=await b.newContext({viewport:{width:390,height:900},deviceScaleFactor:2});
  const p=await ctx.newPage();
  await p.route('**/*',r=>r.request().url().startsWith(BASE)?r.continue():r.abort());
  await p.request.post(BASE+'/__plan',{data:plan});
  await p.goto(BASE+'/',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(1400);
  if(act) await act(p);
  await p.screenshot({path:`/tmp/shot-${name}.png`, fullPage:false});
  out.push(name);
  await ctx.close();
}
const past = new Date(Date.now()-12*24*3600*1000).toISOString();
const live = new Date(Date.now()-60*60*1000).toISOString();

// 1. Grid after Monday night, with the tiebreaker column
await shot('grid', {startISO:past, weeks:2, gamesPerWeek:16, playerCount:28,
                    tbTotals:[36,36,60,31,32,33,50,28,55,34]}, async p=>{
  await p.click('.wk[data-wk="1"]'); await p.waitForTimeout(600);
  await p.click('[data-tab="grid"]'); await p.waitForTimeout(900);
  await p.evaluate(()=>{const g=document.querySelector('.gridscroll'); if(g)g.scrollLeft=g.scrollWidth;});
  await p.waitForTimeout(400);
});

// 2. This Week standings with the winner/runner-up banners
await shot('week', {startISO:past, weeks:2, gamesPerWeek:16, playerCount:28}, async p=>{
  await p.click('.wk[data-wk="1"]'); await p.waitForTimeout(600);
  await p.click('[data-tab="standings"]'); await p.waitForTimeout(700);
  await p.click('[data-stand="week"]'); await p.waitForTimeout(700);
});

// 3. A live card: clock top-left, IN PROGRESS right, true colours
await shot('live', {startISO:live, weeks:2, gamesPerWeek:16, playerCount:10,
                    espnDetail:'3rd 5:42'}, async p=>{ await p.waitForTimeout(1400); });

// 4. Final cards: colour follows the winner, badges keep their colour
await shot('final', {startISO:past, weeks:2, gamesPerWeek:16, playerCount:10}, async p=>{
  await p.click('.wk[data-wk="1"]'); await p.waitForTimeout(900);
});
await b.close();
console.log(out.join(' '));
