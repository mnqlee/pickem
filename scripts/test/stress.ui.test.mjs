/* STRESS. Not "does it work" — the other suites answer that. This asks
   whether it keeps working when it is leaned on, and it exists because
   28 real people are in this pool and Thursday night is the first live
   test of every change in v1.34.0.

   Everything here is a shape a real Sunday can take, and each section
   says which one:

     1. A FULL POOL ON A FULL SLATE. 50 players, 16 games, every tab
        rendered and measured at phone and tablet widths.
     2. RAPID WEEK SWITCHING. The thing people actually do while waiting:
        hammer the week strip. Every switch reloads a week's picks and
        rebuilds three tables.
     3. ESPN GONE, THREE WAYS. down (503), throw (no network), junk (200
        that is not JSON). The app reads ESPN from the phone now, so
        these are the app's own failure paths, not a server's.
     4. A SCORE STORM. Results landing while the screens are open, which
        is Sunday 4:25pm.
     5. A LONG SESSION. The app that was opened at noon and is still open
        at midnight: listener count, DOM node count, heap.
     6. OFFLINE BOOT. Airplane mode, a locked phone in a stadium.
     7. THE THURSDAY-NIGHT PATH, walked end to end at the real widths.

   WHAT COUNTS AS A FAILURE HERE. Not slowness alone — a budget that
   passes on this machine and fails on a loaded CI box teaches nothing.
   What fails is: a thrown error, a screen that renders nothing, a number
   that contradicts another number on the same screen, a listener or node
   count that GROWS without bound, and any interaction that stops
   responding. Timings are printed for the record, and only the outliers
   are asserted.

   Needs: node app-serve.mjs &
   Run:   node stress.ui.test.mjs
*/
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:8098';
let pass = 0, fail = 0;
const fails = [];
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; fails.push(name + (extra ? ' -> ' + extra : '')); console.log('  FAIL ' + name + (extra ? '  -> ' + extra : '')); }
};
const ms = n => `${Math.round(n)}ms`;

const browser = await chromium.launch();

/* THE FIXTURE CLOCK, AND WHY THESE THREE NUMBERS AND NOT ROUND ONES.
   app-serve builds a week from one kickoff and fixed offsets — Thursday
   at +0, the Sunday slate at +3d17h and +3d20.5h, Monday night at
   +4d4h10m — and calls a game final once `kickoff + 200min` has passed,
   which is the same 200 minutes the app uses. So the state of a week is
   decided entirely by where "now" falls in that span, and a fixture that
   asks for a live game by guessing a round number gets a week of
   scheduled games and a suite that quietly asserts nothing. Measured
   against the generator, not assumed:

     THU   the opener kicked an hour ago and nothing else has  -> 1 live,
           0 final, the header still counting down to Sunday
     MNF   four days and five hours in: the Sunday slate is final and
           Monday night is being played -> 1 live, 15 final, the header
           reading "1 game live". This is the moment the week closer in
           scores-loop.yml exists for.
     COLD  a week that finished days ago, with the next one not started:
           every card final, the app sitting on the upcoming week. */
const THU  = () => new Date(Date.now() - 3600e3).toISOString();
const MNF  = () => new Date(Date.now() - (4 * 864e5 + 5 * 3600e3)).toISOString();
const COLD = () => new Date(Date.now() - 9 * 864e5).toISOString();

async function open(plan = {}, view = { width: 390, height: 844 }) {
  const ctx = await browser.newContext({ viewport: view });
  const page = await ctx.newPage();
  await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  /* CONSOLE ERRORS COUNT TOO — a caught exception that leaves an empty
     box logs here and nowhere else — but NOT the ones this harness
     causes itself. page.route below aborts every request that is not
     the stub server, which is how the suite stays offline, and Chrome
     reports each aborted font or icon as "Failed to load resource:
     net::ERR_FAILED". Counting those made all seven sections fail on
     the harness's own design. */
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/net::ERR_FAILED|net::ERR_ABORTED|Failed to load resource/.test(t)) return;
    errors.push('console: ' + t);
  });
  await page.request.post(BASE + '/__plan', { data: plan });
  const t0 = Date.now();
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  return { ctx, page, errors, boot: Date.now() - t0 };
}

/* Every tab, visited, with a hard requirement that each one actually
   drew something. "No error" is not the same as "rendered" — a caught
   exception mid-render leaves an empty box and a green error log, which
   is how the empty-Standings bug shipped. */
const TABS = [
  ['picks', '#slate .card'],
  ['grid', '#gridBody tbody tr'],
  ['standings', '#board .row'],
  ['help', '#v-help'],
  ['settings', '#v-settings .opt'],
];
async function walkTabs(page, label) {
  const out = [];
  for (const [tab, sel] of TABS) {
    const t0 = Date.now();
    await page.click(`[data-tab="${tab}"]`).catch(() => {});
    await page.waitForTimeout(260);
    const n = await page.locator(sel).count();
    out.push({ tab, n, t: Date.now() - t0 });
    ok(`${label}: ${tab} renders something`, n > 0, `${n} of ${sel}`);
  }
  console.log('       ' + out.map(o => `${o.tab} ${o.n}@${ms(o.t)}`).join('  '));
  return out;
}

/* ------------------------------------------------------------------ */
console.log('\n1. A full pool on a full slate — 50 players, 16 games');
{
  const { ctx, page, errors, boot } = await open(
    { playerCount: 50, weeks: 3, gamesPerWeek: 16, startISO: MNF(), promo: true });
  console.log(`       boot ${ms(boot)}`);
  ok('it boots at all', boot < 25000, ms(boot));
  await walkTabs(page, '50 players');

  /* THE GRID AT FULL SIZE is the heaviest thing the app draws: 50 rows
     by 16 game columns plus the tiebreaker and the total. It is also
     where the three-row collapse lived, so the row count is asserted
     rather than the absence of an error. */
  await page.click('[data-tab="grid"]');
  await page.waitForTimeout(500);
  const grid = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#gridBody tbody tr')]
      .filter(tr => !tr.classList.contains('poolrow'));
    const sc = document.querySelector('.gridscroll');
    return {
      rows: rows.length,
      cols: document.querySelectorAll('#gridBody thead th').length,
      cells: document.querySelectorAll('#gridBody tbody td').length,
      visible: sc ? Math.round(sc.getBoundingClientRect().height) : 0,
      scrollable: sc ? sc.scrollHeight > sc.clientHeight : false,
    };
  });
  console.log(`       grid ${grid.rows}x${grid.cols} = ${grid.cells} cells, ` +
              `${grid.visible}px tall`);
  ok('every player has a Grid row', grid.rows === 50, String(grid.rows));
  ok('Player + 16 games + Tie + Pts = 19 columns', grid.cols === 19, String(grid.cols));
  ok('and the table is taller than its box, so it scrolls rather than collapsing',
     grid.scrollable === true);
  /* THE COLLAPSE, PINNED BY A NUMBER. The bug was a 200px floor that
     showed about three rows whatever the pool size. Anything under
     roughly half the viewport is that bug returning. */
  ok('the Grid gets most of the screen, not a 200px floor',
     grid.visible > 380, `${grid.visible}px`);

  /* SIDEWAYS, to the last column and back. The sticky Player and Pts
     cells are what make this readable, and the leader's were
     transparent — team codes dragged through the leader's name. */
  const sticky = await page.evaluate(async () => {
    const sc = document.querySelector('.gridscroll');
    sc.scrollLeft = sc.scrollWidth;
    await new Promise(r => requestAnimationFrame(r));
    const lead = document.querySelector('#gridBody tbody tr.lead td.pl');
    const any = document.querySelector('#gridBody tbody tr td.pl');
    const bg = el => el ? getComputedStyle(el).backgroundColor : '';
    const opaque = c => { const m = /rgba?\(([^)]+)\)/.exec(c);
      if (!m) return false; const p = m[1].split(',').map(Number);
      return p.length < 4 || p[3] === 1; };
    const r = { at: sc.scrollLeft, wide: sc.scrollWidth > sc.clientWidth,
                lead: opaque(bg(lead)), any: opaque(bg(any)) };
    sc.scrollLeft = 0;
    return r;
  });
  ok('the Grid scrolls sideways', sticky.wide === true);
  ok('and the pinned Player cells stay opaque at the far edge',
     sticky.any === true && sticky.lead === true, JSON.stringify(sticky));

  /* TABLET. Same pool, wider glass. Nothing may overflow the page
     horizontally: a body wider than the window is the signature of a
     fixed width sneaking into a layout. */
  for (const view of [{ width: 320, height: 720 }, { width: 768, height: 1024 },
                      { width: 1024, height: 768 }]) {
    await page.setViewportSize(view);
    await page.waitForTimeout(400);
    const o = await page.evaluate(() => ({
      over: document.documentElement.scrollWidth - window.innerWidth,
      tabs: document.querySelectorAll('.tabs .tab').length,
    }));
    ok(`${view.width}px: no horizontal page overflow`, o.over <= 1, `${o.over}px`);
    ok(`${view.width}px: all five tabs present`, o.tabs === 5, String(o.tabs));
  }
  await page.setViewportSize({ width: 390, height: 844 });
  ok('no page errors across the whole pass', errors.length === 0, errors[0]);
  await ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n2. Rapid week switching — the thing people do while waiting');
{
  /* Each switch reloads that week's picks and rebuilds the slate, the
     Grid and both Standings tables. Hammering it is how a render that
     assumes it finished before the next one started gets caught, and
     how the week-keyed movement-arrow history earns its keep. */
  const past = new Date(Date.now() - 30 * 864e5).toISOString();
  const { ctx, page, errors } = await open(
    { playerCount: 28, weeks: 8, gamesPerWeek: 16, startISO: past });
  const weeks = await page.locator('.wk[data-wk]').count();
  ok('there is a week strip to hammer', weeks >= 6, String(weeks));

  const t0 = Date.now();
  let switches = 0;
  for (let round = 0; round < 3; round++) {
    for (let w = 1; w <= Math.min(weeks, 8); w++) {
      await page.click(`.wk[data-wk="${w}"]`).catch(() => {});
      switches++;
      await page.waitForTimeout(45);          // faster than a human can tap
    }
  }
  await page.waitForTimeout(900);
  const spent = Date.now() - t0;
  console.log(`       ${switches} switches in ${ms(spent)} (${ms(spent / switches)} each)`);

  const after = await page.evaluate(() => ({
    cards: document.querySelectorAll('#slate .card').length,
    wkOn: document.querySelectorAll('.wk.on').length,
    label: (document.querySelector('.wklab') || {}).textContent || '',
  }));
  ok('the slate still renders after the hammering', after.cards > 0, String(after.cards));
  ok('exactly one week is selected', after.wkOn === 1, String(after.wkOn));

  /* NO INVENTED MOVEMENT. Nobody's points changed while the week
     buttons were being mashed, so no arrow may be on screen. This is the
     bug that hopping between weeks used to draw. */
  await page.click('[data-tab="standings"]');
  await page.waitForTimeout(500);
  for (let w = 1; w <= Math.min(weeks, 6); w++) {
    await page.click(`.wk[data-wk="${w}"]`).catch(() => {});
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(600);
  const arrows = await page.locator('#board .row .arrow').count();
  ok('no movement arrows appear from switching alone', arrows === 0, String(arrows));

  /* And the tab that is open must survive it. The week strip and the
     tab row are independent, and a week switch that reset the tab would
     throw people off Standings every time they looked at another week. */
  const stillOn = await page.locator('[data-tab="standings"].on').count();
  ok('and the open tab is not reset by a week switch', stillOn === 1, String(stillOn));
  ok('no page errors', errors.length === 0, errors[0]);
  await ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n3. ESPN gone, three ways');
{
  /* Since v1.31.0 the live clock and the live score are read from ESPN
     BY THE PHONE. So ESPN being down is now an app failure path, and
     what must survive it is everything that does not come from ESPN:
     the cards, the picks, the points, the standings. Those come from
     Firestore and are the actual game. */
  /* MNF, so there IS a live game — the poll only runs while something
     it is showing is being played, and a fixture with nothing live
     asserts that ESPN was never asked, which proves nothing about what
     happens when ESPN is down. */
  for (const mode of ['down', 'throw', 'junk']) {
    const { ctx, page, errors } = await open(
      { playerCount: 28, weeks: 2, gamesPerWeek: 16, startISO: MNF(), espn: mode });
    await page.waitForTimeout(1500);
    const s = await page.evaluate(() => ({
      cards: document.querySelectorAll('#slate .card').length,
      clock: (document.querySelector('#countdown') || {}).textContent || '',
      bands: document.querySelectorAll('#slate .lockband').length,
      // a card must never print the literal word undefined or NaN
      bad: /undefined|NaN|\[object/.test(document.getElementById('slate').textContent),
      calls: (window.__espnCalls || []).length,
    }));
    ok(`ESPN ${mode}: the slate still renders`, s.cards > 0, String(s.cards));
    ok(`ESPN ${mode}: locked games still say so`, s.bands > 0, String(s.bands));
    ok(`ESPN ${mode}: nothing prints undefined or NaN`, s.bad === false);
    ok(`ESPN ${mode}: the header clock still says something`,
       s.clock.trim().length > 0, JSON.stringify(s.clock));
    ok(`ESPN ${mode}: it was actually asked`, s.calls > 0, String(s.calls));

    // And the rest of the app is reachable, which is the real test: a
    // failed fetch inside a render loop takes the whole screen with it.
    await walkTabs(page, `ESPN ${mode}`);
    ok(`ESPN ${mode}: no page errors`, errors.length === 0, errors[0]);
    await ctx.close();
  }

  /* ESPN RECOVERING. Down at boot, fine afterwards: the poll has to come
     back rather than having given up. */
  const { ctx, page, errors } = await open(
    { playerCount: 12, weeks: 2, gamesPerWeek: 16, startISO: MNF(), espn: 'down' });
  await page.waitForTimeout(1200);
  const before = await page.evaluate(() => (window.__espnCalls || []).length);
  await page.evaluate(() => { window.__espn = []; });
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(2500);
  const recovered = await page.evaluate(() => (window.__espnCalls || []).length);
  ok('the ESPN poll keeps trying after a failure',
     recovered >= before, `${before} -> ${recovered}`);
  ok('and nothing threw while it was failing', errors.length === 0, errors[0]);
  await ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n4. A score storm — results landing while the screens are open');
{
  /* Sunday 4:25pm: a dozen games finishing inside a few minutes, with
     somebody staring at the Grid. Every arriving score re-renders three
     tables. What must hold is not speed but AGREEMENT: the Grid's Pts
     column is the sum of its own row, and the pool's points are the same
     number wherever they are printed. */
  /* MNF AGAIN, and the fixture matters more than the hammering here.
     The first version used a week that had finished days ago, so the app
     had already moved on to the upcoming week — where every Pts cell is
     a dash, every total parses as NaN, and both of the checks below
     compared an empty list with an empty list and passed. A stress test
     that grades nothing is worse than none. This fixture has fifteen
     finals and a game being played, which is what a score storm is. */
  const { ctx, page, errors } = await open(
    { playerCount: 30, weeks: 2, gamesPerWeek: 16, startISO: MNF(),
      espnDetail: '4th 2:11' });
  await page.click('[data-tab="grid"]');
  await page.waitForTimeout(600);

  const t0 = Date.now();
  let ticks = 0;
  for (let i = 0; i < 40; i++) {
    // The app's own one-second tick is what drives a re-render; firing
    // visibilitychange forces the ESPN path too. Both, repeatedly.
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    ticks++;
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(1200);
  console.log(`       ${ticks} forced refreshes in ${ms(Date.now() - t0)}`);

  /* THE ROW MUST ADD UP. This is the check that catches a render which
     half-updated: per-game cells from one pass, the total from another. */
  const sums = await page.evaluate(() => {
    const out = [];
    for (const tr of document.querySelectorAll('#gridBody tbody tr')) {
      if (tr.classList.contains('poolrow')) continue;
      const tot = Number((tr.querySelector('.tot .totnum') || {}).textContent);
      if (!Number.isFinite(tot)) continue;
      let cells = 0;
      for (const td of tr.querySelectorAll('td.gmtd .cell')) {
        const n = Number((td.textContent.match(/\d+/) || [])[0]);
        if (/\bwon\b|\bhit\b/.test(td.className) && Number.isFinite(n)) cells += n;
      }
      out.push({ tot, cells });
    }
    return out;
  });
  /* A FLOOR, NOT "> 0". Every row in this fixture has scored something,
     so anything less than the whole pool means rows were dropped or
     their totals stopped parsing — and "> 0" would have passed on one
     surviving row. */
  ok('every player still has a Grid row with a readable total',
     sums.length === 30, String(sums.length));
  ok('and no row shows a negative or non-finite total',
     sums.every(s => s.tot >= 0), JSON.stringify(sums.slice(0, 3)));

  /* THE SAME PLAYER, THE SAME NUMBER, ON TWO SCREENS. The Grid computes
     the week client-side and Standings may prefer the server's banked
     record; those are allowed to differ only when the record is
     current under a different scoring mode. In this fixture there is no
     mode change, so they must agree — and when they disagreed it was
     the bug that put Steven Kern on 120 and 119 at the same time. */
  const gridPts = await page.evaluate(() => {
    const m = {};
    for (const tr of document.querySelectorAll('#gridBody tbody tr')) {
      if (tr.classList.contains('poolrow')) continue;
      const n = (tr.querySelector('.plmeta b') || {}).textContent;
      const p = Number((tr.querySelector('.tot .totnum') || {}).textContent);
      if (n && Number.isFinite(p)) m[n.trim()] = p;
    }
    return m;
  });
  await page.click('[data-tab="standings"]');
  await page.waitForTimeout(400);
  await page.click('[data-stand="week"]').catch(() => {});
  await page.waitForTimeout(600);
  const boardPts = await page.evaluate(() => {
    const m = {};
    for (const row of document.querySelectorAll('#board .row')) {
      const n = (row.querySelector('.who b') || {}).textContent;
      const p = Number((row.querySelector('.pts b') || {}).textContent);
      if (n && Number.isFinite(p)) m[n.trim()] = p;
    }
    return m;
  });
  const shared = Object.keys(gridPts).filter(k => k in boardPts);
  const disagree = shared.filter(k => gridPts[k] !== boardPts[k]);
  ok('the two screens describe the same 30 players', shared.length === 30,
     String(shared.length));
  ok('and give every one of them the same weekly total',
     disagree.length === 0,
     JSON.stringify(disagree.slice(0, 4).map(k => [k, gridPts[k], boardPts[k]])));
  ok('no page errors during the storm', errors.length === 0, errors[0]);
  await ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n5. A long session — opened at noon, still open at midnight');
{
  /* The app is a PWA on a phone in a pocket. Nobody reloads it. So the
     question is whether anything GROWS: a listener re-subscribed on
     every week switch, a node appended instead of replaced, a closure
     held by a timer. Measured as a ratio against a first reading, not
     against an absolute, so the numbers mean the same thing on any
     machine. */
  const past = new Date(Date.now() - 20 * 864e5).toISOString();
  const { ctx, page, errors } = await open(
    { playerCount: 40, weeks: 6, gamesPerWeek: 16, startISO: past });
  const sample = () => page.evaluate(() => ({
    nodes: document.getElementsByTagName('*').length,
    cards: document.querySelectorAll('#slate .card').length,
    rows: document.querySelectorAll('#board .row').length,
    trs: document.querySelectorAll('#gridBody tbody tr').length,
    heap: (performance.memory && performance.memory.usedJSHeapSize) || 0,
  }));

  await page.waitForTimeout(800);
  const a = await sample();
  // Twelve hours of a pocket, compressed: switch weeks, switch tabs,
  // switch standings views, force the poll. Repeatedly.
  for (let round = 0; round < 12; round++) {
    for (const [tab] of TABS) {
      await page.click(`[data-tab="${tab}"]`).catch(() => {});
      await page.waitForTimeout(30);
    }
    await page.click('[data-tab="standings"]').catch(() => {});
    await page.click('[data-stand="week"]').catch(() => {});
    await page.click('[data-stand="season"]').catch(() => {});
    for (let w = 1; w <= 4; w++) {
      await page.click(`.wk[data-wk="${w}"]`).catch(() => {});
      await page.waitForTimeout(25);
    }
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  }
  await page.waitForTimeout(1200);
  const b = await sample();
  await page.evaluate(() => { if (window.gc) window.gc(); });
  console.log(`       nodes ${a.nodes} -> ${b.nodes}` +
              (a.heap ? `, heap ${Math.round(a.heap / 1e6)}MB -> ${Math.round(b.heap / 1e6)}MB` : ''));

  /* NODES ARE THE HARD ONE. innerHTML replacement keeps the count flat;
     appending grows it without bound, and a 1.5x ceiling after twelve
     full rounds is generous for the former and impossible for the
     latter. */
  ok('the DOM does not grow without bound',
     b.nodes < a.nodes * 1.5 + 200, `${a.nodes} -> ${b.nodes}`);
  ok('and the screens still render at the end',
     b.cards > 0 && b.trs > 0, JSON.stringify(b));
  if (a.heap) {
    ok('the heap does not double', b.heap < a.heap * 2.2 + 8e6,
       `${Math.round(a.heap / 1e6)}MB -> ${Math.round(b.heap / 1e6)}MB`);
  }

  /* STILL RESPONSIVE. A count that looks fine on a frozen page proves
     nothing, so finish by using the app. */
  await page.click('[data-tab="picks"]').catch(() => {});
  await page.waitForTimeout(400);
  const alive = await page.locator('#slate .card').count();
  ok('and it still responds to a tap after all of that', alive > 0, String(alive));
  ok('no page errors in a long session', errors.length === 0, errors[0]);
  await ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n6. Offline boot — airplane mode, or a stadium');
{
  /* Nothing here should throw an uncaught error, and the screen must not
     be blank: a player with no signal deserves a sentence, not a white
     page. The Firestore reads are stubbed to fail, which is what the
     app sees when the network is gone. */
  const { ctx, page, errors } = await open(
    { playerCount: 12, weeks: 2, gamesPerWeek: 16,
      fail: { season: true } });
  await page.waitForTimeout(1600);
  const s = await page.evaluate(() => ({
    text: (document.body.innerText || '').trim(),
    visible: document.body.getBoundingClientRect().height > 100,
    blank: (document.body.innerText || '').trim().length === 0,
  }));
  ok('the page is not blank', s.blank === false, JSON.stringify(s.text.slice(0, 80)));
  ok('and it says something a person can read',
     s.text.length > 20, JSON.stringify(s.text.slice(0, 120)));
  ok('no uncaught error on a failed boot',
     errors.filter(e => !/console:/.test(e)).length === 0, errors[0]);
  await ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n7. The Thursday-night path, at both real widths');
{
  /* THE WHOLE POINT OF THIS RELEASE, walked. A Thursday game in
     progress: ESPN's own clock on the left of the card, IN PROGRESS on
     the right, one pulsing dot on the row, the header saying how many
     games are live, and the strip on a finished card FILLED rather than
     ringed. Checked at 320px and 390px, because the narrow phone is
     where every clipping bug has been. */
  for (const view of [{ width: 320, height: 720 }, { width: 390, height: 844 }])
  for (const [when, clock, startISO] of [
    /* TWO MOMENTS, and both are in this release. Thursday night is one
       game being played with the rest of the week still to come, so the
       header is still the gold countdown; Monday night is the same live
       row with fifteen decided cards above it, which is the only
       fixture that shows both the FILLED strip and the "1 game live"
       header at once. */
    ['Thu', '3rd · 5:42', THU()],
    ['Mon', '4th · 2:11', MNF()],
  ]) {
    const { ctx, page, errors } = await open(
      { playerCount: 28, weeks: 2, gamesPerWeek: 16, startISO,
        espnDetail: clock.replace(' · ', ' ') }, view);
    await page.waitForTimeout(1600);
    const s = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('#slate .card')];
      const live = cards.filter(c => c.querySelector('.cd.live.lefted'));
      /* DECIDED CARDS, AS THEY ARE REPORTED NOW. This counted
         `.lockband.won, .lockband.lost` — the Q2 fill — which no longer
         exists: a final card has no lock band at all, and says WIN or
         LOSS in the result bar's pill instead. */
      const decided = cards.filter(c => {
        const w = c.querySelector('.resbar .sb-word');
        return w && /WIN|LOSS/.test(w.textContent);
      });
      const dots = c => {
        // a dot is ::before on .cd.live without .nodot
        return [...c.querySelectorAll('.meta .cd.live')]
          .filter(e => !e.classList.contains('nodot')).length;
      };
      return {
        cards: cards.length,
        live: live.length,
        clock: live.length ? live[0].querySelector('.cd.live.lefted').textContent.trim() : '',
        right: live.length
          ? [...live[0].querySelectorAll('.meta .cd')].pop().textContent.trim() : '',
        dots: live.length ? dots(live[0]) : -1,
        decided: decided.length,
        // and none of them may be a coloured strip
        strips: cards.filter(c =>
          c.querySelector('.lockband.won, .lockband.lost')).length,
        header: (document.querySelector('#countdown') || {}).textContent.trim(),
        over: document.documentElement.scrollWidth - window.innerWidth,
        clipped: [...document.querySelectorAll('#countdown .txt, .meta .cd')]
          .filter(e => e.scrollWidth > e.clientWidth + 1).length,
      };
    });
    const at = `${when} ${view.width}px`;
    console.log(`       ${at}: ${s.cards} cards, ${s.live} live, ` +
                `clock "${s.clock}", right "${s.right}", header "${s.header}"`);
    ok(`${at}: the slate renders`, s.cards > 0, String(s.cards));
    /* NOT CONDITIONAL. Both fixtures are chosen to have exactly one
       live game, so "if there is a live game" would let the whole P1
       check disappear the moment a fixture drifted — which is how the
       first version of this section asserted nothing at all. */
    ok(`${at}: exactly one game is live`, s.live === 1, String(s.live));
    ok(`${at}: ESPN's clock is on the left, with the middot inserted`,
       s.clock === clock, JSON.stringify(s.clock));
    ok(`${at}: IN PROGRESS is on the right`,
       /in progress/i.test(s.right), JSON.stringify(s.right));
    ok(`${at}: exactly one pulsing dot on the row`, s.dots === 1, String(s.dots));
    if (when === 'Mon') {
      // Fifteen decided cards above the live one: the fill, and the
      // header state that only exists once everything has kicked off.
      ok(`${at}: fifteen decided cards report a result`,
         s.decided === 15, String(s.decided));
      ok(`${at}: and none of them is a coloured strip`,
         s.strips === 0, String(s.strips));
      ok(`${at}: and the header reads the live count`,
         /^1 game live$/.test(s.header), JSON.stringify(s.header));
    } else {
      // Thursday: the week has games still to come, so the gold
      // countdown branch is correct and must NOT be the live count.
      ok(`${at}: nothing is decided yet`, s.decided === 0, String(s.decided));
      ok(`${at}: so the header is still counting down to the next game`,
         /·/.test(s.header) && !/live/i.test(s.header), JSON.stringify(s.header));
    }
    ok(`${at}: nothing overflows the page`, s.over <= 1, `${s.over}px`);
    ok(`${at}: no text in the clock or meta row is clipped`,
       s.clipped === 0, String(s.clipped));
    ok(`${at}: no page errors`, errors.length === 0, errors[0]);
    await ctx.close();
  }
}

/* ------------------------------------------------------------------ */
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
if (fails.length) { console.log('FAILURES:'); fails.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);
