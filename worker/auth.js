/* ============================================================
   Weekly NFL Pick'em — auth Worker

   Four endpoints on your own domain:
     POST /api/request-code   email  -> mails a 6-digit PIN
     POST /api/verify-code    PIN    -> Firebase token + session cookie
     GET  /api/session        cookie -> fresh Firebase token, no email
     POST /api/logout         clears the cookie

   WHY THE COOKIE EXISTS
   Firebase keeps its session in IndexedDB, which Safari evicts after
   about a week of not visiting. For a weekly pool that means people get
   signed out over bye weeks and the offseason.

   Because this Worker runs on your own domain, it can set a first-party
   HttpOnly cookie, which is not script-writable storage and is not
   subject to the same eviction. The app calls /api/session on launch and
   is signed back in without touching email. This is the single biggest
   practical reason to pay for the domain.

   HOW THE PIN WORKS  (changed 2026-08-29 — read this before editing)
   The PIN is DERIVED, not stored. It is an HMAC of the address and the
   current five-minute window, so /api/verify-code can recompute it from
   scratch and never has to read back what /api/request-code wrote.

   That matters because the old design stored the PIN hash in KV and read
   it back on verify. Cloudflare KV is eventually consistent: a value
   written at one edge location is not guaranteed visible at another for
   up to ~60s, and a previous miss on a key can stay negatively cached
   just as long. Since a successful sign-in DELETED the key, the next
   sign-in from the same address could read a stale "not there" and
   answer "that code has expired" for a code that was seconds old and
   perfectly correct. That is the flakiness. Deriving the PIN removes the
   read entirely, so there is nothing left to be stale.

   The tradeoff, stated plainly: a derived PIN cannot be burned on first
   use without reintroducing exactly the KV read this change removed. So
   a PIN stays valid for its whole window (10-15 minutes) and can be
   submitted more than once. Whoever holds it holds the inbox and could
   simply request another, so the real-world exposure is unchanged — and
   in exchange, a double-tap, a retried request, or a dropped response
   now all just succeed instead of reporting a false expiry.

   BINDINGS (wrangler.toml)
     KV namespace   PINS        rate limiting + failed-attempt counters
     KV namespace   SESSIONS    session id -> uid
     secret         SA_JSON     Firebase service account JSON
     secret         RESEND_KEY  Resend API key
     var            FROM_EMAIL  "Weekly NFL Pick'em <picks@yourdomain.com>"
     var            APP_ORIGIN  "https://yourdomain.com"
   optional:
     secret         PIN_SECRET  HMAC key for the PIN. If absent the key is
                                derived from SA_JSON, so nothing needs to
                                be set up for this to work. Setting it
                                later is a clean upgrade; it only means
                                codes in flight at that moment stop
                                matching, which resolves itself in a few
                                minutes.
   ============================================================ */

const STEP = 300;                       // PIN window, seconds
const GRACE = 2;                        // also accept this many past windows
                                        // -> a code is good for 10-15 minutes
const MAX_ATTEMPTS = 5;                 // wrong guesses per address
const MAX_IP_ATTEMPTS = 30;             // wrong guesses per IP, all addresses
const ATTEMPT_TTL = 900;                // how long those counters live
const SESSION_TTL = 90 * 24 * 3600;     // 90 days — covers a bye week
const REQUEST_COOLDOWN = 45;            // seconds between sends per address.
                                        // Deliberately shorter than the 60s
                                        // resend countdown in the UI, so a
                                        // user who taps Resend the moment it
                                        // unlocks is never turned away.

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = {
      'Access-Control-Allow-Origin': env.APP_ORIGIN,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

    try {
      switch (url.pathname) {
        case '/api/request-code': return await requestCode(req, env, cors);
        case '/api/verify-code':  return await verifyCode(req, env, cors);
        case '/api/session':      return await session(req, env, cors);
        case '/api/logout':       return await logout(req, env, cors);
      }
      return json({ error: 'not_found' }, 404, cors);
    } catch (e) {
      // Never hand a stack trace to the public internet. `wrangler tail`
      // shows this line with the real detail when something goes wrong.
      console.error('unhandled', url.pathname, e && e.stack || String(e));
      return json({ error: 'server_error' }, 500, cors);
    }
  }
};

/* ---------- helpers ---------- */
const json = (o, s = 200, h = {}) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json', ...h } });

const norm = e => String(e || '').trim().toLowerCase();
const validEmail = e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

/* The address a player IS, as opposed to the one they typed.

   Gmail ignores dots in the local part and treats everything after a "+"
   as a tag, so lee.smith@gmail.com, leesmith@gmail.com and
   leesmith+pickem@gmail.com are one inbox. Without this they would be
   three uids: the same person signing in a different way in week 6 turns
   up as a brand new player with an empty sheet, while their real picks
   sit under the spelling they used in week 1. That is a miserable bug to
   be on the receiving end of and it is invisible until it happens.

   Deliberately NOT applied to any other domain. Plenty of hosts treat "+"
   as an ordinary character, and merging there would mean whoever controls
   name+anything@host inherits name@host's account. Gmail's rules are
   documented and unambiguous; nobody else's are. */
function canonical(raw) {
  const e = norm(raw);
  const at = e.lastIndexOf('@');
  if (at < 1) return e;
  let local = e.slice(0, at);
  const domain = e.slice(at + 1);
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    local = local.split('+')[0].replace(/\./g, '');
    if (!local) return e;                 // "+tag@gmail.com" — leave it alone
    return local + '@gmail.com';          // googlemail is an alias of gmail
  }
  return e;
}
const clientIp = req => req.headers.get('CF-Connecting-IP') || 'unknown';

/** Body parsing that answers 400 instead of throwing a 500 on junk input. */
async function readJson(req) {
  try { return await req.json(); } catch { return null; }
}

async function sha(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}

/** Constant-time compare so a timing signal can't leak the PIN. */
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/* ---------- the derived PIN ---------- */

/* Imported once per isolate. importKey is not free and request-code /
   verify-code are the two hottest paths in the app. */
let pinKey = null;
async function getPinKey(env) {
  if (pinKey) return pinKey;
  // PIN_SECRET if you set one, otherwise the service account's private key.
  // Both are high-entropy secrets this Worker already holds; the prefix is
  // domain separation so this use can never collide with the key's real job
  // of signing Firebase tokens.
  const material = env.PIN_SECRET || JSON.parse(env.SA_JSON).private_key;
  const raw = new TextEncoder().encode('pickem-pin-v1|' + material);
  pinKey = await crypto.subtle.importKey(
    'raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return pinKey;
}

/** The 6-digit code for one address in one time window. */
async function pinFor(env, email, window) {
  const key = await getPinKey(env);
  const sig = await crypto.subtle.sign(
    'HMAC', key, new TextEncoder().encode(`${email}|${window}`));
  const b = new Uint8Array(sig);
  // Standard HOTP-style truncation: take the low 31 bits so the result is
  // positive and uniformly distributed across 0-999999.
  const n = ((b[0] & 0x7f) << 24 | b[1] << 16 | b[2] << 8 | b[3]) % 1000000;
  return String(n).padStart(6, '0');
}

const currentWindow = () => Math.floor(Date.now() / 1000 / STEP);

/* ---------- 1. request a code ---------- */
async function requestCode(req, env, cors) {
  const body = await readJson(req);
  if (!body) return json({ error: 'bad_request' }, 400, cors);

  // Identity is the canonical address; the mail still goes to the one they
  // actually typed, so nobody gets a code at an address they don't
  // recognise. Both must be well formed.
  const typed = norm(body.email);
  const e = canonical(typed);

  // A malformed address is the user's typo, not a probe — telling them is
  // strictly better than sending them to a PIN screen for a code that can
  // never arrive. This reveals nothing about who is in the pool, because
  // it is a check on the SHAPE of the address only.
  if (!validEmail(typed) || !validEmail(e)) return json({ error: 'bad_email' }, 400, cors);

  // Rate limit. On a hit we still answer 200 with the same shape, because
  // a code from the last 45s is in their inbox and — since PINs are derived
  // per window — it is the very same code we would send again. The flag
  // exists so the UI can say something true instead of pretending it sent.
  const throttled = await env.PINS.get(`rl:${e}`);
  if (throttled) return json({ ok: true, throttled: true }, 200, cors);

  const pin = await pinFor(env, e, currentWindow());

  // Send FIRST, then set the cooldown. The old order set the cooldown
  // before sending, so a Resend outage left the address locked out of
  // retrying for a minute on top of having received nothing.
  try {
    await sendPin(env, typed, pin);
  } catch (err) {
    console.error('resend failed', String(err));
    return json({ error: 'send_failed' }, 502, cors);
  }

  await env.PINS.put(`rl:${e}`, '1', { expirationTtl: REQUEST_COOLDOWN });
  return json({ ok: true }, 200, cors);
}

async function sendPin(env, email, pin) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.FROM_EMAIL,
      to: [email],
      subject: `${pin} is your Pickem code`,
      text: `Your code is ${pin}\n\nIt expires in 10 minutes. If you didn't ask for this, ignore it.`,
      html: `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:420px;margin:0 auto;padding:32px 24px">
        <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#6B6862;font-weight:700">Weekly NFL Pickem</div>
        <h1 style="font-size:22px;margin:14px 0 6px;color:#15171B">Your sign-in code</h1>
        <p style="font-size:14px;color:#6B6862;margin:0 0 22px">Type this into the app. It expires in 10 minutes.</p>
        <div style="font-size:38px;font-weight:800;letter-spacing:.16em;color:#C8342A;
             font-family:ui-monospace,Menlo,monospace;padding:18px;text-align:center;
             background:#FAF7F1;border:2px solid #C8342A;border-radius:12px">${pin}</div>
        <p style="font-size:12px;color:#9A968E;margin-top:22px">Didn't ask for this? Ignore it - nothing happens.</p>
      </div>`
    })
  });
  if (!r.ok) throw new Error('resend ' + r.status + ': ' + (await r.text()));
}

/* ---------- 2. verify ---------- */
async function verifyCode(req, env, cors) {
  const body = await readJson(req);
  if (!body) return json({ error: 'bad_request' }, 400, cors);

  const e = canonical(body.email);       // must match how the PIN was derived
  const code = String(body.code ?? '').trim();
  if (!validEmail(e) || !/^\d{6}$/.test(code)) {
    return json({ error: 'bad_request' }, 400, cors);
  }

  const ip = clientIp(req);

  /* Both counters fail OPEN: a missing value is read as zero. KV can be
     briefly stale, and the cost of that is a handful of extra guesses
     against a 1-in-a-million code — versus locking out someone who is
     typing the right code. Never trade a real user for a theoretical one.

     KNOWN LIMIT, on purpose: KV has no atomic increment, so this is a
     read-modify-write. Guesses fired in parallel all read the same count
     and the counter lands on 1 instead of N — meaning these two catch a
     person retrying by hand, which is their real job, but they do NOT
     stop a scripted parallel attack. Nothing built on KV can. That case
     belongs to a Cloudflare Rate Limiting rule on /api/verify-code,
     which is the layer that can actually see the flood. Rule to add:
     path contains /api/verify-code, 10 requests per 1 minute per IP,
     action Block. Do not raise these numbers instead — a bigger counter
     would still lose the same race. */
  const [tries, ipTries] = await Promise.all([
    countOf(env, `att:${e}`),
    countOf(env, `attip:${ip}`),
  ]);

  if (tries >= MAX_ATTEMPTS)     return json({ error: 'locked' }, 429, cors);
  if (ipTries >= MAX_IP_ATTEMPTS) return json({ error: 'locked' }, 429, cors);

  // Recompute the code for this window and the GRACE before it. No KV read,
  // so nothing here can be stale.
  const w = currentWindow();
  let hit = false;
  for (let i = 0; i <= GRACE; i++) {
    if (safeEqual(code, await pinFor(env, e, w - i))) { hit = true; break; }
  }

  if (!hit) {
    const left = Math.max(0, MAX_ATTEMPTS - (tries + 1));
    await Promise.all([
      bump(env, `att:${e}`, tries),
      bump(env, `attip:${ip}`, ipTries),
    ]);
    return json({ error: 'wrong_code', left }, 400, cors);
  }

  // Correct. Clear the address counter so one bad night doesn't follow
  // them into the next sign-in.
  await env.PINS.delete(`att:${e}`).catch(() => {});

  const uid = 'u_' + (await sha(e)).slice(0, 24);         // stable per address
  const sid = crypto.randomUUID();
  await env.SESSIONS.put(`s:${sid}`, JSON.stringify({ uid, email: e }),
                         { expirationTtl: SESSION_TTL });

  return json({ token: await mintToken(env, uid, e), uid }, 200,
    { ...cors, 'Set-Cookie': cookie(sid, SESSION_TTL) });
}

async function countOf(env, key) {
  const v = await env.PINS.get(key);
  const n = parseInt(v || '0', 10);
  return Number.isFinite(n) ? n : 0;
}

const bump = (env, key, from) =>
  env.PINS.put(key, String(from + 1), { expirationTtl: ATTEMPT_TTL }).catch(() => {});

/* ---------- 3. silent re-auth ---------- */
async function session(req, env, cors) {
  const sid = readCookie(req);
  if (!sid) return json({ error: 'no_session' }, 401, cors);

  const raw = await env.SESSIONS.get(`s:${sid}`);
  if (!raw) return json({ error: 'no_session' }, 401, cors);
  const { uid, email } = JSON.parse(raw);

  // Slide the window: active players never get logged out.
  await env.SESSIONS.put(`s:${sid}`, raw, { expirationTtl: SESSION_TTL });

  return json({ token: await mintToken(env, uid, email), uid }, 200,
    { ...cors, 'Set-Cookie': cookie(sid, SESSION_TTL) });
}

async function logout(req, env, cors) {
  const sid = readCookie(req);
  if (sid) await env.SESSIONS.delete(`s:${sid}`);
  return json({ ok: true }, 200, { ...cors, 'Set-Cookie': cookie('', 0) });
}

const readCookie = req => (req.headers.get('Cookie') || '')
  .split(';').map(c => c.trim().split('='))
  .find(([k]) => k === 'ps_session')?.[1];

const cookie = (v, age) =>
  `ps_session=${v}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${age}`;

/* ---------- Firebase custom token ----------
   Signed here with the service account, handed to the client, which
   calls signInWithCustomToken(). From that point they are an ordinary
   Firebase user and firestore.rules applies unchanged. */
async function mintToken(env, uid, email) {
  const sa = JSON.parse(env.SA_JSON);
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: sa.client_email, sub: sa.client_email,
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat: now, exp: now + 3600,
    uid, claims: { email }
  };
  const b64 = o => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const body = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(claim)}`;

  const pem = sa.private_key.replace(/-----[^-]+-----|\s/g, '');
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(body));
  const s64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${body}.${s64}`;
}
