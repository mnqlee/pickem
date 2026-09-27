/* ============================================================
   Weekly NFL Pick'em — live Worker

   Cron triggers, not GitHub Actions. GitHub's scheduler is
   best-effort and routinely fires 10-20 minutes late, which is
   fine for scores and bad for a "last call, 30 minutes out"
   notification. Cloudflare fires on the minute.

   Runs:
     every minute        scores, during game windows only
     every five minutes  reminders

   Nothing here touches kickoff times or the lock. Those live in
   the game documents and firestore.rules respectively, and are
   unaffected by when or whether this runs.

   BINDINGS
     secret  SA_JSON        Firebase service account JSON
     var     GCP_PROJECT    your Firebase project id
     var     SEASON         "2026"
     KV      SESSIONS       reused for the reminder-sent markers
   ============================================================ */

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';

/* '2026PRE' -> preseason feed and calendar year 2026.
   Without this a preseason pool silently polls the regular-season
   scoreboard and never matches a game. */
const seasonParts = sid => String(sid).toUpperCase().endsWith('PRE')
  // ESPN numbers the Hall of Fame game as preseason week 1, so the three
  // "real" preseason weeks are its weeks 2-4. import_schedule.py had the
  // same off-by-one and silently dropped the final preseason week.
  ? { sid: String(sid), year: +String(sid).slice(0, -3), stype: 1, weeks: 4 }
  : { sid: String(sid), year: +sid, stype: 2, weeks: 18 };
const SCOPES = [
  'https://www.googleapis.com/auth/datastore',
  'https://www.googleapis.com/auth/firebase.messaging'
].join(' ');

export default {
  async scheduled(event, env, ctx) {
    // Two crons, one Worker. cron string tells us which fired.
    /* Both of these used to run bare inside waitUntil, so any throw — a
       failed query, a Firestore blip — became a silent unhandled rejection
       and that cycle's reminders simply never went out, with nothing in the
       log to say so. */
    const guard = (name, p) => p.catch(e =>
      console.log(name + ' cron failed:', (e && e.stack) || String(e)));
    if (event.cron.startsWith('*/5')) {
      ctx.waitUntil(guard('remind', remind(env)));
      /* Separately guarded, deliberately. Reminders are the job this
         Worker exists for and the one thing here that has never failed;
         a throw inside the scores nudge must not take them down with
         it. Two waitUntils, two catches, no shared fate. */
      ctx.waitUntil(guard('nudge', nudgeScores(env)));
      /* THE LINES PASS, on its own guard for the same reason the nudge
         has one: reminders are what this Worker exists for, and a throw
         in a cosmetic refresh must not take them down. It gates itself
         to once a UTC day in KV, so on all but one tick a day this
         costs a single KV read. */
      ctx.waitUntil(guard('lines', pullLines(env)));
    }
    else ctx.waitUntil(guard('scores', scores(env)));
  },
  /* Manual triggers. All require ?key= matching the ADMIN_KEY secret,
     because /test sends real notifications to real phones.
       /__live/scores   pull scores now
       /__live/remind   dry run: who WOULD be notified, sends nothing
       /__live/test     send a real push right now, to verify end to end
                        without waiting for a tier window
       /__live/nudge    ask GitHub to pull scores now, if a game is live.
                        Exists so the GH_TOKEN and the whole bridge can
                        be proved in one request rather than by waiting
                        five minutes and reading a log — which is how the
                        last broken secret went unnoticed for nine days. */
  async fetch(req, env) {
    const u = new URL(req.url);
    const p = u.pathname;
    if (!p.startsWith('/__live/')) return new Response('not found', { status: 404 });

    /* THREE DIFFERENT FAILURES, THREE DIFFERENT ANSWERS.

       This was one line — `if (!env.ADMIN_KEY || key !== env.ADMIN_KEY)`
       — returning the bare word "forbidden" for all of them. So "this
       Worker has no ADMIN_KEY configured" was indistinguishable from
       "your key is wrong", and that cost a real afternoon: a
       `wrangler secret put` that dropped its `-c wrangler-live.toml`
       saved the secret to the OTHER Worker in this folder, reported
       "Success", and every key tried afterwards came back forbidden
       with nothing to say which of the two things was wrong. There is
       no amount of guessing keys that gets you out of that, and the
       response was actively steering the guessing.

       None of this leaks the secret: it says whether a key ARRIVED and
       whether one is CONFIGURED, never anything about either value. A
       wrong key still just says wrong key. */
    const supplied = u.searchParams.get('key');
    if (!env.ADMIN_KEY) return new Response(
      'no ADMIN_KEY is configured on this Worker. Set it with:\n' +
      '  wrangler secret put ADMIN_KEY -c wrangler-live.toml\n' +
      'and check it landed here, not on the auth Worker:\n' +
      '  wrangler secret list -c wrangler-live.toml\n', { status: 503 });
    if (!supplied) return new Response(
      'no key supplied. Add ?key=YOUR_ADMIN_KEY to the URL.\n', { status: 403 });
    if (supplied !== env.ADMIN_KEY) return new Response(
      'that key does not match this Worker\'s ADMIN_KEY.\n' +
      'A key pasted from a password manager can contain + & # % or /,\n' +
      'which a URL reads as punctuation and mangles before it gets here.\n' +
      'Letters and digits only is the safe shape.\n', { status: 403 });

    if (p === '/__live/scores') return json(await scores(env));
    /* ?force=1 ignores the once-a-day stamp, which is the only way to
       prove the whole path works without waiting for tomorrow. */
    if (p === '/__live/lines')
      return json(await pullLines(env, u.searchParams.get('force') === '1'));
    if (p === '/__live/remind') return json(await remind(env, true));
    if (p === '/__live/test')   return json(await testPush(env, u.searchParams));
    if (p === '/__live/nudge')
      return json(await nudgeScores(env, u.searchParams.get('force') === '1'));
    return new Response('not found', { status: 404 });
  }
};

const json = o => new Response(JSON.stringify(o, null, 2),
  { headers: { 'Content-Type': 'application/json' } });

/* ---------- Google auth ----------
   The Worker cannot use firebase-admin, so it signs a service-account
   JWT and exchanges it for an OAuth access token. Same crypto as the
   custom-token signing in auth.js. */
let _tok = { v: null, exp: 0 };
async function token(env) {
  if (_tok.v && Date.now() < _tok.exp - 60000) return _tok.v;
  const sa = JSON.parse(env.SA_JSON);
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: sa.client_email, scope: SCOPES,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600
  };
  const b64 = o => btoa(JSON.stringify(o))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const body = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(claim)}`;
  const der = Uint8Array.from(atob(sa.private_key.replace(/-----[^-]+-----|\s/g, '')),
    c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key,
    new TextEncoder().encode(body));
  const jwt = `${body}.${btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('auth failed: ' + JSON.stringify(d));
  _tok = { v: d.access_token, exp: Date.now() + d.expires_in * 1000 };
  return _tok.v;
}

/* ---------- Firestore REST ----------
   Values are typed, so pack and unpack them. */
const enc = v =>
  v === null || v === undefined ? { nullValue: null } :
  typeof v === 'boolean' ? { booleanValue: v } :
  typeof v === 'number' ? (Number.isInteger(v)
    ? { integerValue: String(v) } : { doubleValue: v }) :
  v instanceof Date ? { timestampValue: v.toISOString() } :
  Array.isArray(v) ? { arrayValue: { values: v.map(enc) } } :
  typeof v === 'object' ? { mapValue: { fields: Object.fromEntries(
      Object.entries(v).map(([k, x]) => [k, enc(x)])) } } :
  { stringValue: String(v) };

const dec = f => {
  if (!f) return null;
  const k = Object.keys(f)[0], v = f[k];
  switch (k) {
    case 'integerValue': return +v;
    case 'doubleValue': return +v;
    case 'booleanValue': return v;
    case 'nullValue': return null;
    case 'timestampValue': return new Date(v);
    case 'arrayValue': return (v.values || []).map(dec);
    case 'mapValue': return Object.fromEntries(
      Object.entries(v.fields || {}).map(([a, b]) => [a, dec(b)]));
    default: return v;
  }
};
const decDoc = d => ({
  _name: d.name,
  _id: d.name.split('/').pop(),
  ...Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, dec(v)]))
});

const base = env => `https://firestore.googleapis.com/v1/projects/${env.GCP_PROJECT}/databases/(default)/documents`;

async function fsQuery(env, parent, collection, where = []) {
  const t = await token(env);
  const filters = where.map(([field, op, value]) => ({
    fieldFilter: { field: { fieldPath: field }, op, value: enc(value) }
  }));
  const body = {
    structuredQuery: {
      from: [{ collectionId: collection }],   // scoped by `parent`, not a group query
      ...(filters.length ? { where: filters.length === 1
        ? filters[0] : { compositeFilter: { op: 'AND', filters } } } : {})
    }
  };
  const r = await fetch(`${base(env)}${parent}:runQuery`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const rows = await r.json();
  if (!Array.isArray(rows)) throw new Error('query failed: ' + JSON.stringify(rows));
  return rows.filter(x => x.document).map(x => decDoc(x.document));
}

async function fsPatch(env, path, fields) {
  const t = await token(env);
  const mask = Object.keys(fields).map(k => `updateMask.fieldPaths=${k}`).join('&');
  const r = await fetch(`${base(env)}/${path}?${mask}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: Object.fromEntries(
      Object.entries(fields).map(([k, v]) => [k, enc(v)])) })
  });
  if (!r.ok) throw new Error(`patch ${path}: ${r.status} ${await r.text()}`);
}

async function fsGet(env, path) {
  const t = await token(env);
  const r = await fetch(`${base(env)}/${path}`, { headers: { Authorization: `Bearer ${t}` } });
  if (r.status === 404) return null;
  // Anything other than a document — a 403, a 500, a rate limit — comes back
  // as an error object with no `name`, and decDoc() would throw on
  // d.name.split(). That turned a transient Firestore blip into a dead
  // reminder run with nothing logged.
  if (!r.ok) { console.log('fsGet failed', path, r.status, await r.text()); return null; }
  const d = await r.json();
  if (!d || !d.name) { console.log('fsGet: unexpected body for', path); return null; }
  return decDoc(d);
}

/* ============================================================
   BETTING LINES — once a day, so a card is not showing Tuesday's number
   ============================================================

   WHAT WAS WRONG, and it was a schedule rather than a bug. The lines
   ALREADY refresh: pull_lines() in scripts/score_week.py pulls the
   current and next week from ESPN and it runs on every scoring run. But
   the scoring runs are Sunday about 9pm ET, Monday about 3am, Tuesday
   about 4am and Tuesday about noon ET. So the last refresh before a
   Sunday slate is TUESDAY, and from Wednesday to Saturday — the whole
   picking week — every card shows Tuesday's number. Lee spotted it from
   the outside: "when you pill espn spreads, they dont change."

   WHY HERE AND NOT IN A NEW WORKFLOW. This Worker already wakes every
   five minutes, already talks to this exact ESPN endpoint with the
   User-Agent it requires, already holds a Firestore token and already
   has the KV namespace to remember that it ran. A new GitHub workflow
   would need the service account wired into it again for a job this
   small. Nothing new to configure, one wrangler deploy.

   ONCE A DAY, ENFORCED IN KV RATHER THAN BY THE CRON. This Worker's
   only cron fires every five minutes, so the gate has to live here: a
   UTC date stamp is written after a successful pass and checked on
   every tick. (Writing the cron expression out in a block comment ends
   it early, which is how this file first refused to parse.) The Worker has no schedule
   of its own to change, and if a day's pass fails the next tick five
   minutes later retries it rather than waiting until tomorrow.

   AND IT ONLY EVER TOUCHES `spread`. Same rule as scores(): fsPatch is
   a PATCH and Firestore turns a PATCH on an unknown id into an INSERT,
   so an abbreviation ESPN has renamed would write a phantom game into
   the schedule. A game we do not already have is skipped and logged.
   Nothing here can change a kickoff, a score, a status or a winner. */
const LINES_LOOKAHEAD_DAYS = 9;

async function pullLines(env, force = false) {
  const season = env.SEASON || '2026';
  const { sid, year, stype } = seasonParts(season);
  const now = Date.now();
  const stamp = new Date(now).toISOString().slice(0, 10);   // UTC day

  if (!force) {
    const done = await env.SESSIONS.get('lines:day').catch(() => null);
    if (done === stamp) return { skipped: 'already ran today' };
  }

  /* WHICH WEEKS ARE WORTH ASKING ABOUT. The client only shows a line
     for a game inside eight days (LINE_WINDOW in index.html), because
     nothing is priced further out, so refreshing beyond that would be
     writing numbers nobody can see. Nine days here gives the window one
     day of slack rather than racing it. Normally one or two weeks. */
  const ahead = new Date(now + LINES_LOOKAHEAD_DAYS * 86400000);
  const soonGames = await fsQuery(env, `/seasons/${season}`, 'games', [
    ['kickoff', 'GREATER_THAN', new Date(now)],
    ['kickoff', 'LESS_THAN', ahead]
  ]).catch(e => { console.log('lines: games query failed', String(e)); return []; });
  if (!soonGames.length) return { skipped: 'nothing inside the line window' };

  const weeks = [...new Set(soonGames.map(g => g.wk))];
  const have = Object.fromEntries(soonGames.map(g => [g._id, g]));
  let changed = 0, seen = 0;
  const unmatched = [];

  for (const wk of weeks) {
    let data;
    try {
      const r = await fetch(`${ESPN}?seasontype=${stype}&week=${wk}&dates=${year}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; WeeklyNFLPickem/1.0; +https://nflweeklypickem.com)',
          'Accept': 'application/json'
        }
      });
      if (!r.ok) {
        const why = await r.text().then(t => t.slice(0, 160).replace(/\s+/g, ' '))
                                  .catch(() => '(body unreadable)');
        console.log('lines: espn', r.status, 'week', wk, '::', why);
        continue;
      }
      data = await r.json();
    } catch (e) { console.log('lines: espn fetch failed week', wk, String(e)); continue; }

    for (const ev of data.events || []) {
      try {
        const c = ev.competitions && ev.competitions[0];
        if (!c) continue;
        const by = Object.fromEntries((c.competitors || []).map(t => [t.homeAway, t]));
        const away = by.away && by.away.team && by.away.team.abbreviation;
        const home = by.home && by.home.team && by.home.team.abbreviation;
        if (!away || !home) continue;
        const gid = `${sid}_W${wk}_${away}_${home}`;
        const old = have[gid];
        if (!old) { unmatched.push(gid); continue; }

        /* NO ODDS IS NOT AN EMPTY SPREAD. ESPN drops the odds array for
           a game it has not priced yet, and writing '' for that would
           erase a line we already had every time the book pulled it. */
        const odds = c.odds || [];
        if (!odds.length) continue;
        const details = odds[0].details || '';
        if (!details) continue;
        seen++;
        if (old.spread === details) continue;
        await fsPatch(env, `seasons/${season}/games/${gid}`, { spread: details });
        changed++;
      } catch (e) { console.log('lines: event failed', wk, String(e)); }
    }
  }

  /* STAMPED ONLY ON A PASS THAT REACHED ESPN. If every week's fetch
     failed, `seen` is zero and the day is left unstamped so the next
     tick tries again, rather than recording a run that did nothing. */
  if (seen) await env.SESSIONS.put('lines:day', stamp, { expirationTtl: 172800 })
    .catch(e => console.log('lines: stamp failed', String(e)));
  if (unmatched.length) console.log('lines: unmatched', unmatched.slice(0, 6).join(', '));
  console.log(`lines: weeks ${weeks.join(',')}, ${seen} priced, ${changed} changed`);
  return { weeks, seen, changed, unmatched: unmatched.length, stamped: !!seen };
}

/* ============================================================
   SCORES — every minute during game windows
   ============================================================ */
async function scores(env) {
  const season = env.SEASON || '2026';
  const { sid, year, stype } = seasonParts(season);
  const now = new Date();

  // Cheap guard: only hit ESPN when something is actually in progress or
  // about to be. Saves ~1,300 pointless calls a day.
  const soon = new Date(now.getTime() + 30 * 60000);
  /* 12 hours back, not 6. A game only gets its final score while it sits
     inside this window, and there is no catch-up pass — so anything that
     ran long (overtime, a weather delay, a late kickoff) or happened while
     this Worker was erroring used to keep "FINAL · null" forever. Twelve
     hours covers a full Sunday slate plus a delay and still skips ~1,300
     pointless ESPN calls a day. */
  const live = await fsQuery(env, `/seasons/${season}`, 'games', [
    ['kickoff', 'LESS_THAN', soon],
    ['kickoff', 'GREATER_THAN', new Date(now.getTime() - 12 * 3600000)]
  ]).catch(e => { console.log('games query failed', String(e)); return []; });
  if (!live.length) return { skipped: 'nothing live' };

  const weeks = [...new Set(live.map(g => g.wk))];
  let changed = 0;
  const unmatched = [];

  for (const wk of weeks) {
    let data;
    try {
      /* THE USER-AGENT IS NOT OPTIONAL, and its absence looked like nothing.

         This call had no headers at all. A Worker's fetch() sends no
         User-Agent unless you give it one, and ESPN answers a UA-less
         request to this endpoint with 403 — every minute, forever, with
         the score never landing and one terse line in a log nobody was
         collecting.

         scripts/score_week.py hits the identical URL and succeeds, which
         is what made this hard to see: the endpoint is fine, the season
         and week are fine, the service account is fine. `requests` always
         sends a User-Agent of its own; fetch() does not. The same request,
         one header apart. */
      const r = await fetch(`${ESPN}?seasontype=${stype}&week=${wk}&dates=${year}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; WeeklyNFLPickem/1.0; +https://nflweeklypickem.com)',
          'Accept': 'application/json'
        }
      });
      /* A skipped week used to be completely silent. If ESPN is down through
         the Sunday window, every score for that week quietly never lands.

         SAY WHAT IT ANSWERED, not just the number. `espn 403 week 1` told
         us a request was refused and nothing whatever about why — no body,
         no hint whether it was a block, a rate limit or a bad parameter.
         A bare status code sends the next person guessing, and guessing is
         what cost this Worker nine days. */
      if (!r.ok) {
        const why = await r.text().then(t => t.slice(0, 160).replace(/\s+/g, ' '))
                                  .catch(() => '(body unreadable)');
        console.log('espn', r.status, 'week', wk, '::', why);
        continue;
      }
      data = await r.json();
    } catch (e) { console.log('espn fetch failed week', wk, String(e)); continue; }

    const have = Object.fromEntries(
      live.filter(g => g.wk === wk).map(g => [g._id, g]));

    for (const ev of data.events || []) {
      try {
        const c = ev.competitions && ev.competitions[0];
        const state = c && c.status && c.status.type && c.status.type.state;
        if (!c || !state) continue;                 // pre | in | post
        const by = Object.fromEntries((c.competitors || [])
          .map(t => [t.homeAway, t]));
        if (!by.away || !by.home) continue;         // a TBD or malformed entry
        const away = by.away.team && by.away.team.abbreviation;
        const home = by.home.team && by.home.team.abbreviation;
        if (!away || !home) continue;
        const gid = `${sid}_W${wk}_${away}_${home}`;

        const old = have[gid];

        /* NEVER create a game here. fsPatch is a PATCH, which Firestore
           happily turns into an insert, so an abbreviation ESPN has renamed
           (WAS -> WSH is the classic) would have written a SECOND, phantom
           game document into the schedule: the week would show 17 games,
           one of them with no spread, no network, nobody's picks against it,
           and it would sit there for the rest of the season. The schedule is
           import_schedule.py's job. If a game is unmatched, say so and move
           on — a missing score is recoverable, a corrupted schedule is not. */
        if (!old) { unmatched.push(gid); continue; }

        /* ESPN reports state 'post' for games that never happened —
           postponed, cancelled, suspended — and their competitors carry no
           score. `+(undefined || 0)` turned that into a real-looking 0-0
           FINAL with winner null: on the Grid every player's pick went red
           and their confidence stake was lost, for a game that had not been
           played. When it was rescheduled and actually finished, the guard
           below ("skip if nothing changed") saw status already 'final' and
           the true result was never written.

           A completed NFL game cannot end 0-0, so the combination of
           post + no score is decisive, not a heuristic. Postponements are
           left alone for import_schedule.py to re-import with the new
           kickoff time. */
        const rawAway = by.away.score, rawHome = by.home.score;
        const noScore = rawAway == null || rawHome == null ||
                        rawAway === '' || rawHome === '';
        const st = (c.status && c.status.type) || {};
        const abandoned = /postponed|canceled|cancelled|suspended/i
          .test(`${st.name || ''} ${st.description || ''} ${st.detail || ''}`);

        if (state === 'post' && (abandoned || (noScore && +rawAway === 0 && +rawHome === 0))) {
          console.log(`skipping ${gid}: reported final with no score `
            + `(${st.description || st.name || 'no status'}) — not a played game`);
          continue;
        }

        const patch = { status: { pre: 'scheduled', in: 'live', post: 'final' }[state] };
        if (state !== 'pre') {
          patch.awayScore = +(rawAway || 0);
          patch.homeScore = +(rawHome || 0);
          if (state === 'post') {
            patch.winner = patch.homeScore > patch.awayScore ? home
              : patch.awayScore > patch.homeScore ? away : null;
          }
        }
        if (Object.entries(patch).every(([k, v]) => old[k] === v)) continue;
        await fsPatch(env, `seasons/${season}/games/${gid}`, patch);
        changed++;
      } catch (e) {
        // One bad event must not cost the rest of the slate its scores.
        console.log('score event failed', wk, String(e));
      }
    }
  }
  if (unmatched.length) console.log('NO MATCHING GAME:', unmatched.join(', '));
  // Phones hold onSnapshot listeners on these documents, so the Grid
  // updates within a second of this write. No snapshot job in between.
  return { weeks, changed };
}

/* Fire a real notification immediately, so alerts can be verified in
   thirty seconds instead of waiting for a kickoff window.

   /__live/test?key=...            everyone in every pool this season
   /__live/test?key=...&name=Lee   just that person
*/
async function testPush(env, params) {
  const season = env.SEASON || '2026';
  const only = (params.get('name') || '').toLowerCase();
  const pools = await fsQuery(env, '', 'pools', [['season', 'EQUAL', season]]);
  const out = [];

  for (const pool of pools) {
    const roster = await fsGet(env, `pools/${pool._id}/private/roster`) || {};
    for (const [uid, info] of Object.entries(roster)) {
      if (uid.startsWith('_') || !info) continue;
      const name = info.name || uid;
      if (only && name.toLowerCase() !== only) continue;
      const tokens = info.tokens || [];
      if (!tokens.length) {
        out.push({ name, sent: 0, delivered: 0, note: 'NO TOKEN — this person gets nothing' });
        continue;
      }
      /* Report what actually happened per device.

         This used to count the tokens it looped over and call that
         "sent", while push() returned nothing and swallowed every error.
         So the one endpoint whose entire job is answering "do
         notifications work?" replied `{sent: 2}` with total confidence
         while Google had rejected both messages. A diagnostic that cannot
         report failure is worse than no diagnostic: it ends the
         investigation at the exact point it should have started it. */
      const dead = [];
      let delivered = 0, failed = 0;
      for (const t of tokens) {
        const res = await push(env, t, 'Test alert',
          `If you can read this, ${name}, your reminders are working. Nothing to do.`,
          true, { tag: 'pickem-test' });
        if (res === 'ok') delivered++;
        else if (res === 'dead') dead.push(t);
        else failed++;
      }
      await pruneTokens(env, pid_of(pool), uid, info, dead);
      out.push({
        name, devices: tokens.length, delivered,
        dead: dead.length, failed,
        ok: delivered > 0,
        note: delivered > 0 ? 'delivered to at least one device'
            : dead.length ? 'all tokens dead — this person must re-open the app and re-enable alerts'
            : 'FCM rejected every send — check the Worker log'
      });
    }
  }
  const reachable = out.filter(r => r.ok).length;
  return {
    season,
    people: out.length,
    reachable,
    unreachable: out.length - reachable,
    ok: out.length > 0 && reachable === out.length,
    results: out
  };
}

// pool objects carry their id as _id; kept as a helper so testPush reads
// the same way as the reminder loop.
const pid_of = pool => pool._id;

/* ============================================================
   REMINDERS — every 5 minutes, on time
   ============================================================ */
const TIERS = [
  ['open',  2880, 1440, false],
  ['day',   1440,  600, false],
  ['hours',  240,   90, false],
  ['final',   75,   10, true]
];

/* ============================================================
   SLATES — the unit a reminder is about

   A reminder used to be about a KICKOFF TIME. Sunday has three of them,
   so a Sunday produced three alerts that each named a different clock
   reading, and the number in each was the games locking at that one
   moment. Lee asked for the opposite: one alert per bunch of games, the
   bunch named the way football names it, counting that bunch's own
   unpicked games.

   THE NAME IS DECIDED IN NEW YORK, THE CLOCK IS SHOWN WHERE YOU ARE.
   "Thursday Night Football" is a fact about the NFL's schedule, not
   about the reader's timezone: in Iwakuni it kicks off on Friday
   morning, and the Picks tab already labels that card FRIDAY. If the
   slate were named from the reader's own zone, the same game would be
   Thursday night for most of the pool and Friday morning for one
   member, and the alert would disagree with the schedule everybody
   talks about. So: identity from ET, clock from `when()`.

   NOT "MORNING" AND "AFTERNOON". The mockup called the two Sunday
   bunches morning and afternoon, which is wrong for almost everybody —
   the early block is 1pm in New York and 2am in Japan, and neither is
   morning. "Early" and "late" are true in every timezone because they
   describe the order, not the hour. */
const SLATE_NAMES = {
  tnf:  'Thursday Night Football',
  sat:  'Saturday football',
  sun1: 'the early Sunday games',
  sun2: 'the late Sunday games',
  snf:  'Sunday Night Football',
  mnf:  'Monday Night Football',
  other:'the next games'
};
/* Weekday and hour in ET, with the small hours folded back into the
   night before: a 20:15 ET Thursday kickoff can run past midnight, and
   anything after it in the same window belongs to the same bunch. */
function etSlate(ms) {
  let dow, hour;
  try {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York',
      weekday: 'short', hour: 'numeric', hour12: false });
    for (const p of f.formatToParts(new Date(ms))) {
      if (p.type === 'weekday') dow = p.value;
      if (p.type === 'hour') hour = +p.value;
    }
  } catch { return 'other'; }
  if (hour == null || !dow) return 'other';
  const early = hour < 5;          // still the previous night's slate
  if (dow === 'Thu' || (dow === 'Fri' && early)) return 'tnf';
  if (dow === 'Sat' || (dow === 'Sun' && early)) return 'sat';
  if (dow === 'Mon' && !early) return 'mnf';
  if (dow === 'Tue' && early) return 'mnf';
  if (dow === 'Sun') {
    if (hour >= 19) return 'snf';
    if (hour >= 15) return 'sun2';
    return 'sun1';
  }
  if (dow === 'Mon' && early) return 'snf';   // SNF running past midnight
  return 'other';
}

/* ============================================================
   POKE GITHUB TO PULL SCORES

   WHY A WORKER TRIGGERS A GITHUB JOB, which looks absurd written down.

   The two halves of this system each have exactly one thing they cannot
   do, and they are different things:

     This Worker       fires every 5 minutes, reliably, forever —
                       1,640 invocations in 24 hours, never a miss.
                       CANNOT reach ESPN: Akamai answers Cloudflare's
                       egress with a deny page (`espn 403 :: Access
                       Denied`) on the address, not the request.
     GitHub Actions    CAN reach ESPN and runs the pull green in 23
                       seconds every time it is asked.
                       CANNOT be relied on to ask itself. An
                       every-five-minutes schedule honoured 1 tick in
                       ~36, that one ~90 minutes late; a single-fire
                       cron was still absent 52 minutes past its slot.

                       (Written without the cron spelling on purpose:
                       an asterisk-slash inside a block comment ends the
                       comment, and writing it here the obvious way is
                       what broke this file the first time.)

   So the reliable clock pokes the capable runner. Neither side is doing
   anything it is bad at.

   WHY IT ASKS FIRESTORE INSTEAD OF READING A CRON WINDOW: because a
   window is a guess that has to be maintained, and it has to be
   maintained twice — once for EDT and once for EST — and it is wrong for
   a flexed game, a postponed game, and the first week of the season,
   which had a Wednesday opener. "Is a game in progress right now" is a
   fact, and this Worker already holds the credentials to ask it. No
   games on, no dispatch, no GitHub run, nothing to explain.

   COST: one Firestore query per 5 minutes (a range on `kickoff`, single
   field, no composite index), and one GitHub run per 5 minutes only
   while a game is actually being played. A full Sunday is roughly 130
   dispatches of a 25-second job — free on a public repository.

   IT WRITES NOTHING ITSELF. It cannot: the workflow it triggers runs
   `--scores-only`, which returns before score_pools() and notify(). The
   separation survives the indirection.
   ============================================================ */

/* A game nobody ever marks final would otherwise keep this dispatching
   forever. Six hours covers overtime and a weather delay and still ends
   the same night — the same ceiling index.html uses for its own ESPN
   polling, deliberately. */
const NUDGE_MAX_AGE = 6 * 3600 * 1000;

async function nudgeScores(env, force = false) {
  /* NO TOKEN IS NOT AN ERROR. Until the secret is set this Worker must
     keep doing its real job — reminders — without a red mark in the
     log every five minutes. Say so once, quietly, and return. */
  if (!env.GH_TOKEN) return { skipped: 'GH_TOKEN not set' };
  const repo = env.GH_REPO || 'mnqlee/pickem';
  const season = env.SEASON || '2026';
  const now = Date.now();

  /* Both filters are ranges on the SAME field, which is what keeps this
     a single-field query needing no composite index — the same shape
     remind() uses a few lines down. */
  const started = await fsQuery(env, `/seasons/${season}`, 'games', [
    ['kickoff', 'GREATER_THAN', new Date(now - NUDGE_MAX_AGE)],
    ['kickoff', 'LESS_THAN',    new Date(now)]
  ]);
  /* `status` is what only the server writes, so this is the honest
     question: has a game kicked off that nobody has recorded a result
     for yet. */
  const live = started.filter(g => g.status !== 'final');
  /* `force` EXISTS TO TEST THE LAST UNTESTED LINK, and only that.

     Everything else about this path can be proved on a quiet Saturday:
     the ADMIN_KEY gate answers, the token is read, the Firestore query
     returns. What cannot be proved without actually POSTing is whether
     the token carries `Actions: Read and write` — a token scoped wrong
     looks perfect right up until GitHub answers 403, and without this
     flag the first time that happens is during a game.

     So `?force=1` skips only the is-anything-live test. It is behind
     ADMIN_KEY, and the worst it can do is run a scores pull that finds
     nothing changed — which is what the pull does all day anyway.
     The scheduled path never sets it. */
  if (!live.length && !force) return { skipped: 'nothing live' };

  /* TRIMMED, AND THAT IS A FIX RATHER THAN TIDINESS.

     A secret set by pasting into a terminal prompt very often arrives
     with a trailing newline or a stray space on the end. Whitespace is
     not legal inside an HTTP header value, so `Bearer <token>\n` is a
     malformed header — and a malformed header is rejected in front of
     GitHub's API, which answers 400 with an EMPTY body rather than the
     JSON {"message": ...} the API itself always returns. An empty-bodied
     400 is therefore the signature of this exact fault, and it cost a
     round trip to recognise. */
  const tok = String(env.GH_TOKEN).trim();

  const r = await fetch(
    `https://api.github.com/repos/${repo}/actions/workflows/scores.yml/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tok}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        // GitHub rejects an API request with no User-Agent outright.
        'User-Agent': 'pickem-live-worker',
        'Content-Type': 'application/json'
      },
      // Schedules and dispatches both only run from the default branch.
      body: JSON.stringify({ ref: 'main' })
    });

  /* 204 No Content is success here — there is no body to read, and
     treating a falsy body as failure would log an error on every
     successful dispatch. Anything else, log the reason: a revoked or
     under-scoped token gives 403 with a message worth reading, and a
     renamed workflow file gives 404. */
  if (r.status === 204) {
    console.log(`nudge: ${live.length} live, dispatched scores.yml${force ? ' (forced)' : ''}`);
    return { dispatched: true, live: live.length, ...(force ? { forced: true } : {}) };
  }
  /* RETURN THE REASON, DO NOT JUST LOG IT.

     This used to log GitHub's explanation and hand back only
     `{dispatched:false, status:400}`. A bare status is a riddle: 403 is
     permissions, 404 is a missing workflow, 422 is a bad ref — and 400
     is none of those and means reading the body is the only way to
     know. Logging it to a sink nobody has open, while the person
     holding the URL gets a number, is the identical mistake this file
     already made once with the word "forbidden".

     Safe to return: GitHub's error bodies describe the REQUEST, never
     the credential, and this endpoint is behind ADMIN_KEY. */
  const why = await r.text().then(t => t.slice(0, 300).replace(/\s+/g, ' '))
                            .catch(() => '(body unreadable)');

  /* THE TOKEN'S SHAPE, NEVER ITS VALUE.

     A 400 with an empty `why` says the request never reached GitHub's
     API, and the only part of it that a paste can corrupt is the
     credential. Without this, the next step is guessing; with it, a
     truncated or whitespace-laden secret is obvious at a glance.

     What it discloses is deliberately useless to anyone: which public
     prefix family the token is from, how long it is (a published,
     fixed length for each family), and whether it contains anything
     outside [A-Za-z0-9_]. No character of the token itself, and the
     whole endpoint is behind ADMIN_KEY. Shown only on failure. */
  const raw = String(env.GH_TOKEN);
  const shape = {
    family: /^github_pat_/.test(tok) ? 'github_pat_ (fine-grained)'
          : /^ghp_/.test(tok)        ? 'ghp_ (classic)'
          : 'unrecognised prefix — is this a GitHub token at all?',
    length: tok.length,
    hadSurroundingWhitespace: raw !== tok,
    onlyTokenCharacters: /^[A-Za-z0-9_]+$/.test(tok)
  };
  console.log(`nudge: dispatch failed ${r.status} :: ${why || '(empty body)'} ` +
              `:: token ${shape.family}, ${shape.length} chars, ` +
              `clean=${shape.onlyTokenCharacters}, trimmed=${shape.hadSurroundingWhitespace}`);
  return { dispatched: false, status: r.status,
           why: why || '(empty body — the request was rejected before GitHub\'s API)',
           token: shape };
}

async function remind(env, dry = false) {
  const season = env.SEASON || '2026';
  const now = Date.now();
  const sent = [];

  const upcoming = await fsQuery(env, `/seasons/${season}`, 'games', [
    ['kickoff', 'GREATER_THAN', new Date(now)],
    ['kickoff', 'LESS_THAN', new Date(now + 2880 * 60000)]
  ]);
  if (!upcoming.length) return { skipped: 'nothing upcoming' };

  const pools = await fsQuery(env, '', 'pools', [['season', 'EQUAL', season]]);
  // Surfaced in the run output so a silent non-delivery is visible.
  const unreachable = new Set();

  for (const pool of pools) {
    const pid = pool._id;
    const roster = await fsGet(env, `pools/${pid}/private/roster`) || {};
    const uids = Object.keys(roster).filter(k => !k.startsWith('_'));
    if (!uids.length) continue;

    const weeks = [...new Set(upcoming.map(g => g.wk))];
    /* EVERY GAME OF THE WEEK THAT CAN STILL BE PICKED — which is not the
       same set as `upcoming`, and that difference is why the week-level
       count needs its own query.

       `upcoming` stops at 48 hours because that is the widest reminder
       tier. On a Saturday, Monday night football is 72 hours out, so it
       is absent — and a "unpicked this week" figure built from
       `upcoming` would have quietly under-counted by exactly the games
       nobody has thought about yet.

       Filtered to kickoff > now on purpose: a game that has already
       locked is not something the player can act on, and counting it
       would make the number an accusation rather than a to-do list.

       One equality query per week per run, so one or two per five
       minutes. Cheap, and it is the number the message is about. */
    const stillOpen = {};
    for (const w of weeks) {
      stillOpen[w] = (await fsQuery(env, `/seasons/${season}`, 'games',
        [['wk', 'EQUAL', w]])).filter(g => g.kickoff.getTime() > now);
    }
    const picks = {};
    for (const w of weeks) {
      for (const p of await fsQuery(env, `/pools/${pid}`, 'picks', [['wk', 'EQUAL', w]])) {
        /* A cleared pick is stored as a tombstone (winner: null) because
           picks can never be deleted. Counting one as a pick meant the
           person who un-picked a game to think again was recorded as
           already done: no "last call" reminder for it, no reminder at
           all if the whole slot was cleared, and a zero on Sunday for
           the exact case these alerts exist to prevent. The client and
           score_week.py both filter these; this path did not. */
        if (p.winner == null) continue;
        (picks[p.uid] ||= new Set()).add(p.gameId);
      }
    }

    for (const [tier, lo, hi, urgent] of TIERS) {
      const inTier = upcoming.filter(g => {
        const m = (g.kickoff.getTime() - now) / 60000;
        return m >= hi && m <= lo;
      });
      if (!inTier.length) continue;

      /* GROUPED BY SLATE, NOT BY KICKOFF TIME. Three Sunday kickoff
         times used to mean three alerts; they are one bunch now, and
         the bunch's deadline is its FIRST kickoff, because that is the
         moment picking stops mattering for part of it. */
      const bunches = {};
      for (const g of inTier) (bunches[etSlate(g.kickoff.getTime())] ||= []).push(g);

      for (const [slate, games] of Object.entries(bunches)) {
        const wk = games[0].wk;
        const firstKick = Math.min(...games.map(g => g.kickoff.getTime()));
        const mins = Math.round((firstKick - now) / 60000);
        /* EVERY GAME IN THIS BUNCH, not only the ones inside the tier
           window. The window is what decides WHEN to send; the bunch is
           what the message is about, and a count built from the window
           would drop a game that kicks off twenty minutes after the
           rest of its own slate. */
        const fromWeek = (stillOpen[wk] || [])
          .filter(g => etSlate(g.kickoff.getTime()) === slate);
        /* stillOpen is a separate query and can come back short: one
           failed read, or a game whose kickoff moved. Falling back to
           the games already in hand means a thin week sends a slightly
           smaller count, rather than sending nothing at all — and
           `missing` is built from the same list, so the count and the
           decision to send can never disagree. */
        const inSlate = fromWeek.length ? fromWeek : games;
        const slateTotal = inSlate.length;

        for (const uid of uids) {
          const info = roster[uid] || {};
          const tokens = info.tokens || [];
          if (!tokens.length) { unreachable.add(info.name || uid); continue; }
          if ((info.prefs || {})[tier] === false) continue;

          /* UNPICKED IN THE WHOLE BUNCH, which is the number the message
             carries, and also the test for whether to send at all: a
             bunch you have finished is never mentioned again. */
          const mine0 = picks[uid] || new Set();
          const missing = inSlate.filter(g => !mine0.has(g._id));
          if (!missing.length) continue;

          const tz = info.tz || 'America/New_York';
          if (!urgent && quiet(tz)) continue;

          /* KEYED BY SLATE NOW. It was keyed by kickoff time, which is
             what made three Sunday alerts three separate dedupe
             entries. One bunch, one entry, one alert per tier. */
          const key = `r:${pid}:${uid}:${wk}:${slate}:${tier}`;
          if (await env.SESSIONS.get(key)) continue;

          const n = missing.length;
          const { title, body } = compose(tier, slate, info.name,
            n, slateTotal, when(firstKick, tz), mins);
          if (dry) { sent.push({ uid, tier, n, slate, title }); continue; }

          /* Only record a reminder as sent if it ACTUALLY reached a
             device. The marker used to be written unconditionally, right
             after a push() that reported nothing — so a reminder that
             Google rejected (which, per push()'s note, was all of them)
             was permanently marked delivered for that person, that week,
             that slot, and could never be retried. A silent failure that
             also suppresses its own retry is the worst shape a bug can
             take: the logs say "sent", the phone stays quiet, and no
             later fix can recover the notification.

             A dead token is a real answer too — it means "this device is
             gone", not "try again in five minutes" — so it counts as
             delivered for dedupe purposes while the token is pruned. */
          const dead = [];
          let delivered = 0, failed = 0;
          for (const tk of tokens) {
            const res = await push(env, tk, title, body, urgent);
            if (res === 'ok') delivered++;
            else if (res === 'dead') dead.push(tk);
            else failed++;
          }
          await pruneTokens(env, pid, uid, info, dead);

          sent.push({ uid, tier, n, slate, title, delivered, dead: dead.length, failed });
          if (delivered === 0 && failed > 0) {
            // Nothing landed and the reason was transient. Leave the
            // marker unwritten so the next run tries again.
            console.log(`reminder NOT delivered to ${info.name || uid} (${tier}) — will retry`);
            continue;
          }
          // 3-day TTL: long enough to prevent a repeat, short enough
          // that KV never accumulates.
          await env.SESSIONS.put(key, '1', { expirationTtl: 259200 });
        }
      }
    }
  }
  if (unreachable.size) console.log('NO PUSH TOKEN:', [...unreachable].join(', '));
  return { sent: sent.length, detail: sent,
           unreachable: [...unreachable] };
}

function quiet(tz) {
  try {
    const h = +new Intl.DateTimeFormat('en-US',
      { timeZone: tz, hour: 'numeric', hour12: false }).format(new Date());
    return h >= 22 || h < 7;
  } catch { return false; }
}
function when(ms, tz) {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short',
      hour: 'numeric', minute: '2-digit' }).format(new Date(ms));
  } catch { return 'kickoff'; }
}
/* WHAT A REMINDER SAYS, in Lee's own words and nothing more.

     title   Lee, Thursday Night Football
     body    Kicks off in 22 min. No team selected yet.
             Unselected games score 0.

   HOW IT GOT HERE, because two earlier versions of this function were
   both true and both misread. The first had a week-level title over a
   slot-level body: "Week 1 is open" above "1 game to pick", sent to
   somebody with the whole Sunday slate unpicked. The second inverted
   it: "1 pick due Fri 9:15 AM" above "16 Week 2 games still need a
   pick", where the title counts one deadline and the body counts the
   week, so the 1 reads as the whole job and the 16 arrives as a
   contradiction. Lee got that one and said what it should say instead.

   The fix is not a better sentence, it is a different unit. The alert
   is about a NAMED BUNCH of games and every number in it counts that
   bunch, so there is nothing left to mistake one figure for.

   THE NAME IS ON EVERY ALERT, which Lee asked for and which also solves
   something real: two accounts on one phone used to produce two
   identical notifications with no way to tell them apart.

   ONE GAME GETS NO COUNT. "1 of 1 unpicked" is a worse sentence than
   "No team selected yet", so the single-game bunches say the latter.

   THE WARNING STARTS AT A FEW HOURS OUT. Two days before kickoff,
   "unselected games score 0" is a warning about a hypothetical, and it
   was also what pushed the body onto a third line — which iOS hides
   behind a pull-down in a stacked notification.

   NO DASHES. A full stop where one joined two clauses, a comma where it
   joined a countdown to a clock reading. */
function compose(tier, slate, who, unpicked, total, w, mins) {
  const name = SLATE_NAMES[slate] || SLATE_NAMES.other;
  /* The title is a label, so the name only earns its place when there
     is one: a roster row with no display name would otherwise produce
     ", Thursday Night Football". */
  const title = who ? `${who}, ${name}` : name;
  const hrs = Math.max(1, Math.round(mins / 60));
  const when = tier === 'final' ? `in ${mins} min`
    : tier === 'hours' ? `in ${hrs} hour${hrs === 1 ? '' : 's'}`
    : tier === 'day'   ? `in ${hrs} hours, ${w}`
    : w;
  const lead = total === 1 ? `Kicks off ${when}` : `First kickoff ${when}`;
  const what = total === 1
    ? 'No team selected yet.'
    : `${unpicked} game${unpicked === 1 ? '' : 's'} unpicked.`;
  const warn = (tier === 'hours' || tier === 'final')
    ? ' Unselected games score 0.' : '';
  return { title, body: `${lead}. ${what}${warn}` };
}


/* Send one notification. Returns 'ok' | 'dead' | 'fail' — the CALLER has
   to know, and it used to be told nothing at all.

   Three faults lived in the twelve lines this replaces, and together they
   are why a "sent" reminder could reach nobody while every log looked fine:

   1. `fcm_options.link` was the RELATIVE string '/index.html'. FCM requires
      an absolute HTTPS URL and rejects the whole message with 400
      INVALID_ARGUMENT — so every web push this Worker ever sent was
      refused by Google before it reached a single device.
   2. The failure went to a console line nobody reads, and the caller then
      wrote its "already reminded" marker anyway — permanently marking the
      reminder as delivered for that person, that week, that slot. It would
      never be retried, so even after the bug above was fixed the missed
      ones would stay missed.
   3. `tag: title` collapses notifications that share a title. Two slates
      both producing "Last call, 2 games" replaced one another on the
      phone, so the second silently overwrote the first.

   UNREGISTERED / INVALID_ARGUMENT against the token means that token is
   dead — app deleted, browser data cleared — and it gets pruned. */
async function push(env, tk, title, body, urgent, opts = {}) {
  let t;
  try { t = await token(env); }
  catch (e) { console.log('push: no access token', String(e)); return 'fail'; }

  const origin = (env.APP_ORIGIN || 'https://nflweeklypickem.com').replace(/\/+$/, '');
  let r;
  try {
    r = await fetch(
      `https://fcm.googleapis.com/v1/projects/${env.GCP_PROJECT}/messages:send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: {
          token: tk,
          notification: { title, body },
          webpush: {
            fcm_options: { link: origin + '/index.html' },   // must be absolute
            headers: { Urgency: urgent ? 'high' : 'normal', TTL: String(opts.ttl ?? 3600) },
            notification: {
              renotify: !!urgent,
              // Unique per message unless a caller deliberately groups.
              tag: opts.tag || `${title}|${Date.now()}`,
              requireInteraction: !!urgent,
              icon: origin + '/icons/icon-192.png',
              badge: origin + '/icons/icon-192.png'
            }
          }
        } })
      });
  } catch (e) {
    console.log('push: network failure', String(e));
    return 'fail';
  }

  if (r.ok) return 'ok';

  const txt = await r.text().catch(() => '');
  console.log('push failed', r.status, txt.slice(0, 300));
  if (r.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/i.test(txt)) return 'dead';
  return 'fail';
}

/* Drop tokens FCM has told us are dead.

   Without this a stale token rides along for the rest of the season:
   every run retries it, every run logs the same failure, and someone
   whose only remaining token is dead still counts as "reachable" in the
   report that is supposed to name the people getting nothing. */
async function pruneTokens(env, pid, uid, info, dead) {
  if (!dead.length || !info || !Array.isArray(info.tokens)) return;
  const keep = info.tokens.filter(t => !dead.includes(t));
  if (keep.length === info.tokens.length) return;
  try {
    /* Patch the tokens LEAF, not the whole member entry.

       Writing `{[uid]: {...info, tokens: keep}}` replaces that member's
       entire map with a copy read at the top of the run — so a player
       tapping "Turn alerts on" on a new laptop while this cron was
       running had their brand-new token written straight back out again,
       silently, and never got a reminder on that device. Same for a
       preference toggle. The client uses dotted leaf paths for exactly
       this reason; this is the matching form. */
    await fsPatch(env, `pools/${pid}/private/roster`, { [`${uid}.tokens`]: keep });
    console.log(`pruned ${dead.length} dead token(s) for ${info.name || uid}`);
  } catch (e) {
    console.log('token prune failed (non-fatal)', String(e));
  }
}
