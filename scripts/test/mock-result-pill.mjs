/* MOCKUP SHEET — the X series. W3 (the slanted WIN/LOSS pill) was
   chosen; this is W3 with the four changes asked for:

     1. "0 pts" in RED, not muted grey. "+8 pts" was already green.
     2. The "You took … · Rank n" line in green on a win, red on a loss.
     3. "Rank", capitalised, on every card.
     4. FINAL and the score fitted into the same bar, above or below.

   THE RED IS NOT --stamp, AND THAT IS MEASURED. --stamp #C8342A on the
   card's #EDE8DE paper is 4.32:1 — under the 4.5:1 floor for text this
   size, and these are now two lines of real information rather than one
   word. #BE2F26 is 4.75:1 and is indistinguishable from --stamp at a
   glance. The app already does exactly this in the other direction:
   .lockband .miss uses #E0645A because --stamp measured 3.18:1 on the
   DARK strip. Same problem, opposite ground, so it wants its own token.
   Green needs no adjustment: --hit is 5.09:1 on this paper.

   Lifts index.html's own <style> block verbatim, so the typeface is
   really Archivo and the card geometry is really the shipping geometry.
   Rendered at 390px AND 320px, because every clipping bug this app has
   had has been on the narrow phone — and both sheets carry a measured
   overflow check rather than my opinion of whether it fits.

   Run: node mock-result-pill.mjs
   Out: docs/mockups/result-pill-X-series-390.png
        docs/mockups/result-pill-X-series-320.png
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
  WSH: ['Washington', 'Commanders', '#5A1414', '#FFB612'],
  PHI: ['Philadelphia', 'Eagles', '#004C54', '#A5ACAF'],
};

const onColor = hex => {
  const h = String(hex).replace('#', '');
  const lin = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
  const L = .2126 * lin(parseInt(h.slice(0, 2), 16))
          + .7152 * lin(parseInt(h.slice(2, 4), 16))
          + .0722 * lin(parseInt(h.slice(4, 6), 16));
  return (1.05 / (L + .05)) >= ((L + .05) / .05) ? '#fff' : '#15171B';
};

const mark = c => `<div class="mark" style="background:${T[c][2]};--sec:${T[c][3]}">
  <span>${c}</span></div>`;

const side = (c, which, cls, score) => {
  const bg = cls === 'won' ? ` style="background:${T[c][2]};color:${onColor(T[c][2])}"` : '';
  return `<button class="side ${which} ${cls}"${bg}>
  ${mark(c)}<div class="names"><div class="city">${T[c][0]}</div>
  <div class="team">${T[c][1]}</div>
  <div class="scr mono">${score}</div></div></button>`;
};

const poolBar = (a, ap, h, hp) => `
  <div class="cseg l" style="flex:${ap};background:${T[a][2]}">${
    ap >= 22 ? a + ' ' + ap + '%' : ''}</div>
  <div class="cseg r" style="flex:${hp};background:${T[h][2]}">${
    hp >= 22 ? h + ' ' + hp + '%' : ''}</div>`;

const card = (away, home, net, line, as_, hs, wonSide, pool, foot) => `
<div class="card locked">
  <div class="meta">
    <span class="mono">2:00 AM</span>
    <span class="net">${net}</span>
    <span class="mono">${line}</span>
    <span class="cd done">Final</span>
  </div>
  <div class="match">
    ${side(away, 'l', wonSide === 'a' ? 'won' : 'lost', as_)}
    <div class="gutter"><span>@</span></div>
    ${side(home, 'r', wonSide === 'h' ? 'won' : 'lost', hs)}
  </div>
  <div class="cons"><div class="cons-h">How the pool picked</div>
    <div class="consbar">${pool}</div>
    <div class="cons-sub mono">26 picks</div></div>
  ${foot}
</div>`;

/* Each case: who you took, the rank, the points, and the game's own
   result line. `k` is 'w' | 'l' | 'none' | 'tie'. */
const CASES = {
  win:  { k: 'w',    took: 'CHI', rank: 9, pts: '+8 pts',  fin: 'CHI 59-37' },
  loss: { k: 'l',    took: 'LAC', rank: 3, pts: '0 pts',   fin: 'ARI 26-14' },
  none: { k: 'none', took: null,  rank: 0, pts: '0 pts',   fin: 'ARI 26-14' },
  tie:  { k: 'tie',  took: 'DET', rank: 2, pts: 'no score', fin: 'DET 30-30' },
};
const word = k => k === 'w' ? 'WIN' : k === 'l' ? 'LOSS' : k === 'tie' ? 'TIE' : '&ndash;';
const took = c => c.took ? `You took ${c.took} &middot; Rank ${c.rank}` : 'No pick';
const scoreLine = c => `Final &middot; ${c.fin}`;

/* X1 — the score line ABOVE, quiet; the result line below, coloured. */
const X1 = c => `<div class="stakebar resbar two">
  <span class="sb-stack">
    <span class="sb-fin mono">${scoreLine(c)}</span>
    <span class="sb-l res ${c.k}">${took(c)}</span>
  </span>
  <span class="sb-r">
    <span class="sb-pts ${c.k}">${c.pts}</span>
    <span class="sb-word ${c.k}">${word(c.k)}</span></span></div>`;

/* X2 — the same two lines, the other way round: the result you care
   about first, the game's score under it. */
const X2 = c => `<div class="stakebar resbar two">
  <span class="sb-stack">
    <span class="sb-l res ${c.k}">${took(c)}</span>
    <span class="sb-fin mono">${scoreLine(c)}</span>
  </span>
  <span class="sb-r">
    <span class="sb-pts ${c.k}">${c.pts}</span>
    <span class="sb-word ${c.k}">${word(c.k)}</span></span></div>`;

/* X3 — one line, everything on it. Included so the width question is
   answered by a render rather than by an opinion. */
const X3 = c => `<div class="stakebar resbar">
  <span class="sb-l res ${c.k} one">${scoreLine(c)} &middot; ${took(c)}</span>
  <span class="sb-r">
    <span class="sb-pts ${c.k}">${c.pts}</span>
    <span class="sb-word ${c.k}">${word(c.k)}</span></span></div>`;

/* X4 — two lines, and the POINTS move up beside the score so the pill
   is alone on the second line. Balances the bar instead of stacking
   everything down the left. */
const X4 = c => `<div class="stakebar resbar two x4">
  <span class="sb-stack">
    <span class="sb-fin mono">${scoreLine(c)}</span>
    <span class="sb-l res ${c.k}">${took(c)}</span>
  </span>
  <span class="sb-rstack">
    <span class="sb-pts ${c.k}">${c.pts}</span>
    <span class="sb-word ${c.k}">${word(c.k)}</span></span></div>`;

const WIN  = f => card('CHI', 'CAR', 'FOX', 'CHI -3',   59, 37, 'a', poolBar('CHI', 77, 'CAR', 23), f);
const LOSS = f => card('ARI', 'LAC', 'CBS', 'LAC -8.5', 26, 14, 'a', poolBar('ARI',  8, 'LAC', 92), f);
const TIEC = f => card('NO',  'DET', 'FOX', 'DET -7',   30, 30, null, poolBar('NO',   8, 'DET', 92), f);
/* A long name and a two-digit rank, because "Commanders" plus "Rank 16"
   is the widest this line ever gets and 320px is where it breaks. */
const WIDE = f => card('WSH', 'PHI', 'FOX', 'PHI -6',   22, 24, 'h', poolBar('WSH',  4, 'PHI', 96), f);
const WIDEC = { k: 'l', took: 'WSH', rank: 16, pts: '0 pts', fin: 'PHI 24-22' };

const OPTS = [
  ['X1 — score above, result below',
   'The game’s own line sits quiet on top; the line about YOU is the coloured one.',
   X1],
  ['X2 — result above, score below',
   'The other way round: what you scored first, what the game did under it.',
   X2],
  ['X3 — one line, everything on it',
   'Rendered so the width question is answered by a screenshot, not an opinion.',
   X3],
  ['X4 — two lines, points moved up beside the score',
   'The pill ends up alone on the second line, so the bar reads as two balanced rows.',
   X4],
];

const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800;900&family=Roboto+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>
${STYLE}
/* ---- MOCKUP CHROME ONLY. Nothing below touches a card rule, a font or
   a palette token. NOT called .sheet — that is the app's rank tray,
   position:fixed and translated off screen, and naming a container
   "sheet" rendered a whole earlier sheet as pure black. ---- */
.mocksheet{margin:0 auto;padding:0 0 28px}
.opt{padding:22px 14px 4px}
.opt h3{margin:0;font-size:13px;font-weight:900;color:var(--paper)}
.opt p{margin:4px 0 12px;font-size:10.5px;line-height:1.45;color:var(--chalk)}
.pairlab{padding:0 14px 6px;font-size:8.5px;font-weight:800;letter-spacing:.16em;
  text-transform:uppercase;color:var(--chalk-faint)}
.rule{height:1px;background:rgba(250,247,241,.09);margin:18px 14px 0}
.wlab{padding:14px 14px 2px;font-size:11px;font-weight:900;letter-spacing:.14em;
  text-transform:uppercase;color:var(--lock)}

/* ---- THE ONLY NEW RULES THE APP WOULD NEED ----------------------- */
/* A PAPER-SIDE RED. --stamp is 4.32:1 on this card's #EDE8DE, which is
   under the floor for text this size; #BE2F26 is 4.75:1 and reads as
   the same red. The mirror of .lockband .miss, which exists because
   --stamp measured 3.18:1 on the DARK strip. */
.resbar{--stamp-ink:#BE2F26}

/* The result bar sits where the stake bar sits, and is not a button. */
.resbar{cursor:default;border-top:1px solid var(--rule)}
/* Two lines need the height. 44 -> 54, and align-items goes to centre
   on a column so the two rows stay optically level with the pill. */
.resbar.two{height:54px;align-items:center}
.sb-stack{display:flex;flex-direction:column;gap:3px;min-width:0}
.sb-fin{font-size:9px;font-weight:800;letter-spacing:.11em;text-transform:uppercase;
  color:var(--ink-faint);white-space:nowrap}
.sb-l.res{font-weight:800}
.sb-l.res.w{color:var(--hit)}
.sb-l.res.l,.sb-l.res.none{color:var(--stamp-ink)}
.sb-l.res.tie{color:var(--ink-soft)}
/* One line has to be allowed to shrink, or it pushes the pill off the
   card instead of ellipsing. */
.sb-l.one{min-width:0;overflow:hidden;text-overflow:ellipsis;font-weight:800}
.sb-pts.w{color:var(--hit)}
.sb-pts.l,.sb-pts.none{color:var(--stamp-ink)}
.sb-pts.tie{color:var(--ink-faint)}
.sb-word{height:26px;display:grid;place-items:center;padding:0 9px;border-radius:13px;
  border:2px solid;font-size:11px;font-weight:900;letter-spacing:.04em;
  white-space:nowrap;transform:rotate(-7deg)}
.sb-word.w{border-color:var(--hit);color:var(--hit)}
.sb-word.l,.sb-word.none{border-color:var(--stamp-ink);color:var(--stamp-ink)}
.sb-word.tie{border-color:var(--ink-faint);color:var(--ink-faint)}
.sb-rstack{display:flex;flex-direction:column;align-items:flex-end;gap:4px}
.resbar.x4 .sb-word{transform:rotate(-7deg) scale(.92);transform-origin:right center}
</style></head><body><div class="mocksheet">
${OPTS.map(([h, p, fn]) => `
  <div class="opt"><h3>${h}</h3><p>${p}</p></div>
  <div class="pairlab">your pick won</div>
  ${WIN(fn(CASES.win))}
  <div class="pairlab">your pick lost</div>
  ${LOSS(fn(CASES.loss))}
  <div class="rule"></div>`).join('')}

  <div class="wlab">X1, the other two states</div>
  <div class="pairlab">no pick at all</div>
  ${LOSS(X1(CASES.none))}
  <div class="pairlab">ended level &mdash; nothing decided</div>
  ${TIEC(X1(CASES.tie))}
  <div class="rule"></div>

  <div class="wlab">X1, the widest this line ever gets</div>
  <div class="pairlab">longest team name, two-digit rank</div>
  ${WIDE(X1(WIDEC))}
  <div class="pairlab">the same on X3, one line</div>
  ${WIDE(X3(WIDEC))}
</div></body></html>`;

fs.writeFileSync('/tmp/claude-0/mock-x.html', html);

const b = await chromium.launch();
for (const width of [390, 320]) {
  const ctx = await b.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto('file:///tmp/claude-0/mock-x.html', { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
  const out = new URL(`../../docs/mockups/result-pill-X-series-${width}.png`,
                      import.meta.url).pathname;
  await page.screenshot({ path: out, fullPage: true });

  /* MEASURED, NOT EYEBALLED — twice before, a width check said it fitted
     and looking at the render showed the wrap. So: does any line in any
     bar overflow its box, and does any bar overflow its card. */
  const bad = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('.resbar').forEach((bar, i) => {
      const card = bar.closest('.card').getBoundingClientRect();
      const b = bar.getBoundingClientRect();
      if (b.width - card.width > 1) out.push({ i, why: 'bar wider than card' });
      bar.querySelectorAll('.sb-fin, .sb-l, .sb-pts, .sb-word').forEach(el => {
        if (el.scrollWidth > el.clientWidth + 1)
          out.push({ i, why: 'clipped', cls: el.className,
                     txt: el.textContent.trim().slice(0, 34),
                     need: el.scrollWidth, got: el.clientWidth });
      });
    });
    return out;
  });
  console.log(`${width}px  overflow/clip problems: ${bad.length}`);
  bad.forEach(x => console.log('   ', JSON.stringify(x)));
  console.log('   written', out);
  await ctx.close();
}
await b.close();
