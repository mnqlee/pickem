/* SCREENSHOTS OF THE SHIPPED CARD, not a mockup.

   Every sheet in docs/mockups/ is a hand-built page that borrows the
   app's stylesheet. This one drives the REAL app through app-serve, so
   what it captures is what index.html actually renders — which is the
   only thing that can confirm the mockups were built.

   Four states, each from a fixture chosen to produce it:
     a finished week, staked wins and losses, at 390px and 320px
     a lopsided pool, so the narrow-side figure is on screen
     an unstaked pick, the state that had no fixture until now
     a live card and an unplayed card, to show they did not change

   Run: node shot-final-card.mjs   (needs: node app-serve.mjs &)
   Out: docs/mockups/shipped-final-card-*.png
*/
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:8098';
const OUT = new URL('../../docs/mockups/', import.meta.url).pathname;
const past = new Date(Date.now() - 12 * 864e5).toISOString();
const mnf  = new Date(Date.now() - (4 * 864e5 + 5 * 3600e3)).toISOString();
const soon = new Date(Date.now() + 3 * 864e5).toISOString();

const b = await chromium.launch();

async function shot(name, plan, view, prep) {
  const ctx = await b.newContext({ viewport: view, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  await page.request.post(BASE + '/__plan', { data: plan });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  if (prep) await prep(page);
  /* THE SLATE, NOT THE WHOLE PAGE. A full-page shot of a sixteen-game
     week is 6000px tall and useless for looking at one card. Clip to
     the first few cards of the list. */
  const box = await page.locator('#slate').boundingBox();
  await page.screenshot({
    path: OUT + name,
    clip: { x: 0, y: box.y, width: view.width, height: Math.min(box.height, 1500) },
  });
  console.log('wrote', name);
  await ctx.close();
}

const week1 = async page => {
  await page.click('.wk[data-wk="1"]').catch(() => {});
  await page.waitForTimeout(900);
};
const week2 = async page => {
  await page.click('.wk[data-wk="2"]').catch(() => {});
  await page.waitForTimeout(900);
};

// Week 1: the generator has Lee calling every game WRONG -> losses.
await shot('shipped-final-card-losses-390.png',
  { startISO: past, weeks: 2, gamesPerWeek: 16, playerCount: 13 },
  { width: 390, height: 1500 }, week1);
// Week 2: every game RIGHT -> wins.
await shot('shipped-final-card-wins-390.png',
  { startISO: past, weeks: 2, gamesPerWeek: 16, playerCount: 13 },
  { width: 390, height: 1500 }, week2);
// The narrow-side figure needs a lopsided pool.
await shot('shipped-final-card-narrow-side-390.png',
  { startISO: past, weeks: 2, gamesPerWeek: 16, playerCount: 13, lopsided: true },
  { width: 390, height: 1500 }, week2);
// The unstaked pick: first three games of each week picked, not ranked.
await shot('shipped-final-card-unstaked-390.png',
  { startISO: past, weeks: 2, gamesPerWeek: 16, playerCount: 13, unstaked: 3 },
  { width: 390, height: 1500 }, week2);
// The narrow phone.
await shot('shipped-final-card-320.png',
  { startISO: past, weeks: 2, gamesPerWeek: 16, playerCount: 13, lopsided: true },
  { width: 320, height: 1500 }, week2);
// Monday night: fifteen final cards above one live one, so the live row
// and the final head are in the same shot and can be compared.
await shot('shipped-live-beside-final-390.png',
  { startISO: mnf, weeks: 2, gamesPerWeek: 16, playerCount: 13,
    espnDetail: '4th 2:11' },
  { width: 390, height: 1500 });
// And an unplayed week, to show the stake bar and meta row untouched.
await shot('shipped-unplayed-card-390.png',
  { startISO: soon, weeks: 1, gamesPerWeek: 4, playerCount: 13 },
  { width: 390, height: 1100 });

await b.close();
