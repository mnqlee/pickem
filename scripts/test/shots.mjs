import { chromium } from 'playwright';
const BASE = 'http://127.0.0.1:8098';
const browser = await chromium.launch();

async function open(plan = {}, vp = { width: 390, height: 844 }) {
  await (await browser.newContext()).close();
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error'
    && !/ERR_FAILED|Failed to load resource/.test(m.text())) errs.push('console: ' + m.text()); });
  await page.request.post(BASE + '/__plan', { data: plan });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  return { ctx, page, errs };
}

const tab = async (page, name) => {
  await page.click(`.tab[data-tab="${name}"]`);
  await page.waitForTimeout(350);
};

const args = process.argv.slice(2);
const mode = args[0] || 'all';

// Mid-season: season opened ~6 weeks ago, so weeks 1-5 are final and week 6 is live/next.
const MID = { startISO: new Date(Date.now() - 40*24*3600*1000).toISOString() };

if (mode === 'all') {
  const { ctx, page, errs } = await open(MID);
  await page.waitForTimeout(1500);
  for (const t of ['picks', 'grid', 'standings', 'help', 'settings']) {
    await tab(page, t);
    await page.screenshot({ path: `/tmp/shots/m-${t}.png`, fullPage: false });
    if (t === 'grid' || t === 'standings')
      await page.screenshot({ path: `/tmp/shots/mfull-${t}.png`, fullPage: true });
  }
  // desktop
  await ctx.close();
  const d = await open(MID, { width: 1280, height: 900 });
  await d.page.waitForTimeout(1500);
  for (const t of ['picks', 'grid', 'standings']) {
    await tab(d.page, t);
    await d.page.screenshot({ path: `/tmp/shots/d-${t}.png` });
  }
  console.log('errors:', JSON.stringify([...errs, ...d.errs], null, 1));
  await d.ctx.close();
}

if (mode === 'boot') {
  // What does the user actually stare at while 8 Firestore reads happen?
  const { page } = await open({ delay: { getAllWeeks: 2500 } });
  for (const ms of [300, 900, 1800]) {
    await page.waitForTimeout(ms === 300 ? 300 : 600);
    await page.screenshot({ path: `/tmp/shots/boot-${ms}.png` });
  }
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `/tmp/shots/boot-done.png` });
}

if (mode === 'fail') {
  const { page, errs } = await open({ fail: { getAllWeeks: true } });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: '/tmp/shots/fail-load.png' });
  const state = await page.evaluate(() => ({
    obHidden: document.getElementById('ob').classList.contains('hide'),
    slateHtml: (document.getElementById('slate')||{}).innerHTML?.trim().length || 0,
    visibleText: document.body.innerText.trim().slice(0, 200),
  }));
  console.log('after a failed load:', JSON.stringify(state, null, 1));
  console.log('errors:', JSON.stringify(errs, null, 1));
}

await browser.close();
