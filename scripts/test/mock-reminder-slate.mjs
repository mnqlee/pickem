/* MOCKUP SHEET 2 — the reminder, framed the way Lee actually described
   it, plus the account name on every alert and a name-length test.

   WHAT HE ASKED FOR, in his words: "a reminder for what's about to come
   up. 1 game still needs a pick before Thursday night football. Then on
   Saturday for Sunday, 14 games still need a pick for Sunday football."

   That is a THIRD framing, and it is better than any of A-D on the
   first sheet. A-D all argued about which number goes in the title —
   the deadline's or the week's. This one changes the unit: the alert is
   about a NAMED SLATE, and the count is that slate's own unpicked
   games. "1 before Thursday night" and "14 for Sunday" are both
   complete, neither contradicts the other, and nobody has to hold the
   week total in their head to read either one.

   THE ONE STRUCTURAL CONSEQUENCE, which is why the last section of the
   sheet exists. Reminders fire per KICKOFF TIME today, and Sunday has
   three of them (early, late, night). Slate-level copy means slate-level
   sending: one alert for "Sunday football" instead of three that each
   name a different clock time. That is fewer alerts and clearer ones,
   but it is a behaviour change, not just new words — so it is shown
   side by side at the bottom rather than buried.

   NAME LENGTHS ARE MEASURED, NOT ESTIMATED. Lee asked whether a long
   name still fits. iOS gives a notification title two lines before it
   truncates with an ellipsis, so the question is exactly: at what name
   length does the title reach a third line. The script measures every
   rendered title and reports it.

   Not the app's typeface, on purpose — see mock-reminder-copy.mjs.

   Run: node mock-reminder-slate.mjs
   Out: docs/mockups/reminder-slate-390.png
*/
import { chromium } from 'playwright';
import fs from 'node:fs';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const games = k => `${k} ${k === 1 ? 'game' : 'games'}`;
const needs = k => k === 1 ? 'still needs a pick' : 'still need a pick';

const card = (title, body, age = 'now') => `
<div class="ios">
  <div class="icon"><span>P</span></div>
  <div class="txt">
    <div class="trow"><div class="title">${esc(title)}</div>
      <div class="age">${age}</div></div>
    <div class="body">${esc(body)}</div>
  </div>
</div>`;

/* ---------------------------------------------------------------- */
/* THE SLATES. A name for each kickoff group, which is the whole point
   of this framing. Derived from the kickoff time in the player's own
   zone, so the app and the alert agree about what is about to lock. */
const SLATES = {
  tnf:     { name: 'Thursday night football',  short: 'Thursday night' },
  sunEarly:{ name: 'Sunday football',          short: 'Sunday' },
  sunLate: { name: "Sunday's late games",      short: 'Sunday late' },
  snf:     { name: 'Sunday night football',    short: 'Sunday night' },
  mnf:     { name: 'Monday night football',    short: 'Monday night' },
};

/* E1 — his wording, with the local lock time and the week total in the
   body. The two numbers can no longer fight: the title's number is
   bounded by a named event, so the body's is read as "and then there is
   the rest of the week". */
const E1 = f => [
  `${f.who} — ${games(f.n)} ${needs(f.n)} before ${f.slate}`,
  `Locks ${f.w}${f.day ? ' — under a day' : ''}. ${
    f.weekLeft > f.n ? `${games(f.weekLeft)} unpicked in Week ${f.wk}.`
                     : `That is the last of Week ${f.wk}.`}`,
];

/* E2 — the same title with the week left out entirely. Shorter, and it
   never makes anybody do arithmetic; the cost is that on a Thursday it
   does not hint that sixteen more are waiting. */
const E2 = f => [
  `${f.who} — ${games(f.n)} ${needs(f.n)} before ${f.slate}`,
  `Locks ${f.w}${f.day ? ' — under a day' : ''}. Unpicked games score zero.`,
];

/* E3 — "for", not "before", for a slate that is a block of games
   rather than a single kickoff. "14 games still need a pick for Sunday
   football" is his own phrasing and reads better than "before" when the
   slate IS the games being counted. */
const E3 = f => [
  `${f.who} — ${games(f.n)} ${needs(f.n)} for ${f.slate}`,
  `First lock ${f.w}${f.day ? ' — under a day' : ''}. ${
    f.weekLeft > f.n ? `${games(f.weekLeft)} unpicked in Week ${f.wk}.`
                     : `That is the last of Week ${f.wk}.`}`,
];

/* F1 — the progress framing he also floated: "11 of 14 selected". */
const F1 = f => [
  `${f.who} — ${f.n === f.slateTotal ? '0' : f.slateTotal - f.n} of ${
    f.slateTotal} picked for ${f.slate}`,
  `${games(f.n)} ${needs(f.n)}. Locks ${f.w}.`,
];

/* F2 — progress at the WEEK level, his "2/16 games selected" shape. */
const F2 = f => [
  `${f.who} — ${f.weekTotal - f.weekLeft} of ${f.weekTotal} picked in Week ${f.wk}`,
  `${games(f.weekLeft)} ${needs(f.weekLeft)}. Next lock ${f.w}.`,
];

const LAST = f => [
  `${f.who} — last call, ${f.slate}`,
  `Kickoff in ${f.mins} minutes. ${games(f.n)} unpicked ${
    f.n === 1 ? 'scores' : 'score'} zero.`,
];

/* ---------------------------------------------------------------- */
/* SCENARIOS. Every one is a real moment in Lee's week 2, in his own
   timezone — which is why the clock readings look odd for football:
   GMT+9 puts Thursday night on Friday morning. */
const SC = [
  { key: 'thu', label: 'Thursday opener, nothing picked — the alert you got',
    f: { who: 'Lee', n: 1, slate: SLATES.tnf.name, slateTotal: 1,
         w: 'Fri 9:15 AM', day: true, wk: 2, weekLeft: 16, weekTotal: 16 } },
  { key: 'sat', label: 'Saturday, looking at Sunday — his own example',
    f: { who: 'Lee', n: 14, slate: SLATES.sunEarly.name, slateTotal: 14,
         w: 'Sun 2:00 AM', day: true, wk: 2, weekLeft: 15, weekTotal: 16 } },
  { key: 'sat2', label: 'Same Saturday, but three already picked',
    f: { who: 'Lee', n: 11, slate: SLATES.sunEarly.name, slateTotal: 14,
         w: 'Sun 2:00 AM', day: true, wk: 2, weekLeft: 12, weekTotal: 16 } },
  { key: 'mnf', label: 'Monday night, the last game of the week',
    f: { who: 'Lee', n: 1, slate: SLATES.mnf.name, slateTotal: 1,
         w: 'Tue 9:15 AM', day: true, wk: 2, weekLeft: 1, weekTotal: 16 } },
];

const OPTS = [
  ['E1', 'his wording + the lock time + the week', E1],
  ['E2', 'his wording, week left out', E2],
  ['E3', '"for" instead of "before" on a block of games', E3],
  ['F1', 'progress, slate level — "3 of 14 picked"', F1],
  ['F2', 'progress, week level — "2 of 16 picked"', F2],
];

const block = sc => `<div class="grp">
  <div class="glab">${esc(sc.label)}</div>
  <div class="gsub">slate: <b>${esc(sc.f.slate)}</b> &middot; unpicked in it: <b>${
    sc.f.n}</b> of <b>${sc.f.slateTotal}</b> &middot; week owes: <b>${sc.f.weekLeft}</b></div>
  ${OPTS.map(([k, note, fn]) => {
    const [t, b] = fn(sc.f);
    return `<div class="opt"><div class="oname">${k} — ${note}</div>${card(t, b)}</div>`;
  }).join('')}
  ${sc.key === 'mnf' ? `<div class="opt">
    <div class="oname">last call — every option shares this one</div>
    ${card(...LAST({ ...sc.f, mins: 22 }))}</div>` : ''}
</div>`;

/* ---------------------------------------------------------------- */
/* THE NAME TEST. Same alert, names from 3 to 16 characters, so the
   answer to "do longer names still fit" is a measured line count rather
   than an opinion. The worst case for the title is the Thursday
   singular, because "Thursday night football" is the longest slate name
   in the league. */
const NAMES = ['Bob', 'Lee', 'Monse', 'Eliana', 'Angelica', 'Christopher',
               'Bartholomew', 'Maria Fernanda', 'Jean-Baptiste III'];
/* TWO RUNS OF THE SAME TEST, because the fix for a long name is not a
   shorter name — it is a shorter SLATE name. "Thursday night football"
   is 23 characters of title spent on a phrase whose last word carries
   no information: nothing else locks on a Thursday night. Dropping it
   buys back more room than any plausible name needs. */
const nameRow = (who, slate, cls) => {
  const [t, b] = E1({ who, n: 1, slate, slateTotal: 1,
    w: 'Fri 9:15 AM', day: true, wk: 2, weekLeft: 16, weekTotal: 16 });
  return `<div class="opt ${cls}" data-name="${esc(who)}">
    <div class="oname">${esc(who)} — ${who.length} characters</div>
    ${card(t, b)}</div>`;
};
const nameBlock = () => `<div class="grp">
  <div class="glab">Does a long name still fit? &mdash; full slate name</div>
  <div class="gsub">&ldquo;Thursday night football&rdquo; &middot;
    iOS truncates a title after <b>2 lines</b></div>
  ${NAMES.map(w => nameRow(w, SLATES.tnf.name, 'nametest')).join('')}
</div>
<div class="grp">
  <div class="glab">The same names, with the slate name shortened</div>
  <div class="gsub">&ldquo;Thursday night&rdquo; &mdash; nothing else locks
    on a Thursday night, so the last word is free to go</div>
  ${NAMES.map(w => nameRow(w, SLATES.tnf.short, 'nametest2')).join('')}
</div>`;

/* THE SENDING CHANGE, shown rather than described. */
const groupBlock = () => `<div class="grp">
  <div class="glab">The part that is not just wording</div>
  <div class="gsub">Sunday has three kickoff times &middot; today that is three alerts</div>
  <div class="opt"><div class="oname">today — one alert per kickoff time</div>
    ${card('10 picks due Sun 2:00 AM', 'Less than a day. 14 Week 2 games still need a pick.', 'Sat')}
    ${card('3 picks due Sun 5:00 AM', 'Less than a day. 14 Week 2 games still need a pick.', 'Sat')}
    ${card('1 pick due Sun 9:20 AM', 'Less than a day. 14 Week 2 games still need a pick.', 'Sat')}
  </div>
  <div class="opt"><div class="oname">slate framing — one alert for Sunday</div>
    ${card('Lee — 14 games still need a pick for Sunday football',
           'First lock Sun 2:00 AM — under a day. 15 games unpicked in Week 2.', 'Sat')}
  </div>
  <div class="opt"><div class="onote">
    Three alerts become one, and the one that is left is the one that
    answers the question. The trade: the late-afternoon and Sunday-night
    games no longer get their own nudge, so somebody who picks the 1pm
    block on Saturday and then forgets the nightcap would have heard
    about it twice before and now hears about it once — until the
    hours-out and last-call alerts, which still fire per kickoff because
    at that range the specific game IS the point.
  </div></div>
</div>`;

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
  .grp{margin-top:18px;border-top:1px solid #2a2a2c;padding-top:14px}
  .glab{padding:0 16px;font-size:12px;font-weight:700;color:#fff}
  .gsub{padding:3px 16px 4px;font-size:11px;color:#8a8a8e;
    font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  .gsub b{color:#c8c8cc}
  .opt{padding:11px 10px 2px}
  .oname{padding:0 6px 6px;font-size:11px;font-weight:700;color:#e8b84b;letter-spacing:.02em}
  .onote{padding:0 6px 7px;font-size:10.5px;line-height:1.5;color:#8a8a8e}
  .ios{display:flex;gap:11px;align-items:flex-start;background:#2c2c2eE6;
    border-radius:18px;padding:11px 13px 12px;margin:0 6px 7px}
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
`;

/* THREE PAGES, NOT ONE. The single sheet came out 13,984px tall and
   almost 2MB, which the delivery step rejects outright — and a 14,000px
   image is unreadable on a phone anyway. One page per question. */
const page1Head = `<div class="head">
  <h1>Your framing, rendered — plus the name on every alert</h1>
  <p>This is the third idea and it is better than the four I sent. A to
    D all argued about <b>which number goes in the title</b>, the
    deadline's or the week's. Yours changes the unit: the alert is about
    a <b>named slate</b>, and the count is that slate's own unpicked
    games. <code>1 before Thursday night</code> and
    <code>14 for Sunday</code> are each complete on their own, and
    neither can contradict the other.</p>
  <p><b>My answer on the fraction.</b> I would not lead with
    <code>2 of 16 picked</code>. A notification has one job — say what
    needs doing — and a fraction makes you subtract before you know
    whether to care; it also reads as a scoreboard on a screen where
    every other number is a score. F1 and F2 are below so you can see
    them rather than take my word for it, and F1's "3 of 14 picked for
    Sunday" is the better of the two if you want progress.</p>
  <p><b>On the name:</b> always on, as you asked. The length test at
    the bottom is measured, and it found a limit and a fix. With the
    full <code>Thursday night football</code>, names past about eleven
    characters push the title onto a third line and iOS cuts it off.
    Shortening the slate to <code>Thursday night</code> — nothing else
    locks on a Thursday night, so the last word carries no information —
    fits every name on the list. Both runs are below.</p>
</div>`;

const doc = inner => `<!doctype html><html><head><meta charset="utf-8"><style>
${CSS}</style></head><body><div class="sheetwrap">${inner}</div></body></html>`;

/* Page 1: the wording, on the two moments that matter most.
   Page 2: the other two moments, and the last call.
   Page 3: the name-length test and the sending change. */
const PAGES = [
  ['reminder-slate-1-wording-390.png',
   doc(page1Head + SC.slice(0, 2).map(block).join(''))],
  ['reminder-slate-2-rest-390.png',
   doc(`<div class="head"><h1>The same five, later in the week</h1>
     <p>Three of Sunday already picked, then Monday night as the last
     game of the week &mdash; where &ldquo;that is the last of Week
     2&rdquo; replaces the remainder, and the last call is the one line
     every option shares.</p></div>` + SC.slice(2).map(block).join(''))],
  ['reminder-slate-3-names-390.png',
   doc(`<div class="head"><h1>Long names, and the one sending change</h1>
     <p>Measured: with the full <code>Thursday night football</code>,
     a name past about eleven characters pushes the title onto a third
     line and iOS cuts it off. Shortening the slate to
     <code>Thursday night</code> fits every name tried. Both runs
     below, then what slate-level alerts do to Sunday.</p></div>`
     + nameBlock() + groupBlock())],
];

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const OUT = new URL('../../docs/mockups/', import.meta.url).pathname;
for (const [name, html] of PAGES) {
  const f = '/tmp/claude-0/' + name.replace('.png', '.html');
  fs.writeFileSync(f, html);
  await page.goto('file://' + f, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + name, fullPage: true });
  const h = await page.evaluate(() => document.body.scrollHeight);
  console.log('wrote', name, '(' + h + 'px tall)');
}
/* The measurements come off page 3, which is the one holding the test. */
await page.goto('file:///tmp/claude-0/reminder-slate-3-names-390.html', { waitUntil: 'load' });
await page.waitForTimeout(300);

/* MEASURED: where does a name push the title onto a third line. This is
   the actual question Lee asked, and it has a number for an answer. */
const lines = await page.evaluate(() => {
  const n = el => Math.round(el.getBoundingClientRect().height / (15 * 1.24));
  const out = { names: [], short: [], long: [] };
  for (const o of document.querySelectorAll('.nametest'))
    out.names.push([o.dataset.name, n(o.querySelector('.title'))]);
  for (const o of document.querySelectorAll('.nametest2'))
    out.short.push([o.dataset.name, n(o.querySelector('.title'))]);
  for (const o of document.querySelectorAll('.opt')) {
    const t = o.querySelector('.title'); if (!t) continue;
    if (n(t) > 2) out.long.push(((o.querySelector('.oname') || {}).textContent || '?').trim());
  }
  return out;
});
const report = (lab, rows) => {
  console.log(lab);
  for (const [nm, l] of rows)
    console.log(`  ${nm.padEnd(18)} ${nm.length.toString().padStart(2)} chars -> ${l} line${l > 1 ? 's' : ''}${l > 2 ? '  !! TRUNCATED' : ''}`);
};
report('"Thursday night football":', lines.names);
report('"Thursday night":', lines.short);
const cut = lines.short.filter(([, l]) => l > 2);
console.log(cut.length
  ? '!! still truncating with the short slate name: ' + cut.map(([n]) => n).join(', ')
  : 'with the short slate name, every name on the list fits two lines');
await ctx.close();
await b.close();
