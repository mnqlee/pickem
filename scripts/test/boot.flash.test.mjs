/* A refresh never shows a signed-in player the sign-up form (v1.44.8).

   Lee, on the test copy: "It flashed out to sign in screen then waits a
   few seconds then goes back into the refreshed window." Cause: the page
   put the wizard up at once for anyone without ps_onboarded, and only the
   wizard's LAST tap ever wrote it. Anyone who signed in and left the
   wizard early saw the name-and-email form over the loading cover, for
   the whole load, on every open after.

   Runs the REAL index.html and firebase-init.js (reads-true.mjs), and
   samples what was on screen every 50 ms from the first paint.

     node scripts/test/boot.flash.test.mjs */
import { measure } from './reads-true.mjs';

let pass = 0, fail = 0; const fails = [];
const ok = (name, cond, info = '') => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; fails.push(name); console.log('  FAIL ' + name + (info ? '   :: ' + info : '')); }
};
const wizardEver = r => r.seen.some(([, v]) => v.startsWith('ob'));
const endsIn = (r, v) => (r.seen[r.seen.length - 1] || [])[1] === v;
const signUpForm = r => /Come and get them/.test(r.obText);
const NEVER_FINISHED = { ps_onboarded: null };

console.log('\n1. Signed in: the app, with only the loading cover before it');
for (const [name, o] of [
  ['finished the wizard long ago', {}],
  ['signed in but left the wizard early (the reported case)', { local: NEVER_FINISHED }],
  ['the same, with a slow session check', { local: NEVER_FINISHED, sessionDelay: 1500 }],
  ['the same, signed in by the cookie alone (no saved user)', { local: NEVER_FINISHED, persisted: false }],
  ['the same, pulled to refresh', { local: NEVER_FINISHED, reload: true }],
]) {
  const r = await measure({ ...o, wait: 5000 });
  ok(`${name}: the sign-up form is never on screen`, !wizardEver(r), JSON.stringify(r.seen));
  ok(`${name}: and the app opens`, endsIn(r, '') && r.cards === 15, `${JSON.stringify(r.seen)} cards ${r.cards}`);
  ok(`${name}: no page errors`, r.errors.length === 0, r.errors[0] || '');
  /* Nobody is signed out by this: no sign-out call, no logout request,
     still the same player, and the pool and name kept on the phone. */
  ok(`${name}: still signed in as the same player, never signed out`, r.auth.signOuts === 0 && r.auth.uid === 'u_0'
     && !r.api.includes('/api/logout'), JSON.stringify({ auth: r.auth, api: r.api }));
  ok(`${name}: the pool and name on the phone are untouched`, r.ls.ps_pool === 'P1' && r.ls.ps_name === 'Lee', JSON.stringify(r.ls));
}

console.log('\n2. It heals: once in the app, the next open is a normal one');
{
  const r = await measure({ local: NEVER_FINISHED, wait: 5000 });
  ok('ps_onboarded is written when the app opens', r.ls.ps_onboarded === '1', JSON.stringify(r.ls));
}

console.log('\n3. Signed out: the sign-up form still appears, and quickly');
for (const [name, o] of [
  ['a brand new device', { local: { ps_onboarded: null, ps_pool: null, ps_name: null } }],
  ['joined before, now signed out', {}],
  ['joined before, never finished, signed out', { local: NEVER_FINISHED }],
  ['signed out, slow session check', { local: NEVER_FINISHED, sessionDelay: 1500 }],
]) {
  const r = await measure({ ...o, persisted: false, session: 'none', wait: 4000 });
  const at = (r.seen.find(([, v]) => v === 'ob') || [Infinity])[0];
  const limit = 1000 + (o.sessionDelay || 0);
  ok(`${name}: the sign-up form, not a stuck cover`, endsIn(r, 'ob') && signUpForm(r), `${JSON.stringify(r.seen)} ${r.obText.slice(0, 60)}`);
  ok(`${name}: up within ${limit} ms`, at <= limit, String(at));
  ok(`${name}: no app behind it`, r.cards === 0, String(r.cards));
}
{
  /* The session check is held for 1.5 s, so only the page-load path can
     have put the form up before 400 ms. */
  const r = await measure({ local: { ps_onboarded: null, ps_pool: null, ps_name: null }, persisted: false, session: 'none', sessionDelay: 1500, wait: 3000 });
  ok('a brand new device still gets the form at once, before the session check answers',
     (r.seen.find(([, v]) => v.startsWith('ob')) || [Infinity])[0] < 400, JSON.stringify(r.seen));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fails.length) { console.log('FAILURES:'); fails.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);
