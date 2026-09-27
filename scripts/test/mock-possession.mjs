/* MOCKUP SHEET: showing which team has the ball, on a live card.

   LEE: "is there a way to put a football or indicator to the team that
   has the ball in its current drive since we are already updating the
   live score? If so send me a mock up first."

   DRAWN AGAINST THE LIVE BUILD, NOT THE WORKING TREE. v1.38.3 is what
   is on everyone's phone. The tree here has unshipped v1.39.0 work in
   it (the @ disc, the per-club fade), and a mockup drawn from that
   would show Lee a card that does not exist for him. The stylesheet is
   read from the v1.38.3 index.html extracted out of the shipped zip.

   WHERE THE DATA COMES FROM, and this is the part that makes it cheap.
   index.html ALREADY fetches ESPN's scoreboard itself every 60 seconds
   while a game is live and the app is on screen (pullEspn, ESPN_FLOOR
   20s, setInterval 60s, paused when the tab is hidden). It already
   keeps two things out of that response: the score, into ESPN_LIVE, and
   status.type.shortDetail, into ESPN_CLOCK. Possession sits in the same
   event object: competitions[0].situation.possession is the team ID
   with the ball, and the competitor list in the same payload maps IDs
   to abbreviations. So this is a third value out of a fetch that is
   already happening, held in memory beside the other two. No Firestore
   write, no Worker change, no new request, no cost.

   THE HONEST LIMIT, and Lee should decide knowing it: the poll is once
   a minute, so the football can be up to a minute behind. A drive can
   change hands twice in that time. It will be right most of the time
   and visibly wrong some of the time, which is a different promise from
   the score, where being a minute late is invisible.

   AND ONE THING I CANNOT DO FROM HERE: this sandbox has no route to
   ESPN, so the exact field names could not be confirmed against a live
   response. They are the documented shape and the same ones the app
   already uses for the clock, but they should be read off one real
   in-progress game before this ships.

   FIVE TREATMENTS, and each has to survive the same test: either team
   can have the ball, so the indicator has to read on a club colour AND
   on the card's cream paper. Every football below is drawn in
   currentColor for exactly that reason.

     V1  a football next to the team's score
     V2  a football in the meta row, next to the clock, with the code
     V3  a football at the inner edge of the possessing panel
     V4  no football: a bar down the possessing side's inner edge
     V5  V1 plus the down and distance in the meta row

   Run: node mock-possession.mjs
   Out: docs/mockups/possession-1-options-390.png
*/
import { chromium } from 'playwright';
import fs from 'node:fs';

/* THE LIVE FILE, not ../../index.html. */
/* The v1.38.3 build these sheets were drawn against. Resolve it against
   THIS file, never a hardcoded checkout: a hardcoded path once made a
   harness grade a tree other than the one being shipped. Override with
   MOCK_BASE if you want to draw the sheets against a different build. */
const LIVE = process.env.MOCK_BASE
  || new URL('../../index.html', import.meta.url).pathname;

/* THESE SHEETS ARE HISTORY. They were drawn against v1.38.3, BEFORE the
   football existed, so each one paints its own candidate footballs over
   a clean base. Run one against a build that already ships the football
   and every card draws two. Point MOCK_BASE at a pre-v1.39.0 index.html
   to redraw them. */
if (/class="ball"/.test(fs.readFileSync(LIVE, 'utf8')))
  throw new Error('this base already ships the football; set MOCK_BASE to a pre-v1.39.0 index.html');
const APP = fs.readFileSync(LIVE, 'utf8');
const STYLE = APP.slice(APP.indexOf('<style>') + 7, APP.indexOf('</style>'));
if (/atdisc/.test(STYLE)) throw new Error('that is the working tree, not the live build');

const T = (() => {
  const blk = APP.slice(APP.indexOf('const T={'), APP.indexOf("'#FFB612']};") + 14);
  const out = {};
  for (const m of blk.matchAll(
    /(\w+):\['([^']*)','([^']*)','(#[0-9A-Fa-f]{6})','(#[0-9A-Fa-f]{6})'\]/g))
    out[m[1]] = [m[2], m[3], m[4], m[5]];
  return out;
})();
if (Object.keys(T).length !== 32) throw new Error('parsed ' + Object.keys(T).length + ' clubs');

const lin = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
const rgbOf = hex => { const h = hex.replace('#', '');
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
const lumOf = c => .2126 * lin(c[0]) + .7152 * lin(c[1]) + .0722 * lin(c[2]);
const cr = (a, b) => { const x = lumOf(a), y = lumOf(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };

/* THE BALL. An inline SVG, filled and stroked in currentColor, so it
   takes the white of a lit panel or the muted ink of the cream side
   without a second asset and without an emoji, which renders as a
   different picture on every phone and cannot be recoloured at all. */
/* STROKED, NOT FILLED, and that is not a style preference. The first
   version filled the ellipse with currentColor and drew the laces in
   #fff on top: on the white side that is white laces on a white ball,
   so at 15px it rendered as a plain oval with no laces at all and read
   as a dot. An outline takes its colour from one place, so the laces
   are always the same colour as the ball and always visible, on a club
   colour and on cream alike. */
const BALL = (cls = '') => `<svg class="ball ${cls}" viewBox="0 0 24 15" aria-hidden="true">
  <ellipse cx="12" cy="7.5" rx="10.6" ry="6.1" fill="none"
           stroke="currentColor" stroke-width="1.7"/>
  <path d="M7.4 7.5h9.2M9.6 5.3v4.4M12 4.9v5.2M14.4 5.3v4.4"
        fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>`;

const side = (code, which, lit, hasBall, v) => {
  const ball = hasBall && (v === 'v1' || v === 'v5')
    ? `<span class="pos">${BALL()}</span>` : '';
  const edge = hasBall && v === 'v3' ? `<span class="edgeball">${BALL()}</span>` : '';
  return `<button class="side ${which} ${lit ? 'won' : 'lost'}${
      hasBall && v === 'v4' ? ' hasball' : ''}"${
      lit ? ` style="background:${T[code][2]}"` : ''}>
    <div class="mark" style="background:${T[code][2]};--sec:${T[code][3]}"><span>${code}</span></div>
    <div class="names"><div class="city">${T[code][0]}</div>
      <div class="team">${T[code][1]}</div>
      <div class="scr mono">${ball}${lit ? 17 : 13}</div></div>${edge}</button>`;
};

/* A LIVE CARD, which is the only state this feature exists in: the meta
   row carries ESPN's own clock on the left and IN PROGRESS on the
   right, and the lock band sits under the matchup. */
const card = (v, a, h, ball) => `
<div class="card locked" data-v="${v}" data-ball="${ball}">
  <div class="meta">
    <span class="cd live lefted">2nd &middot; 5:42</span>
    ${v === 'v2' || v === 'v5'
      ? `<span class="metapos">${BALL('dim')}<b>${ball === 'a' ? a : h}</b>${
          v === 'v5' ? ' <i>2nd &amp; 7</i>' : ''}</span>`
      : `<span class="net">CBS</span>`}
    <span class="cd live nodot">In progress</span></div>
  <div class="match">${side(a, 'l', false, ball === 'a', v)}
    <div class="gutter"><span>@</span></div>
    ${side(h, 'r', true, ball === 'h', v)}</div>
  <div class="lockband"><span>In progress &middot; locked</span>
    <span>You took ${h} &middot; Rank 4 &middot; 13 pts if it holds</span></div>
</div>`;

const VARIANTS = [
  ['v1', 'a football beside that team’s score',
   'rides the line your eye is already on, and moves sides as the ball does'],
  ['v2', 'a football and the code in the meta row',
   'one fixed place to look, and it names the team rather than pointing at it'],
  ['v3', 'a football at the inner edge of the panel',
   'points across the gutter at the team, like a marker on the field'],
  ['v4', 'no football: a bar down the inner edge',
   'quietest of the five, and the only one that adds no new object'],
  ['v5', 'V1 plus the down and distance',
   'the ball on the score, 2nd & 7 in the meta row where the clock is'],
];

const CSS = `
${STYLE}
.mocksheet{padding:0 0 30px}
.lab{padding:20px 14px 4px}
.lab h3{margin:0;font-size:13px;font-weight:900;color:var(--paper)}
.lab p{margin:5px 0 10px;font-size:10.5px;line-height:1.55;color:var(--chalk)}
.lab b{color:var(--paper)}
.lab code{font-family:'Roboto Mono',monospace;font-size:9.5px;color:var(--lock)}
.cap{padding:15px 14px 5px;font-size:8.5px;font-weight:800;letter-spacing:.13em;
  text-transform:uppercase;color:var(--lock)}
.cap i{font-style:normal;color:var(--chalk);letter-spacing:.04em;text-transform:none;
  font-weight:600}
.grp{margin-top:6px;border-top:1px solid rgba(250,247,241,.09);padding-top:2px}
.stlab{padding:7px 14px 3px;font-size:9px;font-weight:700;letter-spacing:.05em;
  color:var(--chalk);font-family:'Roboto Mono',monospace}

/* ---- WHAT WOULD BE ADDED ----
   currentColor throughout: the lit side is already color:#fff and the
   cream side is already --ink-mute, so one drawing serves both and
   neither needs a rule of its own. */
.ball{width:17px;height:11px;flex:0 0 17px;color:inherit}
/* A MAGNIFIED ROW, so the shape can be judged before the placement. */
.zrow{display:flex;gap:20px;padding:10px 14px 4px;align-items:center}
.zball{zoom:3.4;display:inline-flex}
.zball.onpaper{color:var(--ink-mute);background:var(--paper-2);padding:3px 4px}
.zball.onclub{color:#fff;background:#00338D;padding:3px 4px}
.scr{display:flex;align-items:center;gap:6px}
.side.r .scr{flex-direction:row-reverse}
.pos{display:inline-flex;align-items:center}

/* V2 and V5: the meta row's own slot, in the card's quiet ink. */
.metapos{display:inline-flex;align-items:center;gap:5px;font-size:9.5px;
  font-weight:800;letter-spacing:.04em;color:var(--ink-soft)}
.metapos .ball{width:13px;height:9px;flex:0 0 13px}
.metapos i{font-style:normal;font-weight:700;opacity:.8;
  font-family:'Roboto Mono',monospace;font-size:9px}

/* V3: against the gutter, on whichever side has the ball. */
.side{position:relative}
.edgeball{position:absolute;top:50%;transform:translateY(-50%);
  display:inline-flex;align-items:center}
.side.l .edgeball{right:6px}
.side.r .edgeball{left:6px}

/* V4: the bar, in the live green on the cream side and in white on a
   club colour, because one colour cannot do both grounds. */
.side.hasball{box-shadow:inset 0 0 0 0 transparent}
.side.l.hasball{border-right:3px solid var(--hit)}
.side.r.hasball{border-left:3px solid var(--hit)}
.side.won.hasball{border-color:rgba(255,255,255,.95)}

.side.won{flex-grow:1.12;color:#fff}
.side.won .mark{box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.92)}
.side.won .city{opacity:.92}
`;

const doc = inner => `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800;900&family=Roboto+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body><div class="mocksheet">${inner}</div></body></html>`;

/* KANSAS CITY AT BUFFALO: one light club and one dark one, so every
   variant is shown with the ball on a colour AND on the cream paper. */
const PAIR = ['KC', 'BUF'];

const PAGE = doc(`
  <div class="lab"><h3>Who has the ball, on a live card</h3>
    <p><b>The data is already arriving.</b> The app fetches ESPN's
      scoreboard itself every <code>60s</code> while a game is live, and
      already keeps two things from it: the score and the clock you see
      top left. Possession is a third value in the same response. No
      Firestore write, no Worker change, no extra request.</p>
    <p><b>The limit, stated first.</b> That poll is once a minute, so
      the football can be up to a minute behind, and a drive can change
      hands twice in a minute. It will be right most of the time and
      visibly wrong some of the time. The score does not have that
      problem, because a minute-old score still reads as true.</p>
    <p>Each variant is shown twice: the ball with the team you took
      (the coloured panel) and with the other team (the cream one),
      because either can have it and the indicator has to work on
      both.</p></div>`
  + `<div class="cap">the shape itself, magnified <i>on cream, and on a club colour</i></div>
     <div class="zrow"><span class="zball onpaper">${BALL()}</span>
       <span class="zball onclub">${BALL()}</span></div>`
  + VARIANTS.map(([v, title, sub]) => `<div class="grp">
      <div class="cap">${v.toUpperCase()} <i>${title}</i></div>
      <div class="stlab">${sub}</div>
      <div class="stlab">the team you took has the ball</div>
      ${card(v, ...PAIR, 'h')}
      <div class="stlab">the other team has it</div>
      ${card(v, ...PAIR, 'a')}
    </div>`).join('')
  + `<div class="lab">
      <p><b>What I would build:</b> <b>V1</b>. It sits on the line your
        eye is already reading, it moves across the card as the ball
        does, which is the one thing a fixed label cannot show, and it
        adds no row and no new place to look. <b>V2</b> is the safest if
        the once-a-minute staleness bothers you, because naming a team
        in a quiet row claims less than a ball sitting on their
        score.</p></div>`);

/* ------------------------------------------------------------------ */
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const OUT = new URL('../../docs/mockups/', import.meta.url).pathname;
const name = 'possession-1-options-390.png';
const f = '/tmp/claude-0/' + name.replace('.png', '.html');
fs.writeFileSync(f, PAGE);
await page.goto('file://' + f, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(700);
await page.screenshot({ path: OUT + name, fullPage: true });
console.log('wrote', name, '(' + (await page.evaluate(() => document.body.scrollHeight)) + 'px)');

/* EVERY BALL, AGAINST WHATEVER IT LANDS ON. A graphic wants 3:1, and
   the whole point of currentColor is that the answer differs by side,
   so both sides are read rather than one. */
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
  for (const card of document.querySelectorAll('.card')) {
    for (const ball of card.querySelectorAll('.ball')) {
      const cs = getComputedStyle(ball);
      const r = ball.getBoundingClientRect();
      const side = ball.closest('.side');
      /* THE COLOUR'S OWN ALPHA COUNTS. currentColor on the cream side
         is --ink-mute, which is rgba(21,23,27,.66): reading the RGB
         triple alone reported the ball at 14.70:1, a number that is not
         on the screen. Same trap as the paper-ink sheet. */
      const bg = surfaceOf(ball.parentElement);
      const parts = (cs.color.match(/[\d.]+/g) || []).map(Number);
      const ca = parts.length > 3 ? parts[3] : 1;
      out.push({
        v: card.dataset.v, ball: card.dataset.ball,
        where: side ? (side.classList.contains('won') ? 'club colour' : 'cream side')
                    : 'meta row',
        fg: parts.slice(0, 3).map((x, i) => x * ca + bg[i] * (1 - ca)), bg,
        w: +r.width.toFixed(1), h: +r.height.toFixed(1),
      });
    }
    /* V4 has no ball, so its bar is the thing to grade. */
    const bar = card.querySelector('.side.hasball');
    if (bar) {
      const cs = getComputedStyle(bar);
      const c = cs.borderRightWidth !== '0px' ? cs.borderRightColor : cs.borderLeftColor;
      /* A BORDER IS GRADED AGAINST THE PANEL IT EDGES, not against the
         card behind it: surfaceOf(parent) walked up to the card's paper
         and reported a white bar on a club colour as 1.07:1, which is
         white on cream, a surface the bar never touches. */
      const bg = surfaceOf(bar);
      const parts = (c.match(/[\d.]+/g) || []).map(Number);
      const ca = parts.length > 3 ? parts[3] : 1;
      out.push({ v: card.dataset.v, ball: card.dataset.ball,
        where: bar.classList.contains('won') ? 'club colour' : 'cream side',
        fg: parts.slice(0, 3).map((x, i) => x * ca + bg[i] * (1 - ca)),
        bg, w: 3, h: 72, bar: true });
    }
  }
  return out;
});

console.log('\n  variant  ball on       size      ratio  floor  verdict');
let bad = 0;
for (const r of got) {
  const v = cr(r.fg, r.bg);
  if (v < 3) bad++;
  console.log(`   ${r.v.padEnd(8)} ${r.where.padEnd(13)} `
    + `${(r.bar ? 'bar 3px' : `${r.w}x${r.h}`).padEnd(9)} `
    + `${v.toFixed(2).padStart(5)}  3.0    ${v >= 3 ? 'ok' : '!! UNDER THE FLOOR'}`);
}
console.log(bad ? `\n!! ${bad} indicators under 3:1`
  : '\nevery indicator clears 3:1 on the side it sits on');

await ctx.close();
await b.close();
