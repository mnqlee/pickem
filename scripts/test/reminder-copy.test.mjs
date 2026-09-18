/* THE WORDS IN EVERY REMINDER, graded against the real compose() and the
   real slate table out of worker/live.js.

   THIS FILE HAS BEEN REWRITTEN TWICE AND THE REASON IS WORTH KEEPING.
   Version one graded a week-level title over a slot-level body ("Week 1
   is open" above "1 game to pick"). Version two graded the inversion:
   "1 pick due Fri 9:15 AM" above "16 Week 2 games still need a pick",
   which Lee received and correctly read as a contradiction. Both
   versions passed every assertion they had, because the assertions were
   written from the same misunderstanding as the code they graded.

   The unit is a NAMED BUNCH of games now, and every number in a message
   counts that bunch. There is no second figure left to mistake for the
   first, which is why most of this file is about the bunch: its name,
   its count, and the places a count can be wrong.

   Run: node reminder-copy.test.mjs
*/
import fs from 'fs';
import path from 'path';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const LIVE = path.join(HERE, '../../worker/live.js');
let src = fs.readFileSync(LIVE, 'utf8');
src += '\nexport { compose, when, etSlate, SLATE_NAMES };\n';
fs.writeFileSync('/tmp/live.copy.mjs', src);
const { compose, etSlate, SLATE_NAMES } = await import('/tmp/live.copy.mjs');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? (pass++, console.log('  ok   ' + n))
  : (fail++, console.log('  FAIL ' + n + (x ? '  -> ' + x : ''))); };

/* compose(tier, slate, who, unpicked, total, w, mins) */
const show = (...a) => { const r = compose(...a);
  console.log(`     ${r.title}\n     ${r.body}`); return r; };

console.log('\n1. THE ALERT LEE RECEIVED, and what it says now');
{
  const r = show('day', 'tnf', 'Lee', 1, 1, 'Fri 9:15 AM', 1200);
  ok('his name is on it', /^Lee, /.test(r.title), r.title);
  ok('the title names the bunch, in football’s own words',
     r.title === 'Lee, Thursday Night Football', r.title);
  /* THE TWO OLD SHAPES, NAMED SO THEY CANNOT COME BACK. Each read as a
     contradiction to the person holding the phone. */
  ok('no "N picks due" title', !/picks? due/.test(r.title), r.title);
  ok('no week total anywhere in it', !/Week \d/.test(r.title + r.body),
     r.title + ' / ' + r.body);
  ok('one game says no team selected, not "1 of 1"',
     /No team selected yet\./.test(r.body) && !/1 of 1|1 game/.test(r.body), r.body);
  ok('a day out, the countdown carries the local clock',
     /Kicks off in 20 hours, Fri 9:15 AM\./.test(r.body), r.body);
  ok('title fits a lock screen (<= 40 chars)', r.title.length <= 40, String(r.title.length));
}

console.log('\n2. A BUNCH OF SEVERAL, which is what the counts are for');
{
  const r = show('hours', 'sun1', 'Lee', 6, 9, 'Sun 2:00 AM', 180);
  ok('it names the early Sunday games', /the early Sunday games$/.test(r.title), r.title);
  ok('and counts what is still unpicked', /6 games unpicked\./.test(r.body), r.body);
  ok('"First kickoff", because a bunch has more than one',
     /^First kickoff in 3 hours\./.test(r.body), r.body);
  ok('the bunch total is not printed, only what is left',
     !/of 9|9 games/.test(r.body), r.body);
}

console.log('\n3. Singular and plural follow what is LEFT, not the bunch size');
{
  const one = compose('hours', 'sun1', 'Lee', 1, 9, 'x', 180);
  const many = compose('hours', 'sun1', 'Lee', 6, 9, 'x', 180);
  ok('1 game unpicked', /\b1 game unpicked\b/.test(one.body), one.body);
  ok('6 games unpicked', /\b6 games unpicked\b/.test(many.body), many.body);
  ok('1 hour is singular', /in 1 hour\./.test(compose('hours', 'snf', 'Lee', 1, 1, 'x', 60).body));
  ok('3 hours is not', /in 3 hours\./.test(compose('hours', 'snf', 'Lee', 1, 1, 'x', 180).body));
}

console.log('\n4. The four tiers, and where the warning starts');
{
  const open = show('open', 'sun1', 'Lee', 9, 9, 'Sun 2:00 AM', 2000);
  ok('two days out gives the clock, not a countdown in hours',
     /^First kickoff Sun 2:00 AM\./.test(open.body), open.body);
  /* THE WARNING EARNS ITS SPACE ONLY WHEN IT IS NEARLY TRUE. Two days
     before kickoff it warns about a hypothetical, and it was also the
     thing that pushed this body onto a third line, which iOS hides
     behind a pull-down in a stacked notification. */
  ok('and no zero warning yet', !/score 0/.test(open.body), open.body);
  ok('a day out, still none',
     !/score 0/.test(compose('day', 'sun1', 'Lee', 9, 9, 'Sun 2:00 AM', 1080).body));
  ok('a few hours out, it appears',
     /Unselected games score 0\./.test(
       compose('hours', 'sun1', 'Lee', 9, 9, 'Sun 2:00 AM', 180).body));
  const fin = show('final', 'mnf', 'Lee', 1, 1, 'Tue 9:15 AM', 22);
  ok('last call counts minutes', /Kicks off in 22 min\./.test(fin.body), fin.body);
  ok('and warns', /score 0\./.test(fin.body), fin.body);
}

console.log('\n5. Every bunch has a name, and no two read the same');
{
  const keys = ['tnf', 'sat', 'sun1', 'sun2', 'snf', 'mnf', 'other'];
  ok('every slate key has a name', keys.every(k => !!SLATE_NAMES[k]),
     JSON.stringify(keys.filter(k => !SLATE_NAMES[k])));
  const names = keys.map(k => SLATE_NAMES[k]);
  ok('and they are all distinct', new Set(names).size === names.length,
     JSON.stringify(names));
  /* NOT "MORNING" OR "AFTERNOON". The early Sunday block is 1pm in New
     York and 2am in Japan; neither is morning, and a name that is wrong
     for most of the pool is worse than a plain one. */
  ok('no bunch is named by a time of day',
     !names.some(n => /morning|afternoon|evening/i.test(n)), JSON.stringify(names));
  for (const k of keys) {
    const r = compose('hours', k, 'Lee', 2, 3, 'x', 120);
    ok(`${k}: reads as a sentence`,
       r.title.startsWith('Lee, ') && /unpicked\./.test(r.body),
       `${r.title} / ${r.body}`);
  }
}

console.log('\n6. No dashes, and nothing that needs expanding to read');
{
  const all = [];
  for (const t of ['open', 'day', 'hours', 'final'])
    for (const k of ['tnf', 'sun1', 'sun2', 'snf', 'mnf'])
      for (const [u, n] of [[1, 1], [1, 9], [6, 9], [9, 9]])
        all.push(compose(t, k, 'Lee', u, n, 'Sun 2:00 AM', 180));
  ok(`${all.length} messages, not one em or en dash`,
     !all.some(r => /[–—]/.test(r.title + r.body)),
     JSON.stringify(all.find(r => /[–—]/.test(r.title + r.body)) || ''));
  /* Two body lines at 15px on a 390px phone is about 80 characters.
     Measured properly in docs/mockups/reminder-g1t-*; this is the cheap
     guard that stops a later edit blowing past it unnoticed. */
  const long = all.filter(r => r.body.length > 80);
  ok('and every body stays inside two lines', long.length === 0,
     JSON.stringify(long.slice(0, 2).map(r => r.body.length + ': ' + r.body)));
}

console.log('\n7. A missing display name does not leave a stray comma');
{
  const r = compose('final', 'mnf', '', 1, 1, 'Tue 9:15 AM', 22);
  ok('no leading comma', !/^,/.test(r.title), r.title);
  ok('it is just the bunch', r.title === 'Monday Night Football', r.title);
  ok('undefined behaves the same',
     compose('final', 'mnf', undefined, 1, 1, 'x', 22).title === 'Monday Night Football');
}

console.log('\n8. etSlate: a kickoff lands where football would put it');
{
  /* DECIDED IN ET, on purpose. The slate is a fact about the schedule,
     so the clock is localised separately: in Japan Thursday Night
     Football kicks off Friday morning, and naming the bunch from the
     reader's own zone would have one member's alert disagreeing with
     the schedule the other twenty seven talk about. */
  const at = iso => etSlate(Date.parse(iso));
  ok('Thursday 8:15pm ET is Thursday Night Football',
     at('2026-09-10T20:15:00-04:00') === 'tnf');
  ok('and so is the same game read at 00:30 ET, after midnight',
     at('2026-09-11T00:30:00-04:00') === 'tnf');
  ok('Sunday 1:00pm ET is the early Sunday games',
     at('2026-09-13T13:00:00-04:00') === 'sun1');
  ok('the 9:30am London kickoff is early Sunday too',
     at('2026-09-13T09:30:00-04:00') === 'sun1');
  ok('Sunday 4:25pm ET is the late Sunday games',
     at('2026-09-13T16:25:00-04:00') === 'sun2');
  ok('Sunday 8:20pm ET is Sunday Night Football',
     at('2026-09-13T20:20:00-04:00') === 'snf');
  ok('Monday 8:15pm ET is Monday Night Football',
     at('2026-09-14T20:15:00-04:00') === 'mnf');
  ok('a December Saturday is its own bunch',
     at('2026-12-19T13:00:00-05:00') === 'sat');
  /* THE ONE THAT MATTERS FOR LEE: the same instant, read from Japan.
     etSlate takes a timestamp, so the reader's zone cannot reach it. */
  ok('the Thursday opener is still Thursday football at 9:15am in Iwakuni',
     at('2026-09-11T09:15:00+09:00') === 'tnf');
  ok('nothing on a real schedule falls through to "other"',
     ['2026-09-10T20:15:00-04:00', '2026-09-13T09:30:00-04:00',
      '2026-09-13T13:00:00-04:00', '2026-09-13T16:25:00-04:00',
      '2026-09-13T20:20:00-04:00', '2026-09-14T20:15:00-04:00',
      '2026-12-19T13:00:00-05:00'].every(i => at(i) !== 'other'));
  ok('and a nonsense timestamp is handled rather than thrown',
     etSlate(NaN) === 'other', String(etSlate(NaN)));
}

console.log('\n9. A whole week of alerts, in order, with nothing repeated');
{
  /* The sequence Lee would actually receive if he picked nothing until
     Saturday: five bunches, each on its own schedule, each counting its
     own games. Printed so the wording reads as a run rather than as
     isolated strings. */
  const week = [
    ['day',   'tnf',  1, 1, 'Fri 9:15 AM', 1440],
    ['final', 'tnf',  1, 1, 'Fri 9:15 AM', 22],
    ['day',   'sun1', 9, 9, 'Sun 2:00 AM', 1080],
    ['hours', 'sun1', 6, 9, 'Sun 2:00 AM', 180],
    ['hours', 'sun2', 4, 4, 'Sun 5:00 AM', 120],
    ['final', 'snf',  1, 1, 'Sun 9:20 AM', 30],
    ['final', 'mnf',  1, 1, 'Tue 9:15 AM', 25],
  ].map(a => compose(a[0], a[1], 'Lee', a[2], a[3], a[4], a[5]));
  week.forEach(r => console.log(`     ${r.title}\n       ${r.body}`));
  ok('seven alerts across the week', week.length === 7);
  ok('no two are identical',
     new Set(week.map(r => r.title + r.body)).size === week.length);
  ok('every one names its own bunch',
     week.every(r => /Football$|Sunday games$/.test(r.title)),
     JSON.stringify(week.map(r => r.title)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
