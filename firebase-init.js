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
import {
  getMessaging, getToken, isSupported
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js';
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

const SEASON = "2026PRE";

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

let user = null;
let poolId = localStorage.getItem('ps_pool') || null;

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
    if (u) {
      const pool = await ensureCurrentPool();   // clears a stale pool id
      if (pool) {
        await ensureMember();
        await upsertRoster();                   // name + timezone
        await refreshPushToken();               // re-arm alerts for THIS pool
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
    const reg = await navigator.serviceWorker.ready;
    const token = await getToken(getMessaging(app),
      { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
    return token ? { ok: true } : { ok: false, reason: 'no-token' };
  } catch {
    return { ok: false, reason: 'no-token' };
  }
}

async function ensureMember() {
  const ref = doc(db, 'pools', poolId, 'members', user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      name: user.displayName || (user.email ? user.email.split('@')[0] : (document.getElementById('obMailIn')?.value || 'Player').split('@')[0]),
      photo: user.photoURL || null,
      joinedAt: serverTimestamp()
    });
  }
}

/* ============================================================
   JOINING A POOL
   ============================================================ */
async function joinPool(code) {
  const clean = code.trim().toUpperCase();
  const q = query(collection(db, 'pools'), where('joinCode', '==', clean));
  const res = await getDocs(q);
  if (res.empty) throw new Error('That code does not match a pool.');
  poolId = res.docs[0].id;
  localStorage.setItem('ps_pool', poolId);
  await ensureMember();
  return { id: poolId, ...res.docs[0].data() };
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
  const snap = await getDoc(doc(db, 'pools', poolId));
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
    if (!(await isSupported())) return;
    const reg = await navigator.serviceWorker.ready;
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
async function getWeek(wk) {
  const q = query(collection(db, 'seasons', SEASON, 'games'), where('wk', '==', wk));
  const res = await getDocs(q);
  return res.docs
    .map(d => ({ id: d.id, ...d.data(), kick: d.data().kickoff.toMillis() }))
    .sort((a, b) => a.kick - b.kick);
}

/* Live score updates while games are running. Returns an unsubscribe fn. */
function watchWeek(wk, cb) {
  const q = query(collection(db, 'seasons', SEASON, 'games'), where('wk', '==', wk));
  return onSnapshot(q, snap => {
    cb(snap.docs
      .map(d => ({ id: d.id, ...d.data(), kick: d.data().kickoff.toMillis() }))
      .sort((a, b) => a.kick - b.kick));
  });
}

/* ============================================================
   PICKS

   Doc id is `${uid}_${gameId}` so a person can only ever hold one
   pick per game, and the rules can check ownership from the id.

   revealAt is a copy of the game's kickoff. The security rule forces
   it to match, and the read rule uses it so other people's picks
   stay invisible until the whistle. See firestore.rules.
   ============================================================ */
async function savePicks(wk, picks, games) {
  if (!user || !poolId) throw new Error('Not signed in.');
  const batch = writeBatch(db);
  const byId = Object.fromEntries(games.map(g => [g.id, g]));

  for (const [gameId, p] of Object.entries(picks)) {
    const g = byId[gameId];
    if (!g) continue;
    if (Date.now() >= g.kick) continue;          // client-side courtesy
    batch.set(doc(db, 'pools', poolId, 'picks', `${user.uid}_${gameId}`), {
      uid: user.uid,
      gameId, wk,
      winner: p.winner,
      weight: p.weight ?? null,
      revealAt: g.kickoff,                        // must equal game kickoff
      updatedAt: serverTimestamp()
    });
  }
  await batch.commit();                           // rules reject any late write
}

/* My own picks for a week. */
async function myPicks(wk) {
  const q = query(
    collection(db, 'pools', poolId, 'picks'),
    where('uid', '==', user.uid), where('wk', '==', wk));
  const res = await getDocs(q);
  const out = {};
  res.docs.forEach(d => { const v = d.data(); out[v.gameId] = { winner: v.winner, weight: v.weight }; });
  return out;
}

/* Everyone's revealed picks — the Grid.
   The revealAt filter is not optional: the security rule only permits
   the query because of it. Drop the filter and the read is denied. */
function watchRevealed(wk, cb) {   // legacy: small pools only, do not use at scale
  const q = query(
    collection(db, 'pools', poolId, 'picks'),
    where('wk', '==', wk),
    where('revealAt', '<=', Timestamp.now()));
  return onSnapshot(q, snap => cb(snap.docs.map(d => d.data())));
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
  return Object.keys(byWeek).map(Number).sort((a, b) => a - b)
    .map(wk => ({ wk, games: byWeek[wk].sort((a, b) => a.kickoff - b.kickoff) }));
}

/* Everyone's picks for games that have already kicked off.
   The revealAt filter is what makes the read legal — see firestore.rules. */
async function getRevealed(wk) {
  const q = query(collection(db, 'pools', poolId, 'picks'),
    where('wk', '==', wk), where('revealAt', '<=', Timestamp.now()));
  const [res, members] = await Promise.all([getDocs(q), getMembers()]);
  const name = Object.fromEntries(members.map(m => [m.uid, m.name]));
  return res.docs.map(d => {
    const v = d.data();
    return { ...v, name: name[v.uid] || 'Player' };
  });
}

async function getTiebreaks(wk) {
  const q = query(collection(db, 'pools', poolId, 'tiebreaks'),
    where('wk', '==', wk), where('revealAt', '<=', Timestamp.now()));
  const [res, members] = await Promise.all([getDocs(q), getMembers()]);
  const name = Object.fromEntries(members.map(m => [m.uid, m.name]));
  const rows = res.docs.map(d => {
    const v = d.data();
    return { ...v, name: name[v.uid] || 'Player', mine: v.uid === user?.uid };
  });
  // Your own guess is visible before kickoff; the query above will not
  // return it, so fetch it directly.
  const own = await getDoc(doc(db, 'pools', poolId, 'tiebreaks', `${user.uid}_${wk}`));
  if (own.exists() && !rows.some(r => r.mine)) {
    rows.push({ ...own.data(), name: 'You', mine: true });
  }
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
    const res = await getDocs(collection(db, 'pools', poolId, 'archive'));
    if (res.empty) return null;
    return { id: res.docs[0].id, ...res.docs[0].data() };
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
  const entry = {
    name: user.displayName || user.email.split('@')[0],
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    ...extra
  };
  try {
    await updateDoc(ref, { [user.uid]: entry });
  } catch {
    // First writer creates it. Admin-created at pool setup normally.
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

/* Mode is stored as a history so past weeks stay reproducible. */
async function getScoringMode(wk) {
  const snap = await getDoc(doc(db, 'pools', poolId, 'config', 'scoring'));
  const hist = snap.exists() ? (snap.data().history || []) : [];
  let mode = 'straight';
  hist.sort((a, b) => a.week - b.week).forEach(h => { if (h.week <= wk) mode = h.mode; });
  return mode;
}

/* Owner only. Takes effect at the next week boundary, never mid-week. */
async function setScoringMode(mode, fromWeek) {
  const ref = doc(db, 'pools', poolId, 'config', 'scoring');
  const snap = await getDoc(ref);
  const hist = snap.exists() ? (snap.data().history || []) : [];
  const next = hist.filter(h => h.week !== fromWeek).concat([{ week: fromWeek, mode }]);
  await setDoc(ref, { history: next }, { merge: true });
}

/* ============================================================
   PUSH NOTIFICATIONS
   ============================================================ */
async function enablePush() {
  if (!(await isSupported())) throw new Error('This browser cannot do push.');

  const standalone = window.matchMedia('(display-mode: standalone)').matches
                     || window.navigator.standalone === true;
  const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  if (iOS && !standalone) {
    throw new Error('On iPhone, add the app to your Home Screen first, then turn on alerts from there.');
  }

  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Alerts were declined.');

  const reg = await navigator.serviceWorker.ready;
  const messaging = getMessaging(app);
  const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });

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
function registerSW(onUpdateReady) {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.register('./sw.js').then(reg => {
    // Check for a new version every time the app is opened or resumed.
    reg.update();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update();
    });

    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener('statechange', () => {
        // A new worker is ready AND an old one is running = real update.
        if (sw.state === 'installed' && navigator.serviceWorker.controller) {
          onUpdateReady(() => {
            sw.postMessage('SKIP_WAITING');
          });
        }
      });
    });
  });

  // When the new worker takes control, reload once to pick up new code.
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
}

window.PS = {
  SEASON, auth, db,
  signIn, signOut: () => signOut(auth), watchAuth,
  joinPool, getPool, getMembers,
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
