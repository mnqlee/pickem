/* v1.42.0, THE WEEK 5 POLISH: ACCOUNTING AND LAYOUT.

   THE ACCOUNTING HALF IS AN ORACLE. It reads the RAW data the stub serves
   (the schedule, your picks, everybody's revealed picks, the roster, the
   banked standings) straight from window.PS, and recomputes every number
   in Node from the rules alone: a pick scores when it names the winner of
   a final game; rank r of n pays n+1-r; an unranked pick pays 1; a tie
   pays nothing; the table sorts by points then name. None of the app's
   functions are called. Every figure the new bottom bar, its two sheets,
   the Standings tab, the week strip and the records print is then
   compared against that independent answer, at several points through a
   week, so "the numbers agree" means the APP agrees with the RULES, not
   with itself.

   The layout half measures what Lee picked from the mockups: scores level
   and centred, records on one line, the team box on its words' centre
   line, the arrow tips on the H, every week number on one line. */
import { chromium } from 'playwright';
const BASE = 'http://127.0.0.1:8098';
const browser = await chromium.launch();
let pass = 0, fail = 0; const fails = [];
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n); }
  else { fail++; fails.push(n + (x ? ' -> ' + x : '')); console.log('  FAIL ' + n + (x ? '  -> ' + x : '')); } };

const DAY = 864e5, WEEK = 7 * DAY, H = 3600e3, MIN = 60e3;
const OFF = { thu: 0, sun1: 3*DAY + 61200000, sunLate: 3*DAY + 73800000, mon: 4*DAY + 15000000 };
/* startISO for "now is <offset> into week W". */
const at = (w, off) => new Date(Date.now() - ((w - 1) * WEEK + off)).toISOString();

async function open(plan, vp = { width: 390, height: 844 }) {
  const ctx = await browser.newContext({ viewport: vp });
  const page = await ctx.newPage();
  await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error'
    && !/ERR_FAILED|Failed to load resource|boot failed|stub failure/.test(m.text()))
    errs.push('console: ' + m.text()); });
  await page.request.post(BASE + '/__plan', { data: plan });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1300);
  return { ctx, page, errs };
}

/* ---------------------------------------------------------------- oracle */
async function raw(page, wk) {
  return page.evaluate(async wk => {
    const P = window.PS;
    const weeks = (await P.getAllWeeks()).map(x => ({ wk: x.wk, games: x.games.map(g => ({
      id: g.id, a: g.away, h: g.home, kick: g.kickoff.toMillis(), status: g.status, winner: g.winner })) }));
    const members = await P.getMembers();
    const mine = await P.myPicks(wk);
    const rev = await P.getRevealed(wk);
    const st = await P.getStandings();
    return { weeks, members, mine, rev, st, me: P.user.uid };
  }, wk);
}
function oracle(R, wk) {
  const games = R.weeks.find(x => x.wk === wk).games;
  const n = games.length;
  const pay = w => !w ? 1 : Math.max(0, Math.min(n, n + 1 - w));
  const pickOf = (uid, gid) => uid === R.me ? R.mine[gid]
    : (R.rev.find(r => r.uid === uid && r.gameId === gid) || null);
  const fin = games.filter(g => g.status === 'final');
  const ptsOf = (uid, ex) => fin.reduce((s, g) => {
    if (g.id === ex) return s;
    const p = pickOf(uid, g.id);
    return s + (p && g.winner && p.winner === g.winner ? pay(p.weight) : 0);
  }, 0);
  const name = uid => (R.members.find(m => m.uid === uid) || {}).name || uid;
  const table = ex => R.members.map(m => ({ uid: m.uid, name: m.name, pts: ptsOf(m.uid, ex) }))
    .sort((a, b) => (b.pts - a.pts) || String(a.name).localeCompare(String(b.name)));
  const now = table(null), place = now.findIndex(r => r.uid === R.me) + 1;
  let move = 0;
  if (fin.length >= 2) {
    const last = [...fin].sort((a, b) => b.kick - a.kick)[0];
    move = (table(last.id).findIndex(r => r.uid === R.me) + 1) - place;
  }
  /* Records: every final up to and including this week. */
  const rec = {};
  for (const x of R.weeks) for (const g of x.games) {
    rec[g.a] ||= { w: 0, l: 0, t: 0 }; rec[g.h] ||= { w: 0, l: 0, t: 0 };
    if (x.wk > wk || g.status !== 'final') continue;
    if (g.winner === g.a) { rec[g.a].w++; rec[g.h].l++; }
    else if (g.winner === g.h) { rec[g.h].w++; rec[g.a].l++; }
    else { rec[g.a].t++; rec[g.h].t++; }
  }
  const recStr = c => { const r = rec[c]; return r.t ? `${r.w}-${r.l}-${r.t}` : `${r.w}-${r.l}`; };
  return { n, pay, games, fin, now, place, move, players: R.members.length, me: R.me,
           myPts: ptsOf(R.me, null), pickOf, recStr, name };
}
const ord = n => { const v = n % 100; return n + ((v >= 11 && v <= 13) ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] || 'th')); };

async function readBar(page) {
  return page.evaluate(() => {
    const bar = document.querySelector('#bar');
    const c = [...document.querySelectorAll('#c3row .cellbtn')].map(b => ({
      small: [...b.querySelectorAll(':scope > small')].map(s => s.textContent.trim()),
      /* The place cell holds the arrow inside the same box; read the text
         node only, which is what the eye reads as the place. */
      big: b.querySelector('.c3n') ? b.querySelector('.c3n').firstChild.textContent
         : b.querySelector('b').textContent }));
    const mv = document.querySelector('#c3row .mv5');
    return { c3: bar.classList.contains('c3'), cells: c,
      move: mv ? (mv.classList.contains('up') ? 1 : -1) * +mv.querySelector('.d').textContent : 0,
      submitShown: getComputedStyle(document.querySelector('#submitBtn')).display !== 'none' };
  });
}

/* ================================================================ 1-4 */
console.log('\n1. The week-so-far bar agrees with the rules, through a whole week');
const seen = { up: 0, down: 0, still: 0, tie: 0, loss: 0, win: 0, unstaked: 0, asks: 0 };
const SCEN = [
  { k: 'Thursday night final', off: OFF.thu + 4 * H },
  { k: 'Sunday, early games final, late games live', off: OFF.sun1 + 200 * MIN + 30 * MIN },
  { k: 'Monday morning, only Monday night left', off: OFF.sunLate + 230 * MIN },
];
for (const plan of [{ promo: true, playerCount: 12, W: 6 }, { playerCount: 9, W: 6 },
                    { promo: true, playerCount: 31, unstaked: 2, W: 6 },
                    { promo: true, playerCount: 20, W: 8 }, { promo: true, playerCount: 15, W: 3 }]) {
  for (const sc of SCEN) {
    const W = plan.W;
    const { ctx, page, errs } = await open({ ...plan, startISO: at(W, sc.off) });
    const tag = `[w${W} ${plan.playerCount}p${plan.promo ? ' promo' : ''}${plan.unstaked ? ' unstaked' : ''}, ${sc.k}]`;
    const wkOn = await page.evaluate(() => +document.querySelector('.wk.on').dataset.wk);
    const R = await raw(page, wkOn);
    const O = oracle(R, wkOn);
    const b = await readBar(page);
    /* An open pick with no rank still needs doing, so the bar must keep
       asking rather than show the week so far. */
    const needs = O.games.some(g => g.kick > Date.now() && (!R.mine[g.id] || !R.mine[g.id].weight));
    if (needs) {
      ok(`${tag} an open pick has no rank, so the bar keeps asking`, !b.c3 && b.submitShown, JSON.stringify(b));
      seen.asks++;
      await ctx.close(); continue;
    }
    ok(`${tag} the bar has switched to the week so far`, b.c3 && !b.submitShown, JSON.stringify(b));
    ok(`${tag} week points match the rules`, b.cells[0] && +b.cells[0].big === O.myPts,
       `bar ${b.cells[0] && b.cells[0].big} oracle ${O.myPts}`);
    ok(`${tag} the place matches the rules`, b.cells[1] && b.cells[1].big.trim().toLowerCase() === ord(O.place).toLowerCase(),
       `bar ${b.cells[1] && b.cells[1].big} oracle ${ord(O.place)}`);
    ok(`${tag} "of N" is everybody in the pool`, b.cells[1] && b.cells[1].small[1] === `of ${O.players}`,
       JSON.stringify(b.cells[1] && b.cells[1].small));
    ok(`${tag} the arrow is the move since the latest final`, b.move === O.move, `bar ${b.move} oracle ${O.move}`);
    if (O.move > 0) seen.up++; else if (O.move < 0) seen.down++; else seen.still++;
    ok(`${tag} the games count is finals over games`,
       b.cells[2] && b.cells[2].big === `${O.fin.length}/${O.n}`, `${b.cells[2] && b.cells[2].big} vs ${O.fin.length}/${O.n}`);

    /* ---- the points sheet: one line per final, and they add up ---- */
    await page.click('[data-c3="pts"]'); await page.waitForTimeout(450);
    const ps = await page.evaluate(() => ({
      open: !document.querySelector('#infoSheet').hidden,
      big: parseInt(document.querySelector('#infoSheet .big').textContent, 10),
      lines: [...document.querySelectorAll('#infoSheet .sl:not(.dim)')].map(l => ({
        txt: l.querySelector('span').textContent.replace(/\s+/g, ' ').trim(),
        pts: l.querySelector('b').textContent.trim(),
        mark: (l.querySelector('.pk') || { className: '' }).className })) }));
    ok(`${tag} the points sheet opens`, ps.open);
    ok(`${tag} its total is the same week total`, ps.big === O.myPts, `${ps.big} vs ${O.myPts}`);
    ok(`${tag} it lists every final game once`, ps.lines.length === O.fin.length, `${ps.lines.length} vs ${O.fin.length}`);
    let sum = 0, rowsOk = true, why = '';
    [...O.fin].sort((a, b) => a.kick - b.kick).forEach((g, i) => {
      const L = ps.lines[i] || {}, p = O.pickOf(O.me, g.id);
      const won = p && g.winner && p.winner === g.winner;
      const want = !p ? 0 : won ? O.pay(p.weight) : 0;
      const got = /no score/.test(L.pts || '') ? 0 : parseInt(L.pts, 10);
      sum += got || 0;
      const mk = !p ? '' : !g.winner ? 'pk-tie' : won ? 'pk-ok' : 'pk-x';
      if (p && won) seen.win++; if (p && g.winner && !won) seen.loss++; if (p && !p.weight && g.winner) seen.unstaked++;
      if (got !== want || (mk && !(L.mark || '').includes(mk)) || (p && !(L.txt || '').startsWith(p.winner))) {
        rowsOk = false; why ||= JSON.stringify({ g: g.id, want, L, mk }); }
    });
    ok(`${tag} every line pays what the rules say, tick on a win and cross on a loss`, rowsOk, why);
    ok(`${tag} and the lines add up to the total`, sum === O.myPts, `${sum} vs ${O.myPts}`);
    await page.click('#infoDone'); await page.waitForTimeout(350);

    /* ---- the games sheet ---- */
    await page.click('[data-c3="games"]'); await page.waitForTimeout(450);
    const gs = await page.evaluate(() => ({
      cnt: document.querySelector('#infoSheet .cnt').textContent.replace(/\s+/g, ' ').trim(),
      next: [...document.querySelectorAll('#infoSheet .sl.next span')].map(s => s.textContent.trim()),
      holds: [...document.querySelectorAll('#infoSheet .sl.dim b')].map(s => s.textContent.trim()) }));
    const left = O.games.filter(g => g.status !== 'final').sort((a, b) => a.kick - b.kick);
    ok(`${tag} the games sheet counts the finals`, gs.cnt === `${O.fin.length} of ${O.n} final`, gs.cnt);
    ok(`${tag} and lists exactly the games still to play, in kickoff order`,
       JSON.stringify(gs.next) === JSON.stringify(left.map(g => `${g.a} @ ${g.h}`)), JSON.stringify(gs.next.slice(0, 3)));
    ok(`${tag} with what each of your picks pays if it holds`,
       left.every((g, i) => { const p = O.pickOf(O.me, g.id);
         return !p || !p.weight ? true : gs.holds[i] === `${O.pay(p.weight)} ${O.pay(p.weight) === 1 ? 'pt' : 'pts'} if it holds`; }),
       JSON.stringify(gs.holds.slice(0, 3)));
    await page.click('#infoDone'); await page.waitForTimeout(350);

    /* ---- tapping the place opens Standings on This week, and it agrees ---- */
    await page.click('[data-c3="stand"]'); await page.waitForTimeout(700);
    const st = await page.evaluate(() => ({
      tab: document.querySelector('.tab.on').dataset.tab,
      view: (document.querySelector('#standTabs .subtab.on') || {}).dataset?.stand,
      meRank: (document.querySelector('#meBar .rank') || {}).textContent,
      meSub: (document.querySelector('#meBar .who span') || {}).textContent,
      mePts: (document.querySelector('#meBar .pts b') || {}).textContent,
      rows: [...document.querySelectorAll('#board .row')].map(r => ({
        name: r.querySelector('.who b').textContent.trim(), pts: +r.querySelector('.pts b').textContent })) }));
    ok(`${tag} the place opens Standings`, st.tab === 'standings', st.tab);
    ok(`${tag} on the This week table`, st.view === 'week', String(st.view));
    ok(`${tag} where your pinned place is the bar's place`, st.meRank && parseInt(st.meRank, 10) === O.place,
       `${st.meRank} vs ${O.place}`);
    ok(`${tag} written the same way, "${ord(O.place)} of ${O.players}"`,
       (st.meSub || '').includes(`${ord(O.place)} of ${O.players}`), st.meSub);
    ok(`${tag} and every row's points are the rules' points`,
       st.rows.length === O.players && st.rows.every((r, i) => r.pts === O.now[i].pts && r.name === O.now[i].name),
       JSON.stringify(st.rows.map((r, i) => [r.name, r.pts, O.now[i].name, O.now[i].pts]).filter(x => x[1] !== x[3] || x[0] !== x[2]).slice(0, 3)));
    /* A tie is called a tie. */
    const mi = O.now.findIndex(r => r.uid === O.me);
    if (mi > 0 && O.now[mi - 1].pts === O.now[mi].pts) seen.tie++;
    if (mi > 0 && O.now[mi - 1].pts === O.now[mi].pts)
      ok(`${tag} a level score reads "tied with"`, /tied with/.test(st.meSub) && !/level with/.test(st.meSub), st.meSub);
    ok(`${tag} no page errors`, errs.length === 0, errs[0]);
    await ctx.close();
  }
}

/* AN ORACLE THAT NEVER SEES A CASE CANNOT GRADE IT. These say the
   fixtures above actually produced each situation the bar has to get
   right, so none of the comparisons passed by having nothing to compare. */
ok('the fixtures moved you UP at least once', seen.up > 0, JSON.stringify(seen));
ok('and DOWN at least once', seen.down > 0, JSON.stringify(seen));
ok('and held you level at least once', seen.still > 0, JSON.stringify(seen));
ok('the sheets graded wins and losses', seen.win > 0 && seen.loss > 0, JSON.stringify(seen));
ok('and an unstaked pick that was decided', seen.unstaked > 0, JSON.stringify(seen));
ok('and the bar kept asking while a rank was missing', seen.asks > 0, JSON.stringify(seen));

/* ================================================================ 5 */
console.log('\n2. The bar stays the bar until there is nothing left to do');
{
  /* A final is in, but you have not picked the rest: the week-so-far must
     not hide "Finish my picks". */
  const { ctx, page, errs } = await open({ startISO: at(6, OFF.thu + 4 * H), myPickCount: 5 });
  const b = await readBar(page);
  ok('with games still to pick, the bar keeps its button', !b.c3 && b.submitShown, JSON.stringify(b));
  ok('and the button says what it will do',
     /finish my picks/i.test(await page.textContent('#submitBtn')), await page.textContent('#submitBtn'));
  ok('no page errors', errs.length === 0, errs[0]);
  await ctx.close();
}
{
  /* Nothing final yet this week. */
  const { ctx, page } = await open({ startISO: at(6, -2 * DAY) });
  const b = await readBar(page);
  ok('before the first final of the week, the bar is unchanged', !b.c3 && b.submitShown, JSON.stringify(b));
  await ctx.close();
}

/* ================================================================ 6 */
console.log('\n3. Finished weeks in the strip show your points, from the same source as Standings');
{
  const { ctx, page, errs } = await open({ promo: true, playerCount: 12, startISO: at(6, OFF.sun1 + 260 * MIN) });
  const strip = await page.evaluate(() => [...document.querySelectorAll('#weeks .wk')].map(w => ({
    wk: +w.dataset.wk, y: w.classList.contains('y'), pts: (w.querySelector('.yp') || {}).textContent ?? null,
    on: w.classList.contains('on'), size: parseFloat(getComputedStyle(w.querySelector('b')).fontSize),
    bTop: w.querySelector('b').getBoundingClientRect().top, bBot: w.querySelector('b').getBoundingClientRect().bottom,
    tw: w.getBoundingClientRect().width, th: w.getBoundingClientRect().height })));
  const R = await raw(page, 6);
  const meRow = R.st.find(r => r.uid === R.me);
  const doneWks = R.weeks.filter(x => x.games.every(g => g.status === 'final')).map(x => x.wk);
  ok('weeks 1 to 5 are finished and faded, week 6 and on are not',
     strip.every(t => t.y === doneWks.includes(t.wk)), JSON.stringify(strip.map(t => [t.wk, t.y])));
  ok('each finished week shows the banked points Standings uses',
     strip.filter(t => t.y).every(t => +t.pts === meRow.weeks[String(t.wk)].pts),
     JSON.stringify(strip.filter(t => t.y).map(t => [t.wk, t.pts, meRow.weeks[String(t.wk)].pts])));
  /* And the Season table must hold the same figures week by week. */
  await page.click('.tab[data-tab="standings"]'); await page.waitForTimeout(400);
  await page.click('#standTabs .subtab[data-stand="season"]').catch(() => {}); await page.waitForTimeout(400);
  const seasonMe = await page.evaluate(() => +(document.querySelector('#meBar .pts b') || {}).textContent);
  const live6 = oracle(R, 6).myPts;
  const want = doneWks.reduce((s, w) => s + meRow.weeks[String(w)].pts, 0) + live6;
  ok('and the season total is those weeks plus this week\'s live points', seasonMe === want, `${seasonMe} vs ${want}`);
  ok('one to nine at 19.4px, ten and up at 18.5px',
     strip.every(t => t.size === (t.wk >= 10 ? 18.5 : 19.4)), JSON.stringify(strip.map(t => [t.wk, t.size])));
  ok('every tile is still 46 by 44, so the header keeps its height',
     strip.every(t => Math.round(t.tw) === 46 && Math.round(t.th) === 44), JSON.stringify(strip.slice(0, 3)));
  const mids = strip.map(t => +((t.bTop + t.bBot) / 2).toFixed(1));
  ok('every week number sits on one line, faded or not',
     Math.max(...mids) - Math.min(...mids) <= 0.6, JSON.stringify(mids));
  ok('no page errors', errs.length === 0, errs[0]);
  await ctx.close();
}

/* ================================================================ 7 */
console.log('\n4. Records under the badges are counted from the results');
/* The last entry looks BACK at week 3 from week 9: the records on a past
   week must be as they stood then, not as they stand now. Without it, no
   fixture had a final in a later week, so "through this week" was never
   tested against "through every week". */
for (const [W, back] of [[1], [4], [9], [9, 3]]) {
  const { ctx, page, errs } = await open({ startISO: at(W, OFF.sunLate + 230 * MIN) });
  if (back) { await page.click(`.wk[data-wk="${back}"]`); await page.waitForTimeout(900); }
  const wkOn = await page.evaluate(() => +document.querySelector('.wk.on').dataset.wk);
  if (back) ok('looking back: the week on screen is the past week', wkOn === back, String(wkOn));
  const R = await raw(page, wkOn); const O = oracle(R, wkOn);
  const cards = await page.evaluate(() => [...document.querySelectorAll('#slate .card')].map(c => {
    const s = [...c.querySelectorAll('.side')];
    return s.map(sd => ({ code: sd.querySelector('.mark span').textContent.trim(),
      rec: (sd.querySelector('.trec') || {}).textContent || null,
      top: sd.querySelector('.trec') ? sd.querySelector('.trec').getBoundingClientRect().top : null }));
  }));
  const bad = cards.flat().filter(s => s.rec !== `(${O.recStr(s.code)})`);
  ok(`week ${wkOn}: every record is the club's results through this week`, cards.length > 0 && bad.length === 0,
     JSON.stringify(bad.slice(0, 3).map(s => [s.code, s.rec, O.recStr(s.code)])));
  ok(`week ${wkOn}: and the two records on a card sit on one line`,
     cards.every(c => Math.abs(c[0].top - c[1].top) <= 0.5), JSON.stringify(cards.slice(0, 2)));
  ok('no page errors', errs.length === 0, errs[0]);
  await ctx.close();
}

/* ================================================================ 8 */
console.log('\n5. The card, measured');
{
  const { ctx, page, errs } = await open({ startISO: at(6, OFF.sun1 + 60 * MIN), espnDetail: '12:53 - 1st', espnBall: 'alt' });
  await page.waitForTimeout(1500);
  const m = await page.evaluate(() => {
    const ctr = r => (r.top + r.bottom) / 2, mid = r => (r.left + r.right) / 2;
    const out = { level: [], centred: [], box: [], circle: [], bands: [] };
    for (const c of document.querySelectorAll('#slate .card')) {
      const sc = [...c.querySelectorAll('.scrn')];
      if (sc.length === 2) {
        out.level.push(+(sc[0].getBoundingClientRect().top - sc[1].getBoundingClientRect().top).toFixed(2));
        for (const s of sc) { const n = s.closest('.side').querySelector('.names').getBoundingClientRect();
          out.centred.push(+(mid(s.getBoundingClientRect()) - mid(n)).toFixed(2)); }
      }
      for (const pk of c.querySelectorAll('.pk')) {
        const tx = pk.nextElementSibling; if (!tx) continue;
        out.box.push(+(ctr(pk.getBoundingClientRect()) - ctr(tx.getBoundingClientRect())).toFixed(2));
      }
      const g = c.querySelector('.gutter'), rk = g.querySelector('.rkc');
      const state = c.querySelector('.meta.fmeta') ? 'final' : c.querySelector('.lockband') ? 'live' : 'pre';
      out.circle.push({ state, has: !!rk, at: g.textContent.trim() === '@',
        cls: rk ? rk.className : '', color: rk ? getComputedStyle(rk).color : null,
        bg: rk ? getComputedStyle(rk).backgroundColor : null, tap: !!(rk && rk.closest('[data-stake]')) });
      const band = c.querySelector('.lockband');
      if (band) { const sp = [...band.children];
        out.bands.push({ h: band.getBoundingClientRect().height, txt: band.textContent.trim(),
          right: +(band.getBoundingClientRect().right - sp[sp.length - 1].getBoundingClientRect().right).toFixed(1),
          wraps: band.scrollWidth > band.clientWidth + 1 }); }
    }
    return out;
  });
  ok('both scores on every card start at the same height', m.level.length > 0 && m.level.every(d => Math.abs(d) <= 0.5), JSON.stringify(m.level));
  ok('and each is centred under its own team name', m.centred.every(d => Math.abs(d) <= 1), JSON.stringify(m.centred));
  ok('the team box sits on its words\' centre line', m.box.length > 0 && m.box.every(d => Math.abs(d) <= 0.6), JSON.stringify(m.box));
  const pre = m.circle.filter(x => x.state === 'pre' && x.has), live = m.circle.filter(x => x.state === 'live' && x.has),
        fin = m.circle.filter(x => x.state === 'final' && x.has);
  ok('the fixture has ranked picks before kickoff, live and final', pre.length && live.length && fin.length,
     JSON.stringify([pre.length, live.length, fin.length]));
  ok('the rank circle is red before kickoff and while live', [...pre, ...live].every(x => x.color === 'rgb(200, 52, 42)'),
     JSON.stringify([...pre, ...live].map(x => x.color).slice(0, 3)));
  ok('and grey once final', fin.every(x => x.color !== 'rgb(200, 52, 42)' && /\bfin\b/.test(x.cls)), JSON.stringify(fin.slice(0, 2)));
  ok('cream inside, the colour of the strip it sits on, not white',
     m.circle.filter(x => x.has).every(x => x.bg === 'rgb(237, 232, 222)'), JSON.stringify(m.circle.filter(x => x.has).map(x => x.bg).slice(0, 2)));
  ok('tappable before kickoff only', pre.every(x => x.tap) && [...live, ...fin].every(x => !x.tap));
  ok('the live strip is one line', m.bands.length > 0 && m.bands.every(b => b.h === 22 && !b.wraps), JSON.stringify(m.bands.slice(0, 2)));
  ok('"Locked" on the left, your pick against the right edge',
     m.bands.every(b => /^Locked/.test(b.txt) && Math.abs(b.right - 11) <= 0.6), JSON.stringify(m.bands.slice(0, 2)));
  ok('and "In progress · locked" is gone', m.bands.every(b => !/in progress/i.test(b.txt)));
  ok('no page errors', errs.length === 0, errs[0]);
  await ctx.close();
}

/* ================================================================ 9 */
console.log('\n6. Ranking a pick: the @ stays until there is a rank, then the circle takes its place');
{
  const { ctx, page, errs } = await open({ startISO: at(1, -3 * DAY), weeks: 2, noPicks: true });
  await page.evaluate(() => { const o = window.PS.savePicks; window.__saved = [];
    window.PS.savePicks = async (...a) => { window.__saved.push(JSON.parse(JSON.stringify(a[1] || null))); return o.apply(window.PS, a); }; });
  const id = await page.evaluate(() => document.querySelectorAll('#slate .card')[1].dataset.game);
  const C = `.card[data-game="${id}"]`;
  ok('an unpicked card shows the @', (await page.textContent(`${C} .gutter`)).trim() === '@');
  await page.click(`${C} .side.r`); await page.waitForTimeout(400);
  const s1 = await page.evaluate(C => ({ gut: document.querySelector(C + ' .gutter').textContent.trim(),
    bar: document.querySelector(C + ' .stakebar').textContent.replace(/\s+/g, ' ').trim(),
    blank: !!document.querySelector(C + ' .stakebar .sb-num.blank') }), C);
  ok('picked but not ranked: the @ stays in the middle', s1.gut === '@', s1.gut);
  ok('and the bar asks, with the dashed circle on the right', /Tap to stake points/.test(s1.bar) && s1.blank, JSON.stringify(s1));
  await page.click(`${C} .stakebar`); await page.waitForTimeout(450);
  await page.click('#numgrid .num:not([disabled]) >> nth=2'); await page.waitForTimeout(80);
  const anim = await page.evaluate(C => { const r = document.querySelector(C + ' .gutter .rkc');
    return r ? r.getAnimations().length : -1; }, C);
  await page.waitForTimeout(600);
  const s2 = await page.evaluate(C => ({ rk: (document.querySelector(C + ' .gutter .rkc') || {}).textContent,
    bar: document.querySelector(C + ' .stakebar').textContent.replace(/\s+/g, ' ').trim(),
    circleInBar: !!document.querySelector(C + ' .stakebar .sb-num'),
    team: document.querySelector(C + ' .side.won .mark span').textContent }), C);
  ok('ranked: the circle with the rank replaces the @', /^\d+$/.test(s2.rk || ''), JSON.stringify(s2));
  ok('and it arrives moving (the slide from the bar)', anim > 0, String(anim));
  ok('the bar now shows the team box, the team and the points, and no circle',
     !s2.circleInBar && new RegExp(`^${s2.team} · change until kickoff \\d+ pts?$`).test(s2.bar), s2.bar);
  const saved = await page.evaluate(id => { const s = window.__saved; const last = s[s.length - 1];
    return last ? JSON.stringify(last[id] || last) : null; }, id);
  ok('and the rank was saved with the pick', saved && saved.includes(`"weight":${s2.rk}`), saved);
  /* The circle is itself a button before kickoff. */
  await page.click(`${C} .gutter [data-stake]`); await page.waitForTimeout(450);
  ok('tapping the circle opens the rank picker again', await page.evaluate(() => !document.querySelector('#sheet').hidden));
  ok('no page errors', errs.length === 0, errs[0]);
  await ctx.close();
}

/* ================================================================ 10 */
console.log('\n7. The middle box and the arrow tips');
{
  const { ctx, page, errs } = await open({ promo: true, playerCount: 12, startISO: at(6, OFF.sun1 + 260 * MIN) });
  const r = await page.evaluate(() => {
    const cell = document.querySelector('#c3row [data-c3="stand"]');
    const cx = e => { const r = e.getBoundingClientRect(); return (r.left + r.right) / 2; };
    const sm = cell.querySelectorAll(':scope > small'), num = cell.querySelector('.c3n');
    /* The text alone, without the arrow hanging off it. */
    const rg = document.createRange(); rg.selectNodeContents(num.firstChild);
    const tr = rg.getBoundingClientRect();
    const out = { cur: cx(sm[0]), of: cx(sm[1]), ten: (tr.left + tr.right) / 2, tips: {} };
    for (const d of ['up', 'dn']) {
      const i = document.createElement('i'); i.className = 'mv5 ' + d;
      i.innerHTML = (d === 'up' ? '<svg viewBox="0 0 8 7"><path d="M4 0L8 7H0z"/></svg>' : '<svg viewBox="0 0 8 7"><path d="M0 0H8L4 7z"/></svg>') + '<span class="d">2</span>';
      const old = num.querySelector('.mv5'); if (old) old.remove();
      num.appendChild(i);
      const n = num.getBoundingClientRect(), s = i.querySelector('svg').getBoundingClientRect();
      out.tips[d] = { top: +(s.top - n.top).toFixed(2), bottom: +(n.bottom - s.bottom).toFixed(2),
        ten: +((tr.left + tr.right) / 2).toFixed(2) };
      i.remove();
    }
    out.trim = CSS.supports('text-box', 'trim-both cap alphabetic');
    return out;
  });
  ok('"10th" is centred under "Currently"', Math.abs(r.ten - r.cur) <= 0.6, JSON.stringify(r));
  ok('and "of N" is centred under it', Math.abs(r.of - r.cur) <= 0.6, JSON.stringify(r));
  if (r.trim) {
    ok('the up arrow\'s tip is on the top of the letters', Math.abs(r.tips.up.top) <= 0.5, JSON.stringify(r.tips.up));
    ok('the down arrow\'s tip is on the bottom of the letters', Math.abs(r.tips.dn.bottom) <= 0.5, JSON.stringify(r.tips.dn));
  }
  ok('no page errors', errs.length === 0, errs[0]);
  await ctx.close();
}

/* ================================================================ 11 */
console.log('\n8. No slashed zeros, a solid header, and the copy');
{
  const { ctx, page, errs } = await open({ startISO: at(6, OFF.sun1 + 260 * MIN), promo: true, playerCount: 12 });
  const f = await page.evaluate(() => ({
    link: [...document.querySelectorAll('link[rel=stylesheet]')].some(l => /family=Roboto:[^&]*&text=0/.test(l.href)),
    mono: getComputedStyle(document.querySelector('.mono')).fontFamily,
    anyBareMono: [...document.styleSheets].flatMap(s => { try { return [...s.cssRules]; } catch { return []; } })
      .some(r => r.style && /^\s*"?Roboto Mono"?/.test(r.style.fontFamily || '')),
    top: getComputedStyle(document.querySelector('.topbar')).backgroundImage,
    topBg: getComputedStyle(document.querySelector('.topbar')).backgroundColor,
    bar: getComputedStyle(document.querySelector('#bar')).backgroundColor }));
  ok('the plain-zero font is requested, just the one character', f.link);
  ok('every mono stack starts with it', /^"?Roboto"?,\s*"?Roboto Mono"?/.test(f.mono) && !f.anyBareMono, f.mono);
  ok('the header is solid, not a see-through gradient', f.top === 'none' && f.topBg === 'rgb(20, 20, 18)', f.top + ' ' + f.topBg);
  ok('and so is the bottom bar', f.bar === 'rgb(26, 25, 23)', f.bar);
  const help = await page.evaluate(() => document.querySelector('#v-help .hp-steps').textContent);
  ok('Help says what the coloured box means', /coloured box beside a team is your pick/i.test(help));
  ok('no page errors', errs.length === 0, errs[0]);
  await ctx.close();
}

/* ================================================================ 12 */
console.log('\n9. Narrow phone');
{
  const { ctx, page, errs } = await open({ startISO: at(6, OFF.sun1 + 60 * MIN), espnDetail: '12:53 - 1st', promo: true, playerCount: 31 },
    { width: 320, height: 640 });
  await page.waitForTimeout(800);
  const n = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    bandsWrap: [...document.querySelectorAll('.lockband')].filter(b => b.scrollWidth > b.clientWidth + 1).length,
    cells: [...document.querySelectorAll('#c3row .cellbtn')].map(c => c.scrollWidth > c.clientWidth + 1),
    ends: [...document.querySelectorAll('.lockband .mine')].every(m => m.getBoundingClientRect().right <= m.closest('.lockband').getBoundingClientRect().right) }));
  ok('nothing slides sideways at 320px', n.sw <= 320, String(n.sw));
  ok('the live strip never wraps or spills', n.bandsWrap === 0 && n.ends, JSON.stringify(n));
  ok('the three boxes fit', n.cells.every(x => !x), JSON.stringify(n.cells));
  ok('no page errors', errs.length === 0, errs[0]);
  await ctx.close();
}

/* ================================================================ 13 */
console.log('\n10. Season seals carry every week that has been won');
/* Counted from the weeks, so a week the server has not "closed" still
   carries its seal. The oracle judges each finished week from the raw
   figures: the server's banked points for a week that is not on screen,
   and the live points from the raw picks for the one that is. */
/* The third run banks the same points for everyone, so every finished
   week is a tie at the top: a shared week must give EVERY tied player
   the seal, which is score_week.py's rule ("ties share a place"). */
for (const [look, recPts] of [[null], [6], [null, 70]]) {
  const { ctx, page, errs } = await open({ promo: true, playerCount: 14, recHits: 0,
    ...(recPts ? { recPts } : {}), startISO: at(9, OFF.sun1 + 60 * MIN) });
  if (look) { await page.click(`.wk[data-wk="${look}"]`); await page.waitForTimeout(900); }
  const wkOn = await page.evaluate(() => +document.querySelector('.wk.on').dataset.wk);
  const R = await raw(page, wkOn);
  const settled = R.weeks.filter(x => x.games.length && x.games.every(g => g.status === 'final')).map(x => x.wk);
  const live = settled.includes(wkOn) ? oracle(R, wkOn) : null;
  const ptsFor = (uid, w) => w === wkOn && live
    ? live.now.find(r => r.uid === uid).pts
    : (((R.st.find(r => r.uid === uid) || {}).weeks || {})[String(w)] || {}).pts || 0;
  const want = {};
  R.members.forEach(m => want[m.name] = { first: 0, second: 0 });
  for (const w of settled) {
    const rows = R.members.map(m => ({ name: m.name, pts: ptsFor(m.uid, w) }));
    const best = Math.max(0, ...rows.map(r => r.pts)); if (!(best > 0)) continue;
    rows.filter(r => r.pts === best).forEach(r => want[r.name].first++);
    const lower = rows.filter(r => r.pts < best).map(r => r.pts), sp = lower.length ? Math.max(...lower) : 0;
    if (sp > 0) rows.filter(r => r.pts === sp).forEach(r => want[r.name].second++);
  }
  await page.click('.tab[data-tab="standings"]'); await page.waitForTimeout(400);
  await page.click('#standTabs .subtab[data-stand="season"]'); await page.waitForTimeout(500);
  const got = await page.evaluate(() => [...document.querySelectorAll('#board .row')].map(r => {
    const sub = r.querySelector('.who span').textContent;
    return { name: r.querySelector('.who b').textContent.trim(),
      first: +((sub.match(/(\d+) first/) || [])[1] || 0), second: +((sub.match(/(\d+) second/) || [])[1] || 0) };
  }));
  const bad = got.filter(g => !want[g.name] || want[g.name].first !== g.first || want[g.name].second !== g.second);
  const tag = look ? `looking at finished week ${look}` : recPts ? `every week tied, week ${wkOn}` : `mid week ${wkOn}`;
  ok(`[${tag}] every player's 1st and 2nd seals equal the weeks they won and came second`,
     got.length === R.members.length && bad.length === 0,
     JSON.stringify(bad.slice(0, 3).map(g => [g.name, g.first, g.second, want[g.name]])));
  /* ONE SEAL PER WEEK, in order, and it never spills. */
  const seals = await page.evaluate(() => [...document.querySelectorAll('#board .row')].map(r => {
    const svg = r.querySelector('svg.seals');
    const sub = r.querySelector('.who span').textContent;
    const parts = svg ? [...svg.querySelectorAll('g.sl-1st,g.sl-2nd,g.sl-trophy')].map(g => ({
      k: g.getAttribute('class').replace('sl-', ''),
      x: +(/translate\(([\d.]+)/.exec(g.getAttribute('transform')) || [])[1] })).sort((a, b) => a.x - b.x) : [];
    const more = svg && svg.querySelector('.sl-more') ? +svg.querySelector('.sl-more').textContent.slice(1) : 0;
    return { name: r.querySelector('.who b').textContent.trim(), parts, more,
      first: +((sub.match(/(\d+) first/) || [])[1] || 0), second: +((sub.match(/(\d+) second/) || [])[1] || 0),
      spill: r.scrollWidth > r.clientWidth + 1 || (svg && svg.getBoundingClientRect().right > r.querySelector('.pts').getBoundingClientRect().left) };
  }));
  const sealBad = seals.filter(r => {
    /* Perfect weeks come from the server's count (the stub gives one to
       roster member 1); the trophy goes LAST, after every 2ND. */
    const perfect = (R.st.find(x => x.name === r.name) || {}).perfectWeeks || 0;
    const total = r.first + r.second + perfect;
    const shown = total > 6 ? 5 : total;
    const want = [...Array(r.first).fill('1st'), ...Array(r.second).fill('2nd'), ...Array(perfect).fill('trophy')].slice(0, shown);
    const steps = r.parts.slice(1).map((p, i) => +(p.x - r.parts[i].x).toFixed(1));
    const step = shown > 3 ? 17 : 25;
    return JSON.stringify(r.parts.map(p => p.k)) !== JSON.stringify(want)
      || r.more !== (total > 6 ? total - 5 : 0)
      || steps.some(d => Math.abs(d - step) > 0.01);
  });
  ok(`[${tag}] one seal per week: every 1ST, then every 2ND, side by side up to 3, tucked from 4, five and "+N" past 6`,
     seals.length > 0 && sealBad.length === 0, JSON.stringify(sealBad.slice(0, 2)));
  ok(`[${tag}] no row of seals spills into the points`, seals.every(r => !r.spill), JSON.stringify(seals.filter(r => r.spill).slice(0, 2)));
  if (recPts) ok(`[${tag}] the fixture reaches the "+N" case`, seals.some(r => r.more > 0), JSON.stringify(seals.map(r => r.more)));
  const total1 = got.reduce((a, g) => a + g.first, 0);
  ok(`[${tag}] at least one 1st seal per finished week`, total1 >= settled.length, `${total1} for ${settled.length} weeks`);
  ok(`[${tag}] and it ignores the server's own counter`,
     got.some(g => g.first !== ((R.st.find(r => r.name === g.name) || {}).weekWins || 0)),
     'the stub counter (2,1,0...) and the weeks agree everywhere, so this case proves nothing');
  ok('no page errors', errs.length === 0, errs[0]);
  await ctx.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILURES:'); fails.forEach(f => console.log('  - ' + f)); process.exit(1); }
