/* MOCKUP SHEET — the W series: a circled W/L where the staked rank sits,
   and no coloured strip along the bottom of the card.

   Nothing here touches the app. It lifts index.html's own <style> block
   verbatim so the typeface is really Archivo and the card geometry is
   really the shipping geometry — every earlier mockup that hand-rolled
   its own CSS rendered in the wrong font and had to be redone.

   Run: node mock-result-badge.mjs
   Out: docs/mockups/result-badge-W-series.png
*/
import { chromium } from 'playwright';
import fs from 'node:fs';

const APP = fs.readFileSync(new URL('../../index.html', import.meta.url).pathname, 'utf8');
const STYLE = APP.slice(APP.indexOf('<style>') + 7, APP.indexOf('</style>'));

const T = {
  CHI: ['Chicago', 'Bears', '#0B162A', '#C83803'],
  CAR: ['Carolina', 'Panthers', '#0085CA', '#101820'],
  DET: ['Detroit', 'Lions', '#0076B6', '#B0B7BC'],
  NO:  ['New Orleans', 'Saints', '#101820', '#D3BC8D'],
  LAC: ['Los Angeles', 'Chargers', '#0080C6', '#FFC20E'],
  ARI: ['Arizona', 'Cardinals', '#97233F', '#FFB612'],
  TEN: ['Tennessee', 'Titans', '#0C2340', '#4B92DB'],
  NYJ: ['New York', 'Jets', '#125740', '#000000'],
};

const mark = c => `<div class="mark" style="background:${T[c][2]};--sec:${T[c][3]}">
  <span>${c}</span></div>`;

/* THE WINNING SIDE'S BACKGROUND IS AN INLINE STYLE, not a class — the
   app writes `style="background:<team primary>;color:<readable ink>"` on
   it, because the colour is per team and cannot live in the stylesheet.
   Leaving it out gave `.side.won{color:#fff}` with no backdrop: white
   team names on light paper, unreadable, in the first render of this
   sheet. onColor() is the app's own luminance test, reproduced here
   because four NFL primaries are too light for white text. */
const onColor = hex => {
  const h = String(hex).replace('#', '');
  const lin = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
  const L = .2126 * lin(parseInt(h.slice(0, 2), 16))
          + .7152 * lin(parseInt(h.slice(2, 4), 16))
          + .0722 * lin(parseInt(h.slice(4, 6), 16));
  return (1.05 / (L + .05)) >= ((L + .05) / .05) ? '#fff' : '#15171B';
};

const side = (c, which, cls, score) => {
  const bg = cls === 'won'
    ? ` style="background:${T[c][2]};color:${onColor(T[c][2])}"` : '';
  return `<button class="side ${which} ${cls}"${bg}>
  ${mark(c)}<div class="names"><div class="city">${T[c][0]}</div>
  <div class="team">${T[c][1]}</div>
  <div class="scr mono">${score}</div></div></button>`;
};

/* The card, minus whatever goes under the pool bar — that is the part
   every option below replaces. */
const card = (away, home, net, line, awayScore, homeScore, wonSide, pool, foot) => `
<div class="card locked">
  <div class="meta">
    <span class="mono">2:00 AM</span>
    <span class="net">${net}</span>
    <span class="mono">${line}</span>
    <span class="cd done">Final</span>
  </div>
  <div class="match">
    ${side(away, 'l', wonSide === 'a' ? 'won' : 'lost', awayScore)}
    <div class="gutter"><span>@</span></div>
    ${side(home, 'r', wonSide === 'h' ? 'won' : 'lost', homeScore)}
  </div>
  <div class="cons">
    <div class="cons-h">How the pool picked</div>
    <div class="consbar">${pool}</div>
    <div class="cons-sub mono">26 picks</div>
  </div>
  ${foot}
</div>`;

const poolBar = (aCode, aPct, hCode, hPct) => `
  <div class="cseg l" style="flex:${aPct};background:${T[aCode][2]}">${
    aPct >= 22 ? aCode + ' ' + aPct + '%' : ''}</div>
  <div class="cseg r" style="flex:${hPct};background:${T[hCode][2]}">${
    hPct >= 22 ? hCode + ' ' + hPct + '%' : ''}</div>`;

/* ---- the bottom-of-card options ------------------------------------ */

// What ships today, for comparison only.
const A_strip = won => `<div class="lockband ${won ? 'won' : 'lost'}">
  <span>Final &middot; ${won ? 'CHI 59-37' : 'ARI 26-14'}</span>
  <span>${won ? 'You took CHI &middot; rank 9 &middot; +8 pts'
              : 'You took LAC &middot; rank 3 &middot; 0 pts'}</span></div>`;

/* W1 — the single letter, in the stake bar's own circle exactly:
   26px, 2px border, 13px/900, rotate(-7deg). Only the colour changes. */
const W1 = won => `<div class="stakebar resbar">
  <span class="sb-l">You took ${won ? 'CHI' : 'LAC'} &middot; rank ${won ? 9 : 3}</span>
  <span class="sb-r">
    <span class="sb-pts ${won ? 'w' : 'l'}">${won ? '+8 pts' : '0 pts'}</span>
    <span class="sb-num ${won ? 'w' : 'l'}">${won ? 'W' : 'L'}</span></span></div>`;

/* W2 — the same circle, filled, letter in white. The card's own Q2
   palette, just moved into the circle. */
const W2 = won => `<div class="stakebar resbar">
  <span class="sb-l">You took ${won ? 'CHI' : 'LAC'} &middot; rank ${won ? 9 : 3}</span>
  <span class="sb-r">
    <span class="sb-pts ${won ? 'w' : 'l'}">${won ? '+8 pts' : '0 pts'}</span>
    <span class="sb-num fill ${won ? 'w' : 'l'}">${won ? 'W' : 'L'}</span></span></div>`;

/* W3 — the whole word, in a pill at the circle's height, same slant. */
const W3 = won => `<div class="stakebar resbar">
  <span class="sb-l">You took ${won ? 'CHI' : 'LAC'} &middot; rank ${won ? 9 : 3}</span>
  <span class="sb-r">
    <span class="sb-pts ${won ? 'w' : 'l'}">${won ? '+8 pts' : '0 pts'}</span>
    <span class="sb-word ${won ? 'w' : 'l'}">${won ? 'WIN' : 'LOSS'}</span></span></div>`;

/* W4 — the whole word, pill, NOT slanted. A rotated number reads as a
   stamp; a rotated word reads as a mistake. */
const W4 = won => `<div class="stakebar resbar">
  <span class="sb-l">You took ${won ? 'CHI' : 'LAC'} &middot; rank ${won ? 9 : 3}</span>
  <span class="sb-r">
    <span class="sb-pts ${won ? 'w' : 'l'}">${won ? '+8 pts' : '0 pts'}</span>
    <span class="sb-word flat ${won ? 'w' : 'l'}">${won ? 'WIN' : 'LOSS'}</span></span></div>`;

/* W5 — the circle keeps the RANK and the letter moves to the left, as a
   word. Tests the other way round: is the rank or the result the thing
   that belongs in the circle? */
const W5 = won => `<div class="stakebar resbar">
  <span class="sb-l"><b class="sb-res ${won ? 'w' : 'l'}">${won ? 'WIN' : 'LOSS'}</b>
    &middot; you took ${won ? 'CHI' : 'LAC'}</span>
  <span class="sb-r">
    <span class="sb-pts ${won ? 'w' : 'l'}">${won ? '+8 pts' : '0 pts'}</span>
    <span class="sb-num ${won ? 'w' : 'l'}">${won ? 9 : 3}</span></span></div>`;

/* W6 — W1, but the points come out and the left line carries them, so
   the circle is the only thing on the right. */
const W6 = won => `<div class="stakebar resbar">
  <span class="sb-l">You took ${won ? 'CHI' : 'LAC'} &middot; rank ${won ? 9 : 3}
    &middot; ${won ? '+8 pts' : '0 pts'}</span>
  <span class="sb-r"><span class="sb-num ${won ? 'w' : 'l'}">${won ? 'W' : 'L'}</span></span></div>`;

/* The two cases a coloured strip currently covers and a badge has to
   answer for as well. */
const NOPICK = `<div class="stakebar resbar">
  <span class="sb-l miss2">No pick &middot; 0 pts</span>
  <span class="sb-r"><span class="sb-num l">&ndash;</span></span></div>`;
const TIE = `<div class="stakebar resbar">
  <span class="sb-l">You took DET &middot; rank 2 &middot; no score (tie)</span>
  <span class="sb-r"><span class="sb-num tie">&ndash;</span></span></div>`;

const WIN  = f => card('CHI', 'CAR', 'FOX', 'CHI -3', 59, 37, 'a', poolBar('CHI', 77, 'CAR', 23), f);
const LOSS = f => card('ARI', 'LAC', 'CBS', 'LAC -8.5', 26, 14, 'a', poolBar('ARI', 8, 'LAC', 92), f);

const sheet = [
  ['A — what ships today, for comparison',
   'The whole strip fills. This is Q2, already built.',
   A_strip(true) , A_strip(false)],
  ['W1 — the letter, in the stake bar’s own circle',
   '26px, 2px ring, 13px/900, rotated −7° — the sb-num spec exactly, colour swapped.',
   W1(true), W1(false)],
  ['W2 — same circle, filled, white letter',
   'The Q2 palette moved into the circle instead of across the whole strip.',
   W2(true), W2(false)],
  ['W3 — the whole word, slanted pill',
   'Same height and slant as the circle.',
   W3(true), W3(false)],
  ['W4 — the whole word, pill, not slanted',
   'A rotated numeral reads as a stamp; a rotated word can read as a mistake.',
   W4(true), W4(false)],
  ['W5 — the circle keeps the rank, the word goes left',
   'The other way round: which of the two belongs in the circle?',
   W5(true), W5(false)],
  ['W6 — W1 with the points moved left',
   'The circle is then the only thing on the right.',
   W6(true), W6(false)],
  ['The two cases a coloured strip also covers',
   'No pick at all, and a game that ended level. Both need an answer.',
   WIN(NOPICK) ? null : null, null],
];

const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800;900&family=Roboto+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>
${STYLE}
/* ---- MOCKUP CHROME ONLY. Nothing below touches a card rule, a font or
   a colour token — that is the mistake that made six earlier sheets
   render in Barlow. ---- */
/* NOT .sheet — that is the APP's rank tray: position:fixed, bottom:0,
   translated off screen until it is opened. Naming the mockup container
   "sheet" inherited all of that and rendered a page of pure black. */
.mocksheet{width:390px;margin:0 auto;padding:0 0 28px}
.opt{padding:22px 14px 4px}
.opt h3{margin:0;font-size:13px;font-weight:900;letter-spacing:.01em;color:var(--paper)}
.opt p{margin:4px 0 12px;font-size:10.5px;line-height:1.45;color:var(--chalk)}
.pairlab{padding:0 14px 6px;font-size:8.5px;font-weight:800;letter-spacing:.16em;
  text-transform:uppercase;color:var(--chalk-faint)}
.rule{height:1px;background:rgba(250,247,241,.09);margin:18px 14px 0}

/* ---- THE ONLY NEW RULES THE APP WOULD NEED ---- */
/* The result bar sits where the stake bar sits, and is not a button. */
.resbar{cursor:default;border-top:1px solid var(--rule)}
.sb-num.w{border-color:var(--hit);color:var(--hit)}
.sb-num.l{border-color:var(--stamp);color:var(--stamp)}
.sb-num.tie{border-color:var(--ink-faint);color:var(--ink-faint)}
.sb-num.fill.w{background:var(--hit);border-color:var(--hit);color:#fff}
.sb-num.fill.l{background:var(--stamp);border-color:var(--stamp);color:#fff}
.sb-pts.w{color:var(--hit)}
.sb-pts.l{color:var(--ink-faint)}
.sb-word{height:26px;display:grid;place-items:center;padding:0 9px;border-radius:13px;
  border:2px solid;font-size:11px;font-weight:900;letter-spacing:.04em;
  transform:rotate(-7deg)}
.sb-word.flat{transform:none}
.sb-word.w{border-color:var(--hit);color:var(--hit)}
.sb-word.l{border-color:var(--stamp);color:var(--stamp)}
.sb-res{font-weight:900;letter-spacing:.06em}
.sb-res.w{color:var(--hit)}
.sb-res.l{color:var(--stamp)}
.miss2{color:var(--stamp);font-weight:800}
</style></head><body><div class="mocksheet">
${sheet.filter(s => s[2]).map(([h, p, w, l]) => `
  <div class="opt"><h3>${h}</h3><p>${p}</p></div>
  <div class="pairlab">your pick won</div>
  ${WIN(w)}
  <div class="pairlab">your pick lost</div>
  ${LOSS(l)}
  <div class="rule"></div>`).join('')}
  <div class="opt"><h3>The two cases a coloured strip also covers</h3>
    <p>A game you did not pick at all, and a game that ended level. Both
      need an answer if the strip goes away.</p></div>
  <div class="pairlab">no pick</div>
  ${LOSS(NOPICK)}
  <div class="pairlab">ended level &mdash; nothing decided</div>
  ${card('NO', 'DET', 'FOX', 'DET -7', 30, 30, null, poolBar('NO', 8, 'DET', 92), TIE)}
</div></body></html>`;

fs.writeFileSync('/tmp/claude-0/mock-w.html', html);

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto('file:///tmp/claude-0/mock-w.html', { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(900);
const out = new URL('../../docs/mockups/result-badge-W-series.png', import.meta.url).pathname;
await page.screenshot({ path: out, fullPage: true });
/* MEASURED, NOT EYEBALLED: the whole point of the circle is that it is
   the stake bar's circle. If the geometry drifts the option is not the
   option. */
const geo = await page.evaluate(() => {
  const n = document.querySelector('.sb-num.w');
  const c = getComputedStyle(n);
  const r = n.getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height), font: c.fontSize,
           weight: c.fontWeight, border: c.borderTopWidth, t: c.transform,
           family: c.fontFamily.split(',')[0] };
});
console.log('sb-num geometry:', JSON.stringify(geo));
console.log('written', out);
await b.close();
