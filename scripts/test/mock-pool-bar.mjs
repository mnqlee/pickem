/* MOCKUP SHEET — the V series. The pool bar, when one side is too
   narrow to hold its own label.

   THE ASK: put the small side's percentage on the OTHER side of the
   split, in the big segment, right next to the sliver it belongs to —
   instead of dropping it out of the bar and letting the sub-line carry
   it.

   HOW, without touching .cseg's overflow. The label does not overhang
   its own segment; it is rendered INSIDE the big segment as a second
   child, and the big segment goes justify-content:space-between so its
   own label sits at the far end and the borrowed one sits at the near
   end, hard against the sliver. Nothing overflows, nothing is clipped,
   and .cseg keeps overflow:hidden — which it needs, because that is
   what stops a long label breaking a narrow segment.

   Only ONE side can ever be small: the two percentages sum to 100, so
   below 22% on one side means above 78% on the other. And the big
   segment always has room for two labels — at 320px a 78% segment is
   ~208px against two labels of about 50px each plus padding.

   Heads are Z1 throughout: centred, no tick, no dot.

   A THING THIS SHEET ALSO SURFACES, which is not mine and is not new:
   .cseg paints its label #fff on the team's own primary, and four
   primaries are under 4.5:1 for white text — CIN #FB4F14 at 3.37:1,
   MIA #008E97 at 3.95, CAR #0085CA at 4.03, LAC #0080C6 at 4.28. That
   is true today, on their own labels, before any borrowing. V4 shows it
   fixed with onColor(), the luminance test the team badges already use.

   Run: node mock-pool-bar.mjs
   Out: docs/mockups/pool-bar-V-series-390.png
        docs/mockups/pool-bar-V-series-320.png
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
  NYG: ['New York', 'Giants', '#0B2265', '#A71930'],
  DAL: ['Dallas', 'Cowboys', '#003594', '#869397'],
  CIN: ['Cincinnati', 'Bengals', '#FB4F14', '#000000'],
  CLE: ['Cleveland', 'Browns', '#311D00', '#FF3C00'],
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

/* ---- the bar. `mode` picks the variant ---------------------------- */
const SMALL = 22;
const cbar = (g, mode) => {
  const { a, h, ap, hp } = g;
  const aSmall = ap > 0 && ap < SMALL, hSmall = hp > 0 && hp < SMALL;
  const ink = code => mode === 'V4' ? `;color:${onColor(T[code][2])}` : '';
  const own = (code, pct) => `<span>${code} ${pct}%</span>`;
  const lent = (code, pct) => {
    const chip = mode === 'V3'
      ? `<i class="chip" style="background:${T[code][2]}"></i>` : '';
    return `<span class="lent${mode === 'V2' ? ' dim' : ''}">${chip}${code} ${pct}%</span>`;
  };
  // TODAY: a small segment simply drops its label and the bar says
  // nothing about that side at all.
  let aIn = aSmall ? '' : own(a, ap);
  let hIn = hSmall ? '' : own(h, hp);
  if (mode !== 'today') {
    // The small side's label crosses the split into the big segment and
    // sits hard against the sliver it describes.
    if (aSmall && hp > 0) hIn = lent(a, ap) + own(h, hp);
    if (hSmall && ap > 0) aIn = own(a, ap) + lent(h, hp);
  }
  const two = inner => inner.split('<span').length - 1 > 1 ? ' twolab' : '';
  const seg = (pct, code, cls, inner) => pct === 0 ? '' :
    `<div class="cseg ${cls}${two(inner)}" style="width:${pct}%;background:${
      T[code][2]}${ink(code)}">${inner}</div>`;
  /* The sub-line's whole job was to pick up a percentage the bar could
     not print. Once the bar prints it, that job is done and the line
     goes back to the count — except in V2b, kept to show the
     duplication so it can be ruled out on sight. */
  const subParts = mode === 'today' || mode === 'V2b'
    ? [ap < SMALL ? `${a} ${ap}%` : '', hp < SMALL ? `${h} ${hp}%` : '', '26 picks']
    : ['26 picks'];
  return `<div class="cons">
    <div class="cons-head"><span>How the pool picked</span>
      ${g.upset ? '<i class="upset">Pool got it wrong</i>' : ''}</div>
    <div class="cbar">${seg(ap, a, 'l', aIn)}${seg(hp, h, 'r', hIn)}</div>
    <div class="cons-sub mono">${subParts.filter(Boolean).join(' &middot; ')}</div></div>`;
};

const bar = c => `<div class="stakebar resbar">
  <span class="sb-l res ${c.k}">${c.left}</span>
  <span class="sb-r">
    <span class="sb-pts ${c.k}">${c.pts}</span>
    <span class="sb-word ${c.k}">${c.word}</span></span></div>`;

/* Z1: centred, no tick, no dot. */
const head = g => `<div class="meta fmeta">
  <span class="fin mono"><b>Final</b> &middot; ${g.fin}</span></div>`;

const card = (g, mode, foot) => `
<div class="card locked">
  ${head(g)}
  <div class="match">
    ${side(g.a, 'l', g.won === 'a' ? 'won' : 'lost', g.as)}
    <div class="gutter"><span>@</span></div>
    ${side(g.h, 'r', g.won === 'h' ? 'won' : 'lost', g.hs)}
  </div>
  ${cbar(g, mode)}
  ${foot}
</div>`;

const G = {
  // small side on the LEFT (4%)
  left4:  { a: 'WSH', h: 'PHI', as: 22, hs: 24, won: 'h', ap: 4,  hp: 96,
            fin: 'PHI 24-22' },
  // small side on the RIGHT (8%)
  right8: { a: 'ARI', h: 'LAC', as: 26, hs: 14, won: 'a', ap: 92, hp: 8,
            fin: 'ARI 26-14', upset: true },
  // just under the threshold, both ways
  edge19: { a: 'DAL', h: 'NYG', as: 20, hs: 28, won: 'h', ap: 81, hp: 19,
            fin: 'NYG 28-20', upset: true },
  // comfortably over it: nothing borrows, nothing changes
  normal: { a: 'CHI', h: 'CAR', as: 59, hs: 37, won: 'a', ap: 77, hp: 23,
            fin: 'CHI 59-37' },
  // unanimous: one segment, nothing to borrow from
  unan:   { a: 'CLE', h: 'CIN', as: 10, hs: 34, won: 'h', ap: 0,  hp: 100,
            fin: 'CIN 34-10' },
  // a light primary holding BOTH labels — the contrast case
  light:  { a: 'CIN', h: 'CLE', as: 33, hs: 27, won: 'a', ap: 91, hp: 9,
            fin: 'CIN 33-27' },
};
const S = {
  wshLoss: { k: 'l', left: 'You took WSH &middot; Rank 16', pts: '0 pts',  word: 'LOSS' },
  lacLoss: { k: 'l', left: 'You took LAC &middot; Rank 3',  pts: '0 pts',  word: 'LOSS' },
  nygWin:  { k: 'w', left: 'You took NYG &middot; Rank 12', pts: '+5 pts', word: 'WIN' },
  chiWin:  { k: 'w', left: 'You took CHI &middot; Rank 9',  pts: '+8 pts', word: 'WIN' },
  cinWin:  { k: 'w', left: 'You took CIN &middot; Rank 6',  pts: '+11 pts', word: 'WIN' },
  cleLoss: { k: 'l', left: 'You took CLE &middot; Rank 2',  pts: '0 pts',  word: 'LOSS' },
};

const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800;900&family=Roboto+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>
${STYLE}
/* ---- MOCKUP CHROME ONLY. Not .sheet: that is the app's rank tray. ---- */
.mocksheet{margin:0 auto;padding:0 0 28px}
.opt{padding:22px 14px 4px}
.opt h3{margin:0;font-size:13px;font-weight:900;color:var(--paper)}
.opt p{margin:4px 0 12px;font-size:10.5px;line-height:1.45;color:var(--chalk)}
.pairlab{padding:0 14px 6px;font-size:8.5px;font-weight:800;letter-spacing:.16em;
  text-transform:uppercase;color:var(--chalk-faint)}
.rule{height:1px;background:rgba(250,247,241,.09);margin:18px 14px 0}
.wlab{padding:16px 14px 2px;font-size:11px;font-weight:900;letter-spacing:.14em;
  text-transform:uppercase;color:var(--lock)}

/* ---- Z1's head, and the result bar, both already chosen ----------- */
.meta.fmeta{justify-content:center}
.meta.fmeta>:first-child{margin-right:0}
.meta .fin{white-space:nowrap;letter-spacing:.01em}
.meta .fin b{font-weight:800;letter-spacing:.09em;text-transform:uppercase;
  color:var(--ink-mute)}
.resbar{--sink:#BE2F26;cursor:default;border-top:1px solid var(--rule)}
.sb-l.res{font-weight:800}
.sb-l.res.w{color:var(--hit)}
.sb-l.res.l{color:var(--sink)}
.sb-pts.w{color:var(--hit)}
.sb-pts.l{color:var(--sink)}
.sb-word{height:26px;display:grid;place-items:center;padding:0 9px;border-radius:13px;
  border:2px solid;font-size:11px;font-weight:900;letter-spacing:.04em;
  white-space:nowrap;transform:rotate(-7deg)}
.sb-word.w{border-color:var(--hit);color:var(--hit)}
.sb-word.l{border-color:var(--sink);color:var(--sink)}

/* ---- THE ONLY NEW RULE THE BAR WOULD NEED ------------------------ */
/* A segment carrying TWO labels pushes them to its two ends, so the
   borrowed one lands hard against the sliver it belongs to and the
   segment's own stays at the far end where it has always been. The
   side-specific padding is replaced by symmetric padding, because the
   segment now has content at both ends. */
.cseg.twolab{justify-content:space-between;padding:0 8px}
.cseg .lent{display:inline-flex;align-items:center;gap:4px}
.cseg .lent.dim{opacity:.78}
.cseg .chip{width:7px;height:7px;border-radius:2px;display:inline-block;
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.55)}
</style></head><body><div class="mocksheet">

  <div class="opt"><h3>What happens today</h3>
    <p>A segment under 22% drops its label, so the bar says nothing at
      all about that side and the sub-line underneath has to carry it.</p></div>
  <div class="pairlab">4% on the left</div>
  ${card(G.left4, 'today', bar(S.wshLoss))}
  <div class="pairlab">8% on the right</div>
  ${card(G.right8, 'today', bar(S.lacLoss))}

  <div class="rule"></div>
  <div class="opt"><h3>V1 &mdash; the label crosses the split</h3>
    <p>The small side&rsquo;s figure sits inside the big segment, hard
      against its own sliver. The sub-line goes back to just the count,
      because the bar now prints every number.</p></div>
  <div class="pairlab">4% on the left</div>
  ${card(G.left4, 'V1', bar(S.wshLoss))}
  <div class="pairlab">8% on the right</div>
  ${card(G.right8, 'V1', bar(S.lacLoss))}
  <div class="pairlab">19% &mdash; just under the threshold</div>
  ${card(G.edge19, 'V1', bar(S.nygWin))}

  <div class="rule"></div>
  <div class="opt"><h3>V2 &mdash; V1 with the borrowed figure dimmed</h3>
    <p>78% opacity, so it reads as the other side&rsquo;s number sitting
      on loan rather than as part of the segment it is printed on.</p></div>
  <div class="pairlab">4% on the left</div>
  ${card(G.left4, 'V2', bar(S.wshLoss))}
  <div class="pairlab">8% on the right</div>
  ${card(G.right8, 'V2', bar(S.lacLoss))}

  <div class="opt"><h3>V3 &mdash; V1 with a colour chip</h3>
    <p>A 7px square of the small team&rsquo;s own colour in front of the
      figure, so whose number it is needs no working out.</p></div>
  <div class="pairlab">4% on the left</div>
  ${card(G.left4, 'V3', bar(S.wshLoss))}
  <div class="pairlab">8% on the right</div>
  ${card(G.right8, 'V3', bar(S.lacLoss))}

  <div class="rule"></div>
  <div class="wlab">The two cases where nothing should change</div>
  <div class="opt"><p>Only one side can ever be small &mdash; the two add
    to 100, so under 22% on one means over 78% on the other. And a
    unanimous pool has one segment with nothing to borrow from.</p></div>
  <div class="pairlab">77 / 23 &mdash; both label themselves, as now</div>
  ${card(G.normal, 'V1', bar(S.chiWin))}
  <div class="pairlab">100 / 0 &mdash; one segment, nothing borrowed</div>
  ${card(G.unan, 'V1', bar(S.cinWin))}

  <div class="rule"></div>
  <div class="wlab">A contrast problem that is already there</div>
  <div class="opt"><p><b>.cseg paints its label #fff on the team&rsquo;s
    own primary</b>, and four primaries are under 4.5:1 for white text:
    Cincinnati #FB4F14 at <b>3.37:1</b>, Miami #008E97 at 3.95, Carolina
    #0085CA at 4.03, the Chargers #0080C6 at 4.28. That is true today on
    their own labels, before any of this. Borrowing puts a second label
    on the same colour, so it is worth fixing at the same time &mdash;
    with onColor(), the luminance test the team badges already use.</p></div>
  <div class="pairlab">V1 on Cincinnati orange &mdash; white, 3.37:1</div>
  ${card(G.light, 'V1', bar(S.cinWin))}
  <div class="pairlab">V4 &mdash; the same bar, label ink chosen by onColor()</div>
  ${card(G.light, 'V4', bar(S.cinWin))}
  <div class="pairlab">V4 on the Chargers&rsquo; blue, for comparison</div>
  ${card(G.right8, 'V4', bar(S.lacLoss))}
</div></body></html>`;

fs.writeFileSync('/tmp/claude-0/mock-v.html', html);

const b = await chromium.launch();
for (const width of [390, 320]) {
  const ctx = await b.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto('file:///tmp/claude-0/mock-v.html', { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
  const out = new URL(`../../docs/mockups/pool-bar-V-series-${width}.png`,
                      import.meta.url).pathname;
  await page.screenshot({ path: out, fullPage: true });

  /* MEASURED. The borrowed label lives INSIDE a segment that still has
     overflow:hidden, so the only way it can go wrong is by being
     clipped — which would be silent. Check every label in every
     segment, and check the borrowed one really is on the sliver's side
     of the split. */
  const r = await page.evaluate(() => {
    const out = { clipped: [], wrongSide: [], stacked: 0 };
    document.querySelectorAll('.cbar').forEach((bar, i) => {
      const segs = [...bar.children];
      if (segs.length > 1) {
        const r0 = segs[0].getBoundingClientRect(), r1 = segs[1].getBoundingClientRect();
        if (Math.abs(r0.top - r1.top) > 1) out.stacked++;
      }
      segs.forEach(seg => {
        const sr = seg.getBoundingClientRect();
        seg.querySelectorAll('span').forEach(el => {
          if (el.scrollWidth > el.clientWidth + 1)
            out.clipped.push({ bar: i, txt: el.textContent.trim(),
                               need: el.scrollWidth, got: el.clientWidth });
        });
        const lent = seg.querySelector('.lent');
        if (lent) {
          // the borrowed label must sit at the segment edge that touches
          // the other segment, not at its far end
          const lr = lent.getBoundingClientRect();
          const isRightSeg = seg.classList.contains('r');
          const nearLeft = (lr.left - sr.left) < (sr.right - lr.right);
          if (isRightSeg ? !nearLeft : nearLeft)
            out.wrongSide.push({ bar: i, txt: lent.textContent.trim() });
        }
      });
    });
    return out;
  });
  console.log(`${width}px  clipped labels: ${r.clipped.length}` +
              `   borrowed label on the wrong end: ${r.wrongSide.length}` +
              `   stacked bars: ${r.stacked}`);
  r.clipped.forEach(x => console.log('    clipped', JSON.stringify(x)));
  r.wrongSide.forEach(x => console.log('    wrong end', JSON.stringify(x)));
  console.log('   written', out);
  await ctx.close();
}
await b.close();
