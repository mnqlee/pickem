/* Behavioural test for worker/auth.js.
   Runs the real module against a fake KV whose consistency we control. */
import worker from '/tmp/auth.mjs';
import fs from 'node:fs';

const KEY = fs.readFileSync('/tmp/test_key.pem', 'utf8');
const SA = JSON.stringify({ client_email: 'sa@test.iam.gserviceaccount.com', private_key: KEY });

let sent = [];        // emails Resend "delivered"
let resendFails = false;

globalThis.fetch = async (url, opt) => {
  if (String(url).includes('resend.com')) {
    if (resendFails) return { ok: false, status: 500, text: async () => 'simulated outage' };
    const b = JSON.parse(opt.body);
    sent.push({ to: b.to[0], pin: b.subject.split(' ')[0] });
    return { ok: true, status: 200, text: async () => '{}' };
  }
  throw new Error('unexpected fetch ' + url);
};

/* A KV that can be told to behave like a real edge: writes land centrally,
   but reads from a "cold" colo can lag or return a stale miss. */
function makeKV() {
  const store = new Map();
  return {
    store,
    lagged: false,                       // when true, reads see nothing new
    async get(k) { return this.lagged ? null : (store.has(k) ? store.get(k) : null); },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
  };
}

let PINS, SESSIONS;
const env = () => ({
  PINS, SESSIONS, SA_JSON: SA,
  RESEND_KEY: 'test', FROM_EMAIL: 'a@b.com', APP_ORIGIN: 'https://x.com',
});

const call = (path, body, headers = {}) => worker.fetch(new Request('https://x.com' + path, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
}), env());

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
};
const reset = () => { PINS = makeKV(); SESSIONS = makeKV(); sent = []; resendFails = false; };

const EMAIL = 'anconalee@yahoo.com';

console.log('\n1. Happy path');
reset();
{
  const r1 = await call('/api/request-code', { email: EMAIL });
  ok('request-code returns 200', r1.status === 200);
  ok('an email was actually sent', sent.length === 1);
  const pin = sent[0].pin;
  ok('the PIN is six digits', /^\d{6}$/.test(pin), pin);
  const r2 = await call('/api/verify-code', { email: EMAIL, code: pin });
  const d = await r2.json();
  ok('verify-code returns 200', r2.status === 200, r2.status + ' ' + JSON.stringify(d));
  ok('a Firebase token comes back', typeof d.token === 'string' && d.token.split('.').length === 3);
  ok('uid is the expected stable value', d.uid === 'u_8433ee1759cac10a56699231', d.uid);
  ok('a session cookie is set', /ps_session=/.test(r2.headers.get('Set-Cookie') || ''));
}

console.log('\n2. THE REGRESSION: KV is stale when verify runs');
console.log('   (the old code read the PIN back from KV here and answered "expired")');
reset();
{
  const r1 = await call('/api/request-code', { email: EMAIL });
  const pin = sent[0].pin;
  PINS.lagged = true;                    // every KV read now misses
  const r2 = await call('/api/verify-code', { email: EMAIL, code: pin });
  const d = await r2.json();
  ok('a correct code still verifies against a stale KV', r2.status === 200,
     r2.status + ' ' + JSON.stringify(d));
}

console.log('\n3. Double submit of the same correct code (auto-submit racing a tap)');
reset();
{
  await call('/api/request-code', { email: EMAIL });
  const pin = sent[0].pin;
  const [a, b] = await Promise.all([
    call('/api/verify-code', { email: EMAIL, code: pin }),
    call('/api/verify-code', { email: EMAIL, code: pin }),
  ]);
  ok('both concurrent submits succeed', a.status === 200 && b.status === 200,
     a.status + '/' + b.status);
}

console.log('\n4. Wrong codes');
reset();
{
  await call('/api/request-code', { email: EMAIL });
  const real = sent[0].pin;
  const bad = String((+real + 1) % 1000000).padStart(6, '0');
  const r = await call('/api/verify-code', { email: EMAIL, code: bad });
  const d = await r.json();
  ok('a wrong code is rejected', r.status === 400 && d.error === 'wrong_code', JSON.stringify(d));
  ok('and reports tries remaining', d.left === 4, String(d.left));

  for (let i = 0; i < 4; i++) await call('/api/verify-code', { email: EMAIL, code: bad });
  const locked = await call('/api/verify-code', { email: EMAIL, code: bad });
  ok('locks out after 5 wrong tries', locked.status === 429, String(locked.status));
  const stillLocked = await call('/api/verify-code', { email: EMAIL, code: real });
  ok('and the lockout holds even for the right code', stillLocked.status === 429);
}

console.log('\n5. A correct code clears the failure counter');
reset();
{
  await call('/api/request-code', { email: EMAIL });
  const real = sent[0].pin;
  const bad = String((+real + 1) % 1000000).padStart(6, '0');
  await call('/api/verify-code', { email: EMAIL, code: bad });
  await call('/api/verify-code', { email: EMAIL, code: bad });
  await call('/api/verify-code', { email: EMAIL, code: real });
  ok('counter cleared after success', !PINS.store.has('att:' + EMAIL));
}

console.log('\n6. Resend outage is reported, not swallowed');
reset();
{
  resendFails = true;
  const r = await call('/api/request-code', { email: EMAIL });
  const d = await r.json();
  ok('returns 502 send_failed', r.status === 502 && d.error === 'send_failed', JSON.stringify(d));
  ok('does NOT claim ok:true', d.ok !== true);
  ok('no cooldown set, so they can retry immediately', !PINS.store.has('rl:' + EMAIL));
}

console.log('\n7. Cooldown reports itself honestly');
reset();
{
  await call('/api/request-code', { email: EMAIL });
  const r = await call('/api/request-code', { email: EMAIL });
  const d = await r.json();
  ok('second request inside the cooldown is flagged', d.throttled === true, JSON.stringify(d));
  ok('and no duplicate email went out', sent.length === 1, String(sent.length));
}

console.log('\n8. Bad input');
reset();
{
  const a = await call('/api/request-code', 'not json{{');
  ok('malformed body -> 400, not 500', a.status === 400, String(a.status));
  const b = await call('/api/request-code', { email: 'nonsense' });
  const bd = await b.json();
  ok('malformed address -> 400 bad_email', b.status === 400 && bd.error === 'bad_email');
  const c = await call('/api/verify-code', { email: EMAIL, code: 'abc' });
  ok('non-numeric code -> 400', c.status === 400, String(c.status));
}

console.log('\n9. No stack traces leak');
reset();
{
  // Fresh module instance: the PIN key is cached per isolate, so a module
  // already warmed by the tests above would never re-read SA_JSON.
  const fresh = (await import('/tmp/auth.mjs?fresh=1')).default;
  const broken = { ...env(), SA_JSON: '{{{not json' };
  const r = await fresh.fetch(new Request('https://x.com/api/verify-code', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, code: '123456' }),
  }), broken);
  const t = await r.text();
  ok('an internal error returns a bare 500', r.status === 500, String(r.status));
  ok('and leaks no stack or message', !/stack|at |\.js:/i.test(t), t.slice(0, 200));
}

console.log('\n10. Session cookie round trip');
reset();
{
  await call('/api/request-code', { email: EMAIL });
  const v = await call('/api/verify-code', { email: EMAIL, code: sent[0].pin });
  const sid = (v.headers.get('Set-Cookie') || '').match(/ps_session=([^;]+)/)[1];
  const s = await worker.fetch(new Request('https://x.com/api/session', {
    headers: { Cookie: 'ps_session=' + sid },
  }), env());
  const sd = await s.json();
  ok('/api/session re-issues a token from the cookie alone', s.status === 200 && !!sd.token);
  ok('same uid', sd.uid === 'u_8433ee1759cac10a56699231');
  const no = await worker.fetch(new Request('https://x.com/api/session'), env());
  ok('and 401s without one', no.status === 401);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
