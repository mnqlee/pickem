/* MOCKUP SHEET: the dark writing that is LEFT, and the four ways out.

   LEE'S INSTRUCTION, said twice: "no black writing anywhere on the cards
   or outside of it, only white."

   v1.38.3 answered the first half. Every word on a COLOURED panel is
   white: the city line, the team name, the score, the badge letters,
   the pool bar labels, on all 32 clubs. There is no onColor() any more.

   WHAT IS STILL DARK, and this is the honest answer: all of it sits on
   the card's CREAM PAPER, not on a club colour.

     the head band      FINAL . CAR 34-23        #5E5B55 on #EDE8DE
     the gutter         @                        ink-faint on #EDE8DE
     the losing side    NEW ENGLAND / Patriots / 23
     the pool label     HOW THE POOL PICKED      #5E5B55 on #EDE8DE
     the pool count     13 picks                 #5E5B55 on #EDE8DE
     the result line    You took CAR . Rank 9    green, or the paper red
     and outside the card, the SELECTED WEEK CHIP: --ink on --paper

   AND ONE THING THIS SHEET FOUND ON ITS OWN, in the shipped build: the
   @ in the gutter is --ink-faint on --paper-2, which measures 3.77:1.
   The token's own comment says 4.6:1, and it is right, but that is
   against --paper #FAF7F1; the gutter is painted on --paper-2. It is
   15px/700, so normal text at a 4.5:1 floor, and it is under it on
   every card in the app, final or not. --ink-mute would put it at
   5.30:1. Not part of Lee's question, reported because the harness
   measured it.

   White writing on cream paper is invisible. 4.5:1 needs a luminance
   gap; white on #EDE8DE measures 1.22:1. So "make it white" cannot be
   done by changing the ink. The paper has to go dark, or stay dark ink.
   That is the whole decision, and it is why this is a sheet and not a
   commit: it changes the look of every card in the app, including the
   fourteen that have not kicked off yet.

   THE FOUR:
     P1  as shipped in v1.38.3. Cream paper, dark ink on it.
     P2  the dark card. Paper becomes the app's own shell tones and
         every word on the card is white or near-white. The green and
         the red have to be re-picked: --hit #2F6E26 measures 2.39:1 on
         #2A2724 and --stamp #C8342A 2.81:1, both under the floor there.
     P3  dark bands only. The head and the result bar go dark so their
         writing is white; the middle of the card stays cream.
     P4  both sides carry their club colour, the losing one darkened
         enough for white text. This kills the biggest block of dark
         ink, the losing team's name and score, and leaves the head,
         the pool block and the result line still dark.

   Every ratio on the sheet is computed from the rendered pixels, alpha
   composites included, the same as every other sheet in this folder.

   Run: node mock-paper-ink.mjs
   Out: docs/mockups/paper-ink-1-what-is-dark-390.png
        docs/mockups/paper-ink-2-options-390.png
*/
import { chromium } from 'playwright';
import fs from 'node:fs';

const APP = fs.readFileSync(new URL('../../index.html', import.meta.url).pathname, 'utf8');
const STYLE = APP.slice(APP.indexOf('<style>') + 7, APP.indexOf('</style>'));

const T = {
  CAR: ['Carolina', 'Panthers', '#0085CA', '#101820'],
  NE:  ['New England', 'Patriots', '#002244', '#C60C30'],
  KC:  ['Kansas City', 'Chiefs', '#E31837', '#FFB81C'],
  LV:  ['Las Vegas', 'Raiders', '#101820', '#A5ACAF'],
  CIN: ['Cincinnati', 'Bengals', '#FB4F14', '#000000'],
  CLE: ['Cleveland', 'Browns', '#311D00', '#FF3C00'],
};

/* ---- WCAG, from the pixels ---------------------------------------- */
const lin = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
const rgbOf = hex => {
  const h = hex.replace('#', '');
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
};
const lumOf = c => .2126 * lin(c[0]) + .7152 * lin(c[1]) + .0722 * lin(c[2]);
const cr = (a, b) => {
  const x = lumOf(a), y = lumOf(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
};
const hexOf = c => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
const mix = (hex, towards, a) => {
  const c = rgbOf(hex), t = rgbOf(towards);
  return hexOf(c.map((v, i) => v + (t[i] - v) * a));
};
/* SOLVED BY SCANNING THE REAL COMPOSITE, not by a curve. The sheet's
   whole job is to say whether a value passes, so an approximation that
   lands within a hair of the floor is worse than useless. */
const solve = (hex, towards, onto, need) => {
  for (let a = 0; a <= 1.0001; a += .005) {
    const got = mix(hex, towards, a);
    if (cr(rgbOf(got), rgbOf(onto)) >= need) return { a: Math.round(a * 200) / 200, hex: got };
  }
  return { a: 1, hex: towards };
};

const PAPER2 = '#EDE8DE', SHELL2 = '#1E1D1B', SHELL3 = '#2A2724';
/* The two result colours, re-picked for the dark card. Both are the
   app's own tokens lightened the least amount that clears 4.5:1 on the
   band they would sit on. */
const P2_WIN  = solve('#2F6E26', '#FFFFFF', SHELL3, 4.5);   /* --hit  */
const P2_LOSE = solve('#C8342A', '#FFFFFF', SHELL3, 4.5);   /* --stamp */
/* And the losing side of P4: its club colour darkened just enough that
   white text over it clears 4.5:1 at 14.5px/700, which is normal text. */
const p4Dark = hex => solve(hex, '#000000', '#FFFFFF', 4.5);

/* ---- the real card, one function, mode-driven --------------------- */
const mark = (code, lit) => `<div class="mark" style="background:${T[code][2]};--sec:${
  T[code][3]}"><span>${code}</span></div>`;

const side = (code, which, won, score, mode) => {
  const hex = T[code][2];
  let bg = '';
  if (won) bg = ` style="background:${hex}"`;
  else if (mode === 'P4') bg = ` style="background:${p4Dark(hex).hex}"`;
  return `<button class="side ${which} ${won ? 'won' : 'lost'}"${bg}>
    ${mark(code, won)}
    <div class="names"><div class="city">${T[code][0]}</div>
      <div class="team">${T[code][1]}</div>
      <div class="scr mono">${score}</div></div></button>`;
};

const card = (away, home, wonSide, as, hs, mode, pa) => {
  const w = wonSide === 'a' ? away : home;
  const ws = wonSide === 'a' ? as : hs, ls = wonSide === 'a' ? hs : as;
  const ph = 100 - pa;
  return `
<div class="card locked" data-mode="${mode}" data-team="${w}">
  <div class="meta fmeta"><span class="fin mono"><b>Final</b> &middot; ${
    w} ${ws}-${ls}</span></div>
  <div class="match">${side(away, 'l', wonSide === 'a', as, mode)}
    <div class="gutter"><span>@</span></div>
    ${side(home, 'r', wonSide === 'h', hs, mode)}</div>
  <div class="cons">
    <div class="cons-head"><span>How the pool picked</span></div>
    <div class="cbar"><div class="cseg l" style="width:${pa}%;background:${
      T[away][2]}"><span>${away} ${pa}%</span></div><div class="cseg r" style="width:${
      ph}%;background:${T[home][2]}"><span>${home} ${ph}%</span></div></div>
    <div class="cons-sub mono"><span class="pcount">13 picks</span></div>
  </div>
  <div class="stakebar resbar">
    <span class="sb-l res w">You took ${w} &middot; Rank 9</span>
    <span class="sb-r"><span class="sb-pts w">+8 pts</span>
      <span class="sb-word w">WIN</span></span></div>
</div>`;
};

const MODES = {
  P1: 'as shipped in v1.38.3, cream paper and dark ink on it',
  P2: 'the dark card, every word on it white',
  P3: 'dark bands only, the head and the result line',
  P4: 'both sides in club colour, the losing one darkened',
};

/* ---- the week strip, the "outside of it" half --------------------- */
/* THE REAL CHIP, which is `<b>n</b>` and nothing else: .wk span is
   display:none in the app, so a mockup that prints a date under the
   number is drawing a chip that does not exist. */
const weekStrip = mode => `<div class="wkstrip ${mode}">${
  [1, 2, 3, 4, 5].map(n =>
    `<button class="wk${n === 3 ? ' on' : ''}"><b>${n}</b></button>`).join('')}</div>`;

const CSS = `
${STYLE}
.mocksheet{margin:0 auto;padding:0 0 30px}
.lab{padding:20px 14px 4px}
.lab h3{margin:0;font-size:13px;font-weight:900;color:var(--paper)}
.lab p{margin:5px 0 10px;font-size:10.5px;line-height:1.55;color:var(--chalk)}
.lab b{color:var(--paper)}
.lab code{font-family:'Roboto Mono',monospace;font-size:9.5px;color:var(--lock)}
.cap{padding:13px 14px 5px;font-size:8.5px;font-weight:800;letter-spacing:.13em;
  text-transform:uppercase;color:var(--lock)}
.cap i{font-style:normal;color:var(--chalk);letter-spacing:.04em;text-transform:none;
  font-weight:600}
.grp{margin-top:14px;border-top:1px solid rgba(250,247,241,.09);padding-top:4px}
.meta.fmeta{justify-content:center}
.meta.fmeta>:first-child{margin-right:0}
.meta .fin b{font-weight:800;letter-spacing:.09em;text-transform:uppercase;
  color:var(--ink-mute)}
.side.won{flex-grow:1.12;color:#fff}
.side.won .mark{box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.92)}
.side.won .city{opacity:.92}
.wkstrip{display:flex;gap:7px;padding:8px 14px 2px;overflow:hidden}
/* A CALL-OUT RULE, for the anatomy page only. Every element that is
   still dark ink gets a dashed box and a number, so the list in the
   prose and the thing on the card cannot drift apart. */
/* A CALL-OUT RULE, for the anatomy page only: a dashed box round each
   element that is still dark ink.
   THE NUMBER IS NOT ON THE BOX. The first version put it at the box's
   top-left corner with position:absolute, and it sat on top of the very
   words it was pointing at: the head read "INAL . CAR 34-23" and the
   pool label "OW THE POOL PICKED". A sheet that hides the thing it is
   about is worse than no sheet. The numbers go in a gutter to the left
   of the card instead, each one lined up with its own box, placed after
   layout by the script at the bottom of this page. */
.x{position:relative;outline:1.5px dashed var(--lock);outline-offset:1px}
/* NO PADDING ON THE WRAPPER. Padding it 22px narrowed the card, and
   the card is the thing being shown: "NEW ENGLAND" wrapped onto two
   lines, which is not what the app does at 390px. The card already
   leaves 14px of sheet down each side (.card has margin:0 var(--pad)),
   so the chips sit in that margin and the card keeps its real width. */
.anat{position:relative}
.anat .num{position:absolute;left:0;width:13px;height:13px;border-radius:7px;
  background:var(--lock);color:#15171B;font-size:8.5px;font-weight:900;
  display:grid;place-items:center;font-family:'Archivo',sans-serif}

/* ================= P2, THE DARK CARD =================
   Every surface on the card becomes a shell tone and every word on it
   becomes paper or chalk. The club panels do not change: they were
   already white on colour. */
[data-mode="P2"].card{background:${SHELL2};color:var(--paper)}
[data-mode="P2"] .meta{background:${SHELL3};border-bottom-color:rgba(250,247,241,.10)}
[data-mode="P2"] .meta .fin b{color:var(--chalk-soft)}
[data-mode="P2"] .meta .fin{color:var(--chalk-soft)}
[data-mode="P2"] .side.lost{background:${SHELL3};color:var(--chalk-soft)}
[data-mode="P2"] .gutter{background:${SHELL3};
  box-shadow:1px 0 0 rgba(250,247,241,.10),-1px 0 0 rgba(250,247,241,.10)}
/* --chalk-faint is labelled "decoration only, never text" in the
   stylesheet and the @ IS text, so this is --chalk-soft. At
   chalk-faint it measured 3.49:1 on this band, which is the same
   mistake the cream card already makes with the same glyph. */
[data-mode="P2"] .gutter span{color:var(--chalk-soft)}
[data-mode="P2"] .cons{background:${SHELL2};border-top-color:rgba(250,247,241,.10)}
[data-mode="P2"] .cons-head span{color:var(--chalk-soft)}
[data-mode="P2"] .cons-sub,[data-mode="P2"] .pcount{color:var(--chalk-soft)}
[data-mode="P2"] .resbar{background:${SHELL3};border-top-color:rgba(250,247,241,.10)}
/* RE-PICKED, NOT CARRIED OVER. --hit is 2.39:1 on this band and --stamp
   2.81:1, so both tokens have to be lightened for the dark card. These
   two values are the least lightening that clears 4.5:1, computed. */
[data-mode="P2"] .sb-l.res.w,[data-mode="P2"] .sb-pts.w{color:${P2_WIN.hex}}
[data-mode="P2"] .sb-word.w{border-color:${P2_WIN.hex};color:${P2_WIN.hex}}

/* ================= P3, DARK BANDS ONLY ================= */
[data-mode="P3"] .meta{background:${SHELL3};border-bottom-color:rgba(250,247,241,.10)}
[data-mode="P3"] .meta .fin,[data-mode="P3"] .meta .fin b{color:var(--chalk-soft)}
[data-mode="P3"] .resbar{background:${SHELL3};border-top-color:rgba(250,247,241,.10)}
[data-mode="P3"] .sb-l.res.w,[data-mode="P3"] .sb-pts.w{color:${P2_WIN.hex}}
[data-mode="P3"] .sb-word.w{border-color:${P2_WIN.hex};color:${P2_WIN.hex}}

/* ================= P4, BOTH SIDES COLOURED =================
   The losing side keeps its club colour, darkened by the smallest
   amount that lets white text clear 4.5:1 over it, and its badge keeps
   the smaller size and no ring so the two sides still read differently. */
[data-mode="P4"] .side.lost{color:#fff}
[data-mode="P4"] .side.lost .city{opacity:.92}
`;

const doc = inner => `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800;900&family=Roboto+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body><div class="mocksheet">${inner}</div></body></html>`;

/* ---- page 1: what is actually dark ------------------------------- */
/* The call-outs are added to a normal P1 card by class, so the card on
   the anatomy page is the shipped card and nothing else. */
const anatomy = (() => {
  /* ITS OWN MODE LABEL. It is a P1 card in every respect, but it is on
     page 1 and counting it with page 2's P1 cards would make P1 look
     like it has more dark ink than the others simply by appearing
     twice. */
  let h = card('CAR', 'NE', 'a', 34, 23, 'P1', 54).replace('data-mode="P1"', 'data-mode="A1"');
  h = h.replace('<span class="fin mono">', '<span class="fin mono x" data-n="1">');
  h = h.replace('<div class="gutter">', '<div class="gutter x" data-n="2">');
  h = h.replace('class="side r lost"', 'class="side r lost x" data-n="3"');
  h = h.replace('<div class="cons-head"><span>', '<div class="cons-head"><span class="x" data-n="4">');
  h = h.replace('<span class="pcount">', '<span class="pcount x" data-n="5">');
  h = h.replace('<span class="sb-l res w">', '<span class="sb-l res w x" data-n="6">');
  return h;
})();

const PAGES = [
  ['paper-ink-1-what-is-dark-390.png', doc(`
    <div class="lab"><h3>What is still dark, and where it sits</h3>
      <p>v1.38.3 made every word on a <b>club colour</b> white: the city
        line, the team name, the score, the badge letters, the pool bar
        labels, on all 32. That part is done and there is no code left
        that can print dark ink on a colour.</p>
      <p>The six things below are what is left, and every one of them is
        on the card's <b>cream paper</b>, not on a colour. White ink on
        that paper measures <code>1.22:1</code>. It would not be faint,
        it would be gone. So this is not an ink change, it is a decision
        about the paper.</p></div>`
    + `<div class="cap">the shipped card, with every dark element marked</div>`
    + `<div class="anat">` + anatomy + `</div>`
    + `<script>
      /* One chip per marked element, vertically centred on it, in the
         gutter. Read after layout so it cannot disagree with what is
         on screen. */
      /* IN AN IIFE, AND NOT NAMED top. A classic script declaring
         \`const top\` at global scope collides with window.top, which is
         a non-configurable property: the whole script threw and the
         numbers silently never appeared, while the dashed boxes did. A
         mockup that half renders is the kind of thing you only catch by
         looking at the picture. */
      (function () {
        const box = document.querySelector('.anat');
        const y0 = box.getBoundingClientRect().top;
        const used = [];
        box.querySelectorAll('.x').forEach(function (el) {
          const r = el.getBoundingClientRect();
          const n = document.createElement('div');
          n.className = 'num';
          n.textContent = el.dataset.n;
          /* TWO CHIPS CAN WANT THE SAME LINE. The gutter's @ and the
             losing side are both centred in the match row, so 2 landed
             exactly under 3 and was invisible. Nudge down until the
             line is free. */
          let t = r.top - y0 + r.height / 2 - 6.5;
          while (used.some(function (u) { return Math.abs(u - t) < 15; })) t += 16;
          used.push(t);
          n.style.top = t + 'px';
          box.appendChild(n);
        });
      })();
    </script>`
    + `<div class="lab">
      <p><b>1</b> the head, <code>FINAL &middot; CAR 34-23</code><br>
         <b>2</b> the gutter, <code>@</code><br>
         <b>3</b> the losing side, city, name and score<br>
         <b>4</b> the pool label, <code>HOW THE POOL PICKED</code><br>
         <b>5</b> the pool count, <code>13 picks</code><br>
         <b>6</b> the result line, green on a win and red on a loss</p>
      <p><b>Found while measuring this, and not part of the question:</b>
        the <code>@</code> in the gutter is <code>3.77:1</code> on every
        card in the app, under the <code>4.5:1</code> floor for text its
        size. The token it uses is fine on the lighter paper and the
        gutter is painted on the darker one. Moving it to
        <code>--ink-mute</code> puts it at <code>5.30:1</code> and looks
        identical. Say the word and it goes in as a one-line fix,
        whichever variant you pick.</p>
      <p>And <b>outside the card</b>: the selected week chip is dark ink
        on paper, by design, because it is the one chip that is meant to
        look like a pressed key. The <code>CONF</code> tag next to the
        title is already red, not black.</p></div>`
    + `<div class="cap">outside the card <i>the week strip, as shipped</i></div>`
    + weekStrip('as-is'))],

  ['paper-ink-2-options-390.png', doc(`
    <div class="lab"><h3>The four ways to answer it</h3>
      <p><b>P1</b> is what you have. <b>P2</b> turns the card's paper
        into the app's own dark shell, which is the only variant where
        every word on a card really is white; note the green had to be
        re-picked, because <code>#2F6E26</code> measures
        <code>2.39:1</code> on that band. <b>P3</b> darkens only the
        head and the result line. <b>P4</b> leaves the paper alone and
        puts the losing team in its own club colour, darkened enough for
        white text, which removes the largest block of dark ink but not
        the rest.</p>
      <p>Each one is shown on a Carolina win and a Kansas City win, so
        it is not judged on one club.</p></div>`
    + ['P1', 'P2', 'P3', 'P4'].map(m => `<div class="grp">
        <div class="cap">${m} <i>${MODES[m]}</i></div>
        ${card('CAR', 'NE', 'a', 34, 23, m, 54)}
        ${card('KC', 'LV', 'a', 31, 13, m, 71)}
        ${/* A LIGHT CLUB ON THE LOSING SIDE, which is the only place P4
              costs anything: Cincinnati's #FB4F14 cannot carry white
              text as it is, so P4 has to darken it, and a darkened club
              colour is the thing you turned down on the lit side. */''}
        ${card('CLE', 'CIN', 'a', 24, 20, m, 46)}
      </div>`).join(''))],
];

/* ------------------------------------------------------------------ */
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const OUT = new URL('../../docs/mockups/', import.meta.url).pathname;

console.log('re-picked for the dark card:');
console.log(`  win  #2F6E26 -> ${P2_WIN.hex}  (lightened ${Math.round(P2_WIN.a * 100)}%,`,
  `${cr(rgbOf(P2_WIN.hex), rgbOf(SHELL3)).toFixed(2)}:1 on ${SHELL3};`,
  `#2F6E26 was ${cr(rgbOf('#2F6E26'), rgbOf(SHELL3)).toFixed(2)}:1)`);
console.log(`  loss #C8342A -> ${P2_LOSE.hex}  (lightened ${Math.round(P2_LOSE.a * 100)}%,`,
  `${cr(rgbOf(P2_LOSE.hex), rgbOf(SHELL3)).toFixed(2)}:1; #C8342A was`,
  `${cr(rgbOf('#C8342A'), rgbOf(SHELL3)).toFixed(2)}:1)`);
console.log(`  white on the cream paper ${PAPER2} would be`,
  `${cr([255, 255, 255], rgbOf(PAPER2)).toFixed(2)}:1, which is the whole problem`);
for (const c of ['#002244', '#101820', '#E31837']) {
  const d = p4Dark(c);
  console.log(`  P4 losing side ${c} -> ${d.hex} (darkened ${Math.round(d.a * 100)}%,`,
    `white ${cr([255, 255, 255], rgbOf(d.hex)).toFixed(2)}:1)`);
}

const rows = [];
for (const [name, html] of PAGES) {
  const f = '/tmp/claude-0/' + name.replace('.png', '.html');
  fs.writeFileSync(f, html);
  await page.goto('file://' + f, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(700);
  await page.screenshot({ path: OUT + name, fullPage: true });

  /* EVERY PIECE OF TEXT ON THE CARD, against the surface it is actually
     painted on, alpha composited. The point of the sheet is that a
     variant can look white and still be unreadable, so nothing here is
     taken from the stylesheet's own word for it. */
  const got = await page.evaluate(() => {
    const px = s => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const surfaceOf = el => {
      for (let n = el; n; n = n.parentElement) {
        const bg = getComputedStyle(n).backgroundColor;
        const p = px(bg);
        const a = (bg.match(/[\d.]+/g) || [])[3];
        if (p.length === 3 && (a === undefined || +a > .9)) return p;
      }
      return [255, 255, 255];
    };
    /* BOTH ALPHAS, and the first version of this only did one of them.
       Nearly every muted ink in this app is an rgba COLOUR, not an
       element opacity: --ink-mute is rgba(21,23,27,.66). Reading
       cs.opacity alone reported the head and the losing name as
       near-black on cream at 14.70:1, a number that appears nowhere on
       screen, and the whole point of the sheet is the numbers. */
    const one = (el, label) => {
      if (!el) return null;
      const cs = getComputedStyle(el);
      const bg = surfaceOf(el.parentElement || el);
      const parts = (cs.color.match(/[\d.]+/g) || []).map(Number);
      const ca = parts.length > 3 ? parts[3] : 1;
      const a = ca * parseFloat(cs.opacity);
      const fg = parts.slice(0, 3).map((v, i) => v * a + bg[i] * (1 - a));
      return { label, fg, bg, size: parseFloat(cs.fontSize), weight: +cs.fontWeight };
    };
    const out = [];
    for (const card of document.querySelectorAll('.card')) {
      const items = [
        one(card.querySelector('.meta .fin'), 'head'),
        one(card.querySelector('.gutter span'), 'gutter @'),
        one(card.querySelector('.side.lost .team'), 'losing name'),
        one(card.querySelector('.side.lost .scr'), 'losing score'),
        one(card.querySelector('.cons-head span'), 'pool label'),
        one(card.querySelector('.pcount'), 'pool count'),
        one(card.querySelector('.sb-l.res'), 'result line'),
      ].filter(Boolean);
      out.push({ mode: card.dataset.mode, team: card.dataset.team, items });
    }
    return out;
  });
  rows.push(...got);
  console.log('wrote', name, '(' + (await page.evaluate(() => document.body.scrollHeight)) + 'px)');
}

/* ONE TABLE, and the column that matters is the last one: is this piece
   of text white, and if it is white, can you read it. */
/* THREE KINDS OF INK, not two. The result line is green or red in every
   variant, on purpose, so calling it "not white" says nothing: what
   matters is whether each piece of text is readable where it sits and
   whether the DARK ink is gone. */
/* AND "DARK" MEANS DARKER THAN WHAT IT SITS ON, not below some absolute
   lightness. The first version compared the ink's own luminance to a
   fixed 0.45 and called P2's chalk-on-shell head "dark ink", which is
   the opposite of what is on the screen. Light ink on a dark band is
   exactly what Lee asked for; the thing he is pointing at is ink
   DARKER than its surface. */
const kindOf = (fg, bg) => {
  const [r, g, bl] = fg;
  const spread = Math.max(r, g, bl) - Math.min(r, g, bl);
  if (spread > 40) return 'colour';
  return lumOf(fg) > lumOf(bg) ? 'white' : 'dark';
};
console.log('\n  mode team  element        ratio  floor   ink     rendered');
let bad = 0;
const darkLeft = {};
for (const r of rows) {
  for (const it of r.items) {
    const big = it.size >= 18.66 && it.weight >= 700;
    const need = big ? 3 : 4.5;
    const v = cr(it.fg, it.bg);
    const k = kindOf(it.fg, it.bg);
    if (v < need) bad++;
    if (k === 'dark') darkLeft[r.mode] = (darkLeft[r.mode] || 0) + 1;
    console.log(`   ${r.mode}  ${r.team.padEnd(4)} ${it.label.padEnd(13)} `
      + `${v.toFixed(2).padStart(5)}  ${need.toFixed(1)}  ${k.padEnd(7)} `
      + `${hexOf(it.fg)} on ${hexOf(it.bg)}${v >= need ? '' : '  !! under the floor'}`);
  }
}
console.log(bad ? `\n!! ${bad} pieces of text under their own floor` :
  '\nevery piece of text on every variant clears its own floor');
console.log('\ndark ink still on the card, per variant (lower is closer to what Lee asked):');
for (const m of ['A1', 'P1', 'P2', 'P3', 'P4'])
  console.log(`   ${m}  ${darkLeft[m] || 0} of ${rows.filter(r => r.mode === m)
    .reduce((n, r) => n + r.items.length, 0)} pieces`);

await ctx.close();
await b.close();
