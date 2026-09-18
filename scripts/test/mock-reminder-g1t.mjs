/* THE CHOSEN REMINDER COPY: G1-tight, commas throughout.

   Lee picked G1-tight and asked for the comma in every one of them, so
   this sheet is no longer a set of options. It is the spec: every bunch
   at every tier it can fire, so the wording can be signed off before
   anything in worker/live.js is touched.

   THE SHAPE
     title   Lee, Thursday Night Football
     body    Kicks off in 22 min. No team selected yet.
             Unselected games score 0.

   NO DASHES ANYWHERE. Where one joined two clauses it is a full stop,
   where it joined a countdown to a clock reading it is a comma. Same
   rule in the sheet's own prose.

   FIVE BUNCHES, from his answer: Thursday Night Football, the Sunday
   morning games, the Sunday afternoon games, Sunday Night Football,
   Monday Night Football. A bunch of one game says "No team selected
   yet"; a bunch of several counts what is left of that bunch, which is
   what he asked the two Sunday groups to do.

   FOUR TIERS, unchanged from what the sender already does: two days
   out, under a day, a few hours, then ten to seventy five minutes.

   Not the app's typeface, on purpose. iOS draws a notification in its
   own font at its own size, so measuring line breaks in Archivo would
   flatter them.

   Run: node mock-reminder-g1t.mjs
   Out: docs/mockups/reminder-g1t-1-spec-390.png
        docs/mockups/reminder-g1t-2-edges-390.png
*/
import { chromium } from 'playwright';
import fs from 'node:fs';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

/* ---------------------------------------------------------------- */
/* THE COPY. This block is the whole specification; everything below it
   is presentation. compose() in worker/live.js has to produce exactly
   these two strings. */

/* Singular and plural have to agree with the COUNT LEFT, not with the
   size of the bunch: "1 of 9 still needs a pick" and "6 of 9 still need
   a pick" are both sentences that will really be sent. */
const needs = k => k === 1 ? 'needs' : 'need';

const kick = f => {
  if (f.tier === 'final') return `in ${f.mins} min`;
  if (f.tier === 'hours') return `in ${f.h} hour${f.h > 1 ? 's' : ''}`;
  if (f.tier === 'day')   return `in ${f.h} hours, ${f.w}`;
  return f.w;                                   // two days out: just the clock
};

/* The warning earns its space only when it is nearly true. Two days out
   "unselected games score 0" is a fact about a hypothetical, and it was
   also what pushed this body onto a third line. It appears from the
   hours tier down. */
const warn = f => (f.tier === 'hours' || f.tier === 'final')
  ? ' Unselected games score 0.' : '';

const G1T = f => [
  `${f.who}, ${f.slate}`,
  f.total === 1
    ? `Kicks off ${kick(f)}. No team selected yet.${warn(f)}`
    : `First kickoff ${kick(f)}. ${f.left} of ${f.total} still ${
        needs(f.left)} a pick.${warn(f)}`,
];

/* ---------------------------------------------------------------- */
const card = (title, body, age = 'now') => `
<div class="ios">
  <div class="icon"><span>P</span></div>
  <div class="txt">
    <div class="trow"><div class="title">${esc(title)}</div>
      <div class="age">${age}</div></div>
    <div class="body">${esc(body)}</div>
  </div>
</div>`;

const row = (lab, f, age) => {
  const [t, b] = G1T(f);
  return `<div class="opt" data-lab="${esc(lab)}">
    <div class="oname">${esc(lab)}</div>${card(t, b, age)}</div>`;
};

/* THE FIVE BUNCHES in a typical 16 game week, with Lee's own timezone
   on the clock: GMT+9 puts Thursday night on Friday morning, which is
   also how the Picks tab labels it. */
const B = {
  tnf:  { slate: 'Thursday Night Football', total: 1, w: 'Fri 9:15 AM' },
  sun1: { slate: 'Sunday morning games',    total: 9, w: 'Sun 2:00 AM' },
  sun2: { slate: 'Sunday afternoon games',  total: 4, w: 'Sun 5:00 AM' },
  snf:  { slate: 'Sunday Night Football',   total: 1, w: 'Sun 9:20 AM' },
  mnf:  { slate: 'Monday Night Football',   total: 1, w: 'Tue 9:15 AM' },
};
const TIERS = [
  ['two days out',        { tier: 'open',  h: 44, mins: 2640 }],
  ['under a day',         { tier: 'day',   h: 20, mins: 1200 }],
  ['a few hours',         { tier: 'hours', h: 3,  mins: 180 }],
  ['ten to seventy five minutes', { tier: 'final', h: 1, mins: 22 }],
];

/* For a multi game bunch the count moves as the week goes on, which is
   the point of counting per bunch. These are the numbers a real player
   produces: nothing done, then some, then nearly all. */
const LEFT = { 9: [9, 9, 6, 2], 4: [4, 4, 4, 1], 1: [1, 1, 1, 1] };

const bunchBlock = (key, label) => {
  const b = B[key];
  return `<div class="grp">
    <div class="glab">${esc(b.slate)}</div>
    <div class="gsub">${b.total === 1 ? 'one game, so no count'
      : b.total + ' games, counted as they get picked'} &middot; kickoff <b>${b.w}</b></div>
    ${TIERS.map(([tlab, t], i) => row(`${tlab}`,
      { who: 'Lee', ...b, ...t, left: LEFT[b.total][i] })).join('')}
  </div>`;
};

/* ---------------------------------------------------------------- */
/* EDGE CASES. Every one of these is a sentence that will be sent, and
   each has a way of coming out wrong. */
const EDGES = [
  ['one left out of nine, so the verb is "needs" not "need"',
   { who: 'Lee', ...B.sun1, tier: 'hours', h: 3, mins: 180, left: 1 }],
  ['one hour, so "hour" not "hours"',
   { who: 'Lee', ...B.sun2, tier: 'hours', h: 1, mins: 60, left: 4 }],
  ['the last game of the week, and nothing else is left',
   { who: 'Lee', ...B.mnf, tier: 'final', h: 1, mins: 25, left: 1 }],
  ['two days out, where the warning is deliberately absent',
   { who: 'Lee', ...B.sun1, tier: 'open', h: 44, mins: 2640, left: 9 }],
  ['a short name',
   { who: 'Bob', ...B.tnf, tier: 'final', h: 1, mins: 22, left: 1 }],
  ['a long one',
   { who: 'Jean-Baptiste III', ...B.tnf, tier: 'final', h: 1, mins: 22, left: 1 }],
];

const NAMES = ['Bob', 'Lee', 'Monse', 'Eliana', 'Angelica', 'Christopher',
               'Bartholomew', 'Maria Fernanda', 'Jean-Baptiste III'];

const CSS = `
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{margin:0;background:#141414;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;
    -webkit-font-smoothing:antialiased}
  .sheetwrap{padding:0 0 30px}
  .head{padding:22px 16px 8px}
  .head h1{margin:0;font-size:17px;font-weight:700;color:#fff;letter-spacing:-.01em}
  .head p{margin:7px 0 0;font-size:12.5px;line-height:1.5;color:#9a9a9e}
  .head b{color:#e6e6eb}
  .head code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;
    background:#242426;padding:1px 4px;border-radius:4px;color:#d0d0d4}
  .grp{margin-top:16px;border-top:1px solid #2a2a2c;padding-top:13px}
  .glab{padding:0 16px;font-size:12px;font-weight:700;color:#fff}
  .gsub{padding:3px 16px 4px;font-size:11px;color:#8a8a8e;
    font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  .gsub b{color:#c8c8cc}
  .opt{padding:9px 10px 0}
  .oname{padding:0 6px 5px;font-size:10.5px;font-weight:700;color:#e8b84b;letter-spacing:.02em}
  .onote{padding:0 6px 7px;font-size:10.5px;line-height:1.5;color:#8a8a8e}
  .ios{display:flex;gap:11px;align-items:flex-start;background:#2c2c2eE6;
    border-radius:18px;padding:11px 13px 12px;margin:0 6px 6px}
  .icon{width:38px;height:38px;flex:0 0 38px;border-radius:9px;background:#1b1b1d;
    display:grid;place-items:center;border:1px solid #3a3a3c}
  .icon span{font-size:15px;font-weight:800;color:#d8483c;
    font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  .txt{flex:1;min-width:0}
  .trow{display:flex;align-items:baseline;gap:8px}
  .title{flex:1;min-width:0;font-size:15px;font-weight:600;color:#fff;
    line-height:1.24;letter-spacing:-.01em}
  .age{flex:0 0 auto;font-size:12px;color:#98989d}
  .body{margin-top:2px;font-size:15px;line-height:1.28;color:#e6e6eb;letter-spacing:-.01em}
  .old .ios{opacity:.62;border:1px dashed #4a4a4c}
`;
const doc = inner => `<!doctype html><html><head><meta charset="utf-8">
<style>${CSS}</style></head><body><div class="sheetwrap">${inner}</div></body></html>`;

const PAGES = [
  ['reminder-g1t-1-spec-390.png', doc(`
    <div class="head">
      <h1>G1-tight, commas throughout</h1>
      <p>Not options any more. This is every alert the app would send,
        so it can be signed off before the sender is touched. Title is
        <code>Lee, Thursday Night Football</code>, body is your
        sentence.</p>
      <p><b>Five bunches</b>, each on its own schedule. A bunch of one
        game says <code>No team selected yet</code>. The two Sunday
        bunches count what is left of <b>that bunch</b>, and the number
        moves as you pick.</p>
      <p><b>Four tiers</b>, which the sender already has: two days out,
        under a day, a few hours, then the last call. The line
        <code>Unselected games score 0.</code> starts at the few hours
        mark, because two days out it is a warning about nothing.</p>
    </div>
    <div class="grp"><div class="glab">The alert you got, and its replacement</div>
      <div class="gsub">same moment, same facts</div>
      <div class="opt old"><div class="oname">what came through on your phone</div>
        ${card('1 pick due Fri 9:15 AM',
               'Less than a day. 16 Week 2 games still need a pick.', '1m ago')}</div>
      <div class="opt"><div class="oname">what it would say instead</div>
        ${card(...G1T({ who: 'Lee', ...B.tnf, tier: 'day', h: 20, mins: 1200, left: 1 }), '1m ago')}</div>
    </div>`
    + ['tnf', 'sun1', 'sun2', 'snf', 'mnf'].map(k => bunchBlock(k)).join(''))],

  ['reminder-g1t-2-edges-390.png', doc(`
    <div class="head">
      <h1>The sentences that can come out wrong</h1>
      <p>Singular and plural have to follow the count that is
        <b>left</b>, not the size of the bunch, so
        <code>1 of 9 still needs a pick</code> and
        <code>6 of 9 still need a pick</code> are both real. Same for
        one hour against three hours.</p>
      <p>Then every name in the pool against the longest event name in
        the league, measured for whether the title reaches the third
        line, which is where iOS cuts it off.</p>
    </div>
    <div class="grp"><div class="glab">Edge cases</div>
      <div class="gsub">each one a sentence that will really be sent</div>
      ${EDGES.map(([lab, f]) => row(lab, f)).join('')}
    </div>
    <div class="grp"><div class="glab">Every name, on the longest event name</div>
      <div class="gsub">iOS cuts a title after <b>2 lines</b></div>
      ${NAMES.map(who => row(`${who}, ${who.length} characters`,
        { who, ...B.tnf, tier: 'final', h: 1, mins: 22, left: 1 })).join('')}
    </div>
    <div class="grp"><div class="glab">When nothing is sent at all</div>
      <div class="opt"><div class="onote">
        A bunch you have finished is never mentioned again, so a week
        picked on Wednesday produces no alerts whatsoever. The counts
        only ever describe games you have not picked, which is why the
        number can go down but never up.
      </div></div>
    </div>`)],
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
  await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + name, fullPage: true });
  const got = await page.evaluate(() => {
    const tl = el => Math.round(el.getBoundingClientRect().height / (15 * 1.24));
    const bl = el => Math.round(el.getBoundingClientRect().height / (15 * 1.28));
    return [...document.querySelectorAll('.opt')].filter(o => o.querySelector('.title'))
      .map(o => ({ lab: o.dataset.lab || (o.querySelector('.oname') || {}).textContent.trim(),
                   t: tl(o.querySelector('.title')), b: bl(o.querySelector('.body')),
                   title: o.querySelector('.title').textContent,
                   body: o.querySelector('.body').textContent }));
  });
  const h = await page.evaluate(() => document.body.scrollHeight);
  const kb = Math.round(fs.statSync(OUT + name).size / 1024);
  console.log(`wrote ${name} (${h}px, ${kb}KB)`);
  rows.push(...got);
}

/* MEASURED, and these are the two failures that would only show up on
   somebody's phone: a title on three lines is cut off with an ellipsis,
   and a body over two lines is hidden until the notification is pulled
   down. G1-tight exists to avoid the second one, so any body of three
   is a real finding, not a note. */
const badT = rows.filter(r => r.t > 2);
const badB = rows.filter(r => r.b > 2);
console.log(`\n${rows.length} alerts rendered`);
console.log(badT.length ? 'TITLE CUT OFF:\n  ' + badT.map(r => r.lab).join('\n  ')
                        : 'every title fits two lines');
console.log(badB.length ? 'BODY NEEDS EXPANDING:\n  ' + badB.map(r => r.lab).join('\n  ')
                        : 'every body fits two lines, so nothing is hidden');

/* No dash of any kind in anything that gets sent. A hyphen inside a
   name is somebody's actual name and is left alone. */
const dashes = rows.filter(r => /[—–]/.test(r.title + r.body));
console.log(dashes.length ? 'DASH FOUND:\n  ' + dashes.map(r => r.lab).join('\n  ')
                          : 'no em or en dash in any alert');
await ctx.close();
await b.close();
