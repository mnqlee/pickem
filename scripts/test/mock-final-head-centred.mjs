/* MOCKUP SHEET — the Z series. Y1 with the head CENTRED, plus a fix to
   my own mockup.

   THE DOUBLE BAR WAS MY MOCKUP, NOT THE APP. The pool block in the Y and
   X sheets rendered as two stacked bars because I hand-wrote its markup
   and got it wrong in two ways at once: the container is `.cbar`, not
   `.consbar` — so it picked up no CSS at all and the two segments became
   block-level rows — and the segments are sized with `width:<pct>%`, not
   `flex:<pct>`. The header is `.cons-head` wrapping a <span>, not
   `.cons-h`. Nothing in the app was ever wrong; the live screenshots
   show it correct.

   So this sheet stops hand-writing it. consBlock() below is
   consensusBar() from index.html, copied line for line, including the
   3px gap that exists because 151 of the 496 possible matchups put two
   team colours under 1.3:1 against each other and six pairs are the
   SAME hex — the gap is what makes the split visible on those.

   The four heads here are all CENTRED. Z1 is the plain one; the others
   vary only in how the word FINAL is set, since that is the remaining
   choice.

   Run: node mock-final-head-centred.mjs
   Out: docs/mockups/final-head-Z-centred-390.png
        docs/mockups/final-head-Z-centred-320.png
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
  BUF: ['Buffalo', 'Bills', '#00338D', '#C60C30'],
  NYG: ['New York', 'Giants', '#0B2265', '#A71930'],
  DAL: ['Dallas', 'Cowboys', '#003594', '#869397'],
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

/* consensusBar() FROM index.html, COPIED. Segments sized by width:%,
   container is .cbar, header is .cons-head > span, and the sub-line
   picks up any percentage a segment under 22% could not print. */
const consBlock = g => {
  const seg = (pct, code, sideCls) => pct === 0 ? '' :
    `<div class="cseg ${sideCls}" style="width:${pct}%;background:${T[code][2]}">${
      pct >= 22 ? `<span>${code} ${pct}%</span>` : ''}</div>`;
  const upset = g.upset;
  return `<div class="cons">
    <div class="cons-head">
      <span>How the pool picked</span>
      ${upset ? '<i class="upset">Pool got it wrong</i>' : ''}
    </div>
    <div class="cbar">${seg(g.ap, g.a, 'l')}${seg(g.hp, g.h, 'r')}</div>
    <div class="cons-sub mono">${
      [g.ap < 22 ? `${g.a} ${g.ap}%` : '', g.hp < 22 ? `${g.h} ${g.hp}%` : '',
       `26 picks`].filter(Boolean).join(' &middot; ')}</div></div>`;
};

/* ---- four CENTRED heads. The only remaining choice is how FINAL is set. */
const HEADS = {
  // Z1 — one centred line, FINAL promoted to caps and tracked, the score
  // in the mono face the rest of the row already uses for figures.
  Z1: g => `<div class="meta fmeta">
    <span class="fin mono"><b>Final</b> &middot; ${g.fin}</span></div>`,

  // Z2 — a tick before it, the same mark the header clock uses when a
  // week is done, so "finished" is said the same way in both places.
  Z2: g => `<div class="meta fmeta">
    <span class="fin mono"><i class="ftick">&#10003;</i><b>Final</b>
      &middot; ${g.fin}</span></div>`,

  // Z3 — a small solid dot before it. Deliberately NOT the live dot:
  // no pulse, and it takes the muted ink, not --live.
  Z3: g => `<div class="meta fmeta">
    <span class="fin mono"><i class="fdot"></i><b>Final</b>
      &middot; ${g.fin}</span></div>`,

  // Z4 — the winning team's code carries its own colour, so the eye gets
  // the result before it reads the words.
  Z4: g => `<div class="meta fmeta">
    <span class="fin mono"><b>Final</b> &middot; <b class="fwin"
      style="color:${T[g.wonCode][2]}">${g.wonCode}</b> ${g.finNums}</span></div>`,
};

const bar = c => `<div class="stakebar resbar">
  <span class="sb-l res ${c.k}">${c.left}</span>
  <span class="sb-r">
    <span class="sb-pts ${c.k}">${c.pts}</span>
    <span class="sb-word ${c.k}">${c.word}</span></span></div>`;

const card = (g, head, foot) => `
<div class="card locked">
  ${HEADS[head](g)}
  <div class="match">
    ${side(g.a, 'l', g.won === 'a' ? 'won' : 'lost', g.as)}
    <div class="gutter"><span>@</span></div>
    ${side(g.h, 'r', g.won === 'h' ? 'won' : 'lost', g.hs)}
  </div>
  ${consBlock(g)}
  ${foot}
</div>`;

const G = {
  win:  { a: 'CHI', h: 'CAR', as: 59, hs: 37, won: 'a', ap: 77, hp: 23,
          fin: 'CHI 59-37', wonCode: 'CHI', finNums: '59-37' },
  loss: { a: 'ARI', h: 'LAC', as: 26, hs: 14, won: 'a', ap: 8, hp: 92,
          fin: 'ARI 26-14', wonCode: 'ARI', finNums: '26-14', upset: true },
  tie:  { a: 'NO',  h: 'DET', as: 30, hs: 30, won: null, ap: 8, hp: 92,
          fin: 'DET 30-30', wonCode: 'DET', finNums: '30-30' },
  wide: { a: 'WSH', h: 'PHI', as: 22, hs: 24, won: 'h', ap: 4, hp: 96,
          fin: 'PHI 24-22', wonCode: 'PHI', finNums: '24-22' },
  // Two navy teams, same-ish hex: the case the 3px gap exists for.
  navy: { a: 'DAL', h: 'NYG', as: 20, hs: 28, won: 'h', ap: 81, hp: 19,
          fin: 'NYG 28-20', wonCode: 'NYG', finNums: '28-20', upset: true },
};

const S = {
  stakedWin:   { k: 'w',    left: 'You took CHI &middot; Rank 9',   pts: '+8 pts', word: 'WIN' },
  stakedLoss:  { k: 'l',    left: 'You took LAC &middot; Rank 3',   pts: '0 pts',  word: 'LOSS' },
  unstakedWin: { k: 'w',    left: 'You took CHI &middot; Unstaked', pts: '+1 pt',  word: 'WIN' },
  unstakedLoss:{ k: 'l',    left: 'You took LAC &middot; Unstaked', pts: '0 pts',  word: 'LOSS' },
  noPick:      { k: 'none', left: 'No pick',                        pts: '0 pts',  word: '&ndash;' },
  tie:         { k: 'tie',  left: 'You took DET &middot; Rank 2',   pts: 'no score', word: 'TIE' },
  wideLoss:    { k: 'l',    left: 'You took WSH &middot; Rank 16',  pts: '0 pts',  word: 'LOSS' },
  navyWin:     { k: 'w',    left: 'You took NYG &middot; Rank 12',  pts: '+5 pts', word: 'WIN' },
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

/* ---- THE NEW RULES THE APP WOULD NEED ---------------------------- */
/* A CENTRED META ROW, final cards only. .meta gives its first child
   margin-right:auto and .cd margin-left:auto, so a row with one item in
   it centres by accident — which is not something to leave to chance in
   a stylesheet somebody else will edit. justify-content:center says it. */
.meta.fmeta{justify-content:center}
.meta.fmeta>:first-child{margin-right:0}
.meta .fin{white-space:nowrap;letter-spacing:.01em;display:inline-flex;
  align-items:center;gap:5px}
.meta .fin b{font-weight:800;letter-spacing:.09em;text-transform:uppercase;
  color:var(--ink-mute)}
.meta .ftick{font-style:normal;font-size:9.5px;color:var(--ink-faint);line-height:1}
/* NOT the live dot. No pulse, and muted ink rather than --live, because
   a green dot on a card means "being played right now" everywhere else
   in this app and must not start meaning two things. */
.meta .fdot{width:4px;height:4px;border-radius:50%;background:var(--ink-faint);
  display:inline-block}
.meta .fwin{letter-spacing:.02em;text-transform:none}

/* Paper-side red: --stamp is 4.32:1 on this card's #EDE8DE, under the
   floor for text; #BE2F26 is 4.75:1 and reads as the same red. Mirror of
   .lockband .miss, which exists because --stamp is 3.18:1 on the dark
   strip. --hit needs nothing: 5.09:1 here. */
.resbar{--sink:#BE2F26;cursor:default;border-top:1px solid var(--rule)}
.sb-l.res{font-weight:800}
.sb-l.res.w{color:var(--hit)}
.sb-l.res.l,.sb-l.res.none{color:var(--sink)}
.sb-l.res.tie{color:var(--ink-soft)}
.sb-pts.w{color:var(--hit)}
.sb-pts.l,.sb-pts.none{color:var(--sink)}
.sb-pts.tie{color:var(--ink-faint)}
.sb-word{height:26px;display:grid;place-items:center;padding:0 9px;border-radius:13px;
  border:2px solid;font-size:11px;font-weight:900;letter-spacing:.04em;
  white-space:nowrap;transform:rotate(-7deg)}
.sb-word.w{border-color:var(--hit);color:var(--hit)}
.sb-word.l,.sb-word.none{border-color:var(--sink);color:var(--sink)}
.sb-word.tie{border-color:var(--ink-faint);color:var(--ink-faint)}
</style></head><body><div class="mocksheet">

  <div class="opt"><h3>Z1 &mdash; centred, plain</h3>
    <p>FINAL and the score, centred, one line. The pool block below is
      now the app&rsquo;s own <code>consensusBar()</code> markup rather
      than my hand-written version &mdash; that is what the double bar
      was.</p></div>
  <div class="pairlab">your pick won</div>
  ${card(G.win, 'Z1', bar(S.stakedWin))}
  <div class="pairlab">your pick lost</div>
  ${card(G.loss, 'Z1', bar(S.stakedLoss))}

  <div class="rule"></div>
  <div class="opt"><h3>Z2 &mdash; a tick before it</h3>
    <p>The same mark the header clock uses for a finished week, so
      &ldquo;over&rdquo; is said the same way in both places.</p></div>
  <div class="pairlab">your pick won</div>
  ${card(G.win, 'Z2', bar(S.stakedWin))}

  <div class="opt"><h3>Z3 &mdash; a small dot before it</h3>
    <p>Muted ink and no pulse, deliberately: a green pulsing dot means
      &ldquo;being played right now&rdquo; everywhere else in the app.</p></div>
  <div class="pairlab">your pick won</div>
  ${card(G.win, 'Z3', bar(S.stakedWin))}

  <div class="opt"><h3>Z4 &mdash; the winner&rsquo;s code in its own colour</h3>
    <p>The eye gets the result before it reads the words. Only works
      where the team colour clears the paper &mdash; and some do not, so
      it would need the same luminance test the badges use.</p></div>
  <div class="pairlab">your pick won</div>
  ${card(G.win, 'Z4', bar(S.stakedWin))}

  <div class="rule"></div>
  <div class="wlab">Z1, every pick state</div>
  <div class="pairlab">staked and won</div>
  ${card(G.win, 'Z1', bar(S.stakedWin))}
  <div class="pairlab">unstaked and won &mdash; one point</div>
  ${card(G.win, 'Z1', bar(S.unstakedWin))}
  <div class="pairlab">staked and lost</div>
  ${card(G.loss, 'Z1', bar(S.stakedLoss))}
  <div class="pairlab">unstaked and lost</div>
  ${card(G.loss, 'Z1', bar(S.unstakedLoss))}
  <div class="pairlab">no pick at all</div>
  ${card(G.loss, 'Z1', bar(S.noPick))}
  <div class="pairlab">ended level &mdash; nothing decided</div>
  ${card(G.tie, 'Z1', bar(S.tie))}

  <div class="rule"></div>
  <div class="wlab">The two cases that stress the pool bar</div>
  <div class="opt"><p>Both drawn with the real markup. The 3px gap in
    <code>.cbar</code> exists because 151 of the 496 possible matchups
    put two team colours under 1.3:1 against each other and six pairs
    are the same hex &mdash; Dallas and the Rams are both #003594. The
    gap is what keeps the split visible.</p></div>
  <div class="pairlab">a 4% side &mdash; too narrow for its own label, so the sub-line carries it</div>
  ${card(G.wide, 'Z1', bar(S.wideLoss))}
  <div class="pairlab">two navy teams, and the pool got it wrong</div>
  ${card(G.navy, 'Z1', bar(S.navyWin))}
</div></body></html>`;

fs.writeFileSync('/tmp/claude-0/mock-z.html', html);

const b = await chromium.launch();
for (const width of [390, 320]) {
  const ctx = await b.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto('file:///tmp/claude-0/mock-z.html', { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
  const out = new URL(`../../docs/mockups/final-head-Z-centred-${width}.png`,
                      import.meta.url).pathname;
  await page.screenshot({ path: out, fullPage: true });

  /* MEASURED. Three things, each of which has actually gone wrong here:
     is the pool bar ONE row (the double-bar bug), is the head really
     centred, and does anything reach a card edge. */
  const r = await page.evaluate(() => {
    const out = { stacked: 0, offCentre: [], atEdge: [] };
    document.querySelectorAll('.card').forEach((card, i) => {
      const c = card.getBoundingClientRect();
      const bar = card.querySelector('.cbar');
      if (bar) {
        const segs = [...bar.children].map(s => s.getBoundingClientRect());
        // one row means every segment shares a top edge
        if (segs.length > 1 && Math.abs(segs[0].top - segs[1].top) > 1) out.stacked++;
        if (bar.getBoundingClientRect().height > 26) out.stacked++;
      }
      const fin = card.querySelector('.meta .fin');
      if (fin) {
        const f = fin.getBoundingClientRect();
        const off = Math.round(((f.left + f.right) / 2) - ((c.left + c.right) / 2));
        if (Math.abs(off) > 1) out.offCentre.push({ card: i, off });
      }
      card.querySelectorAll('.sb-word,.sb-l,.fin,.cseg span').forEach(el => {
        const e = el.getBoundingClientRect();
        if (e.right > c.right - 1 || e.left < c.left + 1)
          out.atEdge.push({ card: i, cls: el.className,
                            txt: el.textContent.trim().slice(0, 20) });
      });
    });
    return out;
  });
  console.log(`${width}px  stacked pool bars: ${r.stacked}` +
              `   heads off centre: ${r.offCentre.length}` +
              `   elements at a card edge: ${r.atEdge.length}`);
  r.offCentre.forEach(x => console.log('    off centre', JSON.stringify(x)));
  r.atEdge.forEach(x => console.log('    at edge', JSON.stringify(x)));
  console.log('   written', out);
  await ctx.close();
}
await b.close();
