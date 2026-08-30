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
    if (event.cron.startsWith('*/5')) ctx.waitUntil(guard('remind', remind(env)));
    else ctx.waitUntil(guard('scores', scores(env)));
  },
  /* Manual triggers. All require ?key= matching the ADMIN_KEY secret,
     because /test sends real notifications to real phones.
       /__live/scores   pull scores now
       /__live/remind   dry run: who WOULD be notified, sends nothing
       /__live/test     send a real push right now, to verify end to end
                        without waiting for a tier window                 */
  async fetch(req, env) {
    const u = new URL(req.url);
    const p = u.pathname;
    if (!p.startsWith('/__live/')) return new Response('not found', { status: 404 });
    if (!env.ADMIN_KEY || u.searchParams.get('key') !== env.ADMIN_KEY)
      return new Response('forbidden', { status: 403 });

    if (p === '/__live/scores') return json(await scores(env));
    if (p === '/__live/remind') return json(await remind(env, true));
    if (p === '/__live/test')   return json(await testPush(env, u.searchParams));
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
      const r = await fetch(`${ESPN}?seasontype=${stype}&week=${wk}&dates=${year}`);
      // A skipped week used to be completely silent. If ESPN is down through
      // the Sunday window, every score for that week quietly never lands.
      if (!r.ok) { console.log('espn', r.status, 'week', wk); continue; }
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

        const patch = { status: { pre: 'scheduled', in: 'live', post: 'final' }[state] };
        if (state !== 'pre') {
          patch.awayScore = +(by.away.score || 0);
          patch.homeScore = +(by.home.score || 0);
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
      if (!tokens.length) { out.push({ name, sent: 0, note: 'no token' }); continue; }
      for (const t of tokens) {
        await push(env, t, 'Test alert',
          `If you can read this, ${name}, your reminders are working. ` +
          `Nothing to do.`, true);
      }
      out.push({ name, sent: tokens.length });
    }
  }
  return { season, tested: out.length, results: out };
}

/* ============================================================
   REMINDERS — every 5 minutes, on time
   ============================================================ */
const TIERS = [
  ['open',  2880, 1440, false],
  ['day',   1440,  600, false],
  ['hours',  240,   90, false],
  ['final',   75,   10, true]
];

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
    const picks = {};
    for (const w of weeks) {
      for (const p of await fsQuery(env, `/pools/${pid}`, 'picks', [['wk', 'EQUAL', w]])) {
        (picks[p.uid] ||= new Set()).add(p.gameId);
      }
    }

    for (const [tier, lo, hi, urgent] of TIERS) {
      const inTier = upcoming.filter(g => {
        const m = (g.kickoff.getTime() - now) / 60000;
        return m >= hi && m <= lo;
      });
      if (!inTier.length) continue;

      const slots = {};
      for (const g of inTier) (slots[g.kickoff.getTime()] ||= []).push(g);

      for (const [slot, games] of Object.entries(slots)) {
        const wk = games[0].wk, mins = Math.round((+slot - now) / 60000);

        for (const uid of uids) {
          const info = roster[uid] || {};
          const tokens = info.tokens || [];
          if (!tokens.length) { unreachable.add(info.name || uid); continue; }
          if ((info.prefs || {})[tier] === false) continue;

          const missing = games.filter(g => !(picks[uid] || new Set()).has(g._id));
          if (!missing.length) continue;

          const tz = info.tz || 'America/New_York';
          if (!urgent && quiet(tz)) continue;

          const key = `r:${pid}:${uid}:${wk}:${slot}:${tier}`;
          if (await env.SESSIONS.get(key)) continue;

          const n = missing.length;
          const { title, body } = compose(tier, wk, n, when(+slot, tz), mins);
          sent.push({ uid, tier, n, title });
          if (dry) continue;

          for (const tk of tokens) await push(env, tk, title, body, urgent);
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
function compose(tier, wk, n, w, mins) {
  const g = n === 1 ? 'game' : 'games';
  if (tier === 'open')  return { title: `Week ${wk} is open`, body: `${n} ${g} to pick. First kickoff ${w} your time.` };
  if (tier === 'day')   return { title: `Week ${wk}, ${n} left`, body: `You still need ${n} ${n === 1 ? 'pick' : 'picks'} before ${w}.` };
  if (tier === 'hours') { const h = Math.max(1, Math.floor(mins / 60));
    return { title: `${n} unpicked`, body: `${h} hour${h > 1 ? 's' : ''} until kickoff. After that they score zero.` }; }
  return { title: `Last call, ${n} ${g}`, body: `Kickoff in ${mins} minutes. Unpicked games score zero.` };
}

async function push(env, tk, title, body, urgent) {
  const t = await token(env);
  const r = await fetch(
    `https://fcm.googleapis.com/v1/projects/${env.GCP_PROJECT}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: {
        token: tk,
        notification: { title, body },
        webpush: { fcm_options: { link: '/index.html' },
                   notification: { renotify: urgent, tag: title } }
      } })
    });
  if (!r.ok) console.log('push failed', r.status, await r.text());
}
