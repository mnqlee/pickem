/* The /__live/ gate. Three failures must be three different answers, and
   none of them may leak the secret. */
import fs from 'fs';
import path from 'path';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const LIVE = path.join(HERE, '../../worker/live.js');
const src = fs.readFileSync(LIVE,'utf8');
fs.writeFileSync('/tmp/live.auth.mjs', src);
const mod = await import('/tmp/live.auth.mjs');
const W = mod.default;

let pass=0, fail=0;
const ok=(n,c,x='')=>{ c?(pass++,console.log('  ok   '+n)):(fail++,console.log('  FAIL '+n+(x?'  -> '+x:''))); };
const hit = async (url, env) => {
  const r = await W.fetch(new Request(url), env);
  return { status: r.status, text: await r.text() };
};
const SECRET = 's3cret-value-nobody-should-see';

console.log('\n1. No ADMIN_KEY configured — the case that cost an afternoon');
{ const r = await hit('https://x/__live/nudge?key=anything', {});
  ok('says the Worker has none configured', /no ADMIN_KEY is configured/.test(r.text), r.text.slice(0,60));
  ok('names the command that sets it', /secret put ADMIN_KEY/.test(r.text));
  ok('and warns about the other Worker in that folder', /auth Worker|secret list/.test(r.text));
  ok('not a 403 — this is a server misconfiguration, not your key', r.status === 503, String(r.status)); }

console.log('\n2. Key configured, none supplied');
{ const r = await hit('https://x/__live/nudge', { ADMIN_KEY: SECRET });
  ok('says no key was supplied', /no key supplied/.test(r.text), r.text.slice(0,60));
  ok('403', r.status === 403, String(r.status)); }

console.log('\n3. Wrong key');
{ const r = await hit('https://x/__live/nudge?key=nope', { ADMIN_KEY: SECRET });
  ok('says it did not match', /does not match/.test(r.text), r.text.slice(0,60));
  ok('and points at the URL-punctuation trap', /\+ & # % or \//.test(r.text));
  ok('403', r.status === 403, String(r.status)); }

console.log('\n4. NOTHING leaks the secret, in any of the three');
for (const [label, url, env] of [
  ['unconfigured', 'https://x/__live/nudge?key=anything', {}],
  ['missing',      'https://x/__live/nudge',              { ADMIN_KEY: SECRET }],
  ['mismatch',     'https://x/__live/nudge?key=nope',     { ADMIN_KEY: SECRET }]]) {
  const r = await hit(url, env);
  ok(`${label}: response does not contain the secret`, !r.text.includes(SECRET));
  ok(`${label}: nor its length`, !new RegExp(`\\b${SECRET.length}\\b`).test(r.text));
  ok(`${label}: nor any prefix of it`, !r.text.includes(SECRET.slice(0,6)));
}

console.log('\n5. The right key still gets through');
{ // nudge with no GH_TOKEN returns its skip object rather than touching GitHub
  const r = await hit(`https://x/__live/nudge?key=${SECRET}`, { ADMIN_KEY: SECRET });
  ok('200 and the endpoint ran', r.status === 200 && /GH_TOKEN not set/.test(r.text), r.text.slice(0,80)); }

console.log('\n6. Paths outside /__live/ are still invisible');
{ const r = await hit('https://x/anything', { ADMIN_KEY: SECRET });
  ok('404, and no hint that a key would help', r.status === 404 && !/key/i.test(r.text), `${r.status} ${r.text}`); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
