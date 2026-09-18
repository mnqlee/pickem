/* MOCKUP SHEET 3 — the reminder, built from Lee's three answers.

   HIS ANSWERS, verbatim:

   1. Wording — "Thursday Night Football kicks off in 22 min, you have
      not selected a team yet. Remember, unselected teams score 0
      points."
   2. Slate names — "What I wrote right before this", i.e. the FULL
      names: Thursday Night Football, Sunday Night Football, Monday
      Night Football.
   3. Grouping — "Scheduled per bunch... some before Thursday Night
      Football, some before the first half of Sunday games, some before
      the afternoon Sunday games, one before Sunday night football and
      one before Monday Night Football. Each of the[m] for Sunday
      morning and Sunday afternoon should count how many games are left
      and selected for each grouping."

   THE ONE PROBLEM THOSE THREE ANSWERS CREATE TOGETHER, and what this
   sheet is really for. He wants the account name on every alert AND the
   full slate names. Measured on the last sheet: name + "Thursday night
   football" as one title already truncates past about eleven characters,
   and "Thursday Night Football" is longer still. So the two answers
   cannot both live in the title.

   They can both live in the NOTIFICATION, though, because a
   notification has two fields. Put the name and the event in the title,
   where they are short and never wrap, and put his sentence in the
   body, which gets more room. That is G1, and it is the only shape here
   that satisfies all three answers at once. G2 and G3 are the two
   obvious alternatives, shown with their measured costs so the choice
   is visible rather than argued.

   A SECOND MEASURED THING: his sentence in full is 88 characters, which
   is three body lines on a 390px phone. iOS shows two body lines in a
   stacked notification and the rest only when it is expanded or pulled
   down. So G1-tight is here as well — the same sentence with the
   redundancy taken out, at two lines, nothing hidden.

   Not the app's typeface, on purpose — see mock-reminder-copy.mjs.

   Run: node mock-reminder-slate2.mjs
   Out: docs/mockups/reminder-final-1-shapes-390.png
        docs/mockups/reminder-final-2-week-390.png
        docs/mockups/reminder-final-3-names-390.png
*/
import { chromium } from 'playwright';
import fs from 'node:fs';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const games = k => `${k} ${k === 1 ? 'game' : 'games'}`;

/* THE FIVE GROUPINGS, exactly as he listed them. `one` marks a slate
   that is a single game — those get "you have not selected a team yet"
   rather than a count, because a count of one is a worse sentence. */
const SLATES = {
  tnf: { name: 'Thursday Night Football', one: true,  n: 1 },
  sun1:{ name: 'Sunday morning games',    one: false, n: 9 },
  sun2:{ name: 'Sunday afternoon games',  one: false, n: 4 },
  snf: { name: 'Sunday Night Football',   one: true,  n: 1 },
  mnf: { name: 'Monday Night Football',   one: true,  n: 1 },
};

/* HOW LONG UNTIL KICKOFF, worded per tier. He wrote "kicks off in 22
   min" for the last call; the same shape scales up, with the local
   clock added on the two far tiers where a bare countdown is vague. */
const kick = f => {
  if (f.tier === 'final') return `Kicks off in ${f.mins} min`;
  if (f.tier === 'hours') return `Kicks off in ${f.h} hour${f.h > 1 ? 's' : ''}`;
  if (f.tier === 'day')   return `Kicks off in ${f.h} hours, ${f.w}`;
  return `Kicks off ${f.w}`;
};
const first = f => f.one ? kick(f) : kick(f).replace('Kicks off', 'First kickoff');

/* ---------------------------------------------------------------- */
/* G1 — name and event in the title, his sentence in the body.
   Satisfies all three answers: full slate name, name always on, his
   wording. */
/* THE TITLE SEPARATOR. A middot, not a dash, and not a comma: it joins
   two labels rather than two clauses, which is the one job punctuation
   in a notification title has. The comma version is rendered beside it
   on sheet 1 so the choice is on screen rather than in a sentence. */
const SEP = ' · ';
const G1 = f => [
  `${f.who}${SEP}${f.slate}`,
  f.one
    ? `${kick(f)}. You have not selected a team yet. Remember, unselected teams score 0 points.`
    : `${first(f)}. ${games(f.left)} of ${f.total} still need a pick, ${
        f.total - f.left} selected. Remember, unselected teams score 0 points.`,
];

/* G1-tight — the same, with the sentence cut to two body lines so
   nothing is hidden behind "show more". "Remember" and "you have not
   selected a team yet" are saying one thing twice. */
const G1t = f => {
  /* THE WARNING EARNS ITS SPACE ONLY WHEN IT IS NEARLY TRUE. Two days
     out, "unselected games score 0" is a fact about a hypothetical; it
     also pushed this body onto a third line, which is the one thing
     G1-tight exists to avoid. It appears from the hours tier down. */
  const warn = (f.tier === 'hours' || f.tier === 'final');
  const zero = warn ? '. Unselected games score 0.' : '';
  return [
    `${f.who}${SEP}${f.slate}`,
    f.one
      ? `${kick(f)}. No team selected yet${zero}${zero ? '' : '.'}`
      : `${first(f)}. ${f.left} of ${f.total} still need a pick${zero}${zero ? '' : '.'}`,
  ];
};

/* G2 — the countdown moves up into the title. Reads well, and it is the
   version that pays for it in truncation: measured on sheet 3. */
/* G1-tight with a comma in place of the middot, for the comparison. */
const G1tc = f => { const [t, b] = G1t(f); return [t.replace(SEP, ', '), b]; };

const G2 = f => [
  `${f.who}${SEP}${f.slate} in ${f.tier === 'final' ? f.mins + ' min' : f.h + 'h'}`,
  f.one
    ? `You have not selected a team yet. Remember, unselected teams score 0 points.`
    : `${games(f.left)} of ${f.total} still need a pick, ${
        f.total - f.left} selected. Unselected teams score 0 points.`,
];

/* G3 — his sentence AS the title, verbatim, with the name moved into
   the body. Truest to what he wrote; also the one iOS is most likely to
   cut off, since the title is the field with two lines. */
const G3 = f => [
  f.one
    ? `${f.slate} kicks off in ${f.tier === 'final' ? f.mins + ' min' : f.h + ' hours'}`
    : `${games(f.left)} still need a pick for ${f.slate}`,
  f.one
    ? `${f.who}, you have not selected a team yet. Remember, unselected teams score 0 points.`
    : `${f.who}, ${f.total - f.left} of ${f.total} selected. First kickoff ${f.w}.`,
];

const card = (title, body, age = 'now') => `
<div class="ios">
  <div class="icon"><span>P</span></div>
  <div class="txt">
    <div class="trow"><div class="title">${esc(title)}</div>
      <div class="age">${age}</div></div>
    <div class="body">${esc(body)}</div>
  </div>
</div>`;

const SHAPES = [
  ['G1', 'name and event in the title, your sentence in the body', G1],
  ['G1-tight', 'the same, trimmed so the body never needs expanding', G1t],
  ['G1-tight, comma', 'the same again, comma instead of the middot', G1tc],
  ['G2', 'the countdown moves into the title', G2],
  ['G3', 'your sentence as the title, name in the body', G3],
];

/* ---------------------------------------------------------------- */
/* SCENARIO 1 is his exact example: Thursday Night Football, 22 minutes,
   nothing picked. SCENARIO 2 is the Sunday morning bunch, which is the
   case that needs the counts he asked for. */
const EX = {
  tnf22: { who: 'Lee', slate: SLATES.tnf.name, one: true, tier: 'final',
           mins: 22, h: 1, w: 'Fri 9:15 AM', left: 1, total: 1 },
  sunAM: { who: 'Lee', slate: SLATES.sun1.name, one: false, tier: 'hours',
           mins: 180, h: 3, w: 'Sun 2:00 AM', left: 6, total: 9 },
};

const shapeBlock = (label, sub, f) => `<div class="grp">
  <div class="glab">${esc(label)}</div>
  <div class="gsub">${sub}</div>
  ${SHAPES.map(([k, note, fn]) => {
    const [t, b] = fn(f);
    return `<div class="opt shape" data-shape="${k}">
      <div class="oname">${k}: ${note}</div>${card(t, b)}</div>`;
  }).join('')}
</div>`;

/* ---------------------------------------------------------------- */
/* A WHOLE WEEK OF ALERTS IN G1-TIGHT, in the order they would arrive,
   with his own picking behaviour in it: nothing done until Saturday,
   then the Sunday morning bunch half-picked, then the nightcaps left.
   This is the section that shows the GROUPING he asked for — five
   bunches, each on its own schedule, each counting its own games. */
const WEEK = [
  { when: 'Wed 9am', tier: 'day', label: 'two days before the opener',
    f: { who: 'Lee', slate: SLATES.tnf.name, one: true, tier: 'day',
         h: 24, mins: 1440, w: 'Fri 9:15 AM', left: 1, total: 1 } },
  { when: 'Fri 6am', tier: 'final', label: 'last call, Thursday night',
    f: { who: 'Lee', slate: SLATES.tnf.name, one: true, tier: 'final',
         h: 1, mins: 22, w: 'Fri 9:15 AM', left: 1, total: 1 } },
  { when: 'Sat 8am', tier: 'day', label: 'the Sunday morning bunch, a day out',
    f: { who: 'Lee', slate: SLATES.sun1.name, one: false, tier: 'day',
         h: 18, mins: 1080, w: 'Sun 2:00 AM', left: 9, total: 9 } },
  { when: 'Sun 12am', tier: 'hours', label: 'same bunch, three hours out, three picked',
    f: { who: 'Lee', slate: SLATES.sun1.name, one: false, tier: 'hours',
         h: 3, mins: 180, w: 'Sun 2:00 AM', left: 6, total: 9 } },
  { when: 'Sun 3am', tier: 'hours', label: 'the Sunday afternoon bunch',
    f: { who: 'Lee', slate: SLATES.sun2.name, one: false, tier: 'hours',
         h: 2, mins: 120, w: 'Sun 5:00 AM', left: 4, total: 4 } },
  { when: 'Sun 8am', tier: 'final', label: 'last call, Sunday night',
    f: { who: 'Lee', slate: SLATES.snf.name, one: true, tier: 'final',
         h: 1, mins: 30, w: 'Sun 9:20 AM', left: 1, total: 1 } },
  { when: 'Tue 8am', tier: 'final', label: 'last call, Monday night, the last game of the week',
    f: { who: 'Lee', slate: SLATES.mnf.name, one: true, tier: 'final',
         h: 1, mins: 25, w: 'Tue 9:15 AM', left: 1, total: 1 } },
];

const weekBlock = () => `<div class="grp">
  <div class="glab">One week, in order, in G1-tight</div>
  <div class="gsub">five bunches &middot; each on its own schedule &middot;
    each counting its own games</div>
  ${WEEK.map(r => {
    const [t, b] = G1t(r.f);
    return `<div class="opt weekrow">
      <div class="oname">${esc(r.when)}, ${esc(r.label)}</div>
      ${card(t, b, r.when.split(' ')[0])}</div>`;
  }).join('')}
  <div class="opt"><div class="onote">
    Seven alerts across a week if you pick nothing until the last
    minute, and none at all if you do your week on Wednesday, because a
    bunch you have finished is never mentioned again. Today the same
    week would send ten, since the three Sunday kickoff times each get
    their own set.
  </div></div>
</div>`;

/* ---------------------------------------------------------------- */
/* THE NAME TEST, again, but on the shapes that matter now. G1 keeps the
   name in a short title, so the question is whether ANY name breaks it;
   G2 and G3 put more in the title and are where a long name bites. */
const NAMES = ['Bob', 'Lee', 'Monse', 'Eliana', 'Angelica', 'Christopher',
               'Bartholomew', 'Maria Fernanda', 'Jean-Baptiste III'];

const nameBlock = (key, fn, note) => `<div class="grp">
  <div class="glab">${key}: every name, on the longest slate name</div>
  <div class="gsub">${note} &middot; iOS cuts a title after <b>2 lines</b></div>
  ${NAMES.map(who => {
    const [t, b] = fn({ who, slate: SLATES.tnf.name, one: true, tier: 'final',
      mins: 22, h: 1, w: 'Fri 9:15 AM', left: 1, total: 1 });
    return `<div class="opt nt" data-shape="${key}" data-name="${esc(who)}">
      <div class="oname">${esc(who)}, ${who.length} characters</div>
      ${card(t, b)}</div>`;
  }).join('')}
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

const doc = inner => `<!doctype html><html><head><meta charset="utf-8">
<style>${CSS}</style></head><body><div class="sheetwrap">${inner}</div></body></html>`;

const PAGES = [
  ['reminder-final-1-shapes-390.png', doc(`
    <div class="head">
      <h1>Your three answers, with the dashes taken out</h1>
      <p>You want <b>your sentence</b>, the <b>full</b> event names, and
        the <b>account name on every alert</b>. All three fit, but only
        because your sentence moves out of the title. The shape on the
        last sheet crammed name, count and event into one line and got
        cut off past about eleven characters. A notification has
        <b>two</b> fields, and using both solves it.</p>
      <p><b>No dashes anywhere in the copy now.</b> Where one was
        joining two clauses it is a full stop:
        <code>No team selected yet. Unselected games score 0.</code>
        Where it was joining a countdown to a clock reading it is a
        comma: <code>Kicks off in 24 hours, Fri 9:15 AM.</code></p>
      <p><b>G1</b> puts your name and the event in the title, one line
        for every name tested, and your sentence in the body where there
        is room for it. G2 and G3 also fit, but G3 uses both title lines
        for every single name, so it has nothing left if a name or an
        event name grows. G1 has a whole line spare.</p>
      <p><b>G1-tight</b> is there because your sentence in full is 88
        characters, which is three body lines. iOS shows two in a
        stacked notification and hides the rest until you pull it down.
        The trim drops <code>Remember</code> and
        <code>you have not selected a team yet</code> saying the same
        thing twice, and fits in two.</p>
    </div>`
    + shapeBlock('Your exact example: Thursday Night Football, 22 minutes, nothing picked',
        'single game &middot; no count, because a count of one is a worse sentence', EX.tnf22)
    + shapeBlock('The Sunday morning bunch: three hours out, three of nine picked',
        'the case your counts are for &middot; left <b>6</b> &middot; selected <b>3</b>', EX.sunAM))],

  ['reminder-final-2-week-390.png', doc(`
    <div class="head">
      <h1>The five bunches, one week, in order</h1>
      <p>Your grouping: Thursday Night Football, the first half of
        Sunday, the Sunday afternoon games, Sunday Night Football,
        Monday Night Football. Each on its own schedule, and the two
        Sunday bunches counting what is left and what is selected in
        <b>that bunch</b>.</p>
      <p>This is the week as it would actually arrive if you picked
        nothing until Saturday.</p>
    </div>` + weekBlock())],

  /* TWO PAGES FOR THE NAME TEST, not one. All three shapes on one page
     came to 4,550px and 1.1MB, which the delivery step rejects. */
  ['reminder-final-3-names-G1-390.png', doc(`
    <div class="head">
      <h1>Long names: G1, the recommended shape</h1>
      <p>Every name rendered, every title measured. <b>All nine fit on
        one line</b> against the longest event name in the league, which
        leaves a whole title line spare for anything longer.</p>
    </div>` + nameBlock('G1', G1, 'name and event only'))],
  ['reminder-final-3-names-G2-G3-390.png', doc(`
    <div class="head">
      <h1>Long names: G2 and G3, for comparison</h1>
      <p>Both also fit, but they spend the room. <b>G3 uses both title
        lines for every single name</b>, so a longer name or a longer
        event name has nowhere to go. G2 sits in between.</p>
    </div>`
    + nameBlock('G2', G2, 'name, event and countdown')
    + nameBlock('G3', G3, 'your sentence as the title'))],
];

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const OUT = new URL('../../docs/mockups/', import.meta.url).pathname;

/* MEASURED, and it is the whole reason these are rendered rather than
   written out: title lines (iOS cuts after 2) and body lines (a stacked
   notification shows 2, the rest only when expanded). */
const measure = () => page.evaluate(() => {
  const tl = el => Math.round(el.getBoundingClientRect().height / (15 * 1.24));
  const bl = el => Math.round(el.getBoundingClientRect().height / (15 * 1.28));
  const rows = [];
  for (const o of document.querySelectorAll('.opt')) {
    const t = o.querySelector('.title'); if (!t) continue;
    rows.push({
      tag: ((o.querySelector('.oname') || {}).textContent || '?').trim(),
      shape: o.dataset.shape || '', name: o.dataset.name || '',
      t: tl(t), b: bl(o.querySelector('.body')),
    });
  }
  return rows;
});

const all = [];
for (const [name, html] of PAGES) {
  const f = '/tmp/claude-0/' + name.replace('.png', '.html');
  fs.writeFileSync(f, html);
  await page.goto('file://' + f, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + name, fullPage: true });
  const h = await page.evaluate(() => document.body.scrollHeight);
  const rows = await measure();
  all.push([name, h, rows]);
  console.log(`wrote ${name} (${h}px)`);
}

console.log('\n-- title/body lines, page 1 --');
for (const r of all[0][2])
  console.log(`  ${r.tag.slice(0, 44).padEnd(46)} title ${r.t}, body ${r.b}${
    r.t > 2 ? '  !! TITLE CUT' : ''}${r.b > 2 ? '  (body needs expanding)' : ''}`);

console.log('\n-- the week, G1-tight --');
for (const r of all[1][2])
  console.log(`  ${r.tag.slice(0, 44).padEnd(46)} title ${r.t}, body ${r.b}${
    r.t > 2 || r.b > 2 ? '  !!' : ''}`);

console.log('\n-- names --');
const nameRows = [...all[2][2], ...all[3][2]];
for (const shape of ['G1', 'G2', 'G3']) {
  const rows = nameRows.filter(r => r.shape === shape);
  const cut = rows.filter(r => r.t > 2);
  console.log(`  ${shape}: ${cut.length ? 'CUT OFF for ' + cut.map(r => r.name).join(', ')
    : 'every name fits two lines'}`);
}
await ctx.close();
await b.close();
