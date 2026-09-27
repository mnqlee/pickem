/* MOCKUP SHEET: the football mirrored to the OUTER edge, and how far out.

   LEE: "The bills one is correct, however, move it more to the left
   about 4 spaces... You have the football on the left side of the
   chiefs score, it needs to mimick the same as the opposite side...
   Any team on the left side of the matchup should be 4 spaces to the
   RIGHT of the live score... and all teams on the right side of the
   matchup would be 4 spaces to the LEFT of the live score."

   SO IT MIRRORS, and the previous sheet only got half of it right. The
   right-hand panel is right-aligned toward its badge, so "left of the
   number" puts the ball on the gutter side. The left-hand panel is
   left-aligned toward ITS badge, so the same rule put the ball on the
   badge side, which is the inside of the card, the opposite end from
   where it sits on the other panel. One line fixes it: the away panel's
   score row runs in reverse, so the ball is last there and first on the
   home panel. The ball then always sits on the gutter side, and the two
   cards are mirror images of each other, which is what the rest of this
   card already does with the badges and the names.

   "FOUR SPACES", MEASURED RATHER THAN GUESSED. The score is Roboto Mono
   at 21px, and a monospace advance is the same for every glyph
   including the space, so "four spaces" is an exact number of pixels
   once it is measured off the rendered font rather than assumed from
   the em size. This sheet measures it in the browser and lays out three
   gaps, two, three and four spaces, with the real pixel value printed
   under each, because four might be more than it looks on paper.

   SINGLE AND DOUBLE DIGITS, which Lee flagged and which is the reason
   this is a flex gap rather than a position. The ball is a sibling of
   the number in the same row, so the distance is measured from the
   NUMBER'S edge and is identical whether the score reads 7 or 24. What
   moves with the digit count is where the pair sits relative to the
   panel edge, which is correct: the gap is to the number, not to the
   card. Both are on the sheet, and the check under it asserts the gap
   is the same to the tenth of a pixel across them.

   Drawn against the LIVE v1.38.3 file.

   Run: node mock-possession3.mjs
   Out: docs/mockups/possession-3-mirrored-390.png
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

const card = (n, a, h, took, ball, as, hs) => `
<div class="card locked g${n}" data-g="${n}" data-ball="${ball}">
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

/* ---- THE MIRROR, WHICH IS THE WHOLE FIX ----
   The ball is first in the markup on both panels. The HOME panel keeps
   that order, so the ball is left of the number, against the gutter.
   The AWAY panel runs the row in reverse, so the ball is right of the
   number, also against the gutter. Mirror images, like the badges and
   the names already are. */
/* .scrnum, NOT .num. The app already HAS a .num class, on the rank
   numerals in the picker, and it carries a red border and a red ink.
   Wrapping the score in .num inherited all of it and rendered every
   score inside a red box, on a sheet whose whole job is to show where
   a football sits. Caught by looking at the picture, not by any
   assertion here. */
.scr{display:flex;align-items:center}
.side.l .scr{flex-direction:row-reverse}
.pos{display:inline-flex;align-items:center}
.ball{width:18px;height:12px;flex:0 0 18px;color:inherit}

/* THE GAP IS SET PER SHEET SECTION, in exact multiples of one mono
   space measured off the rendered font. Written on .card so both panels
   of one card always agree. */
.card.g2 .scr{gap:var(--sp2)}
.card.g3 .scr{gap:var(--sp3)}
.card.g4 .scr{gap:var(--sp4)}

.zrow{display:flex;gap:18px;padding:10px 14px 4px;align-items:center}
.zball{zoom:3.4;display:inline-flex;padding:3px 4px}

.side.won{flex-grow:1.12;color:#fff}
.side.won .mark{box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.92)}
.side.won .city{opacity:.92}
`;

const doc = inner => `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800;900&family=Roboto+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body><div class="mocksheet">${inner}</div>
<script>
/* ONE MONO SPACE, MEASURED OFF THE RENDERED FONT. 0.6em is the usual
   Roboto Mono advance but assuming it would put a number on this sheet
   that the browser never agreed to. A span of ten spaces in the score's
   own computed font, divided by ten. */
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
  r.style.setProperty('--sp2', (one * 2).toFixed(2) + 'px');
  r.style.setProperty('--sp3', (one * 3).toFixed(2) + 'px');
  r.style.setProperty('--sp4', (one * 4).toFixed(2) + 'px');
  window.__space = one;
  document.querySelectorAll('[data-px]').forEach(function (el) {
    el.textContent = (one * +el.dataset.px).toFixed(1) + 'px';
  });
})();
</script></body></html>`;

/* KC at BUF: his own example. Double digits first, then a single digit
   on the same pair, because that is the case he asked about. */
const SECTION = (n, label) => `<div class="grp">
  <div class="cap">${n} spaces <i>${label} &middot; <b data-px="${n}">?</b></i></div>
  <div class="stlab">you took Buffalo, Buffalo has it &middot; ball on the gutter side, right panel</div>
  ${card(n, 'KC', 'BUF', 'h', 'h', 13, 17)}
  <div class="stlab">Kansas City has it &middot; ball on the gutter side, LEFT panel, mirrored</div>
  ${card(n, 'KC', 'BUF', 'h', 'a', 13, 17)}
  <div class="stlab">single digit, both sides, to show the gap does not move</div>
  ${card(n, 'KC', 'BUF', 'h', 'a', 7, 3)}
  ${card(n, 'KC', 'BUF', 'h', 'h', 7, 3)}
</div>`;

const PAGE = doc(`
  <div class="lab"><h3>Mirrored to the gutter side, at three gaps</h3>
    <p><b>The mirror first.</b> The Bills card was right because the
      home panel is right-aligned, so "left of the number" put the ball
      on the gutter side. The Chiefs panel is left-aligned, so the same
      rule put the ball on the badge side, the wrong end. The away
      panel's score row now runs in reverse, so the ball is right of the
      number there. Both balls sit on the gutter side, mirror images,
      the way the badges and names already are.</p>
    <p><b>Then the distance.</b> The score is Roboto Mono, so a space is
      the same width as a digit and "four spaces" is an exact number of
      pixels. It is measured off the rendered font here rather than
      assumed, and printed beside each heading. Two, three and four are
      all below, because four is wider than it sounds.</p>
    <p><b>Single against double digits.</b> The ball is a sibling of the
      number in the same row, so the gap is measured from the number's
      edge and is identical at 7 and at 17. What shifts is where the
      pair sits relative to the panel edge, which is the correct
      behaviour: the gap belongs to the number, not to the card.</p></div>`
  + SECTION(2, 'the closest')
  + SECTION(3, 'the middle one')
  + SECTION(4, 'what you asked for'));

/* ------------------------------------------------------------------ */
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const OUT = new URL('../../docs/mockups/', import.meta.url).pathname;
const name = 'possession-3-mirrored-390.png';
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
      g: +card.dataset.g, away, digits: num.textContent.trim().length,
      /* THE GAP, FROM THE NUMBER'S EDGE, whichever side the ball is on. */
      gap: +(away ? br.left - nr.right : nr.left - br.right).toFixed(1),
      /* AND WHICH SIDE IT LANDED ON, which is the mirror itself. */
      onGutterSide: away ? br.right <= gr.left + 2 : br.left >= gr.right - 2,
      /* NOTHING MAY LEAVE ITS PANEL. Four spaces is a real distance and
         a long team name plus a wide gap is exactly how a card starts
         clipping. */
      inside: br.left >= sr.left - .5 && br.right <= sr.right + .5,
      sameLine: Math.abs((br.top + br.bottom) / 2 - (nr.top + nr.bottom) / 2) < 3,
      ratio: null, fg: parts.slice(0, 3).map((x, i) => x * ca + bg[i] * (1 - ca)), bg,
      ell: (() => { const t = side.querySelector('.team');
        return t.scrollWidth > t.clientWidth + 1; })(),
    });
  }
  return { rows: out, space: window.__space };
});

console.log(`\none mono space at the score's size measures ${got.space.toFixed(2)}px`);
console.log('\n  gap  panel  digits  measured  on gutter side  inside panel  name clipped  ratio');
let bad = 0;
const byKey = {};
for (const r of got.rows) {
  const v = cr(r.fg, r.bg);
  const ok = r.onGutterSide && r.inside && r.sameLine && !r.ell && v >= 3;
  if (!ok) bad++;
  (byKey[`${r.g}|${r.away}`] ||= []).push(r.gap);
  console.log(`   ${r.g}    ${(r.away ? 'away' : 'home').padEnd(6)} ${String(r.digits).padEnd(7)} `
    + `${String(r.gap).padStart(6)}px  ${(r.onGutterSide ? 'yes' : 'NO').padEnd(15)} `
    + `${(r.inside ? 'yes' : 'NO').padEnd(13)} ${(r.ell ? 'YES' : 'no').padEnd(13)} `
    + `${v.toFixed(2)}${ok ? '' : '  !!'}`);
}
/* THE DIGIT QUESTION, ANSWERED AS A NUMBER: same gap at 7 as at 17. */
for (const [k, gaps] of Object.entries(byKey)) {
  const same = Math.max(...gaps) - Math.min(...gaps) < .15;
  if (!same) bad++;
  const [g, away] = k.split('|');
  console.log(`   ${g} spaces, ${away === 'true' ? 'away' : 'home'} panel: `
    + `gap is ${same ? 'identical' : 'DIFFERENT'} at one digit and two `
    + `(${gaps.map(x => x + 'px').join(', ')})`);
}
console.log(bad ? `\n!! ${bad} checks failed`
  : '\nmirrored to the gutter side on both panels, gap identical at one digit and two,'
    + ' nothing clipped');

await ctx.close();
await b.close();
