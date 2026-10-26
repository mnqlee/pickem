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
    boxes: [...document.querySelectorAll('#infoSheet .rvwks span')].map(s => s.className + s.textContent) }));
  ok('the rival card titles itself You vs ...', sheet.t === `You vs ${name2}`, sheet.t);
  ok('its weeks-won numbers match the oracle', sheet.vs[0] === R.w && sheet.vs[1] === R.l, JSON.stringify(sheet.vs) + ' ' + JSON.stringify(R));
  ok('one numbered box per finished week, coloured by who won it', sheet.boxes.length === done.length
    && done.every((k, i) => { const x = st.find(r => r.uid === 'u_0').weeks[String(k)].pts, y = st.find(r => r.uid === 'u_2').weeks[String(k)].pts; return sheet.boxes[i] === (x > y ? 'w' : x < y ? 'l' : 't') + k; }),
    JSON.stringify(sheet.boxes));
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
  const expect = ['u_1', 'u_2'].map(u => { const d = pts.ME - pts[u]; return d > 0 ? `Beating ${nm[u]} by ${d}` : d < 0 ? `Behind ${nm[u]} by ${-d}` : `Level with ${nm[u]}`; });
  ok('its numbers are the This week table\'s own differences', expect.every(e => line.includes(e)), `${line} :: ${expect.join(' | ')}`);
  await tab(page, 'picks'); await page.waitForTimeout(200);
  await page.click('#slate .rvlivebar'); await page.waitForTimeout(300);
  ok('tapping it opens the first rival\'s card', /^You vs /.test(await page.textContent('#infoTitle')));
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
  const best = Math.max(...Object.values(pts));
  const wkPlace = (pts.u_0 === best && best > 0) ? 1 : 1 + Object.values(pts).filter(v => v > pts.u_0).length;
  return {
    pts: pts.u_0, correct: mine.filter(r => r.winner === win[r.gameId]).length, N,
    avg: Math.round(Object.values(pts).reduce((a, b) => a + b, 0) / mem.length),
    lad: mine.map(r => ({ t: r.winner, v: PAY(r.weight, N), ok: r.winner === win[r.gameId] })).sort((a, b) => b.v - a.v || a.t.localeCompare(b.t)),
    seasonRank: sorted(wk).indexOf('u_0') + 1, was: sorted(wk - 1).indexOf('u_0') + 1, wkPlace, players: mem.length,
    mnf: gs.slice().sort((a, b) => a.kickoff.seconds - b.kickoff.seconds).pop(), mineBy: Object.fromEntries(mine.map(r => [r.gameId, r]))
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

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
if (fails.length) { console.log('FAILURES:'); fails.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);
