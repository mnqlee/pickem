/* Exercises nudgeScores() against a fake Firestore and a fake GitHub.
   The point is the DECISION: does it dispatch only when a game is
   actually live, and does every failure stay quiet and non-fatal. */
import fs from 'fs';
import path from 'path';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const LIVE = path.join(HERE, '../../worker/live.js');
let src = fs.readFileSync(LIVE,'utf8');
// Expose the internals this test drives, and let it swap fsQuery.
src += `\nexport { nudgeScores, NUDGE_MAX_AGE };\nexport function __setQuery(f){ fsQueryImpl = f; }\n`;
// Route fsQuery through a swappable binding.
src = src.replace('async function fsQuery(env, parent, collection, where = []) {',
  'let fsQueryImpl = null;\nasync function fsQuery(env, parent, collection, where = []) {\n  if (fsQueryImpl) return fsQueryImpl(env, parent, collection, where);');
fs.writeFileSync('/tmp/live.under.test.mjs', src);
const M = await import('/tmp/live.under.test.mjs');

let pass=0, fail=0;
const ok=(n,c,x='')=>{ c?(pass++,console.log('  ok   '+n)):(fail++,console.log('  FAIL '+n+(x?'  -> '+x:''))); };

const now = Date.now();
const g = (mins, status) => ({ kickoff: new Date(now + mins*60000), status, wk:1 });

let calls=[];
const fakeGitHub = (status, body='') => {
  globalThis.fetch = async (url, opts) => {
    calls.push({ url:String(url), method:opts?.method, auth:opts?.headers?.Authorization,
                 ua:opts?.headers?.['User-Agent'], body:opts?.body });
    if (status === 'throw') throw new Error('network down');
    return { status, text: async () => body };
  };
};
const withGames = rows => M.__setQuery(async () => rows);

console.log('\n1. No token: stays quiet, does not call GitHub');
{ calls=[]; fakeGitHub(204); withGames([g(-30,'live')]);
  const r = await M.nudgeScores({});
  ok('returns skipped', r.skipped === 'GH_TOKEN not set', JSON.stringify(r));
  ok('and never touched GitHub', calls.length === 0, JSON.stringify(calls)); }

console.log('\n2. A game in progress: dispatches');
{ calls=[]; fakeGitHub(204); withGames([g(-30,'live'), g(-120,'final')]);
  const r = await M.nudgeScores({ GH_TOKEN:'t', GH_REPO:'o/r' });
  ok('dispatched', r.dispatched === true, JSON.stringify(r));
  ok('counted only the unfinished game', r.live === 1, JSON.stringify(r));
  ok('POST to the right workflow',
     calls[0]?.method==='POST' && calls[0].url==='https://api.github.com/repos/o/r/actions/workflows/scores.yml/dispatches',
     calls[0]?.url);
  ok('on the default branch', JSON.parse(calls[0].body).ref === 'main', calls[0].body);
  ok('with a User-Agent (GitHub rejects requests without one)', !!calls[0].ua, String(calls[0].ua));
  ok('and the token in the header', calls[0].auth === 'Bearer t', String(calls[0].auth)); }

console.log('\n3. Every game final: no dispatch');
{ calls=[]; fakeGitHub(204); withGames([g(-30,'final'), g(-200,'final')]);
  const r = await M.nudgeScores({ GH_TOKEN:'t' });
  ok('skipped', r.skipped === 'nothing live', JSON.stringify(r));
  ok('no GitHub call', calls.length === 0, JSON.stringify(calls)); }

console.log('\n4. Nothing kicked off yet: no dispatch');
{ calls=[]; fakeGitHub(204); withGames([]);
  const r = await M.nudgeScores({ GH_TOKEN:'t' });
  ok('skipped', r.skipped === 'nothing live', JSON.stringify(r));
  ok('no GitHub call', calls.length === 0, JSON.stringify(calls)); }

console.log('\n5. A game nobody ever marked final stops being nudged');
{ // The query itself bounds it, so prove the bound is the 6h constant
  let seen=null;
  M.__setQuery(async (env,parent,coll,where)=>{ seen=where; return []; });
  fakeGitHub(204);
  await M.nudgeScores({ GH_TOKEN:'t' });
  const lo = seen.find(w=>w[1]==='GREATER_THAN')[2].getTime();
  ok('the query floor is six hours back',
     Math.abs((now - lo) - M.NUDGE_MAX_AGE) < 5000, String(now-lo));
  ok('and the ceiling is now', !!seen.find(w=>w[1]==='LESS_THAN'), JSON.stringify(seen.map(w=>w[1])));
  ok('both filters are on the same field (no composite index)',
     new Set(seen.map(w=>w[0])).size === 1, JSON.stringify(seen.map(w=>w[0]))); }

console.log('\n6. GitHub says no: reported, not thrown');
for (const [st, label] of [[403,'a revoked or under-scoped token'],
                           [404,'a renamed workflow file'],
                           [422,'a bad ref']]) {
  calls=[]; fakeGitHub(st, '{"message":"nope"}'); withGames([g(-30,'live')]);
  let threw=false, r=null;
  try { r = await M.nudgeScores({ GH_TOKEN:'t' }); } catch(e){ threw=true; }
  ok(`${st} (${label}) does not throw`, !threw);
  ok(`${st} is reported as not dispatched`, r && r.dispatched === false && r.status === st, JSON.stringify(r));
}

console.log('\n7. Network failure propagates to the guard, not to reminders');
{ fakeGitHub('throw'); withGames([g(-30,'live')]);
  let threw=false;
  try { await M.nudgeScores({ GH_TOKEN:'t' }); } catch(e){ threw=true; }
  ok('it rejects, so scheduled()\'s guard logs it', threw);
  ok('and that guard is separate from remind()',
     /waitUntil\(guard\('nudge'/.test(fs.readFileSync(LIVE,'utf8'))); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
