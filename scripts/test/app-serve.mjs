/* Serves the real index.html with a PS stub that returns data in the exact
   shape Firestore holds it (per scripts/import_schedule.py), so the app's
   own mapping layer is exercised rather than bypassed. */
import http from 'node:http';
import fs from 'node:fs';

/* RESOLVED FROM THIS FILE, NOT HARDCODED. This was an absolute path to
   one checkout, so running the harness from a second copy of the repo
   silently graded the FIRST copy's index.html: the server said ready,
   every test passed, and none of them had looked at the file being
   worked on. Caught while building this release beside an older tree,
   by grepping the served HTML for a class that was definitely in the
   file on disk and definitely not in the response. */
const APP = new URL('../../index.html', import.meta.url).pathname;
let plan = {};

const STUB = `
const P = window.__plan || {};
const log = [];
window.__ps = { log, calls: c => log.filter(x => x === c).length };
const boom = n => { if (P.fail && P.fail[n]) throw new Error('stub failure: ' + n); };
const slow = async n => { const d = (P.delay && P.delay[n]) || 0; if (d) await new Promise(r => setTimeout(r, d)); };
const call = async n => { log.push(n); await slow(n); boom(n); };

/* ---- ESPN, INTERCEPTED -------------------------------------------
   index.html reads the public ESPN scoreboard straight from the browser
   now (see pullEspn) because no scheduled job could be relied on to
   write it: Cloudflare's egress is denied by Akamai, and GitHub Actions
   never once fired its own cron. That read is therefore app behaviour,
   and app behaviour has to be forceable from a test — INCLUDING its
   failure paths, which are the entire safety argument. A stub that only
   ever returned good data would prove nothing about what a player sees
   when ESPN is down.

   window.__espn takes the events array, or one of three sabotage modes:
   'down' (503), 'throw' (network gone), 'junk' (200 whose body is not
   JSON). window.__espnCalls records every URL asked for, so a test can
   also assert that NOTHING was asked when nothing was live. */
window.__espnCalls = [];
/* Seeded from the plan so it is in place BEFORE the app boots — espnLoop
   runs off the first week snapshot, which happens during boot, so a test
   that set this afterwards would be grading the second poll, not the
   first. */
/* P.espnDetail: "give me a scoreboard for whatever is actually live".
   Seeding window.__espn by hand means knowing which team abbreviations
   buildGames() chose, which a test would have to duplicate to guess —
   and setting it AFTER boot is no help, because nothing re-polls for
   sixty seconds and there is no visibilitychange hook to force one. So
   the server, which already knows the schedule, builds the events: one
   per live-and-unfinished game in the plan, carrying this shortDetail.
   That is how ESPN's own clock string gets on screen inside a test. */
window.__espn = P.espn;
const realFetch = window.fetch.bind(window);
window.fetch = (u, o) => {
  const url = String((u && u.url) || u || '');
  if (!url.includes('site.api.espn.com')) return realFetch(u, o);
  window.__espnCalls.push(url);
  const e = window.__espn;
  if (e === 'down')  return Promise.resolve(new Response('', { status: 503 }));
  if (e === 'throw') return Promise.reject(new Error('network down'));
  if (e === 'junk')  return Promise.resolve(new Response('<html>nope', { status: 200 }));
  return Promise.resolve(new Response(JSON.stringify({ events: e || [] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }));
};
/* One ESPN event in exactly the shape pullEspn destructures — scores as
   STRINGS, because that is what ESPN sends and parseInt is what the app
   relies on. Pass state 'pre' or 'post' to model the other two. */
window.__espnEvent = (away, home, as, hs, state, poss) => {
  /* Ids so a test can drive possession by hand as well as through the
     plan. poss is 'away', 'home', or omitted for no situation at all,
     which is what ESPN sends outside a live drive. */
  const ids = { away: 'a1', home: 'h1' };
  const c = {
    status: { type: { state: state || 'in' } },
    competitors: [
      { homeAway: 'away', team: { abbreviation: away, id: ids.away },
        score: as == null ? null : String(as) },
      { homeAway: 'home', team: { abbreviation: home, id: ids.home },
        score: hs == null ? null : String(hs) } ]
  };
  if (poss) c.situation = { possession: ids[poss] };
  return { competitions: [c] };
};

const TEAMS = ['KC','BAL','BUF','CIN','DAL','PHI','SF','DET','GB','MIN','NYJ','MIA',
               'LAC','DEN','SEA','ATL','NO','TB','HOU','IND','JAX','TEN','CLE','PIT',
               'LV','ARI','LAR','CHI','WSH','NYG','CAR','NE'];
const NETS = ['CBS','FOX','NBC','ESPN','AMZN','NFLN'];
const ts = ms => ({ toMillis: () => ms, seconds: Math.floor(ms/1000) });

/* THE DEFAULT SEASON OPENER IS THE NEXT THURSDAY, NOT A FIXED DATE.

   It used to be Date.parse('2026-09-10T00:20:00Z') — the real 2026
   opener. That worked right up until 10 Sep 2026, when the date it named
   arrived and then receded: the fixture's first game became live, then
   final, and six cases that tap an unstarted card started timing out
   against a locked one. A test fixture pinned to a wall-clock date does
   not fail on the day you change the code, it fails on a day nobody
   touched anything, which is the worst possible time to debug it.

   Anchored to the next Thursday so the Thu-night / Sunday-block /
   Monday-night shape the rest of this file assumes is preserved exactly,
   and every default game is always in the future. Cases that need a
   season already under way pass startISO explicitly, as they always did. */
const nextThu = () => {
  const d = new Date();
  d.setUTCHours(0, 20, 0, 0);
  do { d.setUTCDate(d.getUTCDate() + 1); } while (d.getUTCDay() !== 4);
  return d.getTime();
};
const KICK1 = P.startISO ? Date.parse(P.startISO) : nextThu();
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
      /* P.stuck: how many games at the END of each week never receive a
         final status, however long ago they kicked off.

         THE REAL THING THIS MODELS, because it is not hypothetical. A
         game gets postponed and keeps its original kickoff; or one
         scoring run fails; or ESPN is out across a Monday night. The
         game document then sits on "scheduled" with a kickoff in the
         past — and isLive() in the app is Date.now() >= g.kick and
         nothing else, so that game is "live" forever by the only test
         the client has. The generator could not produce this at all: it
         derives finality from the clock, which is exactly the
         assumption under test. */
      const stuck = (P.stuck || 0) > 0 && i >= GAMES_PER - P.stuck;
      const done = !stuck && kickoff + 200*60000 < Date.now();
      out.push({
        id: '2026_W'+w+'_'+away+'_'+home, wk: w, away, home,
        kickoff: ts(kickoff),
        network: NETS[(w+i) % NETS.length],
        spread: (w+i) % 5 === 0 ? '' : (home + ' -' + (((w+i)%13)/2 + 1).toFixed(1)),
        status: done ? 'final' : 'scheduled',
        /* THE WINNER AND THE SCORES HAVE TO AGREE, and for a long time
           they did not. The winner field was (w+i)%2 and the two scores
           were two unrelated hashes, so roughly half the finished games
           in every fixture had the losing team named as the winner: a
           card reading "Final · SEA 13-10" with SEA on 10.

           NOTE FOR ANYONE EDITING THIS FILE: everything from the STUB
           declaration down to its closing backtick is one template
           literal, so a backtick anywhere in here — including inside a
           comment — ends the string and breaks the server with an
           error pointing at a line that looks fine. Four times now.

           Nothing caught it because nothing on the card put the two
           side by side — the old lock band printed max-min, which
           silently "corrected" the incoherence by never naming which
           side had which number. The v1.35.0 head prints the winner's
           score first, so a fixture that contradicts itself now shows
           it, and the first screenshot of the real card is what
           surfaced this.

           A fixture that disagrees with itself cannot tell you whether
           the app is right. So: pick the winner, then make the winner
           the higher score. */
        ...(() => {
          if (!done) return { awayScore: null, homeScore: null, winner: null };
          const hi = 24 + ((w*i*7) % 17);          // 24-40
          const lo = hi - (3 + ((w*i*5) % 18));    // 3-20 behind
          const homeWon = ((w+i) % 2) === 1;
          return { awayScore: homeWon ? lo : hi,
                   homeScore: homeWon ? hi : lo,
                   winner: homeWon ? home : away };
        })(),
      });
    }
  }
  return out;
}
const GAMES = buildGames();
/* Built here rather than in the browser: this is the only place that
   knows which abbreviations the generated schedule used. */
function espnAuto(detail){
  const now = Date.now();
  return GAMES
    /* g.kickoff is a Firestore-shaped stub ({toMillis, seconds}), not a
       string — Date.parse() on it is NaN, every comparison is false, and
       the filter silently returns nothing. That is exactly how this hook
       first "worked" while seeding an empty scoreboard. */
    .filter(g => g.kickoff.toMillis() <= now && g.status !== 'final')
    .map((g, i) => {
      /* TEAM IDS AND A SITUATION, because that is how possession
         arrives. ESPN's situation.possession is a team ID, not an
         abbreviation, so a fixture without ids cannot exercise the
         lookup at all: the app would read undefined, find no match and
         show no football, and the test would pass for the wrong reason.
         The ids here are per-event and arbitrary, exactly as they are in
         the real feed.

         P.espnBall picks who holds it: 'away', 'home', 'none' for a
         live game ESPN sends no situation for (halftime, between
         drives), or 'alt' to alternate down the slate so one fixture
         shows both sides at once. Default is 'home'. */
      const mode = P.espnBall || 'home';
      const who = mode === 'alt' ? (i % 2 ? 'away' : 'home') : mode;
      const ids = { away: '9' + i + '1', home: '9' + i + '2' };
      const c = {
        status: { type: { state: 'in', shortDetail: detail } },
        competitors: [
          { homeAway: 'away', team: { abbreviation: g.away, id: ids.away }, score: '17' },
          { homeAway: 'home', team: { abbreviation: g.home, id: ids.home }, score: '13' } ] };
      if (who === 'away' || who === 'home') c.situation = { possession: ids[who] };
      return { competitions: [c] };
    });
}
/* Assigned HERE, not up beside the fetch shim, because GAMES does not
   exist yet at that point — and the whole value of this hook is that it
   is in place before the app's first poll. */
if (P.espn == null && P.espnDetail) window.__espn = espnAuto(P.espnDetail);
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

/* P.lopsided: FORCE A POOL THAT NEARLY ALL AGREES, BOTH WAYS ROUND.

   The default generator splits every game (i+mi)%2, so consensus is
   always about 50/50 and no segment is ever narrow enough to drop its
   own label. Which means every assertion about the narrow side was
   filtering an empty list, and .every() on nothing is true — two of
   them had been green for months without once seeing the case.

   So this makes ONE member the lone dissenter, and alternates which
   side they are on, so a single fixture produces a narrow segment on
   the left AND one on the right:
     i % 3 === 0  everyone on home but member 0  -> AWAY narrow (left)
     i % 3 === 1  everyone on away but member 0  -> HOME narrow (right)
     otherwise    the ordinary split, untouched
   At 13 members that is 8% against 92%, under the 22% threshold either
   way round.

   Used by BOTH getRevealed and watchRevealed, from this one function,
   because a listener that disagrees with the first read pushes a
   different pool a moment later — the same class of bug P.noRevealed
   already hit here once. */
/* P.unstaked: how many games at the START of each week are PICKED BUT
   NOT RANKED.

   THE STATE THIS EXISTS FOR, and it had no fixture at all. pay(r,n)
   returns 1 for a falsy rank, so an unstaked pick that comes in scores
   ONE point — the same as the lowest rank. The card says "Unstaked" to
   explain the 1, and mutating that word away printed "Rank undefined"
   ... except every fixture staked every pick (the weight was
   (i+mi)%16+1, never zero), so the mutation had nothing to show and the
   assertion could not catch it. Mutation batch 30 surfaced that.

   Zero rather than undefined, because zero is what the app's own
   pick weight is when somebody taps a team and never opens the tray. */
const unstakedGame = i => (P.unstaked || 0) > 0 && i < P.unstaked;

const pickFor = (g, i, mi, wk) => {
  if (P.lopsided) {
    if (i % 3 === 0) return mi === 0 ? g.away : g.home;
    if (i % 3 === 1) return mi === 0 ? g.home : g.away;
  }
  return P.promo
    ? (((i*2654435761 + mi*40503 + wk*97) >>> 4) % 100 < 62 ? g.home : g.away)
    : ((i+mi)%2 ? g.home : g.away);
};

const PSX = window.PS = {
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
  /* Under newUser, joinPool takes a beat — as a real network write does.
     Without this the stub resolved joinPool BEFORE the queued auth
     callback ran, which is the lucky ordering and the one that hides the
     bug. Firebase fires onAuthStateChanged locally the moment the token
     is accepted; the join is a round trip to Firestore after it. The
     callback wins that race in the real app, every time, for a new user. */
  async joinPool(c){ await call('joinPool');
    if (P.newUser) await new Promise(r => setTimeout(r, P.slowJoinMs || 400));
    window.__joined = true;
    return { id:'p_test', name:"Weekly NFL Pick'em" }; },
  async upsertRoster(x){ await call('upsertRoster'); },
  /* plan.newUser reproduces the ONE ordering that matters and that a
     static flag cannot express: a person who has never joined. Firebase
     fires onAuthStateChanged the instant signInWithToken resolves, which
     is several lines before the PIN screen's go() reaches joinPool() — so
     boot's watchAuth asks for the pool and there genuinely is not one yet.
     Returning null until joinPool has run is exactly what the real
     ensureCurrentPool does for a brand-new player. */
  async ensureCurrentPool(){ await call('ensureCurrentPool');
    if (P.noPool) return null;
    if (P.newUser && !window.__joined) return null;
    return { id:'p_test', name:"Weekly NFL Pick'em", season:'2026' }; },
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
      /* P.recPts / P.recHits let a test state the BANKED record exactly.
         Without them the stub's fabricated 60-115 points and 8-15 hits
         always exceeded anything the small fixtures could compute, so
         the client-ahead branch of weekSum was unreachable and the
         Monday-night staleness bug could not be written down as a
         test. recHits: 0 makes the record deliberately behind. */
      done.forEach(w => { weeks[String(w)] = {
        pts:  P.recPts  == null ? 60 + ((i*7 + w*11) % 55) : P.recPts,
        hits: P.recHits == null ? 8 + ((i + w) % 8)        : P.recHits,
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
        o[g.id] = P.promo
          ? { winner: (((i*2654435761 + wk*97) >>> 4) % 100 < 62 ? g.home : g.away),
              weight: unstakedGame(i) ? 0 : ((i*7+wk)%16)+1 }
          : { winner: i%2 ? g.home : g.away,
              weight: unstakedGame(i) ? 0 : i+1 };
    }); return o; },
  /* Rows carry uid AND name, exactly as firebase-init.js returns them.
     The stub used to omit uid, which started mattering the moment the app
     keyed players by uid instead of by display name: a stub answering in a
     shape the real data layer never produces makes the whole suite agree
     with itself about something untrue. */
  /* plan.promo — MARKETING SCREENSHOTS ONLY, and opt-in for a reason.

     The default generators alternate strictly by index, which is fine for
     tests (deterministic, easy to assert) and useless for a screenshot: it
     makes half the pool go 16/16 and the other half 0/16, which looks like
     a broken app rather than a real week. promo swaps in a hashed spread
     that produces plausible 7-to-12-correct rows and a believable spread of
     points. Nothing reads it unless a plan sets it, so every existing
     assertion still sees the old deterministic data. Used by the invite
     screenshots; see the note at the top of shots.mjs. */
  async getRevealed(wk){ await call('getRevealed');
    if (P.noRevealed) return [];
    const rows = []; GAMES.filter(g=>g.wk===wk).forEach((g,i) =>
      MEMBERS.forEach((m,mi) => { if (g.kickoff.toMillis() < Date.now())
        rows.push({ uid:m.uid, name:m.name, gameId:g.id,
                    winner: pickFor(g, i, mi, wk),
                    weight: unstakedGame(i) ? 0
                      : P.promo ? ((i*7+mi*13+wk)%16)+1 : (i+mi)%16+1 }); }));
    return rows; },
  /* P.tbTotals lets a case state the guesses exactly, by roster index.
     The default 44 + i*3 is deliberately all-distinct, which means it can
     never exercise the case that matters most here: two players on the
     SAME closest guess. Pass a short array to set the first few and leave
     the rest on the default. */
  async getTiebreaks(wk){ await call('getTiebreaks');
    return MEMBERS.map((m,i) => ({ uid:m.uid, name:m.name,
      total: (P.tbTotals && P.tbTotals[i] != null) ? P.tbTotals[i] : 44 + i*3,
      mine: i===0 })); },
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
  /* THE BOUND IS MODELLED HERE NOW, and it has to be.

     This used to log a line and hand out __pushRevealed, and nothing
     else. The real watchRevealed bakes "revealAt <= now - CLOCK_SKEW_MS"
     into the query at SUBSCRIBE time, which is the whole
     reason index.html re-subscribes just past each kickoff. A stub that
     ignores the bound cannot tell a correct re-subscribe from one that
     lands too early — and that is exactly the bug that shipped: the
     refresh fired at kickoff+5s, built a bound 115 seconds SHORT of the
     kickoff, revealed nothing, and then scheduled itself for the next
     kickoff days away. Every test passed throughout.

     __revealBounds records each subscription's bound relative to nothing
     in particular; a test compares it against a kickoff. */
  watchRevealed(wk, cb){
    log.push('watchRevealed');
    /* P.noRevealed HAS TO MEAN IT HERE TOO. getRevealed honoured the
       flag and this did not, so a plan asking for a pool with no
       revealed picks got an empty first load and then a full set pushed
       in a moment later by the listener — which is worse than ignoring
       the flag outright, because the screen was briefly right. A test
       written against it (case 59, a finished week nobody scored in)
       saw four players on a perfect 136 and could not explain why. */
    if (P.noRevealed) { window.__pushRevealed = (r) => cb(r || [], wk); return; }
    const bound = Date.now() - PSX.CLOCK_SKEW_MS;
    (window.__revealBounds ||= []).push(bound);
    const due = GAMES.filter(g => g.wk === wk && g.kickoff.toMillis() <= bound);
    const rows = [];
    /* pickFor, not its own copy of the split: a listener that disagreed
       with the first read pushed a different pool a moment later, which
       is exactly the class of bug P.noRevealed already hit here. */
    due.forEach((g,i) => MEMBERS.forEach((m,mi) => rows.push({
      uid:m.uid, name:m.name, gameId:g.id,
      winner: pickFor(g, i, mi, wk),
      weight: unstakedGame(i) ? 0 : (i+mi)%16+1 })));
    if (rows.length) setTimeout(() => cb(rows, wk), 0);
    window.__pushRevealed = (r) => cb(r || rows, wk);
  },
  watchMembers(cb){
    log.push('watchMembers');
    window.__pushMembers = (m) => cb(m || MEMBERS);
  },
  watchAuth(cb){ log.push('watchAuth'); window.__authCb = cb;
    setTimeout(()=>cb(P.signedOut ? null : { uid:'u_0' }), 0); },
  async signOut(){}, async refreshPushToken(){},
  /* ALERTS HEALTH AND THE ONE-TAP REPAIR.

     alertsHealthy() used to return the bare boolean \`true\` here while the
     real one in firebase-init.js returns {ok:true} / {ok:false, reason}.
     Nothing caught it because nothing called it — the function was dead
     code in the app. The moment the Settings repair banner started reading
     it, this stub would have driven the banner from a shape the app has
     never seen, and the suite would have graded the wrong contract.

     Plan keys:
       alerts    the health object to report, e.g. {ok:false,reason:'permission'}
       pushError message enablePush() should throw instead of succeeding  */
  /* One definition, read by the app's reveal-refresh timer. P.skewMs lets
     a test shrink it so a kickoff can be waited out in seconds. */
  CLOCK_SKEW_MS: P.skewMs == null ? 120000 : P.skewMs,
  async alertsHealthy(){ log.push('alertsHealthy');
    return window.__alerts || P.alerts || { ok:true }; },
  async enablePush(){ await call('enablePush');
    if (P.pushError) throw new Error(P.pushError);
    window.__alerts = { ok:true };   // a real grant heals the next check
    return true; },
  getBoard(){ return []; }, watchBoard(){}, getShard(){ return null; },
  async getWeek(){ return []; }, async setScoringMode(){},

  /* registerSW KEEPS THE CALLBACK, because the banner at the top of the
     Picks tab is raised through it and a no-op stub made that banner
     untestable. The real swAnnounce() fires on registration when a
     worker is already parked from a previous visit, and again whenever
     a check finds one; both are mirrored here. */
  registerSW(cb){
    if (typeof cb === 'function') {
      window.__swCb = cb;
      if (P.sw === 'waiting') cb(() => { window.__swSkip = true; });
    }
  },

  /* ---- THE SERVICE WORKER, AS THE VERSION CARD SEES IT ----

     A real worker cannot be used here: sw.js is not served by this stub,
     and registering one inside the suite would have it caching and
     intercepting every request the tests make. So the three calls the
     card uses are stubbed, and a plan key drives which of its four
     states is reached.

       P.sw           'none'    no registration at all, so 'Not installed yet'
                      'current' registered and up to date          (default)
                      'waiting' an update is parked and ready
                      'offline' the check itself fails
       P.swVersion    the version string to report. The DEFAULT IS READ
                      OUT OF sw.js ON DISK by the server below, so a test
                      asserting what the card prints is asserting against
                      the real file rather than a number typed twice.

     swCheck() flips 'waiting' on once it has been found, exactly as a
     real registration does: reg.waiting stays set, so a second tap goes
     straight to activating rather than checking again. */
  async swVersion(){ await call('swVersion');
    return (P.sw === 'none') ? null : (P.swVersion || window.__swVersion || null); },
  async swCheck(){ await call('swCheck');
    if (P.sw === 'none' || P.sw === 'offline') return 'unknown';
    if (P.sw === 'waiting') {
      window.__swWaiting = true;
      /* Same as the real swCheck, which calls swAnnounce(): an update
         found from Settings has to surface on the Picks tab too. */
      if (window.__swCb) window.__swCb(() => { window.__swSkip = true; });
      return 'waiting';
    }
    return 'current'; },
  async swActivate(){ await call('swActivate');
    if (!window.__swWaiting) return false;
    /* A real activate ends in controllerchange and a reload. The stub
       stops at "yes, that happened": reloading the page mid-test would
       throw away the very assertions that are about to read it. */
    window.__swActivated = true; return true; },
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
  if (u.pathname === '/firebase-init.js') {
    /* THE VERSION COMES OUT OF sw.js, not out of this file. A stub that
       reported a version of its own invention would let the card's test
       pass while the app printed something else entirely. */
    let swver = null;
    try {
      swver = (fs.readFileSync(new URL('../../sw.js', import.meta.url).pathname, 'utf8')
        .match(/const VERSION = '([^']+)'/) || [])[1] || null;
    } catch (_) {}
    return send(200, `window.__plan=${JSON.stringify(plan)};\n`
      + `window.__swVersion=${JSON.stringify(swver)};\n${STUB}`, 'text/javascript');
  }
  if (u.pathname === '/' || u.pathname === '/index.html')
    return send(200, fs.readFileSync(APP, 'utf8'), 'text/html');
  send(404, 'nope', 'text/plain');
});
srv.listen(8098, () => console.log('ready'));
