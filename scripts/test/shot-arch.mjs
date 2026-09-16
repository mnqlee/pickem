import { chromium } from 'playwright';
const BASE = 'http://127.0.0.1:8098';
const ARCH = {
  id: 'preseason-2026', label: 'Preseason 2026', state: 'public',
  note: 'Three weeks, five players, everything working. Kept as a reference.',
  standings: [
    { name: 'Mateo',  pts: 214, hits: 31, of: 42, wins: 2, seconds: 0, perfect: 0 },
    { name: 'Monse',  pts: 198, hits: 29, of: 42, wins: 1, seconds: 2, perfect: 0 },
    { name: 'Lee',    pts: 186, hits: 28, of: 42, wins: 0, seconds: 1, perfect: 0 },
    { name: 'Eliana', pts: 171, hits: 26, of: 42, wins: 0, seconds: 0, perfect: 0 },
    { name: 'Sofia',  pts: 150, hits: 24, of: 42, wins: 0, seconds: 0, perfect: 0 }],
  weeks: [{ wk: 3, winner: 'Mateo', pts: 78 }, { wk: 2, winner: 'Monse', pts: 71 },
          { wk: 1, winner: 'Mateo', pts: 65 }],
};
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 1500 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
await page.request.post(BASE + '/__plan', { data: { playerCount: 6, weeks: 2, archive: ARCH } });
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1400);
await page.click('[data-tab="settings"]');
await page.waitForTimeout(700);
await page.screenshot({ path: '/root/work/pickem/docs/mockups/archive-in-settings.png' });
console.log('shot written');
await b.close();
