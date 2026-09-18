/* TWO SHEETS, both answering questions that can only be settled by
   looking at a picture. NEITHER IS A RECORD OF WHAT SHIPPED — sheet 2
   is the record of a change that was BUILT AND THEN REVERTED, kept so
   the next person does not have to measure it all again.

   SHEET 1 — THE HAIRLINE RING, magnified. Lee could not see it on his
   phone, which is the correct reaction: it is a 1px inset shadow at 30%
   black on a 9px square, so at real size it is about as strong as the
   anti-aliasing on the square's own corners. It exists for one case —
   Cincinnati's #FB4F14 measures 2.76:1 against the card's #EDE8DE paper,
   under the 3:1 floor for a graphic, so without an edge the chip can
   melt into the paper. The sheet shows each chip at real size and at 8x,
   with and without the ring, so the difference is visible AND so it is
   obvious how little it changes anything. The ring is KEPT.

   SHEET 2 — THE LABEL INK, and it is NOT in the build. `.cseg` prints
   white on the club's primary and so does `.mark`, which on four clubs
   is under the 4.5:1 floor: CIN 3.37:1, MIA 3.95, CAR 4.03, LAC 4.28.
   The one-line fix (onColor(), the rule the lit side of a card already
   uses) was written, rendered into this sheet, reviewed, and taken back
   out at Lee's decision — none of the four is hard to read, and it was
   never white-on-white. DESIGN-DECISIONS section 5 keeps it as an open
   item. THE APP TODAY LOOKS LIKE THE "BEFORE" ROWS BELOW.

   The sheet computes its own inks with a local copy of onColor that
   returns #000, so it keeps rendering the comparison correctly however
   index.html is set — which is the point of keeping it.

   WHY THAT LOCAL COPY RETURNS #000 AND NOT THE APP'S #15171B: onColor's
   comparison weighs white against PURE BLACK, so near-black is a colour
   the maths never measures. Against Carolina's blue #15171B is 4.45:1
   and against the Chargers' 4.19:1 — both still under the floor, so a
   near-black version of this change would not have worked. #000 is 5.21
   and 4.90. The middle row of each block shows it.

   Run: node mock-label-ink.mjs
   Out: docs/mockups/chip-ring-zoom-390.png
        docs/mockups/label-ink-before-after-390.png
*/
import { chromium } from 'playwright';
import fs from 'node:fs';

const APP = fs.readFileSync(new URL('../../index.html', import.meta.url).pathname, 'utf8');
const STYLE = APP.slice(APP.indexOf('<style>') + 7, APP.indexOf('</style>'));

/* The four light primaries, a dark one for comparison, and the two
   that sit just the right side of the line (KC, DET) so the sheet
   shows where the rule stops flipping. */
const T = {
  CIN: ['Cincinnati', 'Bengals', '#FB4F14', '#000000'],
  MIA: ['Miami', 'Dolphins', '#008E97', '#FC4C02'],
  CAR: ['Carolina', 'Panthers', '#0085CA', '#101820'],
  LAC: ['Los Angeles', 'Chargers', '#0080C6', '#FFC20E'],
  KC:  ['Kansas City', 'Chiefs', '#E31837', '#FFB81C'],
  DET: ['Detroit', 'Lions', '#0076B6', '#B0B7BC'],
  CHI: ['Chicago', 'Bears', '#0B162A', '#C83803'],
  CLE: ['Cleveland', 'Browns', '#311D00', '#FF3C00'],
};

/* WCAG relative luminance and contrast, the same arithmetic index.html
   runs, kept here so the numbers printed on the sheet are computed and
   not typed in. A typed ratio is a claim; a computed one is a
   measurement. */
const lin = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
const lum = hex => {
  let h = String(hex).replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  return .2126 * lin(parseInt(h.slice(0, 2), 16))
       + .7152 * lin(parseInt(h.slice(2, 4), 16))
       + .0722 * lin(parseInt(h.slice(4, 6), 16));
};
const ratio = (a, b) => {
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
};
const r2 = (a, b) => ratio(a, b).toFixed(2);
const onColor = hex => {
  const L = lum(hex);
  return (1.05 / (L + .05)) >= ((L + .05) / .05) ? '#fff' : '#000';
};

const PAPER = '#EDE8DE';   // the card's own paper, what a chip sits on
const INK15 = '#15171B';   // the house near-black, for the three-way

/* ================= SHEET 1: THE RING ================================= */

const chip = (code, ring) => `<i class="pchip${ring ? ' ring' : ''}"
  style="background:${T[code][2]}"></i>`;

/* MAGNIFIED, NOT REDRAWN. transform:scale(8) on the real 9px chip
   scales its box-shadow with it, so what you see at 8x is the actual
   ring and not a hand-drawn imitation of one. A redrawn "ring" at 8px
   would prove nothing about the 1px one. */
const zoom = (code, ring) => `<div class="zoombox"><div class="zoominner">${
  chip(code, ring)}</div></div>`;

const ringRow = code => {
  const hex = T[code][2];
  const g = ratio(hex, PAPER);
  return `<div class="rrow">
    <div class="rlab"><b>${code}</b><span>${hex}</span>
      <span class="${g >= 3 ? 'pass' : 'fail'}">${g.toFixed(2)}:1 vs paper${
        g >= 3 ? '' : ' — under 3:1'}</span></div>
    <div class="rcells">
      <div class="rcell"><div class="rcap">no ring</div>
        <div class="reallife">${chip(code, false)}<span>${code} 7%</span></div>
        ${zoom(code, false)}</div>
      <div class="rcell"><div class="rcap">with the ring</div>
        <div class="reallife">${chip(code, true)}<span>${code} 7%</span></div>
        ${zoom(code, true)}</div>
    </div></div>`;
};

const ringSheet = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800;900&family=Roboto+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>
${STYLE}
.mocksheet{margin:0 auto;padding:0 0 30px}
.opt{padding:20px 14px 4px}
.opt h3{margin:0;font-size:13px;font-weight:900;color:var(--paper)}
.opt p{margin:5px 0 10px;font-size:10.5px;line-height:1.5;color:var(--chalk)}
.opt code{font-family:'Roboto Mono',monospace;font-size:9.5px}
.rule{height:1px;background:rgba(250,247,241,.09);margin:16px 14px}

/* Each row is one club: its numbers, then the chip as it really is and
   the same chip at 8x, without and with the ring. */
.rrow{margin:0 14px 14px;background:var(--paper);border-radius:12px;padding:11px 12px 13px;
  box-shadow:0 1px 0 rgba(0,0,0,.18)}
.rlab{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:9px}
.rlab b{font-size:12px;font-weight:900;letter-spacing:.02em;color:var(--ink)}
.rlab span{font-family:'Roboto Mono',monospace;font-size:9px;color:var(--ink-soft)}
.rlab .pass{color:#2F6E26;font-weight:800}
.rlab .fail{color:#BE2F26;font-weight:800}
.rcells{display:flex;gap:10px}
.rcell{flex:1 1 0;min-width:0;background:var(--paper-2);border-radius:9px;padding:8px 9px 10px;
  border:1px solid var(--rule)}
.rcap{font-size:8px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;
  color:var(--ink-faint);margin-bottom:7px}
/* Real size, in the actual sub-line treatment: chip, then the figure. */
.reallife{display:flex;align-items:center;gap:5px;font-family:'Roboto Mono',monospace;
  font-size:9.5px;font-weight:700;color:var(--ink-soft);margin-bottom:9px}
/* 9px * 8 = 72px. The box reserves the space; the inner scales from its
   top-left corner so nothing overlaps the next cell. */
.zoombox{width:72px;height:72px;position:relative;overflow:hidden;
  background:${PAPER};border-radius:4px}
/* line-height:0 and a block chip, or the inline box's own baseline
   offset gets multiplied by 8 and the square lands off the bottom of
   the frame — which is what the first render of this sheet did. */
.zoominner{position:absolute;left:0;top:0;width:9px;height:9px;line-height:0;
  font-size:0;transform:scale(8);transform-origin:0 0}
.zoominner .pchip{display:block}
/* box-shadow:none MATTERS. The app's own .pchip already carries the ring
   — that is the thing being shown — so without resetting it here the
   "no ring" cell inherits it from ${'$'}{STYLE} and both halves of the
   comparison look identical. The first render of this sheet did exactly
   that: two ringed squares labelled as a before and after. */
.pchip{width:9px;height:9px;border-radius:2px;display:inline-block;flex:0 0 9px;
  box-shadow:none}
.pchip.ring{box-shadow:inset 0 0 0 1px rgba(20,22,26,.30)}
</style></head><body><div class="mocksheet">
  <div class="opt"><h3>The hairline ring, at real size and at 8&times;</h3>
    <p>It is <code>inset 0 0 0 1px rgba(20,22,26,.30)</code> on a 9px
      square &mdash; one pixel, at 30% black. You were right that you
      can&rsquo;t see it on Cincinnati at arm&rsquo;s length; at 8&times;
      it is plain. It is there for one club: <b>#FB4F14 is 2.76:1</b>
      against the card&rsquo;s paper, and a graphic wants 3:1, so without
      an edge that chip can melt into the card. On the other 31 it does
      nothing you could ever notice.</p></div>
  ${['CIN', 'MIA', 'LAC', 'CHI'].map(ringRow).join('')}
  <div class="rule"></div>
  <div class="opt"><p>If you would rather it went away, it is one line
    and only Cincinnati changes. The alternative that does not need a
    ring is a darker chip for that one club, which means printing a
    colour that is not the club&rsquo;s.</p></div>
</div></body></html>`;

/* ================= SHEET 2: THE LABEL INK =========================== */

const mark = (code, ink) => `<div class="mark" style="background:${
  T[code][2]};--sec:${T[code][3]};color:${ink}"><span>${code}</span></div>`;

const seg = (pct, code, cls, ink) => pct === 0 ? '' :
  `<div class="cseg ${cls}" style="width:${pct}%;background:${
    T[code][2]};color:${ink}">${pct >= 22 ? `<span>${code} ${pct}%</span>` : ''}</div>`;

/* mode: 'before' = white by decree, 'after' = onColor per club. */
const inkFor = (code, mode) => mode === 'before' ? '#fff'
  : mode === 'ink15' ? (onColor(T[code][2]) === '#fff' ? '#fff' : INK15)
  : onColor(T[code][2]);

const pair = (a, h, ap, mode) => `<div class="cons">
  <div class="cons-head"><span>How the pool picked</span></div>
  <div class="cbar">${seg(ap, a, 'l', inkFor(a, mode))}${
    seg(100 - ap, h, 'r', inkFor(h, mode))}</div>
  <div class="cons-sub mono"><span class="pcount">26 picks</span></div></div>`;

const marks = (code, mode) => `<div class="mkrow">${
  mark(code, inkFor(code, mode))}<span class="mklab">${code} &mdash; ${
  inkFor(code, mode) === '#fff' ? 'white' : inkFor(code, mode)} at <b>${
  r2(T[code][2], inkFor(code, mode))}:1</b></span></div>`;

const inkBlock = (code, other, pct) => {
  const hex = T[code][2];
  const w = ratio(hex, '#fff'), i = ratio(hex, INK15), b = ratio(hex, '#000');
  const chose = onColor(hex);
  return `<div class="iblock">
    <div class="ihead"><b>${code}</b><span>${hex}</span></div>
    <div class="inums">
      <span class="${w >= 4.5 ? 'pass' : 'fail'}">white ${w.toFixed(2)}</span>
      <span class="${i >= 4.5 ? 'pass' : 'fail'}">#15171B ${i.toFixed(2)}</span>
      <span class="${b >= 4.5 ? 'pass' : 'fail'}">#000 ${b.toFixed(2)}</span>
      <span class="picked">chosen: ${chose === '#fff' ? 'white' : '#000'}</span>
    </div>
    <div class="icap">before &mdash; white by decree</div>
    ${pair(code, other, pct, 'before')}
    <div class="icap">the house near-black, #15171B &mdash; still short on CAR and LAC</div>
    ${pair(code, other, pct, 'ink15')}
    <div class="icap">after &mdash; onColor(), which lands on #000 here</div>
    ${pair(code, other, pct, 'after')}
    <div class="icap">and the abbreviation, same rule</div>
    <div class="mkpair">${marks(code, 'before')}${marks(code, 'after')}</div>
  </div>`;
};

const inkSheet = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800;900&family=Roboto+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>
${STYLE}
.mocksheet{margin:0 auto;padding:0 0 30px}
.opt{padding:20px 14px 4px}
.opt h3{margin:0;font-size:13px;font-weight:900;color:var(--paper)}
.opt p{margin:5px 0 10px;font-size:10.5px;line-height:1.5;color:var(--chalk)}
.opt code{font-family:'Roboto Mono',monospace;font-size:9.5px}
.rule{height:1px;background:rgba(250,247,241,.09);margin:16px 14px}
.iblock{margin:0 14px 16px;background:var(--paper);border-radius:12px;padding:11px 12px 13px;
  box-shadow:0 1px 0 rgba(0,0,0,.18)}
.ihead{display:flex;align-items:baseline;gap:8px;margin-bottom:6px}
.ihead b{font-size:12px;font-weight:900;color:var(--ink)}
.ihead span{font-family:'Roboto Mono',monospace;font-size:9px;color:var(--ink-soft)}
.inums{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
.inums span{font-family:'Roboto Mono',monospace;font-size:8.5px;font-weight:700;
  padding:2px 6px;border-radius:9px;border:1px solid var(--rule);color:var(--ink-soft)}
.inums .pass{color:#2F6E26;border-color:rgba(47,110,38,.4)}
.inums .fail{color:#BE2F26;border-color:rgba(190,47,38,.4)}
.inums .picked{color:var(--ink);font-weight:800;border-color:var(--ink-faint)}
.icap{font-size:8px;font-weight:800;letter-spacing:.13em;text-transform:uppercase;
  color:var(--ink-faint);margin:9px 0 3px}
.iblock .cons{margin-top:0}
.mkpair{display:flex;gap:12px;align-items:flex-start}
.mkrow{display:flex;align-items:center;gap:7px;flex:1 1 0;min-width:0}
.mklab{font-family:'Roboto Mono',monospace;font-size:8.5px;font-weight:700;
  color:var(--ink-soft);line-height:1.3}
.mklab b{color:var(--ink)}
</style></head><body><div class="mocksheet">
  <div class="opt"><h3>The pool bar&rsquo;s own label &mdash; reviewed, not shipped</h3>
    <p><b>The app looks like the BEFORE row in each block.</b> This sheet
      is the record of a change that was built and then reverted.</p>
    <p>The bar prints <code>CIN 64%</code> inside the segment, and
      <code>.cseg</code> painted that white on every club. On four
      primaries white is under the 4.5:1 floor: Cincinnati
      <b>3.37:1</b>, Miami <b>3.95</b>, Carolina <b>4.03</b>, the
      Chargers <b>4.28</b>. The abbreviation on the team chip has the
      same problem at 13px. Every ratio below is computed, not typed.</p></div>
  ${inkBlock('CIN', 'CLE', 64)}
  ${inkBlock('MIA', 'NE' in T ? 'NE' : 'CHI', 58)}
  ${inkBlock('CAR', 'CHI', 71)}
  ${inkBlock('LAC', 'CLE', 56)}
  <div class="rule"></div>
  <div class="opt"><h3>Where the rule would have stopped flipping</h3>
    <p>Kansas City at <b>4.72:1</b> and Detroit at <b>4.92:1</b> clear
      the floor on white and are left alone, and so are the other 26.
      Only four cards in the league change.</p></div>
  ${inkBlock('KC', 'DET', 52)}
</div></body></html>`;

/* ================= RENDER AND MEASURE =============================== */

fs.writeFileSync('/tmp/claude-0/mock-ring.html', ringSheet);
fs.writeFileSync('/tmp/claude-0/mock-ink.html', inkSheet);

const b = await chromium.launch();
const shoot = async (file, out) => {
  const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto('file://' + file, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
  await page.screenshot({ path: out, fullPage: true });
  return { ctx, page };
};

const ring = await shoot('/tmp/claude-0/mock-ring.html',
  new URL('../../docs/mockups/chip-ring-zoom-390.png', import.meta.url).pathname);
/* MEASURED: the magnified chip is really 8x the real one, so the sheet
   is not quietly showing a different square. */
const sizes = await ring.page.evaluate(() => {
  const real = document.querySelector('.reallife .pchip').getBoundingClientRect();
  const big = document.querySelector('.zoominner .pchip').getBoundingClientRect();
  return { real: Math.round(real.width), big: Math.round(big.width) };
});
console.log('chip real', sizes.real + 'px', '| magnified', sizes.big + 'px',
  sizes.big === sizes.real * 8 ? 'OK 8x' : '!! not 8x');
/* MEASURED: the magnified square is INSIDE its frame. The first render
   of this sheet had the chip's inline baseline offset multiplied by 8,
   which pushed it out of the bottom of the box and clipped it. A sheet
   that silently shows half a square is worse than no sheet. */
const fits = await ring.page.evaluate(() => {
  const box = document.querySelector('.zoombox').getBoundingClientRect();
  const big = document.querySelector('.zoominner .pchip').getBoundingClientRect();
  return { ok: big.top >= box.top - 0.5 && big.bottom <= box.bottom + 0.5
             && big.left >= box.left - 0.5 && big.right <= box.right + 0.5,
           top: Math.round(big.top - box.top), bottom: Math.round(box.bottom - big.bottom) };
});
console.log('magnified square inside its frame:', fits.ok ? 'OK' : '!! CLIPPED',
  '(top gap ' + fits.top + ', bottom gap ' + fits.bottom + ')');
/* MEASURED: the two halves of the comparison ARE different. The app's
   own .pchip carries the ring, so a sheet that forgets to reset it shows
   two identical squares under a "no ring / with the ring" caption. */
const shadows = await ring.page.evaluate(() => {
  /* NOT .rrow:first-of-type — :first-of-type counts DIVS, and the first
     div in the sheet is the .opt intro, so that selector matches nothing
     and the check compared undefined with undefined. */
  const cells = document.querySelectorAll('.rrow')[0].querySelectorAll('.rcell');
  return [...cells].map(c => getComputedStyle(c.querySelector('.pchip')).boxShadow);
});
console.log('ring off:', shadows[0], '| ring on:', shadows[1],
  shadows[0] !== shadows[1] ? 'OK different' : '!! IDENTICAL');
await ring.ctx.close();

const ink = await shoot('/tmp/claude-0/mock-ink.html',
  new URL('../../docs/mockups/label-ink-before-after-390.png', import.meta.url).pathname);
/* MEASURED: the "after" segments really do carry a different ink from
   the "before" ones, in the rendered page rather than in my template. */
const inks = await ink.page.evaluate(() => [...document.querySelectorAll('.cseg')]
  .map(s => ({ bg: getComputedStyle(s).backgroundColor, fg: getComputedStyle(s).color,
               txt: s.textContent.trim() })));
const flipped = inks.filter(s => s.fg !== 'rgb(255, 255, 255)');
console.log('segments rendered:', inks.length, '| carrying non-white ink:', flipped.length);
console.log('wrote chip-ring-zoom-390.png and label-ink-before-after-390.png');
await ink.ctx.close();
await b.close();
