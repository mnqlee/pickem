/* MOCKUP SHEET: the football on the LEFT of the live score.

   LEE: "show me a mock up of the live football on the left side of the
   live score instead of the right side. I like to the football that has
   the strings in the picture. Show me one where its on the dark picked
   selection and the opposite color to show on the white 'non picked'
   team side when they have the ball please."

   THREE THINGS, AND ALL THREE ARE THE SAME ONE LINE OF CSS.

   1. LEFT OF THE NUMBER, ON BOTH SIDES. V1 on the first sheet put the
      ball after the score on the right-hand panel, because .scr carried
      a row-reverse to match .side.r's own reversal. That rule is gone.
      The ball is simply first in the row on both panels now, so it is
      to the left of the number whichever team has it.

   2. THE LACED BALL. It is the same outline drawn on the first sheet,
      the one magnified at the top: an ellipse with a seam and three
      laces, stroked rather than filled. Filled was the first attempt
      and it failed for a reason worth keeping: with a white fill the
      laces had to be white too, so on the picked panel it rendered as a
      plain oval and read as a dot.

   3. THE COLOUR IS NOT SET AT ALL, which is the point. Every stroke is
      currentColor. The picked panel is already color:#fff, so the ball
      is white there. The other side is already --ink-mute on the cream
      paper, so the ball is dark there. One drawing, no rule per side,
      and it cannot drift apart later because there is nothing to keep
      in step.

   Drawn against the LIVE v1.38.3 file, not the working tree, which
   still holds unshipped v1.39.0 work.

   Run: node mock-possession2.mjs
   Out: docs/mockups/possession-2-left-390.png
*/
import { chromium } from 'playwright';
import fs from 'node:fs';

/* The v1.38.3 build these sheets were drawn against. Resolve it against
   THIS file, never a hardcoded checkout: a hardcoded path once made a
   harness grade a tree other than the one being shipped. Override with
   MOCK_BASE if you want to draw the sheets against a different build. */
const LIVE = process.env.MOCK_BASE
  || new URL('../../index.html', import.meta.url).pathname;

/* THESE SHEETS ARE HISTORY. They were drawn against v1.38.3, BEFORE the
   football existed, so each one paints its own candidate footballs over
   a clean base. Run one against a build that already ships the football
   and every card draws two. Point MOCK_BASE at a pre-v1.39.0 index.html
   to redraw them. */
if (/class="ball"/.test(fs.readFileSync(LIVE, 'utf8')))
  throw new Error('this base already ships the football; set MOCK_BASE to a pre-v1.39.0 index.html');
const APP = fs.readFileSync(LIVE, 'utf8');
const STYLE = APP.slice(APP.indexOf('<style>') + 7, APP.indexOf('</style>'));
if (/atdisc/.test(STYLE)) throw new Error('that is the working tree, not the live build');

const T = (() => {
  const blk = APP.slice(APP.indexOf('const T={'), APP.indexOf("'#FFB612']};") + 14);
  const out = {};
  for (const m of blk.matchAll(
    /(\w+):\['([^']*)','([^']*)','(#[0-9A-Fa-f]{6})','(#[0-9A-Fa-f]{6})'\]/g))
    out[m[1]] = [m[2], m[3], m[4], m[5]];
  return out;
})();

const lin = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
const rgbOf = hex => { const h = hex.replace('#', '');
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
const lumOf = c => .2126 * lin(c[0]) + .7152 * lin(c[1]) + .0722 * lin(c[2]);
const cr = (a, b) => { const x = lumOf(a), y = lumOf(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };

/* THE BALL LEE PICKED: outline, seam, three laces, all currentColor. */
const BALL = () => `<svg class="ball" viewBox="0 0 24 15" aria-hidden="true">
  <ellipse cx="12" cy="7.5" rx="10.6" ry="6.1" fill="none"
           stroke="currentColor" stroke-width="1.7"/>
  <path d="M7.4 7.5h9.2M9.6 5.3v4.4M12 4.9v5.2M14.4 5.3v4.4"
        fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>`;

const side = (code, which, lit, hasBall, score) => `
  <button class="side ${which} ${lit ? 'won' : 'lost'}"${
    lit ? ` style="background:${T[code][2]}"` : ''}>
    <div class="mark" style="background:${T[code][2]};--sec:${T[code][3]}"><span>${code}</span></div>
    <div class="names"><div class="city">${T[code][0]}</div>
      <div class="team">${T[code][1]}</div>
      <div class="scr mono">${hasBall ? `<span class="pos">${BALL()}</span>` : ''}<span>${
        score}</span></div></div></button>`;

const card = (a, h, took, ball, as, hs) => `
<div class="card locked" data-ball="${ball}" data-took="${took}">
  <div class="meta"><span class="cd live lefted">2nd &middot; 5:42</span>
    <span class="net">CBS</span>
    <span class="cd live nodot">In progress</span></div>
  <div class="match">${side(a, 'l', took === 'a', ball === 'a', as)}
    <div class="gutter"><span>@</span></div>
    ${side(h, 'r', took === 'h', ball === 'h', hs)}</div>
  <div class="lockband"><span>In progress &middot; locked</span>
    <span>You took ${took === 'a' ? a : h} &middot; Rank 4 &middot; 13 pts if it holds</span></div>
</div>`;

const CSS = `
${STYLE}
.mocksheet{padding:0 0 30px}
.lab{padding:20px 14px 4px}
.lab h3{margin:0;font-size:13px;font-weight:900;color:var(--paper)}
.lab p{margin:5px 0 10px;font-size:10.5px;line-height:1.55;color:var(--chalk)}
.lab b{color:var(--paper)}
.lab code{font-family:'Roboto Mono',monospace;font-size:9.5px;color:var(--lock)}
.cap{padding:15px 14px 5px;font-size:8.5px;font-weight:800;letter-spacing:.13em;
  text-transform:uppercase;color:var(--lock)}
.cap i{font-style:normal;color:var(--chalk);letter-spacing:.04em;text-transform:none;
  font-weight:600}
.grp{margin-top:6px;border-top:1px solid rgba(250,247,241,.09);padding-top:2px}
.stlab{padding:7px 14px 3px;font-size:9px;font-weight:700;letter-spacing:.05em;
  color:var(--chalk);font-family:'Roboto Mono',monospace}

/* ---- THE WHOLE ADDITION ----
   .scr becomes a row so the ball can share the line with the number,
   and the ball comes FIRST. No row-reverse on the right-hand panel:
   that is what put it after the score last time. .side.r's .names is
   already align-items:flex-end, so the pair stays hard against the
   badge and the ball lands immediately left of the number. */
.scr{display:flex;align-items:center;gap:7px}
.pos{display:inline-flex;align-items:center}
.ball{width:18px;height:12px;flex:0 0 18px;color:inherit}

/* NO COLOUR RULE ON PURPOSE. .side.won is already #fff and .side.lost
   is already --ink-mute, so currentColor gives white on the picked
   panel and dark on the cream one with nothing to keep in step. */

.zrow{display:flex;gap:18px;padding:10px 14px 4px;align-items:center}
.zball{zoom:3.4;display:inline-flex;padding:3px 4px}
.zwrap{text-align:center}
.zname{font-size:8.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;
  color:var(--lock);padding-top:6px;font-family:'Archivo',sans-serif}

.side.won{flex-grow:1.12;color:#fff}
.side.won .mark{box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.92)}
.side.won .city{opacity:.92}
`;

const doc = inner => `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800;900&family=Roboto+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body><div class="mocksheet">${inner}</div></body></html>`;

const PAGE = doc(`
  <div class="lab"><h3>The football on the left of the score</h3>
    <p>Same laced ball, moved to the <b>left of the number on both
      sides</b>. Its colour is not set anywhere: every line of it is
      <code>currentColor</code>, so it takes the white the picked panel
      already writes in, and the dark ink the cream side already writes
      in. One drawing, opposite colours, nothing to keep in step.</p></div>
  <div class="cap">the ball, magnified <i>the same one on both grounds</i></div>
  <div class="zrow">
    <div class="zwrap"><span class="zball" style="color:#fff;background:#00338D">${
      BALL()}</span><div class="zname">picked side</div></div>
    <div class="zwrap"><span class="zball" style="color:rgba(21,23,27,.66);background:#EDE8DE">${
      BALL()}</span><div class="zname">other side</div></div>
  </div>

  <div class="grp">
    <div class="cap">you took Buffalo <i>a dark club</i></div>
    <div class="stlab">Buffalo has the ball: white, on the colour</div>
    ${card('KC', 'BUF', 'h', 'h', 13, 17)}
    <div class="stlab">Kansas City has it: dark, on the cream side</div>
    ${card('KC', 'BUF', 'h', 'a', 13, 17)}
  </div>

  <div class="grp">
    <div class="cap">you took Cincinnati <i>the lightest club in the league</i></div>
    <div class="stlab">Cincinnati has the ball: white, on orange</div>
    ${card('CIN', 'CLE', 'a', 'a', 21, 20)}
    <div class="stlab">Cleveland has it: dark, on the cream side</div>
    ${card('CIN', 'CLE', 'a', 'h', 21, 20)}
  </div>

  <div class="grp">
    <div class="cap">and the away side picked <i>so the ball is on the left panel</i></div>
    <div class="stlab">you took Green Bay, and they have it</div>
    ${card('GB', 'CHI', 'a', 'a', 24, 20)}
    <div class="stlab">Chicago has it</div>
    ${card('GB', 'CHI', 'a', 'h', 24, 20)}
  </div>`);

/* ------------------------------------------------------------------ */
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const OUT = new URL('../../docs/mockups/', import.meta.url).pathname;
const name = 'possession-2-left-390.png';
const f = '/tmp/claude-0/' + name.replace('.png', '.html');
fs.writeFileSync(f, PAGE);
await page.goto('file://' + f, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(700);
await page.screenshot({ path: OUT + name, fullPage: true });
console.log('wrote', name, '(' + (await page.evaluate(() => document.body.scrollHeight)) + 'px)');

const got = await page.evaluate(() => {
  const px = s => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  const surfaceOf = el => {
    for (let n = el; n; n = n.parentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      const p = px(bg), a = (bg.match(/[\d.]+/g) || [])[3];
      if (p.length === 3 && (a === undefined || +a > .9)) return p;
    }
    return [255, 255, 255];
  };
  const out = [];
  for (const card of document.querySelectorAll('.card')) {
    const ball = card.querySelector('.ball');
    if (!ball) continue;
    const side = ball.closest('.side');
    const num = side.querySelector('.scr span:last-child');
    const cs = getComputedStyle(ball);
    const bg = surfaceOf(ball.parentElement);
    const parts = (cs.color.match(/[\d.]+/g) || []).map(Number);
    const ca = parts.length > 3 ? parts[3] : 1;
    const br = ball.getBoundingClientRect(), nr = num.getBoundingClientRect();
    out.push({
      club: side.querySelector('.mark span').textContent.trim(),
      lit: side.classList.contains('won'),
      panel: side.classList.contains('l') ? 'left panel' : 'right panel',
      fg: parts.slice(0, 3).map((x, i) => x * ca + bg[i] * (1 - ca)), bg,
      /* LEFT OF THE NUMBER, MEASURED. The whole request, and the one
         thing that reads the same in a diff whether it is right or
         wrong: the ball's right edge must be left of the number's left
         edge, on BOTH panels. */
      leftOfNumber: br.right <= nr.left + 1,
      gap: +(nr.left - br.right).toFixed(1),
      sameLine: Math.abs((br.top + br.bottom) / 2 - (nr.top + nr.bottom) / 2) < 3,
    });
  }
  return out;
});

console.log('\n  club  panel        side          left of no.  gap   ratio  verdict');
let bad = 0;
for (const r of got) {
  const v = cr(r.fg, r.bg);
  const ok = r.leftOfNumber && r.sameLine && v >= 3;
  if (!ok) bad++;
  console.log(`   ${r.club.padEnd(4)}  ${r.panel.padEnd(12)} `
    + `${(r.lit ? 'picked, white' : 'other, dark').padEnd(13)} `
    + `${(r.leftOfNumber ? 'yes' : 'NO').padEnd(11)} ${String(r.gap).padStart(4)}  `
    + `${v.toFixed(2).padStart(5)}  ${ok ? 'ok' : '!!'}`);
}
console.log(bad ? `\n!! ${bad} failed`
  : '\nthe ball is left of the number on every panel, on the same line, and clears 3:1');

await ctx.close();
await b.close();
