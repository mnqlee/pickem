/* Whole-app polish audit: the things that make an app feel finished. */
import { chromium } from 'playwright';
const BASE = 'http://127.0.0.1:8098';
const browser = await chromium.launch();
let pass = 0, fail = 0; const fails = [];
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n); }
  else { fail++; fails.push(n + (x ? ' -> ' + x : '')); console.log('  FAIL ' + n + (x ? '  -> ' + x : '')); } };

const MID = { startISO: new Date(Date.now() - 40*24*3600*1000).toISOString() };

async function open(plan = MID, vp = { width: 390, height: 844 }) {
  const ctx = await browser.newContext({ viewport: vp });
  const page = await ctx.newPage();
  await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error'
    && !/ERR_FAILED|Failed to load resource|boot failed|stub failure/.test(m.text()))
    errs.push('console: ' + m.text()); });
  await page.request.post(BASE + '/__plan', { data: plan });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  return { ctx, page, errs };
}
const TABS = ['picks','grid','standings','help','settings'];
const go = async (page,t) => { await page.click(`.tab[data-tab="${t}"]`); await page.waitForTimeout(300); };

console.log('\n1. Nothing leaks placeholder junk into the UI');
{
  const { ctx, page } = await open();
  const bad = {};
  for (const t of TABS) {
    await go(page, t);
    const txt = await page.evaluate(() => document.body.innerText);
    const hits = ['undefined','NaN','[object Object]','null'].filter(w =>
      new RegExp('(^|[^A-Za-z])' + w.replace(/[[\]]/g,'\\$&') + '([^A-Za-z]|$)').test(txt));
    if (hits.length) bad[t] = hits;
  }
  ok('no undefined / NaN / [object Object] on any tab',
     Object.keys(bad).length === 0, JSON.stringify(bad));
  await ctx.close();
}

console.log('\n2. Season standings use the scored totals, not one week');
{
  const { ctx, page } = await open();
  await go(page, 'standings');
  const st = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#board .row')];
    return { n: rows.length,
      pts: rows.map(r => +r.querySelector('.pts b').textContent),
      subs: rows.map(r => r.querySelector('.who .mono')?.textContent || ''),
      weekByWeek: document.querySelectorAll('.wbw-r').length };
  });
  ok('every player is listed', st.n === 8, String(st.n));
  ok('totals are real season numbers, not zero', st.pts.every(p => p > 0), JSON.stringify(st.pts));
  ok('table is sorted high to low', st.pts.every((p,i) => i === 0 || st.pts[i-1] >= p));
  ok('"x of y correct" is populated', st.subs.every(s => /\d+ of \d+ correct/.test(s)), st.subs[0]);
  ok('week-by-week has a row per scored week', st.weekByWeek >= 5, String(st.weekByWeek));
  await ctx.close();
}

console.log('\n3. One unknown team abbreviation does not blank the app');
{
  const { ctx, page, errs } = await open({ ...MID, badTeam: true });
  await go(page, 'picks');
  const s = await page.evaluate(() => ({
    cards: document.querySelectorAll('#slate .card').length,
    showsCode: document.body.innerText.includes('ZZZ'),
    grid: (document.getElementById('gridBody')||{}).innerHTML?.length || 0,
  }));
  ok('the whole slate still renders around the unknown team', s.cards >= 15, JSON.stringify(s));
  ok('the unknown code is shown rather than swallowed', s.showsCode, JSON.stringify(s));
  ok('no page errors', errs.length === 0, errs[0]);
  await go(page, 'standings');
  const board = await page.evaluate(() => document.querySelectorAll('#board .row').length);
  ok('and the other tabs still work', board === 8, String(board));
  await ctx.close();
}

console.log('\n4. Loading and failure are both visible');
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  await page.request.post(BASE + '/__plan', { data: { ...MID, delay: { getAllWeeks: 1400 } } });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  const mid = await page.evaluate(() => {
    const b = document.getElementById('boot');
    return { shown: b && !b.classList.contains('hide'),
             msg: document.getElementById('bootMsg')?.textContent || '' };
  });
  ok('a branded loading state covers the boot reads', mid.shown, JSON.stringify(mid));
  ok('and it says what is happening', /getting your week/i.test(mid.msg), mid.msg);
  await page.waitForTimeout(2000);
  const done = await page.evaluate(() => ({
    hidden: document.getElementById('boot').classList.contains('hide'),
    cards: document.querySelectorAll('#slate .card').length }));
  ok('it clears once the app is drawn', done.hidden && done.cards > 0, JSON.stringify(done));
  await ctx.close();
}
{
  const { ctx, page } = await open({ ...MID, fail: { getAllWeeks: true } });
  await page.waitForTimeout(600);
  const s = await page.evaluate(() => ({
    shown: !document.getElementById('boot').classList.contains('hide'),
    msg: document.getElementById('bootMsg').textContent,
    retry: !document.getElementById('bootRetry').classList.contains('hide') }));
  ok('a failed load shows a message instead of a blank shell', s.shown, JSON.stringify(s));
  ok('the message is plain English', /couldn't load your week/i.test(s.msg), s.msg);
  ok('and offers a way out', s.retry);
  await ctx.close();
}

console.log('\n5. The pick sheet stays out of the way until asked for');
{
  const { ctx, page } = await open();
  await go(page, 'standings');
  const s = await page.evaluate(() => {
    const el = document.querySelector('.sheet, #sheet, [id*="sheet" i]');
    if (!el) return { missing: true };
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    return { id: el.id, top: Math.round(r.top), vh: innerHeight,
             visible: r.top < innerHeight && r.bottom > 0 && cs.visibility !== 'hidden'
                      && cs.display !== 'none' && +cs.opacity > 0 };
  });
  ok('the rank sheet is off-screen on other tabs', s.missing || !s.visible, JSON.stringify(s));
  await ctx.close();
}

console.log('\n6. Layout holds at every width people actually use');
for (const [w,h,label] of [[320,568,'iPhone SE'],[360,740,'small Android'],
                           [390,844,'iPhone 15'],[430,932,'Pro Max'],
                           [768,1024,'iPad'],[1280,900,'desktop']]) {
  const { ctx, page } = await open(MID, { width: w, height: h });
  const r = { };
  for (const t of TABS) {
    await go(page, t);
    const o = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      wide: [...document.querySelectorAll('body *')].filter(e => {
        const b = e.getBoundingClientRect();
        return b.width > 0 && b.right > document.documentElement.clientWidth + 1;
      }).slice(0,3).map(e => (e.id || e.className || e.tagName).toString().slice(0,40)),
    }));
    if (o.overflow > 0) r[t] = o;
  }
  ok(`no sideways scroll at ${w}px (${label})`, Object.keys(r).length === 0, JSON.stringify(r));
  await ctx.close();
}

console.log('\n7. Controls are big enough to hit');
{
  const { ctx, page } = await open(MID, { width: 320, height: 568 });
  const small = {};
  for (const t of TABS) {
    await go(page, t);
    const s = await page.evaluate(() => [...document.querySelectorAll(
      'button, .tab, .wk, input, select, [role="button"]')]
      .filter(e => { const b = e.getBoundingClientRect();
        return b.width > 0 && b.height > 0 && b.height < 36; })
      .slice(0,5).map(e => (e.id || e.className || e.tagName) + ':' + Math.round(e.getBoundingClientRect().height)));
    if (s.length) small[t] = s;
  }
  ok('no control under 36px tall', Object.keys(small).length === 0, JSON.stringify(small));
  await ctx.close();
}

console.log('\n8. The current week is reachable late in the season');
{
  const { ctx, page } = await open({ ...MID, startISO: new Date(Date.now() - 100*24*3600*1000).toISOString() });
  const s = await page.evaluate(() => {
    const strip = document.getElementById('weeks');
    const on = strip.querySelector('.wk.on');
    if (!on) return { noActive: true };
    const sr = strip.getBoundingClientRect(), br = on.getBoundingClientRect();
    return { week: on.textContent.trim().split('\\n')[0],
             inView: br.left >= sr.left - 1 && br.right <= sr.right + 1,
             scrollLeft: strip.scrollLeft };
  });
  ok('the active week is scrolled into view, not hidden off the strip',
     s.noActive || s.inView, JSON.stringify(s));
  await ctx.close();
}

console.log('\n9. Empty states, not empty screens');
{
  const { ctx, page } = await open({ ...MID, noPicks: true, myPickCount: 0 });
  await go(page, 'picks');
  const t = await page.evaluate(() => document.body.innerText.length);
  ok('picks tab still renders with no picks made', t > 200, String(t));
  await ctx.close();
}
{
  const { ctx, page, errs } = await open({ ...MID, members: ['Lee'] });
  await go(page, 'standings');
  const n = await page.evaluate(() => document.querySelectorAll('#board .row').length);
  ok('a one-person pool renders', n === 1, String(n));
  ok('with no errors', errs.length === 0, errs[0]);
  await ctx.close();
}
{
  const { ctx, page, errs } = await open({ ...MID, gamesPerWeek: 1 });
  const txt = await page.evaluate(() => document.body.innerText);
  ok('a one-game week says "1 game", not "1 games"',
     !/·\s*1 games/.test(txt) , (txt.match(/·[^\n]*game[s]?/)||[''])[0]);
  ok('and does not error', errs.length === 0, errs[0]);
  await ctx.close();
}

console.log('\n10. Moving around the app is clean');
{
  const { ctx, page, errs } = await open();
  for (let i = 0; i < 2; i++) for (const t of TABS) await go(page, t);
  // hop across weeks too
  for (const w of [3,5,2,7]) {
    const sel = `.wk[data-wk="${w}"]`;
    if (await page.$(sel)) { await page.click(sel); await page.waitForTimeout(250); }
  }
  ok('no errors after cycling every tab twice and switching weeks', errs.length === 0,
     JSON.stringify(errs.slice(0,3)));
  await ctx.close();
}

console.log('\n11. One failing secondary read does not take down the app');
for (const call of ['getStandings','getMembers','getScoringMode','getRevealed','getTiebreaks','getArchive','myPicks']) {
  const { ctx, page } = await open({ ...MID, fail: { [call]: true } });
  await page.waitForTimeout(400);
  const s = await page.evaluate(() => ({
    booted: document.getElementById('boot').classList.contains('hide'),
    cards: document.querySelectorAll('#slate .card').length }));
  ok(`app still loads when ${call} fails`, s.booted && s.cards > 0, JSON.stringify(s));
  await ctx.close();
}
{
  // The schedule is the one read the app cannot do without.
  const { ctx, page } = await open({ ...MID, fail: { getAllWeeks: true } });
  await page.waitForTimeout(500);
  const s = await page.evaluate(() => ({
    shown: !document.getElementById('boot').classList.contains('hide'),
    why: document.getElementById('bootWhy').textContent }));
  ok('a failed schedule read still shows the error screen', s.shown, JSON.stringify(s));
  ok('and names the real reason for whoever has to fix it', s.why.length > 0, s.why);
  await ctx.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fails.length) { console.log('\nFAILURES:'); fails.forEach(f => console.log('  - ' + f)); }
await browser.close();
process.exit(fail ? 1 : 0);
