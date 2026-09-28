/* THE REVEAL MARGIN, which decides how long after a kickoff the Grid can
   show anybody's pick.

   WHY THIS FILE EXISTS. Every reveal query asks Firestore for
   `revealAt <= now - margin`, and that margin used to be a flat 120
   seconds. The rules only return a pick once `revealAt <= request.time`
   on the SERVER, and Firestore refuses a list query outright unless the
   rule can be proven for every document it could return, so a device
   whose clock runs fast would have the whole Grid denied rather than get
   fewer rows. 120 seconds was the obviously-safe number.

   The cost was paid at every kickoff. Lee watched a Sunday night game
   start with the Grid open: the column header went LIVE immediately,
   because that is local arithmetic, and every player's cell showed the
   DID NOT PICK dash for over two minutes. Nothing was wrong with the
   data. The margin meant the query could not yet match the picks.

   So the margin now starts at 5 seconds and widens to 120 only when
   Firestore actually refuses. THE REFUSAL IS THE MEASUREMENT.

   WHAT THIS GRADES, and each one is a way to get a self-widening query
   wrong:
     the fast margin is what a first subscription asks for
     a denial widens, and the retry asks with the wider one
     a widened margin sticks for the rest of the session
     a SECOND denial does not retry, because that would loop forever
     the unsubscribe returned to the caller stops the listener that is
       actually running, not the one that was replaced
     an error that is not a denial is reported, not retried
     getRevealed retries once and returns rows
     the value index.html reads reflects a widen that has happened

   THE UNSUBSCRIBE ONE IS THE SUBTLE BUG. watchRevealed returns a
   function the app keeps and calls on every week switch. If that is the
   first listener's own unsubscribe, then after a widen-and-retry it
   closes a listener that is already closed and leaves the live one
   running. Two weeks then render into the same Grid.

   The real firebase-init.js runs here, with the Firebase SDK imports
   swapped for fakes, so nothing leaves the process and no network is
   touched.

   Run: node reveal.test.mjs
*/
import fs from 'fs';
import path from 'path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
let src = fs.readFileSync(path.join(HERE, '../../firebase-init.js'), 'utf8');

/* Strip every CDN import and supply the same names locally. Only the
   handful this file exercises does anything; the rest exist so the
   module evaluates. */
src = src.replace(/^import\s*\{[\s\S]*?\}\s*from\s*'https:\/\/[^']*';/gm, '');
src = src.replace(/^import\s*\{[^}]*\}\s*from\s*'https:\/\/[^']*';/gm, '');

const PRELUDE = `
/* The module ends by hanging PS on window and registering a service
   worker. Node has neither, so give it the two objects it reaches for.
   Nothing here is under test; it exists so the file can evaluate. */
globalThis.window = globalThis;
globalThis.document = { addEventListener(){}, visibilityState:'visible',
  readyState:'complete', querySelector(){ return null; } };
globalThis.location = { href:'https://nflweeklypickem.com/', origin:'https://nflweeklypickem.com', search:'' };
globalThis.localStorage = { getItem(){ return null; }, setItem(){}, removeItem(){} };

const __calls = { snapshots: [], gets: [] };
let __denials = 0;                 // how many more queries should be refused
let __nextCode = null;             // a one-shot error of some OTHER kind
const errOf = code => { const e = new Error(code); e.code = code; return e; };
const deny = () => errOf('permission-denied');
/* Which error, if any, the next query should get. Denials and other
   failures are different code paths in the thing under test, so the fake
   has to be able to produce each on its own. */
function __nextError() {
  if (__nextCode) { const c = __nextCode; __nextCode = null; return errOf(c); }
  if (__denials > 0) { __denials--; return deny(); }
  return null;
}

const initializeApp = () => ({});
const getAuth = () => ({ onAuthStateChanged(){}, currentUser:null });
const GoogleAuthProvider = function(){};
const signInWithPopup = async () => ({});
const signInWithRedirect = async () => ({});
const onAuthStateChanged = () => () => {};
const signOut = async () => {};
const signInWithCustomToken = async () => ({});
const getFirestore = () => ({});
const initializeFirestore = () => ({});
const doc = (...a) => ({ path: a.slice(1).join('/') });
const getDoc = async () => ({ exists: () => false, data: () => null });
const setDoc = async () => {};
const collection = (...a) => ({ path: a.slice(1).join('/') });
const query = (c, ...cs) => ({ c, cs });
const where = (f, op, v) => ({ f, op, v });
const serverTimestamp = () => new Date();
const writeBatch = () => ({ set(){}, commit: async () => {} });
const updateDoc = async () => {};
const arrayUnion = (...v) => v;
const Timestamp = { fromMillis: m => ({ ms: m, toMillis: () => m }) };

/* A LIST QUERY EITHER RUNS OR IS REFUSED, WHOLE. That is the property
   this whole feature turns on, so the fake models exactly that and
   nothing softer: __denials counts how many of the next queries the
   "server" rejects, the way a clock that is too far ahead would. */
function onSnapshot(q, next, err) {
  const bound = q.cs.find(c => c.f === 'revealAt').v.ms;
  const rec = { bound, closed: false, next };
  __calls.snapshots.push(rec);
  const e = __nextError();
  if (e) setTimeout(() => err(e), 0);
  else setTimeout(() => next({ docs: [
    { data: () => ({ uid:'u1', gameId:'g1', winner:'KC', weight:3 }) } ] }), 0);
  return () => { rec.closed = true; };
}
async function getDocs(q) {
  const bound = q.cs.find(c => c.f === 'revealAt');
  __calls.gets.push(bound ? bound.v.ms : null);
  const e = __nextError();
  if (e) throw e;
  return { docs: [ { data: () => ({ uid:'u1', gameId:'g1', winner:'KC', weight:3 }) } ] };
}
`;

src = PRELUDE + src + `
export { watchRevealed, getRevealed, CLOCK_SKEW_MS, FAST_SKEW_MS };
export const __snapshots = () => __calls.snapshots;
export const __gets      = () => __calls.gets;
export const __deny      = n => { __denials = n; };
export const __failNext  = c => { __nextCode = c; };
/* A WIDEN IS PERMANENT FOR A SESSION, on purpose, so a test that needs
   the fast margin has to start a new one. This is the only thing in this
   file that reaches past the public surface, and it exists because the
   alternative is re-importing the module for every case. */
export const __resetSkew = () => { revealSkewMs = FAST_SKEW_MS; };
export const __skew      = () => PS.REVEAL_SKEW_MS;
export const __setPool   = () => { poolId = 'P1'; };
`;
/* poolId is a module-level `let` the real app assigns at sign-in; the
   queries only read it, so a value is all this needs. */
src = src.replace(/\nlet poolId[^\n]*\n/, '\nlet poolId = "P1";\n');

fs.writeFileSync('/tmp/reveal.mod.mjs', src);
const M = await import('/tmp/reveal.mod.mjs');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? (pass++, console.log('  ok   ' + n))
  : (fail++, console.log('  FAIL ' + n + (x ? '  -> ' + x : ''))); };
const tick = () => new Promise(r => setTimeout(r, 5));

/* ---------------------------------------------------------------- */
console.log('\n1. A first subscription asks for the FAST margin');
{
  const before = M.__snapshots().length;
  const now = Date.now();
  const stop = M.watchRevealed(3, () => {});
  await tick();
  const sub = M.__snapshots()[before];
  const skew = now - sub.bound;
  ok('it subscribed', M.__snapshots().length === before + 1);
  /* THE WHOLE POINT, IN ONE NUMBER. At the old flat margin this is
     120000 and a pick cannot show for two minutes. */
  ok('the margin is the fast one, not two minutes',
     skew >= M.FAST_SKEW_MS - 50 && skew <= M.FAST_SKEW_MS + 200, skew);
  ok('and it is nowhere near CLOCK_SKEW_MS', skew < 10000, skew);
  stop();
}

console.log('\n2. A refusal widens, and the retry asks with the wide margin');
{
  const before = M.__snapshots().length;
  M.__deny(1);
  const now = Date.now();
  const rows = [];
  const stop = M.watchRevealed(4, r => rows.push(r));
  await tick(); await tick();
  const subs = M.__snapshots().slice(before);
  ok('it tried twice', subs.length === 2, subs.length);
  ok('the first try used the fast margin',
     now - subs[0].bound < 10000, now - subs[0].bound);
  /* A RETRY THAT DOES NOT WIDEN IS AN INFINITE LOOP THAT LOOKS LIKE A
     WORKING FEATURE, because the second query is refused identically. */
  ok('the retry used the safe margin',
     now - subs[1].bound >= M.CLOCK_SKEW_MS - 50, now - subs[1].bound);
  ok('and the rows actually arrived', rows.length === 1, rows.length);
  ok('the app now reports the widened margin',
     M.__skew() === M.CLOCK_SKEW_MS, M.__skew());
  stop();
}

console.log('\n3. The widen sticks, so nothing pays for it twice');
{
  const before = M.__snapshots().length;
  const now = Date.now();
  const stop = M.watchRevealed(5, () => {});
  await tick();
  const subs = M.__snapshots().slice(before);
  ok('one subscription, no rediscovery', subs.length === 1, subs.length);
  ok('straight to the safe margin',
     now - subs[0].bound >= M.CLOCK_SKEW_MS - 50, now - subs[0].bound);
  stop();
}

console.log('\n4. A second refusal is reported, not retried forever');
{
  const before = M.__snapshots().length;
  M.__deny(50);            // far more than any sane retry count
  const stop = M.watchRevealed(6, () => {});
  await tick(); await tick(); await tick();
  const n = M.__snapshots().length - before;
  /* Already at the safe margin, so widenRevealSkew() returns false and
     there is nothing left to try. One attempt, then the warning. */
  ok('it did not spin', n === 1, n);
  M.__deny(0);
  stop();
}

console.log('\n5. The unsubscribe stops the listener that is RUNNING');
{
  /* THE BUG THIS EXISTS FOR. Return the first listener's own unsubscribe
     and, after a widen-and-retry, the app closes a dead listener and
     leaves the live one pushing rows. The next week switch then renders
     two weeks into one Grid. */
  M.__resetSkew();          // a fresh session, so a retry can happen
  const before = M.__snapshots().length;
  M.__deny(1);
  const stop = M.watchRevealed(7, () => {});
  await tick(); await tick();
  const subs = M.__snapshots().slice(before);
  ok('the fixture really did retry', subs.length === 2, subs.length);
  stop();
  ok('the live listener is closed', subs[subs.length - 1].closed);
  /* AND THE ABANDONED ONE MUST ALSO BE SHUT. The first listener was
     replaced after its denial; if nothing closed it, it sits there for
     the life of the page. */
  ok('and the abandoned one is not left open', subs[0].closed === true,
     JSON.stringify(subs.map(x => x.closed)));
}

console.log('\n6. getRevealed retries once and still returns rows');
{
  M.__resetSkew();
  const before = M.__gets().length;
  M.__deny(1);
  const rows = await M.getRevealed(3);
  const gets = M.__gets().slice(before);
  ok('it asked twice', gets.length === 2, gets.length);
  ok('and it came back with the picks rather than throwing',
     Array.isArray(rows) && rows.length === 1, JSON.stringify(rows));
}

console.log('\n7. An error that is NOT a denial is not retried');
{
  /* A missing composite index is failed-precondition, and no margin will
     ever fix it. Retrying would double every such failure and bury the
     one console line that names the deploy command. */
  M.__resetSkew();
  const before = M.__gets().length;
  M.__failNext('failed-precondition');
  let threw = null;
  try { await M.getRevealed(9); } catch (e) { threw = e; }
  ok('it attempted once and gave up',
     M.__gets().length - before === 1, M.__gets().length - before);
  ok('and the caller sees the real error rather than a silent empty list',
     threw && /failed-precondition/.test(threw.code || ''), threw && threw.code);
  ok('a non-denial does NOT widen the margin',
     M.__skew() === M.FAST_SKEW_MS, M.__skew());
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
