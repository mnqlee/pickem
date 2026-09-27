/* THE DAILY BETTING-LINE REFRESH, which is new in v1.39.0.

   WHAT IT IS FOR. The lines already refreshed, in pull_lines() inside
   scripts/score_week.py, but only on a scoring run: Sunday about 9pm
   ET, Monday about 3am, Tuesday about 4am and Tuesday about noon ET. So
   the last refresh before a Sunday slate was TUESDAY, and Wednesday
   through Saturday every card showed Tuesday's number. Lee saw it from
   the outside: "when you pill espn spreads, they dont change."

   pullLines() in worker/live.js closes that, once a UTC day, inside a
   Worker that already wakes every five minutes and already talks to
   this exact ESPN endpoint.

   WHAT THIS FILE GRADES, and every one of these is a way to get a
   once-a-day writer wrong:
     it runs once a day and not on every five-minute tick
     a failed day is NOT stamped, so the next tick retries
     it never creates a game document, whatever ESPN renames
     an unpriced game does not erase the line already stored
     an unchanged line is not rewritten
     it only ever touches `spread`

   The real live.js runs, with fsQuery, fsPatch and fetch swapped for
   fixtures, so nothing leaves the process.

   Run: node lines.test.mjs
*/
import fs from 'fs';
import path from 'path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
let src = fs.readFileSync(path.join(HERE, '../../worker/live.js'), 'utf8');
src = src.replace('async function fsQuery(env, parent, collection, where = []) {',
  'let fsQueryImpl = null;\nasync function fsQuery(env, parent, collection, where = []) {\n'
  + '  if (fsQueryImpl) return fsQueryImpl(env, parent, collection, where);');
src = src.replace('async function fsPatch(env, path, fields) {',
  'let fsPatchImpl = null;\nasync function fsPatch(env, path, fields) {\n'
  + '  if (fsPatchImpl) return fsPatchImpl(env, path, fields);');
src += `
export { pullLines };
export function __setQuery(f){ fsQueryImpl = f; }
export function __setPatch(f){ fsPatchImpl = f; }
`;
fs.writeFileSync('/tmp/live.lines.mjs', src);
const M = await import('/tmp/live.lines.mjs');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? (pass++, console.log('  ok   ' + n))
  : (fail++, console.log('  FAIL ' + n + (x ? '  -> ' + x : ''))); };

const now = Date.now();
const DAY = 86400000;

/* A KV stand-in that records what was written, because "did it stamp
   the day" is half of what this file is about. */
const kv = (seed = {}) => {
  const store = { ...seed };
  return { store,
    get: async k => (k in store ? store[k] : null),
    put: async (k, v) => { store[k] = v; } };
};
const env = (over = {}) => ({ SEASON: '2026', SESSIONS: kv(), ...over });

/* ESPN, stubbed. `events` is what the scoreboard returns for every week
   asked for; `status` forces a non-200. */
let fetchCalls = [];
const stubFetch = (events, status = 200) => {
  fetchCalls = [];
  globalThis.fetch = async url => {
    fetchCalls.push(String(url));
    if (status !== 200) return { ok: false, status, text: async () => 'nope' };
    return { ok: true, status: 200, json: async () => ({ events }) };
  };
};
const ev = (away, home, details) => ({
  competitions: [{
    competitors: [
      { homeAway: 'away', team: { abbreviation: away } },
      { homeAway: 'home', team: { abbreviation: home } } ],
    ...(details == null ? {} : { odds: [{ details }] })
  }]
});

/* The games this pool already has, in the shape fsQuery returns. */
const game = (id, wk, kickIn, spread) => ({
  _id: id, wk, spread, kickoff: new Date(now + kickIn)
});

const patches = [];
const install = (games) => {
  patches.length = 0;
  M.__setQuery(async (e, parent, coll) => (coll === 'games' ? games : []));
  M.__setPatch(async (e, p, fields) => { patches.push({ path: p, fields }); });
};

/* ---------------------------------------------------------------- */
console.log('\n1. It writes the new line, and only that');
{
  const g = [game('2026_W3_KC_BUF', 3, 2 * DAY, 'KC -3')];
  install(g);
  stubFetch([ev('KC', 'BUF', 'KC -4.5')]);
  const e = env();
  const r = await M.pullLines(e);
  ok('one game priced', r.seen === 1, JSON.stringify(r));
  ok('and one write', patches.length === 1, JSON.stringify(patches));
  ok('to that game’s own document',
     patches[0] && /games\/2026_W3_KC_BUF$/.test(patches[0].path),
     patches[0] && patches[0].path);
  /* THE FIELD LIST IS THE SAFETY PROPERTY. fsPatch builds its update
     mask from these keys, so anything else here is a field this job
     could overwrite: a kickoff, a score, a winner. */
  ok('carrying nothing but the spread',
     patches[0] && Object.keys(patches[0].fields).join() === 'spread',
     JSON.stringify(patches[0] && patches[0].fields));
  ok('with ESPN’s own text', patches[0].fields.spread === 'KC -4.5',
     patches[0].fields.spread);
  ok('and the day is stamped', e.SESSIONS.store['lines:day'] != null,
     JSON.stringify(e.SESSIONS.store));
}

console.log('\n2. Once a day, not once every five minutes');
{
  const g = [game('2026_W3_KC_BUF', 3, 2 * DAY, 'KC -3')];
  install(g);
  stubFetch([ev('KC', 'BUF', 'KC -4.5')]);
  const e = env();
  await M.pullLines(e);
  const after = patches.length;
  const r2 = await M.pullLines(e);
  ok('the second call the same day does nothing',
     patches.length === after && r2.skipped, JSON.stringify(r2));
  ok('and it does not even ask ESPN',
     fetchCalls.length === 1, String(fetchCalls.length));
  /* THE ESCAPE HATCH, which exists so the whole path can be proved
     without waiting until tomorrow. */
  const r3 = await M.pullLines(e, true);
  ok('force ignores the stamp', !r3.skipped, JSON.stringify(r3));
}

console.log('\n3. A day that reached nobody is not stamped');
{
  install([game('2026_W3_KC_BUF', 3, 2 * DAY, 'KC -3')]);
  stubFetch([], 403);
  const e = env();
  const r = await M.pullLines(e);
  /* IF A FAILED RUN STAMPED THE DAY, one bad afternoon would cost a
     whole day of lines, and the retry is free: the next tick is five
     minutes away. */
  ok('ESPN refusing leaves the day unstamped',
     e.SESSIONS.store['lines:day'] == null, JSON.stringify(e.SESSIONS.store));
  ok('and nothing was written', patches.length === 0, JSON.stringify(patches));
  ok('and it says so rather than reporting success',
     r.seen === 0, JSON.stringify(r));
}

console.log('\n4. It can never create a game');
{
  /* ESPN RENAMES CLUBS. WAS became WSH. fsPatch is a PATCH, which
     Firestore turns into an insert, so an unmatched id would write a
     phantom game into the schedule: a 17-game week with no kickoff and
     nobody's picks against it, there for the rest of the season. */
  install([game('2026_W3_KC_BUF', 3, 2 * DAY, 'KC -3')]);
  stubFetch([ev('WAS', 'DAL', 'DAL -7'), ev('KC', 'BUF', 'KC -4.5')]);
  const r = await M.pullLines(env());
  ok('a game we do not have is skipped, not inserted',
     patches.every(p => !/WAS/.test(p.path)), JSON.stringify(patches.map(p => p.path)));
  ok('and it is counted so it can be logged',
     r.unmatched === 1, JSON.stringify(r));
  ok('the one we do have still updates', patches.length === 1, JSON.stringify(patches));
}

console.log('\n5. No odds must not erase the line we already had');
{
  /* ESPN drops the odds array for a game it has not priced. Writing ''
     for that would blank a line every time the book pulled it. */
  install([game('2026_W9_KC_BUF', 9, 7 * DAY, 'KC -3')]);
  stubFetch([ev('KC', 'BUF', null)]);
  const r = await M.pullLines(env());
  ok('an unpriced game is left alone', patches.length === 0, JSON.stringify(patches));
  ok('and counts as nothing seen', r.seen === 0, JSON.stringify(r));
}

console.log('\n6. An unchanged line is not rewritten');
{
  install([game('2026_W3_KC_BUF', 3, 2 * DAY, 'KC -4.5')]);
  stubFetch([ev('KC', 'BUF', 'KC -4.5')]);
  const r = await M.pullLines(env());
  ok('no write when the number has not moved',
     patches.length === 0, JSON.stringify(patches));
  /* SEEN COUNTS THE PRICED GAMES, CHANGED COUNTS THE WRITES, and the
     difference is what says the guard is working rather than the fetch
     having failed. */
  ok('but it still counts as seen, so the day stamps',
     r.seen === 1 && r.changed === 0, JSON.stringify(r));
}

console.log('\n7. Nothing inside the window, nothing to do');
{
  install([]);
  stubFetch([ev('KC', 'BUF', 'KC -4.5')]);
  const e = env();
  const r = await M.pullLines(e);
  ok('it stops before asking ESPN', r.skipped && fetchCalls.length === 0,
     JSON.stringify(r) + ' calls ' + fetchCalls.length);
  ok('and does not stamp a day it did nothing on',
     e.SESSIONS.store['lines:day'] == null, JSON.stringify(e.SESSIONS.store));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
