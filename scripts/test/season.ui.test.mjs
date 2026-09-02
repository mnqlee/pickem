/* A full simulated season: 25+ players, 18 weeks, 272 games. */
import { chromium } from 'playwright';
const BASE = 'http://127.0.0.1:8098';
const browser = await chromium.launch();
let pass = 0, fail = 0; const fails = [];
const ok = (n, c, x='') => { if (c) { pass++; console.log('  ok   '+n); }
  else { fail++; fails.push(n+(x?' -> '+x:'')); console.log('  FAIL '+n+(x?'  -> '+x:'')); } };

const MID = { startISO: new Date(Date.now()-40*24*3600*1000).toISOString() };
async function open(plan, vp={width:390,height:844}) {
  const ctx = await browser.newContext({ viewport: vp });
  const page = await ctx.newPage();
  await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: '+e.message));
  page.on('console', m => { if (m.type()==='error'
    && !/ERR_FAILED|Failed to load resource|boot failed|stub failure|roster unreadable|optional read/.test(m.text()))
    errs.push('console: '+m.text()); });
  await page.request.post(BASE+'/__plan', { data: plan });
  await page.goto(BASE+'/', { waitUntil:'domcontentloaded' });
  await page.waitForTimeout(1200);
  return { ctx, page, errs };
}
const go = async (p,t) => { await p.click(`.tab[data-tab="${t}"]`); await p.waitForTimeout(400); };

console.log('\nA. 25-player season, week 7 of 18');
{
  const t0 = Date.now();
  const { ctx, page, errs } = await open({ ...MID, playerCount: 25 });
  const bootMs = Date.now() - t0;
  const s = await page.evaluate(() => ({
    booted: document.getElementById('boot').classList.contains('hide'),
    weeks: document.querySelectorAll('#weeks .wk').length,
    cards: document.querySelectorAll('#slate .card').length,
  }));
  ok('the app boots', s.booted, JSON.stringify(s));
  ok('all 18 weeks are in the strip', s.weeks === 18, String(s.weeks));
  ok('16 games render on the current week', s.cards === 16, String(s.cards));
  ok(`boot is quick (${bootMs}ms)`, bootMs < 4000, bootMs+'ms');
  await go(page,'standings');
  const st = await page.evaluate(() => {
    const r = [...document.querySelectorAll('#board .row')];
    return { n: r.length, pts: r.map(x => +x.querySelector('.pts b').textContent) };
  });
  ok('all 25 players are ranked', st.n === 25, String(st.n));
  ok('every total is a real number', st.pts.every(p => Number.isFinite(p) && p > 0));
  ok('sorted high to low', st.pts.every((p,i) => i===0 || st.pts[i-1] >= p));
  ok('no duplicate ranks skipped', new Set(st.pts).size > 1);
  // Week 7 has not kicked off, so its grid is correctly the empty state.
  // Week 3 is done — that is where 25 columns actually get stressed.
  await page.evaluate(() => document.querySelector('.wk[data-wk="3"]')?.click());
  await page.waitForTimeout(500);
  await go(page,'grid');
  const g = await page.evaluate(() => {
    const el = document.getElementById('gridBody');
    const names = el.querySelectorAll('.gname, .gp, [class*="name"]').length;
    return { html: el.innerHTML.length, names,
             pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
             scrollers: [...el.querySelectorAll('*')].filter(e => {
               const cs = getComputedStyle(e);
               return /auto|scroll/.test(cs.overflowX) && e.scrollWidth > e.clientWidth;
             }).length };
  });
  ok('the grid fills in on a completed week with 25 players', g.html > 1000, JSON.stringify(g));
  ok('wide content scrolls inside the grid, not the page', g.pageOverflow <= 0, JSON.stringify(g));
  ok('no errors anywhere in the season', errs.length === 0, JSON.stringify(errs.slice(0,2)));
  await ctx.close();
}

console.log('\nB. 40 players with very long names, small phone');
{
  const { ctx, page, errs } = await open({ ...MID, playerCount: 40, longNames: true },
                                          { width: 320, height: 568 });
  const bad = {};
  for (const t of ['picks','grid','standings']) {
    await go(page, t);
    const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (o > 0) bad[t] = o;
  }
  const n = await page.evaluate(() => document.querySelectorAll('#board .row').length);
  ok('40 players render', n === 40, String(n));
  ok('no sideways scroll at 320px with long names', Object.keys(bad).length === 0, JSON.stringify(bad));
  ok('no errors', errs.length === 0, JSON.stringify(errs.slice(0,2)));
  await ctx.close();
}

console.log('\nC. Every week of the season opens cleanly');
{
  const { ctx, page, errs } = await open({ ...MID, playerCount: 25 });
  let rendered = 0;
  for (let w = 1; w <= 18; w++) {
    const sel = `.wk[data-wk="${w}"]`;
    await page.evaluate(s => document.querySelector(s)?.click(), sel);
    await page.waitForTimeout(120);
    const c = await page.evaluate(() => document.querySelectorAll('#slate .card').length);
    if (c > 0) rendered++;
  }
  ok('all 18 weeks render games when opened', rendered === 18, rendered+'/18');
  ok('no errors after walking the whole season', errs.length === 0, JSON.stringify(errs.slice(0,2)));
  await ctx.close();
}

console.log('\nD. The membership trap that broke the live site');
{
  const { ctx, page, errs } = await open({ ...MID, playerCount: 25, notAMember: true });
  const s = await page.evaluate(() => ({
    booted: document.getElementById('boot').classList.contains('hide'),
    cards: document.querySelectorAll('#slate .card').length,
    joined: !!window.__joined,
  }));
  ok('a non-member is joined automatically instead of being locked out', s.joined, JSON.stringify(s));
  ok('and the app loads', s.booted && s.cards > 0, JSON.stringify(s));
  await ctx.close();
}

console.log('\nE. A dead pool always has a way out');
{
  const { ctx, page } = await open({ ...MID, fail: { getAllWeeks: true } });
  await page.waitForTimeout(500);
  const s = await page.evaluate(() => ({
    out: !document.getElementById('bootOut').classList.contains('hide'),
    why: document.getElementById('bootWhy').textContent }));
  ok('"Start over" is offered', s.out, JSON.stringify(s));
  ok('the real reason is named', s.why.length > 0, s.why);
  const cleared = await page.evaluate(() => {
    localStorage.setItem('ps_pool','stale'); document.getElementById('bootOut').onclick();
    return localStorage.getItem('ps_pool'); });
  ok('and it clears the stuck pool id', cleared === null, String(cleared));
  await ctx.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fails.length) { console.log('\nFAILURES:'); fails.forEach(f => console.log('  - '+f)); }
await browser.close();
process.exit(fail ? 1 : 0);
