/* THE SENDER'S DECISIONS, which nothing tested until now.

   reminder-copy.test.mjs grades the WORDS compose() produces. This file
   grades remind(): which alerts get sent at all, how many, to whom, and
   what numbers go into them. That was the untested half, and it is the
   half this release changed.

   WHAT CHANGED AND WHY IT NEEDS A TEST. A reminder used to be about a
   kickoff TIME. Sunday has three, so a Sunday produced three alerts,
   each naming a different clock reading and counting only the games
   locking at that one moment. It is one alert per BUNCH now, counting
   that bunch's own unpicked games. "Three became one" is exactly the
   kind of change that looks right in the diff and can be wrong in the
   loop, so it is asserted here by counting what comes out.

   The real live.js runs, with fsQuery and fsGet swapped for fixtures
   and remind() in dry mode, so nothing is pushed and no KV is written.

   Run: node reminder-send.test.mjs
*/
import fs from 'fs';
import path from 'path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
let src = fs.readFileSync(path.join(HERE, '../../worker/live.js'), 'utf8');
/* Same trick nudge.test.mjs uses: route the two Firestore readers
   through swappable bindings, and export remind() plus the slate helper
   so a fixture can be built in the same terms the sender thinks in. */
src = src.replace('async function fsQuery(env, parent, collection, where = []) {',
  'let fsQueryImpl = null;\nasync function fsQuery(env, parent, collection, where = []) {\n'
  + '  if (fsQueryImpl) return fsQueryImpl(env, parent, collection, where);');
src = src.replace('async function fsGet(env, path) {',
  'let fsGetImpl = null;\nasync function fsGet(env, path) {\n'
  + '  if (fsGetImpl) return fsGetImpl(env, path);');
src += `
export { remind, etSlate, SLATE_NAMES };
export function __setQuery(f){ fsQueryImpl = f; }
export function __setGet(f){ fsGetImpl = f; }
`;
fs.writeFileSync('/tmp/live.send.mjs', src);
const M = await import('/tmp/live.send.mjs');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? (pass++, console.log('  ok   ' + n))
  : (fail++, console.log('  FAIL ' + n + (x ? '  -> ' + x : ''))); };

/* ---------------------------------------------------------------- */
/* A WEEK BUILT IN REAL TIME, relative to now, because the tiers are
   windows in minutes from now and a fixed date would drift out of them
   the moment the clock moved. Each game carries the minutes-from-now it
   should sit at, so a fixture reads as "three hours out" rather than as
   a timestamp somebody has to decode. */
const now = Date.now();

const env = (over = {}) => ({
  SEASON: '2026',
  SESSIONS: { get: async () => null, put: async () => {} },
  ...over,
});

/* fixture: { games:[...], roster:{uid:{name,tokens,tz,prefs}}, picks:[...] } */
const install = fx => {
  M.__setQuery(async (e, parent, coll, where) => {
    if (coll === 'pools') return [{ _id: 'p1', season: '2026' }];
    if (coll === 'games') {
      const wk = (where.find(w => w[0] === 'wk') || [])[2];
      if (wk != null) return fx.games.filter(g => g.wk === wk);
      const lo = (where.find(w => w[1] === 'GREATER_THAN') || [])[2];
      const hi = (where.find(w => w[1] === 'LESS_THAN') || [])[2];
      return fx.games.filter(g => g.kickoff > lo && g.kickoff < hi);
    }
    if (coll === 'picks') return fx.picks || [];
    return [];
  });
  M.__setGet(async (e, p) => (/roster$/.test(p) ? fx.roster : null));
};

const run = async (fx, e = env()) => {
  install(fx);
  const r = await M.remind(e, true);          // dry: nothing pushed
  return r.detail || [];
};

const ONE = { p1: { name: 'Lee', tokens: ['t1'], tz: 'America/New_York' } };
const roster = extra => ({ p1: ONE.p1, ...extra });

/* ---------------------------------------------------------------- */
console.log('\n1. Three Sunday kickoff times, ONE alert');
{
  /* THE WHOLE POINT OF THE CHANGE. Before, each of these three kickoff
     times was its own alert with its own count. They are one bunch now,
     so one alert, and its count is every unpicked game in the bunch. */
  const mins = 200;                            // inside the 'hours' tier
  const base = new Date(now + mins * 60000);
  /* Force a real Sunday 1pm ET, then put two more kickoffs five and ten
     minutes after it: the same bunch, three different clock readings. */
  const et = d => M.etSlate(d.getTime());
  const games = [0, 5, 10].map((off, i) => ({
    _id: 'g' + i, wk: 2, status: 'scheduled',
    kickoff: new Date(base.getTime() + off * 60000),
  }));
  ok('the fixture is one bunch, not three',
     new Set(games.map(g => et(g.kickoff))).size === 1,
     JSON.stringify(games.map(g => et(g.kickoff))));
  const out = await run({ games, roster: roster(), picks: [] });
  ok('exactly one alert for the three kickoffs', out.length === 1,
     JSON.stringify(out.map(o => o.title)));
  ok('and it counts all three games', out[0] && out[0].n === 3,
     JSON.stringify(out[0]));
  ok('the title carries the name and the bunch',
     /^Lee, /.test(out[0].title), out[0].title);
}

console.log('\n2. One alert per bunch, with that bunch\u2019s own count');
{
  /* THE ASSERTION FOLLOWS THE FIXTURE, and the first version of this
     case did not. It put two kickoffs three and a half hours apart and
     assumed that meant two bunches, then asserted no alert could count
     more than two games. Whether those two times land in different ET
     slates depends on what day and hour the suite happens to run, so on
     a run where they landed in the SAME bunch the correct answer was one
     alert counting three games, and the case failed for being wrong
     rather than for finding anything.

     The property worth asserting does not depend on the calendar: every
     bunch present gets exactly one alert, and that alert's count is its
     own bunch's unpicked games, no more and no fewer. Expected is
     computed from the fixture with the sender's own etSlate, so the
     test cannot disagree with it about what a bunch is. */
  const a = new Date(now + 200 * 60000);
  const b = new Date(a.getTime() + 210 * 60000);
  const games = [
    { _id: 'a1', wk: 2, status: 'scheduled', kickoff: a },
    { _id: 'a2', wk: 2, status: 'scheduled', kickoff: a },
    { _id: 'b1', wk: 2, status: 'scheduled', kickoff: b },
  ];
  const want = {};
  for (const g of games) {
    const k = M.etSlate(g.kickoff.getTime());
    want[k] = (want[k] || 0) + 1;
  }
  const out = await run({ games, roster: roster(), picks: [] });
  const got = {};
  for (const o of out) got[o.slate] = o.n;
  ok(`one alert per bunch (${Object.keys(want).length} here)`,
     out.length === Object.keys(want).length,
     JSON.stringify({ want, got }));
  ok('and each one counts exactly its own bunch',
     JSON.stringify(got) === JSON.stringify(want), JSON.stringify({ want, got }));
  ok('no bunch is left without an alert',
     Object.keys(want).every(k => got[k] != null), JSON.stringify({ want, got }));
}

console.log('\n3. A bunch you have finished is never mentioned');
{
  const base = new Date(now + 200 * 60000);
  const games = [0, 5].map((off, i) => ({
    _id: 'f' + i, wk: 2, status: 'scheduled',
    kickoff: new Date(base.getTime() + off * 60000),
  }));
  const all = await run({ games, roster: roster(), picks: [] });
  ok('unpicked, it sends', all.length === 1, JSON.stringify(all));
  const half = await run({ games, roster: roster(),
    picks: [{ uid: 'p1', wk: 2, gameId: 'f0', winner: 'KC' }] });
  ok('one of two picked, it still sends', half.length === 1, JSON.stringify(half));
  ok('and the count drops to the one that is left', half[0].n === 1,
     JSON.stringify(half[0]));
  const done = await run({ games, roster: roster(), picks: [
    { uid: 'p1', wk: 2, gameId: 'f0', winner: 'KC' },
    { uid: 'p1', wk: 2, gameId: 'f1', winner: 'SF' }] });
  ok('both picked, nothing is sent at all', done.length === 0, JSON.stringify(done));
}

console.log('\n4. A cleared pick is not a pick');
{
  /* score_week.py and the client both filter winner:null tombstones,
     and this path once did not: somebody who un-picked a game to think
     again was recorded as done, got no last call, and scored zero on
     the game the alerts exist to prevent. */
  const games = [{ _id: 'c1', wk: 2, status: 'scheduled',
                   kickoff: new Date(now + 200 * 60000) }];
  const out = await run({ games, roster: roster(),
    picks: [{ uid: 'p1', wk: 2, gameId: 'c1', winner: null }] });
  ok('a tombstone still counts as unpicked', out.length === 1, JSON.stringify(out));
}

console.log('\n5. One alert per member, and only to members with a device');
{
  const games = [{ _id: 'm1', wk: 2, status: 'scheduled',
                   kickoff: new Date(now + 200 * 60000) }];
  const out = await run({ games, picks: [], roster: {
    p1: { name: 'Lee', tokens: ['t1'], tz: 'America/New_York' },
    p2: { name: 'Bob', tokens: ['t2'], tz: 'America/New_York' },
    p3: { name: 'Mo', tokens: [], tz: 'America/New_York' },
  } });
  ok('two reachable members, two alerts', out.length === 2,
     JSON.stringify(out.map(o => o.uid)));
  /* THE NAME IS WHAT TELLS TWO ACCOUNTS ON ONE PHONE APART, which is
     the case Lee hit: two identical notifications, no way to know
     which was which. */
  ok('each alert is addressed to its own member',
     out.some(o => /^Lee, /.test(o.title)) && out.some(o => /^Bob, /.test(o.title)),
     JSON.stringify(out.map(o => o.title)));
  ok('and the member with no device is not sent one',
     !out.some(o => o.uid === 'p3'), JSON.stringify(out.map(o => o.uid)));
}

console.log('\n6. A tier turned off is respected, per member');
{
  const games = [{ _id: 'p1g', wk: 2, status: 'scheduled',
                   kickoff: new Date(now + 200 * 60000) }];
  const out = await run({ games, picks: [], roster: {
    p1: { name: 'Lee', tokens: ['t1'], tz: 'America/New_York', prefs: { hours: false } },
    p2: { name: 'Bob', tokens: ['t2'], tz: 'America/New_York' },
  } });
  ok('the member who switched that tier off gets nothing',
     !out.some(o => o.uid === 'p1'), JSON.stringify(out.map(o => o.uid + ':' + o.tier)));
  ok('and the one who did not still does', out.some(o => o.uid === 'p2'),
     JSON.stringify(out.map(o => o.uid)));
}

console.log('\n7. Already sent for this bunch and tier: not sent twice');
{
  const games = [{ _id: 'k1', wk: 2, status: 'scheduled',
                   kickoff: new Date(now + 200 * 60000) }];
  install({ games, roster: roster(), picks: [] });
  const keys = [];
  const e = env({ SESSIONS: { get: async k => { keys.push(k); return '1'; },
                              put: async () => {} } });
  const r = await M.remind(e, true);
  ok('nothing is sent', (r.detail || []).length === 0, JSON.stringify(r.detail));
  /* KEYED BY SLATE, NOT BY KICKOFF TIME. That is what made three Sunday
     alerts three separate dedupe entries. */
  ok('the dedupe key names the bunch',
     keys.length > 0 && /:(tnf|sat|sun1|sun2|snf|mnf|other):/.test(keys[0]), keys[0]);
  ok('and not a timestamp', !/:\d{10,}:/.test(keys[0] || ''), keys[0]);
}

console.log('\n8. Nothing upcoming, nothing done');
{
  const out = await run({ games: [{ _id: 'z', wk: 2, status: 'scheduled',
    kickoff: new Date(now + 5 * 24 * 3600e3) }], roster: roster(), picks: [] });
  ok('a game five days out is not a reminder yet', out.length === 0,
     JSON.stringify(out));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
