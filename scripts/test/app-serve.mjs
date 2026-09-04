/* Serves the real index.html with a PS stub that returns data in the exact
   shape Firestore holds it (per scripts/import_schedule.py), so the app's
   own mapping layer is exercised rather than bypassed. */
import http from 'node:http';
import fs from 'node:fs';

const APP = '/root/work/pickem/index.html';
let plan = {};

const STUB = `
const P = window.__plan || {};
const log = [];
window.__ps = { log, calls: c => log.filter(x => x === c).length };
const boom = n => { if (P.fail && P.fail[n]) throw new Error('stub failure: ' + n); };
const slow = async n => { const d = (P.delay && P.delay[n]) || 0; if (d) await new Promise(r => setTimeout(r, d)); };
const call = async n => { log.push(n); await slow(n); boom(n); };

const TEAMS = ['KC','BAL','BUF','CIN','DAL','PHI','SF','DET','GB','MIN','NYJ','MIA',
               'LAC','DEN','SEA','ATL','NO','TB','HOU','IND','JAX','TEN','CLE','PIT',
               'LV','ARI','LAR','CHI','WSH','NYG','CAR','NE'];
const NETS = ['CBS','FOX','NBC','ESPN','AMZN','NFLN'];
const ts = ms => ({ toMillis: () => ms, seconds: Math.floor(ms/1000) });

// Season opens Thu 10 Sep 2026; each week a Thu night, a Sunday block, a Monday night.
const KICK1 = P.startISO ? Date.parse(P.startISO) : Date.parse('2026-09-10T00:20:00Z');
const WEEKMS = 7*24*3600*1000;
const WEEKS_N = P.weeks == null ? 18 : P.weeks;
const GAMES_PER = P.gamesPerWeek == null ? 16 : P.gamesPerWeek;

function buildGames(){
  const out = [];
  for (let w = 1; w <= WEEKS_N; w++) {
    const base = KICK1 + (w-1)*WEEKMS;
    for (let i = 0; i < GAMES_PER; i++) {
      let away = TEAMS[(w*7+i*2) % 32]; const home = TEAMS[(w*7+i*2+1) % 32];
      // An abbreviation the app's 32-entry table has never seen — a rename,
      // a relocation, or plain drift in what ESPN sends.
      if (P.badTeam && i === 0) away = 'ZZZ';
      let off;
      if (i === 0) off = 0;                                   // Thursday night
      else if (i === GAMES_PER-1) off = 4*24*3600*1000 + 15000000; // Monday night
      else if (i < GAMES_PER-4) off = 3*24*3600*1000 + 61200000;   // Sun 1pm ET
      else off = 3*24*3600*1000 + 73800000;                        // Sun late
      const kickoff = base + off;
      const done = kickoff + 200*60000 < Date.now();   // matches the app's isFinal
      out.push({
        id: '2026_W'+w+'_'+away+'_'+home, wk: w, away, home,
        kickoff: ts(kickoff),
        network: NETS[(w+i) % NETS.length],
        spread: (w+i) % 5 === 0 ? '' : (home + ' -' + (((w+i)%13)/2 + 1).toFixed(1)),
        status: done ? 'final' : 'scheduled',
        awayScore: done ? 10 + ((w*i*7) % 25) : null,
        homeScore: done ? 13 + ((w*i*5) % 22) : null,
        winner: done ? (((w+i) % 2) ? home : away) : null,
      });
    }
  }
  return out;
}
const GAMES = buildGames();
const NAMES = ['Monse','Dad','Uncle Ray','Coach K','Sam','Priya','Marcus','Jo','Tay','Ali',
  'Rob','Kim','Nate','Ines','Gus','Val','Otis','Rae','Dex','Mira','Cy','Wren','Bo','Ivy','Zed',
  'Hal','Fern','Ada','Ora','Sol','Tam','Uri','Vex','Wyn','Xan','Yao','Zia','Ari','Bex','Cal'];
function makeRoster() {
  if (!P.playerCount) return P.members || ['Lee','Monse','Dad','Uncle Ray','Coach K','Sam','Priya','Marcus'];
  const out = ['Lee'];
  for (let i = 1; i < P.playerCount; i++) {
    out.push(P.longNames
      ? 'Bartholomew Fitzgerald-Wentworth ' + i
      : NAMES[(i - 1) % NAMES.length] + (i > NAMES.length ? ' ' + i : ''));
  }
  return out;
}
const ROSTER = makeRoster();
const MEMBERS = ROSTER.map((n,i) => ({ uid: 'u_'+i, name: n }));

window.PS = {
  SEASON: '2026', user: { uid: 'u_0' }, poolId: 'p_test',
  /* Real Firebase fires onAuthStateChanged the INSTANT this resolves —
     which is several lines before the PIN screen's go() reaches
     joinPool(). That ordering is the whole cause of the "boxes empty and
     it sits there" bug, and a stub whose watchAuth fires once at startup
     cannot express it. Re-fire, the way the SDK does. */
  async signInWithToken(t){
    await call('signInWithToken');
    if (window.__authCb) setTimeout(() => window.__authCb(this.user), 0);
    return this.user;
  },
  async joinPool(c){ await call('joinPool'); window.__joined = true;
    return { id:'p_test', name:"Weekly NFL Pick'em" }; },
  async upsertRoster(x){ await call('upsertRoster'); },
  async ensureCurrentPool(){ await call('ensureCurrentPool');
    return P.noPool ? null : { id:'p_test', name:"Weekly NFL Pick'em", season:'2026' }; },
  async getPool(){ return { id:'p_test', name:"Weekly NFL Pick'em", season:'2026' }; },
  async getAllWeeks(){
    await call('getAllWeeks');
    const by = {}; GAMES.forEach(g => (by[g.wk] ||= []).push(g));
    return Object.keys(by).map(Number).sort((a,b)=>a-b)
      .map(wk => ({ wk, games: by[wk].sort((a,b)=>a.kickoff.toMillis()-b.kickoff.toMillis()) }));
  },
  async getMembers(){ await call('getMembers');
    if (P.notAMember && !window.__joined) { const e = new Error('Missing or insufficient permissions.'); e.code = 'permission-denied'; throw e; }
    return MEMBERS; },
  async getStandings(){ await call('getStandings');
    // Shape score_week.py actually writes: a per-week map plus the sums.
    const done = [...new Set(GAMES.filter(g => g.status === 'final').map(g => g.wk))];
    const rows = MEMBERS.map((m, i) => {
      const weeks = {};
      done.forEach(w => { weeks[String(w)] = {
        pts: 60 + ((i*7 + w*11) % 55), hits: 8 + ((i + w) % 8),
        mode: 'confidence', perfect: (i === 1 && w === 2) }; });
      return { uid: m.uid, name: m.name, weeks,
        pts: Object.values(weeks).reduce((a,b)=>a+b.pts,0),
        hits: Object.values(weeks).reduce((a,b)=>a+b.hits,0),
        perfectWeeks: Object.values(weeks).filter(w=>w.perfect).length,
        weekWins: i === 0 ? 2 : (i === 1 ? 1 : 0),
        weekSeconds: i === 2 ? 2 : 0 };
    });
    // The collection also contains score_week.py's nameless "_weeks" doc.
    return [...rows, { uid: '_weeks', 3: { winners: [], pts: 0 } }]; },
  async getScoringMode(){ await call('getScoringMode'); return P.mode || 'confidence'; },
  async myPicks(wk){ await call('myPicks');
    if (P.noPicks) return {};
    const o = {}; GAMES.filter(g=>g.wk===wk).forEach((g,i) => {
      if (i < (P.myPickCount == null ? 16 : P.myPickCount))
        o[g.id] = { winner: i%2 ? g.home : g.away, weight: i+1 };
    }); return o; },
  /* Rows carry uid AND name, exactly as firebase-init.js returns them.
     The stub used to omit uid, which started mattering the moment the app
     keyed players by uid instead of by display name: a stub answering in a
     shape the real data layer never produces makes the whole suite agree
     with itself about something untrue. */
  async getRevealed(wk){ await call('getRevealed');
    if (P.noRevealed) return [];
    const rows = []; GAMES.filter(g=>g.wk===wk).forEach((g,i) =>
      MEMBERS.forEach((m,mi) => { if (g.kickoff.toMillis() < Date.now())
        rows.push({ uid:m.uid, name:m.name, gameId:g.id,
                    winner: (i+mi)%2 ? g.home : g.away, weight:(i+mi)%16+1 }); }));
    return rows; },
  async getTiebreaks(wk){ await call('getTiebreaks');
    return MEMBERS.map((m,i) => ({ uid:m.uid, name:m.name, total: 44 + i*3, mine: i===0 })); },
  async getArchive(){ await call('getArchive'); return P.archive || []; },
  async savePicks(){ await call('savePicks'); },
  async saveTiebreak(){ await call('saveTiebreak'); },
  /* THESE USED TO LOG AND NOTHING ELSE, which meant the entire live path
     — a score landing mid-Sunday, the Grid recolouring, players moving in
     the Standings — was untestable, and so it was untested. The real
     onSnapshot callbacks fire whenever Firestore pushes; these hand the
     callback out on window so a test can push on demand.

     __weekGames() returns copies of the stub's own season rows for the
     week on screen, so a test mutates a game to final and pushes it back
     exactly as watchWeek would deliver it. */
  watchWeek(wk, cb){
    log.push('watchWeek');
    window.__weekGames = () => GAMES.filter(g => g.wk === wk).map(g => ({ ...g }));
    window.__pushWeek  = (games) => cb(games || window.__weekGames(), wk);
  },
  watchRevealed(wk, cb){
    log.push('watchRevealed');
    window.__pushRevealed = (rows) => cb(rows || [], wk);
  },
  watchMembers(cb){
    log.push('watchMembers');
    window.__pushMembers = (m) => cb(m || MEMBERS);
  },
  watchAuth(cb){ log.push('watchAuth'); window.__authCb = cb;
    setTimeout(()=>cb(P.signedOut ? null : { uid:'u_0' }), 0); },
  async signOut(){}, async enablePush(){}, async refreshPushToken(){},
  async alertsHealthy(){ return true; },
  getBoard(){ return []; }, watchBoard(){}, getShard(){ return null; },
  async getWeek(){ return []; }, async setScoringMode(){}, registerSW(){},
};
`;

const srv = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const send = (c, b, t='application/json') => {
    res.writeHead(c, { 'Content-Type': t, 'Cache-Control': 'no-store' });
    res.end(typeof b === 'string' ? b : JSON.stringify(b));
  };
  if (u.pathname === '/__plan') {
    let b = ''; for await (const c of req) b += c;
    plan = JSON.parse(b || '{}'); return send(200, { ok: true });
  }
  if (u.pathname.startsWith('/api/')) {
    if (u.pathname === '/api/session') return send(200, { token: 't', uid: 'u_0' });
    return send(200, { ok: true });
  }
  if (u.pathname === '/firebase-init.js')
    return send(200, `window.__plan=${JSON.stringify(plan)};\n${STUB}`, 'text/javascript');
  if (u.pathname === '/' || u.pathname === '/index.html')
    return send(200, fs.readFileSync(APP, 'utf8'), 'text/html');
  send(404, 'nope', 'text/plain');
});
srv.listen(8098, () => console.log('ready'));
