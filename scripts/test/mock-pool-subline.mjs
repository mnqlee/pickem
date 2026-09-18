/* MOCKUP SHEET — the W series. The small side's figure moves OUT of the
   other team's segment and sits below the bar, on the card paper, always
   on the same side as its own sliver, with a chip in that team's colour.

   WHERE IT GOES. The sub-line under the bar already exists and already
   carries exactly this number today — it just prints it as plain text
   at the left, wherever the sliver happens to be. So nothing new is
   added: the line becomes a two-ended row, the small team's chip and
   figure pin to the sliver's side, and the pick count takes the other
   end. Small side on the left, the figure is on the left; small side on
   the right, it is on the right, directly under the sliver.

   THE CHIP CARRIES THE COLOUR, THE TEXT DOES NOT, and that is measured
   rather than chosen. As TEXT on the card's #EDE8DE paper, SEVEN team
   primaries fail 4.5:1 — Cincinnati #FB4F14 at 2.76:1, Miami 3.24,
   Carolina 3.30, the Chargers 3.51, Kansas City 3.86, Detroit 4.03,
   Tampa Bay 4.44. As a CHIP, which is a graphic and wants 3:1, only
   Cincinnati fails, at 2.76 — and a hairline ring fixes that, which is
   why .mark already carries one. So: coloured square, normal ink.
   W2 shows the coloured-text version so it can be ruled out on sight.

   Heads are Z1: centred, no tick, no dot.

   Run: node mock-pool-subline.mjs
   Out: docs/mockups/pool-subline-W-series-390.png
        docs/mockups/pool-subline-W-series-320.png
*/
import { chromium } from 'playwright';
import fs from 'node:fs';

const APP = fs.readFileSync(new URL('../../index.html', import.meta.url).pathname, 'utf8');
const STYLE = APP.slice(APP.indexOf('<style>') + 7, APP.indexOf('</style>'));

const T = {
  CHI: ['Chicago', 'Bears', '#0B162A', '#C83803'],
  CAR: ['Carolina', 'Panthers', '#0085CA', '#101820'],
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

const SMALL = 22;
const cbar = (g, mode) => {
  const { a, h, ap, hp } = g;
  const aSmall = ap > 0 && ap < SMALL, hSmall = hp > 0 && hp < SMALL;
  const seg = (pct, code, cls) => pct === 0 ? '' :
    `<div class="cseg ${cls}" style="width:${pct}%;background:${T[code][2]}">${
      pct >= SMALL ? `<span>${code} ${pct}%</span>` : ''}</div>`;

  /* The chip: the small team's own colour. `ring` is W3, a hairline so a
     chip whose colour is close to the paper cannot disappear. */
  const chip = code => `<i class="pchip${mode === 'W3' ? ' ring' : ''}"
    style="background:${T[code][2]}"></i>`;
  const tint = code => mode === 'W2' ? ` style="color:${T[code][2]}"` : '';
  const smallCode = aSmall ? a : hSmall ? h : null;
  const smallPct  = aSmall ? ap : hSmall ? hp : null;
  const note = smallCode
    ? `<span class="psmall"${tint(smallCode)}>${chip(smallCode)}${
        smallCode} ${smallPct}%</span>` : '';
  const count = `<span class="pcount">26 picks</span>`;

  let sub;
  if (mode === 'today') {
    // What ships: plain text, always at the left, whichever side is small.
    sub = `<div class="cons-sub mono">${
      [smallCode ? `${smallCode} ${smallPct}%` : '', '26 picks']
        .filter(Boolean).join(' &middot; ')}</div>`;
  } else if (!smallCode) {
    // Nothing is small: the line is the count, where it has always been.
    sub = `<div class="cons-sub mono">${count}</div>`;
  } else if (mode === 'W4') {
    // Two rows: the small team's figure alone on its own row, pinned to
    // its side; the count on the row under it.
    sub = `<div class="cons-sub mono subrow ${aSmall ? 'l' : 'r'}">${note}</div>
           <div class="cons-sub mono subrow2">${count}</div>`;
  } else {
    // One row, two ends. The figure takes the sliver's side.
    sub = `<div class="cons-sub mono subflex">${
      aSmall ? note + count : count + note}</div>`;
  }

  return `<div class="cons">
    <div class="cons-head"><span>How the pool picked</span>
      ${g.upset ? '<i class="upset">Pool got it wrong</i>' : ''}</div>
    <div class="cbar">${seg(ap, a, 'l')}${seg(hp, h, 'r')}</div>
    ${sub}</div>`;
};

const bar = c => `<div class="stakebar resbar">
  <span class="sb-l res ${c.k}">${c.left}</span>
  <span class="sb-r">
    <span class="sb-pts ${c.k}">${c.pts}</span>
    <span class="sb-word ${c.k}">${c.word}</span></span></div>`;

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
  right8: { a: 'ARI', h: 'LAC', as: 26, hs: 14, won: 'a', ap: 92, hp: 8,
            fin: 'ARI 26-14', upset: true },
  left4:  { a: 'WSH', h: 'PHI', as: 22, hs: 24, won: 'h', ap: 4,  hp: 96,
            fin: 'PHI 24-22' },
  edge19: { a: 'DAL', h: 'NYG', as: 20, hs: 28, won: 'h', ap: 81, hp: 19,
            fin: 'NYG 28-20', upset: true },
  normal: { a: 'CHI', h: 'CAR', as: 59, hs: 37, won: 'a', ap: 77, hp: 23,
            fin: 'CHI 59-37' },
  unan:   { a: 'CLE', h: 'CIN', as: 10, hs: 34, won: 'h', ap: 0,  hp: 100,
            fin: 'CIN 34-10' },
  // Cincinnati orange is the one colour that fails even as a chip.
  cinSmall: { a: 'CLE', h: 'CIN', as: 27, hs: 20, won: 'a', ap: 93, hp: 7,
              fin: 'CLE 27-20', upset: true },
};
const S = {
  lacLoss: { k: 'l', left: 'You took LAC &middot; Rank 3',  pts: '0 pts',  word: 'LOSS' },
  wshLoss: { k: 'l', left: 'You took WSH &middot; Rank 16', pts: '0 pts',  word: 'LOSS' },
  nygWin:  { k: 'w', left: 'You took NYG &middot; Rank 12', pts: '+5 pts', word: 'WIN' },
  chiWin:  { k: 'w', left: 'You took CHI &middot; Rank 9',  pts: '+8 pts', word: 'WIN' },
  cinWin:  { k: 'w', left: 'You took CIN &middot; Rank 6',  pts: '+11 pts', word: 'WIN' },
  cleWin:  { k: 'w', left: 'You took CLE &middot; Rank 4',  pts: '+13 pts', word: 'WIN' },
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

/* ---- already chosen: Z1's head and the result bar ----------------- */
.meta.fmeta{justify-content:center}
.meta.fmeta>:first-child{margin-right:0}
.meta .fin{white-space:nowrap;letter-spacing:.01em}
.meta .fin b{font-weight:800;letter-spacing:.09em;text-transform:uppercase;
  color:var(--ink-mute)}
.resbar{--sink:#BE2F26;cursor:default;border-top:1px solid var(--rule)}
.sb-l.res{font-weight:800}
.sb-l.res.w{color:var(--hit)}.sb-l.res.l{color:var(--sink)}
.sb-pts.w{color:var(--hit)}.sb-pts.l{color:var(--sink)}
.sb-word{height:26px;display:grid;place-items:center;padding:0 9px;border-radius:13px;
  border:2px solid;font-size:11px;font-weight:900;letter-spacing:.04em;
  white-space:nowrap;transform:rotate(-7deg)}
.sb-word.w{border-color:var(--hit);color:var(--hit)}
.sb-word.l{border-color:var(--sink);color:var(--sink)}

/* ---- THE NEW RULES THE SUB-LINE WOULD NEED ----------------------- */
/* One row, two ends: the small team's figure pins to the sliver's side
   and the pick count takes the other. The DOM order decides which is
   which, so no side-specific CSS is needed. */
.cons-sub.subflex{display:flex;align-items:center;justify-content:space-between;gap:10px}
/* W4's two rows. */
.cons-sub.subrow{display:flex}
.cons-sub.subrow.l{justify-content:flex-start}
.cons-sub.subrow.r{justify-content:flex-end}
.cons-sub.subrow2{margin-top:3px}
.psmall{display:inline-flex;align-items:center;gap:5px;font-weight:700}
.pcount{color:var(--ink-soft)}
/* The chip is a GRAPHIC, so 3:1 is the bar, and only Cincinnati's
   #FB4F14 fails it against this paper at 2.76:1. The ring in W3 is the
   same device .mark already uses for the same reason. */
.pchip{width:9px;height:9px;border-radius:2px;display:inline-block;flex:0 0 9px}
.pchip.ring{box-shadow:inset 0 0 0 1px rgba(20,22,26,.30)}
</style></head><body><div class="mocksheet">

  <div class="opt"><h3>What ships today</h3>
    <p>The figure is already on this line &mdash; as plain text, always
      at the left, whichever side the sliver is on.</p></div>
  <div class="pairlab">8% on the right &mdash; figure sits far from it</div>
  ${card(G.right8, 'today', bar(S.lacLoss))}

  <div class="rule"></div>
  <div class="opt"><h3>W1 &mdash; below the bar, on the sliver&rsquo;s side, with a chip</h3>
    <p>One row, two ends. Small side on the right, the figure is on the
      right, directly under its own sliver; the pick count takes the
      other end. Chip in that team&rsquo;s colour, text in the line&rsquo;s
      normal ink.</p></div>
  <div class="pairlab">8% on the right</div>
  ${card(G.right8, 'W1', bar(S.lacLoss))}
  <div class="pairlab">4% on the left</div>
  ${card(G.left4, 'W1', bar(S.wshLoss))}
  <div class="pairlab">19% &mdash; just under the threshold</div>
  ${card(G.edge19, 'W1', bar(S.nygWin))}

  <div class="rule"></div>
  <div class="opt"><h3>W2 &mdash; W1 with the figure in the team&rsquo;s colour</h3>
    <p>Shown to be ruled out. As TEXT on this paper, seven primaries
      fail 4.5:1 &mdash; the Chargers&rsquo; #0080C6 is <b>3.51:1</b>,
      Cincinnati <b>2.76:1</b>. The chip can carry the colour because a
      graphic only needs 3:1; the words cannot.</p></div>
  <div class="pairlab">8% on the right &mdash; Chargers blue as text, 3.51:1</div>
  ${card(G.right8, 'W2', bar(S.lacLoss))}

  <div class="opt"><h3>W3 &mdash; W1 with a hairline round the chip</h3>
    <p>Cincinnati&rsquo;s orange is 2.76:1 against this paper and is the
      one chip that can fade into it. The ring is the same device
      <code>.mark</code> already uses.</p></div>
  <div class="pairlab">7% Cincinnati, no ring</div>
  ${card(G.cinSmall, 'W1', bar(S.cleWin))}
  <div class="pairlab">7% Cincinnati, with the ring</div>
  ${card(G.cinSmall, 'W3', bar(S.cleWin))}

  <div class="opt"><h3>W4 &mdash; two rows</h3>
    <p>The figure alone on its own row, pinned to the sliver&rsquo;s
      side; the count on the row below. Costs the card about 13px.</p></div>
  <div class="pairlab">8% on the right</div>
  ${card(G.right8, 'W4', bar(S.lacLoss))}
  <div class="pairlab">4% on the left</div>
  ${card(G.left4, 'W4', bar(S.wshLoss))}

  <div class="rule"></div>
  <div class="wlab">The two cases where nothing changes</div>
  <div class="opt"><p>Only one side can be small &mdash; the two add to
    100. And a unanimous pool has one segment, so there is no small side
    at all. In both, the line is just the count, where it has always
    been.</p></div>
  <div class="pairlab">77 / 23 &mdash; both label themselves in the bar</div>
  ${card(G.normal, 'W1', bar(S.chiWin))}
  <div class="pairlab">100 / 0</div>
  ${card(G.unan, 'W1', bar(S.cinWin))}
</div></body></html>`;

fs.writeFileSync('/tmp/claude-0/mock-w2.html', html);

const b = await chromium.launch();
for (const width of [390, 320]) {
  const ctx = await b.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto('file:///tmp/claude-0/mock-w2.html', { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
  const out = new URL(`../../docs/mockups/pool-subline-W-series-${width}.png`,
                      import.meta.url).pathname;
  await page.screenshot({ path: out, fullPage: true });

  /* MEASURED. The one thing that has to be true and could silently not
     be: the figure is on the SAME SIDE as its own sliver. Compare the
     centre of the label with the centre of the bar, and the centre of
     the small segment with the centre of the bar — they have to agree. */
  const r = await page.evaluate(() => {
    const out = { wrongSide: [], clipped: [], noSliver: 0 };
    document.querySelectorAll('.cons').forEach((cons, i) => {
      const bar = cons.querySelector('.cbar');
      const note = cons.querySelector('.psmall');
      if (!note) return;
      const br = bar.getBoundingClientRect();
      const mid = (br.left + br.right) / 2;
      // which segment is the small one
      const segs = [...bar.children];
      const small = segs.reduce((m, s) =>
        s.getBoundingClientRect().width < m.getBoundingClientRect().width ? s : m);
      const sr = small.getBoundingClientRect(), nr = note.getBoundingClientRect();
      const sliverRight = (sr.left + sr.right) / 2 > mid;
      const noteRight = (nr.left + nr.right) / 2 > mid;
      if (sliverRight !== noteRight)
        out.wrongSide.push({ cons: i, txt: note.textContent.trim(),
                             sliver: sliverRight ? 'right' : 'left',
                             note: noteRight ? 'right' : 'left' });
      if (note.scrollWidth > note.clientWidth + 1)
        out.clipped.push({ cons: i, txt: note.textContent.trim() });
      if (!small || sr.width < 1) out.noSliver++;
    });
    return out;
  });
  console.log(`${width}px  figure on the wrong side: ${r.wrongSide.length}` +
              `   clipped: ${r.clipped.length}`);
  r.wrongSide.forEach(x => console.log('    ', JSON.stringify(x)));
  r.clipped.forEach(x => console.log('    ', JSON.stringify(x)));
  console.log('   written', out);
  await ctx.close();
}
await b.close();
