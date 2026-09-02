/* Fifty players, every week of the season, on a phone.

   The rest of the UI suite runs 8 players on one week, which is the shape
   of a family pool on a Tuesday. This one is the shape of the thing the
   app is being shipped as: a full league, long names, eighteen weeks of
   history, walked end to end while watching for the four ways a page of
   this kind falls apart —

     1. a thrown error that kills the render chain mid-week,
     2. horizontal overflow, which on a phone means the whole page slides
        under your thumb and the tab bar drifts off the edge,
     3. a table that cannot actually be read at 50 rows,
     4. render time that turns a week change into a visible stall.

   Run:  node app-serve.mjs &   then   node scale.ui.test.mjs
*/
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:8098';
let pass = 0, fail = 0; const fails = [];
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n); }
  else { fail++; fails.push(n + (x ? ' -> ' + x : '')); console.log('  FAIL ' + n + (x ? '  -> ' + x : '')); } };

const browser = await chromium.launch();

async function open(plan = {}, width = 390) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 } });
  const page = await ctx.newPage();
  await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.request.post(BASE + '/__plan', { data: plan });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  return { ctx, page, errors };
}

const overflow = page => page.evaluate(() => {
  const d = document.documentElement;
  const wide = [...document.querySelectorAll('body *')]
    .filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1);
    })
    // Anything inside a deliberately scrollable strip is fine — that is
    // what an overflow-x container is for.
    .filter(el => !el.closest('#weeks, .gridscroll, .tabs, [data-scroll]'))
    .map(el => el.tagName.toLowerCase() + '.' + (el.className || '').toString().split(' ')[0]);
  return { doc: d.scrollWidth - d.clientWidth, wide: [...new Set(wide)].slice(0, 5) };
});

/* ------------------------------------------------------------------ */
console.log('\n1. A 50-player pool, week by week, start to finish');
{
  const { ctx, page, errors } = await open({ playerCount: 50, weeks: 18 });
  const slow = [], over = [], empty = [];

  for (let w = 1; w <= 18; w++) {
    const t0 = Date.now();
    const btn = page.locator(`#weeks .wk[data-wk="${w}"]`);
    if (!(await btn.count())) { empty.push('wk' + w + ' missing from strip'); continue; }
    await btn.click({ force: true });
    await page.waitForTimeout(220);
    const ms = Date.now() - t0;
    if (ms > 2500) slow.push(`wk${w} ${ms}ms`);

    const cards = await page.locator('#slate .card').count();
    if (cards === 0) empty.push('wk' + w + ' rendered no games');

    const o = await overflow(page);
    if (o.doc > 0 || o.wide.length) over.push(`wk${w}: doc+${o.doc} ${o.wide.join(',')}`);
  }

  ok('every one of the 18 weeks renders its slate', empty.length === 0, empty.slice(0, 3).join('; '));
  ok('no week overflows the viewport sideways', over.length === 0, over.slice(0, 3).join(' | '));
  ok('no week takes more than 2.5s to switch to', slow.length === 0, slow.slice(0, 3).join(', '));
  ok('walking the whole season throws nothing', errors.length === 0, errors[0] || '');
  await ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n2. The Grid and Standings at 50 rows');
{
  const past = new Date(Date.now() - 60 * 864e5).toISOString();
  const { ctx, page, errors } = await open({ playerCount: 50, weeks: 18, startISO: past });

  await page.click('[data-tab="standings"]').catch(() => {});
  await page.waitForTimeout(600);
  const rows = await page.locator('#board .row').count();
  ok('standings lists all 50 players', rows === 50, String(rows));

  const o1 = await overflow(page);
  ok('standings does not push the page sideways', o1.doc === 0 && !o1.wide.length,
     JSON.stringify(o1));

  await page.click('[data-tab="grid"]').catch(() => {});
  await page.waitForTimeout(700);
  const gridRows = await page.locator('#gridBody table.pool tbody tr').count();
  ok('the grid has a row per player', gridRows >= 50, String(gridRows));

  // The grid is meant to scroll inside its own box, not drag the page.
  const o2 = await overflow(page);
  ok('the grid scrolls inside itself, not the page', o2.doc === 0, JSON.stringify(o2));

  const sticky = await page.evaluate(() => {
    const th = document.querySelector('#gridBody thead th');
    return th ? getComputedStyle(th).position : null;
  });
  ok('the grid header declares itself sticky', sticky === 'sticky', String(sticky));

  /* Declaring position:sticky is not the same as sticking. A sticky
     header only holds against the scroll container it lives in — so if
     the table sits in a box with no height limit, the PAGE scrolls, the
     whole box leaves with it, and the header is gone by row 12. With 50
     players that is 2,300px of team codes with no column labels. */
  const stuck = await page.evaluate(async () => {
    const wrap = document.querySelector('#gridBody .gridscroll');
    const th = document.querySelector('#gridBody thead th.pl');
    if (!wrap || !th) return 'no grid';
    const target = wrap.getBoundingClientRect().top + window.scrollY + 900;
    window.scrollTo(0, target);
    await new Promise(r => setTimeout(r, 120));
    const r = th.getBoundingClientRect();
    return r.top >= -1 && r.bottom <= window.innerHeight ? 'visible'
         : `off-screen at top=${Math.round(r.top)}`;
  });
  ok('and is still on screen 900px into a 50-row table', stuck === 'visible', stuck);
  ok('no errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n3. Fifty very long names on the smallest phone still sold');
{
  const past = new Date(Date.now() - 60 * 864e5).toISOString();
  const { ctx, page, errors } = await open(
    { playerCount: 50, longNames: true, weeks: 18, startISO: past }, 320);

  const o = await overflow(page);
  ok('long names do not overflow the picks tab at 320px',
     o.doc === 0 && !o.wide.length, JSON.stringify(o));

  await page.click('[data-tab="standings"]').catch(() => {});
  await page.waitForTimeout(600);
  const o2 = await overflow(page);
  ok('long names do not overflow standings at 320px',
     o2.doc === 0 && !o2.wide.length, JSON.stringify(o2));

  // A name must be truncated, not wrapped into a six-line row.
  const tall = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#board .row')];
    return rows.filter(r => r.getBoundingClientRect().height > 96).length;
  });
  ok('no standings row grows past 96px', tall === 0, String(tall));
  ok('no errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n4. Tap targets survive a crowded screen');
{
  const { ctx, page, errors } = await open({ playerCount: 50, weeks: 18 });
  const small = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll(
      'button, [role="tab"], [role="button"], a[href]')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;      // hidden
      if (getComputedStyle(el).display === 'none') continue;
      if (r.height < 36 || r.width < 28)
        out.push((el.className || el.tagName) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    }
    return [...new Set(out)].slice(0, 6);
  });
  ok('every visible control is big enough to hit', small.length === 0, small.join(' | '));
  ok('no errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n5. Every rank in the tray is visible without scrolling');
{
  /* The tray answers one question — which ranks have I still got — and
     as a single 544px row on a 366px screen it hid a third of the
     answer off the right edge, with nothing to suggest a swipe. */
  for (const width of [390, 320]) {
    const { ctx, page, errors } = await open({ playerCount: 50, weeks: 18 }, width);
    const hidden = await page.evaluate(() => {
      const box = document.querySelector('.stamps');
      if (!box) return 'no tray';
      const b = box.getBoundingClientRect();
      const out = [...box.querySelectorAll('.stampchip')].filter(c => {
        const r = c.getBoundingClientRect();
        return r.right > b.right + 1 || r.left < b.left - 1;
      });
      return out.length ? out.length + ' of ' + box.children.length + ' chips clipped' : 'none';
    });
    ok(`all 16 ranks are on screen at ${width}px`, hidden === 'none', hidden);
    ok(`no errors at ${width}px`, errors.length === 0, errors[0] || '');
    await ctx.close();
  }
}

/* ------------------------------------------------------------------ */
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
if (fails.length) { console.log('FAILURES:'); fails.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);
