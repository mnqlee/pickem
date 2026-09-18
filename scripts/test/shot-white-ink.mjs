/* THE WHITE-INK TREATMENT ON A WHOLE SLATE, out of the real app.

   The sheets in docs/mockups/white-ink-*.png are hand-built variants,
   built before the decision. These two are the shipped build: two weeks
   of the fixture at 390px, so the treatment can be checked across many
   clubs at once rather than one card at a time.

   The first versions of these two files were captured by hand, which is
   why they had to be thrown away when the badge's colour bar came back:
   nothing re-made them. This script exists so that never happens again.

   Run: node shot-white-ink.mjs   (needs: node app-serve.mjs &)
   Out: docs/mockups/shipped-white-w1-390.png, shipped-white-w2-390.png
*/
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:8098';
const OUT = new URL('../../docs/mockups/', import.meta.url).pathname;
const past = new Date(Date.now() - 12 * 864e5).toISOString();

const b = await chromium.launch();

async function slate(name, wk) {
  const ctx = await b.newContext({
    viewport: { width: 390, height: 1500 }, deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  await page.request.post(BASE + '/__plan', {
    data: { startISO: past, weeks: 2, gamesPerWeek: 16, playerCount: 13 },
  });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.click(`.wk[data-wk="${wk}"]`).catch(() => {});
  await page.waitForTimeout(900);

  /* CLIP TO THE TOP OF THE SLATE. A sixteen-game week is 6000px tall
     and unreadable as one image; the first few cards carry enough
     clubs to judge the rule. */
  const box = await page.locator('#slate').boundingBox();
  await page.screenshot({
    path: OUT + name,
    clip: { x: 0, y: box.y, width: 390, height: Math.min(box.height, 1400) },
  });
  console.log('wrote', name);
  await ctx.close();
}

/* WEEK 1 is the week the fixture has Lee calling every game wrong, so
   every lit side is a team he did NOT take: the ring is absent and the
   writing is the paper-side grey. WEEK 2 is every game right, so every
   lit side carries the ring. Both are needed: the rule is as much about
   what the unlit side does not get. */
await slate('shipped-white-w1-390.png', 1);
await slate('shipped-white-w2-390.png', 2);

await b.close();
