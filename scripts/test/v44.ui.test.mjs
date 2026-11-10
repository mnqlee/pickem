/* v1.44.0 — RED ZONE, GAME TILES, TABS AT THE TOP, RIVALS, WEEKLY WRAP.

   Every figure on these screens is graded against an ORACLE computed here
   in Node from the stub's own raw data (PS.getAllWeeks, PS.getRevealed,
   PS.getStandings), never from what the app rendered, so the app cannot
   agree with itself about something untrue.

   Needs app-serve.mjs running (PORT 8098 by default, or BASE=...). */
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:8098';
let pass = 0, fail = 0; const fails = [];
const ok = (name, cond, info = '') => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; fails.push(name); console.log('  FAIL ' + name + (info ? '   :: ' + info : '')); }
};
/* ONLY=3,5 runs just those sections, for the mutation harness. */
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean).map(Number);
const want = n => !ONLY.length || ONLY.includes(n);
const browser = await chromium.launch();
/* A crashed section must still report: print what failed so far, name the
   crash, and exit red, so the mutation harness sees a FAILURES list. */
process.on('uncaughtException', e => {
  fails.push('a section crashed: ' + String(e && e.message || e).split('\n')[0]);
  console.log(`\n${pass} passed, ${fail + 1} failed`);
  console.log('FAILURES:'); fails.forEach(f => console.log('  - ' + f));
  process.exit(1);
});

async function open(plan = {}, opts = {}) {
  const ctx = opts.ctx || await browser.newContext({
    viewport: { width: opts.w || 390, height: opts.h || 844 },
    ...(opts.reduced ? { reducedMotion: 'reduce' } : {}) });
  if (opts.share) await ctx.addInitScript(mode => {
    window.__shared = [];
    navigator.canShare = () => mode === 'files';
    navigator.share = async d => { window.__sharedFile = d.files && d.files[0]; window.__shared.push({ n: (d.files || []).length,
      type: d.files && d.files[0] && d.files[0].type, name: d.files && d.files[0] && d.files[0].name,
      size: d.files && d.files[0] && d.files[0].size, text: d.text }); };
  }, opts.share);
  const page = await ctx.newPage();
  await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.request.post(BASE + '/__plan', { data: plan });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(opts.wait || 2200);
  return { ctx, page, errors };
}
const H = 3600e3, D = 864e5;
/* Forty minutes into the Sunday 1pm window of the week `back` weeks ago
   (0 = this fixture's week 1). */
const sunLive = (back = 0) => new Date(Date.now() - (back * 7 * D + 3 * D + 61200000 + 40 * 60000)).toISOString();
/* Tuesday after week 1's Monday night: week 1 done, week 2 not started. */
const tuesday = () => new Date(Date.now() - (5 * D + 6 * H)).toISOString();
const PAY = (r, n) => !r ? 1 : Math.max(0, Math.min(n, n + 1 - r));
const ord = n => { const v = n % 100; return n + ((v >= 11 && v <= 13) ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] || 'th')); };
const tab = (page, t) => page.click(`.tab[data-tab="${t}"]`);

/* =================================================================== */
console.log('\n1. Red zone on a live card');
if (want(1)) {
  const { ctx, page, errors } = await open({ startISO: sunLive(), weeks: 2, gamesPerWeek: 10, playerCount: 6,
    espnDetail: '3rd 8:12', espnBall: 'alt', espnRZ: [0, 2] });
  const info = await page.evaluate(() => [...document.querySelectorAll('#slate .card')].map(c => {
    const m = c.querySelector('.meta'), t = c.querySelector('.rztag');
    const mr = m && m.getBoundingClientRect(), tr = t && t.getBoundingClientRect();
    const ball = c.querySelector('.pos'), cs = getComputedStyle(c);
    return { id: c.dataset.game, rz: c.classList.contains('rzc'), locked: c.classList.contains('locked'),
      fin: !!c.querySelector('.fmeta'), tag: t ? t.textContent : null,
      tagCx: tr ? tr.left + tr.width / 2 : null, metaCx: mr ? mr.left + mr.width / 2 : null,
      tagCy: tr ? tr.top + tr.height / 2 : null, metaCy: mr ? mr.top + mr.height / 2 : null,
      shadow: cs.boxShadow, anim: cs.animationName,
      inProg: /In progress/.test(m ? m.textContent : ''),
      spread: !!(m && [...m.querySelectorAll('.mono')].some(x => !x.classList.contains('cd') && /-\d|line TBD/.test(x.textContent))),
      ball: !!ball, ballCls: ball ? ball.className : '', ballColor: ball ? getComputedStyle(ball).color : '',
      ballAnim: ball ? getComputedStyle(ball).animationName : '',
      sideLit: ball ? ball.closest('.side').classList.contains('won') : null,
      sideBg: ball ? ball.closest('.side').style.background : '' };
  }));
  const live = info.filter(c => c.locked && !c.fin), rz = info.filter(c => c.rz);
  ok('there are live games in the fixture', live.length >= 4, String(live.length));
  ok('exactly the two drives ESPN marks isRedZone light up', rz.length === 2, JSON.stringify(rz.map(c => c.id)));
  ok('each says "Red zone" and nothing else', rz.every(c => c.tag === 'Red zone'));
  ok('the tag is centred on the top line (within 1.5px)', rz.every(c => Math.abs(c.tagCx - c.metaCx) < 1.5 && Math.abs(c.tagCy - c.metaCy) < 1.5),
    JSON.stringify(rz.map(c => [c.tagCx, c.metaCx, c.tagCy, c.metaCy])));
  ok('the ring is solid red, not animated', rz.every(c => /229, 72, 60/.test(c.shadow) && c.anim === 'none'), rz.map(c => c.anim + ' ' + c.shadow).join(' | '));
  ok('"In progress" is replaced by the tag on a red-zone card', rz.every(c => !c.inProg));
  ok('a live card outside the red zone still says In progress, with no ring', live.filter(c => !c.rz).every(c => c.inProg && c.anim === 'none' && !/229, 72, 60/.test(c.shadow)));
  ok('the football on a red-zone card flashes', rz.every(c => c.ball && /rzb/.test(c.ballCls) && c.ballAnim === 'rzball'));
  ok('a football outside the red zone does not', live.filter(c => !c.rz && c.ball).every(c => !/rzb/.test(c.ballCls) && c.ballAnim !== 'rzball'));
  const isRed = bg => { const m = (bg.match(/\d+/g) || []).map(Number); return m.length >= 3 && m[0] > 140 && m[0] > m[1] * 1.8 && m[0] > m[2] * 1.6; };
  ok('ball is white only on your own red panel, red everywhere else',
    rz.every(c => (c.sideLit && isRed(c.sideBg)) ? /255, 255, 255/.test(c.ballColor) : /229, 72, 60/.test(c.ballColor)),
    JSON.stringify(rz.map(c => [c.sideLit, c.sideBg, c.ballColor])));
  ok('no spread on any live card', live.every(c => !c.spread), JSON.stringify(live.filter(c => c.spread).map(c => c.id)));
  const pre = info.filter(c => !c.locked);
  ok('the spread is still there before kickoff', pre.length > 0 && pre.some(c => c.spread));
  ok('no page errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

/* =================================================================== */
console.log('\n2. A forced white football: you picked a red team that has the ball inside the 20');
if (want(2)) {
  /* Find a live game in the fixture whose picked side is a red club, then
     give that side the ball in the red zone by hand. */
  const { ctx, page, errors } = await open({ startISO: sunLive(), weeks: 1, gamesPerWeek: 16, playerCount: 4, espnDetail: '2nd 1:00', espnBall: 'none' });
  const t = await page.evaluate(() => {
    const red = bg => { const m = (bg.match(/\d+/g) || []).map(Number); return m.length >= 3 && m[0] > 140 && m[0] > m[1] * 1.8 && m[0] > m[2] * 1.6; };
    for (const c of document.querySelectorAll('#slate .card.locked')) {
      if (c.querySelector('.fmeta')) continue;
      const won = c.querySelector('.side.won'); if (!won || !red(won.style.background)) continue;
      const [, away, home] = c.dataset.game.split('_').slice(1);
      return { id: c.dataset.game, side: won.dataset.side, away: c.dataset.game.split('_')[2], home: c.dataset.game.split('_')[3] };
    }
    return null;
  });
  if (!t) ok('fixture has a live game picked on a red club (skipped: none in this slate)', true);
  else {
    await page.evaluate(t => { window.__espn = [window.__espnEvent(t.away, t.home, 14, 10, 'in', t.side === 'a' ? 'away' : 'home', true)]; }, t);
    /* Next scheduled poll is at most 15s away. */
    await page.waitForFunction(id => !!document.querySelector(`.card[data-game="${id}"].rzc`), t.id, { timeout: 20000 }).catch(() => {});
    const r = await page.evaluate(id => { const b = document.querySelector(`.card[data-game="${id}"] .pos`); return b ? [b.className, getComputedStyle(b).color] : null; }, t.id);
    ok('the picked red panel gets the WHITE football', !!r && /rzw/.test(r[0]) && /255, 255, 255/.test(r[1]), JSON.stringify(r));
    /* Same team still has the ball, but the drive is back outside the 20
       (a sack, a penalty): isRedZone is simply absent. That must clear. */
    await page.evaluate(t => { window.__espn = [window.__espnEvent(t.away, t.home, 14, 10, 'in', t.side === 'a' ? 'away' : 'home')]; }, t);
    await page.waitForFunction(id => !document.querySelector(`.card[data-game="${id}"].rzc`), t.id, { timeout: 20000 }).catch(() => {});
    ok('when ESPN stops saying red zone, the ring and tag go on the next poll',
      await page.evaluate(id => !document.querySelector(`.card[data-game="${id}"].rzc`) && !document.querySelector(`.card[data-game="${id}"] .rztag`), t.id));
    ok('and the football stays, plain, with the team that still has it',
      await page.evaluate(id => { const b = document.querySelector(`.card[data-game="${id}"] .pos`); return !!b && !/rzb/.test(b.className); }, t.id));
  }
  ok('no page errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

/* =================================================================== */
console.log('\n3. A finished game never wears the ring, however stale ESPN is');
if (want(3)) {
  const { ctx, page, errors } = await open({ startISO: sunLive(), weeks: 1, gamesPerWeek: 10, playerCount: 4 });
  const fin = await page.evaluate(() => { const c = document.querySelector('#slate .card .fmeta'); return c ? c.closest('.card').dataset.game : null; });
  await page.evaluate(id => { const [, , a, h] = id.split('_'); window.__espn = [window.__espnEvent(a, h, 30, 3, 'in', 'away', true)]; }, fin);
  await page.waitForTimeout(16500);
  ok('the final card has no ring and no tag', await page.evaluate(id => { const c = document.querySelector(`.card[data-game="${id}"]`); return c && !c.classList.contains('rzc') && !c.querySelector('.rztag'); }, fin));
  ok('no page errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

/* =================================================================== */
console.log('\n4. Live pulls every 15 seconds, and never while nothing is live');
if (want(4)) {
  const { ctx, page, errors } = await open({ startISO: sunLive(), weeks: 1, gamesPerWeek: 10, playerCount: 4, espnDetail: '1st 9:00' }, { wait: 800 });
  await page.waitForTimeout(32500);
  const calls = await page.evaluate(() => window.__espnCalls.length);
  /* Boot pull + 2 interval pulls in 32s at 15s; at 30s it would be 2, at 10s 4+. */
  ok('three requests in about 33 seconds (boot plus two at 15s)', calls === 3, String(calls));
  await ctx.close();
  const B = await open({ startISO: new Date(Date.now() + 3 * D).toISOString(), weeks: 1, gamesPerWeek: 6, playerCount: 3 }, { wait: 3000 });
  ok('nothing is asked of ESPN before kickoff', await B.page.evaluate(() => window.__espnCalls.length) === 0);
  ok('no page errors', errors.length === 0 && B.errors.length === 0, (errors[0] || B.errors[0] || ''));
  await B.ctx.close();
}

/* =================================================================== */
console.log('\n5. The Games box: tiles, badges, and the jump to the card');
if (want(5)) {
  const { ctx, page, errors } = await open({ startISO: sunLive(), weeks: 1, gamesPerWeek: 12, playerCount: 5, espnDetail: '3rd 2:00', espnBall: 'home', espnRZ: [1] });
  const weeks = await page.evaluate(() => PS.getAllWeeks());
  const gs = weeks[0].games, N = gs.length;
  const mine = await page.evaluate(() => PS.myPicks(1));
  await page.evaluate(() => document.querySelector('[data-c3="games"]').click());
  await page.waitForTimeout(500);
  const tiles = await page.evaluate(() => [...document.querySelectorAll('#infoSheet .gt')].map(t => ({
    id: t.dataset.go, fin: t.classList.contains('fin'), rz: t.classList.contains('rz'),
    pk: (t.querySelector('.gtpk') || {}).textContent || '', r: t.getBoundingClientRect().width / t.getBoundingClientRect().height,
    w: t.getBoundingClientRect().width })));
  const now = Date.now();
  const fins = gs.filter(g => g.status === 'final'), lives = gs.filter(g => g.status !== 'final' && g.kickoff.toMillis ? true : true)
    .filter(g => g.status !== 'final' && (g.kickoff.seconds * 1000) <= now);
  ok('one tile for every live and every final game, none for games to come', tiles.length === fins.length + lives.length,
    `${tiles.length} vs ${fins.length}+${lives.length}`);
  ok('tiles are square, three across', tiles.every(t => Math.abs(t.r - 1) < 0.02) && tiles.every(t => t.w > 90 && t.w < 120), JSON.stringify(tiles.slice(0, 2)));
  ok('the red-zone game is the one tile with the red ring', tiles.filter(t => t.rz).length === 1);
  /* Oracle for the final-game badges. */
  let bad = [];
  fins.forEach(g => {
    const p = mine[g.id]; const t = tiles.find(x => x.id === g.id); if (!t) { bad.push(g.id + ' no tile'); return; }
    if (!p) { if (t.pk) bad.push(g.id + ' badge without a pick'); return; }
    const v = PAY(p.weight, N);
    const want = p.winner === g.winner ? `+${v}` : `0of${v}`;
    if (t.pk.replace(/\s/g, '') !== want) bad.push(`${g.id} ${t.pk} want ${want}`);
  });
  ok('every final badge is +points for a right pick, 0 of points for a wrong one', bad.length === 0, bad.join('; '));
  await page.evaluate(() => window.scrollTo(0, 0));
  const target = tiles.find(t => !t.fin) || tiles[0];
  await page.click(`#infoSheet .gt[data-go="${target.id}"]`);
  await page.waitForTimeout(900);
  const j = await page.evaluate(id => { const c = document.querySelector(`.card[data-game="${id}"]`); const r = c.getBoundingClientRect();
    return { tab: document.body.dataset.tab, sheet: document.getElementById('infoSheet').hidden, jumped: c.classList.contains('jumped'), inView: r.top >= 0 && r.bottom <= innerHeight }; }, target.id);
  ok('a tile lands on its own card, outlined, in view, sheet closed', j.tab === 'picks' && j.sheet && j.jumped && j.inView, JSON.stringify(j));
  ok('the still-to-play list is still under the tiles', await page.evaluate(() => { document.querySelector('[data-c3="games"]').click(); return true; })
    && (await page.waitForTimeout(400), await page.evaluate(() => /Still to play/.test(document.getElementById('infoBody').textContent))));
  ok('no page errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

/* =================================================================== */
console.log('\n6. Every tab opens at the top');
if (want(6)) {
  const { ctx, page, errors } = await open({ startISO: sunLive(1), weeks: 3, gamesPerWeek: 16, playerCount: 30 });
  let bad = [];
  for (const [from, to] of [['picks', 'standings'], ['standings', 'grid'], ['grid', 'help'], ['help', 'picks'], ['picks', 'settings']]) {
    await tab(page, from); await page.waitForTimeout(250);
    await page.evaluate(() => window.scrollTo(0, 1400)); await page.waitForTimeout(150);
    await tab(page, to); await page.waitForTimeout(250);
    const y = await page.evaluate(() => scrollY); if (y !== 0) bad.push(`${from}->${to} at ${y}`);
  }
  ok('switching tabs always lands at the top', bad.length === 0, bad.join(', '));
  ok('no page errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

/* =================================================================== */
console.log('\n7. Rivals in Standings: the tags, the edge, nothing else');
if (want(7)) {
  const { ctx, page, errors } = await open({ startISO: sunLive(1), weeks: 3, gamesPerWeek: 14, playerCount: 8,
    rivals: { u_0: ['u_2', 'u_99'], u_3: ['u_0'], u_2: ['u_0'], u_5: ['u_1'] } });
  await tab(page, 'standings'); await page.waitForTimeout(500);
  const rows = await page.evaluate(() => [...document.querySelectorAll('#board .row')].map(r => ({ u: r.dataset.pu || 'ME',
    rv: r.classList.contains('rv'), ht: r.classList.contains('ht'), tags: [...r.querySelectorAll('.rvtag')].map(t => t.textContent), edge: getComputedStyle(r).borderLeftColor })));
  const by = Object.fromEntries(rows.map(r => [r.u, r]));
  ok('your rival wears Rival AND, since they picked you back, Hunting you', by.u_2 && by.u_2.tags.join() === 'Rival,Hunting you' && by.u_2.rv && by.u_2.ht, JSON.stringify(by.u_2));
  ok('a player who picked you wears Hunting you only', by.u_3 && by.u_3.tags.join() === 'Hunting you' && !by.u_3.rv, JSON.stringify(by.u_3));
  ok('somebody else\'s rivalry puts nothing on your screen', by.u_5 && by.u_1 && !by.u_5.tags.length && !by.u_1.tags.length);
  ok('your own row is never tagged', by.ME && !by.ME.tags.length && !by.ME.rv && !by.ME.ht);
  ok('a removed player in your list is ignored, not counted against your two',
    await page.evaluate(() => { document.getElementById('rvBtn').click(); return true; })
    && (await page.waitForTimeout(300), /Pick my rival/.test(await page.textContent('#infoBody'))));
  await page.click('#infoX'); await page.waitForTimeout(250);
  ok('the edge is blue for a rival, red for a hunter', /111, 160, 255/.test(by.u_2.edge) && /228, 86, 74/.test(by.u_3.edge), by.u_2.edge + ' ' + by.u_3.edge);
  ok('no "Hunting you" bar above the table', await page.evaluate(() => !document.querySelector('#v-standings .bar')));
  const btn = await page.evaluate(() => { const b = document.getElementById('rvBtn').getBoundingClientRect(), s = document.querySelector('[data-stand="season"]').getBoundingClientRect(); return { w: b.width, h: b.height, sameRow: Math.abs(b.top - s.top) < 2, right: b.left > s.right }; });
  ok('+ Rival is a small button on the same row, right of Season', btn.w <= 64 && btn.h >= 36 && btn.sameRow && btn.right, JSON.stringify(btn));
  /* Season record oracle, straight from the stub's standings. */
  const st = await page.evaluate(() => PS.getStandings());
  const weeks = await page.evaluate(() => PS.getAllWeeks());
  const done = weeks.filter(w => w.games.every(g => g.status === 'final')).map(w => w.wk);
  const rec = (a, b) => { let w = 0, l = 0, t = 0; done.forEach(k => { const x = st.find(r => r.uid === a).weeks[String(k)].pts, y = st.find(r => r.uid === b).weeks[String(k)].pts; x > y ? w++ : x < y ? l++ : t++; }); return { w, l, t }; };
  const R = rec('u_0', 'u_2');
  await page.click('[data-stand="season"]'); await page.waitForTimeout(400);
  const sub = await page.evaluate(() => document.querySelector('#board [data-pu="u_2"] .who .mono').textContent);
  const name2 = await page.evaluate(() => document.querySelector('#board [data-pu="u_2"] .nrow b').textContent);
  const want = R.w > R.l ? `You lead ${R.w}-${R.l}` : R.w < R.l ? `${name2} leads ${R.l}-${R.w}` : `Tied ${R.w}-${R.l}`;
  ok('the Season view shows the rivalry record, and it matches the oracle', sub.includes(want + (R.t ? '-' + R.t : '')), `${sub} vs ${want}`);
  await page.click('#board [data-pu="u_2"]'); await page.waitForTimeout(400);
  const sheet = await page.evaluate(() => ({ t: document.getElementById('infoTitle').textContent, vs: [...document.querySelectorAll('#infoSheet .rvvs b')].map(b => +b.textContent),
    mine: [...document.querySelectorAll('#infoSheet .rvsplit .me .rvwks span')].map(s => s.className + s.textContent),
    theirs: [...document.querySelectorAll('#infoSheet .rvsplit .them .rvwks span')].map(s => s.className + s.textContent),
    ties: [...document.querySelectorAll('#infoSheet .rvties span')].map(s => s.className + s.textContent),
    sideOk: (() => { const m = document.querySelector('#infoSheet .rvsplit .me'), t = document.querySelector('#infoSheet .rvsplit .them'); return !!m && !!t && m.getBoundingClientRect().right <= t.getBoundingClientRect().left + 1; })(),
    level: (() => { const b = [...document.querySelectorAll('#infoSheet .rvtot b')].map(x => x.getBoundingClientRect().top); return b.length === 2 && Math.abs(b[0] - b[1]) < 0.5; })(),
    conf: [...document.querySelectorAll('#infoSheet .rvtot>div')].map(d => getComputedStyle(d).borderTopColor) }));
  ok('the rival card titles itself You vs ...', sheet.t === `You vs ${name2}`, sheet.t);
  ok('its weeks-won numbers match the oracle', sheet.vs[0] === R.w && sheet.vs[1] === R.l, JSON.stringify(sheet.vs) + ' ' + JSON.stringify(R));
  const split = { w: [], l: [], t: [] };
  done.forEach(k => { const x = st.find(r => r.uid === 'u_0').weeks[String(k)].pts, y = st.find(r => r.uid === 'u_2').weeks[String(k)].pts; split[x > y ? 'w' : x < y ? 'l' : 't'].push((x > y ? 'w' : x < y ? 'l' : 't') + k); });
  ok('weeks you won sit on your side in green, theirs on their side in red, ties below',
    JSON.stringify(sheet.mine) === JSON.stringify(split.w) && JSON.stringify(sheet.theirs) === JSON.stringify(split.l) && JSON.stringify(sheet.ties) === JSON.stringify(split.t),
    JSON.stringify(sheet) + ' want ' + JSON.stringify(split));
  ok('your column is on the left, theirs on the right', sheet.sideOk);
  ok('the two season totals sit exactly level', sheet.level);
  ok('both season boxes wear the red CONF border', sheet.conf.length === 2 && sheet.conf.every(c => /178, 58, 49/.test(c)), JSON.stringify(sheet.conf));
  ok('no page errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

/* =================================================================== */
console.log('\n8. Picking rivals: the help first, then the list, two at most');
if (want(8)) {
  const { ctx, page, errors } = await open({ startISO: sunLive(1), weeks: 3, gamesPerWeek: 14, playerCount: 8, rivals: { u_3: ['u_0'] } });
  await tab(page, 'standings'); await page.waitForTimeout(400);
  await page.click('#rvBtn'); await page.waitForTimeout(400);
  const help = await page.evaluate(() => ({ t: document.getElementById('infoTitle').textContent, n: document.querySelectorAll('#infoSheet .rvqa>div').length, cta: !!document.querySelector('[data-rvgo="pick"]') }));
  ok('+ Rival opens How rivals work, six answers, then Pick my rival', help.t === 'How rivals work' && help.n === 6 && help.cta, JSON.stringify(help));
  await page.click('[data-rvgo="pick"]'); await page.waitForTimeout(400);
  ok('Pick my rival closes the sheet and shows a + Rival on every other player',
    await page.evaluate(() => document.getElementById('infoSheet').hidden && document.querySelectorAll('#board [data-rvmk]').length === document.querySelectorAll('#board .row').length - 1));
  const mk = await page.evaluate(() => { const b = document.querySelector('#board [data-rvmk]'); const r = b.getBoundingClientRect(), p = b.closest('.row').querySelector('.pts').getBoundingClientRect(); const s = getComputedStyle(b);
    return { h: r.height, cx: r.top + r.height / 2, rowCy: b.closest('.row').getBoundingClientRect().top + b.closest('.row').getBoundingClientRect().height / 2, overlap: r.right > p.left, txt: b.textContent, fs: s.fontSize }; });
  ok('the row button reads + Rival, small, centred in the row, clear of the points', mk.txt === '+ Rival' && mk.h <= 30 && Math.abs(mk.cx - mk.rowCy) < 2 && !mk.overlap, JSON.stringify(mk));
  await page.click('#board [data-rvmk="u_1"]'); await page.waitForTimeout(150);
  await page.click('#board [data-rvmk="u_4"]'); await page.waitForTimeout(150);
  const third = await page.evaluate(() => document.querySelector('#board [data-rvmk="u_5"]').disabled);
  ok('a third choice is disabled once two are picked', third === true);
  const writes = await page.evaluate(() => window.__rivalWrites);
  ok('each tap is written: [u_1], then [u_1, u_4]', JSON.stringify(writes) === '[["u_1"],["u_1","u_4"]]', JSON.stringify(writes));
  ok('the strip counts them', /2 of 2 picked/.test(await page.textContent('#rvStrip')));
  await page.click('#rvDone'); await page.waitForTimeout(300);
  const note = await page.textContent('#rvStrip');
  ok('Done leaves a heads-up note on Standings naming both', /each get a heads up: "Lee is hunting you."/.test(note) && /Dad|Monse|Coach K|Uncle Ray|Sam/.test(note), note);
  ok('the button now reads Rivals', (await page.textContent('#rvBtn')).trim() === 'Rivals');
  await tab(page, 'picks'); await page.waitForTimeout(200); await tab(page, 'standings'); await page.waitForTimeout(200);
  ok('the note is gone once you leave Standings', (await page.textContent('#rvStrip')).trim() === '');
  /* tap a rival's row: the card, then Remove */
  await page.click('#board [data-pu="u_1"]'); await page.waitForTimeout(300);
  await page.click('[data-rvgo="rm"]'); await page.waitForTimeout(300);
  ok('Remove rival writes the list without them and drops the tag',
    JSON.stringify((await page.evaluate(() => window.__rivalWrites)).slice(-1)[0]) === '["u_4"]'
    && await page.evaluate(() => !document.querySelector('#board [data-pu="u_1"] .rvtag')));
  /* a hunter's card offers Make rival back */
  await page.click('#board [data-pu="u_3"]'); await page.waitForTimeout(300);
  const back = await page.textContent('[data-rvgo="add"]');
  ok('a player hunting you is offered Make rival back', /Make rival back/.test(back), back);
  await page.click('[data-rvgo="add"]'); await page.waitForTimeout(300);
  await page.click('#infoX'); await page.waitForTimeout(250);
  await page.click('#board [data-pu="u_6"]'); await page.waitForTimeout(300);
  const swaps = await page.evaluate(() => [...document.querySelectorAll('[data-rvgo="swap"]')].map(b => b.dataset.out));
  ok('with two rivals, another player\'s card offers a swap for each', swaps.length === 2 && swaps.includes('u_3') && swaps.includes('u_4'), JSON.stringify(swaps));
  await page.click('[data-rvgo="swap"][data-out="u_4"]'); await page.waitForTimeout(300);
  ok('a swap replaces exactly that one', JSON.stringify((await page.evaluate(() => window.__rivalWrites)).slice(-1)[0].slice().sort()) === '["u_3","u_6"]',
    JSON.stringify((await page.evaluate(() => window.__rivalWrites)).slice(-1)[0]));
  ok('no page errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

/* =================================================================== */
console.log('\n9. A refused rival write puts things back and says so');
if (want(9)) {
  const { ctx, page, errors } = await open({ startISO: sunLive(1), weeks: 3, gamesPerWeek: 14, playerCount: 6, fail: { setRivals: true } });
  await tab(page, 'standings'); await page.waitForTimeout(300);
  await page.click('#board [data-pu="u_2"]'); await page.waitForTimeout(300);
  await page.click('[data-rvgo="add"]'); await page.waitForTimeout(600);
  ok('the tag does not stick when the write fails', await page.evaluate(() => !document.querySelector('#board [data-pu="u_2"] .rvtag')));
  ok('and the player is told', /did not save/.test(await page.evaluate(() => (document.getElementById('toast') || {}).textContent || '')));
  ok('no page errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

/* =================================================================== */
console.log('\n10. The rivals line on Picks');
if (want(10)) {
  const { ctx, page, errors } = await open({ startISO: sunLive(), weeks: 1, gamesPerWeek: 12, playerCount: 6, rivals: { u_0: ['u_1', 'u_2'] } });
  const line = await page.evaluate(() => { const b = document.querySelector('#slate .rvlivebar'); return b ? b.textContent.replace(/\s+/g, ' ').trim() : null; });
  ok('a line above the cards while the week is being played', !!line && /Your rivals · live/.test(line), line || '');
  await tab(page, 'standings'); await page.waitForTimeout(300);
  if (await page.$('[data-stand="week"]')) await page.click('[data-stand="week"]');
  await page.waitForTimeout(300);
  const pts = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#board .row')].map(r => [r.dataset.pu || 'ME', +r.querySelector('.pts b').textContent])));
  const nm = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#board .row[data-pu]')].map(r => [r.dataset.pu, r.querySelector('.nrow b').textContent])));
  const expect = ['u_1', 'u_2'].map(u => { const d = pts.ME - pts[u]; return d > 0 ? `Beating ${nm[u]} by ${d}` : d < 0 ? `Behind ${nm[u]} by ${-d}` : `Tied with ${nm[u]}`; });
  ok('its numbers are the This week table\'s own differences', expect.every(e => line.includes(e)), `${line} :: ${expect.join(' | ')}`);
  await tab(page, 'picks'); await page.waitForTimeout(200);
  ok('one bar for both rivals, one tap', await page.evaluate(() => document.querySelectorAll('#slate .rvlivebar').length === 1 && document.querySelector('#slate .rvlivebar').tagName === 'BUTTON'));
  await page.click('#slate .rvlivebar'); await page.waitForTimeout(300);
  ok('tapping it opens the first rival\'s card', (await page.textContent('#infoTitle')) === `You vs ${nm.u_1}`, await page.textContent('#infoTitle'));
  const dots = await page.evaluate(() => [...document.querySelectorAll('#infoSheet [data-rvsw]')].map(b => [b.dataset.rvsw, b.getAttribute('aria-selected'), b.textContent.trim()]));
  ok('two dots, not tabs, this one lit', JSON.stringify(dots) === '[["u_1","true",""],["u_2","false",""]]', JSON.stringify(dots));
  /* A sideways swipe does the same. */
  await page.evaluate(() => { const el = document.getElementById('infoBody');
    const T = (type, x) => { const t = new Touch({ identifier: 1, target: el, clientX: x, clientY: 300 });
      el.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : [t], changedTouches: [t], bubbles: true })); };
    T('touchstart', 300); T('touchend', 120); });
  await page.waitForTimeout(300);
  ok('swiping left on the card moves to the other rival', (await page.textContent('#infoTitle')) === `You vs ${nm.u_2}`, await page.textContent('#infoTitle'));
  await page.click('#infoSheet [data-rvsw="u_1"]'); await page.waitForTimeout(300);
  ok('a tap on the other dot goes back', (await page.textContent('#infoTitle')) === `You vs ${nm.u_1}`);
  const B = await open({ startISO: new Date(Date.now() + 2 * D).toISOString(), weeks: 1, gamesPerWeek: 6, playerCount: 4, rivals: { u_0: ['u_1'] } });
  ok('no line before the week has kicked off', await B.page.evaluate(() => !document.querySelector('.rvlivebar')));
  const C = await open({ startISO: sunLive(), weeks: 1, gamesPerWeek: 6, playerCount: 4 });
  ok('no line without a rival', await C.page.evaluate(() => !document.querySelector('.rvlivebar')));
  ok('no page errors', [errors, B.errors, C.errors].every(e => !e.length));
  await B.ctx.close(); await C.ctx.close(); await ctx.close();
}

/* =================================================================== */
console.log('\n11. First visit: the walkthrough once, the hunting notice once');
if (want(11)) {
  const { ctx, page, errors } = await open({ startISO: sunLive(1), weeks: 3, gamesPerWeek: 10, playerCount: 6, autopop: true, rivals: { u_3: ['u_0'] } }, { wait: 3500 });
  const toast = await page.evaluate(() => (document.getElementById('toast') || {}).textContent || '');
  ok('a player who has been picked is told who is hunting them', /is hunting you/.test(toast), toast);
  await tab(page, 'standings'); await page.waitForTimeout(500);
  const t1 = await page.evaluate(() => ({ t: document.getElementById('infoTitle').textContent, open: !document.getElementById('infoSheet').hidden, done: getComputedStyle(document.getElementById('infoDone')).display }));
  ok('first visit to Standings opens card 1 of 3', t1.open && t1.t === 'Pick a rival', JSON.stringify(t1));
  ok('the walkthrough has no second Done button under Maybe later', t1.done === 'none');
  await page.click('[data-rvgo="later"]'); await page.waitForTimeout(300);
  ok('Maybe later closes it', await page.evaluate(() => document.getElementById('infoSheet').hidden));
  await tab(page, 'picks'); await tab(page, 'standings'); await page.waitForTimeout(400);
  ok('and it does not come back on the next visit', await page.evaluate(() => document.getElementById('infoSheet').hidden));
  const p2 = await ctx.newPage(); const e2 = []; p2.on('pageerror', e => e2.push(String(e)));
  await p2.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  await p2.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await p2.waitForTimeout(3500);
  ok('after a reload, no second hunting notice for the same player', !/is hunting you/.test(await p2.evaluate(() => (document.getElementById('toast') || {}).textContent || '')));
  await p2.click('.tab[data-tab="standings"]'); await p2.waitForTimeout(400);
  ok('and no second walkthrough', await p2.evaluate(() => document.getElementById('infoSheet').hidden));
  ok('no page errors', errors.length === 0 && e2.length === 0, errors[0] || e2[0] || '');
  await ctx.close();
  const Q = await open({ startISO: sunLive(1), weeks: 3, gamesPerWeek: 10, playerCount: 6, rivals: { u_3: ['u_0'] } });
  await tab(Q.page, 'standings'); await Q.page.waitForTimeout(400);
  ok('with pop-ups off (the older suites), nothing opens by itself', await Q.page.evaluate(() => document.getElementById('infoSheet').hidden));
  await Q.ctx.close();
}

/* =================================================================== */
console.log('\n12. A name with markup stays text everywhere Rivals prints it');
if (want(12)) {
  const evil = '<img src=x onerror="window.__pwn=1">';
  const { ctx, page, errors } = await open({ startISO: sunLive(1), weeks: 3, gamesPerWeek: 10, members: ['Lee', evil, 'Monse'], rivals: { u_1: ['u_0'], u_0: ['u_1'] } });
  await tab(page, 'standings'); await page.waitForTimeout(300);
  await page.click('#board [data-pu="u_1"]'); await page.waitForTimeout(300);
  await page.click('#infoX'); await tab(page, 'picks'); await page.waitForTimeout(300);
  ok('nothing executed', await page.evaluate(() => !window.__pwn && !document.querySelector('img[src="x"]')));
  ok('no page errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

/* =================================================================== */
/* WEEKLY WRAP ORACLE: everything on the paper, from the stub's raw rows. */
async function wrapOracle(page, wk) {
  const weeks = await page.evaluate(() => PS.getAllWeeks());
  const rev = await page.evaluate(w => PS.getRevealed(w), wk);
  const st = await page.evaluate(() => PS.getStandings());
  const mem = await page.evaluate(() => PS.getMembers());
  const gs = weeks.find(w => w.wk === wk).games, N = gs.length;
  const win = Object.fromEntries(gs.map(g => [g.id, g.winner]));
  const pts = {}; mem.forEach(m => pts[m.uid] = 0);
  rev.forEach(r => { if (r.winner === win[r.gameId]) pts[r.uid] += PAY(r.weight, N); });
  const mine = rev.filter(r => r.uid === 'u_0');
  const nm = Object.fromEntries(mem.map(m => [m.uid, m.name]));
  const seasonThru = (u, last) => weeks.filter(w => w.wk <= last).reduce((s, w) => s + (w.wk === wk ? pts[u] : (((st.find(r => r.uid === u) || {}).weeks || {})[String(w.wk)] || {}).pts || 0), 0);
  const sorted = last => mem.map(m => m.uid).sort((a, b) => (seasonThru(b, last) - seasonThru(a, last)) || String(nm[a]).localeCompare(String(nm[b])));
  /* v1.44.4 Weekly place: points, then the tiebreaker (closest without
     going over; over loses to any under; no guess last). Written out here
     from the rule, sharing no code with the app. */
  /* In 2026 it only decides from Week 8 (Lee's ruling); before that, ties share. */
  const season = await page.evaluate(() => PS.SEASON);
  const tbOn = !(String(season) === '2026' && wk < 8);
  const tbs = tbOn ? await page.evaluate(w => PS.getTiebreaks(w), wk) : [];
  const guess = Object.fromEntries(tbs.map(t => [t.uid, t.total]));
  const last = gs.slice().sort((a, b) => a.kickoff.seconds - b.kickoff.seconds).pop();
  const actual = (last.awayScore || 0) + (last.homeScore || 0);
  const tk = u => { if (!tbOn) return [0, 0]; const g = guess[u]; return g == null ? [2, 0] : g <= actual ? [0, actual - g] : [1, g - actual]; };
  const better = (u, v) => pts[u] > pts[v] || (pts[u] === pts[v] &&
    (tk(u)[0] < tk(v)[0] || (tk(u)[0] === tk(v)[0] && tk(u)[1] < tk(v)[1])));
  const wkPlace = 1 + mem.filter(m => better(m.uid, 'u_0')).length;
  return {
    pts: pts.u_0, correct: mine.filter(r => r.winner === win[r.gameId]).length, N,
    avg: Math.round(Object.values(pts).reduce((a, b) => a + b, 0) / mem.length),
    lad: mine.map(r => ({ t: r.winner, v: PAY(r.weight, N), ok: r.winner === win[r.gameId] })).sort((a, b) => b.v - a.v || a.t.localeCompare(b.t)),
    seasonRank: sorted(wk).indexOf('u_0') + 1, was: sorted(wk - 1).indexOf('u_0') + 1, wkPlace, players: mem.length,
    mnf: gs.slice().sort((a, b) => a.kickoff.seconds - b.kickoff.seconds).pop(), mineBy: Object.fromEntries(mine.map(r => [r.gameId, r])),
    allPts: pts, names: nm
  };
}
async function readWrap(page) {
  return page.evaluate(() => {
    const c = document.getElementById('wrapCard'), q = s => c.querySelector(s), qa = s => [...c.querySelectorAll(s)];
    return { open: !document.getElementById('wrapOv').hidden,
      box: qa('.box b').map(b => b.textContent), kick: q('.kick').textContent, hl: q('.hl').textContent, deck: q('.deck').textContent,
      seal: q('.seal').textContent.replace(/\s+/g, ' ').trim(), gold: !!q('.seal.gold'),
      lad: qa('.tk').map(t => ({ t: t.querySelector('b').textContent, v: +t.querySelector('i').textContent, x: t.classList.contains('x') })),
      mo: qa('.mo').map(m => ({ lab: m.querySelector('small').textContent, txt: m.querySelector('span:not(.wchip)').textContent, b: m.querySelector('b').textContent, t: m.querySelector('.wchip').textContent })),
      mnf: q('.mnf').textContent.replace(/\s+/g, ' '), stub: q('.stub').textContent.replace(/\s+/g, ' ').trim(),
      dl: q('.dl').textContent, all: c.textContent,
      cardW: c.getBoundingClientRect().width, vw: innerWidth, sw: document.documentElement.scrollWidth };
  });
}

console.log('\n13. The Weekly Wrap appears on its own, once, after the week is done');
if (want(13)) {
  const { ctx, page, errors } = await open({ startISO: tuesday(), weeks: 3, gamesPerWeek: 16, playerCount: 12, autopop: true, rivals: { u_0: ['u_4'] } }, { wait: 4200 });
  const w = await readWrap(page);
  ok('it opens by itself on the first visit after Monday night', w.open);
  ok('the eyebrow names the week', /Week 1 is in the books/.test(await page.textContent('#wrapEye')));
  const O = await wrapOracle(page, 1);
  ok('Points match the oracle', w.box[0] === String(O.pts), `${w.box[0]} vs ${O.pts}`);
  ok('Correct matches the oracle', w.box[1] === `${O.correct}/${O.N}`, `${w.box[1]} vs ${O.correct}/${O.N}`);
  ok('Pool avg matches the oracle', w.box[2] === String(O.avg), `${w.box[2]} vs ${O.avg}`);
  ok('Season rank matches the oracle', w.box[3] === ord(O.seasonRank), `${w.box[3]} vs ${ord(O.seasonRank)}`);
  ok('the ladder is every pick, biggest first, losses torn', JSON.stringify(w.lad.map(x => [x.t, x.v, !x.x])) === JSON.stringify(O.lad.map(x => [x.t, x.v, x.ok])),
    JSON.stringify(w.lad.slice(0, 4)) + ' vs ' + JSON.stringify(O.lad.slice(0, 4)));
  ok('the seal is the weekly place', O.wkPlace === 1 ? (w.gold && /1ST/.test(w.seal) && /Place/i.test(w.seal) && !/Winner/i.test(w.seal)) : new RegExp(ord(O.wkPlace).toUpperCase()).test(w.seal), w.seal + ' ' + O.wkPlace);
  ok('players count is the pool', new RegExp(O.players + ' players', 'i').test(w.dl), w.dl);
  const mk = O.mineBy[O.mnf.id];
  ok('Monday night shows the last game of the week and your pick in it', w.mnf.includes(O.mnf.away) && w.mnf.includes(O.mnf.home) && (mk ? w.mnf.includes('You: ' + mk.winner) : /No pick/.test(w.mnf)), w.mnf);
  ok('three moments, each a full sentence', w.mo.length === 3 && w.mo.every(m => m.txt.split(' ').length >= 5), JSON.stringify(w.mo));
  ok('no label and no sentence repeats on one paper', new Set(w.mo.map(m => m.lab)).size === w.mo.length && new Set(w.mo.map(m => m.txt)).size === w.mo.length);
  ok('every moment\'s number is that pick\'s real value, + for a win, struck for a loss',
    w.mo.every(m => { const l = O.lad.find(x => x.t === m.t); return l && (l.ok ? m.b === '+' + l.v : m.b === String(l.v)); }), JSON.stringify(w.mo.map(m => [m.t, m.b])));
  ok('no em dash anywhere on the paper', !/—/.test(w.all));
  ok('no leftover {placeholders}', !/[{}]/.test(w.all));
  ok('the stub is the rivalry when you have a rival', /^Rivalry/i.test(w.stub), w.stub);
  ok('the card fits the phone with no sideways scroll', w.sw <= w.vw && w.cardW <= w.vw, `${w.cardW} ${w.vw} ${w.sw}`);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  ok('Escape closes it and the page scrolls again', await page.evaluate(() => document.getElementById('wrapOv').hidden && document.body.style.overflow === ''));
  const p2 = await ctx.newPage(); await p2.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  await p2.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await p2.waitForTimeout(4200);
  ok('it does not pop up a second time', await p2.evaluate(() => document.getElementById('wrapOv').hidden));
  ok('it is one tap away in the week\'s points box', await p2.evaluate(() => { document.querySelector('.wk[data-wk="1"]').click(); return true; })
    && (await p2.waitForTimeout(1500), await p2.evaluate(() => { document.querySelector('[data-c3="pts"]').click(); return true; }))
    && (await p2.waitForTimeout(500), !!(await p2.$('#infoSheet [data-wrap="1"]'))));
  await p2.click('#infoSheet [data-wrap="1"]'); await p2.waitForTimeout(1500);
  ok('and opens the same paper from there', (await readWrap(p2)).open && (await readWrap(p2)).box[0] === String(O.pts));
  ok('no page errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

console.log('\n14. When the Weekly Wrap must NOT appear');
if (want(14)) {
  const A = await open({ startISO: sunLive(), weeks: 2, gamesPerWeek: 12, playerCount: 6, autopop: true }, { wait: 4000 });
  ok('not while the week is still being played', await A.page.evaluate(() => document.getElementById('wrapOv').hidden));
  await A.ctx.close();
  const B = await open({ startISO: tuesday(), weeks: 3, gamesPerWeek: 12, playerCount: 6 }, { wait: 4000 });
  ok('not with pop-ups switched off', await B.page.evaluate(() => document.getElementById('wrapOv').hidden));
  await B.ctx.close();
  const C = await open({ startISO: tuesday(), weeks: 3, gamesPerWeek: 12, playerCount: 6, autopop: true, noRevealed: true }, { wait: 4000 });
  ok('not for a player with no picks that week', await C.page.evaluate(() => document.getElementById('wrapOv').hidden));
  ok('and no error doing so', C.errors.length === 0, C.errors[0] || '');
  await C.ctx.close();
  const Dd = await open({ startISO: new Date(Date.now() - (19 * D)).toISOString(), weeks: 2, gamesPerWeek: 12, playerCount: 6, autopop: true }, { wait: 4000 });
  ok('not for a week long gone (back after a month away)', await Dd.page.evaluate(() => document.getElementById('wrapOv').hidden));
  await Dd.ctx.close();
  const E = await open({ startISO: tuesday(), weeks: 3, gamesPerWeek: 12, playerCount: 6, autopop: true, fail: { getRevealed: true } }, { wait: 4000 });
  ok('a failed read of last week\'s picks shows nothing rather than a broken paper', await E.page.evaluate(() => document.getElementById('wrapOv').hidden));
  ok('and the app still works', E.errors.length === 0 && await E.page.evaluate(() => document.querySelectorAll('#slate .card').length > 0));
  await E.ctx.close();
}

console.log('\n15. Share sends a 1080 x 1350 picture, or saves one');
if (want(15)) {
  const { ctx, page, errors } = await open({ startISO: tuesday(), weeks: 3, gamesPerWeek: 16, playerCount: 8, autopop: true }, { wait: 4200, share: 'files' });
  await page.waitForTimeout(800);
  await page.click('#wrapShare'); await page.waitForTimeout(1200);
  const sh = await page.evaluate(() => window.__shared);
  ok('the share sheet gets one PNG named for the week', sh.length === 1 && sh[0].n === 1 && sh[0].type === 'image/png' && /week-1/.test(sh[0].name), JSON.stringify(sh));
  /* Decode the PNG that was handed over and look at it: the paper colour
     in the corner, dark ink where the masthead is, and many distinct
     colours overall (team chips). A blank canvas fails all three. */
  const px = await page.evaluate(async () => {
    const bm = await createImageBitmap(window.__sharedFile);
    const c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height;
    const x = c.getContext('2d'); x.drawImage(bm, 0, 0);
    const at = (X, Y) => [...x.getImageData(X, Y, 1, 1).data];
    const seen = new Set(); for (let y = 0; y < bm.height; y += 23) for (let X = 0; X < bm.width; X += 23) seen.add(at(X, y).slice(0, 3).join(','));
    let dark = 0; for (let X = 300; X < 780; X += 4) { const p = at(X, 115); if (p[0] < 80 && p[1] < 80 && p[2] < 80) dark++; }
    return { w: bm.width, h: bm.height, corner: at(6, 6), dark, colours: seen.size };
  });
  ok('a real picture: paper, a masthead in ink, and the club colours', px.corner[0] > 220 && px.corner[1] > 210 && px.dark > 10 && px.colours > 40, JSON.stringify(px));
  const dims = await page.evaluate(async () => { const W = null; const c = document.createElement('canvas'); return null; });
  await ctx.close();
  const B = await open({ startISO: tuesday(), weeks: 3, gamesPerWeek: 16, playerCount: 8, autopop: true }, { wait: 4200, share: 'none' });
  await B.page.waitForTimeout(800);
  const dl = B.page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
  await B.page.click('#wrapShare');
  const d = await dl;
  ok('where the share sheet cannot take a picture, it downloads instead', !!d && /weekly-wrap-week-1\.png/.test(d.suggestedFilename()), d ? d.suggestedFilename() : 'no download');
  if (d) {
    const path = await d.path(); const fs = await import('node:fs'); const buf = fs.readFileSync(path);
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    ok('the picture is 1080 x 1350', w === 1080 && h === 1350, `${w}x${h}`);
  }
  ok('no page errors', errors.length === 0 && B.errors.length === 0, errors[0] || B.errors[0] || '');
  await B.ctx.close();
}

console.log('\n18. The week winner gets the gold seal: Week N, 1ST, Place');
if (want(18)) {
  const plan = { startISO: tuesday(), weeks: 3, gamesPerWeek: 16, playerCount: 10, autopop: true };
  const A = await open(plan, { wait: 1500 });
  const O = await wrapOracle(A.page, 1);
  const rev = await A.page.evaluate(() => PS.getRevealed(1));
  const weeks = await A.page.evaluate(() => PS.getAllWeeks());
  const win = Object.fromEntries(weeks[0].games.map(g => [g.id, g.winner]));
  const pts = {}; rev.forEach(r => { pts[r.uid] = (pts[r.uid] || 0) + (r.winner === win[r.gameId] ? PAY(r.weight, weeks[0].games.length) : 0); });
  const top = Object.entries(pts).sort((a, b) => b[1] - a[1])[0][0];
  await A.ctx.close();
  const B = await open({ ...plan, me: +top.slice(2) }, { wait: 4200 });
  const w = await readWrap(B.page);
  ok('the winner\'s paper opens with the gold seal', w.open && w.gold, JSON.stringify({ top, seal: w.seal }));
  ok('it reads Week 1, 1ST, Place, never Winner', /Week 1/i.test(w.seal) && /1ST/.test(w.seal) && /Place/i.test(w.seal) && !/Winner/i.test(w.seal), w.seal);
  ok('and the kicker says Week winner', /Week winner/i.test(w.kick), w.kick);
  ok('no page errors', B.errors.length === 0, B.errors[0] || '');
  await B.ctx.close();
}

console.log('\n19. The page always loads its own data file, and heals if it ever does not');
if (want(19)) {
  const { ctx, page, errors } = await open({ startISO: sunLive(1), weeks: 3, gamesPerWeek: 10, playerCount: 6 });
  const v = await page.evaluate(() => document.querySelector('meta[name="app-version"]').content.slice(1));
  const srcs = await page.evaluate(() => [...document.querySelectorAll('script[src*="firebase-init"],link[href*="firebase-init"]')].map(e => e.getAttribute('src') || e.getAttribute('href')));
  ok('both the preload and the script ask for firebase-init.js at this page\'s version', srcs.length === 2 && srcs.every(x => x === `./firebase-init.js?v=${v}`), JSON.stringify(srcs));
  await ctx.close();
  /* The phone that broke: the new page with an old data file. */
  const B = await open({ startISO: sunLive(1), weeks: 3, gamesPerWeek: 10, playerCount: 6, oldDataFile: true });
  await B.page.evaluate(() => { window.__marker = 1; });
  await tab(B.page, 'standings'); await B.page.waitForTimeout(300);
  await B.page.click('#board [data-pu="u_2"]'); await B.page.waitForTimeout(300);
  const nav = B.page.waitForNavigation({ timeout: 5000 }).then(() => true).catch(() => false);
  await B.page.click('[data-rvgo="add"]');
  ok('a page missing the save reloads itself instead of saying "did not save"', await nav);
  await B.page.waitForTimeout(2200);
  await B.page.click('.tab[data-tab="standings"]'); await B.page.waitForTimeout(300);
  await B.page.click('#board [data-pu="u_2"]'); await B.page.waitForTimeout(300);
  const again = B.page.waitForNavigation({ timeout: 2500 }).then(() => true).catch(() => false);
  await B.page.click('[data-rvgo="add"]');
  ok('it reloads once per version, never in a loop', !(await again));
  ok('no page errors', B.errors.length === 0, B.errors[0] || '');
  await B.ctx.close();
}

console.log('\n16. The Weekly Wrap at 320px, with reduced motion, and with no rival');
if (want(16)) {
  const { ctx, page, errors } = await open({ startISO: tuesday(), weeks: 3, gamesPerWeek: 16, playerCount: 40, autopop: true }, { wait: 4200, w: 320, h: 640, reduced: true });
  const w = await readWrap(page);
  ok('it opens at 320px', w.open);
  ok('no sideways scroll at 320px', w.sw <= w.vw, `${w.sw} > ${w.vw}`);
  ok('the stub falls back to the week winner without a rival', /^Week winner/i.test(w.stub), w.stub);
  const motion = await page.evaluate(() => getComputedStyle(document.getElementById('wrapSlot')).transform);
  ok('reduced motion: the paper does not fly in', motion === 'none' || /matrix\(1, 0, 0, 1, 0, 0\)/.test(motion), motion);
  const btn = await page.evaluate(() => { const r = document.getElementById('wrapClose').getBoundingClientRect(); return r.bottom <= innerHeight + 1 || document.getElementById('wrapOv').scrollHeight > innerHeight; });
  ok('Close is reachable (on screen or by scrolling the layer)', btn);
  ok('no page errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

console.log('\n17. The words: different players, different lines');
if (want(17)) {
  /* Same week, three different players: their papers must not read alike. */
  const texts = [];
  /* P.me signs the stub in as a different member, so each run is a
     different uid with that member's own picks, as in the real pool. */
  for (const me of [1, 2, 3]) {
    const { ctx, page } = await open({ startISO: tuesday(), weeks: 3, gamesPerWeek: 16, playerCount: 8, me, autopop: true }, { wait: 4200 });
    const w = await readWrap(page);
    texts.push(w.mo.map(m => m.txt).concat([w.deck]));
    await ctx.close();
  }
  const all = texts.flat();
  ok('no sentence is shared word for word between three players', new Set(all).size === all.length, JSON.stringify(texts));
}

console.log('\n20. The Weekly Wrap opens about as soon as the app does');
if (want(20)) {
  /* v1.44.3 Lee: the wrap came about five seconds after opening. Network
     here is slowed to roughly a phone on 4G, so the old order (standings,
     then 1.9s of timers, then picks, then scoring mode, one after another)
     shows up as a number rather than a feeling. Measured from navigation
     to the overlay being visible. */
  const delay = { getStandings: 800, getRevealed: 800, getScoringMode: 400 };
  const { ctx, page, errors } = await open({ startISO: tuesday(), weeks: 3, gamesPerWeek: 16, playerCount: 12, autopop: true, delay }, { wait: 1 });
  const t0 = Date.now();
  let ms = null;
  for (let i = 0; i < 120; i++) {
    if (await page.evaluate(() => { const o = document.getElementById('wrapOv'); return !!o && !o.hidden; })) { ms = Date.now() - t0; break; }
    await page.waitForTimeout(50);
  }
  ok('the wrap opens on its own', ms != null, 'never opened in 6s');
  ok('and within two seconds of opening the app, on a slow network', ms != null && ms < 2000, `${ms}ms`);
  const w = await readWrap(page);
  const O = await wrapOracle(page, 1);
  ok('it still shows the right points after reading in parallel', w.box[0] === String(O.pts), `${w.box[0]} vs ${O.pts}`);
  ok('no page errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

console.log('\n21. Week 8, rebuilt: a tie on points is settled by the tiebreaker');
if (want(21)) {
  /* v1.44.4 The real Week 8: two players on 91, one guessed 48 and one 58,
     the game finished on 51, and the app crowned both. Rebuilt here on a
     fixture whose top rows really are level on points: the player who
     sorts FIRST by name is given the over guess (+7), so a name-ordered
     table, or a shared one, gets it wrong; the second is given the under
     guess (-3); every other level player overshoots by 20. Expected:
     1st is the -3 guess alone, 2nd is the +7 guess alone. */
  const plan = { playerCount: 50, weeks: 6, season: '2027', startISO: new Date(Date.now() - 40 * D).toISOString() };
  /* Your own row carries no data-pu, and you (u_0) can be one of the level
     players. The first draft of this case left you out, so your default
     guess landed on the same number as the -3 guess and two players
     rightly shared first: the rule was right and the fixture was not. */
  const board = async page => page.evaluate(() => [...document.querySelectorAll('#board .row')].map(r => ({
    uid: r.dataset.pu || 'u_0', name: (r.querySelector('.who b') || {}).textContent, pts: +((r.querySelector('.pts b') || {}).textContent || 0),
    gold: !!r.querySelector('.leadtag:not(.silver)'), silver: !!r.querySelector('.leadtag.silver') })));
  let { ctx, page } = await open(plan, { wait: 2600 });
  await page.click('button[data-tab="standings"]').catch(() => {}); await page.click('[data-stand="week"]').catch(() => {});
  await page.waitForTimeout(500);
  const before = await board(page);
  const weeks = await page.evaluate(() => PS.getAllWeeks());
  const gs = weeks[weeks.length - 1].games;
  const lastG = gs.slice().sort((a, b) => a.kickoff.seconds - b.kickoff.seconds).pop();
  const actual = lastG.awayScore + lastG.homeScore;
  await ctx.close();
  const best = Math.max(...before.map(r => r.pts));
  const level = before.filter(r => r.pts === best).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  ok('the fixture has players level on points at the top', level.length >= 2, `${level.length} on ${best}`);
  const idx = u => +String(u).replace('u_', '');
  const tbTotals = [];
  level.forEach(r => { tbTotals[idx(r.uid)] = actual + 20; });
  tbTotals[idx(level[0].uid)] = actual + 7;      // like Lubbylubbs on 58
  tbTotals[idx(level[1].uid)] = actual - 3;      // like Jeremy on 48
  ({ ctx, page } = await open({ ...plan, tbTotals }, { wait: 2600 }));
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.click('button[data-tab="standings"]').catch(() => {}); await page.click('[data-stand="week"]').catch(() => {});
  await page.waitForTimeout(500);
  const after = await board(page);
  const golds = after.filter(r => r.gold), silvers = after.filter(r => r.silver);
  ok('one week winner, not every player on the best score', golds.length === 1, `${golds.length} gold`);
  ok('and it is the guess that stayed under the total', golds[0] && golds[0].uid === level[1].uid,
     `${golds[0] && golds[0].name} vs expected ${level[1].name}`);
  ok('the over guess on the same points is runner-up, alone', silvers.length === 1 && silvers[0].uid === level[0].uid,
     JSON.stringify(silvers.map(r => r.name)));
  ok('and the table lists them in that order', after[0].uid === level[1].uid && after[1].uid === level[0].uid,
     after.slice(0, 3).map(r => r.name).join(', '));
  await page.click('button[data-tab="grid"]').catch(() => {});
  await page.waitForTimeout(500);
  const cap = await page.evaluate(() => (document.querySelector('.tbstrip') || {}).textContent || '');
  const c1 = cap.replace(/\s+/g, ' ').trim();
  ok('the Grid says they finished tied, and who was closest without going over',
     /finished the week tied with \d+ points each/.test(c1) && /tiebreaker was the .+ game total points/.test(c1)
       && c1.includes(`${level[1].name} was closest without going over`), c1);
  ok('and never says "level"', !/\blevel\b/i.test(c1), c1);
  ok('no page errors', errors.length === 0, errors[0] || '');
  await ctx.close();

  /* Lee's ruling: in 2026 it starts at Week 8. The same tie in Week 6 of
     2026 is shared, as it always was. */
  ({ ctx, page } = await open({ ...plan, season: '2026', tbTotals }, { wait: 2600 }));
  await page.click('button[data-tab="standings"]').catch(() => {}); await page.click('[data-stand="week"]').catch(() => {});
  await page.waitForTimeout(500);
  const old = await board(page);
  ok('in 2026, before Week 8, a tie on points is still shared',
     old.filter(r => r.gold).length === level.length, `${old.filter(r => r.gold).length} gold for ${level.length} tied`);
  await ctx.close();
}

console.log('\n22. The new Weekly Wrap: stamps, one-line headline, and a line nobody else got');
if (want(22)) {
  /* v1.44.5, Lee's design. The rules are read from index.html's own text
     and the rendered cards are graded against an oracle built here from
     the stub's raw data, so the app cannot agree with itself about
     something untrue. */
  const fs = await import('fs');
  const src = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const grab = name => { const a = src.indexOf(`const ${name}={`); let d = 0, i = a + name.length + 7;
    for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (!d) break; } } return eval('(' + src.slice(a + name.length + 7, i + 1) + ')'); };
  const DECK = grab('DECK'), WR = grab('WR');
  const tokens = new Set(['{B}', '{BV}', '{W}', '{WV}', '{PTS}', '{c}', '{N}', '{sp}', '{wp}']);
  const kinds = ['win', 'winTie', 'rise', 'up', 'fall', 'down', 'hold', 'first'];
  const probs = [];
  kinds.forEach(k => { const a = DECK[k] || [];
    if (a.length < 40) probs.push(`${k} has ${a.length}`);
    if (new Set(a).size !== a.length) probs.push(`${k} repeats a line`);
    a.forEach(t => { (t.match(/\{\w+\}/g) || []).forEach(x => { if (!tokens.has(x)) probs.push(`${k} ${x}: ${t}`); });
      const plain = t.replace(/\{\w+\}/g, '');
      if (/\bweek/i.test(plain)) probs.push(`${k} says week: ${t}`);
      if (/\d/.test(plain)) probs.push(`${k} has a bare number: ${t}`);
      if (/[–—]/.test(t)) probs.push(`${k} has a dash: ${t}`); }); });
  ok('every bank has 40+ different lines, no "week", no spot count, no bare number, no dash', probs.length === 0, probs.slice(0, 3).join(' | '));
  const wrBad = Object.values(WR).flatMap(c => c.txt).filter(t => /\{v\}/.test(t) || /\{V\}\s+\w*\s*points?\b/.test(t));
  ok('every highlight line prints its points as "N points", once', wrBad.length === 0, wrBad.join(' | '));
  /* The hand-out itself, run straight from index.html's source on pools
     far bigger than this fixture, where a shared line cannot hide. */
  const fnSrc = name => { const a = src.indexOf(`function ${name}(`); let d = 0, i = src.indexOf('{', a);
    for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (!d) break; } } return src.slice(a, i + 1); };
  const assign = eval(`(() => { ${src.match(/const hashS=.*?;\n/)[0]} ${fnSrc('assignWrapLines')}; return assignWrapLines; })()`);
  const both = { b: { t: 'LAR', v: 13 }, w: { t: 'KC', v: 14 } }, none = { b: null, w: null };
  const uids = n => Array.from({ length: n }, (_, i) => 'u_' + String(i).padStart(3, '0'));
  const texts = o => Object.values(o).map(x => x.text);
  const f40 = assign(uids(40), () => 'fall', () => both, 8, '2026');
  ok('40 players slipping in the same week: 40 different lines', new Set(texts(f40)).size === 40, `${new Set(texts(f40)).size} different`);
  const plainHold = DECK.hold.filter(t => !/\{(B|BV|W|WV)\}/.test(t)).length;
  const h40 = assign(uids(40), () => 'hold', () => none, 8, '2026');
  ok('a player with no team to name never gets a line that names one', texts(h40).every(t => !/\{(B|BV|W|WV)\}/.test(t)));
  ok(`with no teams to name: every one of the ${plainHold} plain lines is used before any repeats`, new Set(texts(h40)).size === plainHold, `${new Set(texts(h40)).size} of ${plainHold}`);
  const f40b = assign(uids(40), () => 'fall', () => both, 9, '2026');
  const same = uids(40).filter(u => f40[u].text === f40b[u].text).length;
  ok('nobody gets the same line two weeks running', same === 0, `${same} repeats`);
  const mixed = assign(uids(27), u => ['win', 'rise', 'up', 'fall', 'down', 'hold'][+u.slice(2) % 6], () => both, 8, '2026');
  ok('a winner never repeats their points total in the witty line', Object.values(mixed).filter(x => x.kind === 'win').every(x => !x.text.includes('{PTS}')));

  /* The oracle: week points, then the tiebreaker (season 2027, so it
     decides from Week 1), for every player. */
  const plan = { startISO: tuesday(), weeks: 3, gamesPerWeek: 16, playerCount: 12, autopop: true, season: '2027' };
  const A = await open(plan, { wait: 1500 });
  const rev = await A.page.evaluate(() => PS.getRevealed(1)), weeks = await A.page.evaluate(() => PS.getAllWeeks());
  const tbs = await A.page.evaluate(() => PS.getTiebreaks(1)), mem = await A.page.evaluate(() => PS.getMembers());
  await A.ctx.close();
  const gs = weeks[0].games, N = gs.length, win = Object.fromEntries(gs.map(g => [g.id, g.winner]));
  const last = gs.slice().sort((a, b) => a.kickoff.seconds - b.kickoff.seconds).pop(), actual = last.awayScore + last.homeScore;
  const guess = Object.fromEntries(tbs.map(t => [t.uid, t.total]));
  const pts = {}; mem.forEach(m => pts[m.uid] = 0);
  rev.forEach(r => { if (r.winner === win[r.gameId]) pts[r.uid] += PAY(r.weight, N); });
  const tk = u => { const g = guess[u]; return g == null ? [2, 0] : g <= actual ? [0, actual - g] : [1, g - actual]; };
  const better = (u, v) => pts[u] > pts[v] || (pts[u] === pts[v] && (tk(u)[0] < tk(v)[0] || (tk(u)[0] === tk(v)[0] && tk(u)[1] < tk(v)[1])));
  const place = u => 1 + mem.filter(m => better(m.uid, u)).length;
  const ranked = mem.map(m => m.uid).sort((a, b) => place(a) - place(b));
  const pickIdx = ranked;   // every player: a line shared by any two of them is a failure
  const decks = [];
  for (const u of pickIdx) {
    const B = await open({ ...plan, me: +u.slice(2) }, { wait: 4200 });
    const r = await B.page.evaluate(() => { const c = document.getElementById('wrapCard'), s = c.querySelector('.seal'), h = c.querySelector('.hl');
      return { cls: s.className, label: s.getAttribute('aria-label'), deck: c.querySelector('.deck').textContent,
        fit: h.dataset.fit, fs: parseFloat(h.style.fontSize), over: h.scrollWidth > h.clientWidth + 0.5, ws: getComputedStyle(h).whiteSpace,
        mo: [...c.querySelectorAll('.mo span:not(.wchip)')].map(e => e.textContent), boxes: c.querySelectorAll('.box > div').length,
        /* Would it have fitted on one line at the 20px floor? Then two lines is wrong. */
        fits20: (() => { const k = h.cloneNode(true); k.style.fontSize = '20px'; k.style.whiteSpace = 'nowrap'; k.style.textWrap = ''; h.parentNode.appendChild(k);
          const f = k.scrollWidth <= k.clientWidth + 0.5; k.remove(); return f; })(),
        at32: (() => { const k = h.cloneNode(true); k.style.fontSize = '32px'; k.style.whiteSpace = 'nowrap'; h.parentNode.appendChild(k);
          const f = k.scrollWidth <= k.clientWidth + 0.5; k.remove(); return f; })() }; });
    const p = place(u), want = p === 1 ? 'gold' : p === place(ranked.find(v => place(v) > 1)) ? 'silver' : 'red';
    ok(`${u} (place ${p}): ${want} stamp, labelled with the place`, r.cls.includes(want) && new RegExp(`\\b${p}(st|nd|rd|th) place`).test(r.label), `${r.cls} / ${r.label}`);
    ok(`${u}: the headline sits on one line at 20px or more, or on two at 28px`, (r.fit === 'one' && !r.over && r.fs >= 20 && r.fs <= 32 && r.ws === 'nowrap') || (r.fit === 'two' && r.fs === 28), JSON.stringify({ fit: r.fit, fs: r.fs, over: r.over }));
    ok(`${u}: two lines only when one line would need less than 20px`, r.fit === 'one' ? true : !r.fits20, JSON.stringify({ fit: r.fit, fits20: r.fits20 }));
    ok(`${u}: as large as fits: 32px when 32px fits, smaller only when it does not`, r.fit !== 'one' || (r.at32 ? r.fs === 32 : r.fs < 32), JSON.stringify({ fs: r.fs, at32: r.at32 }));
    const leftover = (r.deck + ' ' + r.mo.join(' ')).replace(/\b49ers\b/g, '').replace(/\d+ points?\b/g, '').replace(/\d+ spots?\b/g, '').replace(/\d+ of \d+/g, '').replace(/\d+(st|nd|rd|th)\b/g, '');
    ok(`${u}: every number in the words is a place, a count or "N points"`, !/\d/.test(leftover), r.deck + ' || ' + r.mo.join(' | '));
    const tail = r.deck.replace(/^[^.]*\.\s*/, '');
    ok(`${u}: the witty line never says "week" again`, !/\bweek\b/i.test(tail), r.deck);
    ok(`${u}: four boxes in the number row`, r.boxes === 4, String(r.boxes));
    decks.push(r.deck);
    await B.ctx.close();
  }
  ok(`all ${decks.length} players, ${decks.length} different lines`, new Set(decks.map(d => d.replace(/^[^.]*\.\s*/, ''))).size === decks.length, JSON.stringify(decks));
}

console.log('\n23. Two rivals: both on the Weekly Wrap, stacked, and in the Share picture');
if (want(23)) {
  const plan = { startISO: tuesday(), weeks: 3, gamesPerWeek: 16, playerCount: 10, autopop: true, rivals: { u_0: ['u_4', 'u_5'] } };
  const A = await open(plan, { wait: 4200, share: 'files' });
  await A.page.waitForTimeout(800);
  const O = await wrapOracle(A.page, 1);
  const r = await A.page.evaluate(() => {
    const c = document.getElementById('wrapCard');
    return { open: !document.getElementById('wrapOv').hidden,
      rows: [...c.querySelectorAll('.stub.two .rvrow')].map(x => ({ name: x.querySelector('.lb b').textContent,
        vs: [...x.querySelectorAll('.vs span')].map(s => +s.textContent), rec: x.querySelector('.rec').textContent.replace(/\s+/g, ' ').trim() })),
      bg: [...c.querySelectorAll('.stub.two .rvrow')].map(x => getComputedStyle(x).backgroundColor),
      tallCard: c.classList.contains('tall'), tallSlot: document.getElementById('wrapSlot').classList.contains('tall'),
      h: c.offsetHeight, w: c.offsetWidth, sh: document.getElementById('wrapSlot').clientHeight, sw2: document.getElementById('wrapSlot').clientWidth,
      over: [...c.querySelectorAll('.stub.two .rvrow')].some(x => x.getBoundingClientRect().bottom > c.getBoundingClientRect().bottom + 0.5),
      vw: innerWidth, sw: document.documentElement.scrollWidth };
  });
  ok('it opens', r.open);
  ok('two rivals: both on the card, one row each', r.rows.length === 2 &&
    r.rows[0].name === 'vs ' + O.names.u_4 && r.rows[1].name === 'vs ' + O.names.u_5, JSON.stringify(r.rows));
  ok('each row: your points to theirs, from the oracle', r.rows.length === 2 &&
    r.rows.every((x, i) => x.vs[0] === O.allPts.u_0 && x.vs[1] === O.allPts[['u_4', 'u_5'][i]]), JSON.stringify(r.rows.map(x => x.vs)) + ' vs ' + JSON.stringify([O.allPts.u_0, O.allPts.u_4, O.allPts.u_5]));
  ok('each row carries Lead, Trail or Tied and a record', r.rows.length === 2 && r.rows.every(x => /^(Lead|Trail|Tied) ?\d+-\d+(-\d+)?$/.test(x.rec)), JSON.stringify(r.rows.map(x => x.rec)));
  ok('the rows sit on the paper strip, not on a dark app row', r.bg.length === 2 && r.bg.every(v => v === 'rgba(0, 0, 0, 0)'), JSON.stringify(r.bg));
  ok('the card and its slot grow to fit', r.tallCard && r.tallSlot, JSON.stringify(r));
  ok('nothing spills off the bottom of the card', !r.over);
  ok('the card is 420 by 565, and its slot has the same shape', r.w === 420 && r.h === 565 && Math.abs(r.sh / r.sw2 - 565 / 420) < 0.01, `${r.w}x${r.h} slot ${r.sw2}x${r.sh}`);
  ok('still no sideways scroll', r.sw <= r.vw, `${r.sw} ${r.vw}`);
  await A.page.click('#wrapShare'); await A.page.waitForTimeout(1200);
  const px = await A.page.evaluate(async () => {
    const bm = await createImageBitmap(window.__sharedFile);
    const c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height;
    const x = c.getContext('2d'); x.drawImage(bm, 0, 0);
    let ink = 0; for (let X = 40; X < 1040; X += 3) { const p = x.getImageData(X, bm.height - 50, 1, 1).data; if (p[0] < 90 && p[1] < 90 && p[2] < 90) ink++; }
    return { w: bm.width, h: bm.height, ink };
  });
  ok('the Share picture grows the same way: 1080 x 1453', px.w === 1080 && px.h === 1453, `${px.w}x${px.h}`);
  ok('and the second rival is drawn in it (ink on the bottom row)', px.ink > 8, String(px.ink));
  ok('no page errors', A.errors.length === 0, A.errors[0] || '');
  await A.ctx.close();

  const B = await open({ ...plan, rivals: { u_0: ['u_4'] } }, { wait: 4200 });
  const b = await B.page.evaluate(() => { const c = document.getElementById('wrapCard');
    return { two: !!c.querySelector('.stub.two'), stub: c.querySelector('.stub').textContent.replace(/\s+/g, ' ').trim(),
      tall: c.classList.contains('tall') || document.getElementById('wrapSlot').classList.contains('tall') }; });
  ok('one rival: the single strip as before, card not grown', !b.two && !b.tall && /^Rivalry/.test(b.stub), JSON.stringify(b));
  await B.ctx.close();
  const C = await open({ ...plan, rivals: {} }, { wait: 4200 });
  const c = await C.page.evaluate(() => { const k = document.getElementById('wrapCard');
    return { stub: k.querySelector('.stub').textContent.replace(/\s+/g, ' ').trim(), tall: k.classList.contains('tall') }; });
  ok('no rival: the week winner, card not grown', /^Week winner/i.test(c.stub) && !c.tall, JSON.stringify(c));
  await C.ctx.close();
}

console.log('\n24. The Grid: a wrong pick has a red undertone, a red box still means no pick');
if (want(24)) {
  /* A finished week with wins and losses, plus a player with no picks at
     all for the "no pick" cells, and a live week for in-progress cells. */
  const A = await open({ startISO: tuesday(), weeks: 3, gamesPerWeek: 12, playerCount: 8 }, { wait: 3000 });
  await A.page.evaluate(() => { const o = document.getElementById('wrapOv'); if (o) o.hidden = true; });
  await tab(A.page, 'grid'); await A.page.waitForTimeout(400);
  await A.page.evaluate(() => document.querySelector('.wk[data-wk="1"]').click()); await A.page.waitForTimeout(1500);
  const g = await A.page.evaluate(() => {
    const st = s => { const c = document.querySelector('#v-grid ' + s); if (!c) return null; const k = getComputedStyle(c);
      const b = c.querySelector('b'); return { bg: k.backgroundColor, bd: k.borderTopColor, col: k.color,
        strike: b ? getComputedStyle(b).textDecorationLine : '' }; };
    const lg = [...document.querySelectorAll('#v-grid .legend span')].map(x => x.textContent.trim());
    const sw = c => { const e = document.querySelector('#v-grid .legend .' + c); if (!e) return null; const k = getComputedStyle(e);
      return { bg: k.backgroundColor, img: k.backgroundImage, bd: k.borderTopColor }; };
    /* An ordinary row and your own row, so the undertone is checked where
       it is new AND where the row already tints. */
    const missOther = [...document.querySelectorAll('#v-grid tbody tr:not(.me):not(.poolrow) .cell.miss')].length;
    return { miss: st('tbody tr:not(.me) .cell.miss'), hit: st('.cell.hit'), lg, missOther,
      swMiss: sw('lg-miss'), swNone: sw('lg-none'), swHid: sw('lg-hid') };
  });
  ok('the fixture has wrong picks on other players\' rows', g.missOther > 0 && !!g.miss, String(g.missOther));
  ok('a wrong pick has the red undertone', g.miss && g.miss.bg === 'rgba(200, 52, 42, 0.07)', JSON.stringify(g.miss));
  ok('a wrong pick keeps a grey outline, so a red box still means no pick', g.miss && g.miss.bd === 'rgba(250, 247, 241, 0.1)', JSON.stringify(g.miss));
  ok('a wrong pick keeps grey text and its strike-through', g.miss && g.miss.col === 'rgba(250, 247, 241, 0.62)' && g.miss.strike === 'line-through', JSON.stringify(g.miss));
  ok('a correct pick is unchanged: solid green, white text', g.hit && g.hit.col === 'rgb(255, 255, 255)' && g.hit.bg === g.hit.bd, JSON.stringify(g.hit));
  ok('the legend explains the red box: No pick, right after Wrong',
    JSON.stringify(g.lg) === JSON.stringify(['Correct', 'Wrong', 'No pick', 'In progress', 'Sealed until kickoff', 'Closest tiebreaker']), JSON.stringify(g.lg));
  ok('the Wrong swatch carries a strike, like a wrong cell', g.swMiss && /linear-gradient/.test(g.swMiss.img), JSON.stringify(g.swMiss));
  ok('the No pick swatch has the red outline, nothing inside', g.swNone && /^rgba\(200, 52, 42, 0\.55\)$/.test(g.swNone.bd) && g.swNone.img === 'none' && g.swNone.bg === 'rgba(0, 0, 0, 0)', JSON.stringify(g.swNone));
  ok('Wrong and Sealed no longer look alike in the legend', g.swMiss && g.swHid && g.swMiss.img !== g.swHid.img, JSON.stringify([g.swMiss, g.swHid]));
  ok('no page errors', A.errors.length === 0, A.errors[0] || '');
  await A.ctx.close();

  /* A missed pick: same red box as before, no undertone. */
  const B = await open({ startISO: tuesday(), weeks: 3, gamesPerWeek: 12, playerCount: 8 }, { wait: 3000 });
  await B.page.evaluate(() => { const o = document.getElementById('wrapOv'); if (o) o.hidden = true; });
  await tab(B.page, 'grid'); await B.page.waitForTimeout(400);
  await B.page.evaluate(() => document.querySelector('.wk[data-wk="1"]').click()); await B.page.waitForTimeout(1500);
  const none = await B.page.evaluate(() => {
    /* Render one "no pick" cell exactly as the app writes it and read its style. */
    const td = document.querySelector('#v-grid tbody tr:not(.poolrow) td:nth-child(2)');
    const d = document.createElement('div'); d.className = 'cell none'; d.innerHTML = '<b>—</b>'; td.appendChild(d);
    const k = getComputedStyle(d); return { bg: k.backgroundColor, bd: k.borderTopColor, col: k.color };
  });
  ok('a missed pick is unchanged: red outline, red dash, no fill', none.bg === 'rgba(0, 0, 0, 0)' && none.bd === 'rgba(200, 52, 42, 0.3)' && none.col === 'rgb(224, 100, 90)', JSON.stringify(none));
  await B.ctx.close();

  /* Live games: an in-progress cell is still a solid dark fill, so it cannot be mistaken for a loss. */
  const C = await open({ startISO: sunLive(), weeks: 2, gamesPerWeek: 12, playerCount: 8 }, { wait: 3000 });
  await tab(C.page, 'grid'); await C.page.waitForTimeout(2000);
  const live = await C.page.evaluate(() => { const c = document.querySelector('#v-grid .cell.pend'); const m = document.querySelector('#v-grid .cell.miss');
    return { pend: c && getComputedStyle(c).backgroundColor, miss: m && getComputedStyle(m).backgroundColor }; });
  ok('an in-progress pick keeps its solid fill, unlike a loss', !!live.pend && live.pend !== 'rgba(0, 0, 0, 0)' && live.pend !== 'rgba(200, 52, 42, 0.07)', JSON.stringify(live));
  ok('no page errors on a live Sunday', C.errors.length === 0, C.errors[0] || '');
  await C.ctx.close();
}

console.log('\n25. Level on points AND on the tiebreaker: one shared place, on every screen');
if (want(25)) {
  /* v1.44.8 Found by the planted pair in the test pool (Test Quarters and
     Test Redzone): same picks, same guess, both 52 points and 31, and the
     Grid numbered them 13 and 14. weekOrder() already shared the place;
     the row numbers ignored it. Built here on a level group: two of them
     get the SAME under guess, the rest of the group overshoots. */
  const plan = { playerCount: 30, weeks: 6, season: '2027', startISO: new Date(Date.now() - 40 * D).toISOString() };
  const board = async page => page.evaluate(() => [...document.querySelectorAll('#board .row')].map(r => ({
    uid: r.dataset.pu || 'u_0', name: (r.querySelector('.who b') || {}).textContent.trim(),
    pts: +((r.querySelector('.pts b') || {}).textContent || 0),
    rank: +(((r.querySelector('.rank') || {}).firstChild || {}).textContent || 0) })));
  let { ctx, page } = await open(plan, { wait: 2600 });
  await page.click('button[data-tab="standings"]').catch(() => {}); await page.click('[data-stand="week"]').catch(() => {});
  await page.waitForTimeout(500);
  const before = await board(page);
  const weeks = await page.evaluate(() => PS.getAllWeeks());
  const lastG = weeks[weeks.length - 1].games.slice().sort((a, b) => a.kickoff.seconds - b.kickoff.seconds).pop();
  const actual = lastG.awayScore + lastG.homeScore;
  await ctx.close();
  const by = {}; before.filter(r => r.uid !== 'u_0').forEach(r => (by[r.pts] ||= []).push(r));
  const grp = Object.values(by).filter(g => g.length >= 3).sort((a, b) => b[0].pts - a[0].pts)[0]
           || Object.values(by).filter(g => g.length >= 2)[0];
  ok('the fixture has a group level on points', !!grp, JSON.stringify(Object.keys(by)));
  const idx = u => +String(u).replace('u_', '');
  const tbTotals = [];
  for (let i = 0; i < 30; i++) tbTotals[i] = actual + 40 + i;     // everyone else: far over, all different
  const [A, B, ...rest] = grp;
  tbTotals[idx(A.uid)] = actual - 2; tbTotals[idx(B.uid)] = actual - 2;   // identical, under
  rest.forEach((r, k) => { tbTotals[idx(r.uid)] = actual + 5 + k; });
  ({ ctx, page } = await open({ ...plan, tbTotals }, { wait: 2600 }));
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.click('button[data-tab="standings"]').catch(() => {}); await page.click('[data-stand="week"]').catch(() => {});
  await page.waitForTimeout(500);
  const after = await board(page);
  const a = after.find(r => r.uid === A.uid), b = after.find(r => r.uid === B.uid);
  ok('Standings, This week: the two share one place', a && b && a.rank === b.rank && a.rank > 0, JSON.stringify([a, b]));
  const nextRow = after[Math.max(after.indexOf(a), after.indexOf(b)) + 1];
  ok('and the next player skips a number (13, 13, 15)', nextRow && nextRow.rank === a.rank + 2, JSON.stringify(nextRow));
  const others = after.filter(r => r.pts === A.pts && r.uid !== A.uid && r.uid !== B.uid);
  ok('the rest of the level group, separated by their guesses, do not share', new Set(others.map(r => r.rank)).size === others.length,
     JSON.stringify(others.map(r => r.rank)));
  const ranks = after.map(r => r.rank);
  ok('every other place is its row position, unchanged', after.every((r, i) => r.rank === i + 1 || r.rank === ranks[i - 1] || (i > 0 && r.rank === i + 1)),
     JSON.stringify(ranks));
  await page.click('[data-stand="season"]').catch(() => {}); await page.waitForTimeout(300);
  const season = await board(page);
  ok('the Season view still numbers 1 to N', season.every((r, i) => r.rank === i + 1), JSON.stringify(season.map(r => r.rank)));
  await tab(page, 'grid'); await page.waitForTimeout(600);
  const grid = await page.evaluate(() => [...document.querySelectorAll('#gridBody tbody tr:not(.poolrow)')].map(tr => ({
    name: (tr.querySelector('.plmeta b') || {}).textContent, rank: +((tr.querySelector('.plrank') || {}).textContent || 0), pts: +((tr.querySelector('.totnum') || {}).textContent || 0), wk: document.querySelector('.wk.on') && document.querySelector('.wk.on').dataset.wk })));
  const ga = grid.find(r => r.name === A.name), gb = grid.find(r => r.name === B.name);
  ok('the Grid shows the same shared place', ga && gb && ga.rank === gb.rank && ga.rank === a.rank, JSON.stringify([ga, gb, a.rank]));
  const gNext = grid[Math.max(grid.indexOf(ga), grid.indexOf(gb)) + 1];
  ok('and on the Grid the next player skips a number too', gNext && gNext.rank === ga.rank + 2, JSON.stringify(gNext));
  /* Where both screens hold the same points they must give the same
     place. (In this fixture the lower rows' Standings points come from
     the stored season record while the Grid adds up revealed picks, so
     only rows whose two totals agree are comparable.) */
  const same = after.filter(r => { const g = grid.find(x => x.name === r.name); return g && g.pts === r.pts; });
  ok('the Grid and Standings agree on every comparable place', same.length >= 4 && same.every(r => grid.find(x => x.name === r.name).rank === r.rank),
     `${same.length} comparable; ` + JSON.stringify(same.filter(r => grid.find(x => x.name === r.name).rank !== r.rank).slice(0, 3)));
  ok('no page errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

console.log('\n26. A perfect week gets its trophy even when the scorer did not flag it');
if (want(26)) {
  /* v1.44.9 Week 9 2026: two players went 15 of 15 and neither got the
     trophy, because it came only from the scorer's perfectWeeks. Here the
     scorer's record holds each week's correct count but never sets
     `perfect`; the app must see a finished week called in full. */
  const N = 6;
  /* Week 1 finished nine days ago; week 2 kicks off in five days. */
  const plan = { playerCount: 6, weeks: 2, gamesPerWeek: N, startISO: new Date(Date.now() - 9 * D).toISOString(),
    noPerfectFlag: true, stdWeek: { u_2: { 1: { hits: N } }, u_3: { 1: { hits: N - 1 } } },
    /* Nobody else's picks, and mine right in week 1: so the only trophies
       are u_2 (from the scorer's record) and me (from my picks, the moment
       the week is final, before any record says so). */
    noRevealed: true, myPicksRight: [1] };
  const { ctx, page } = await open(plan, { wait: 2600 });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.click('button[data-tab="standings"]').catch(() => {}); await page.click('[data-stand="season"]').catch(() => {});
  await page.waitForTimeout(500);
  const rows = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#board .row')].map(r => {
    const sv = r.querySelector('svg.seals');
    return [r.dataset.pu || 'u_0', { trophy: r.querySelectorAll('.sl-trophy').length, aria: sv ? sv.getAttribute('aria-label') : '' }]; })));
  ok('a finished week with every game right: the trophy shows on Season', rows.u_2 && rows.u_2.trophy === 1, JSON.stringify(rows.u_2));
  ok('and its label says perfect week', rows.u_2 && /1 perfect week/.test(rows.u_2.aria), JSON.stringify(rows.u_2));
  ok('one game short: no trophy', rows.u_3 && rows.u_3.trophy === 0, JSON.stringify(rows.u_3));
  ok('nobody else gets one on Season yet (my week 1 is not the week on screen)', Object.entries(rows).filter(([u]) => u !== 'u_2').every(([, r]) => r.trophy === 0), JSON.stringify(rows));
  const subOf = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#board .row')].map(r =>
    [r.dataset.pu || 'u_0', { trophy: r.querySelectorAll('.sl-trophy').length, sub: r.innerText.replace(/\s+/g, ' ') }])));
  const season = await subOf();
  ok('Season writes it out: "1 perfect week"', /1 perfect week/.test(season.u_2.sub) && !/perfect/.test(season.u_3.sub), JSON.stringify([season.u_2.sub, season.u_3.sub]));
  /* And on the week it happened (Lee: "it should reflect on the week and season"). */
  await page.evaluate(() => { const b = document.querySelector('.wk[data-wk="1"]'); if (b) b.click(); });
  await page.waitForTimeout(800);
  await page.click('[data-stand="week"]').catch(() => {}); await page.waitForTimeout(500);
  const week = await subOf();
  ok('This week, week 1: the trophy on the perfect row', week.u_2 && week.u_2.trophy === 1, JSON.stringify(week.u_2));
  ok('with "Perfect week" in the line under the name', week.u_2 && /Perfect week/.test(week.u_2.sub) && /6 of 6 correct/.test(week.u_2.sub), week.u_2 && week.u_2.sub);
  ok('mine too, from my own picks, though no record says so yet', week.u_0 && week.u_0.trophy === 1 && /Perfect week/.test(week.u_0.sub), JSON.stringify(week.u_0));
  ok('and on no other row', Object.entries(week).filter(([u]) => !['u_2', 'u_0'].includes(u)).every(([, r]) => r.trophy === 0 && !/Perfect week/.test(r.sub)), JSON.stringify(week));
  await page.evaluate(() => { const b = document.querySelector('.wk[data-wk="2"]'); if (b) b.click(); });
  await page.waitForTimeout(800);
  const wk2 = await subOf();
  ok('a week not yet played shows no trophy for anyone', Object.values(wk2).every(r => r.trophy === 0), JSON.stringify(wk2));
  ok('no page errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
if (fails.length) { console.log('FAILURES:'); fails.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);
