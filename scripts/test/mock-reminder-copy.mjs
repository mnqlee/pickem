/* MOCKUP SHEET — the reminder copy, after Lee got one that read wrong.

   WHAT HE GOT, on a phone in GMT+9 with nothing picked in Week 2:

     title  1 pick due Fri 9:15 AM
     body   Less than a day. 16 Week 2 games still need a pick.

   Both numbers are true. compose()'s `n` is the picks due AT THAT
   DEADLINE — the Thursday game is one game — and `weekLeft` is what the
   week still owes. The title is the line a phone shows first and reads
   loudest, so "1 pick" lands as "you have one pick to make" and the 16
   arrives afterwards as a contradiction. This is the SAME misreading the
   last rewrite was done to end, just from the other direction: that one
   had a week-level title over a slot-level body, this one has a
   slot-level title over a week-level body.

   AND THERE IS A SECOND PROBLEM IN THAT TITLE, which is not about
   numbers. "Fri 9:15 AM" is correct for GMT+9 — Thursday Night Football
   kicks off Friday morning in Japan, and the app's own Picks tab labels
   that card FRIDAY for the same reason. So naming the slot "Thursday
   night" in a notification would disagree with the app's own screen.
   Any option below that uses the NFL's name for the slot has to carry
   the local clock too, or the two surfaces contradict each other.

   THIS SHEET IS NOT A CODE CHANGE. Nothing in worker/live.js or
   index.html is touched by running it. It renders each candidate as a
   phone notification so the wording can be judged the way it will
   actually be read.

   NOT THE APP'S TYPEFACE, on purpose. Every other sheet in
   docs/mockups/ uses Archivo because it is drawing the app. A
   notification is drawn by iOS in its own font at its own sizes, so
   this one uses the system stack — rendering these in Archivo would
   flatter line lengths that the phone will not give them.

   Run: node mock-reminder-copy.mjs
   Out: docs/mockups/reminder-copy-390.png
*/
import { chromium } from 'playwright';
import fs from 'node:fs';

/* ---------------------------------------------------------------- */
/* THE CANDIDATES. Each is a function of the same four facts compose()
   already has, so anything here is buildable with no new data:
     wk        the week number
     n         picks due at THIS deadline
     weekLeft  picks the week still owes
     w         the deadline in the player's own timezone
     slot      a name for the slot, where one exists
     mins      minutes to kickoff (final tier only)                  */

const picks = k => `${k} ${k === 1 ? 'pick' : 'picks'}`;
const games = k => `${k} ${k === 1 ? 'game' : 'games'}`;

const OPTIONS = {
  /* What ships today, for comparison. */
  today: {
    name: 'What you got now',
    note: 'Slot count in the title, week total in the body.',
    open:  f => [`${picks(f.n)} due ${f.w}`,
                 `${f.weekLeft} Week ${f.wk} games still need a pick.`],
    day:   f => [`${picks(f.n)} due ${f.w}`,
                 `Less than a day. ${f.weekLeft} Week ${f.wk} games still need a pick.`],
    hours: f => [`${picks(f.n)} due in ${f.h} hour${f.h > 1 ? 's' : ''}`,
                 `Unpicked games score zero. ${f.weekLeft} Week ${f.wk} games still need a pick.`],
    final: f => [`Last call — ${picks(f.n)}`,
                 `Kickoff in ${f.mins} minutes. Unpicked games score zero.`],
  },

  /* A — THE WEEK IS THE HEADLINE. Lee's first suggestion: "16 games
     left to pick". The big number leads, the deadline follows as the
     reason it is being said now. */
  A: {
    name: 'A — the week total leads',
    note: 'The headline is the whole job. The deadline is why you are hearing about it now.',
    open:  f => [`${games(f.weekLeft)} left in Week ${f.wk}`,
                 `First lock ${f.w}.`],
    day:   f => [`${games(f.weekLeft)} left in Week ${f.wk}`,
                 `${games(f.n)} lock ${f.w} — under a day.`],
    hours: f => [`${games(f.weekLeft)} left in Week ${f.wk}`,
                 `${games(f.n)} lock in ${f.h} hour${f.h > 1 ? 's' : ''}. Unpicked games score zero.`],
    final: f => [`Last call — ${games(f.n)} in ${f.mins} min`,
                 `${games(f.weekLeft)} left in Week ${f.wk}. Unpicked games score zero.`],
  },

  /* B — THE SLOT IS NAMED, THE WEEK IS THE BODY. Lee's second
     suggestion: "1 game to pick before Thursday night football". The
     local clock rides along because his own screen says Friday. */
  B: {
    name: 'B — name the slot, then the week',
    note: 'Says what is about to lock in football language, with the local time so it agrees with the Picks tab.',
    open:  f => [`${games(f.n)} to pick before ${f.slot}`,
                 `Locks ${f.w}. ${games(f.weekLeft)} left in Week ${f.wk}.`],
    day:   f => [`${games(f.n)} to pick before ${f.slot}`,
                 `Locks ${f.w} — under a day. ${games(f.weekLeft)} left in Week ${f.wk}.`],
    hours: f => [`${games(f.n)} to pick before ${f.slot}`,
                 `${f.h} hour${f.h > 1 ? 's' : ''}. ${games(f.weekLeft)} left in Week ${f.wk}.`],
    final: f => [`Last call — ${f.slot} in ${f.mins} min`,
                 `${games(f.n)} unpicked. Unpicked games score zero.`],
  },

  /* C — BOTH NUMBERS IN THE TITLE. "1 of 16" removes the contradiction
     by putting the two facts in one breath, at the cost of a longer
     title on a narrow phone. */
  C: {
    name: 'C — both numbers, one breath',
    note: 'The "1 of 16" shape. No contradiction possible, but the longest title of the four.',
    open:  f => [`${f.n} of ${f.weekLeft} picks due ${f.w}`,
                 `Week ${f.wk}. The rest lock later.`],
    day:   f => [`${f.n} of ${f.weekLeft} picks due ${f.w}`,
                 `Less than a day. The other ${f.weekLeft - f.n} lock later in Week ${f.wk}.`],
    hours: f => [`${f.n} of ${f.weekLeft} picks due in ${f.h}h`,
                 `Unpicked games score zero. ${f.weekLeft - f.n} more lock later.`],
    final: f => [`Last call — ${f.n} of ${f.weekLeft}`,
                 `Kickoff in ${f.mins} minutes. Unpicked games score zero.`],
  },

  /* D — NO SLOT COUNT AT ALL. The simplest thing that cannot mislead:
     the week owes 16, here is the next deadline. `n` stops being in the
     message, which also means three Sunday slots read as three
     reminders of the same one job. */
  D: {
    name: 'D — drop the slot count',
    note: 'Never mentions the per-deadline number. Cannot contradict itself; loses the "only one is urgent" nuance.',
    open:  f => [`Week ${f.wk}: ${games(f.weekLeft)} to pick`,
                 `First lock ${f.w}.`],
    day:   f => [`Week ${f.wk}: ${games(f.weekLeft)} to pick`,
                 `Next lock ${f.w} — under a day.`],
    hours: f => [`Week ${f.wk}: ${games(f.weekLeft)} to pick`,
                 `Next lock in ${f.h} hour${f.h > 1 ? 's' : ''}. Unpicked games score zero.`],
    final: f => [`Last call — Week ${f.wk}`,
                 `Kickoff in ${f.mins} minutes. ${games(f.weekLeft)} unpicked score zero.`],
  },
};

/* ---------------------------------------------------------------- */
/* THE SCENARIOS. LEE is the exact alert he received. The other three
   are the cases a copy change has to survive, because a title that
   reads well on a one-game Thursday can fall apart on a ten-game
   Sunday or when the week is nearly done. */
const S = {
  lee:    { label: 'Thursday opener, nothing picked — the one you got',
            wk: 2, n: 1,  weekLeft: 16, w: 'Fri 9:15 AM',
            slot: 'Thursday night football', tier: 'day', h: 23, mins: 1380 },
  sunday: { label: 'Sunday 1pm block, ten games locking, fourteen owed',
            wk: 2, n: 10, weekLeft: 14, w: 'Sun 2:00 AM',
            slot: "Sunday's early games", tier: 'day', h: 20, mins: 1200 },
  late:   { label: 'Two hours out, three locking, four owed',
            wk: 2, n: 3,  weekLeft: 4,  w: 'Sun 5:00 AM',
            slot: "Sunday's late games", tier: 'hours', h: 2, mins: 120 },
  mnf:    { label: 'Last call, Monday night, one game and it is the last',
            wk: 2, n: 1,  weekLeft: 1,  w: 'Tue 9:15 AM',
            slot: 'Monday night football', tier: 'final', h: 1, mins: 22 },
};

/* ---------------------------------------------------------------- */
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

/* An iOS notification, close enough to judge line breaks by: 38px
   rounded icon, 15px semibold title, 15px body, the age at the right. */
const card = (title, body, age = '1m ago') => `
<div class="ios">
  <div class="icon"><span>P</span></div>
  <div class="txt">
    <div class="trow"><div class="title">${esc(title)}</div>
      <div class="age">${age}</div></div>
    <div class="body">${esc(body)}</div>
  </div>
</div>`;

const render = (optKey, scKey) => {
  const o = OPTIONS[optKey], f = S[scKey];
  const [t, b] = o[f.tier](f);
  return card(t, b);
};

const block = (scKey, keys) => {
  const f = S[scKey];
  return `<div class="grp">
    <div class="glab">${esc(f.label)}</div>
    <div class="gsub">tier: <b>${f.tier}</b> &middot; this deadline: <b>${
      f.n}</b> &middot; week owes: <b>${f.weekLeft}</b></div>
    ${keys.map(k => `<div class="opt">
        <div class="oname">${OPTIONS[k].name}</div>
        ${OPTIONS[k].note ? `<div class="onote">${OPTIONS[k].note}</div>` : ''}
        ${render(k, scKey)}</div>`).join('')}
  </div>`;
};

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{margin:0;background:#141414;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;
    -webkit-font-smoothing:antialiased}
  .sheetwrap{padding:0 0 30px}
  .head{padding:22px 16px 8px}
  .head h1{margin:0;font-size:17px;font-weight:700;color:#fff;letter-spacing:-.01em}
  .head p{margin:7px 0 0;font-size:12.5px;line-height:1.5;color:#9a9a9e}
  .head code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;
    background:#242426;padding:1px 4px;border-radius:4px;color:#d0d0d4}
  .grp{margin-top:18px;border-top:1px solid #2a2a2c;padding-top:14px}
  .glab{padding:0 16px;font-size:12px;font-weight:700;color:#fff}
  .gsub{padding:3px 16px 4px;font-size:11px;color:#8a8a8e;
    font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  .gsub b{color:#c8c8cc}
  .opt{padding:11px 10px 2px}
  .oname{padding:0 6px 2px;font-size:11px;font-weight:700;color:#e8b84b;
    letter-spacing:.02em}
  .onote{padding:0 6px 7px;font-size:10.5px;line-height:1.45;color:#8a8a8e}

  /* The notification itself. */
  .ios{display:flex;gap:11px;align-items:flex-start;background:#2c2c2eE6;
    border-radius:18px;padding:11px 13px 12px;margin:0 6px;
    box-shadow:0 1px 0 rgba(255,255,255,.05) inset}
  .icon{width:38px;height:38px;flex:0 0 38px;border-radius:9px;background:#1b1b1d;
    display:grid;place-items:center;border:1px solid #3a3a3c}
  .icon span{font-size:15px;font-weight:800;color:#d8483c;
    font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  .txt{flex:1;min-width:0}
  .trow{display:flex;align-items:baseline;gap:8px}
  .title{flex:1;min-width:0;font-size:15px;font-weight:600;color:#fff;
    line-height:1.24;letter-spacing:-.01em}
  .age{flex:0 0 auto;font-size:12px;color:#98989d}
  .body{margin-top:2px;font-size:15px;line-height:1.28;color:#e6e6eb;
    letter-spacing:-.01em}
</style></head><body><div class="sheetwrap">

<div class="head">
  <h1>The reminder that read wrong, and four ways to fix it</h1>
  <p>You got <code>1 pick due Fri 9:15 AM</code> over
    <code>16 Week 2 games still need a pick</code>. Both numbers are
    true: the title counts what locks at <b>that one deadline</b> — the
    Thursday game is one game — and the body counts what the
    <b>week</b> still owes. The title is what a phone shows first, so
    the 1 lands as the whole job and the 16 arrives as a
    contradiction.</p>
  <p><b>One thing to decide with it.</b> <code>Fri 9:15 AM</code> is
    right for your timezone — Thursday night kicks off Friday morning
    there, and the Picks tab labels that card FRIDAY for the same
    reason. So any wording that says &ldquo;Thursday night&rdquo; has to
    carry the local time too, or the alert and the app disagree about
    what day it is. Option B does exactly that.</p>
  <p>Nothing is built yet. These are rendered in the phone&rsquo;s own
    font at its own size, so the line breaks are real.</p>
</div>

${block('lee', ['today', 'A', 'B', 'C', 'D'])}
${block('sunday', ['today', 'A', 'B', 'C', 'D'])}
${block('late', ['today', 'A', 'B', 'C', 'D'])}
${block('mnf', ['today', 'A', 'B', 'C', 'D'])}

<div class="grp">
  <div class="glab">What none of them change</div>
  <div class="gsub">the sending rules, which are already right</div>
  <div class="opt"><div class="onote">
    A reminder only ever mentions games you have <b>not</b> picked, one
    per deadline, at most once per deadline per tier, and never between
    10pm and 7am your time except the last call. Four tiers: two days
    out, under a day, a few hours, and ten to seventy-five minutes.
    Pick your week early and you hear nothing at all.
  </div></div>
</div>

</div></body></html>`;

fs.writeFileSync('/tmp/claude-0/mock-reminder.html', html);

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto('file:///tmp/claude-0/mock-reminder.html', { waitUntil: 'load' });
await page.waitForTimeout(500);
const out = new URL('../../docs/mockups/reminder-copy-390.png', import.meta.url).pathname;
await page.screenshot({ path: out, fullPage: true });

/* MEASURED: no title runs to more than two lines on a 390px phone, and
   no body to more than three. A notification that needs a fourth line
   gets truncated with an ellipsis on the lock screen, which would hide
   the very number the option exists to surface — so the sheet has to
   report it rather than let it be discovered on somebody's phone. */
const over = await page.evaluate(() => {
  const out = [];
  for (const o of document.querySelectorAll('.opt')) {
    const name = (o.querySelector('.oname') || {}).textContent || '?';
    const t = o.querySelector('.title'), b = o.querySelector('.body');
    if (!t) continue;
    const tl = Math.round(t.getBoundingClientRect().height / (15 * 1.24));
    const bl = Math.round(b.getBoundingClientRect().height / (15 * 1.28));
    if (tl > 2 || bl > 3) out.push(`${name.trim()}: title ${tl} lines, body ${bl}`);
  }
  return out;
});
console.log(over.length ? 'LONG LINES:\n  ' + over.join('\n  ')
                        : 'every title fits 2 lines, every body 3');
console.log('cards rendered:',
  await page.evaluate(() => document.querySelectorAll('.ios').length));
console.log('wrote reminder-copy-390.png');
await ctx.close();
await b.close();
