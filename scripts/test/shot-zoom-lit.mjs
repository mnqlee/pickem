/* THE LIT SIDE, MAGNIFIED, OUT OF THE REAL APP.

   Lee looks at this card zoomed in on a phone, so a 390px sheet is not
   how the decision gets checked. This drives index.html through
   app-serve at deviceScaleFactor 4 and clips to one card, which gives a
   genuine 4x-density image rather than an upscaled blurry one: the
   hairline ring is 1.5 CSS px, and at 1x it is a grey smudge you cannot
   judge.

   It finds Carolina by looking for a lit badge whose letters read CAR,
   because CAR is one of the four clubs that used to print in near-black
   and is the club in the reference shot Lee sent. If the generator's
   pairing ever stops producing a lit CAR it says so and falls back to
   the first lit card, rather than silently shooting the wrong club.

   Three things have to be visible in the output and all three were a
   correction:
     the thin white ring round the selected badge
     the CAROLINA line faded slightly, set back from PANTHERS
     the club's second colour still barred across the badge's bottom

   Run: node shot-zoom-lit.mjs   (needs: node app-serve.mjs &)
   Out: docs/mockups/zoom-lit-CAR.png, zoom-lit-pair.png
*/
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:8098';
const OUT = new URL('../../docs/mockups/', import.meta.url).pathname;
const past = new Date(Date.now() - 12 * 864e5).toISOString();

const b = await chromium.launch();
const ctx = await b.newContext({
  viewport: { width: 390, height: 1400 }, deviceScaleFactor: 4,
});
const page = await ctx.newPage();
await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
await page.request.post(BASE + '/__plan', {
  data: { startISO: past, weeks: 2, gamesPerWeek: 16, playerCount: 13 },
});
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

/* WEEK 2 is the week the generator has Lee calling right, so the side he
   took is also the side that won and the card is lit. */
await page.click('.wk[data-wk="2"]').catch(() => {});
await page.waitForTimeout(900);

const found = await page.evaluate(() => {
  const out = [];
  document.querySelectorAll('#slate .card').forEach((c, i) => {
    const won = c.querySelector('.side.won');
    if (!won) return;
    const code = won.querySelector('.mark span');
    out.push({ i, code: code ? code.textContent.trim() : null });
  });
  return out;
});
if (!found.length) throw new Error('no lit card in week 2 — check the plan');

const car = found.find(f => f.code === 'CAR');
if (!car) console.log('note: no lit CAR this week, using', found[0].code);
const target = car || found[0];
console.log('shooting card', target.i, 'lit side', target.code);

/* ELEMENT SHOTS, NOT A CLIPPED PAGE SHOT. page.screenshot()'s clip is
   in page coordinates while boundingBox() is viewport-relative, so a
   card below the fold clipped that way lands outside the image and
   Playwright refuses it: that is exactly how this failed on its first
   run. locator.screenshot() scrolls the card into view itself and
   frames it, and the card IS the paper, so nothing is lost by not
   padding the frame. */
async function shotCard(name, idx) {
  await page.locator('#slate .card').nth(idx).screenshot({ path: OUT + name });
  console.log('wrote', name);
}

await shotCard('zoom-lit-CAR.png', target.i);

/* AND A SECOND CLUB UNDER IT, because the ring, the fade and the strip
   are only convincing as a rule if two clubs show the same treatment in
   one image. Stacked afterwards rather than captured together: the two
   cards are usually not adjacent, so there is no single element that
   contains them both and nothing else. */
const other = found.find(f => f.i !== target.i && f.code !== target.code);
if (other) {
  await shotCard('zoom-lit-other.png', other.i);
  console.log('pair:', target.code, '+', other.code);
}

await ctx.close();
await b.close();
