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
    if (req.method === 'OPTIONS') return new Response(null, {
      headers: {
        ...cors,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Max-Age': '86400',
      }
    });

    /* Every endpoint used to answer every method, which had two live
       consequences:

       · `GET /api/logout` worked, and SameSite=Lax sends the cookie on a
         top-level GET, so any page could sign a user out by opening that
         URL in a window.
       · `POST` with `Content-Type: text/plain` is a CORS-SIMPLE request:
         no preflight is sent, so the Allow-Headers gate never applies and
         the body is still parsed. Any website's visitors could therefore
         be made to fire /api/request-code at an address of the attacker's
         choosing — mailing codes from this domain, at the visitors' IPs,
         with the response unreadable but the send already done. */
    const METHOD = {
      '/api/request-code': 'POST',
      '/api/verify-code': 'POST',
      '/api/logout': 'POST',
      '/api/session': 'GET',
    }[url.pathname];
    if (METHOD && req.method !== METHOD) {
      return json({ error: 'method_not_allowed' }, 405, { ...cors, 'Allow': METHOD });
    }

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

/* A DELIVERY address, not an identity.

   `/^[^@\s]+@[^@\s]+\.[^@\s]+$/` is only a shape check, and it accepts
   plenty that is not an address anyone should be mailed at:
   `<victim@x.com>` (RFC 5322 angle-addr — mail servers deliver it to
   victim@x.com, so a stranger who never touched this app receives a
   DKIM-signed "your sign-in code" from this domain), `a@b.c,d.ee`,
   `"v"@x.cc`, `a|123@x.com`, and `victim@gmail.com.` — which slips past
   canonicalisation as a separate identity for the same inbox.

   So: no angle brackets, quotes, commas, semicolons, pipes or backslashes;
   nothing above ASCII; RFC-shaped labels in the domain; and the length
   caps from RFC 5321, which also keep an overlong address from being used
   to build a KV key longer than the 512-byte limit (that threw an
   uncaught 500 on the read path). */
function validEmail(e) {
  if (typeof e !== 'string') return false;
  if (e.length < 6 || e.length > 254) return false;
  if (/[<>,;"'\\\s]/.test(e)) return false;
  if (/[^\x20-\x7E]/.test(e)) return false;          // ASCII only
  const at = e.lastIndexOf('@');
  if (at < 1) return false;
  const local = e.slice(0, at), domain = e.slice(at + 1);
  if (!local.length || local.length > 64) return false;
  if (local.includes('@')) return false;
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain);
}

/* Which INBOX an address reaches, for rate-limiting only.

   Deliberately different from canonical() below, which answers "who is
   this person" and is conservative outside Gmail for a good reason. This
   one answers "whose mailbox does this fill up", where being aggressive
   is correct: essentially every provider delivers user+tag@host to
   user@host, so all such variants must share one send budget. Never use
   this to derive a uid — merging identities on domains whose rules we do
   not know is exactly the mistake canonical() avoids. */
function deliveryKey(raw) {
  const s = norm(raw);
  const at = s.lastIndexOf('@');
  if (at < 1) return s;
  return s.slice(0, at).split('+')[0] + '@' + s.slice(at + 1).replace(/\.$/, '');
}

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

/** Body parsing that answers 400 instead of throwing a 500 on junk input.

    The Content-Type check is load-bearing, not cosmetic: requiring
    application/json is what forces a browser to send a CORS preflight,
    which is what stops another site silently POSTing here on a visitor's
    behalf. The size cap keeps a multi-megabyte body from being parsed
    before any validation has run. */
async function readJson(req) {
  const ct = req.headers.get('Content-Type') || '';
  if (!ct.toLowerCase().startsWith('application/json')) return null;
  const len = Number(req.headers.get('Content-Length') || '0');
  if (len > 4096) return null;
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

  /* Atomic send limits, per delivery inbox and per IP.

     `deliveryKey()` strips +tags for EVERY domain, not just Gmail. The
     cooldown key used to be the canonical identity, which deliberately
     leaves +tags alone outside Gmail — so victim+1@, victim+2@, victim+3@
     were three different keys that all landed in one real inbox. That is
     an unbounded mail bomb from a single caller, and it burns the Resend
     quota and the sending domain's reputation along with it. Identity and
     delivery are different questions; only this one is about delivery. */
  if (!(await rateOk(env.SEND_LIMITER, `send:${deliveryKey(typed)}`)) ||
      !(await rateOk(env.SEND_LIMITER, `sendip:${clientIp(req)}`))) {
    return json({ error: 'too_many' }, 429, cors);
  }

  // Cooldown. On a hit we still answer 200 with the same shape, because
  // a code from the last 45s is in their inbox and — since PINs are derived
  // per window — it is the very same code we would send again. The flag
  // exists so the UI can say something true instead of pretending it sent.
  const throttled = await env.PINS.get(`rl:${deliveryKey(typed)}`);
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

  // The email is already on its way — nothing past this point may turn
  // that into a reported failure. This used to be an unguarded await
  // outside any try/catch, sitting inside the same function-level try
  // block that wraps ALL of requestCode() (see the fetch handler above).
  // A KV write is not guaranteed instant everywhere, and any hiccup here
  // — a transient error, a slow edge — threw, was caught by that OUTER
  // catch, and came back to the browser as 500 server_error: the app
  // showed "Something went wrong on our end" while the inbox already had
  // a working code. Losing this write only costs the 45s cooldown, so a
  // retry in that window sends one extra email with the same PIN
  // (pinFor is deterministic per window) — trivial next to telling
  // someone their code request failed when it didn't.
  try {
    await env.PINS.put(`rl:${deliveryKey(typed)}`, '1', { expirationTtl: REQUEST_COOLDOWN });
  } catch (err) {
    console.error('cooldown write failed (non-fatal, code already sent)', String(err));
  }
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
  /* The atomic gate, per address AND per IP. This is the layer that a
     scripted attack actually meets: the KV counters below can be raced,
     this cannot. Quantified, the old ceiling was roughly half a million
     guesses a day against a 1-in-a-million code across three live
     windows — a coin flip inside 24 hours, with no email ever sent to
     warn the account's owner, because guessing never touches the mailer. */
  if (!(await rateOk(env.PINS_LIMITER, `pin:${e}`)) ||
      !(await rateOk(env.PINS_LIMITER, `pinip:${ip}`))) {
    return json({ error: 'too_many' }, 429, cors);
  }

  const [tries, ipTries] = await Promise.all([
    countOf(env, `att:${e}`),
    countOf(env, `attip:${ip}`),
  ]);

  /* CHECK THE CODE FIRST, THEN THE COUNTERS.

     The lockout used to be evaluated BEFORE the code was compared, and it
     was cleared only by a successful sign-in. Those two facts together
     made a permanent, remotely-triggered account lock: send five wrong
     guesses for someone's address, and the real owner — typing the
     correct code out of their own inbox — hit `locked` before the
     comparison ran, so the branch that clears the counter was
     unreachable. Every further wrong guess also refreshed the 15-minute
     TTL, so one request every fourteen minutes held a player out of the
     pool indefinitely, for about a hundred requests a day, with no
     self-service way back in.

     A correct code is proof of inbox access, so it always wins. The
     counters exist to cap GUESSING, and guessing is what the !hit branch
     below does — they belong there, not in front of the door. */
  const w = currentWindow();
  let hit = false;
  for (let i = 0; i <= GRACE; i++) {
    if (safeEqual(code, await pinFor(env, e, w - i))) { hit = true; break; }
  }

  if (!hit) {
    if (tries >= MAX_ATTEMPTS)      return json({ error: 'locked' }, 429, cors);
    if (ipTries >= MAX_IP_ATTEMPTS) return json({ error: 'locked' }, 429, cors);
    const left = Math.max(0, MAX_ATTEMPTS - (tries + 1));
    await Promise.all([
      bump(env, `att:${e}`, tries),
      bump(env, `attip:${ip}`, ipTries),
    ]);
    return json({ error: 'wrong_code', left }, 400, cors);
  }

  /* Correct. Clear BOTH counters.

     Only the address counter used to be cleared. The per-IP one was left
     to expire on its own while every failure refreshed its TTL — so on a
     shared egress (mobile carrier NAT, an office, a school) thirty fumbled
     codes across a Sunday morning locked out everyone behind that address,
     and no amount of correct sign-ins could drain it. */
  await Promise.all([
    env.PINS.delete(`att:${e}`).catch(() => {}),
    env.PINS.delete(`attip:${ip}`).catch(() => {}),
  ]);

  const uid = 'u_' + (await sha(e)).slice(0, 24);         // stable per address

  /* Mint the token BEFORE writing any session state.

     mintToken() can throw — see the UTF-8 note on b64() — and it used to
     run after the session row had been written and the counter cleared.
     The user got a 500 with no cookie while an orphan session sat in KV,
     one more on every retry. Nothing is recorded until there is a token
     to record it for. */
  const token = await mintToken(env, uid, e);

  const sid = crypto.randomUUID();
  await env.SESSIONS.put(`s:${sid}`, JSON.stringify({ uid, email: e }),
                         { expirationTtl: SESSION_TTL });

  return json({ token, uid }, 200,
    { ...cors, 'Set-Cookie': cookie(sid, SESSION_TTL) });
}

/* Atomic, edge-evaluated rate limiting.

   `limiter.limit()` is a real counter — unlike the KV counters below, it
   cannot be beaten by firing requests in parallel, because there is no
   read-modify-write to race. The KV counters stay: they give the user the
   friendly "3 tries left" message and survive if the binding is absent.
   This is the layer that actually stops a script.

   Fails OPEN if the binding is missing (an older account without the
   rate-limiting API) so a config gap degrades to the previous behaviour
   rather than locking everyone out of their own pool. */
async function rateOk(limiter, key) {
  if (!limiter || typeof limiter.limit !== 'function') return true;
  try {
    const { success } = await limiter.limit({ key });
    return success !== false;
  } catch (err) {
    console.error('rate limiter failed open', String(err));
    return true;
  }
}

async function countOf(env, key) {
  const v = await env.PINS.get(key);
  const n = parseInt(v || '0', 10);
  return Number.isFinite(n) ? n : 0;
}

/* The TTL is anchored to the FIRST failure, not refreshed on each one.

   Refreshing it meant a lockout never actually expired while an attacker
   kept poking it — one request every fourteen minutes held the window
   open forever. Storing the deadline alongside the count lets each write
   ask for only the time that is left. */
async function bump(env, key, from) {
  /* Everything here is best-effort and must never throw: this runs on the
     failed-guess path, and an exception would be caught by the top-level
     handler and returned as a 500 — turning "wrong code, 3 tries left"
     into an opaque server error, and never incrementing the counter that
     is supposed to stop the guessing.

     `getWithMetadata` is guarded by feature test rather than by .catch(),
     because calling a method that does not exist throws SYNCHRONOUSLY and
     never produces a promise for .catch() to attach to. */
  let firstAt = Date.now();
  try {
    if (typeof env.PINS.getWithMetadata === 'function') {
      const meta = await env.PINS.getWithMetadata(key);
      if (meta && meta.metadata && meta.metadata.firstAt) firstAt = meta.metadata.firstAt;
    }
  } catch { /* fall back to a fresh window */ }

  const left = Math.max(1, ATTEMPT_TTL - Math.floor((Date.now() - firstAt) / 1000));
  try {
    await env.PINS.put(key, String(from + 1), { expirationTtl: left, metadata: { firstAt } });
  } catch {
    try { await env.PINS.put(key, String(from + 1), { expirationTtl: left }); } catch {}
  }
}

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

/* Split on the FIRST '=' only — a session id is base64-ish and a value
   containing '=' was being truncated by the naive split. */
const readCookie = req => {
  for (const raw of (req.headers.get('Cookie') || '').split(';')) {
    const c = raw.trim();
    const i = c.indexOf('=');
    if (i > 0 && c.slice(0, i) === 'ps_session') return c.slice(i + 1);
  }
  return undefined;
};

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
  /* UTF-8 first, THEN base64.

     `btoa(JSON.stringify(o))` only accepts code points 0-255. The email
     goes into the claims, and validEmail() accepts any non-whitespace
     character, so:
       · an address outside Latin-1 (any non-Latin script, an emoji)
         threw InvalidCharacterError — a 500 with no cookie, for someone
         who had received a real code and typed it correctly, on every
         retry, forever;
       · an accented Latin-1 address (josé@…) was worse, because it did
         NOT throw: `é` was encoded as the single byte 0xE9 instead of
         UTF-8's 0xC3 0xA9, producing a JWT payload that is not valid
         UTF-8 and an opaque rejection from Google's token exchange.
     Encoding the bytes explicitly makes both cases ordinary. */
  const b64 = o => {
    const bytes = new TextEncoder().encode(JSON.stringify(o));
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
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
