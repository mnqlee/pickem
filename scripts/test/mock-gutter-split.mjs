/* MOCKUP SHEET: the gutter carrying BOTH clubs' colours, @ on top.

   LEE: "What about a dual split color between the two teams and the @
   sign in the middle, send an example size 19 in a real card with a
   possible few color split options for the middle please."

   THE @ IS 19px ON EVERY CARD ON THIS SHEET, and that is not a detail,
   it is what makes the idea work. White text needs 4.5:1 at normal
   size and 3:1 once it is 18.66px and bold, which is WCAG's large-text
   line. Measured against all 32 primaries:

     white at 15px/700 fails on four clubs   CIN 3.37, MIA 3.95,
                                             CAR 4.03, LAC 4.28
     white at 19px/700 passes on all 32      worst is CIN at 3.37
                                             against a 3:1 floor

   So a coloured gutter and the 19px @ are one decision, not two. At
   15px a Bengals card would print an @ nobody can read.

   THE OTHER THING THE NUMBERS SAY. Of the 496 possible matchups, 151
   put the two primaries under 1.3:1 against EACH OTHER, and six pairs
   are the same hex: Dallas and the Rams both #003594, Denver and
   Tennessee both #0C2340, New England and Seattle both #002244, and
   Las Vegas, New Orleans and Pittsburgh all #101820. On roughly a
   third of games a hard split is therefore invisible: one block of
   colour with an @ in it. The pool bar already solved this exact
   problem with a 3px gap that lets the card show through, and S2 is
   that same device applied here.

   AND THE HONEST OBJECTION, which is on the sheet rather than in a
   footnote: once you pick a side, that panel is the club's colour and
   the other panel goes cream and grey on purpose. A split gutter puts
   the UNPICKED club's full colour back on the card, a few pixels from
   the panel that was deliberately drained of it. Every variant is
   therefore shown twice, unpicked and picked, because the picked state
   is where this idea is either fine or wrong.

   Six splits, no code written:
     S1  hard split down the middle, following the existing skew
     S2  the same, with a paper hairline seam so identical clubs still
         read as two
     S3  a blend from one club to the other
     S4  colour only at the two edges, cream between, dark @
     S5  a split clasp in the middle, cream gutter around it
     S6  the picked club's colour only, filling the gutter

   Run: node mock-gutter-split.mjs
   Out: docs/mockups/gutter-split-1-options-390.png
        docs/mockups/gutter-split-2-hardcases-390.png
*/
import { chromium } from 'playwright';
import fs from 'node:fs';

const APP = fs.readFileSync(new URL('../../index.html', import.meta.url).pathname, 'utf8');
const STYLE = APP.slice(APP.indexOf('<style>') + 7, APP.indexOf('</style>'));

/* THE REAL TABLE, PARSED OUT OF THE APP, not retyped. Six of these
   colours are duplicated across clubs and that is the point of half
   this sheet, so a hand-copied table with one typo in it would quietly
   break the thing being demonstrated. */
const T = (() => {
  const blk = APP.slice(APP.indexOf('const T={'), APP.indexOf("'#FFB612']};") + 14);
  const out = {};
  for (const m of blk.matchAll(
    /(\w+):\['([^']*)','([^']*)','(#[0-9A-Fa-f]{6})','(#[0-9A-Fa-f]{6})'\]/g))
    out[m[1]] = [m[2], m[3], m[4], m[5]];
  return out;
})();
if (Object.keys(T).length !== 32) throw new Error('parsed ' + Object.keys(T).length + ' clubs, not 32');

const lin = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
const rgbOf = hex => { const h = hex.replace('#', '');
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
const lumOf = c => .2126 * lin(c[0]) + .7152 * lin(c[1]) + .0722 * lin(c[2]);
const cr = (a, b) => { const x = lumOf(a), y = lumOf(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };

/* ---- the six splits, each one a background on the gutter ---------- */
const PAPER2 = '#EDE8DE';
const split = (v, a, h, picked) => {
  const A = T[a][2], H = T[h][2];
  const lit = picked === 'a' ? A : picked === 'h' ? H : null;
  switch (v) {
    case 's1': return `linear-gradient(90deg,${A} 0 50%,${H} 50% 100%)`;
    /* THE SEAM IS 3px OF THE CARD'S OWN PAPER, the same width and the
       same reason as the pool bar's gap: it depends on no colour, so
       #002244 against #002244 still reads as two halves. */
    case 's2': return `linear-gradient(90deg,${A} 0 calc(50% - 1.5px),`
      + `${PAPER2} calc(50% - 1.5px) calc(50% + 1.5px),${H} calc(50% + 1.5px) 100%)`;
    case 's3': return `linear-gradient(90deg,${A},${H})`;
    case 's4': return `linear-gradient(90deg,${A} 0 5px,`
      + `${PAPER2} 5px calc(100% - 5px),${H} calc(100% - 5px) 100%)`;
    case 's5': return PAPER2;
    case 's6': return lit || PAPER2;
    /* S7 CAME OUT OF LOOKING AT S1 PICKED, not out of the list. Once
       you take a side, S1's gutter keeps the OTHER club's colour hard
       against a panel the app has just drained to cream, and the
       unpicked sliver reads as belonging to nothing. S7 makes the
       gutter agree with the panels instead: both colours before a
       pick, the picked colour plus paper after it. The @ then straddles
       colour and paper, where neither white nor dark ink works, so it
       rides in a light clasp of its own and is readable by
       construction, whatever the two clubs wear. */
    case 's7': return picked === 'a'
        ? `linear-gradient(90deg,${A} 0 calc(50% - 1.5px),${PAPER2} calc(50% - 1.5px) 100%)`
      : picked === 'h'
        ? `linear-gradient(90deg,${PAPER2} 0 calc(50% + 1.5px),${H} calc(50% + 1.5px) 100%)`
        : `linear-gradient(90deg,${A} 0 calc(50% - 1.5px),`
          + `${PAPER2} calc(50% - 1.5px) calc(50% + 1.5px),${H} calc(50% + 1.5px) 100%)`;
    default:   return PAPER2;
  }
};

const gutter = (v, a, h, picked) => {
  const A = T[a][2], H = T[h][2];
  /* S4 KEEPS THE DARK @ because its middle is still the card's paper,
     and S6 unpicked has no colour to sit on either. Everywhere else
     the @ is white on a club colour. */
  const dark = v === 's4' || (v === 's6' && !picked);
  const inner = v === 's7'
    ? `<span class="clasp paper"><span class="at">@</span></span>`
    : v === 's5'
    ? `<span class="clasp" style="background:linear-gradient(90deg,${A} 0 50%,${H} 50% 100%)">
        <span class="at on">@</span></span>`
    : `<span class="at${dark ? '' : ' on'}">@</span>`;
  return `<div class="gutter sp" data-v="${v}" data-pick="${picked || 'none'}"
    data-pair="${a}-${h}" style="background:${split(v, a, h, picked)}">${inner}</div>`;
};

const side = (code, which, picked) => `<button class="side ${which} ${
  picked === null ? '' : picked ? 'won' : 'lost'}"${
  picked ? ` style="background:${T[code][2]}"` : ''}>
  <div class="mark" style="background:${T[code][2]};--sec:${T[code][3]}"><span>${code}</span></div>
  <div class="names"><div class="city">${T[code][0]}</div>
    <div class="team">${T[code][1]}</div>
    <div class="rec">${which === 'l' ? 'Away' : 'Home'}</div></div></button>`;

const card = (v, a, h, picked) => `
<div class="card">
  <div class="meta"><span>2:00 AM</span><span class="net">FOX</span>
    <span>${h} &minus;3.5</span><span class="cd">Locks in 2d 18h</span></div>
  <div class="match">${side(a, 'l', picked === null ? null : picked === 'a')}
    ${gutter(v, a, h, picked)}
    ${side(h, 'r', picked === null ? null : picked === 'h')}</div>
  ${picked
    ? `<button class="stakebar"><span class="sb-l"><b class="sb-ok">&#10003; Submitted</b>
        &middot; change until kickoff</span>
        <span class="sb-r"><span class="sb-num set">4</span>
        <span class="sb-pts">13 pts</span></span></button>`
    : `<button class="stakebar empty"><span class="sb-l">Tap to stake points</span>
        <span class="sb-r"><span class="sb-num blank">?</span></span></button>`}
</div>`;

const SPLITS = [
  ['s1', 'hard split down the middle',
   'follows the skew the card already has, so the seam is free'],
  ['s2', 'the same, with a 3px paper seam',
   'the pool bar’s own fix: works even when both clubs wear #002244'],
  ['s3', 'a blend from one club to the other',
   'no seam to go missing, but neither colour is quite the club’s'],
  ['s4', 'colour at the two edges only',
   'reads as a seam between the panels, and the @ stays dark on paper'],
  ['s5', 'a split clasp, cream gutter',
   'both colours, in one 26px object, with the card’s middle left alone'],
  ['s6', 'the picked club’s colour only',
   'the gutter answers "which one did I take", and is paper until you pick'],
  ['s7', 'the gutter mirrors the panels',
   'both colours until you pick, then the picked one and paper, @ in a clasp'],
];

const CSS = `
${STYLE}
.mocksheet{padding:0 0 30px}
.lab{padding:20px 14px 4px}
.lab h3{margin:0;font-size:13px;font-weight:900;color:var(--paper)}
.lab p{margin:5px 0 10px;font-size:10.5px;line-height:1.55;color:var(--chalk)}
.lab b{color:var(--paper)}
.lab code{font-family:'Roboto Mono',monospace;font-size:9.5px;color:var(--lock)}
.cap{padding:14px 14px 5px;font-size:8.5px;font-weight:800;letter-spacing:.13em;
  text-transform:uppercase;color:var(--lock)}
.cap i{font-style:normal;color:var(--chalk);letter-spacing:.04em;text-transform:none;
  font-weight:600}
.grp{margin-top:6px;border-top:1px solid rgba(250,247,241,.09);padding-top:2px}
.stlab{padding:7px 14px 3px;font-size:9px;font-weight:700;letter-spacing:.05em;
  color:var(--chalk);font-family:'Roboto Mono',monospace}

/* ---- THE SPLIT GUTTER ----
   The 19px @, and it is 19px on every card here. .gutter is already
   skewed -9deg and its contents counter-skewed, so a 90deg gradient
   inside it arrives on screen following the same slant as the panel
   edges: the seam costs nothing to line up. */
.gutter.sp{display:grid;place-items:center}
.gutter.sp .at{transform:skewX(9deg);font-family:'Roboto Mono',monospace;
  font-size:19px;font-weight:700;color:var(--ink-mute);line-height:1}
.gutter.sp .at.on{color:#fff}
.clasp{display:grid;place-items:center;width:26px;height:26px;border-radius:13px;
  transform:skewX(9deg);box-shadow:inset 0 0 0 1px rgba(0,0,0,.18)}
.clasp .at{transform:none}
/* THE LIGHT PAPER, NOT THE CARD'S. --ink-mute's own note measures
   4.6:1 against --paper, so an @ in a --paper clasp is readable on any
   club colour and on the cream half alike: the contrast stops
   depending on the matchup entirely. */
.clasp.paper{background:var(--paper)}

/* ---- the magnified row ---- */
.zrow{display:flex;gap:12px;padding:8px 14px 4px;align-items:flex-start;flex-wrap:wrap}
.zbox{zoom:1.8}
.zbox .frame{width:42px;height:56px;background:var(--paper-2);overflow:hidden;display:flex;
  box-shadow:0 0 0 .5px var(--rule)}
.zbox .frame .gutter{flex:1 1 auto}
.zname{font-size:5.4px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;
  color:var(--lock);text-align:center;padding-top:2px;font-family:'Archivo',sans-serif}
`;

const doc = inner => `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800;900&family=Roboto+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body><div class="mocksheet">${inner}</div></body></html>`;

const zbox = (v, a, h, picked, name) => `<div class="zbox"><div class="frame">${
  gutter(v, a, h, picked)}</div><div class="zname">${name}</div></div>`;

/* THREE MATCHUPS, CHOSEN BY THE NUMBERS rather than by taste:
   one ordinary pair, one pair that wears the SAME hex, and one with a
   club light enough that white is the only ink that works. */
const PAIRS = [
  ['MIN', 'CHI', 'ordinary pair, 1.67:1 between the two colours'],
  ['NE', 'SEA', 'both clubs are #002244: identical, 1.00:1'],
  ['CIN', 'CLE', 'Cincinnati is the lightest primary in the league'],
];

const PAGES = [
  ['gutter-split-1-options-390.png', doc(`
    <div class="lab"><h3>Both clubs in the middle, @ at 19px</h3>
      <p><b>19px is load-bearing here.</b> White needs 4.5:1 at normal
        size and 3:1 once it is 18.66px and bold. At 15px the @ fails on
        Cincinnati, Miami, Carolina and the Chargers. At <b>19px</b> it
        passes on all 32, worst case <code>3.37:1</code> against a
        <code>3:1</code> floor. A coloured gutter and the big @ are one
        decision.</p>
      <p>Six splits, magnified, on Minnesota at Chicago.</p></div>
    <div class="zrow">
      ${SPLITS.map(([v]) => zbox(v, 'MIN', 'CHI', 'h', v.toUpperCase())).join('')}
    </div>
    <div class="lab">
      <p><b>Each one twice.</b> Unpicked, then with the home side taken.
        The picked state is the one that matters: the app drains the
        colour out of the side you did not take, on purpose, and a split
        gutter puts that club's colour back a few pixels away from the
        panel it was removed from. Look at S1 and S2 picked and decide
        whether that reads as a seam or as a leak.</p></div>`
    + SPLITS.map(([v, title, sub]) => `<div class="grp">
        <div class="cap">${v.toUpperCase()} <i>${title}</i></div>
        <div class="stlab">${sub}</div>
        <div class="stlab">nothing picked yet</div>
        ${card(v, 'MIN', 'CHI', null)}
        <div class="stlab">Chicago taken</div>
        ${card(v, 'MIN', 'CHI', 'h')}
      </div>`).join(''))],

  ['gutter-split-2-hardcases-390.png', doc(`
    <div class="lab"><h3>The two that survive contact with the schedule</h3>
      <p>Of the 496 matchups, <b>151 put the two primaries under
        1.3:1 against each other</b> and six pairs are the same hex.
        A hard split is invisible on those, which is why S2 exists: its
        seam is 3px of the card's own paper and depends on no colour at
        all. That is the same device the pool bar below already uses,
        for the same reason.</p>
      <p>Three matchups, chosen by the numbers: an ordinary pair, a pair
        that wears the identical hex, and the lightest primary in the
        league. S1 first so the failure is visible, then S2.</p></div>`
    + ['s1', 's2'].map(v => `<div class="grp">
        <div class="cap">${v.toUpperCase()} <i>${
          SPLITS.find(s => s[0] === v)[1]}</i></div>
        ${PAIRS.map(([a, h, why]) =>
          `<div class="stlab">${a} at ${h} &middot; ${why}</div>${
            card(v, a, h, 'h')}`).join('')}
      </div>`).join('')
    + `<div class="lab">
        <p><b>S5 and S6 sidestep the whole problem</b>, and are worth a
          look for that reason alone. S5 puts both colours inside one
          26px clasp, so two identical clubs are two identical halves of
          a small object rather than a blank gutter, and the card's
          middle keeps its paper. S6 carries one colour, the one you
          took, so there is no seam to fail and the gutter starts saying
          something the card does not say anywhere else at that
          position.</p></div>`
    + `<div class="cap">S5 <i>a split clasp</i></div>`
    + PAIRS.map(([a, h]) => card('s5', a, h, 'h')).join('')
    + `<div class="cap">S6 <i>the picked club only</i></div>`
    + PAIRS.map(([a, h]) => card('s6', a, h, 'h')).join('')
    + `<div class="lab">
        <p><b>S7 is the one I would build</b>, and it is not from the
          original list: it came out of looking at S1 with a side
          picked. The gutter shows exactly what the two panels show, so
          it can never disagree with the card, and the @ sits in a light
          clasp, which takes its readability out of the hands of the
          fixture list altogether. Below: unpicked, then picked, on the
          identical-hex pair.</p></div>`
    + `<div class="cap">S7 <i>the gutter mirrors the panels</i></div>`
    + `<div class="stlab">NE at SEA, nothing picked: both colours, paper seam</div>`
    + card('s7', 'NE', 'SEA', null)
    + `<div class="stlab">NE at SEA, Seattle taken: their colour, and paper</div>`
    + card('s7', 'NE', 'SEA', 'h')
    + `<div class="stlab">CIN at CLE, Cleveland taken</div>`
    + card('s7', 'CIN', 'CLE', 'h'))],
];

/* ------------------------------------------------------------------ */
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const OUT = new URL('../../docs/mockups/', import.meta.url).pathname;

/* THE ALL-32 CHECK, PRINTED BEFORE THE SHEETS, because it is the
   argument for 19px and it should not be taken on trust. */
const W = [255, 255, 255];
const byWhite = Object.entries(T)
  .map(([c, v]) => [cr(W, rgbOf(v[2])), c]).sort((x, y) => x[0] - y[0]);
console.log('white on the club primary, the five tightest:');
for (const [r, c] of byWhite.slice(0, 5))
  console.log(`   ${c.padEnd(4)} ${r.toFixed(2)}  `
    + `${r >= 4.5 ? 'passes at any size' : r >= 3 ? 'passes at 19px/700 only' : 'fails at every size'}`);
console.log(`   under 4.5:1: ${byWhite.filter(x => x[0] < 4.5).length} clubs.`
  + ` under 3:1: ${byWhite.filter(x => x[0] < 3).length} clubs.`);

const rows = [];
for (const [name, html] of PAGES) {
  const f = '/tmp/claude-0/' + name.replace('.png', '.html');
  fs.writeFileSync(f, html);
  await page.goto('file://' + f, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(700);
  await page.screenshot({ path: OUT + name, fullPage: true });

  /* THE @ AGAINST BOTH HALVES IT STRADDLES. A gradient has no
     backgroundColor to read, so the surface cannot come from
     getComputedStyle: it is sampled from the CANVAS, left and right of
     the glyph's own box, which is the only honest way to grade text
     sitting on a seam. */
  const got = await page.evaluate(() => {
    const out = [];
    for (const g of document.querySelectorAll('.gutter.sp')) {
      const at = g.querySelector('.at');
      const cs = getComputedStyle(at);
      const r = at.getBoundingClientRect(), gr = g.getBoundingClientRect();
      out.push({ v: g.dataset.v, pick: g.dataset.pick, pair: g.dataset.pair,
                 size: parseFloat(cs.fontSize), weight: +cs.fontWeight,
                 color: cs.color,
                 box: { x: r.x, y: r.y, w: r.width, h: r.height },
                 gut: { x: gr.x, y: gr.y, w: gr.width, h: gr.height } });
    }
    return out;
  });
  rows.push(...got);
  console.log('wrote', name, '(' + (await page.evaluate(() => document.body.scrollHeight)) + 'px)');
}

/* THE SIMPLER AND MORE HONEST READ: the colours in the gradient are the
   clubs' own primaries, which we already hold, so grade the @ against
   BOTH of them plus the paper seam. Sampling a canvas would prove the
   same thing with more moving parts. */
console.log('\n  split pick pair      @ size  vs left   vs right  floor  verdict');
let bad = 0;
const seen = new Set();
for (const r of rows) {
  const key = `${r.v}|${r.pick}|${r.pair}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const [a, h] = r.pair.split('-');
  const white = r.color === 'rgb(255, 255, 255)';
  const ink = white ? W : [94, 91, 85];
  const big = r.size >= 18.66 && r.weight >= 700;
  const need = big ? 3 : 4.5;
  /* WHAT THE @ ACTUALLY SITS ON, per variant. S4's middle and S5's and
     unpicked S6's gutter are paper; everywhere else it is the two club
     colours, and on S3 it is the blend, whose midpoint is what the
     glyph is centred on. */
  /* The blend's midpoint, which is what an @ centred in S3 sits on.
     Written as a zero-argument function: the first version took a
     parameter it was never called with, so it threw on the first S3
     row. */
  const mid = () => rgbOf(T[a][2]).map((v, i) => Math.round((v + rgbOf(T[h][2])[i]) / 2));
  /* S5's @ IS NOT ON THE PAPER. Its gutter is paper, but the glyph
     sits inside the clasp, whose background is the same two-club split,
     so grading it against cream reported 1.22:1 and flagged the one
     variant that is actually fine. The surface is the thing directly
     behind the glyph, never the nearest element with a background. */
  const surfaces = r.v === 's7' ? [['clasp', rgbOf('#FAF7F1')]]
    : r.v === 's4' || (r.v === 's6' && r.pick === 'none')
    ? [['paper', rgbOf(PAPER2)]]
    : r.v === 's5' ? [['left', rgbOf(T[a][2])], ['right', rgbOf(T[h][2])]]
    : r.v === 's3' ? [['blend', mid()]]
    : r.v === 's6' ? [['picked', rgbOf(T[r.pick === 'a' ? a : h][2])]]
    : [['left', rgbOf(T[a][2])], ['right', rgbOf(T[h][2])]];
  const got = surfaces.map(([, c]) => cr(ink, c));
  const worst = Math.min(...got);
  if (worst < need) bad++;
  console.log(`   ${r.v.padEnd(5)} ${r.pick.padEnd(4)} ${r.pair.padEnd(9)} `
    + `${r.size}px  ${got.map(v => v.toFixed(2).padStart(5)).join('    ').padEnd(18)} `
    + `${need.toFixed(1)}   ${worst >= need ? 'ok' : '!! UNDER THE FLOOR'}`);
}
console.log(bad ? `\n!! ${bad} gutters put the @ under its floor`
                : '\nthe @ clears its floor on every split, on every pair on the sheet');
/* AND THE SEAM, which is the other way a split fails: not unreadable,
   just not there. */
for (const [a, h] of PAIRS.map(p => [p[0], p[1]])) {
  const v = cr(rgbOf(T[a][2]), rgbOf(T[h][2]));
  console.log(`   ${a} vs ${h}: the two colours are ${v.toFixed(2)}:1 apart`
    + `${v < 1.3 ? '  <- a hard split is invisible here, S2 is for this' : ''}`);
}

await ctx.close();
await b.close();
