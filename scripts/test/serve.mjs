/* Serves the real index.html with a stub PS layer and a scriptable /api.
   The app code under test is byte-identical to what ships. */
import http from 'node:http';
import fs from 'node:fs';

const APP = '/root/work/pickem/index.html';

// Test control: the page POSTs here to set how /api will behave next.
let plan = {};
let calls = [];

const STUB = `
/* Stand-in for firebase-init.js. Records what the app asks of it and can be
   told to fail, so post-verify failures can be tested without Firebase. */
const log = [];
window.__ps = { log, fail: {} };
const rec = (n, a) => { log.push({ fn: n, args: a });
  if (window.__ps.fail[n]) throw new Error('stub failure: ' + n); };
window.PS = {
  SEASON: '2026', user: null, poolId: null,
  async signInWithToken(t){ rec('signInWithToken',[t]); this.user={uid:'u_test'}; return this.user; },
  async joinPool(c){ rec('joinPool',[c]); this.poolId='p_test'; return {id:'p_test',name:'Test'}; },
  async upsertRoster(x){ rec('upsertRoster',[x]); },
  async ensureCurrentPool(){ rec('ensureCurrentPool',[]); return null; },
  async getPool(){ return null; },
  async getAllWeeks(){ return []; },
  async getMembers(){ return []; },
  async getWeek(){ return []; },
  async getRevealed(){ return []; },
  async getTiebreaks(){ return {}; },
  async getStandings(){ return []; },
  async getScoringMode(){ return 'confidence'; },
  async getArchive(){ return []; },
  async myPicks(){ return {}; },
  async savePicks(){}, async saveTiebreak(){},
  watchWeek(){}, watchRevealed(){}, watchAuth(cb){ cb(null); },
  async signOut(){}, async enablePush(){}, async refreshPushToken(){},
  async alertsHealthy(){ return true; },
};
`;

const srv = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const send = (code, body, type = 'application/json') => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };

  if (u.pathname === '/__plan') {                 // test harness control
    let b = ''; for await (const c of req) b += c;
    plan = JSON.parse(b || '{}'); calls = []; return send(200, { ok: true });
  }
  if (u.pathname === '/__calls') return send(200, calls);

  if (u.pathname.startsWith('/api/')) {
    const name = u.pathname.slice(5);
    calls.push({ name, at: Date.now() });
    const p = plan[name] || {};
    if (p.delay) await new Promise(r => setTimeout(r, p.delay));
    if (p.hang) return;                            // never responds
    return send(p.status || 200, p.body ?? { ok: true });
  }

  if (u.pathname === '/firebase-init.js')
    return send(200, STUB, 'text/javascript');

  if (u.pathname === '/' || u.pathname === '/index.html')
    return send(200, fs.readFileSync(APP, 'utf8'), 'text/html');

  send(404, 'nope', 'text/plain');
});
srv.listen(8099, () => console.log('ready'));
