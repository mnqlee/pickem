/* ============================================================
   Weekly NFL Pick’em — data layer
   Auth, Firestore, push registration, and app updates.

   Exposes window.PS with everything index.html needs.
   ============================================================ */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  onAuthStateChanged, signOut
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, doc, getDoc, setDoc, collection, query, where,
  getDocs, onSnapshot, serverTimestamp, Timestamp, writeBatch, updateDoc, arrayUnion
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
/* MESSAGING LOADS ON DEMAND, NOT ON ARRIVAL.

   This was a static import, so every visitor downloaded and parsed the
   whole FCM module before the page could finish booting — including the
   first-time visitor, who by definition has not granted notification
   permission and cannot possibly need it yet.

   Every one of the three call sites already returns early for exactly
   that person: alertsHealthy() and refreshPushToken() both check
   Notification.permission before going near messaging, and enablePush()
   only runs when somebody taps the button. So nobody who needs it is
   made to wait, and nobody who does not need it pays for it at all.
   Once they do turn alerts on it is fetched once and cached like
   anything else. */
let _messaging = null;
const fcm = () => (_messaging ||=
  import('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js'));
import {
  signInWithCustomToken
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

/* ---- STEP 3 in SETUP.md: paste your config here ---- */
const firebaseConfig = {
  apiKey: "AIzaSyB_rtPAdOgyV7OiPB7R3DwXeShKQTIlxMI",
  authDomain: "pickem-c0d06.firebaseapp.com",
  projectId: "pickem-c0d06",
  storageBucket: "pickem-c0d06.firebasestorage.app",
  messagingSenderId: "470222582761",
  appId: "1:470222582761:web:1761a27275f7966b62d178"
};

/* ---- STEP 9: paste your Web Push certificate key pair ---- */
const VAPID_KEY = "BHd0epdIuyVNZK2ly8EKsZ3QUB-lERPlMM7hnuH_e_Y1auimWPhlww9iPQ-HoVVcFE4NtFav07KM9thxS3mOiag";

const SEASON = "2026";

/* How far behind the device clock to place any `revealAt <=` query bound.

   The rules compare against `request.time` (Google's clock); the query
   filters against this device's. A phone running even a minute fast asks
   for picks the server has not revealed yet — and because a list query is
   refused outright unless the rule permits EVERY document it could return,
   the whole Grid read fails rather than returning fewer rows. It then
   degrades to an empty Grid with only a console warning. Asking for
   slightly less than we are entitled to costs at most one refresh cycle
   of freshness; asking for slightly more costs the entire read. */
const CLOCK_SKEW_MS = 120000;

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

let user = null;
let poolId = localStorage.getItem('ps_pool') || null;
let swRegistering = null;

/* Register the service worker the moment this module loads.

   Everything push-related depends on there being a registered worker:
   getToken() is handed one, and a Web Push message is only ever displayed
   by a worker's own push handler. Waiting for the app to call registerSW()
   meant it never happened at all. Registering here also warms the offline
   cache before the first tap. */
if ('serviceWorker' in navigator) {
  // Deferred one tick so `registerSW` is defined and the app can still
  // attach its own update prompt on top of this same registration.
  setTimeout(() => registerSW(), 0);
}

/* ============================================================
   AUTH
   ============================================================ */
async function signIn() {
  const provider = new GoogleAuthProvider();
  // Popups are blocked inside iOS home-screen apps, so redirect there.
  const standalone = window.matchMedia('(display-mode: standalone)').matches
                     || window.navigator.standalone === true;
  if (standalone) return signInWithRedirect(auth, provider);
  return signInWithPopup(auth, provider);
}

/* Everything that has to happen on every sign-in happens here, not in a
   list of calls the app is expected to remember. Forgetting one of these
   fails silently, which is the worst kind of bug to ship. */
function watchAuth(cb) {
  onAuthStateChanged(auth, async u => {
    user = u;
    if (!u) {
      /* Clear the cached pool on sign-out. It used to survive, so the next
         person to sign in on a shared device (the family iPad) was silently
         auto-joined to the previous person's pool — they appeared in those
         standings and could read that pool's revealed picks, and were never
         offered the join screen. */
      poolId = null;
      try { localStorage.removeItem('ps_pool'); } catch {}
    }
    if (u) {
      /* Guarded, because cb(u) is the contract and it has to fire.
         ensureCurrentPool() and ensureMember() have no internal try/catch,
         so a single denied read or one offline moment used to throw
         straight past the callback: boot() never heard that anyone had
         signed in, and the app sat on its loading screen forever with no
         error, no retry and nothing in the UI to say why. Setup failing is
         recoverable; never being told about the sign-in is not. */
      try {
        const pool = await ensureCurrentPool();   // clears a stale pool id
        if (pool) {
          await ensureMember();
          await upsertRoster();                   // name + timezone
          await refreshPushToken();               // re-arm alerts for THIS pool
        }
      } catch (e) {
        console.warn('post-sign-in setup failed', e);
      }
    }
    cb(u);
  });
}

/* Does this person actually have a working alert registration in the
   pool they are currently in? Used to surface the problem in the app
   rather than waiting for them to notice they get no reminders. */
async function alertsHealthy() {
  if (typeof Notification === 'undefined') return { ok: false, reason: 'unsupported' };
  if (Notification.permission !== 'granted') return { ok: false, reason: 'permission' };
  if (!user || !poolId) return { ok: false, reason: 'signed-out' };
  try {
    const reg = await swReady();
    // No worker means push cannot be delivered at all — report it as the
    // fault it is rather than hanging on a promise that never settles.
    if (!reg) return { ok: false, reason: 'no-worker' };
    const { getMessaging, getToken } = await fcm();
    const token = await getToken(getMessaging(app),
      { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
    return token ? { ok: true } : { ok: false, reason: 'no-token' };
  } catch {
    return { ok: false, reason: 'no-token' };
  }
}

/* The name to show for this person, from the first source that has one.

   PIN sign-in mints a Firebase CUSTOM token, and a custom token populates
   neither `displayName` nor `email` — the Worker carries the address in a
   custom claim, which is not `user.email`. The old chain fell all the way
   through to reading `#obMailIn` from the DOM, but by the time joinPool()
   runs the onboarding body has been re-rendered to the PIN screen and that
   input no longer exists. So EVERY member document was created with the
   literal name "Player".

   That is not just cosmetic: the app keyed players by name, so a whole
   pool of "Player" collapsed into one row and everyone saw one person's
   picks. The name typed at "What do we call you?" is saved to
   localStorage by the onboarding, so use it. */
function myName() {
  const typed = (() => { try { return localStorage.getItem('ps_name'); } catch { return null; } })();
  return (user && user.displayName)
      || (typed && typed.trim())
      || (user && user.email ? user.email.split('@')[0] : null)
      || (document.getElementById('obMailIn')?.value?.split('@')[0])
      || 'Player';
}

async function ensureMember(code) {
  const ref = doc(db, 'pools', poolId, 'members', user.uid);
  const snap = await getDoc(ref);
  const name = myName();
  if (!snap.exists()) {
    const rec = { name, photo: user.photoURL || null, joinedAt: serverTimestamp() };
    // Required by the rule when CREATING a membership; omitted on rename.
    if (code) rec.code = String(code).trim().toUpperCase();
    await setDoc(ref, rec);
  } else if (name !== 'Player' && snap.data().name !== name) {
    // Heal the "Player" rows already written by the bug above, and pick up
    // a rename, without touching joinedAt.
    await setDoc(ref, { name }, { merge: true });
  }
}

/* ============================================================
   JOINING A POOL
   ============================================================ */
/* Codes resolve through /joinCodes/{code}, a one-field lookup document,
   rather than by querying the pools collection.

   The old query needed every pool to be readable by anyone signed in,
   which meant anyone signed in could also LIST them — reading every
   pool's join code and owner, then writing themselves in as a member.
   See the JOIN CODES block in firestore.rules. */
async function joinPool(code) {
  const clean = code.trim().toUpperCase();
  const look = await getDoc(doc(db, 'joinCodes', clean));
  if (!look.exists()) throw new Error('That code does not match a pool.');

  poolId = look.data().poolId;
  if (!poolId) throw new Error('That code does not match a pool.');
  localStorage.setItem('ps_pool', poolId);

  // The code is carried on the membership document: the rule requires it
  // to create one, which is what makes a code mean something.
  await ensureMember(clean);
  return await getPool();
}

async function getPool() {
  if (!poolId) return null;
  const snap = await getDoc(doc(db, 'pools', poolId));
  return snap.exists() ? { id: poolId, ...snap.data() } : null;
}

async function getMembers() {
  const res = await getDocs(collection(db, 'pools', poolId, 'members'));
  return res.docs.map(d => ({ uid: d.id, ...d.data() }));
}

/* Live roster. getMembers() is a one-time read, called once from
   loadSeason() at boot — so PLAYERS was frozen to whoever had already
   joined at the moment YOUR page loaded. Anyone who signed up after that
   — the exact moment a pool owner is watching for, right before kickoff
   — never appeared in Standings or the Grid for anyone already in the
   app, on any device, until they manually reloaded. A brand-new member's
   own device was fine (their own boot() ran after they joined), which is
   what made this easy to miss testing alone. */
function watchMembers(cb) {
  return onSnapshot(collection(db, 'pools', poolId, 'members'),
    snap => cb(snap.docs.map(d => ({ uid: d.id, ...d.data() }))),
    err => console.warn('watchMembers', err));
}

/* ============================================================
   SEASON HANDOVER

   Two things break when you move people from one pool to the next, and
   neither throws an error — they just quietly stop working.
   ============================================================ */

/* 1. A stale pool id in localStorage.
   Somebody who never taps the new invite link still points at the old
   pool. Once that pool is deleted every read fails and they see an empty
   app with no explanation. Check on launch and clear it. */
async function ensureCurrentPool() {
  if (!poolId) return null;
  let snap;
  try {
    snap = await getDoc(doc(db, 'pools', poolId));
  } catch (e) {
    const code = (e && e.code) || '';
    /* ONLY an identity failure clears the pool.

       Clearing on ANY thrown read was badly wrong: with no offline
       persistence configured, a getDoc on a dead connection rejects with
       'unavailable' — so opening the app in a tunnel, on airplane mode or
       on stadium wifi DELETED the stored pool id and dropped a
       signed-in player onto the full sign-up screen asking for their name
       and email. They would reasonably conclude their account was gone.

       A permission denial or a missing document really does mean "not
       your pool" and is worth clearing for. A network failure means
       "ask again later" and must leave everything intact. */
    if (/permission|not-found/i.test(code)) {
      console.warn('pool not readable, clearing', code);
      localStorage.removeItem('ps_pool');
      poolId = null;
      return null;
    }
    console.warn('pool read failed, keeping the pool (offline?)', code || e);
    return { id: poolId, offline: true };
  }
  if (!snap.exists() || snap.data().season !== SEASON) {
    localStorage.removeItem('ps_pool');
    poolId = null;
    return null;               // caller shows the join screen
  }
  return { id: poolId, ...snap.data() };
}

/* 2. Push tokens live on the roster, which is per pool.
   Join a new pool and your token is not there, so you get no
   notifications and nothing tells you. Anyone who already granted
   permission has onboarding skipped, so this must run on launch. */
async function refreshPushToken() {
  if (!user || !poolId) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    const { getMessaging, getToken, isSupported } = await fcm();
    if (!(await isSupported())) return;
    const reg = await swReady();
    if (!reg) return null;   // no worker = no push; never hang waiting for one
    const token = await getToken(getMessaging(app),
      { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
    await upsertRoster();
    await updateDoc(doc(db, 'pools', poolId, 'private', 'roster'),
                    { [`${user.uid}.tokens`]: arrayUnion(token) });
  } catch (e) {
    console.warn('token refresh failed', e);
  }
}

/* ============================================================
   SCHEDULE
   ============================================================ */
/* One game document -> the shape the app uses, or null if it is not a
   usable game.

   `kickoff.toMillis()` assumed every document has a kickoff Timestamp. A
   scoring job that writes by a reconstructed document id can CREATE a
   partial game document holding only scores — no kickoff, no wk — and one
   of those threw here, inside loadSeason(), which is not wrapped in
   optional(). One malformed document therefore took down the entire app
   for every player with "We couldn't load your week." Drop the bad row
   instead; a missing game is visibly wrong, a dead app is unusable. */
function toGame(d) {
  const v = d.data();
  if (!v || !v.kickoff || typeof v.kickoff.toMillis !== 'function') {
    console.warn('skipping malformed game doc', d.id);
    return null;
  }
  return { id: d.id, ...v, kick: v.kickoff.toMillis() };
}

async function getWeek(wk) {
  const q = query(collection(db, 'seasons', SEASON, 'games'), where('wk', '==', wk));
  const res = await getDocs(q);
  return res.docs.map(toGame).filter(Boolean).sort((a, b) => a.kick - b.kick);
}

/* Live score updates while games are running. Returns an unsubscribe fn.
   `wk` is handed back to the callback so a listener left over from another
   week cannot write its games into the week now on screen. */
function watchWeek(wk, cb) {
  const q = query(collection(db, 'seasons', SEASON, 'games'), where('wk', '==', wk));
  return onSnapshot(q, snap => {
    cb(snap.docs.map(toGame).filter(Boolean).sort((a, b) => a.kick - b.kick), wk);
  }, err => console.warn('watchWeek', err));
}

/* ============================================================
   PICKS

   Doc id is `${uid}_${gameId}` so a person can only ever hold one
   pick per game, and the rules can check ownership from the id.

   revealAt is a copy of the game's kickoff. The security rule forces
   it to match, and the read rule uses it so other people's picks
   stay invisible until the whistle. See firestore.rules.
   ============================================================ */
/* `picks` is {gameId: {winner, weight}}. A gameId mapped to null means
   "this pick was cleared" — see the tombstone note below.

   THIS USED TO BE ONE ATOMIC BATCH OF THE WHOLE WEEK, which failed in two
   ways that both ended with the user being told "Saved":

   1. Firestore batches are all-or-nothing. The client skips a game it
      thinks has kicked off using the DEVICE clock, while the rule uses
      `request.time`. A phone even a minute slow re-sent the 1:00 games at
      1:00:30, the rule denied those, and the WHOLE batch was rejected —
      including the eleven perfectly legal picks in it. Nothing was
      written and the caller printed "Saved".
   2. The rules cost several document-access calls per pick (a members
      lookup plus the game lookup, twice). Firestore caps a batched write
      at 20 access calls for the entire request, so past a handful of
      picks in one batch the commit was refused outright — which is to
      say a full 16-game week could not be saved at all.

   Written individually, each write gets its own rule budget and one
   rejection can no longer take down the others. The caller is told
   exactly what failed instead of a cheerful green "Saved". */
async function savePicks(wk, picks, games) {
  if (!user || !poolId) throw new Error('Not signed in.');
  const byId = Object.fromEntries(games.map(g => [g.id, g]));
  const jobs = [];
  const locked = [];

  for (const [gameId, p] of Object.entries(picks)) {
    const g = byId[gameId];
    if (!g) continue;
    // Locked games are skipped, but REMEMBERED — see the check after the
    // loop. Silently dropping them meant a write with nothing left in it
    // resolved clean and the caller printed "Saved" for zero writes.
    if (Date.now() >= g.kick) { locked.push(gameId); continue; }
    /* Clearing a pick writes a TOMBSTONE rather than deleting the doc.
       `allow delete: if false` in the rules means a removed pick could
       never actually leave the database: the UI showed the game as
       unpicked, said "Saved", and the scorer went on counting the old
       pick all season. A null winner is a pick that is not there. */
    const cleared = !p || p.winner == null;
    jobs.push({
      gameId,
      p: setDoc(doc(db, 'pools', poolId, 'picks', `${user.uid}_${gameId}`), {
        uid: user.uid,
        gameId, wk,
        winner: cleared ? null : p.winner,
        weight: cleared ? null : (p.weight ?? null),
        revealAt: g.kickoff,                      // must equal game kickoff
        updatedAt: serverTimestamp()
      })
    });
  }

  /* Every pick in this request was already locked, so nothing was
     written. `Promise.allSettled([])` resolves clean, which is how a tap
     landing a second after kickoff got a green "Saved" for a write that
     never happened — the card even printed the rank it had not saved. */
  if (!jobs.length && locked.length) {
    const err = new Error(locked.length === 1
      ? 'That game has kicked off. The pick is final.'
      : 'Those games have kicked off. Those picks are final.');
    err.failed = locked.map(gameId => ({ gameId, reason: 'locked' }));
    throw err;
  }

  const settled = await Promise.allSettled(jobs.map(j => j.p));
  const failed = settled
    .map((r, i) => (r.status === 'rejected' ? { gameId: jobs[i].gameId, reason: r.reason } : null))
    .filter(Boolean);

  if (failed.length) {
    console.warn('savePicks: rejected', failed);
    const err = new Error(failed.length === jobs.length
      ? "Your picks didn't save."
      : `${failed.length} of ${jobs.length} picks didn't save.`);
    err.failed = failed;
    throw err;                                    // the caller MUST surface this
  }
}

/* My own picks for a week. */
async function myPicks(wk) {
  const q = query(
    collection(db, 'pools', poolId, 'picks'),
    where('uid', '==', user.uid), where('wk', '==', wk));
  const res = await getDocs(q);
  const out = {};
  res.docs.forEach(d => {
    const v = d.data();
    if (v.winner == null) return;      // tombstone: a pick that was cleared
    out[v.gameId] = { winner: v.winner, weight: v.weight };
  });
  return out;
}

/* Everyone's revealed picks — the Grid.
   The revealAt filter is not optional: the security rule only permits
   the query because of it. Drop the filter and the read is denied. */
/* Live reveals for ONE week. Small pools only — this reads every revealed
   pick rather than a snapshot document.

   Three separate bugs lived in the four lines this replaces:

   1. It emitted raw pick documents — {uid, gameId, winner, weight, …} —
      with no `name`, while the consumer indexed the rows by `name`. Every
      row was silently dropped, so the Grid never filled in during games;
      it only ever updated on a manual week switch, which goes through
      getRevealed(), which does join names.
   2. `Timestamp.now()` was evaluated once, when the query object was
      built, and onSnapshot re-runs THAT query forever. Picks that revealed
      after the page loaded could therefore never match, so even with (1)
      fixed the listener could only show what was already revealed at load.
      The caller re-subscribes as kickoffs pass; the bound is also nudged
      back so a slightly fast device clock cannot ask for picks the server
      has not revealed yet (a rules denial kills the WHOLE query, not just
      the offending row).
   3. `wk` was captured at subscribe time but the callback wrote into
      whatever week was on screen when it fired. That is handled by passing
      `wk` back to the caller here. */
function watchRevealed(wk, cb) {
  const bound = Timestamp.fromMillis(Date.now() - CLOCK_SKEW_MS);
  const q = query(
    collection(db, 'pools', poolId, 'picks'),
    where('wk', '==', wk),
    where('revealAt', '<=', bound));

  let names = {};
  getMembers()
    .then(ms => { names = Object.fromEntries(ms.map(m => [m.uid, m.name])); })
    .catch(() => {});

  return onSnapshot(q, snap => {
    const rows = snap.docs
      .map(d => d.data())
      .filter(v => v.winner != null)     // skip cleared picks (tombstones)
      .map(v => ({ ...v, name: names[v.uid] || 'Player' }));
    cb(rows, wk);
  }, err => console.warn('watchRevealed', err));
}

/* Sign in with a token minted by the auth Worker. */
async function signInWithToken(token) {
  const cred = await signInWithCustomToken(auth, token);
  user = cred.user;
  return user;
}

/* The whole season in one read, so the week strip and the countdown to
   the next kickoff work without a query per week. */
async function getAllWeeks() {
  const res = await getDocs(collection(db, 'seasons', SEASON, 'games'));
  const byWeek = {};
  res.docs.forEach(d => {
    const g = { id: d.id, ...d.data() };
    (byWeek[g.wk] ||= []).push(g);
  });
  // kickoff is a Firestore Timestamp, and Timestamp - Timestamp is NaN, so
  // this "sort" was silently a no-op and the games came back in whatever
  // order Firestore returned them. Every caller happens to re-sort, which
  // is the only reason it never showed — but a function that says it sorts
  // should sort.
  const ms = t => t && typeof t.toMillis === 'function' ? t.toMillis()
                : t instanceof Date ? t.getTime() : (+t || 0);
  return Object.keys(byWeek).map(Number).sort((a, b) => a - b)
    .map(wk => ({ wk, games: byWeek[wk].sort((a, b) => ms(a.kickoff) - ms(b.kickoff)) }));
}

/* Everyone's picks for games that have already kicked off.
   The revealAt filter is what makes the read legal — see firestore.rules. */
async function getRevealed(wk) {
  const q = query(collection(db, 'pools', poolId, 'picks'),
    where('wk', '==', wk),
    // See CLOCK_SKEW_MS: a fast device clock asking for not-yet-revealed
    // picks gets the entire query denied, not just those rows.
    where('revealAt', '<=', Timestamp.fromMillis(Date.now() - CLOCK_SKEW_MS)));
  const [res, members] = await Promise.all([getDocs(q), getMembers()]);
  const name = Object.fromEntries(members.map(m => [m.uid, m.name]));
  return res.docs
    .map(d => d.data())
    .filter(v => v.winner != null)       // skip cleared picks (tombstones)
    .map(v => ({ ...v, name: name[v.uid] || 'Player' }));
}

async function getTiebreaks(wk) {
  const q = query(collection(db, 'pools', poolId, 'tiebreaks'),
    where('wk', '==', wk),
    where('revealAt', '<=', Timestamp.fromMillis(Date.now() - CLOCK_SKEW_MS)));
  const [res, members] = await Promise.all([getDocs(q), getMembers()]);
  const name = Object.fromEntries(members.map(m => [m.uid, m.name]));
  const rows = res.docs.map(d => {
    const v = d.data();
    return { ...v, name: name[v.uid] || 'Player', mine: v.uid === user?.uid };
  });
  /* Your own guess is visible before kickoff; the query above will not
     return it, so fetch it directly — inside its own try.

     When you have NOT entered a guess this document does not exist, and
     the read rule dereferences `resource.data.uid` on a null resource,
     which rules treat as an evaluation error and refuse. Unguarded, that
     rejection took the whole function down, `optional()` turned it into
     `[]`, and the tiebreak panel was empty for EVERYONE until they had
     personally submitted a guess — including on every past week they
     never entered one. */
  try {
    const own = await getDoc(doc(db, 'pools', poolId, 'tiebreaks', `${user.uid}_${wk}`));
    if (own.exists() && !rows.some(r => r.mine)) {
      rows.push({ ...own.data(), name: 'You', mine: true });
    }
  } catch { /* no guess of your own yet — not an error */ }
  return rows;
}

async function saveTiebreak(wk, total, game) {
  if (!user || !poolId || total == null || !game) return;
  await setDoc(doc(db, 'pools', poolId, 'tiebreaks', `${user.uid}_${wk}`), {
    uid: user.uid, wk, gameId: game.id, total: Number(total),
    revealAt: game.kickoff, updatedAt: serverTimestamp()
  });
}

/* The archive doc, if one is readable. The security rule decides:
   state 'off' denies the read, so this returns null and the tab is gone. */
async function getArchive() {
  try {
    /* Filter on the field the rule keys off, rather than listing the whole
       collection. A list is refused unless the rule permits EVERY document
       it could return, so as soon as a second archive existed in state
       'off' the unfiltered list was denied — and the archive tab vanished
       for everyone, including the archive that was still public. */
    const pub = await getDocs(query(collection(db, 'pools', poolId, 'archive'),
                                    where('state', '==', 'public')));
    if (!pub.empty) return { id: pub.docs[0].id, ...pub.docs[0].data() };

    // Owner-visible archives, if this person is the owner.
    const own = await getDocs(query(collection(db, 'pools', poolId, 'archive'),
                                    where('state', '==', 'owner')));
    if (!own.empty) return { id: own.docs[0].id, ...own.docs[0].data() };
    return null;
  } catch {
    return null;                 // denied = hidden, which is the point
  }
}

/* ============================================================
   SNAPSHOTS — what the Grid actually reads

   Never query the picks collection for other people. build_snapshot.py
   has already filtered to revealed games and precomputed scoring, so
   the default Grid view is two reads no matter how many players exist.
   ============================================================ */
async function getBoard(wk) {
  const s = await getDoc(doc(db, 'pools', poolId, 'snapshots', `w${wk}_board`));
  return s.exists() ? s.data() : null;      // standings + top 25 pick rows
}

/* Live-updating board — use this on the Grid tab during games. */
function watchBoard(wk, cb) {
  return onSnapshot(doc(db, 'pools', poolId, 'snapshots', `w${wk}_board`),
                    s => cb(s.exists() ? s.data() : null));
}

/* Your own row, plus anyone else outside the top 25. One extra read. */
async function getShard(wk, uid = null) {
  const target = uid || user.uid;
  const idx = await getDoc(doc(db, 'pools', poolId, 'snapshots', `w${wk}_index`));
  if (!idx.exists()) return null;
  const k = (idx.data().of || {})[target];
  if (k === undefined) return null;
  const s = await getDoc(doc(db, 'pools', poolId, 'snapshots', `w${wk}_s${k}`));
  return s.exists() ? (s.data().rows || {})[target] : null;
}

/* ============================================================
   ROSTER

   One document holding name, timezone and device tokens for everyone.
   Each member may only write their own key — the security rule pins it
   with affectedKeys().hasOnly([uid]). Written blind: updateDoc needs no
   read, and no read is granted.

   This is what lets remind.py do one read instead of one per member.
   ============================================================ */
async function upsertRoster(extra = {}) {
  if (!user || !poolId) return;
  const ref = doc(db, 'pools', poolId, 'private', 'roster');

  const entry = { name: myName(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone };
  /* Spreading `extra` blindly copied keys whose value was `undefined`,
     which the SDK rejects outright ("Unsupported field value: undefined")
     — so one caller passing {name: undefined} made the whole write throw
     and the person ended up with no roster entry, meaning no reminders. */
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) entry[k] = v;

  /* WRITE EACH LEAF ON ITS OWN DOTTED PATH.

     `updateDoc(ref, { [uid]: entry })` REPLACES the whole map at `uid` —
     nested merging only happens with dotted paths. `entry` never contains
     `tokens`, so every call silently deleted that person's push tokens,
     and `prefs` with them. It ran on every launch (watchAuth) and on every
     settings toggle, so: a second device wiped the first device's token,
     toggling any alert switch wiped all of them, and signing in anywhere
     with notifications not granted left the person with zero tokens and
     nothing on screen to say alerts had stopped. That is the whole
     "notifications never arrive" story, and it undid itself again after
     every fix further down the chain.

     `affectedKeys()` still resolves a dotted path to its top-level key, so
     `private/roster`'s one-key-only rule is unaffected. */
  const patch = {};
  for (const [k, v] of Object.entries(entry)) patch[`${user.uid}.${k}`] = v;

  try {
    await updateDoc(ref, patch);
  } catch {
    // First writer creates it. Admin-created at pool setup normally.
    // setDoc+merge does merge nested maps, so this path was always safe.
    await setDoc(ref, { [user.uid]: entry }, { merge: true });
  }
}

/* ============================================================
   STANDINGS + SCORING MODE
   ============================================================ */
async function getStandings() {
  const res = await getDocs(collection(db, 'pools', poolId, 'standings'));
  return res.docs.map(d => ({ uid: d.id, ...d.data() }));
}

/* Mode is stored as a history so past weeks stay reproducible.

   IT LIVES ON THE POOL DOCUMENT, as `scoringHistory`. This used to read
   `pools/{id}/config/scoring.history` — a document nothing has ever
   written. setup_season.py writes `scoringHistory` on the pool doc and
   score_week.py and build_snapshot.py both read it there; only the client
   looked somewhere else, so the read always missed and fell through to
   'straight'.

   The consequence was not subtle: the confidence tray, the stake bars and
   every ranked point silently disappeared for every player, while the
   server scored the season in confidence and the Help tab went on
   explaining the 136-point week. Client and scorer now read one field. */
async function getScoringMode(wk) {
  const pool = await getPool();
  const hist = (pool && pool.scoringHistory) || [];
  // Match score_week.py exactly: default confidence, then replay history.
  let mode = 'confidence';
  [...hist].sort((a, b) => a.week - b.week).forEach(h => { if (h.week <= wk) mode = h.mode; });
  return mode;
}

/* Owner only — the pool document's update rule enforces that.
   Takes effect at the next week boundary, never mid-week. */
async function setScoringMode(mode, fromWeek) {
  const pool = await getPool();
  const hist = (pool && pool.scoringHistory) || [];
  const next = hist.filter(h => h.week !== fromWeek).concat([{ week: fromWeek, mode }]);
  await setDoc(doc(db, 'pools', poolId), { scoringHistory: next }, { merge: true });
}

/* ============================================================
   PUSH NOTIFICATIONS
   ============================================================ */
async function enablePush() {
  const { getMessaging, getToken, isSupported } = await fcm();
  if (!(await isSupported())) throw new Error('This browser cannot do push.');

  const standalone = window.matchMedia('(display-mode: standalone)').matches
                     || window.navigator.standalone === true;
  const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  if (iOS && !standalone) {
    throw new Error('On iPhone, add the app to your Home Screen first, then turn on alerts from there.');
  }

  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Alerts were declined.');

  /* This must THROW rather than return quietly: the caller turns the
     result into "Done" on screen, so a silent null would tell someone
     their alerts are on when nothing was ever registered. */
  const reg = await swReady();
  if (!reg) throw new Error("This browser couldn't start the background worker that receives alerts. Try a normal (not private) window.");

  const messaging = getMessaging(app);
  const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
  if (!token) throw new Error("Alerts couldn't be registered. Try again in a moment.");

  // A person may have a phone and a laptop, so tokens are a list.
  // We cannot read the roster to merge — the rule forbids it — so append
  // with arrayUnion. The dotted path still resolves to the uid key, which
  // is what affectedKeys() checks, so the write is permitted.
  await upsertRoster();                                   // make sure the key exists
  await updateDoc(doc(db, 'pools', poolId, 'private', 'roster'),
                  { [`${user.uid}.tokens`]: arrayUnion(token) });
  return token;
}

/* ============================================================
   SERVICE WORKER + UPDATE PROMPT

   This is what makes "I pushed a change" actually reach phones.
   Without the prompt, a new version sits in the waiting state until
   every window is closed — which on a home-screen app can be days.
   ============================================================ */
/* The callback lives OUTSIDE registerSW, and that is the whole fix.

   registerSW is called twice with no arguments — once from the module's
   own boot (so push works without waiting for the app) and once from
   enablePush. Both hit the `if (swRegistering) return` guard, so the
   FIRST call won the registration and any callback passed later was
   dropped on the floor. The default was a no-op, nothing else ever
   passed one, and therefore `onUpdateReady` was never called, the
   "Update now" prompt did not exist, and the SKIP_WAITING handler in
   sw.js was unreachable code.

   What that cost: a new service worker installed, parked in `waiting`,
   and stayed there until every window of the app was closed. On an
   iPhone home-screen install that means swiping the app out of the
   switcher — which nobody does — so a worker could be days or weeks
   stale. Page code still updated (it is network-first), so the deploy
   LOOKED like it worked while the worker itself, and everything it
   caches, stayed frozen.

   Now the callback is module state: whoever registers one gets it, in
   any order, and a worker already parked in `waiting` from a previous
   visit is reported immediately rather than waiting for an
   `updatefound` that already fired and will not fire again. */
let swUpdateCb = null;
let swReg = null;
const swAnnounce = () => {
  if (!swUpdateCb || !swReg || !swReg.waiting) return;
  if (!navigator.serviceWorker.controller) return;   // first install, not an update
  swUpdateCb(() => swReg.waiting && swReg.waiting.postMessage('SKIP_WAITING'));
};

function registerSW(onUpdateReady) {
  if (typeof onUpdateReady === 'function') {
    swUpdateCb = onUpdateReady;
    swAnnounce();                    // may already be waiting from last visit
  }
  if (!('serviceWorker' in navigator)) return;
  if (swRegistering) return swRegistering;

  swRegistering = navigator.serviceWorker.register('./sw.js').then(reg => {
    swReg = reg;
    // Check for a new version every time the app is opened or resumed.
    reg.update();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update();
    });

    /* An update downloaded during a PREVIOUS visit is already parked in
       `waiting` before this listener is attached — `updatefound` fired
       long ago and will not fire again. Without this check that update
       sits there unmentioned until every window is closed, which on a
       home-screen app can be days. */
    swAnnounce();

    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener('statechange', () => {
        // A new worker is ready AND an old one is running = real update.
        if (sw.state === 'installed' && navigator.serviceWorker.controller) {
          swAnnounce();
        }
      });
    });
    return reg;
  }).catch(e => {
    // Registration can fail on a bad certificate, a private window, or an
    // unsupported browser. Swallowing it silently used to mean push was
    // dead with nothing anywhere to say so.
    console.warn('service worker registration failed', e);
    return null;
  });
  return swRegistering;
}

/* The registration, or null, but NEVER a promise that hangs.

   `navigator.serviceWorker.ready` is specified to wait indefinitely for an
   active worker and never to reject. Three functions here await it, and
   `watchAuth` awaits one of those BEFORE calling back — so on any device
   with no registration, the sign-in callback never fired and the app sat
   on "Getting your week…" forever, with no error and no retry button.
   That is not a hypothetical: nothing in this app ever called
   registerSW(), so no service worker was ever registered, which is also
   why no push notification has ever been displayed — a push is only shown
   if a registered worker handles it.

   Registration now happens at module load (below), and every consumer
   goes through this, which resolves to null rather than hanging. */
async function swReady(ms = 8000) {
  if (!('serviceWorker' in navigator)) return null;
  registerSW();                                   // idempotent
  return Promise.race([
    navigator.serviceWorker.ready.catch(() => null),
    new Promise(r => setTimeout(() => r(null), ms))
  ]);
}

window.PS = {
  SEASON, auth, db, swReady,
  signIn, signOut: () => signOut(auth), watchAuth,
  joinPool, getPool, getMembers, watchMembers,
  getWeek, watchWeek,
  savePicks, myPicks, watchRevealed,
  getStandings, getScoringMode, setScoringMode,
  getBoard, watchBoard, getShard, upsertRoster,
  ensureCurrentPool, refreshPushToken, alertsHealthy,
  signInWithToken, getAllWeeks, getRevealed, getTiebreaks, saveTiebreak, getArchive,
  enablePush, registerSW,
  get user() { return user; },
  get poolId() { return poolId; }
};
