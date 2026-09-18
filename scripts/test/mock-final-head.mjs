/* MOCKUP SHEET — the Y series. Two changes, and they turn out to be one
   change:

   1. On a FINAL card, the top row's kickoff time, network badge and
      spread are all PRE-GAME information. They are answering "when do I
      watch this and who is favoured", questions that stopped existing
      the moment the whistle went. Put FINAL and the score there instead.

   2. THE MISSING PICK STATE. An unstaked pick that comes in is worth
      ONE point, not zero: pay(r,n) is `!r ? 1 : …`, so pay(0,16) === 1.
      The X series only drew staked picks and no-picks, so the middle
      case — you called it right but never ranked it — had no line at
      all. "Rank 9" cannot be printed for it, so it needs its own word.

   AND THE TWO CHANGES SOLVE EACH OTHER. Once FINAL and the score are in
   the top row, the result bar does not need to carry them — so it goes
   back to ONE line, the ellipsis problem in X3 disappears, and the bar
   is 44px again instead of 54px.

   LIVE AND PRE-KICKOFF CARDS ARE NOT TOUCHED. The last sheet in here is
   a live card, unchanged, sitting next to a final one — the meta row
   still has to carry ESPN's clock, the network and the line while a game
   is being played, which is P1/P5 and already chosen.

   Run: node mock-final-head.mjs
   Out: docs/mockups/final-head-Y-series-390.png
        docs/mockups/final-head-Y-series-320.png
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

/* ---- the four candidate top rows ----------------------------------- */
const HEADS = {
  // What ships today: pre-game information on a game that is over.
  today: g => `<div class="meta">
    <span class="mono">${g.time}</span>
    <span class="net">${g.net}</span>
    <span class="mono">${g.line}</span>
    <span class="cd done">Final</span></div>`,

  // Y0 — the smallest possible change: drop the three pre-game items and
  // leave the FINAL chip exactly where it already sits.
  Y0: g => `<div class="meta"><span class="cd done">Final</span></div>`,

  // Y1 — one item, hard left: FINAL and the score together.
  Y1: g => `<div class="meta">
    <span class="fin mono"><b>Final</b> &middot; ${g.fin}</span></div>`,

  // Y2 — the row's two ends used the way the old one used them:
  // the state on the left, the figure on the right.
  Y2: g => `<div class="meta">
    <span class="cd done lefted">Final</span>
    <span class="fin mono tail">${g.fin}</span></div>`,

  // Y3 — Y1 but the network badge stays. It is the one item of the three
  // that people sometimes still want after the fact.
  Y3: g => `<div class="meta">
    <span class="fin mono"><b>Final</b> &middot; ${g.fin}</span>
    <span class="net tail">${g.net}</span></div>`,
};

/* ---- the result bar: ONE line again, now the head carries the score -- */
const RED = {
  w: 'w', l: 'l', none: 'none', tie: 'tie',
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
  <div class="cons"><div class="cons-h">How the pool picked</div>
    <div class="consbar">${poolBar(g.a, g.ap, g.h, g.hp)}</div>
    <div class="cons-sub mono">26 picks</div></div>
  ${foot}
</div>`;

const G = {
  win:  { a: 'CHI', h: 'CAR', time: '2:00 AM', net: 'FOX', line: 'CHI -3',
          as: 59, hs: 37, won: 'a', ap: 77, hp: 23, fin: 'CHI 59-37' },
  loss: { a: 'ARI', h: 'LAC', time: '2:00 AM', net: 'CBS', line: 'LAC -8.5',
          as: 26, hs: 14, won: 'a', ap: 8, hp: 92, fin: 'ARI 26-14' },
  tie:  { a: 'NO',  h: 'DET', time: '2:00 AM', net: 'FOX', line: 'DET -7',
          as: 30, hs: 30, won: null, ap: 8, hp: 92, fin: 'DET 30-30' },
  wide: { a: 'WSH', h: 'PHI', time: '9:20 AM', net: 'NBC', line: 'PHI -6',
          as: 22, hs: 24, won: 'h', ap: 4, hp: 96, fin: 'PHI 24-22' },
};

/* THE SIX PICK STATES, and the middle two are the point of this sheet. */
const STATES = {
  stakedWin:   { k: 'w',    left: 'You took CHI &middot; Rank 9',  pts: '+8 pts', word: 'WIN' },
  stakedLoss:  { k: 'l',    left: 'You took LAC &middot; Rank 3',  pts: '0 pts',  word: 'LOSS' },
  // pay(0, n) === 1. An unstaked pick that comes in is worth one point.
  unstakedWin: { k: 'w',    left: 'You took CHI &middot; Unstaked', pts: '+1 pt', word: 'WIN' },
  unstakedLoss:{ k: 'l',    left: 'You took LAC &middot; Unstaked', pts: '0 pts', word: 'LOSS' },
  noPick:      { k: 'none', left: 'No pick',                        pts: '0 pts', word: '&ndash;' },
  tie:         { k: 'tie',  left: 'You took DET &middot; Rank 2',   pts: 'no score', word: 'TIE' },
};
/* Three words for the same state, because the word is the decision. */
const UNSTAKED_WORDS = [
  ['Unstaked', 'the app already calls the act "staking" — "tap to stake points"'],
  ['No rank',  'plainest, and matches the column header in the Grid'],
  ['Unranked', 'one word, but reads as a judgement of the game rather than the pick'],
];

const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800;900&family=Roboto+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>
${STYLE}
/* ---- MOCKUP CHROME ONLY. Not called .sheet: that is the app's rank
   tray, fixed and translated off screen. ---- */
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
/* Paper-side red: --stamp is 4.32:1 on this card's #EDE8DE, under the
   floor for text; #BE2F26 is 4.75:1 and reads as the same red. Mirror
   of .lockband .miss, which exists because --stamp is 3.18:1 on the
   dark strip. Green needs nothing: --hit is 5.09:1 here. */
.resbar{--stamp-ink:#BE2F26;cursor:default;border-top:1px solid var(--rule)}
.sb-l.res{font-weight:800}
.sb-l.res.w{color:var(--hit)}
.sb-l.res.l,.sb-l.res.none{color:var(--stamp-ink)}
.sb-l.res.tie{color:var(--ink-soft)}
.sb-pts.w{color:var(--hit)}
.sb-pts.l,.sb-pts.none{color:#BE2F26}
.sb-pts.tie{color:var(--ink-faint)}
.sb-word{height:26px;display:grid;place-items:center;padding:0 9px;border-radius:13px;
  border:2px solid;font-size:11px;font-weight:900;letter-spacing:.04em;
  white-space:nowrap;transform:rotate(-7deg)}
.sb-word.w{border-color:var(--hit);color:var(--hit)}
.sb-word.l,.sb-word.none{border-color:#BE2F26;color:#BE2F26}
.sb-word.tie{border-color:var(--ink-faint);color:var(--ink-faint)}
/* The final head. .fin reuses the meta row's own size and colour and
   only promotes the word Final, so nothing about the row's height or
   baseline changes. */
.meta .fin{white-space:nowrap;letter-spacing:.01em}
.meta .fin b{font-weight:800;letter-spacing:.09em;text-transform:uppercase;
  color:var(--ink-mute)}
/* .meta>:first-child already takes margin-right:auto; a second item has
   to be pushed to the far end explicitly. */
.meta .tail{margin-left:auto}
.meta .cd.lefted{margin-left:0}
</style></head><body><div class="mocksheet">

  <div class="opt"><h3>What ships today</h3>
    <p>The top row is still answering pre-game questions &mdash; when is
      kickoff, which channel, who is favoured &mdash; on a game that is
      over. Shown with the one-line result bar for comparison.</p></div>
  <div class="pairlab">your pick won</div>
  ${card(G.win, 'today', bar(STATES.stakedWin))}

  <div class="rule"></div>
  <div class="opt"><h3>Y0 &mdash; drop the three, keep the FINAL chip where it is</h3>
    <p>The smallest change that answers the ask. Nothing moves; three
      things leave.</p></div>
  <div class="pairlab">your pick won</div>
  ${card(G.win, 'Y0', bar(STATES.stakedWin))}
  <div class="pairlab">your pick lost</div>
  ${card(G.loss, 'Y0', bar(STATES.stakedLoss))}

  <div class="rule"></div>
  <div class="opt"><h3>Y1 &mdash; FINAL and the score together, hard left</h3>
    <p>One item on the row. The score is also on the team rows, so this
      is a headline rather than the only place to find it.</p></div>
  <div class="pairlab">your pick won</div>
  ${card(G.win, 'Y1', bar(STATES.stakedWin))}
  <div class="pairlab">your pick lost</div>
  ${card(G.loss, 'Y1', bar(STATES.stakedLoss))}

  <div class="rule"></div>
  <div class="opt"><h3>Y2 &mdash; the state left, the figure right</h3>
    <p>Uses both ends of the row the way the old one did, so the row
      keeps the shape your eye already knows.</p></div>
  <div class="pairlab">your pick won</div>
  ${card(G.win, 'Y2', bar(STATES.stakedWin))}
  <div class="pairlab">your pick lost</div>
  ${card(G.loss, 'Y2', bar(STATES.stakedLoss))}

  <div class="rule"></div>
  <div class="opt"><h3>Y3 &mdash; Y1, but the network badge stays</h3>
    <p>Of the three, the channel is the only one anybody ever asks about
      after the fact. Included so you can see it either way.</p></div>
  <div class="pairlab">your pick won</div>
  ${card(G.win, 'Y3', bar(STATES.stakedWin))}
  <div class="pairlab">your pick lost</div>
  ${card(G.loss, 'Y3', bar(STATES.stakedLoss))}

  <div class="rule"></div>
  <div class="wlab">The pick state that was missing</div>
  <div class="opt"><p><b>An unstaked pick that comes in is worth one
    point.</b> pay(r,n) is <code>!r ? 1 : …</code> — so pay(0,16) is 1,
    the same as the lowest rank. The scoring has always been right; the
    card had no line for it, because "Rank 9" cannot be printed when
    there is no rank. Shown on Y1.</p></div>
  <div class="pairlab">staked and won &mdash; for comparison</div>
  ${card(G.win, 'Y1', bar(STATES.stakedWin))}
  <div class="pairlab">unstaked and won &mdash; one point</div>
  ${card(G.win, 'Y1', bar(STATES.unstakedWin))}
  <div class="pairlab">unstaked and lost &mdash; nothing</div>
  ${card(G.loss, 'Y1', bar(STATES.unstakedLoss))}
  <div class="pairlab">no pick at all</div>
  ${card(G.loss, 'Y1', bar(STATES.noPick))}
  <div class="pairlab">ended level &mdash; nothing decided</div>
  ${card(G.tie, 'Y1', bar(STATES.tie))}

  <div class="rule"></div>
  <div class="wlab">Three words for the unstaked state</div>
  ${UNSTAKED_WORDS.map(([w, why]) => `
    <div class="pairlab">${w} &mdash; ${why}</div>
    ${card(G.win, 'Y1', bar({ k: 'w', pts: '+1 pt', word: 'WIN',
      left: `You took CHI &middot; ${w}` }))}`).join('')}

  <div class="rule"></div>
  <div class="wlab">The widest line, on Y1</div>
  <div class="pairlab">longest team name, two-digit rank</div>
  ${card(G.wide, 'Y1', bar({ k: 'l', left: 'You took WSH &middot; Rank 16',
    pts: '0 pts', word: 'LOSS' }))}

  <div class="rule"></div>
  <div class="wlab">Nothing here touches a live or unplayed card</div>
  <div class="opt"><p>While a game is being played the meta row still has
    to carry ESPN&rsquo;s clock, the network and the line &mdash; that is
    P1/P5, already chosen. This change is final-only.</p></div>
  <div class="pairlab">live &mdash; unchanged</div>
  <div class="card locked">
    <div class="meta">
      <span class="cd live lefted">3rd &middot; 5:42</span>
      <span class="net">NBC</span>
      <span class="mono">BUF -2.5</span>
      <span class="cd live nodot">In progress</span></div>
    <div class="match">
      ${side('DET', 'l', '', 17)}
      <div class="gutter"><span>@</span></div>
      ${side('BUF', 'r', '', 21)}</div>
    <div class="cons"><div class="cons-h">How the pool picked</div>
      <div class="consbar">${poolBar('DET', 46, 'BUF', 54)}</div>
      <div class="cons-sub mono">26 picks</div></div>
    <div class="lockband"><span>In progress &middot; locked</span>
      <span>You took BUF &middot; Rank 4 &middot; 13 pts if it holds</span></div>
  </div>
  <div class="pairlab">not kicked off &mdash; unchanged</div>
  <div class="card">
    <div class="meta">
      <span class="mono">9:20 AM</span>
      <span class="net">NBC</span>
      <span class="mono">PHI -6</span>
      <span class="cd soon">Locks in 1d 2h</span></div>
    <div class="match">
      ${side('WSH', 'l', '', '&nbsp;')}
      <div class="gutter"><span>@</span></div>
      ${side('PHI', 'r', '', '&nbsp;')}</div>
    <div class="stakebar">
      <span class="sb-l"><b class="sb-ok">&#10003; Submitted</b> &middot; change until kickoff</span>
      <span class="sb-r"><span class="sb-num set">7</span>
      <span class="sb-pts">10 pts</span></span></div>
  </div>
</div></body></html>`;

fs.writeFileSync('/tmp/claude-0/mock-y.html', html);

const b = await chromium.launch();
for (const width of [390, 320]) {
  const ctx = await b.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto('file:///tmp/claude-0/mock-y.html', { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
  const out = new URL(`../../docs/mockups/final-head-Y-series-${width}.png`,
                      import.meta.url).pathname;
  await page.screenshot({ path: out, fullPage: true });

  /* MEASURED. Twice now a width check said it fitted and the render
     showed a wrap, so this looks at every line in every meta row and
     every result bar and reports anything that does not fit its box. */
  const bad = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('.card').forEach((card, i) => {
      const cw = card.getBoundingClientRect().width;
      card.querySelectorAll('.meta, .resbar, .stakebar, .lockband').forEach(row => {
        if (row.getBoundingClientRect().width - cw > 1)
          out.push({ card: i, why: 'row wider than card', cls: row.className });
        row.querySelectorAll('span, b').forEach(el => {
          if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0)
            out.push({ card: i, why: 'clipped', cls: el.className,
                       txt: el.textContent.trim().slice(0, 30),
                       need: el.scrollWidth, got: el.clientWidth });
        });
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
