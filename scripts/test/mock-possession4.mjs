/* MOCKUP SHEET: why the two panels look different at the same gap, and
   Lee's fix for it.

   LEE: "The 3 and 4 spaces I like the best, however, the filled in team
   selected 3 and 4 look different then the unselected team 3 and 4. I
   like unselected team 3 and selected team 4."

   HE IS READING A REAL DIFFERENCE, and it is not the gap. The two
   panels are not the same size and never have been. The picked side is
   flex-grow 1.12 and the other is .94, so the picked panel is wider,
   and its badge is 42px against the other's 34px. Same 48px gap, two
   different panels: the ball lands at a different distance from the
   gutter on each, and that distance is what the eye compares, because
   the gutter is the line running down the middle of the card.

   So a single number cannot look even here. The fix is one value per
   side, which is what Lee picked by eye: 3 spaces on the unselected
   side, 4 on the selected one. Section 2 is that, measured.

   WHAT THE MEASUREMENT IS FOR. "Looks even" is a claim about the gap
   between the ball and the gutter, so that is what is printed under
   every card, per panel, rather than the gap to the number, which was
   never the thing that looked wrong.

   Drawn against the LIVE v1.38.3 file.

   Run: node mock-possession4.mjs
   Out: docs/mockups/possession-4-per-side-390.png
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
      <div class="scr mono">${hasBall ? `<span class="pos">${BALL()}</span>` : ''}<span
        class="scrnum">${score}</span></div></div></button>`;

const card = (mode, a, h, took, ball, as, hs) => `
<div class="card locked ${mode}" data-mode="${mode}" data-ball="${ball}">
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

.scr{display:flex;align-items:center}
.side.l .scr{flex-direction:row-reverse}
.pos{display:inline-flex;align-items:center}
.ball{width:18px;height:12px;flex:0 0 18px;color:inherit}

/* SAME NUMBER BOTH SIDES, which is what looked uneven. */
.card.same .scr{gap:var(--sp4)}
/* LEE'S PICK: one value per side. The unselected panel is the narrower
   one, so it takes the smaller gap. */
.card.mix .side.lost .scr{gap:var(--sp3)}
.card.mix .side.won  .scr{gap:var(--sp4)}

.side.won{flex-grow:1.12;color:#fff}
.side.won .mark{box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.92)}
.side.won .city{opacity:.92}
`;

const doc = inner => `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800;900&family=Roboto+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body><div class="mocksheet">${inner}</div>
<script>
(function () {
  var s = document.querySelector('.scr .scrnum') || document.body;
  var cs = getComputedStyle(s);
  var p = document.createElement('span');
  p.style.cssText = 'position:fixed;left:-9999px;white-space:pre;font-family:'
    + cs.fontFamily + ';font-size:' + cs.fontSize + ';font-weight:' + cs.fontWeight
    + ';letter-spacing:' + cs.letterSpacing;
  p.textContent = '          ';
  document.body.appendChild(p);
  var one = p.getBoundingClientRect().width / 10;
  p.remove();
  var r = document.documentElement;
  r.style.setProperty('--sp3', (one * 3).toFixed(2) + 'px');
  r.style.setProperty('--sp4', (one * 4).toFixed(2) + 'px');
  window.__space = one;
})();
</script></body></html>`;

const PAGE = doc(`
  <div class="lab"><h3>One gap per side, because the panels are not the same size</h3>
    <p><b>You are reading a real difference.</b> The picked panel is
      <code>flex-grow:1.12</code> and the other is <code>.94</code>, so
      the picked side is wider, and its badge is 42px against the
      other's 34px. The same gap on two different panels puts the ball
      at a different distance from the <b>gutter</b>, and the gutter is
      the line your eye measures against, because it runs down the
      middle of the card.</p>
    <p>So no single number can look even here. Section 2 is your fix:
      <b>3 spaces on the unselected side, 4 on the selected one</b>. The
      distance from each ball to the gutter is printed under every card
      so you can see whether it actually evens out, rather than taking
      my word for it.</p></div>

  <div class="grp">
    <div class="cap">1 &middot; the same 4 spaces on both <i>what looked uneven</i></div>
    <div class="stlab">the ball on the selected side</div>
    ${card('same', 'KC', 'BUF', 'h', 'h', 13, 17)}
    <div class="stlab">the ball on the unselected side</div>
    ${card('same', 'KC', 'BUF', 'h', 'a', 13, 17)}
  </div>

  <div class="grp">
    <div class="cap">2 &middot; unselected 3, selected 4 <i>your pick</i></div>
    <div class="stlab">the ball on the selected side, 4 spaces</div>
    ${card('mix', 'KC', 'BUF', 'h', 'h', 13, 17)}
    <div class="stlab">the ball on the unselected side, 3 spaces</div>
    ${card('mix', 'KC', 'BUF', 'h', 'a', 13, 17)}
    <div class="stlab">single digits, both sides, to show the gap holds</div>
    ${card('mix', 'KC', 'BUF', 'h', 'h', 7, 3)}
    ${card('mix', 'KC', 'BUF', 'h', 'a', 7, 3)}
    <div class="stlab">and with the AWAY team picked, so the wide panel is on the left</div>
    ${card('mix', 'GB', 'CHI', 'a', 'a', 24, 20)}
    ${card('mix', 'GB', 'CHI', 'a', 'h', 24, 20)}
  </div>`);

/* ------------------------------------------------------------------ */
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const OUT = new URL('../../docs/mockups/', import.meta.url).pathname;
const name = 'possession-4-per-side-390.png';
const f = '/tmp/claude-0/' + name.replace('.png', '.html');
fs.writeFileSync(f, PAGE);
await page.goto('file://' + f, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(800);
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
    const num = side.querySelector('.scrnum');
    const gut = card.querySelector('.gutter');
    const cs = getComputedStyle(ball);
    const bg = surfaceOf(ball.parentElement);
    const parts = (cs.color.match(/[\d.]+/g) || []).map(Number);
    const ca = parts.length > 3 ? parts[3] : 1;
    const br = ball.getBoundingClientRect(), nr = num.getBoundingClientRect(),
          sr = side.getBoundingClientRect(), gr = gut.getBoundingClientRect();
    const away = side.classList.contains('l');
    out.push({
      mode: card.dataset.mode, lit: side.classList.contains('won'),
      away, digits: num.textContent.trim().length,
      gapToNumber: +(away ? br.left - nr.right : nr.left - br.right).toFixed(1),
      /* THE NUMBER THAT MATTERS TO THE EYE: ball to gutter. The gutter
         is skewed, so its own box is the honest edge to measure to. */
      gapToGutter: +(away ? gr.left - br.right : br.left - gr.right).toFixed(1),
      panelW: +sr.width.toFixed(1),
      inside: br.left >= sr.left - .5 && br.right <= sr.right + .5,
      ell: (() => { const t = side.querySelector('.team');
        return t.scrollWidth > t.clientWidth + 1; })(),
      fg: parts.slice(0, 3).map((x, i) => x * ca + bg[i] * (1 - ca)), bg,
    });
  }
  return { rows: out, space: window.__space };
});

console.log(`\none mono space at the score's size is ${got.space.toFixed(1)}px,`
  + ` so 3 spaces = ${(got.space * 3).toFixed(0)}px and 4 = ${(got.space * 4).toFixed(0)}px`);
console.log('\n  set   side        panel  digits  to number  TO GUTTER  clipped  ratio');
let bad = 0;
for (const r of got.rows) {
  const v = cr(r.fg, r.bg);
  const ok = r.inside && !r.ell && v >= 3;
  if (!ok) bad++;
  console.log(`   ${r.mode.padEnd(5)} ${(r.lit ? 'selected' : 'unselected').padEnd(11)} `
    + `${String(r.panelW).padStart(5)} ${String(r.digits).padEnd(7)} `
    + `${String(r.gapToNumber).padStart(8)}px ${String(r.gapToGutter).padStart(9)}px  `
    + `${(r.ell ? 'YES' : 'no').padEnd(8)} ${v.toFixed(2)}${ok ? '' : '  !!'}`);
}

/* THE QUESTION THE SHEET EXISTS TO ANSWER, as one number per set: how
   far apart are the two balls from the gutter. Smaller is more even. */
for (const mode of ['same', 'mix']) {
  const rows = got.rows.filter(r => r.mode === mode && r.digits === 2);
  const lit = rows.find(r => r.lit), un = rows.find(r => !r.lit);
  if (!lit || !un) continue;
  const d = Math.abs(lit.gapToGutter - un.gapToGutter).toFixed(1);
  console.log(`\n   ${mode === 'same' ? 'same 4 both sides' : 'unselected 3, selected 4'}:`
    + ` selected sits ${lit.gapToGutter}px from the gutter,`
    + ` unselected ${un.gapToGutter}px, a difference of ${d}px`);
}
console.log(bad ? `\n!! ${bad} checks failed` : '\nnothing clipped, every ball clears 3:1');

await ctx.close();
await b.close();
