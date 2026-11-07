/* THE TRUE READ COUNT: the real index.html AND the real firebase-init.js,
   with only Google's Firebase libraries swapped for an in-memory fake that
   counts documents the way Firestore bills them.

   reads-audit.mjs counts what the app ASKS for, through the test stub. It
   cannot see what the data layer does underneath, and that is where the
   hidden cost was: getRevealed, watchRevealed and getTiebreaks each re-read
   the whole roster to look up names. This one sees everything, because the
   code being measured is the code that ships.

   Billing rules modelled (Firestore pricing): one read per document a query
   or listener returns, a minimum of one read for a query that returns
   nothing, one read per getDoc whether or not the document exists, and a
   listener's first snapshot billed like a query. Writes are not counted.

     node scripts/test/reads-true.mjs            27 players, week 9 live
     PLAYERS=50 node scripts/test/reads-true.mjs
     JSON=1 ...                                   machine-readable total

   Self-contained: serves the page itself, needs no app-serve.mjs. */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BASE = 'http://reads.test';
const H = 3600e3, D = 864e5;

/* ---------- the world: a 2026 season, week 9 live ---------- */
/* schedule: 'fresh' writes seasons/2026/meta/schedule the way
   scripts/schedule_doc.py does; 'stale' writes it as of before the live
   games kicked off (what worker/live.js leaves until the next scoring run);
   'none' leaves it out (a pool whose scripts have not run since v1.45.2). */
export function world(players = 27, now = Date.now(), schedule = 'fresh') {
  const sizes = [16, 16, 16, 16, 15, 14, 14, 14, 15, 14, 13, 16, 14, 15, 16, 16, 16, 16];
  const teams = ['BUF','MIA','NE','NYJ','BAL','CIN','CLE','PIT','HOU','IND','JAX','TEN','DEN','KC','LV','LAC',
                 'DAL','NYG','PHI','WSH','CHI','DET','GB','MIN','ATL','CAR','NO','TB','ARI','LAR','SF','SEA'];
  // Week 9's Sunday 1pm ET slate kicked off 40 minutes ago.
  const sun9 = now - 40 * 60e3;
  const docs = {};
  const put = (p, v) => { docs[p] = v; };
  const uids = Array.from({ length: players }, (_, i) => 'u_' + i);
  put('pools/P1', { name: "Weekly NFL Pick'em", season: '2026', ownerUid: 'u_0', joinCode: 'ABC123' });
  put('joinCodes/ABC123', { poolId: 'P1' });
  uids.forEach((u, i) => put(`pools/P1/members/${u}`, { name: i ? `Player ${i}` : 'Lee', photo: null, joinedAt: { __ts: now - 60 * D } }));
  const games = [];
  sizes.forEach((n, w) => {
    const wk = w + 1, sun = sun9 + (wk - 9) * 7 * D;
    for (let k = 0; k < n; k++) {
      const kick = k === 0 ? sun - 2.5 * D : k === n - 1 ? sun + 1.3 * D : k === n - 2 ? sun + 0.3 * D : sun + (k % 3) * 3 * H;
      const away = teams[(k * 2 + wk) % 32], home = teams[(k * 2 + 1 + wk) % 32];
      const id = `2026_W${wk}_${away}_${home}`;
      const done = kick + 3.5 * H < now, live = !done && kick <= now;
      const g = { wk, away, home, kickoff: { __ts: kick }, network: 'CBS', spread: `${home} -3`,
        status: done ? 'final' : live ? 'live' : 'scheduled' };
      if (done || live) { g.awayScore = 17 + (k % 5); g.homeScore = 20 + (k % 7); }
      if (done) g.winner = g.homeScore > g.awayScore ? home : away;
      put(`seasons/2026/games/${id}`, g); games.push({ id, ...g, kick });
    }
  });
  if (schedule !== 'none') {
    const rows = games.map(({ kick, ...g }) => {
      const r = { ...g };
      if (schedule === 'stale' && g.wk === 9 && g.status !== 'final') { r.status = 'scheduled'; delete r.awayScore; delete r.homeScore; }
      if (schedule === 'stale' && g.wk === 8) { r.status = 'scheduled'; delete r.awayScore; delete r.homeScore; delete r.winner; }
      return r;
    }).sort((a, b) => (a.wk - b.wk) || (a.kickoff.__ts - b.kickoff.__ts));
    /* 'broken': a document whose count disagrees with its list, which
       must never be trusted. */
    put('seasons/2026/meta/schedule', { games: rows, count: schedule === 'broken' ? rows.length + 5 : rows.length, builtAt: { __ts: now } });
  }
  for (const u of uids) {
    for (let wk = 1; wk <= 9; wk++) {
      const gs = games.filter(g => g.wk === wk);
      gs.forEach((g, k) => put(`pools/P1/picks/${u}_${g.id}`, { uid: u, gameId: g.id, wk,
        winner: (k + +u.slice(2)) % 2 ? g.home : g.away, weight: ((k + +u.slice(2)) % gs.length) + 1,
        revealAt: { __ts: g.kick }, updatedAt: { __ts: now - D } }));
      const last = gs[gs.length - 1];
      put(`pools/P1/tiebreaks/${u}_${wk}`, { uid: u, wk, gameId: last.id, total: 40 + (+u.slice(2) % 20), revealAt: { __ts: last.kick } });
    }
    const weeks = {}; for (let wk = 1; wk <= 8; wk++) weeks[wk] = { pts: 60 + (+u.slice(2) * 7 + wk) % 50, correct: 8 };
    put(`pools/P1/standings/${u}`, { pts: Object.values(weeks).reduce((s, w) => s + w.pts, 0), weeks });
  }
  return docs;
}

/* ---------- the fake Firebase, served in place of gstatic ---------- */
const FAKE_APP = `export const initializeApp = c => ({ options: c });`;
const FAKE_AUTH = `
const U = { uid: 'u_0', email: 'lee@test.invalid', displayName: 'Lee', photoURL: null };
/* Signed in from the start (Firebase restored the user from its own
   storage) unless the test says this device has no saved sign-in. Like
   the real SDK, listeners hear about a sign-in only when the uid changes. */
const auth = { currentUser: window.__persisted === false ? null : U };
const subs = [];
export const getAuth = () => auth;
export class GoogleAuthProvider {}
export const signInWithPopup = async () => ({ user: U });
export const signInWithRedirect = async () => {};
export const onAuthStateChanged = (a, cb) => { subs.push(cb); setTimeout(() => cb(auth.currentUser), 0); return () => {}; };
export const signOut = async () => { window.__signOuts = (window.__signOuts || 0) + 1; auth.currentUser = null; };
export const signInWithCustomToken = async () => { const was = auth.currentUser; auth.currentUser = U;
  if (!was) setTimeout(() => subs.forEach(f => f(U)), 0); return { user: U }; };`;
const FAKE_FS = `
const log = window.__reads = [];
const store = window.__store;
export class Timestamp {
  constructor(ms) { this._ms = ms; this.seconds = Math.floor(ms / 1000); this.nanoseconds = 0; }
  static fromMillis(ms) { return new Timestamp(ms); }
  static now() { return new Timestamp(Date.now()); }
  static fromDate(d) { return new Timestamp(d.getTime()); }
  toMillis() { return this._ms; } toDate() { return new Date(this._ms); } valueOf() { return this._ms; }
}
const thaw = v => v && typeof v === 'object' ? (v.__ts != null ? new Timestamp(v.__ts)
  : Array.isArray(v) ? v.map(thaw) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, thaw(x)]))) : v;
const ms = v => v && typeof v.toMillis === 'function' ? v.toMillis() : v;
export const initializeFirestore = () => ({});
export const getFirestore = () => ({});
export const doc = (db, ...p) => ({ t: 'doc', path: p.join('/'), id: p[p.length - 1] });
export const collection = (db, ...p) => ({ t: 'col', path: p.join('/') });
export const where = (f, op, v) => ({ f, op, v });
export const query = (c, ...w) => ({ t: 'col', path: c.path, w });
export const serverTimestamp = () => Timestamp.now();
export const arrayUnion = (...x) => ({ __union: x });
const snapOf = (path, data) => ({ id: path.split('/').pop(), ref: { path }, exists: () => data != null, data: () => data == null ? undefined : thaw(data) });
const ops = { '==': (a, b) => a === b, '<=': (a, b) => ms(a) <= ms(b), '<': (a, b) => ms(a) < ms(b), '>': (a, b) => ms(a) > ms(b), '>=': (a, b) => ms(a) >= ms(b) };
function run(q) {
  const depth = q.path.split('/').length + 1;
  const docs = Object.keys(store).filter(k => k.startsWith(q.path + '/') && k.split('/').length === depth)
    .filter(k => (q.w || []).every(c => ops[c.op](thaw(store[k][c.f]), c.v)))
    .map(k => snapOf(k, store[k]));
  return { docs, empty: !docs.length, size: docs.length, forEach: f => docs.forEach(f) };
}
const label = (q, kind) => kind + ' ' + q.path.replace(/P1\\//, '') + (q.w || []).map(c => ' ' + c.f + c.op + (c.v && c.v.toMillis ? 't' : c.v)).join('');
export async function getDoc(r) { log.push({ k: 'getDoc ' + r.path.replace(/P1\\//, '').replace(/u_\\w+/g, 'uid'), n: 1 }); return snapOf(r.path, store[r.path]); }
export async function getDocs(q) { const s = run(q); log.push({ k: label(q, 'getDocs'), n: Math.max(1, s.size) }); return s; }
const subs = [];
window.__fsWrite = (p, v) => { store[p] = v; subs.forEach(f => f()); };
export function onSnapshot(q, cb, err) {
  if ((window.__silent || []).some(x => q.path.endsWith(x))) return () => {};
  if (q.t !== 'doc') subs.push(() => cb(run(q)));
  setTimeout(() => {
    if (q.t === 'doc') { log.push({ k: 'listen ' + q.path, n: 1 }); cb(snapOf(q.path, store[q.path])); return; }
    const s = run(q); log.push({ k: label(q, 'listen'), n: Math.max(1, s.size) }); cb(s);
  }, 5);
  return () => {};
}
export async function setDoc(r, v) { store[r.path] = { ...(store[r.path] || {}), ...v }; }
export async function updateDoc(r, v) { store[r.path] = { ...(store[r.path] || {}), ...v }; }
export const writeBatch = () => { const o = []; return { set: (r, v) => o.push([r, v]), update: (r, v) => o.push([r, v]), commit: async () => o.forEach(([r, v]) => { store[r.path] = { ...(store[r.path] || {}), ...v }; }) }; };`;

/* files: { 'index.html': '/abs/path', 'firebase-init.js': '/abs/path' } swaps
   in another version of the app (the comparison against the old code).
   silent: listener paths that never answer (a stalled or denied query).
   screens: also return the text of Picks, Grid and Standings. */
export async function measure({ schedule = 'fresh', players = 27, wait = 7000, tabs = [], wrapSeen = true, files = {}, silent = [], screens = false, joinLater = null, local = {}, session = 'ok', sessionDelay = 0, reload = false, persisted = true, reloadFiles = null } = {}) {
  let served = files;
  const store = world(players, Date.now(), schedule);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await ctx.addInitScript(([s, seen, sil, loc, pers]) => {
    window.__store = s; window.__silent = sil; window.__persisted = pers;
    /* What a player could SEE, sampled every 50 ms from the first paint:
       when the sign-up wizard was up, and when the app was. */
    window.__seen = [];
    const t0 = Date.now();
    const look = () => { const ob = document.getElementById('ob'), bt = document.getElementById('boot');
      if (!ob) return;
      const v = (ob.classList.contains('hide') ? '' : 'ob') + (bt && !bt.classList.contains('hide') ? '+boot' : '');
      const last = window.__seen[window.__seen.length - 1];
      if (!last || last[1] !== v) window.__seen.push([Date.now() - t0, v]); };
    setInterval(look, 50); document.addEventListener('DOMContentLoaded', look);
    try { if (!sessionStorage.getItem('__seeded')) { sessionStorage.setItem('__seeded', '1');
      localStorage.setItem('ps_pool', 'P1'); localStorage.setItem('ps_name', 'Lee'); localStorage.setItem('ps_onboarded', '1');
      for (const [k, v] of Object.entries(loc)) v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); }
      /* A normal open: last week's Weekly Wrap already seen. The first
         open after a week ends also preloads that Wrap, once. */
      if (seen) for (let w = 1; w <= 18; w++) localStorage.setItem('ps_wrap_P1_2026_w' + w, '1'); } catch {}
  }, [store, wrapSeen, silent, local, persisted]);
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  const api = [];
  await page.route('**/*', r => {
    const u = r.request().url();
    const js = body => r.fulfill({ status: 200, contentType: 'text/javascript', body });
    if (u.includes('gstatic.com/firebasejs') && u.endsWith('firebase-app.js')) return js(FAKE_APP);
    if (u.includes('gstatic.com/firebasejs') && u.endsWith('firebase-auth.js')) return js(FAKE_AUTH);
    if (u.includes('gstatic.com/firebasejs') && u.endsWith('firebase-firestore.js')) return js(FAKE_FS);
    if (u.includes('gstatic.com/firebasejs')) return js('export {};');
    if (!u.startsWith(BASE)) return r.abort();
    const p = new URL(u).pathname;
    if (p.startsWith('/api/')) api.push(p);
    if (p === '/api/session') return (async () => { if (sessionDelay) await new Promise(f => setTimeout(f, sessionDelay));
      if (session !== 'ok') return r.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"no session"}' });
      return r.fulfill({ status: 200, contentType: 'application/json', body: '{"token":"t","uid":"u_0"}' }); })();
    if (p.startsWith('/api/')) return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    const rel = p === '/' ? 'index.html' : p.slice(1);
    const f = served[rel] || path.join(ROOT, rel);
    if (fs.existsSync(f) && fs.statSync(f).isFile())
      return r.fulfill({ status: 200, body: fs.readFileSync(f), contentType: f.endsWith('.js') ? 'text/javascript' : f.endsWith('.html') ? 'text/html' : undefined });
    return r.fulfill({ status: 404, body: '' });
  });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(wait);
  /* reload: the player pulls to refresh. Only the SECOND load is reported,
     with whatever the first one left in localStorage. */
  if (reload) { if (reloadFiles) served = reloadFiles; await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(wait); }
  for (const t of tabs) { await page.click(`.tab[data-tab="${t}"]`).catch(() => {}); await page.waitForTimeout(1500); }
  for (const [p, v] of (joinLater || [])) { await page.evaluate(([p, v]) => window.__fsWrite(p, v), [p, v]); await page.waitForTimeout(600); }
  const reads = await page.evaluate(() => (window.__reads || []).slice());
  /* The week strip as the app first drew it: which weeks it believes are
     finished. Built from the schedule alone, before any week is opened
     (opening one re-reads it live and would hide a bad schedule). */
  const strip = await page.evaluate(() => [...document.querySelectorAll('#weeks .wk')].map(b => b.dataset.wk + (b.classList.contains('y') ? ':done' : '')).join(' '));
  /* What the data layer itself returns for this week, names included,
     without going through the app's own name table. */
  const layer = await page.evaluate(async () => { try { return (await PS.getRevealed(9)).map(r => [r.uid, r.name]); } catch (e) { return String(e); } });
  const txt = async t => { await page.click(`.tab[data-tab="${t}"]`).catch(() => {}); await page.waitForTimeout(700);
    return page.evaluate(v => (document.getElementById('v-' + v) || {}).innerText || '', t); };
  /* grid8: last week's Grid, a finished week the live listeners do not
     cover, so only the schedule read decides what it shows. */
  const grid8 = async () => { await page.click('.tab[data-tab="grid"]').catch(() => {});
    await page.evaluate(() => { const b = document.querySelector('.wk[data-wk="8"]'); if (b) b.click(); });
    await page.waitForTimeout(1500); const t = await page.evaluate(() => (document.getElementById('v-grid') || {}).innerText || '');
    await page.evaluate(() => { const b = document.querySelector('.wk[data-wk="9"]'); if (b) b.click(); }); await page.waitForTimeout(800); return t; };
  const scr = screens ? { picks: await txt('picks'), grid: await txt('grid'), standings: await txt('standings'), grid8: await grid8() } : null;
  const out = await page.evaluate(() => ({ cards: document.querySelectorAll('#slate .card').length,
    grid: document.querySelectorAll('#gridBody tbody tr').length }));
  out.seen = await page.evaluate(() => window.__seen.slice());
  out.api = api.slice();
  out.auth = await page.evaluate(() => ({ signOuts: window.__signOuts || 0, uid: (window.PS && PS.user && PS.user.uid) || null }));
  out.ls = await page.evaluate(() => Object.fromEntries(['ps_onboarded', 'ps_pool', 'ps_name'].map(k => [k, localStorage.getItem(k)])));
  out.obText = await page.evaluate(() => { const o = document.getElementById('ob'); return o && !o.classList.contains('hide') ? o.innerText : ''; });
  out.log = reads; out.screens = scr; out.layer = layer; out.strip = strip;
  await browser.close();
  return { ...out, errors };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const players = +(process.env.PLAYERS || 27);
  const r = await measure({ players, tabs: (process.env.TABS || '').split(',').filter(Boolean), wrapSeen: !process.env.FIRST });
  const by = {};
  for (const e of r.log) { (by[e.k] ||= { calls: 0, n: 0 }); by[e.k].calls++; by[e.k].n += e.n; }
  const total = r.log.reduce((s, e) => s + e.n, 0);
  if (process.env.JSON) { console.log(JSON.stringify({ players, total, by })); process.exit(0); }
  console.log(`\n${process.env.FIRST ? 'First open after a week ends (Weekly Wrap preloads)' : 'A normal app open'}, ${players} players, week 9 live (real data layer, fake Firestore)\n`);
  console.log('  reads  calls  what');
  for (const [k, v] of Object.entries(by).sort((a, b) => b[1].n - a[1].n))
    console.log(`  ${String(v.n).padStart(5)}  ${String(v.calls).padStart(5)}  ${k}`);
  console.log(`\n  ${total} documents read on open   (screen: ${r.cards} cards${r.errors.length ? ', ERRORS: ' + r.errors[0] : ''})`);
}
