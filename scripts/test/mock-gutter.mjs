/* MOCKUP SHEET: what goes in the middle of a card, beside the @.

   LEE: "I like the @ sign, but what can we fill in the middle with?"
   And, in the same message, the @ itself: "you can fix the @ sign to be
   the size of what it should be."

   TWO QUESTIONS, ANSWERED SEPARATELY. The ink is settled and built:
   --ink-faint on --paper-2 measured 3.77:1, --ink-mute measures 5.30:1,
   and the second one shipped. The SIZE is not settled, because "what it
   should be" is a look, not a number, so the top of sheet 1 puts three
   sizes next to each other and Lee points at one.

   WHAT THE GUTTER IS. 42px wide, 72px tall, skewed -9deg, painted on
   --paper-2, sitting between the two team panels with a hairline each
   side. Everything inside is counter-skewed by +9deg so the glyphs
   stand up straight. That is enough room for the @ plus ONE more thing:
   a 19px chip, a 10px glyph, or one line of 8.5px mono. Not two.

   WHAT IS WORTH PUTTING THERE, and the test each idea has to pass: is
   it something you want while SCROLLING the slate, that is not already
   on the same screen?

     the rank you staked       yes. It is the one number you need while
                               deciding where the rest of your ranks go,
                               and today it lives in the stake bar, so
                               you read it a card at a time.
     the game's state          yes for live and final. The meta row says
                               it in words, but the gutter is the only
                               element in a fixed place on every card.
     the countdown             no. LOCKS IN 2D 21H is already on the same
                               card, four lines up, and wider.
     the spread                no. Same row as the countdown.
     the pool's lean           NO, and not "no for now": the pool block
                               is hidden until a game is final on purpose,
                               so that nobody picks by following the
                               crowd. Putting an arrow in the gutter
                               would leak exactly that.
     the final margin          yes, and it is free: the head already says
                               CAR 34-23, so +11 is the same fact made
                               scannable.

   Nothing here is built. Every variant is drawn from index.html's own
   stylesheet, and the ratios under the sheet are computed from the
   rendered pixels.

   Run: node mock-gutter.mjs
   Out: docs/mockups/gutter-1-ideas-390.png
        docs/mockups/gutter-2-states-390.png
*/
import { chromium } from 'playwright';
import fs from 'node:fs';

const APP = fs.readFileSync(new URL('../../index.html', import.meta.url).pathname, 'utf8');
const STYLE = APP.slice(APP.indexOf('<style>') + 7, APP.indexOf('</style>'));

const T = {
  MIN: ['Minnesota', 'Vikings', '#4F2683', '#FFC62F'],
  CHI: ['Chicago', 'Bears', '#0B162A', '#C83803'],
  CAR: ['Carolina', 'Panthers', '#0085CA', '#101820'],
  NE:  ['New England', 'Patriots', '#002244', '#C60C30'],
};

/* ---- WCAG from the pixels, the same maths as every other sheet ---- */
const lin = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
const rgbOf = hex => { const h = hex.replace('#', '');
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
const lumOf = c => .2126 * lin(c[0]) + .7152 * lin(c[1]) + .0722 * lin(c[2]);
const cr = (a, b) => { const x = lumOf(a), y = lumOf(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };

/* THE DASHED CHIP'S RED, SOLVED RATHER THAN COPIED.
   Variant B's unset chip started as a copy of the app's own
   .sb-num.blank: rgba(200,52,42,.55) for the ring and .6 for the mark,
   on --paper-2. Measured, that is 2.45:1, under the 3:1 a graphic
   needs, and it is why the "?" circle in the stake bar reads as faint
   in Lee's screenshots. The alpha below is the least that clears 3:1
   on that paper, scanned against the real composite. The same fix
   applies to .sb-num.blank in the app: offered, not built, because it
   is a separate decision from this sheet. */
const PAPER2 = '#EDE8DE';
const mixOn = (hex, onto, a) => {
  const c = rgbOf(hex), t = rgbOf(onto);
  return c.map((v, i) => v * a + t[i] * (1 - a));
};
const BLANK_A = (() => {
  for (let a = .55; a <= 1.0001; a += .01)
    if (cr(mixOn('#C8342A', PAPER2, a), rgbOf(PAPER2)) >= 3) return Math.round(a * 100) / 100;
  return 1;
})();

/* ---- the glyphs. Inline SVG, stroked in currentColor, so each one
        takes the colour of whatever state it is in and there is no icon
        font and no emoji to render differently per phone. ---- */
const LOCK = `<svg class="gy" width="9" height="11" viewBox="0 0 9 11" aria-hidden="true">
  <path d="M2.2 4.6V3.1a2.3 2.3 0 0 1 4.6 0v1.5" fill="none" stroke="currentColor" stroke-width="1.2"/>
  <rect x=".7" y="4.6" width="7.6" height="5.8" rx="1.4" fill="currentColor"/></svg>`;
const TICK = `<svg class="gy" width="11" height="9" viewBox="0 0 11 9" aria-hidden="true">
  <path d="M1.2 4.6 4 7.4 9.8 1.4" fill="none" stroke="currentColor"
    stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/* ---- the gutter, one function, variant and state driven ----------- */
const gutter = (v, st) => {
  const at = size => `<span class="at" style="font-size:${size}px">@</span>`;
  const rank = st === 'staked' || st === 'live' || st === 'final'
    ? `<span class="chip">4</span>` : `<span class="chip blank">?</span>`;
  const glyph = st === 'live' ? `<span class="dot"></span>`
    : st === 'final' ? `<span class="gwrap done">${TICK}</span>`
    : st === 'locked' ? `<span class="gwrap lock">${LOCK}</span>` : '';
  const body = {
    a0: at(15),
    a1: at(15),
    a2: at(17),
    a3: at(19),
    b:  at(12) + rank,
    c:  at(13) + (glyph || `<span class="gwrap void"></span>`),
    d:  at(12) + `<span class="cd mono">${
          st === 'live' ? '2nd' : st === 'final' ? 'FT' : st === 'locked' ? '0h' : '2d'}</span>`,
    e:  at(12) + `<span class="mg mono">${st === 'final' ? '+11' : '&middot;'}</span>`,
    f:  `<span class="clasp">${at(13)}</span>`,
    g:  st === 'pre' ? `<span class="chip big blank">?</span>` : `<span class="chip big">4</span>`,
  }[v === 'b2' ? 'b' : v];
  return `<div class="gutter v g-${v}" data-v="${v}" data-st="${st}">${body}</div>`;
};

const side = (code, which, lit) => `<button class="side ${which} ${lit ? 'won' : 'lost'}"${
  lit ? ` style="background:${T[code][2]}"` : ''}>
  <div class="mark" style="background:${T[code][2]};--sec:${T[code][3]}"><span>${code}</span></div>
  <div class="names"><div class="city">${T[code][0]}</div>
    <div class="team">${T[code][1]}</div>
    <div class="rec">${which === 'l' ? 'Away' : 'Home'}</div></div></button>`;

const card = (v, st, a = 'MIN', h = 'CHI') => `
<div class="card">
  <div class="meta"><span>2:00 AM</span><span class="net">FOX</span><span>CHI &minus;3.5</span>
    <span class="cd">Locks in 2d 18h</span></div>
  <div class="match">${side(a, 'l', false)}${gutter(v, st)}${side(h, 'r', true)}</div>
  ${/* B2 MOVES THE NUMBER RATHER THAN COPYING IT. Straight B prints
        the rank twice on one card, in the gutter and in the stake bar,
        which is the fair criticism of it: the gutter earns its keep
        while SCROLLING, and on a single card it is a repeat. B2 takes
        the circle out of the stake bar so the number lives in exactly
        one place. */''}
  ${v === 'b2'
    ? (st === 'pre'
      ? `<button class="stakebar empty"><span class="sb-l">Tap to stake points</span>
          <span class="sb-r"></span></button>`
      : `<button class="stakebar"><span class="sb-l"><b class="sb-ok">&#10003; Submitted</b>
          &middot; change until kickoff</span>
          <span class="sb-r"><span class="sb-pts">13 pts</span></span></button>`)
    : st === 'pre'
    ? `<button class="stakebar empty"><span class="sb-l">Tap to stake points</span>
        <span class="sb-r"><span class="sb-num blank">?</span></span></button>`
    : `<button class="stakebar"><span class="sb-l"><b class="sb-ok">&#10003; Submitted</b>
        &middot; change until kickoff</span>
        <span class="sb-r"><span class="sb-num set">4</span>
        <span class="sb-pts">13 pts</span></span></button>`}
</div>`;

const IDEAS = [
  ['b', 'the rank you staked, with the @ above it',
   'the one number you want while scrolling, and a dashed ? until you set it'],
  ['c', 'the @ over the game’s state',
   'nothing before kickoff, a padlock at lock, a pulsing dot live, a tick when final'],
  ['g', 'the rank alone, no @',
   'goes furthest and drops the @, here because it is the honest end of the idea'],
  ['e', 'the @ over the final margin',
   '+11 once it is over, a quiet dot before: the head already has the score'],
  ['d', 'the @ over a two-character clock',
   '2d, 0h, 2nd, FT. Duplicates the meta row, which is why I would not'],
  ['f', 'the @ in a clasp, nothing added',
   'no new information at all, it just stops the middle reading as a gap'],
  ['b2', 'B, with the number MOVED rather than copied',
   'the stake bar loses its circle, so the rank is in exactly one place'],
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
.stlab{padding:6px 14px 3px;font-size:9px;font-weight:700;letter-spacing:.06em;
  color:var(--chalk);font-family:'Roboto Mono',monospace}

/* ---- THE GUTTER VARIANTS ----
   .gutter is grid/place-items in the app because it holds one glyph.
   Two stacked items need a column, and each child has to be
   counter-skewed on its own rather than relying on the single span
   rule. */
.gutter.v{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px}
.gutter.v > *{transform:skewX(9deg)}
.at{font-family:'Roboto Mono',monospace;font-weight:700;color:var(--ink-mute);line-height:1}
/* A0 IS THE BUG, kept on the sheet for one row only so the fix has
   something to be compared against. --ink-faint is 3.77:1 here. */
.g-a0 .at{color:var(--ink-faint)}
.chip{width:19px;height:19px;border-radius:50%;display:grid;place-items:center;
  border:1.5px solid var(--stamp);color:var(--stamp);font-size:10.5px;font-weight:900;
  font-family:'Archivo',sans-serif;line-height:1}
.chip.blank{border-style:dashed;border-color:rgba(200,52,42,${BLANK_A});
  color:rgba(200,52,42,${BLANK_A})}
.chip.big{width:26px;height:26px;font-size:13px;border-width:2px}
.gwrap{display:grid;place-items:center;height:11px}
.gwrap.lock{color:var(--lock)}
.gwrap.done{color:var(--hit)}
.gwrap.void{height:11px}
.dot{width:7px;height:7px;border-radius:50%;background:var(--hit);animation:pulse 1.6s infinite}
.cd{font-size:8.5px;font-weight:700;color:var(--ink-mute);letter-spacing:.02em}
.mg{font-size:9.5px;font-weight:800;color:var(--hit)}
.g-e[data-st="pre"] .mg,.g-e[data-st="locked"] .mg,.g-e[data-st="live"] .mg{
  color:var(--ink-faint);font-size:12px}
.clasp{display:grid;place-items:center;width:24px;height:24px;border-radius:12px;
  background:var(--paper);box-shadow:inset 0 0 0 1px var(--rule)}
.clasp .at{transform:none}

/* ---- THE ZOOM ROW, so the gutters can be compared without the card
        around them. zoom, not transform:scale, because zoom takes part
        in layout and the boxes cannot overlap each other. ---- */
/* FOUR ACROSS AT 390px, AND THAT SETS THE ZOOM. At 2.2 the four @
   boxes were 92px each and the row wrapped 3 + 1, which reads as a
   mistake rather than a comparison. 1.8 puts 42px at 75.6px, so four
   plus three 12px gaps is 338 inside 362 of usable width. */
.zrow{display:flex;gap:12px;padding:8px 14px 4px;align-items:flex-start;flex-wrap:wrap}
.zbox{zoom:1.8}
.zbox .frame{width:42px;height:56px;background:var(--paper-2);overflow:hidden;
  display:flex;box-shadow:0 0 0 .5px var(--rule)}
.zbox .frame .gutter{flex:1 1 auto}
.zname{font-size:5.4px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;
  color:var(--lock);text-align:center;padding-top:2px;font-family:'Archivo',sans-serif}
`;

const doc = inner => `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800;900&family=Roboto+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body><div class="mocksheet">${inner}</div></body></html>`;

const zbox = (v, st, name) => `<div class="zbox"><div class="frame">${
  gutter(v, st)}</div><div class="zname">${name}</div></div>`;

const PAGES = [
  ['gutter-1-ideas-390.png', doc(`
    <div class="lab"><h3>The @, and what could sit with it</h3>
      <p><b>First, the @ itself.</b> The ink is already fixed and
        shipped: it was <code>3.77:1</code> and is now
        <code>5.30:1</code>. The <b>size</b> is your call, so here are
        three, magnified. The left one is the old ink at the current
        size, for comparison.</p></div>
    <div class="zrow">
      ${zbox('a0', 'pre', 'old ink 15px')}
      ${zbox('a1', 'pre', 'fixed 15px')}
      ${zbox('a2', 'pre', 'fixed 17px')}
      ${zbox('a3', 'pre', 'fixed 19px')}
    </div>
    <div class="lab">
      <p><b>Now the middle.</b> The gutter is 42px wide and 72px tall.
        There is room for the @ plus one thing: a 19px chip, a 10px
        glyph, or one line of 8.5px mono. The six below are magnified
        first and then shown on a real card.</p></div>
    <div class="zrow">
      ${zbox('b', 'staked', 'B rank')}
      ${zbox('c', 'live', 'C state')}
      ${zbox('g', 'staked', 'G rank only')}
      ${zbox('e', 'final', 'E margin')}
      ${zbox('d', 'pre', 'D clock')}
      ${zbox('f', 'pre', 'F clasp')}
    </div>`
    + IDEAS.map(([v, title, sub]) => `<div class="grp">
        <div class="cap">${v.toUpperCase()} <i>${title}</i></div>
        <div class="stlab">${sub}</div>
        ${card(v, v === 'e' ? 'final' : v === 'c' ? 'live' : 'staked')}
      </div>`).join(''))],

  ['gutter-2-states-390.png', doc(`
    <div class="lab"><h3>The two worth building, through all four states</h3>
      <p>A gutter is on every card in every state, so a variant that
        only works on one of them is not a variant. <b>B</b> carries the
        rank you staked. <b>C</b> carries what the game is doing. Both
        are shown unpicked, staked, live and final.</p>
      <p><b>B2</b> answers the fair objection to B: on a single card,
        straight B prints the rank twice, once in the gutter and once in
        the stake bar. B2 takes the circle out of the stake bar, so the
        number lives in one place and the bar keeps the words and the
        points.</p>
      <p><b>What I would build:</b> <b>B2</b>. The rank is the one thing
        you want while scrolling that is not already on screen, the
        dashed <code>?</code> turns the slate into a checklist of what
        you still have to stake, and moving it rather than copying it
        means nothing on the card is said twice. C is handsome, but
        every state it names is already named in words four lines above
        it in the meta row.</p>
      <p>One thing to weigh against B2: the stake bar's circle is what
        you TAP, and it is a 26px target in a 44px bar. The gutter chip
        is 19px and inside a panel that is not tappable. So B2 keeps
        the bar as the place you tap and the gutter as the place you
        read, which is the right split, but the bar loses its most
        obvious affordance and leans on the words instead.</p></div>`
    + ['b', 'b2', 'c'].map(v => `<div class="grp">
        <div class="cap">${v.toUpperCase()} <i>${
          IDEAS.find(i => i[0] === v)[1]}</i></div>
        ${['pre', 'staked', 'live', 'final'].map(st =>
          `<div class="stlab">${{ pre: 'not picked yet', staked: 'picked and staked',
            live: 'being played', final: 'finished' }[st]}</div>${card(v, st, 'CAR', 'NE')}`).join('')}
      </div>`).join(''))],
];

/* ------------------------------------------------------------------ */
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const OUT = new URL('../../docs/mockups/', import.meta.url).pathname;

const rows = [];
for (const [name, html] of PAGES) {
  const f = '/tmp/claude-0/' + name.replace('.png', '.html');
  fs.writeFileSync(f, html);
  await page.goto('file://' + f, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(700);
  await page.screenshot({ path: OUT + name, fullPage: true });

  /* MEASURE THE LIVE DOT WITH ITS PULSE STOPPED, and this needed
     saying out loud. @keyframes pulse runs opacity 1 -> .25 -> 1, and
     getComputedStyle reports whatever the animation is on at that
     instant: the first run of this sheet graded the dot at 1.72:1 and
     1.80:1 on two passes, which is the animation, not the colour. The
     dot's own contrast is what is measured below. It does dip under
     any floor at the bottom of each pulse, and so does the app's
     existing live dot in the meta row: that is what a pulse is, and it
     is why a pulse is never the only thing saying a game is live. */
  await page.addStyleTag({ content: '.dot{animation:none!important;opacity:1!important}' });
  await page.waitForTimeout(120);

  /* EVERY GLYPH IN EVERY GUTTER, against the paper it is on. A chip is
     a graphic and wants 3:1; the @ and the mono lines are text and want
     4.5. The zoomed boxes are measured too: they are the same markup,
     so if one of them is wrong the sheet is lying at the top. */
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
    for (const g of document.querySelectorAll('.gutter.v')) {
      const surf = surfaceOf(g);
      for (const el of g.querySelectorAll('.at,.chip,.cd,.mg,.dot,.gy')) {
        const cs = getComputedStyle(el);
        /* THE READ DEPENDS ON HOW THE THING IS PAINTED, and getting
           this wrong made the sheet report the live dot at 1.80:1.
           A stroked SVG and all the text take their colour from
           `color`, because stroke and fill are currentColor here. The
           dot is painted with a BACKGROUND, so its colour is
           backgroundColor and its surface is its PARENT'S, never its
           own: surfaceOf started at the element, found the dot's own
           green, and graded the green against itself. */
        const painted = el.classList.contains('dot');
        const src = painted ? cs.backgroundColor : cs.color;
        const surface = painted ? surfaceOf(el.parentElement) : surf;
        const parts = (src.match(/[\d.]+/g) || []).map(Number);
        const ca = parts.length > 3 ? parts[3] : 1;
        const a = ca * parseFloat(cs.opacity);
        const fg = parts.slice(0, 3).map((v, i) => v * a + surface[i] * (1 - a));
        const graphic = painted || el.classList.contains('chip')
          || el.getAttribute('class') === 'gy';
        /* className on an SVG element is an SVGAnimatedString, so
           String() on it gives "[object SVGAnimatedString]". */
        const cls = el.getAttribute('class') || el.tagName.toLowerCase();
        out.push({ v: g.dataset.v, st: g.dataset.st,
                   what: cls.split(' ')[0],
                   graphic, size: parseFloat(cs.fontSize), fg, bg: surface });
      }
    }
    return out;
  });
  rows.push(...got);
  console.log('wrote', name, '(' + (await page.evaluate(() => document.body.scrollHeight)) + 'px)');
}

console.log('\n  variant state    element  ratio  floor  verdict');
let bad = 0;
const seen = new Set();
for (const r of rows) {
  const key = `${r.v}|${r.st}|${r.what}`;
  if (seen.has(key)) continue;         /* the same markup twice is one fact */
  seen.add(key);
  const need = r.graphic ? 3 : 4.5;
  const v = cr(r.fg, r.bg);
  /* A0 IS ON THE SHEET TO FAIL. It is the old value, kept for one
     comparison box, so its failure is the point and is not counted. */
  const expected = r.v === 'a0';
  if (v < need && !expected) bad++;
  console.log(`   ${r.v.padEnd(7)} ${r.st.padEnd(8)} ${r.what.padEnd(8)} `
    + `${v.toFixed(2).padStart(5)}  ${need.toFixed(1)}  `
    + (v >= need ? 'ok' : expected ? 'fails, and that is why it is on the sheet'
                                   : '!! UNDER THE FLOOR'));
}
console.log(bad ? `\n!! ${bad} glyphs under their floor`
                : '\nevery glyph in every variant clears its own floor');

await ctx.close();
await b.close();
