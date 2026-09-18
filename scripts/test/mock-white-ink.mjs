/* MOCKUP SHEET: white writing everywhere, and the white ring.

   LEE'S TWO INSTRUCTIONS:
     1. No black writing anywhere on a game card or in the badge area.
        All white, consistently.
     2. Try a thin white ring around the small team logo box on the
        selected or winning team, which might be the fix.

   WHAT THE BLACK WRITING ACTUALLY IS. onColor() runs on the LIT side of
   a card, the team you took or the team that won, and it returns dark
   ink for the four primaries that are too light for white text: CIN
   #FB4F14, MIA #008E97, CAR #0085CA, LAC #0080C6. That is the only
   black writing on a card. The badge abbreviation and the pool bar
   label are already white on all 32.

   THE HONEST PART, and the reason this sheet measures instead of
   asserting. A white ring around the badge makes the badge read
   against a light colour. It does nothing for the TEAM NAME beside it,
   which is the text the black was there for. So variant B is Lee's idea
   exactly as asked, with the numbers it produces; variant C is B plus
   the one change that makes white text actually clear the floor, which
   is a slight darkening of the lit panel; variant D is the text shadow
   people reach for, shown so it can be ruled out on sight.

   THE THRESHOLDS ARE NOT ALL 4.5, and that matters here:
     .scr   21px / 800  -> large text, 3:1        all four already pass
     .team  16px / 800  -> normal text, 4.5:1     all four fail on white
     .city  9.5px / 600 at opacity .62            worst of the three
   Every ratio below is computed from the rendered pixels, including the
   .62 opacity composite, which is the one most easily got wrong by eye.

   Run: node mock-white-ink.mjs
   Out: docs/mockups/white-ink-1-teams-390.png
        docs/mockups/white-ink-2-ring-390.png
*/
import { chromium } from 'playwright';
import fs from 'node:fs';

const APP = fs.readFileSync(new URL('../../index.html', import.meta.url).pathname, 'utf8');
const STYLE = APP.slice(APP.indexOf('<style>') + 7, APP.indexOf('</style>'));

const T = {
  CIN: ['Cincinnati', 'Bengals', '#FB4F14', '#000000'],
  MIA: ['Miami', 'Dolphins', '#008E97', '#FC4C02'],
  CAR: ['Carolina', 'Panthers', '#0085CA', '#101820'],
  LAC: ['Los Angeles', 'Chargers', '#0080C6', '#FFC20E'],
  KC:  ['Kansas City', 'Chiefs', '#E31837', '#FFB81C'],
  SEA: ['Seattle', 'Seahawks', '#002244', '#69BE28'],
  CLE: ['Cleveland', 'Browns', '#311D00', '#FF3C00'],
  CHI: ['Chicago', 'Bears', '#0B162A', '#C83803'],
};

/* WCAG maths, and the scrim solved rather than guessed. White text needs
   L <= 1.05/4.5 - 0.05 = 0.18333 to clear 4.5:1. Darkening by a black
   overlay at alpha a multiplies each sRGB channel by (1-a), so the
   linear luminance falls by roughly (1-a)^2.4 — which inverts to give
   the exact alpha each club needs and no more. */
const lin = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
const rgbOf = hex => {
  const h = hex.replace('#', '');
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
};
const lumOf = c => .2126 * lin(c[0]) + .7152 * lin(c[1]) + .0722 * lin(c[2]);
const ratio = (a, b) => {
  const x = lumOf(a), y = lumOf(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
};
const darken = (hex, a) => {
  const c = rgbOf(hex).map(v => Math.round(v * (1 - a)));
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
};
/* SOLVED, NOT APPROXIMATED. The first version computed the alpha from
   (1-a)^2.4, which is the shape of the sRGB curve but not the curve: it
   also has a linear segment near black, and channels round to integers.
   Every club it produced landed between 4.42 and 4.52 instead of 4.5,
   so three of the four were still failing by a hair on a sheet whose
   entire job is to say whether they pass. Scanning the real composite
   cannot be wrong by an approximation, because there is none left. */
const WHITE = [255, 255, 255];
const scrimFor = (hex, need = 4.5) => {
  for (let a = 0; a <= .5; a += .005)
    if (ratio(WHITE, rgbOf(darken(hex, a))) >= need) return Math.round(a * 1000) / 1000;
  return .5;
};

/* ---------------------------------------------------------------- */
/* The real card markup, with the winning side lit. `mode` picks the
   variant; nothing else differs between them. */
const mark = (code, mode) => `<div class="mark${
  mode === 'A' ? '' : ' ringed'}" style="background:${T[code][2]};--sec:${
  T[code][3]}"><span>${code}</span></div>`;

const side = (code, which, won, score, mode) => {
  const hex = T[code][2];
  const a = (mode === 'C') ? scrimFor(hex) : 0;
  const bg = won ? ` style="background:${a ? darken(hex, a) : hex}"` : '';
  return `<button class="side ${which} ${won ? 'won' : 'lost'}${
    mode === 'D' && won ? ' shadowed' : ''}${
    (mode === 'E' || mode === 'C') && won ? ' litc' : ''}"${bg}>
    ${won ? mark(code, mode) : mark(code, 'A')}
    <div class="names"><div class="city">${T[code][0]}</div>
      <div class="team">${T[code][1]}</div>
      <div class="scr mono">${score}</div></div></button>`;
};

const card = (away, home, wonSide, as, hs, mode) => `
<div class="card locked" data-mode="${mode}" data-team="${wonSide === 'a' ? away : home}">
  <div class="meta fmeta"><span class="fin mono"><b>Final</b> &middot; ${
    wonSide === 'a' ? away + ' ' + as + '-' + hs : home + ' ' + hs + '-' + as}</span></div>
  <div class="match">${side(away, 'l', wonSide === 'a', as, mode)}
    <div class="gutter"><span>@</span></div>
    ${side(home, 'r', wonSide === 'h', hs, mode)}</div>
</div>`;

const MODES = [
  ['A', 'all white, nothing else changed', ''],
  ['B', 'all white, plus the thin white ring', ''],
  ['E', 'B, plus the city line at full white', ''],
  ['C', 'E, plus the panel darkened just enough', ''],
  ['D', 'B, plus a text shadow, to rule it out', ''],
];

/* The four light clubs, then two that were always fine, so the sheet
   shows what the change costs where nothing was wrong. */
const GAMES = [
  ['CLE', 'CIN', 'h', 20, 34],
  ['MIA', 'CHI', 'a', 27, 20],
  ['CAR', 'SEA', 'a', 24, 17],
  ['LAC', 'KC',  'a', 38, 25],
  ['KC',  'CLE', 'a', 31, 13],
  ['SEA', 'CHI', 'a', 24, 21],
];

const teamBlock = (g, modes) => `<div class="grp">
  <div class="glab">${T[g[2] === 'a' ? g[0] : g[1]][1]} win &middot; ${
    T[g[2] === 'a' ? g[0] : g[1]][2]}</div>
  <div class="gsub">white text needs <b>4.5:1</b> at 16px, <b>3:1</b> at 21px${
    scrimFor(T[g[2] === 'a' ? g[0] : g[1]][2])
      ? ` &middot; C darkens this one by <b>${
          Math.round(scrimFor(T[g[2] === 'a' ? g[0] : g[1]][2]) * 100)}%</b>`
      : ' &middot; C leaves this one alone'}</div>
  ${modes.map(m => `<div class="cap">${m} &mdash; ${
    MODES.find(x => x[0] === m)[1]}</div>${card(...g, m)}`).join('')}
</div>`;

const CSS = `
${STYLE}
.mocksheet{margin:0 auto;padding:0 0 30px}
.lab{padding:20px 14px 4px}
.lab h3{margin:0;font-size:13px;font-weight:900;color:var(--paper)}
.lab p{margin:5px 0 10px;font-size:10.5px;line-height:1.5;color:var(--chalk)}
.lab b{color:var(--paper)}
.lab code{font-family:'Roboto Mono',monospace;font-size:9.5px}
.grp{margin-top:14px;border-top:1px solid rgba(250,247,241,.09);padding-top:10px}
.glab{padding:0 14px;font-size:11.5px;font-weight:800;color:var(--paper)}
.gsub{padding:3px 14px 2px;font-size:9.5px;color:var(--chalk);
  font-family:'Roboto Mono',monospace}
.gsub b{color:var(--paper)}
.cap{padding:9px 14px 4px;font-size:8.5px;font-weight:800;letter-spacing:.13em;
  text-transform:uppercase;color:var(--lock)}
.meta.fmeta{justify-content:center}
.meta.fmeta>:first-child{margin-right:0}
.meta .fin b{font-weight:800;letter-spacing:.09em;text-transform:uppercase;
  color:var(--ink-mute)}

/* ---- WHAT WOULD CHANGE IN THE APP ----
   1. The lit side is white, always. onColor is not consulted. */
.side.won{color:#fff}
.side.won .city{opacity:.62}

/* 2. The ring: a thin white hairline round the badge on the lit side.
      Inset so it sits inside the rounded corner rather than outside it,
      and it replaces the dark hairline .mark already carries, which on
      a light club is doing nothing. */
.mark.ringed{box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.92)}

/* 3. E and C: the city line goes to FULL white. At opacity .62 it is by
      far the worst text on any card, measured 2.08:1 on Cincinnati and
      2.48:1 on Kansas City, a club that never had black text and was
      therefore never questioned. That line is redundant too: "LOS
      ANGELES" sits directly above "Chargers". Full white costs nothing
      and fixes it on all 32. */
.side.won.litc .city{opacity:1}

/* 4. D only: the shadow. */
.side.won.shadowed .city,.side.won.shadowed .team,.side.won.shadowed .scr{
  text-shadow:0 1px 2px rgba(0,0,0,.55)}
`;

const doc = inner => `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800;900&family=Roboto+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body><div class="mocksheet">${inner}</div></body></html>`;

const PAGES = [
  ['white-ink-1-teams-390.png', doc(`
    <div class="lab"><h3>All white, and the white ring</h3>
      <p>The black writing is <b>only</b> on the lit side of a card, the
        team you took or the team that won, and only on the four clubs
        whose colour is too light for white text. The badge letters and
        the pool bar were already white everywhere.</p>
      <p><b>A</b> is what dropping the black gives you on its own.
        <b>B</b> adds your ring. <b>E</b> also takes the small city line
        off 62% opacity, which turns out to be the worst text on any
        card: <b>2.08:1</b> on Cincinnati and <b>2.48:1</b> on Kansas
        City, a club that never had black text and so was never
        questioned. <b>C</b> is E plus darkening the lit panel by the
        smallest amount that gets white over 4.5:1, computed per club.
        <b>D</b> is the text shadow, shown to be ruled out: it changes
        nothing measurable.</p>
      <p>Cincinnati is the extreme case and is first. C darkens it more
        than any other club in the league.</p></div>`
    + teamBlock(GAMES[0], ['A', 'B', 'E', 'C', 'D'])
    + teamBlock(GAMES[1], ['A', 'B', 'E', 'C']))],

  ['white-ink-2-ring-390.png', doc(`
    <div class="lab"><h3>The other two light clubs, and two that were always fine</h3>
      <p>Carolina and the Chargers are the milder half of the problem.
        Kansas City and Seattle were never black and are here to show
        what the ring does where nothing was wrong: on a dark club it is
        the only visible change, and it is a hairline.</p></div>`
    + GAMES.slice(2).map(g => teamBlock(g, ['B', 'E', 'C'])).join(''))],
];

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
  /* MEASURED FROM THE RENDERED PIXELS, opacity included. getComputedStyle
     reports .city's colour as white and its opacity separately, so the
     composite has to be done here or the worst line on the card is the
     one that goes unchecked. */
  const got = await page.evaluate(() => {
    const px = s => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const out = [];
    for (const card of document.querySelectorAll('.card')) {
      const won = card.querySelector('.side.won');
      if (!won) continue;
      const bg = px(getComputedStyle(won).backgroundColor);
      const one = sel => {
        const el = won.querySelector(sel); if (!el) return null;
        const cs = getComputedStyle(el);
        const a = parseFloat(cs.opacity);
        const fg = px(cs.color).map((v, i) => v * a + bg[i] * (1 - a));
        return { fg, size: parseFloat(cs.fontSize), weight: +cs.fontWeight,
                 white: cs.color === 'rgb(255, 255, 255)' };
      };
      out.push({ mode: card.dataset.mode, team: card.dataset.team, bg,
                 city: one('.city'), team16: one('.team'), scr: one('.scr'),
                 ring: getComputedStyle(won.querySelector('.mark')).boxShadow });
    }
    return out;
  });
  rows.push(...got);
  console.log('wrote', name, '(' + (await page.evaluate(() => document.body.scrollHeight)) + 'px)');
}

const cr = (fg, bg) => {
  const x = lumOf(fg), y = lumOf(bg);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
};
console.log('\n  mode team   city(4.5)  name(4.5)  score(3.0)   all white?');
for (const r of rows) {
  const c = cr(r.city.fg, r.bg), n = cr(r.team16.fg, r.bg), s = cr(r.scr.fg, r.bg);
  const f = (v, need) => v.toFixed(2).padStart(5) + (v >= need ? ' ok ' : ' !! ');
  console.log(`   ${r.mode}   ${r.team.padEnd(4)} ${f(c, 4.5)}  ${f(n, 4.5)}  ${f(s, 3.0)}`
    + `  ${r.city.white && r.team16.white && r.scr.white ? 'yes' : 'NO'}`
    + (/rgb\(255, 255, 255\)|rgba\(255, 255, 255/.test(r.ring) ? '  ring' : ''));
}
const anyBlack = rows.filter(r => !(r.city.white && r.team16.white && r.scr.white));
console.log(anyBlack.length ? `!! black text still on ${anyBlack.length} cards`
                            : 'every card on both sheets is white text throughout');
await ctx.close();
await b.close();
