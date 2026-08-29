/* Adversarial + real-world-edge-case suite for worker/auth.js.
   Everything here is a failure mode that has actually shipped in somebody's
   email-code sign-in at some point. */
import fs from 'node:fs';

const KEY = fs.readFileSync('/tmp/test_key.pem', 'utf8');
const SA = JSON.stringify({ client_email: 'sa@t.iam.gserviceaccount.com', private_key: KEY });

let sent = [], resendFails = false, lastResendBody = null;
globalThis.fetch = async (url, opt) => {
  if (String(url).includes('resend.com')) {
    if (resendFails) return { ok: false, status: 500, text: async () => 'outage' };
    lastResendBody = JSON.parse(opt.body);
    sent.push({ to: lastResendBody.to[0], pin: lastResendBody.subject.split(' ')[0] });
    return { ok: true, status: 200, text: async () => '{}' };
  }
  throw new Error('unexpected fetch ' + url);
};

const worker = (await import('/tmp/auth.mjs')).default;

function makeKV() {
  const store = new Map();
  return { store, lagged: false,
    async get(k) { return this.lagged ? null : (store.has(k) ? store.get(k) : null); },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); } };
}
let PINS, SESSIONS;
const env = () => ({ PINS, SESSIONS, SA_JSON: SA, RESEND_KEY: 'k',
                     FROM_EMAIL: 'a@b.com', APP_ORIGIN: 'https://x.com' });

const call = (path, body, hdr = {}) => worker.fetch(new Request('https://x.com' + path, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...hdr },
  body: typeof body === 'string' ? body : JSON.stringify(body) }), env());

let pass = 0, fail = 0; const fails = [];
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n); }
  else { fail++; fails.push(n + (x ? ' -> ' + x : '')); console.log('  FAIL ' + n + (x ? '  -> ' + x : '')); } };
const reset = () => { PINS = makeKV(); SESSIONS = makeKV(); sent = []; resendFails = false; };
const E = 'anconalee@yahoo.com';
const getPin = () => sent[sent.length - 1].pin;

/* ------------------------------------------------------------------ */
console.log('\nA. Leading-zero codes  (classic: a layer treats the code as a number)');
reset();
{
  // ~10% of codes start with 0. Find one and prove it round-trips.
  let addr = null, pin = null;
  for (let i = 0; i < 400 && !addr; i++) {
    sent = []; PINS = makeKV();
    const a = `zero${i}@test.com`;
    await call('/api/request-code', { email: a });
    if (sent[0].pin[0] === '0') { addr = a; pin = sent[0].pin; }
  }
  ok('found a leading-zero code to test with', !!addr, String(pin));
  const r = await call('/api/verify-code', { email: addr, code: pin });
  ok('a code beginning 0 verifies', r.status === 200, pin + ' -> ' + r.status);
  const r2 = await call('/api/verify-code', { email: addr, code: Number(pin) });
  ok('the same code sent as a JSON number is REJECTED, not silently mangled',
     r2.status === 400, 'got ' + r2.status);
}

console.log('\nB. Address normalisation  (duplicate-account bugs)');
reset();
{
  await call('/api/request-code', { email: 'Anconalee@Yahoo.COM' });
  const pin = getPin();
  ok('the email is sent to the lowercased address', sent[0].to === E, sent[0].to);
  const r = await call('/api/verify-code', { email: '  anconalee@yahoo.com  ', code: pin });
  const d = await r.json();
  ok('requested with capitals, verified with spaces -> same account', r.status === 200);
  ok('uid is the canonical one', d.uid === 'u_8433ee1759cac10a56699231', d.uid);
}
reset();
{
  // Gmail ignores dots and everything after +. Two spellings, one inbox.
  await call('/api/request-code', { email: 'lee.smith@gmail.com' });
  const a = await call('/api/verify-code', { email: 'lee.smith@gmail.com', code: getPin() });
  const uidDotted = (await a.json()).uid;
  await call('/api/request-code', { email: 'leesmith@gmail.com' });
  const b = await call('/api/verify-code', { email: 'leesmith@gmail.com', code: getPin() });
  const uidPlain = (await b.json()).uid;
  ok('gmail dots collapse to one account', uidDotted === uidPlain,
     uidDotted + ' vs ' + uidPlain);

  await call('/api/request-code', { email: 'leesmith+pickem@gmail.com' });
  const c = await call('/api/verify-code', { email: 'leesmith+pickem@gmail.com', code: getPin() });
  ok('gmail +tag collapses to the same account', (await c.json()).uid === uidPlain);
}
reset();
{
  // But a + on a provider that may treat it literally must NOT be merged,
  // or whoever holds the tagged mailbox inherits the untagged account.
  await call('/api/request-code', { email: 'lee@corp.com' });
  const a = await call('/api/verify-code', { email: 'lee@corp.com', code: getPin() });
  await call('/api/request-code', { email: 'lee+x@corp.com' });
  const b = await call('/api/verify-code', { email: 'lee+x@corp.com', code: getPin() });
  ok('non-gmail +tag stays a SEPARATE account (no takeover path)',
     (await a.json()).uid !== (await b.json()).uid);
}

console.log('\nC. Rate limit cannot be walked around');
reset();
{
  await call('/api/request-code', { email: E });
  const r = await call('/api/request-code', { email: 'ANCONALEE@YAHOO.COM' });
  ok('casing does not buy a second send', (await r.json()).throttled === true);
  ok('still only one email out', sent.length === 1, String(sent.length));
}

console.log('\nD. Time windows');
reset();
{
  const realNow = Date.now;
  let t = 1756000000000;                      // fixed start
  globalThis.Date.now = () => t;
  await call('/api/request-code', { email: E });
  const pin = getPin();

  t += 9 * 60 * 1000;                          // 9 minutes later
  const a = await call('/api/verify-code', { email: E, code: pin });
  ok('a code still works after 9 minutes', a.status === 200, String(a.status));

  t += 8 * 60 * 1000;                          // 17 minutes total
  PINS = makeKV();                             // clear the attempt counter
  const b = await call('/api/verify-code', { email: E, code: pin });
  ok('and is refused after 17 minutes', b.status === 400, String(b.status));

  // The promise made in the email is "10 minutes". Prove that is never a lie.
  t = 1756000000000;
  let worst = Infinity;
  for (let off = 0; off < 300; off += 7) {      // request all through one window
    t = 1756000000000 + off * 1000;
    PINS = makeKV(); sent = [];
    await call('/api/request-code', { email: E });
    const p = getPin();
    let lastGood = 0;
    for (let m = 1; m <= 20; m++) {
      t = 1756000000000 + off * 1000 + m * 60000;
      PINS = makeKV();
      const rr = await call('/api/verify-code', { email: E, code: p });
      if (rr.status === 200) lastGood = m; else break;
    }
    worst = Math.min(worst, lastGood);
  }
  globalThis.Date.now = realNow;
  ok('every code lasts at least the 10 minutes the email promises', worst >= 10,
     'worst case was ' + worst + ' min');
}

console.log('\nE. Cross-device and cross-network  (request on phone, enter on laptop)');
reset();
{
  await call('/api/request-code', { email: E }, { 'CF-Connecting-IP': '1.1.1.1' });
  const r = await call('/api/verify-code', { email: E, code: getPin() },
                       { 'CF-Connecting-IP': '9.9.9.9' });
  ok('a code requested on one network verifies on another', r.status === 200);
}
reset();
{
  // A household behind one NAT must not lock each other out.
  const people = ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com'];
  for (const p of people) await call('/api/request-code', { email: p });
  let allIn = true;
  for (let i = 0; i < people.length; i++) {
    const r = await call('/api/verify-code', { email: people[i], code: sent[i].pin },
                         { 'CF-Connecting-IP': '77.77.77.77' });
    if (r.status !== 200) allIn = false;
  }
  ok('four people on one IP all sign in', allIn);
}

console.log('\nF. Guessing');
reset();
{
  await call('/api/request-code', { email: E });
  const real = getPin();
  const other = 'someone@else.com';
  await call('/api/request-code', { email: other });
  const otherPin = getPin();
  ok("one person's code does not work on another's account", otherPin !== real
     ? (await call('/api/verify-code', { email: E, code: otherPin })).status !== 200 : true);

  reset();
  await call('/api/request-code', { email: E });
  const p = getPin();
  const wrong = String((+p + 500) % 1000000).padStart(6, '0');

  // Sequential guessing — a real person retyping — must lock out. This is
  // what the counter is for and it has to work.
  for (let i = 0; i < 5; i++) await call('/api/verify-code', { email: E, code: wrong });
  ok('five sequential wrong guesses lock the address',
     (await call('/api/verify-code', { email: E, code: wrong })).status === 429);
  ok('and the right code is refused while locked',
     (await call('/api/verify-code', { email: E, code: p })).status === 429);

  // Documented limit: KV cannot increment atomically, so parallel guesses
  // all read the same count. Asserted so that if it ever silently changes,
  // this test says so rather than quietly passing.
  reset();
  await call('/api/request-code', { email: E });
  const p2 = getPin();
  const w2 = String((+p2 + 500) % 1000000).padStart(6, '0');
  const rs = await Promise.all(Array.from({ length: 8 }, () =>
    call('/api/verify-code', { email: E, code: w2 })));
  const counted = +(PINS.store.get('att:' + E) || 0);
  ok('KNOWN: parallel guesses undercount (needs the Cloudflare rate rule)',
     counted < 8, 'counter reached ' + counted + ' of 8 — expected, see auth.js');
  ok('parallel guesses are still all rejected', rs.every(r => r.status === 400));
}

console.log('\nG. Hostile / malformed input');
reset();
{
  const cases = [
    ['no body at all', '/api/request-code', ''],
    ['email is null', '/api/request-code', { email: null }],
    ['email is a number', '/api/request-code', { email: 12345 }],
    ['email is an array', '/api/request-code', { email: ['a@b.com'] }],
    ['email is an object', '/api/request-code', { email: { a: 1 } }],
    ['email is 5000 chars', '/api/request-code', { email: 'a'.repeat(5000) + '@b.com' }],
    ['code is null', '/api/verify-code', { email: E, code: null }],
    ['code is 10k chars', '/api/verify-code', { email: E, code: '1'.repeat(10000) }],
    ['code has letters', '/api/verify-code', { email: E, code: '12a456' }],
    ['code is 5 digits', '/api/verify-code', { email: E, code: '12345' }],
    ['code is 7 digits', '/api/verify-code', { email: E, code: '1234567' }],
    ['sql-ish email', '/api/request-code', { email: "a'or'1'='1@b.com" }],
    ['newline injection in email', '/api/request-code', { email: 'a@b.com\nBcc: x@y.com' }],
  ];
  let allClean = true, worst = '';
  for (const [name, path, body] of cases) {
    const r = await call(path, body);
    const t = await r.text();
    if (r.status >= 500 || /stack|at \w+ \(/.test(t)) { allClean = false; worst = name + ' -> ' + r.status; }
  }
  ok('no malformed input causes a 500 or leaks internals', allClean, worst);

  // Header injection is the one that actually matters: it must never reach Resend.
  sent = [];
  await call('/api/request-code', { email: 'a@b.com\nBcc: attacker@evil.com' });
  ok('a newline-injected address is refused outright', sent.length === 0);
}

console.log('\nH. Sessions');
reset();
{
  await call('/api/request-code', { email: E });
  const v = await call('/api/verify-code', { email: E, code: getPin() });
  const sid = (v.headers.get('Set-Cookie') || '').match(/ps_session=([^;]+)/)[1];
  const S = (cookie) => worker.fetch(new Request('https://x.com/api/session',
    cookie ? { headers: { Cookie: cookie } } : {}), env());

  ok('works alongside other cookies',
     (await S(`theme=dark; ps_session=${sid}; other=1`)).status === 200);
  ok('a forged session id is refused', (await S('ps_session=made-up')).status === 401);
  ok('an empty session id is refused', (await S('ps_session=')).status === 401);
  ok('junk cookie header does not throw', (await S('=====;;;')).status === 401);

  const cookieHdr = (await S(`ps_session=${sid}`)).headers.get('Set-Cookie');
  ok('session cookie is HttpOnly + Secure + SameSite',
     /HttpOnly/.test(cookieHdr) && /Secure/.test(cookieHdr) && /SameSite=Lax/.test(cookieHdr));

  const out = await worker.fetch(new Request('https://x.com/api/logout',
    { method: 'POST', headers: { Cookie: `ps_session=${sid}` } }), env());
  ok('logout clears the cookie', /Max-Age=0/.test(out.headers.get('Set-Cookie') || ''));
  ok('and the session is dead afterwards', (await S(`ps_session=${sid}`)).status === 401);
}

console.log('\nI. Transport');
reset();
{
  const pre = await worker.fetch(new Request('https://x.com/api/verify-code',
    { method: 'OPTIONS' }), env());
  ok('CORS preflight answers', pre.status === 200);
  ok('preflight allows credentials',
     pre.headers.get('Access-Control-Allow-Credentials') === 'true');
  ok('origin is pinned to the app, not *',
     pre.headers.get('Access-Control-Allow-Origin') === 'https://x.com');
  const nf = await call('/api/nope', {});
  ok('unknown path 404s cleanly', nf.status === 404);
}

console.log('\nJ. The email itself');
reset();
{
  await call('/api/request-code', { email: E });
  const b = lastResendBody;
  ok('subject leads with the code (shows in the notification preview)',
     /^\d{6} is your/.test(b.subject), b.subject);
  ok('a plain-text part exists (spam filters penalise html-only)', !!b.text);
  ok('the code appears in the text part', b.text.includes(getPin()));
  ok('no unsubscribe/marketing language that would trip filters',
     !/unsubscribe|newsletter|offer/i.test(b.html));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fails.length) { console.log('\nFAILURES:'); fails.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);
