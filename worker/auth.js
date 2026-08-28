/* ============================================================
   Weekly NFL Pickâ€™em â€” auth Worker

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

   BINDINGS (wrangler.toml)
     KV namespace   PINS        short-lived codes
     KV namespace   SESSIONS    session id -> uid
     secret         SA_JSON     Firebase service account JSON
     secret         RESEND_KEY  Resend API key
     var            FROM_EMAIL  "Weekly NFL Pickâ€™em <picks@yourdomain.com>"
     var            APP_ORIGIN  "https://yourdomain.com"
   ============================================================ */

const PIN_TTL = 600;                    // 10 minutes
const MAX_ATTEMPTS = 5;
const SESSION_TTL = 90 * 24 * 3600;     // 90 days â€” covers a bye week
const REQUEST_COOLDOWN = 60;            // seconds between codes per email

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
      return json({ error: 'not found' }, 404, cors);
    } catch (e) {
      return json({ error: 'caught', message: String(e), stack: String(e.stack) }, 500, cors);
    }
  }
};

/* ---------- helpers ---------- */
const json = (o, s = 200, h = {}) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json', ...h } });

const norm = e => String(e || '').trim().toLowerCase();
const validEmail = e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

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

/* ---------- 1. request a code ---------- */
async function requestCode(req, env, cors) {
  const { email } = await req.json();
  const e = norm(email);

  // Always answer the same way. If this leaked which addresses exist,
  // anyone could enumerate the pool's membership.
  const ok = () => json({ ok: true }, 200, cors);
  if (!validEmail(e)) return ok();

  const rl = await env.PINS.get(`rl:${e}`);
  if (rl) return ok();                                    // silently rate limited

  const pin = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');

  // Store the hash, never the PIN itself.
  await env.PINS.put(`pin:${e}`,
    JSON.stringify({ hash: await sha(pin + e), attempts: 0 }),
    { expirationTtl: PIN_TTL });
  await env.PINS.put(`rl:${e}`, '1', { expirationTtl: REQUEST_COOLDOWN });

  await sendPin(env, e, pin, cors); return ok();
}

async function sendPin(env, email, pin, cors) {
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
  if (!r.ok) {
    const body = await r.text();
    throw new Error('resend ' + r.status + ': ' + body);
  }
}

/* ---------- 2. verify ---------- */
async function verifyCode(req, env, cors) {
  const { email, code } = await req.json();
  const e = norm(email);
  const raw = await env.PINS.get(`pin:${e}`);
  if (!raw) return json({ error: 'expired' }, 400, cors);

  const rec = JSON.parse(raw);
  if (rec.attempts >= MAX_ATTEMPTS) {
    await env.PINS.delete(`pin:${e}`);
    return json({ error: 'too many attempts' }, 429, cors);
  }

  if (!safeEqual(await sha(String(code).trim() + e), rec.hash)) {
    rec.attempts++;
    await env.PINS.put(`pin:${e}`, JSON.stringify(rec), { expirationTtl: PIN_TTL });
    return json({ error: 'wrong code', left: MAX_ATTEMPTS - rec.attempts }, 400, cors);
  }

  await env.PINS.delete(`pin:${e}`);                      // one use only

  const uid = 'u_' + (await sha(e)).slice(0, 24);         // stable per address
  const sid = crypto.randomUUID();
  await env.SESSIONS.put(`s:${sid}`, JSON.stringify({ uid, email: e }),
                         { expirationTtl: SESSION_TTL });

  return json({ token: await mintToken(env, uid, e), uid }, 200,
    { ...cors, 'Set-Cookie': cookie(sid, SESSION_TTL) });
}

/* ---------- 3. silent re-auth ---------- */
async function session(req, env, cors) {
  const sid = (req.headers.get('Cookie') || '')
    .split(';').map(c => c.trim().split('='))
    .find(([k]) => k === 'ps_session')?.[1];
  if (!sid) return json({ error: 'no session' }, 401, cors);

  const raw = await env.SESSIONS.get(`s:${sid}`);
  if (!raw) return json({ error: 'expired' }, 401, cors);
  const { uid, email } = JSON.parse(raw);

  // Slide the window: active players never get logged out.
  await env.SESSIONS.put(`s:${sid}`, raw, { expirationTtl: SESSION_TTL });

  return json({ token: await mintToken(env, uid, email), uid }, 200,
    { ...cors, 'Set-Cookie': cookie(sid, SESSION_TTL) });
}

async function logout(req, env, cors) {
  const sid = (req.headers.get('Cookie') || '')
    .split(';').map(c => c.trim().split('='))
    .find(([k]) => k === 'ps_session')?.[1];
  if (sid) await env.SESSIONS.delete(`s:${sid}`);
  return json({ ok: true }, 200, { ...cors, 'Set-Cookie': cookie('', 0) });
}

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
