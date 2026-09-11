/* Regression tests for bugs that shipped and were fixed.

   Every case here is a defect that was live in production, that clicking
   around would not have surfaced, and that a plausible future edit could
   quietly reintroduce. A test named after the symptom is worth more than
   one named after the function, so they read as user complaints.

   Run:  node app-serve.mjs &   then   node regress.ui.test.mjs
*/
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:8098';
let pass = 0, fail = 0; const fails = [];
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n); }
  else { fail++; fails.push(n + (x ? ' -> ' + x : '')); console.log('  FAIL ' + n + (x ? '  -> ' + x : '')); } };

const browser = await chromium.launch();

/* NOTIFICATION PERMISSION IS FAKED HERE, AND IT HAS TO BE.

   Headless Chromium reports Notification.permission as 'denied' whatever
   you do, and Playwright cannot move it: context permissions:['notifications']
   and grantPermissions({origin}) were both tried, both still read 'denied'.

   That is not a harmless default. 'denied' is the one state a real player
   only reaches by deliberately blocking the site, and the alerts banner
   branches on it to show "unblock this in your browser settings" with no
   button at all. So every case below would have graded the blocked-player
   copy while claiming to test an ordinary player who simply has no token
   — and passed while doing it. Overriding the property is the only way to
   reach the branch the twelve dark players in week 1 were actually in.

   opts.notify: 'granted' (default) or 'denied'. */
async function open(plan = {}, opts = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    ...(opts.userAgent ? { userAgent: opts.userAgent } : {}) });
  await ctx.addInitScript(p => {
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: { permission: p, requestPermission: async () => p } });
  }, opts.notify || 'granted');
  const page = await ctx.newPage();
  await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.request.post(BASE + '/__plan', { data: plan });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  return { ctx, page, errors };
}

/* ------------------------------------------------------------------ */
console.log('\n1. Everyone called "Player" must not collapse into one row');
{
  /* THE BUG: PIN sign-in populates neither displayName nor email, so
     ensureMember() wrote the literal name "Player" for every member. The
     app then keyed players by NAME, so an entire pool of "Player" became a
     single bucket: five people, one row, everybody looking at one person's
     picks and one person's score. Keying by uid is the fix; this proves
     duplicate display names stay distinct. */
  const past0 = new Date(Date.now() - 40 * 864e5).toISOString();
  const { ctx, page, errors } = await open({
    members: ['Player', 'Player', 'Player', 'Player'], playerCount: 0,
    startISO: past0                     // ditto: the table needs scored weeks
  });
  await page.click('[data-tab="standings"]').catch(() => {});
  await page.waitForTimeout(400);
  const rows = await page.locator('#board .row').count();
  ok('four members with identical names render four standings rows', rows === 4, String(rows));
  ok('and no errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n2. A name containing markup must not execute');
{
  /* THE BUG: member names went into innerHTML unescaped, and the rules let
     a member set their own name to anything. One member could therefore
     run script in every other member's session, on the origin holding
     their sign-in cookie. */
  const past = new Date(Date.now() - 40 * 864e5).toISOString();
  const { ctx, page, errors } = await open({
    members: ['Lee', '<img src=x onerror="window.__xss=1">'], playerCount: 0,
    startISO: past                      // finals exist, so the table renders
  });
  await page.click('[data-tab="standings"]').catch(() => {});
  await page.waitForTimeout(500);
  const fired = await page.evaluate(() => !!window.__xss);
  ok('markup in a display name does not execute', fired === false);
  const shown = await page.locator('#board').innerText();
  ok('and is shown as literal text instead', shown.includes('<img'), shown.slice(0, 80));
  ok('no errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n3. "Final" must follow the recorded status, not the clock');
{
  /* THE BUG: isFinal() was kickoff + 3h20m. An overtime game, a weather
     delay or one missed scoring run flipped the app to Final while
     `winner` was still null — and a null winner matches nobody, so every
     player in the pool took a red miss on a game still being played, and
     the card printed the literal text "Final · null". */
  const { ctx, page, errors } = await open({ weeks: 2, gamesPerWeek: 4 });
  await page.waitForTimeout(500);
  const body = await page.locator('body').innerText();
  ok('the word "null" never reaches the screen', !/\bnull\b/.test(body),
     (body.match(/.{0,40}null.{0,40}/) || [''])[0]);
  ok('no errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n4. A failed save must never say "Saved"');
{
  /* THE BUG: every pick write was `savePicks(...).catch(console.warn)`
     followed by an unconditional, synchronous flashSaved(). The green
     "Saved" was printed before the promise was even scheduled, so a denied
     write, a dead connection or a slow device clock all showed "Saved" and
     lost the picks. Someone could tap through sixteen games, be told
     sixteen times it saved, and go to bed with nothing written. */
  const { ctx, page, errors } = await open({ fail: { savePicks: true } });
  await page.waitForTimeout(400);
  const side = page.locator('#slate .side').first();
  if (await side.count()) {
    await side.click({ force: true }).catch(() => {});
    /* commitPicks() now retries once, silently, ~1.2s after the first
       rejection — see its own comment: a brand-new sign-in's Firestore
       connection can reject a write in its first second while it is
       still finishing its handshake, which is exactly what "picks didn't
       save" right after signing in, that then quietly stopped on its
       own, turned out to be. A permanently-failing save (this test) still
       ends up reported — just after that one retry, not before it. */
    await page.waitForTimeout(2200);
    const label = await page.locator('#toast').innerText().catch(() => '');
    ok('a rejected save does not report success', !/^saved$/i.test(label.trim()), label);
    ok('and says something is wrong instead',
       /not saved|didn.t save|check your connection|kicked off/i.test(label), label);
  } else {
    ok('a rejected save does not report success', false, 'no tappable game found');
    ok('and says something is wrong instead', false, 'no tappable game found');
  }
  ok('no errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n5. Switching weeks must not leave listeners on the old one');
{
  /* THE BUG: watchWeek/watchRevealed were opened once, at boot, bound to
     the boot week — but their callbacks wrote into whatever week was on
     screen when they fired. Browsing ahead during a live Sunday let a
     week-5 score update overwrite the week-12 view: right header, wrong
     games, picks saved against game ids from another week. */
  const { ctx, page, errors } = await open({ weeks: 6, gamesPerWeek: 4 });
  await page.waitForTimeout(500);
  const before = await page.evaluate(() => window.__ps.calls('watchWeek'));
  const wk = page.locator('#weeks .wk').nth(3);
  if (await wk.count()) {
    await wk.click({ force: true }).catch(() => {});
    await page.waitForTimeout(800);
    const after = await page.evaluate(() => window.__ps.calls('watchWeek'));
    ok('changing week re-subscribes the live listeners', after > before,
       `${before} -> ${after}`);
  } else {
    ok('changing week re-subscribes the live listeners', false, 'no week strip');
  }
  ok('no errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n6. The scoring mode shown must be the pool\'s real mode');
{
  /* THE BUG: the client read pools/{id}/config/scoring.history — a
     document nothing has ever written — while setup_season.py and
     score_week.py both use `scoringHistory` on the pool document. The read
     always missed and fell through to 'straight', so the confidence tray,
     the stake bars and every ranked point silently vanished for every
     player while the server scored the season in confidence.
     Separately, the Settings buttons had "Confidence" hardcoded as
     selected and nothing ever updated it. */
  /* RE-POINTED when the Settings mode switch was deleted. This asserted
     on which `.mbtn` carried the `on` class, and those buttons no longer
     exist — one scoring system now, not a setting anyone can change.

     The bug underneath is not gone though, it is MORE dangerous: with no
     switch on screen, a client that silently falls through to 'straight'
     has nothing anywhere to reveal the mismatch, while score_week.py
     settles the season in confidence. So this now asserts the same
     invariant through what the mode actually DOES — the stake bars and
     the header badge — in both directions, which is what a player would
     have noticed and what the original bug destroyed. */
  const soon = new Date(Date.now() + 3 * 864e5).toISOString();   // nothing locked yet

  const s = await open({ mode: 'straight', startISO: soon, weeks: 2 });
  await s.page.waitForTimeout(700);
  ok('a straight-up pool shows no stake bars',
     (await s.page.locator('#slate .stakebar').count()) === 0);
  ok('and says so in the header badge',
     (await s.page.locator('#modeTag').innerText().catch(() => '')).trim() === 'S/U');
  ok('no errors', s.errors.length === 0, s.errors[0] || '');
  await s.ctx.close();

  /* The direction the original bug actually broke: a confidence pool
     losing its ranks and being scored — and displayed — as straight-up. */
  const c = await open({ mode: 'confidence', startISO: soon, weeks: 2 });
  await c.page.waitForTimeout(700);
  ok('a confidence pool keeps its stake bars',
     (await c.page.locator('#slate .stakebar').count()) > 0);
  ok('and its header badge',
     (await c.page.locator('#modeTag').innerText().catch(() => '')).trim() === 'CONF');
  ok('no errors', c.errors.length === 0, c.errors[0] || '');
  await c.ctx.close();

  /* And the switch itself is gone for good — putting it back is a
     product decision, not something to reintroduce by accident. */
  const g = await open({ startISO: soon });
  await g.page.click('[data-tab="settings"]').catch(() => {});
  await g.page.waitForTimeout(400);
  ok('the scoring-mode switch is no longer in Settings',
     (await g.page.locator('.mbtn[data-mode]').count()) === 0);
  await g.ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n7. A malformed game document must not kill the app');
{
  /* THE BUG: kickoff.toMillis() assumed every game document has a kickoff
     Timestamp. A scoring job writing by a reconstructed id could create a
     partial document holding only scores, and one of those threw inside
     loadSeason() — which is not wrapped in optional() — so a single bad
     row took the whole app down for everyone with "We couldn't load your
     week." */
  const { ctx, page, errors } = await open({ badTeam: true });
  await page.waitForTimeout(700);
  const visible = await page.locator('#slate .card').count();
  ok('an unknown team abbreviation still renders the slate', visible > 0, String(visible));
  ok('no errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n8. A notification switch that did not save must not look on');
{
  /* THE BUG: the toggle wrote fire-and-forget with an empty catch. A
     denied or dropped write left the switch on, localStorage agreeing,
     and the roster — the only thing remind.py and worker/live.js read —
     never updated. The player is then certain they turned on the last
     call reminder, and it simply never comes. */
  const { ctx, page, errors } = await open({ fail: { upsertRoster: true } });
  await page.click('[data-tab="settings"]').catch(() => {});
  await page.waitForTimeout(400);
  const sw = page.locator('#prefs [data-pref]').first();
  if (await sw.count()) {
    const before = await sw.getAttribute('class');
    await sw.click({ force: true }).catch(() => {});
    await page.waitForTimeout(700);
    const after = await page.locator('#prefs [data-pref]').first().getAttribute('class');
    ok('a rejected write reverts the switch', before === after, `${before} -> ${after}`);
    const t = await page.locator('#toast').innerText().catch(() => '');
    ok('and says so out loud', /save|connection/i.test(t), t);
  } else {
    ok('a rejected write reverts the switch', false, 'no preference switches found');
    ok('and says so out loud', false, 'no preference switches found');
  }
  ok('the switches are reachable by keyboard',
     (await page.locator('#prefs button[role="switch"]').count()) > 0);
  await ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n9. Nobody leads a week in which nobody has scored');
{
  /* THE BUG: the Grid's first row got the gold `lead` class
     unconditionally, so the moment the first game merely kicked off —
     before any result existed — the table sat on all-zero points with a
     crowned leader, who is really just whoever sorts first. The
     Standings tab already guarded this; the Grid did not. */
  const soon = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { ctx, page, errors } = await open(
    { weeks: 1, gamesPerWeek: 4, startISO: soon, playerCount: 6 });
  await page.click('[data-tab="grid"]').catch(() => {});
  await page.waitForTimeout(700);
  const verdict = await page.evaluate(() => {
    const lead = document.querySelectorAll('#gridBody tbody tr.lead').length;
    if (!lead) return 'none';
    const pts = [...document.querySelectorAll('#gridBody tbody tr td.tot')]
      .map(td => parseInt(td.textContent, 10) || 0);
    return pts.some(p => p > 0) ? 'someone scored' : 'crowned at zero';
  });
  ok('no gold row while every score is zero', verdict !== 'crowned at zero', verdict);
  ok('no errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n10. "Show me the walkthrough again" must not skip to the last page');
{
  /* THE BUG: replayOnboarding() looked for the one screen flagged
     `howto` — the "Six rules" recap, which is also the LAST screen
     before "Let's play" — so tapping this in Settings for someone
     already signed in landed one tap from the end and skipped every
     other page of the tour (install, alerts) that the function's own
     comment said it was never supposed to skip. Only the two sign-in
     screens (name/email, the code) are meant to be skipped for someone
     already in. */
  const { ctx, page, errors } = await open({});
  await page.waitForTimeout(700);
  await page.click('[data-tab="help"]').catch(() => {});
  await page.waitForTimeout(200);
  await page.click('#hpReplay', { force: true }).catch(() => {});
  await page.waitForTimeout(300);
  const heading = await page.locator('#obBody').innerText().catch(() => '');
  ok('replay does not open on the final "Six rules" recap screen',
     !/Six rules/i.test(heading), heading.slice(0, 60));
  ok('and does not open on a sign-in screen either',
     !/What do we call you|Check your inbox/i.test(heading), heading.slice(0, 60));
  ok('no errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n11. A live player must never be shown the invented demo season');
{
  /* THE BUG, reported twice as "it is caching an old version" and chased
     twice in the wrong place, because from outside that is exactly what
     it looks like.

     index.html builds a mock season at module scope — shuffled matchups
     from slateFor(), kickoffs placed at W1OFF minute-offsets from
     Date.now() — and that loop ran unconditionally, DEMO or not. The
     first EIGHT week-1 offsets are negative, so isLive() (which is only
     `Date.now() >= g.kick`) was true for half of week 1 the instant the
     page parsed. Every player opening the app saw teams who are not
     playing each other, half of them reading "IN PROGRESS · LOCKED", in
     a week that has not started — until loadSeason() finished its
     network round trips and swapped the real schedule in underneath.

     Tapping to week 2 and back appeared to "fix" it, which is what sent
     two separate investigations looking at caching, listeners and
     Firestore consistency. It fixed nothing: it just forced a render
     against data that had since become real.

     What this asserts is the one thing that actually matters — that
     nothing on screen came from the generator. Real games here carry
     Firestore's document ids (`2026_W1_AWAY_HOME` shape, per
     import_schedule.py and app-serve.mjs); generated ones are `w1g0`,
     `w1g1`... So a single `w<digits>g<digits>` anywhere in the rendered
     slate means the mockup reached a live player's screen. */
  /* THE WINDOW IS THE WHOLE TEST, and the first version of this missed it.

     Written the obvious way — load the app, look at the slate — this
     passes with the bug fully present, because against a local stub
     loadSeason() resolves in milliseconds and the mock season is
     overwritten before any assertion runs. Confirmed by putting the bug
     back and watching the suite stay green, which is the only reason
     this comment exists.

     The defect lives in the gap between page parse and the schedule
     arriving. On a phone on 4G that gap is seconds long; here it has to
     be created deliberately, by holding getAllWeeks open. Everything
     asserted below is read DURING that gap.

     ASSERTED ON #countdown, deliberately. tick() runs on a one-second
     interval from module scope — before any sign-in, before boot's
     network chain, regardless of auth — and writes the next kickoff into
     that header straight out of WEEKS. So with the bug present it names a
     fabricated matchup within a second of page load, with nothing else
     required to reproduce it. That is also the exact artifact the player
     photographed: their header read "BRONCOS @ SEAHAWKS · 2M 26S", which
     is SLATES[1][9] = ['DEN','SEA'] at W1OFF[9] = +9 minutes from load.

     Checking the slate instead does NOT work here, and the first two
     attempts at this test proved it: nothing paints #slate until boot
     finishes, so against a local stub the assertion runs after the real
     schedule has already replaced the mockup and passes with the bug
     fully in place. Both earlier versions stayed green when the fix was
     reverted. This one does not. */
  const b = await open({ signedOut: true, delay: { getAllWeeks: 4000 } });
  await b.page.waitForTimeout(1600);         // tick() has run; schedule has not landed

  /* One assertion, because only one discriminates. Matching on team
     nicknames looks more specific and is worthless: SLATES[1] covers all
     32 clubs, so any nickname list either matches the real schedule too
     or misses most of the mock one — the first draft of this let
     "JAGUARS @ RAIDERS · 33S" through. With no schedule loaded there is
     nothing legitimate to count down to, so the header naming ANY
     matchup at this moment means the mock season is live on screen. */
  const head = await b.page.locator('#countdown').innerText().catch(() => '');
  ok('the countdown names no game at all while the schedule is still loading',
     head.trim() === '' || !/@/.test(head), head.slice(0, 60));

  const leaked = await b.page.evaluate(() =>
    [...document.querySelectorAll('#slate [data-game]')]
      .map(el => el.getAttribute('data-game'))
      .filter(id => /^w\d+g\d+$/.test(id)));
  ok('no generated game ids are painted while the real schedule loads',
     leaked.length === 0, leaked.slice(0, 3).join(', '));
  ok('no errors', b.errors.length === 0, b.errors[0] || '');
  await b.ctx.close();

  // ...and once a real schedule does land, everything renders normally.
  const c = await open({ weeks: 3 });
  await c.page.waitForTimeout(1200);
  ok('the real games render once the schedule lands',
     (await c.page.locator('#slate [data-game]').count()) > 0);
  ok('and the countdown then names a real one',
     /\d/.test(await c.page.locator('#countdown').innerText().catch(() => '')));
  await c.ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n12. The Home Screen prompt must fit the browser it is standing in');
{
  /* THE COMPLAINT that produced this screen: the first person other than
     the owner to be sent the link gave up at "tap the three dots, tap
     Share, scroll, Add to Home Screen" — four steps, described for a
     browser they were not even using, before they had any reason to care.

     Two things have to hold and neither is visible from reading the code.
     The steps must match the ACTUAL browser (Safari puts Share in the
     toolbar; Chrome, Edge and Firefox on iOS each bury it behind their
     own menu first), and there must always be a way straight past it,
     because everything except the kickoff alert works fine in a tab and a
     forced install wall in front of a stranger is how you lose them.

     iPhone cannot install from a button — Apple ships no API for it — so
     accurate instructions are the whole of what is possible there, which
     is exactly why getting them per-browser is worth a test. */
  const UA = {
    safari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 '
          + '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    edge:   'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 '
          + '(KHTML, like Gecko) Version/17.5 EdgiOS/122.0 Mobile/15E148 Safari/604.1',
    laptop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
          + '(KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  };
  const openUA = async ua => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: ua });
    const page = await ctx.newPage();
    await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.request.post(BASE + '/__plan', { data: { signedOut: true } });
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    return { ctx, page, errors };
  };

  const saf = await openUA(UA.safari);
  ok('an iPhone lands on the Home Screen prompt before signing in',
     /Home Screen/i.test(await saf.page.locator('#obBody').innerText().catch(() => '')));
  ok('and is always offered a way straight past it',
     await saf.page.locator('#obSkip').isVisible().catch(() => false));
  await saf.page.click('#obGo').catch(() => {});
  await saf.page.waitForTimeout(400);
  const safSteps = await saf.page.locator('.ob-steps').innerText().catch(() => '');
  ok('Safari is pointed at the Share button in its own toolbar',
     /bottom of the screen/i.test(safSteps) && !/⋯/.test(safSteps), safSteps.slice(0, 70));
  ok('no errors', saf.errors.length === 0, saf.errors[0] || '');
  await saf.ctx.close();

  const edg = await openUA(UA.edge);
  await edg.page.click('#obGo').catch(() => {});
  await edg.page.waitForTimeout(400);
  const edgSteps = await edg.page.locator('.ob-steps').innerText().catch(() => '');
  ok('Edge on iOS is told about its own menu first, then Share',
     /⋯/.test(edgSteps) && /Share/i.test(edgSteps), edgSteps.slice(0, 70));
  ok('the two browsers are not handed identical instructions',
     edgSteps.trim() !== safSteps.trim());
  await edg.ctx.close();

  const dsk = await openUA(UA.laptop);
  ok('a laptop is never shown a Home Screen prompt',
     !/Home Screen/i.test(await dsk.page.locator('#obBody').innerText().catch(() => '')));
  ok('no errors on desktop', dsk.errors.length === 0, dsk.errors[0] || '');
  await dsk.ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n13. A score landing must move the Grid and the Standings, live');
{
  /* THE WHOLE LIVE PATH WAS UNTESTED because it was untestable: the
     stub's watchWeek/watchRevealed logged their name and threw the
     callback away, so nothing in this suite had ever seen a score
     arrive. app-serve.mjs now hands those callbacks out on window.

     This is the thing the pool will actually be looking at on a Sunday
     afternoon — cells turning green, players overtaking each other —
     and until now the only evidence it worked was that the code looked
     like it should. */
  const started = new Date(Date.now() - 3 * 3600e3).toISOString();
  const { ctx, page, errors } = await open(
    { startISO: started, weeks: 2, gamesPerWeek: 6, playerCount: 8 });
  await page.waitForTimeout(600);

  const snap = () => page.evaluate(() => ({
    cells: [...document.querySelectorAll('#gridBody tbody tr:first-child .cell')]
             .map(c => c.className),
    board: [...document.querySelectorAll('#board .row .pts b')].map(e => e.textContent.trim()),
  }));

  await page.click('[data-tab="grid"]').catch(() => {});
  await page.waitForTimeout(400);
  const before = await snap();
  ok('the live listener is actually registered',
     await page.evaluate(() => typeof window.__pushWeek === 'function'));

  await page.evaluate(() => window.__pushWeek(window.__weekGames().map(g =>
    ({ ...g, status: 'final', awayScore: 24, homeScore: 17, winner: g.away }))));
  await page.waitForTimeout(800);
  const after = await snap();

  ok('the Grid recolours without a reload',
     JSON.stringify(before.cells) !== JSON.stringify(after.cells),
     after.cells.slice(0, 4).join(','));
  ok('and settles into decided cells, not pending ones',
     after.cells.some(c => /hit|miss/.test(c)) && !after.cells.some(c => /pend/.test(c)),
     after.cells.join(','));
  await page.click('[data-tab="standings"]').catch(() => {});
  await page.waitForTimeout(400);
  const board = (await snap()).board;
  ok('the Standings carry real totals once games are final',
     board.length > 0 && board.some(v => +v > 0), board.slice(0, 4).join(','));
  ok('and are ordered high to low',
     board.map(Number).every((v, i, a) => i === 0 || a[i - 1] >= v), board.join(','));
  ok('no errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n14. The week summary and the consensus bar must survive real data');
{
  /* THE BUG: the Grid header printed "6 final · -5 live · 5 to come".

     `isFinal` reads the status field and `isLive` is only
     `Date.now() >= kickoff`, so a game can be final AND not yet kicked
     off — which is not hypothetical, because import_schedule.py
     deliberately preserves `status: final` while refreshing kickoff on a
     re-import. The counts were `started - finals` and
     `gs.length - started`, which double-counted that game and went
     negative. Three disjoint buckets now. */
  const { ctx, page, errors } = await open(
    { startISO: new Date(Date.now() - 3 * 3600e3).toISOString(),
      weeks: 2, gamesPerWeek: 6, playerCount: 8 });
  await page.waitForTimeout(600);
  await page.click('[data-tab="grid"]').catch(() => {});
  await page.waitForTimeout(300);
  // Every game final while five kickoffs are still in the future.
  await page.evaluate(() => window.__pushWeek(window.__weekGames().map(g =>
    ({ ...g, status: 'final', awayScore: 24, homeScore: 17, winner: g.away }))));
  await page.waitForTimeout(700);
  const sub = await page.locator('#gridSub').innerText().catch(() => '');
  ok('the week summary never prints a negative count', !/-\d/.test(sub), sub);
  ok('and the three buckets add up to the slate',
     (() => { const n = (sub.match(/\d+/g) || []).map(Number);
              return n.length === 3 && n[0] + n[1] + n[2] === 6; })(), sub);

  /* THE OTHER BUG: the consensus bar paints each side in the club's own
     colour, and 151 of the 496 possible matchups put those two colours
     under 1.3:1 against each other — six pairs are the SAME HEX (Dallas
     and the Rams are both #003594). Those games rendered as one solid
     block with two labels floating in it. A gap makes the split visible
     whatever the two clubs wear. */
  await page.click('[data-tab="picks"]').catch(() => {});
  await page.waitForTimeout(300);
  const bar = await page.evaluate(() => {
    const g = window.__weekGames(); const a = g[0];
    g[0] = { ...a, away: 'DAL', home: 'LAR', status: 'scheduled',
             winner: null, awayScore: null, homeScore: null };
    window.__pushWeek(g);
    const rows = [];
    for (let i = 0; i < 8; i++)
      rows.push({ uid: 'u_' + i, name: 'P' + i, gameId: a.id,
                  winner: i < 4 ? 'DAL' : 'LAR', weight: i + 1 });
    window.__pushRevealed(rows);
    return new Promise(r => setTimeout(() => {
      const b = document.querySelector('.cbar');
      r(b ? { gap: getComputedStyle(b).gap,
              bgs: [...b.querySelectorAll('.cseg')]
                     .map(s => getComputedStyle(s).backgroundColor) } : null);
    }, 500));
  });
  ok('two clubs in the identical colour still render two segments',
     !!bar && bar.bgs.length === 2, JSON.stringify(bar));
  ok('and are separated by a gap that does not depend on colour',
     !!bar && parseFloat(bar.gap) > 0 && bar.bgs[0] === bar.bgs[1],
     bar ? `${bar.gap} / ${bar.bgs[0]}` : 'no bar');
  ok('no errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n15. Typing the last PIN digit must not wipe the screen');
{
  /* REPORTED TWICE, by two different people, in almost the same words:
     "they entered the pin, it emptied the boxes, sat there a few seconds,
     then let them in." Nothing was ever actually wrong — only the screen.

     Firebase fires onAuthStateChanged the INSTANT signInWithToken()
     resolves, which is several lines before the PIN screen's own go()
     finishes. boot()'s watchAuth callback therefore runs mid-sign-in,
     finds no pool yet, and calls showOnboarding(false) — which called
     obRender() unconditionally, rebuilding #obBody and #obFoot. The six
     digits vanished and the button reverted from "Signing you in" to
     "Let me in", which reads as a tap that never registered. That is why
     people tapped again.

     An earlier fix guarded the REWIND (obStep = 0) for this exact race
     and stopped there; the redraw was the other half of it.

     This needs the stub to re-fire watchAuth on sign-in the way the real
     SDK does — app-serve.mjs does that now. Mutation-tested: restore the
     unconditional obRender() and this fails with digits "" and the
     button back to "Let me in". */
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  // Hold sign-in open so go() is still in flight when the callback fires.
  await page.request.post(BASE + '/__plan',
    { data: { signedOut: true, noPool: true, delay: { signInWithToken: 3000 } } });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  await page.fill('#obNameIn', 'Lee').catch(() => {});
  await page.fill('#obMailIn', 'lee@example.com').catch(() => {});
  await page.waitForTimeout(150);
  await page.click('#obGo').catch(() => {});
  await page.waitForTimeout(700);
  for (let i = 0; i < 6; i++) {
    await page.fill('#pin' + i, String(i + 1)).catch(() => {});
    await page.waitForTimeout(40);
  }
  await page.click('#obGo').catch(() => {});
  await page.waitForTimeout(400);

  const read = () => page.evaluate(() => ({
    digits: [...Array(6)].map((_, i) => (document.getElementById('pin' + i) || {}).value || '').join(''),
    btn: (document.getElementById('obGo') || {}).textContent || '',
  }));
  const before = await read();
  ok('the six digits are on screen before the race',
     before.digits === '123456', JSON.stringify(before));

  // What Firebase does the moment the custom token is accepted.
  await page.evaluate(() => window.__authCb && window.__authCb({ uid: 'u_0' }));
  await page.waitForTimeout(500);
  const after = await read();
  ok('the digits survive onAuthStateChanged firing mid-sign-in',
     after.digits === '123456', JSON.stringify(after));
  /* The requirement is that the button has NOT reverted to its resting
     "Let me in" while the step is still in flight — that is what would tell
     a player the sign-in had been abandoned and invite them to press it
     again. It used to be pinned to the literal word "signing", which broke
     when the button started naming the work more precisely. Assert the
     property, and list the labels that satisfy it, so an EMPTY button still
     fails: "not Let me in" alone would pass on a blank one. */
  ok('and the button still says it is working, not "Let me in"',
     /checking your code|building your season|loading season schedule|you're in/i
       .test(after.btn) && !/let me in/i.test(after.btn),
     JSON.stringify(after.btn));
  ok('no errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n16. The two Standings tables must not borrow each other\'s history');
{
  /* THE TRAP, named before the code was written and then proved.

     Season and This-week rank the SAME fifty people on DIFFERENT numbers,
     so they produce different orders. `lastRank` drives the green/red
     movement arrows by remembering where everyone sat last render — and
     with ONE shared map, every switch between tabs writes the other
     view's positions. Come back and the table paints arrows for movement
     that never happened. It looks plausible, it is wrong, and nothing
     ever throws.

     Mutation-tested rather than assumed: collapsing the two maps into one
     put fake arrows on 46 of 50 rows from a single there-and-back. Keyed
     by view, it is 0. */
  const { ctx, page, errors } = await open(
    { playerCount: 50, weeks: 6,
      startISO: new Date(Date.now() - 40 * 864e5).toISOString() });
  await page.waitForTimeout(900);
  await page.click('[data-tab="standings"]').catch(() => {});
  await page.waitForTimeout(600);

  const read = () => page.evaluate(() => ({
    rows: document.querySelectorAll('#board .row').length,
    order: [...document.querySelectorAll('#board .row .who b')].map(e => e.textContent.trim()),
    top: (document.querySelector('#board .row .pts b') || {}).textContent || '',
    arrows: document.querySelectorAll('#board .row .arrow').length,
    lead: (document.querySelector('#board .leadtag') || {}).textContent || '',
    seals: document.querySelectorAll('#board .row svg').length,
    wbw: !!document.querySelector('.wbw'),
    me: (document.getElementById('meBar') || {}).innerText || '',
  }));

  /* THIS WEEK IS THE INTENDED DEFAULT, but it cannot be blind: the week
     on screen is the UPCOMING one, so Tuesday to Saturday it holds no
     finals at all. Hardcoding it opened Standings onto an empty table
     for most players on most days — nine checks across three files went
     to zero rows and that is how it was caught.

     This fixture's week HAS results, so it must land on the week. The
     other suites' fixtures do not, and they assert the season table
     loads there instead — between them the two behaviours are pinned. */
  const landed = await read();
  ok('a week with results opens on This week, not Season',
     /week \d+ leader/i.test(landed.lead), landed.lead);

  await page.click('[data-stand="season"]').catch(() => {});
  await page.waitForTimeout(600);
  const season = await read();
  ok('Season lists everyone', season.rows === 50, String(season.rows));
  ok('and names the season leader', /season leader/i.test(season.lead), season.lead);
  ok('and carries the 1st/2nd/perfect seals',
     season.seals > 0, String(season.seals));

  await page.click('[data-stand="week"]').catch(() => {});
  await page.waitForTimeout(600);
  const week = await read();
  ok('This week lists everyone too', week.rows === 50, String(week.rows));
  ok('names the WEEK leader, not the season one',
     /week \d+ leader/i.test(week.lead), week.lead);
  ok('ranks them on a different order',
     JSON.stringify(week.order) !== JSON.stringify(season.order));
  ok('on smaller numbers than the season total',
     Number(week.top) < Number(season.top), `${week.top} vs ${season.top}`);
  /* Seals are season honours. Repeating them inside one week's table
     answers a question that table is not asking. */
  ok('and drops the season seals', week.seals === 0, String(week.seals));
  ok('the pinned bar follows the view',
     /week/i.test(week.me) && !/week/i.test(season.me),
     JSON.stringify([season.me.slice(0, 40), week.me.slice(0, 40)]));

  ok('the old week-by-week winners list is gone from both',
     !season.wbw && !week.wbw);

  // There and back. Nobody has moved, so nothing may claim they did.
  await page.click('[data-stand="season"]').catch(() => {});
  await page.waitForTimeout(500);
  await page.click('[data-stand="week"]').catch(() => {});
  await page.waitForTimeout(500);
  await page.click('[data-stand="season"]').catch(() => {});
  await page.waitForTimeout(600);
  const after = await read();
  ok('no invented movement arrows after switching tabs',
     after.arrows === 0, `${after.arrows} arrows`);
  ok('and the order is untouched',
     JSON.stringify(after.order) === JSON.stringify(season.order));

  /* THE SAME BUG ONE LEVEL DOWN, found by reading a screenshot rather
     than the code: ranked 7th in week 3 and 9th in week 2, hopping
     between the two weeks drew a DOWN arrow. Two different tables
     compared as one. Nobody moved — they were never in the same race.
     The week history is keyed by WEEK, not just by view. */
  await page.click('[data-stand="week"]').catch(() => {});
  await page.waitForTimeout(500);
  await page.click('.wk[data-wk="2"]').catch(() => {});
  await page.waitForTimeout(800);
  await page.click('.wk[data-wk="1"]').catch(() => {});
  await page.waitForTimeout(900);
  const hopped = await read();
  ok('and none after hopping between weeks either',
     hopped.arrows === 0, `${hopped.arrows} arrows`);
  ok('no errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n17. The app must not abandon a week the moment its last game starts');
{
  /* THE BUG: the opening week was "the first week still holding a game
     that has not kicked off", so the app left a week the INSTANT its
     last game started. Monday Night Football kicks at 8:15pm and from
     that second everyone was looking at next week's empty slate, with
     this week's standings still settling — and because next week has no
     results, the Standings tab fell back to Season too. The one night
     the whole pool is watching.

     A week now stays current while any game is unresolved AND still
     plausibly being played. The six-hour clamp is the safety: without
     it a single postponed game that never resolves would pin everybody
     on that week forever, in December, with no way out from inside the
     app. */
  const KICK = Date.parse('2026-09-10T00:20:00Z');       // stub's week-1 Thursday
  const MNF  = KICK + 4 * 864e5 + 15000000;              // its Monday-night game
  const at = async (nowMs) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
    await page.request.post(BASE + '/__plan',
      { data: { weeks: 3, gamesPerWeek: 16, playerCount: 10,
                startISO: new Date(KICK + (Date.now() - nowMs)).toISOString() } });
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const wk = await page.evaluate(() =>
      (document.querySelector('.wk.on') || {}).textContent.trim() || '?');
    await ctx.close();
    return wk;
  };

  ok('during Monday Night Football it stays on that week',
     (await at(MNF + 3600e3)) === '1', 'week ' + (await at(MNF + 3600e3)));
  ok('and moves on once the week has finished',
     (await at(MNF + 7 * 3600e3)) === '2');
  ok('before the season it opens on week 1',
     (await at(KICK - 6 * 3600e3)) === '1');

  /* The clamp itself, asserted as arithmetic rather than as a fixture —
     the stub finals its own games on a timer, so a genuinely stranded
     postponement cannot be staged through it. */
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const clamp = await page.evaluate(() => {
    const SIX = 6 * 3600e3, now = Date.now();
    const open = (isFinal, kickedAgo) => !isFinal && now < (now - kickedAgo) + SIX;
    return { live: open(false, 3600e3), mnf: open(false, 3 * 3600e3),
             postponed: open(false, 20 * 864e5), done: open(true, 3600e3) };
  });
  ok('a game in progress holds the week open', clamp.live && clamp.mnf);
  ok('a postponement 20 days stale does NOT strand the pool', !clamp.postponed);
  ok('and a finished game holds nothing open', !clamp.done);
  await ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n18. The alerts panel is five switches and nothing else');
{
  /* TWO CONTROLS HAVE NOW BEEN REMOVED FROM THIS PANEL, for related reasons.

     First there was an "All alerts" switch whose position was DERIVED from
     the five categories under it — on only when every one was on. Truthful,
     and it still felt broken: turning your last individual category back on
     made a control the player had not touched slide over by itself. A switch
     is a promise that it holds a setting of its own; that one never did. It
     also INVERTED (`next = !every(on)`), so one tap meant opposite things
     depending on state you could not read off the control.

     Then it became an All on / All off button pair. That fixed the movement
     but added a second row of controls competing with the five that matter,
     in a box and type size that matched nothing else on the screen.

     Both are gone. Every category starts ON, and the five switches are the
     only controls here. This case asserts the panel STAYS that way: the
     temptation to re-add a convenience control above the list is exactly
     what produced two rounds of this. */
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.request.post(BASE + '/__plan', { data: {} });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.click('.tab[data-tab="settings"]');
  await page.waitForTimeout(400);

  const states = () => page.evaluate(() =>
    [...document.querySelectorAll('#prefs [data-pref]')].map(b => b.classList.contains('on')));

  ok('the derived master switch is gone',
     await page.evaluate(() => !document.querySelector('#prefsAll')));
  ok('and so is the All on / All off pair',
     await page.evaluate(() => !document.querySelector('[data-bulk]')
                            && !document.querySelector('.pref-bulk')));

  /* A fresh player, no stored preferences: everything on. */
  const first = await states();
  ok('a new player gets all five alerts on', first.length === 5 && first.every(v => v === true),
     first.join(','));

  /* The alerts box must contain the five switches and NOTHING else that a
     player could press. A stray button here is how both removed controls
     got in. */
  const strays = await page.evaluate(() => {
    const box = document.querySelector('#prefs').closest('.opt');
    return [...box.querySelectorAll('button')].filter(b => !b.hasAttribute('data-pref')).length;
  });
  ok('no other pressable control shares the panel', strays === 0, `${strays} extra`);

  /* The regression that started all of this: tapping one switch must leave
     the other four exactly where they were. */
  await page.click('#prefs [data-pref]');
  await page.waitForTimeout(300);
  const after = await states();
  ok('tapping one category flips only that one',
     after[0] === false && after.slice(1).every(v => v === true), after.join(','));
  await page.click('#prefs [data-pref]');
  await page.waitForTimeout(300);
  ok('and tapping it back restores it, alone',
     (await states()).every(v => v === true));

  /* A stored object missing a key must not silently disable that alert —
     the failure mode when a sixth category is added later. */
  const merged = await page.evaluate(async () => {
    localStorage.setItem('ps_prefs', JSON.stringify({ open: false }));
    location.reload();
  }).catch(() => {});
  await page.waitForTimeout(1800);
  await page.click('.tab[data-tab="settings"]');
  await page.waitForTimeout(400);
  const restored = await states();
  ok('a stored preference file missing keys defaults them ON, not off',
     restored[0] === false && restored.slice(1).every(v => v === true), restored.join(','));

  ok('no errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n19. The sheets must not flash a cream panel over a dark app');
{
  /* Both bottom sheets were --paper cream on a --shell app. The unpicked-picks
     prompt is the worse of the two: it appears at the exact moment somebody is
     being told they still owe picks, which is not the moment to flash-bang
     them, and it read as a different product from the page behind it.

     Asserted as a LUMINANCE ceiling rather than an exact hex, so a future
     palette tweak is free but a return to a light panel is not. */
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  await page.request.post(BASE + '/__plan', { data: {} });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  const lum = await page.evaluate(() => {
    const rel = (css) => {
      const [r, g, b] = css.match(/\d+/g).slice(0, 3).map(Number).map(v => {
        v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
      });
      return .2126 * r + .7152 * g + .0722 * b;
    };
    const out = {};
    for (const id of ['sheet', 'fillSheet']) {
      const el = document.querySelector('#' + id);
      el.hidden = false;                       // measure without driving the UI
      out[id] = rel(getComputedStyle(el).backgroundColor);
      el.hidden = true;
    }
    out.body = rel(getComputedStyle(document.body).backgroundColor);
    return out;
  });

  ok('the rank picker is a dark surface', lum.sheet < 0.05, lum.sheet.toFixed(3));
  ok('the unpicked-picks prompt is too', lum.fillSheet < 0.05, lum.fillSheet.toFixed(3));
  ok('both sit close to the page behind them',
     Math.abs(lum.sheet - lum.body) < 0.04 && Math.abs(lum.fillSheet - lum.body) < 0.04);

  /* THE PAYOUT LABEL UNDER EACH RANK, measured rather than eyeballed.

     Moving the sheet to a dark ground quietly broke this. `.num small`
     carried opacity:.75 — harmless on the old cream panel — and it now
     stacked on a numeral colour ALREADY softened for the dark background.
     Two softenings multiply: "16 pts" landed at 4.35:1 and the team code on
     an already-spent rank at 2.03:1, less than half the floor, on the only
     record anywhere of which ranks are gone.

     Asserted against the real computed styles, opacity included, because
     the bug lived in the interaction between two rules that each looked
     perfectly reasonable on its own. */
  const contrast = await page.evaluate(() => {
    const lin = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; };
    const rel = ([r, g, b]) => .2126 * lin(r) + .7152 * lin(g) + .0722 * lin(b);
    /* Both alphas, and this mattered. An earlier version of this helper
       took only the first three numbers and threw the colour's OWN alpha
       away, so `rgba(250,247,241,.30)` was measured as solid cream. It
       reported 6.7:1 for a label actually sitting at 2.03:1 — the test
       passed while looking straight at the defect it was written for.
       The effective alpha is the colour's alpha times the element's. */
    const parse = css => css.match(/[\d.]+/g).slice(0, 3).map(Number);
    const alphaOf = css => { const n = css.match(/[\d.]+/g); return n.length > 3 ? Number(n[3]) : 1; };
    const over = (fg, bg, a) => fg.map((f, i) => f * a + bg[i] * (1 - a));
    const ratio = (a, b) => { const [x, y] = [rel(a), rel(b)].sort((m, n) => n - m);
                              return (x + .05) / (y + .05); };

    const sheet = document.querySelector('#sheet');
    sheet.hidden = false;
    const bg = parse(getComputedStyle(sheet).backgroundColor);

    // one available rank and one already spent, styled exactly as shipped
    const mk = (dis) => {
      const b = document.createElement('button');
      b.className = 'num'; if (dis) b.disabled = true;
      b.innerHTML = '1<small>16 pts</small>';
      document.querySelector('#numgrid').appendChild(b);
      const s = getComputedStyle(b.querySelector('small'));
      const c = parse(s.color), a = alphaOf(s.color) * parseFloat(s.opacity);
      const px = parseFloat(s.fontSize);
      b.remove();
      return { ratio: ratio(over(c, bg, a), bg), px };
    };
    const open = mk(false), used = mk(true);
    sheet.hidden = true;
    return { open, used };
  });

  ok('the payout label clears 4.5:1 on the dark sheet',
     contrast.open.ratio >= 4.5, contrast.open.ratio.toFixed(2) + ':1');
  ok('and so does the team code on a rank already spent',
     contrast.used.ratio >= 4.5, contrast.used.ratio.toFixed(2) + ':1');
  ok('neither is smaller than 8px', contrast.open.px >= 8 && contrast.used.px >= 8,
     `${contrast.open.px}px / ${contrast.used.px}px`);

  /* THE TWO MESSAGES IN THE UNPICKED-PICKS SHEET ARE ONE PAIR.

     They drifted apart in three ways at once, and not one of them was
     visible in the CSS, because the two rules sat forty lines apart and
     each was perfectly reasonable on its own:

       text left edge   14px vs 26px   the note's own padding pushed its
                                       text in while the message above
                                       started at the sheet's edge
       line-height      1.45 vs 1.5    16.675px against 17.25px
       heading size     11px vs 11.5px a third size in a two-size block

     The font-size property matched throughout, which is why "same font
     size" was true and the blocks still did not look like a pair. This
     asserts the rendered geometry, not the declarations. */
  const pair = await page.evaluate(() => {
    const sh = document.querySelector('#fillSheet'); sh.hidden = false;
    const sub = document.querySelector('#fillSub'), note = document.querySelector('#fillNote');
    sub.textContent = 'a';
    note.innerHTML = '<b>Heading</b>b';
    const probe = el => { const s = document.createElement('span'); s.textContent = 'I';
      el.insertBefore(s, el.firstChild);
      const x = +s.getBoundingClientRect().left.toFixed(1); s.remove(); return x; };
    const g = el => { const s = getComputedStyle(el), r = el.getBoundingClientRect();
      return { font: s.fontSize, lh: s.lineHeight,
               left: +r.left.toFixed(1), width: +r.width.toFixed(1) }; };
    const out = { sub: g(sub), note: g(note) };
    out.sub.textLeft = probe(sub); out.note.textLeft = probe(note);

    /* EVERY HEADING IN THIS SHEET IS ONE TYPE STYLE.
       They shared a font FAMILY and differed on five other properties —
       size, weight, case, tracking and left edge — which is exactly how
       two headings in the same family end up looking like two typefaces.
       Family alone is not the assertion; all six are. */
    const type = el => { const s = getComputedStyle(el);
      const sp = document.createElement('span'); sp.textContent = 'I';
      el.insertBefore(sp, el.firstChild);
      const left = +sp.getBoundingClientRect().left.toFixed(1); sp.remove();
      return { family: s.fontFamily.split(',')[0].trim(), size: s.fontSize,
               weight: s.fontWeight, case: s.textTransform,
               track: s.letterSpacing, left }; };
    sub.innerHTML = '<b>Heading one</b>a';
    out.heads = {
      title: type(document.querySelector('#fillTitle')),
      subHead: type(sub.querySelector('b')),
      noteHead: type(note.querySelector('b')),
    };
    // the action below them must share the same edges
    out.button = g(document.querySelector('#fillAuto'));
    out.titleAlign = getComputedStyle(document.querySelector('#fillTitle')).textAlign;
    out.buttonColour = getComputedStyle(document.querySelector('#fillAuto')).backgroundColor;
    out.headColours = [document.querySelector('#fillTitle'),
                       sub.querySelector('b'), note.querySelector('b')]
                      .map(e => getComputedStyle(e).color);
    sh.hidden = true; return out;
  });

  ok('both messages start their text on the same left edge',
     pair.sub.textLeft === pair.note.textLeft,
     `${pair.sub.textLeft} vs ${pair.note.textLeft}`);
  ok('both are the same width', pair.sub.width === pair.note.width,
     `${pair.sub.width} vs ${pair.note.width}`);
  ok('both run on the same line rhythm', pair.sub.lh === pair.note.lh,
     `${pair.sub.lh} vs ${pair.note.lh}`);
  ok('both are the same type size', pair.sub.font === pair.note.font,
     `${pair.sub.font} vs ${pair.note.font}`);
  /* TYPE STYLE is asserted for all three headings; LEFT EDGE only for the two
     inside the panels. The title is deliberately centred — it names the whole
     dialog rather than a section of it — so its left edge is a function of the
     text length and asserting it would be asserting the copy. Everything else
     about it still has to match. */
  const H = pair.heads, props = ['family','size','weight','case','track'];
  const differs = (a, b) => props.filter(k => a[k] !== b[k]);
  const d1 = differs(H.title, H.noteHead), d2 = differs(H.title, H.subHead);
  ok('the sheet title and the box heading are the same type style',
     d1.length === 0,
     d1.map(k => `${k}: ${H.title[k]} vs ${H.noteHead[k]}`).join('; '));
  ok('and so is the heading on the other box',
     d2.length === 0,
     d2.map(k => `${k}: ${H.title[k]} vs ${H.subHead[k]}`).join('; '));
  ok('the panel headings begin on the same left edge as the body under them',
     H.subHead.left === pair.sub.textLeft && H.noteHead.left === pair.note.textLeft,
     `${H.subHead.left} / ${H.noteHead.left} vs body ${pair.sub.textLeft}`);
  ok('and the title is centred, not left-aligned with them',
     pair.titleAlign === 'center', pair.titleAlign);

  /* RED MEANS TAPPABLE, AND ONLY TAPPABLE.
     Red is the app's one action colour: the button here, the CONF badge, the
     rank borders. Painting a heading in it would put the button's colour on
     text that does nothing, on the one screen whose whole job is getting the
     button pressed. Asserted as "the headings are not the button's colour"
     rather than a specific hex, so the palette can move. */
  ok('no heading wears the action colour',
     pair.headColours.every(c => c !== pair.buttonColour),
     `${pair.headColours.join(' / ')} vs button ${pair.buttonColour}`);
  ok('and the button below lines up with both',
     pair.button.left === pair.sub.left && pair.button.width === pair.sub.width,
     `${pair.button.left}/${pair.button.width} vs ${pair.sub.left}/${pair.sub.width}`);
  await ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n20. Help must say what was actually agreed');
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  await page.request.post(BASE + '/__plan', { data: {} });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.click('.tab[data-tab="help"]');
  await page.waitForTimeout(350);
  const txt = await page.evaluate(() => document.querySelector('#v-help').innerText);

  for (const s of ['select your team', 'pays 16 points', 'pays 1 point',
                   'Monday Night Football', 'grid view then opens'])
    ok(`Help says "${s}"`, txt.includes(s));

  /* Every payout figure carries its unit. "pays 16" on its own was the
     complaint: a bare number next to a rank that is also a number. */
  /* \b after \d+ is load-bearing. Without it the engine backtracks: on
     "pays 16 points" the greedy \d+ takes "16", the lookahead sees " points"
     and rejects, so it retries with "1", the lookahead then sees "6" instead
     of " point" and HAPPILY MATCHES — reporting a bare payout inside a string
     that spells the unit out. The word boundary refuses the short match. */
  const bare = (txt.match(/pays \d+\b(?! ?points?\b)/gi) || []);
  ok('no payout is left as a bare number', bare.length === 0, bare.join(' / '));

  /* The em dash sweep. Placeholder dashes (an empty countdown, an unscored
     cell) are a different thing and are left alone; this asserts the prose. */
  ok('no em dashes in the Help prose', !txt.includes('—'));
  await ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n21. A brand-new player must land in a WORKING app, not an empty shell');
{
  /* THE BUG, and it hit every single person invited to the pool.

     boot() loads the season inside watchAuth. For somebody who has never
     joined, that callback fires the instant signInWithToken() resolves —
     several lines BEFORE the PIN screen's own go() reaches joinPool() —
     so ensureCurrentPool() honestly answers "no pool", boot bails to
     showOnboarding(false), and loadSeason() never runs.

     Nothing ever ran it afterwards. Joining a pool is not an auth event,
     so watchAuth did not fire again, and obAdvance's last step only did
     `$('#ob').classList.add('hide')`. The player finished onboarding and
     was dropped onto the app with WEEKS empty. render() early-returns on
     an empty WEEKS, so what they saw was the raw static markup: the "16
     left" hardcoded in the tray, "Week 1" hardcoded in the Grid heading,
     no week strip, no games, no error, no spinner. It looked stuck
     because it was stuck.

     Invisible to everyone testing it, because it only happens on the ONE
     launch where you are not yet a member. Every reload afterwards finds
     the pool and works. */
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.request.post(BASE + '/__plan', { data: { newUser: true, signedOut: true } });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });

  // Walk the onboarding the way a real invitee does.
  await page.waitForSelector('#obNameIn', { timeout: 15000 });
  await page.fill('#obNameIn', 'New Player');
  await page.fill('#obMailIn', 'new@example.com');
  await page.click('#obGo');
  await page.waitForSelector('#pin0', { timeout: 15000 });
  for (let i = 0; i < 6; i++) await page.fill('#pin' + i, '123456'[i]);
  await page.waitForTimeout(1200);

  // Then click through whatever screens remain, exactly as they would.
  for (let i = 0; i < 8; i++) {
    const done = await page.evaluate(() =>
      document.querySelector('#ob')?.classList.contains('hide'));
    if (done) break;
    const btn = await page.$('#obNext, #obSkip, .ob-btn');
    if (!btn) break;
    await btn.click().catch(() => {});
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(2500);

  const state = await page.evaluate(() => ({
    obHidden: document.querySelector('#ob')?.classList.contains('hide'),
    weeks:    document.querySelectorAll('#weeks .wk').length,
    games:    document.querySelectorAll('#slate .card').length,
    slateText:(document.querySelector('#slate')?.innerText || '').trim().length,
    bootShown:!document.querySelector('#boot')?.classList.contains('hide'),
  }));

  ok('the onboarding actually finishes', state.obHidden === true, JSON.stringify(state));
  ok('the week strip is populated, not blank',
     state.weeks > 0, `${state.weeks} week buttons`);
  ok('and the slate has real games in it',
     state.games > 0 || state.slateText > 0, JSON.stringify(state));
  ok('no errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n22. A slow pool join must not freeze the wizard (this takes ~20s)');
{
  /* A player typed the code and then watched a dead button for about
     thirty seconds, tapping it repeatedly. The button was behaving
     correctly — it disables while a step is in flight — but the join it
     was waiting on had stalled, and an unbounded await on the first
     Firestore call of a session is indistinguishable from a crash.

     The sign-in is already complete by that point; only the membership
     write is outstanding. So the wait is bounded, and startApp() finishes
     the job at the end of the wizard via ensureJoined(). This asserts the
     player still lands in a loaded app when the join overruns. */
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.request.post(BASE + '/__plan',
    { data: { newUser: true, signedOut: true, slowJoinMs: 60000 } });
  /* Sixty seconds, deliberately longer than anything this test will wait
     for. An earlier draft used 16s — just under the test's own 18s of
     patience — so the join completed on its own and the case passed with
     the bound removed. A stall the test can outlast is not a stall. */
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });

  await page.waitForSelector('#obNameIn', { timeout: 15000 });
  await page.fill('#obNameIn', 'Slow Join');
  await page.fill('#obMailIn', 'slow@example.com');
  await page.click('#obGo');
  await page.waitForSelector('#pin0', { timeout: 15000 });
  for (let i = 0; i < 6; i++) await page.fill('#pin' + i, '123456'[i]);

  // The reassurance must appear rather than a motionless button.
  /* 3.5s: after the 2.5s slow label appears, before the 5s bound releases
     the wizard. An earlier version looked at 7s and caught the NEXT
     screen's button instead, reporting "Keep me honest". */
  await page.waitForTimeout(4000);
  const midLabel = await page.evaluate(() =>
    (document.querySelector('#obGo')?.textContent || '').trim());
  /* "Loading season schedule" was the only acceptable answer here until the
     button learned to say "Building your season" the moment the SERVER
     accepts the code — which in this case is before 2.5s, so the more
     specific label wins and the generic slow label is deliberately
     suppressed. Both satisfy the actual requirement, which is that the
     button names the work rather than sitting mute; neither of them is
     "Let me in" and neither is blank. */
  ok('the button names what is actually slow, instead of sitting mute',
     /loading season schedule|building your season/i.test(midLabel), midLabel);

  /* THE ASSERTION THAT MATTERS, and it has to come BEFORE any clicking.

     An earlier draft went straight to clicking through the remaining
     screens — and the PIN step has a Skip button, so the loop hopped over
     the stalled step and the case passed with the bound removed. The
     question is whether the wizard moves on BY ITSELF once the bound
     expires, so ask it while touching nothing: is the PIN screen gone? */
  /* ~11s in against a 7s bound. Deliberately not 7.5s: a half-second of
     margin either side of the thing being measured is a coin toss, and
     this file already has one lesson about that. */
  await page.waitForTimeout(7000);
  const movedOn = await page.evaluate(() => !document.querySelector('#pin0'));
  ok('the wizard leaves the PIN screen on its own once the join overruns',
     movedOn === true, 'still on the keypad');

  for (let i = 0; i < 8; i++) {
    const done = await page.evaluate(() =>
      document.querySelector('#ob')?.classList.contains('hide'));
    if (done) break;
    const btn = await page.$('#obNext, #obSkip, .ob-btn');
    if (!btn) break;
    await btn.click().catch(() => {});
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(3000);

  const st = await page.evaluate(() => ({
    obHidden: document.querySelector('#ob')?.classList.contains('hide'),
    weeks:    document.querySelectorAll('#weeks .wk').length,
    covered:  !document.querySelector('#boot')?.classList.contains('hide'),
  }));
  ok('the wizard still finishes', st.obHidden === true, JSON.stringify(st));
  /* With the join still stalled the season genuinely cannot be loaded yet,
     and pretending otherwise would be the wrong assertion. What must NEVER
     happen is the player being dropped onto the bare static markup — the
     "16 left, no games, no explanation" screen. Either the app is up, or a
     loading cover is. */
  ok('and the player is never left on a bare empty shell',
     st.weeks > 0 || st.covered === true, JSON.stringify(st));
  ok('no errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n23. The app must load WHILE the wizard is being read, not after it');
{
  /* A first-ever sign-in took over a minute of staring at "Getting your
     week…", and almost all of it was avoidable. Everything after the PIN
     screen — install, alerts, the six rules — is the player READING.
     Twenty seconds or more during which the app did absolutely nothing,
     and only when they tapped the last button did it start opening a cold
     Firestore connection and pulling the season, the roster, the standings
     and the week's picks.

     The load now starts the moment the join succeeds. This asserts it: the
     schedule read must already have happened BEFORE the wizard is
     finished, and the wait after the final tap must be short even when
     every read is slow. */
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.request.post(BASE + '/__plan', { data: {
    newUser: true, signedOut: true,
    // Every read deliberately slow, so a serial load would be unmistakable.
    delay: { getAllWeeks: 5000, getMembers: 1200, getStandings: 1200,
             myPicks: 1200, getRevealed: 1200 } } });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });

  await page.waitForSelector('#obNameIn', { timeout: 15000 });
  await page.fill('#obNameIn', 'Reader');
  await page.fill('#obMailIn', 'reader@example.com');
  await page.click('#obGo');
  await page.waitForSelector('#pin0', { timeout: 15000 });
  for (let i = 0; i < 6; i++) await page.fill('#pin' + i, '123456'[i]);

  // Somebody reading the next screens. Nothing is clicked in this window.
  await page.waitForTimeout(9000);

  const startedEarly = await page.evaluate(() =>
    (window.__ps?.log || []).includes('getAllWeeks'));
  ok('the season is already being fetched while the wizard is still open',
     startedEarly === true, 'getAllWeeks not called yet');

  const stillOpen = await page.evaluate(() =>
    !document.querySelector('#ob')?.classList.contains('hide'));
  ok('and the wizard was not closed out from under them',
     stillOpen === true);

  // Now finish the wizard and time what is left.
  const t0 = Date.now();
  for (let i = 0; i < 8; i++) {
    const done = await page.evaluate(() =>
      document.querySelector('#ob')?.classList.contains('hide'));
    if (done) break;
    const btn = await page.$('#obNext, #obSkip, .ob-btn');
    if (!btn) break;
    await btn.click().catch(() => {});
    await page.waitForTimeout(400);
  }
  await page.waitForFunction(() =>
    document.querySelectorAll('#weeks .wk').length > 0, { timeout: 20000 });
  const tail = Date.now() - t0;

  /* Generous, because the clicking loop itself spends time. The point is
     that it is nowhere near the ~5.7s of reads the plan above configures —
     those were paid while the player was reading. */
  /* The plan above configures roughly ten seconds of reads. Without the
     preload the tail carries all of it; with it, the tail is only the
     clicking loop. A wide gap on purpose — an earlier draft used 2.5s
     reads and the two cases came out 4646ms and just under the 4500ms
     threshold, which is a coin toss, not a test. */
  ok('and the wait after the last tap is short, not the whole load',
     tail < 4500, tail + 'ms after the final screen');
  ok('no errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n24. The alert preview must not contradict the alerts it previews');
{
  /* The onboarding screen that shows "every alert we will ever send you"
     said "First kickoff Sunday 1:00 PM". Nearly every NFL week opens on
     Thursday night, week 1 included, so that was wrong almost every week
     of the season.

     The alerts themselves were never affected — worker/live.js groups by
     kickoff SLOT and formats the real timestamp in each player's own
     timezone — but a preview that contradicts the real thing teaches
     people to expect the wrong day and then to distrust the alert that
     arrives. Static check on purpose: it compares the two files, so it
     fails if either the preview or compose() drifts from the other. */
  const fs = await import('node:fs');
  const app  = fs.readFileSync('/root/work/pickem/index.html', 'utf8');
  const live = fs.readFileSync('/root/work/pickem/worker/live.js', 'utf8');

  const preview = (app.match(/\$\{nt\((.|\n)*?\)\}/g) || []).join(' ');
  ok('the preview exists to check', preview.length > 0);
  ok('it no longer claims the week opens on Sunday',
     !/First kickoff Sunday/i.test(preview), preview.slice(0, 120));
  ok('it names a Thursday opener, like the real schedule',
     /Thu,/.test(preview));

  /* Shape check against the sender: compose() writes "First kickoff ${w}
     your time." — the preview must use the same sentence, or it is
     previewing something the app does not send. */
  ok('compose() still phrases it the way the preview does',
     /First kickoff \$\{w\} your time\./.test(live));
  ok('and the preview matches that phrasing',
     /First kickoff [^.]+ your time\./.test(preview), preview.slice(0, 200));
  ok('the last-call wording matches too',
     /Kickoff in \$\{mins\} minutes\. Unpicked games score zero\./.test(live) &&
     /Kickoff in 30 minutes\. Unpicked games score zero\./.test(preview));
}

/* ------------------------------------------------------------------ */
console.log('\n25. One slow document read must not hold the whole launch (~10s)');
{
  /* MEASURED, not guessed. On a real first launch the ONE-document pool
     read took 25-30 seconds while the 272-document schedule read running
     beside it finished in three. Timed from the last PIN digit to a usable
     app that was 1:38, then 0:40 once the schedule was overlapped — and
     almost all of what remained was this single read, with the whole app
     sitting behind it doing nothing.

     WHY that read is slow is still not known. Three explanations have been
     wrong so far, so this case deliberately encodes no cause; it asserts
     the property that makes the cause survivable. The pool document
     decides two things: whether the stored pool still exists, and who owns
     it. The id is only ever written to localStorage after a successful
     join, and ownership is cosmetic — neither is worth a thirty-second
     stare at a loading cover, and every read after it is still checked by
     firestore.rules on the server exactly as before.

     Mutation-tested: with the Promise.race removed, `weeks` is 0 and the
     cover is still up when this asserts. */
  const { ctx, page, errors } = await open({ delay: { ensureCurrentPool: 25000 } });

  /* Comfortably past the 3.5s bound and comfortably short of the 25s
     stall — the gap is deliberate. A threshold within a second of the
     thing it measures is a coin toss, and this file has been bitten by
     that twice already. */
  await page.waitForTimeout(9000);

  const st = await page.evaluate(() => ({
    weeks:   document.querySelectorAll('#weeks .wk').length,
    covered: !document.querySelector('#boot')?.classList.contains('hide'),
    issued:  (window.__ps?.log || []).includes('ensureCurrentPool'),
  }));
  /* The read must actually have been issued, or the delay never applied
     and the rest of this case proves nothing. */
  ok('the slow pool read really was issued', st.issued === true, JSON.stringify(st));
  ok('the app is loaded while it is still outstanding',
     st.weeks > 0, JSON.stringify(st));
  ok('and the loading cover is gone', st.covered === false, JSON.stringify(st));

  /* The numbers have to reach the player, because the next report of a
     slow launch should name the read rather than describe a feeling. */
  const diag = await page.evaluate(() =>
    document.querySelector('#diagLine')?.textContent || '');
  ok('Settings reports a per-read breakdown', /Reads:/.test(diag), diag.slice(0, 160));
  ok('and it names the reads individually', /schedule/.test(diag), diag.slice(0, 160));

  ok('no errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n26. Standings must not hold up the screen nobody is looking at (~15s)');
{
  /* STRAIGHT OFF A REAL LAUNCH. The per-read line said:

       schedule 0.5s, roster 0.5s, season 30.6s, week 1s

     `season` was loadSeason, and its Promise.all had three legs. Two of
     them are in that list at half a second each. The missing 30 seconds
     was the third — getStandings — and the whole first paint was behind
     it, on a tab the player has not tapped and may never tap that
     session. The app opens on Picks, which needs the schedule and the
     roster and nothing else.

     So standings is started and NOT awaited, and it repaints when it
     lands. This asserts both halves: the app is up while it is still in
     flight, and the numbers are on screen afterwards rather than dropped
     on the floor — a fire-and-forget that forgets is a worse bug than the
     wait it replaced.

     Mutation-tested. Putting getStandings back in the Promise.all fails
     the first assertion, as it should.

     WHAT THE LAST ASSERTION DOES NOT PIN, said plainly rather than left
     for someone to discover: deleting the explicit render() in the .then
     does NOT fail it, because tick() repaints on its own interval and gets
     there within a second or two anyway. So this checks that the data
     ARRIVES AND IS DISPLAYED, which is the thing that matters and the
     thing that breaks if the read is dropped or its result discarded. It
     does not check which code path painted it. The explicit render stays
     because "within a tick" is not the same as "now" when somebody is
     already sitting on the Standings tab — but it is belt-and-braces, and
     a test named after it would be a green tick that means nothing. */
  /* The season has to have started, or the board is legitimately empty and
     the last assertion could never distinguish "repainted" from "never
     arrived". Same reason case 1 backdates it. */
  const { ctx, page, errors } = await open({
    startISO: new Date(Date.now() - 40 * 864e5).toISOString(),
    delay: { getStandings: 15000 } });

  const early = await page.evaluate(() => ({
    weeks:   document.querySelectorAll('#weeks .wk').length,
    covered: !document.querySelector('#boot')?.classList.contains('hide'),
  }));
  ok('the app is up while standings is still outstanding',
     early.weeks > 0, JSON.stringify(early));
  ok('and nothing is covering it', early.covered === false, JSON.stringify(early));

  /* Opened DURING the gap on purpose. An empty board is the honest answer
     while the read is in flight; what must not happen is a crash, or a
     board that stays empty forever once the data has arrived. */
  await page.click('[data-tab="standings"]').catch(() => {});
  await page.waitForTimeout(400);
  const during = await page.evaluate(() =>
    (document.querySelector('#standings, #board, main')?.textContent || '').length);
  ok('the Standings tab renders rather than throwing', during > 0, String(during));

  // Past the 15s delay, with margin. The repaint has to happen by itself.
  await page.waitForTimeout(17000);
  const after = await page.evaluate(() => ({
    issued: window.__ps?.calls('getStandings') || 0,
    rows:   document.querySelectorAll('#board .row').length,
  }));
  ok('standings really was fetched', after.issued >= 1, JSON.stringify(after));
  ok('and the numbers are on screen once the read lands',
     after.rows > 0, JSON.stringify(after));
  ok('no errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n27. A full progress bar must mean done, never "still working" (~12s)');
{
  /* A player typed the code and then tapped the red button over and over
     for thirty seconds. The button was behaving correctly — it disables
     while a step is in flight — but a big filled red button is the
     strongest "tap me" signal in the app, and it kept that fill while
     doing the one thing that makes tapping useless.

     It now fills instead of pulsing: dark surface, red sweeping across it.
     The whole honesty of that rests on ONE property, which is what this
     case exists to defend — the fill cannot reach 100% on a timer. It
     closes a fraction of the gap to an 88% ceiling each tick, so it always
     moves and never arrives, and only the real work takes it to full.

     A bar that hits 100% while the app is still working is the clearest
     possible way to tell somebody it has hung, and it is the exact bug a
     future "make the animation smoother" edit would introduce. So: hold a
     slow join open and watch the width. It must grow, and it must stay
     short of full for as long as the work is outstanding.

     Mutation-tested: change the ceiling to 100 and the third assertion
     fails at 8 seconds. */
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  // 60s, so nothing this case waits for can outlast it — see case 22.
  await page.request.post(BASE + '/__plan',
    { data: { newUser: true, signedOut: true, slowJoinMs: 60000 } });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });

  await page.waitForSelector('#obNameIn', { timeout: 15000 });
  await page.fill('#obNameIn', 'Filler');
  await page.fill('#obMailIn', 'fill@example.com');
  await page.click('#obGo');
  await page.waitForSelector('#pin0', { timeout: 15000 });
  for (let i = 0; i < 6; i++) await page.fill('#pin' + i, '123456'[i]);

  const width = () => page.evaluate(() => {
    const i = document.querySelector('#obGo.fill i');
    if (!i) return null;
    return (parseFloat(i.style.width) || 0);
  });

  await page.waitForTimeout(1200);
  const early = await width();
  ok('the button became a progress bar', early !== null, String(early));
  ok('and it has already started moving', early > 0, String(early));

  await page.waitForTimeout(2000);
  const mid = await width();
  ok('it keeps advancing while the work is outstanding',
     mid > early, `${early} -> ${mid}`);

  /* THE ONE THAT MATTERS, at ~5.5s — inside the step's own seven-second
     bound, after which the wizard moves on by itself and this button no
     longer exists. An earlier draft looked at 8.2s and read null.

     The threshold is 92, not 99, and that is deliberate. "Not yet 100"
     is satisfied by any bar that is merely slow, including one that will
     hit 100 a second later while the app is still working — which is the
     failure being defended against. What has to be true is that a CEILING
     exists below full. Raising the ceiling from 88 to 100 puts this at
     ~95 by 5.5s, so this number is what kills that mutation; 99 would
     have let it through. */
  await page.waitForTimeout(2300);
  const late = await width();
  ok('but it never reaches the end on its own',
     late !== null && late < 92, String(late));
  ok('while still visibly creeping rather than parked',
     late > mid, `${mid} -> ${late}`);

  /* And the code being accepted has to be said, in the affirmative,
     where the eye already is. */
  const accepted = await page.evaluate(() => {
    const a = document.getElementById('obAccept');
    return { shown: a ? !a.classList.contains('hide') : false,
             text:  a ? a.textContent.replace(/\s+/g, ' ').trim() : '' };
  });
  ok('the code-accepted panel is showing', accepted.shown === true);
  ok('and it promises the wait is a one-off',
     /only happens once/i.test(accepted.text), accepted.text.slice(0, 120));

  ok('no errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n28. The diagnostic must not invent a stall out of reading time (~14s)');
{
  /* A DIAGNOSTIC THAT LIES IS WORSE THAN NO DIAGNOSTIC, because somebody
     acts on it. This one did.

     A real launch reported `Opening your pool 31.9s` on the same line as
     `pool 0s, pool 0s, pool 0.7s`. Every read was fast; the 31.9 seconds
     was the player reading the alerts screen and the six rules. startApp
     runs up to three times on a first sign-in, and bootSay re-stamped the
     previous mark with a start time from the FIRST attempt, so the mark
     swallowed the gap between attempts.

     That number had already been used to chase a phantom. This asserts the
     property that stops it: no single stage may claim more time than the
     player was actually held up for, and the slow read must be the one the
     numbers accuse.

     THE GAP HAS TO FALL BETWEEN TWO ATTEMPTS, which is the whole subtlety.
     A first draft simply paused eight seconds on the wizard, and the bug
     survived it untouched: by then both bailing attempts had already
     happened, milliseconds apart, so there was no gap for a mark to
     swallow. A slow join is what actually separates them — the auth
     callback's attempt finds no pool, and the attempt that succeeds cannot
     run until the join returns. Eight seconds of stall, seven of which the
     wizard waits out, is the same shape as a person reading.

     Mutation-tested: remove `bootStageAt=0` from bootMark and the second
     assertion fails with a stage of ~7s against reads totalling under 2. */
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.request.post(BASE + '/__plan',
    { data: { newUser: true, signedOut: true, slowJoinMs: 8000,
              delay: { getAllWeeks: 1500 } } });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });

  await page.waitForSelector('#obNameIn', { timeout: 15000 });
  await page.fill('#obNameIn', 'Slow Reader');
  await page.fill('#obMailIn', 'reader2@example.com');
  await page.click('#obGo');
  await page.waitForSelector('#pin0', { timeout: 15000 });
  for (let i = 0; i < 6; i++) await page.fill('#pin' + i, '123456'[i]);

  // THE GAP. Nine seconds of nobody touching anything while the join is
  // stalled — the time the old code filed under "Opening your pool".
  await page.waitForTimeout(9000);

  for (let i = 0; i < 8; i++) {
    const done = await page.evaluate(() =>
      document.querySelector('#ob')?.classList.contains('hide'));
    if (done) break;
    const btn = await page.$('#obNext, #obSkip, .ob-btn');
    if (!btn) break;
    await btn.click().catch(() => {});
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(2500);

  const t = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('ps_boot_timings') || 'null'); }
    catch (_) { return null; }
  });
  ok('timings were recorded at all', !!(t && t.steps && t.steps.length));

  const worstStage = Math.max(...(t?.steps || [{ ms: 0 }]).map(s => s.ms || 0));
  const readTotal  = (t?.calls || []).reduce((a, c) => a + (c.ms || 0), 0);

  /* No stage may exceed everything the network did, plus a second of
     slack for rendering. The eight-second read pause sits far outside
     that, so a stage that swallowed it cannot pass. */
  ok('no stage claims more time than the reads it contains',
     worstStage <= readTotal + 1000,
     `worst stage ${worstStage}ms vs reads ${readTotal}ms`);

  /* And the instrument still has to be USEFUL: the deliberately slow read
     must be the biggest one on the list, or it is honest and useless. */
  const slowest = (t?.calls || []).slice().sort((a, b) => (b.ms || 0) - (a.ms || 0))[0];
  ok('and the slow read is correctly named as the slow one',
     slowest && slowest.k === 'schedule', JSON.stringify(slowest));

  /* Repeated attempts must not read as repeated faults. */
  const line = await page.evaluate(() =>
    document.querySelector('#diagLine')?.textContent || '');
  const opens = (line.match(/Opening your pool/g) || []).length;
  ok('the Settings line names each stage once, not once per retry',
     opens <= 1, line.slice(0, 160));

  ok('no errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n29. The load diagnostic must be invisible until it is asked for');
{
  /* It was on the Settings screen for everyone while the launch stalls
     were being chased, and it earned that — the per-read line is what
     identified the transport problem after three wrong theories. But it
     speaks in the app's own vocabulary, and a number nobody asked for
     invites a complaint: "38.9s total" in front of a player who was
     perfectly happy teaches them to notice load time and compare it.

     It stays on every device rather than being owner-only, because the
     person who HAS a slow launch is a player — owner-only would put the
     instrument on the one phone that never needs it. Five taps on the
     wordmark, the Android build-number idiom, for the same reason: nobody
     hits it by accident and it can be described over the phone in one
     sentence.

     Two things must both hold, and the second is the one that rots. A
     hidden feature nobody can reach is the same as a deleted one, and
     nothing else in the app would fail if the gesture quietly stopped
     working. */
  const { ctx, page, errors } = await open({});
  await page.click('[data-tab="settings"]').catch(() => {});
  await page.waitForTimeout(400);

  const hidden = await page.evaluate(() =>
    document.getElementById('diagBox')?.classList.contains('hide'));
  ok('it is not on the Settings screen by default', hidden === true);

  /* Four taps must NOT do it — otherwise "five" is decoration and a player
     scrolling with a clumsy thumb finds it. */
  const brand = await page.$('.topbar .brand');
  ok('the wordmark is there to tap', !!brand);
  for (let i = 0; i < 4; i++) { await brand.click(); await page.waitForTimeout(90); }
  const stillHidden = await page.evaluate(() =>
    document.getElementById('diagBox')?.classList.contains('hide'));
  ok('and four taps leave it hidden', stillHidden === true);

  await brand.click();
  await page.waitForTimeout(400);
  const shown = await page.evaluate(() => {
    const b = document.getElementById('diagBox');
    return { open: b ? !b.classList.contains('hide') : false,
             text: document.getElementById('diagLine')?.textContent || '' };
  });
  ok('the fifth tap reveals it', shown.open === true, JSON.stringify(shown.open));
  ok('and it carries the per-read breakdown', /Reads:/.test(shown.text),
     shown.text.slice(0, 140));

  /* Sticky, or a player asked for a screenshot has to redo a secret
     gesture while already annoyed. */
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.click('[data-tab="settings"]').catch(() => {});
  await page.waitForTimeout(400);
  const afterReload = await page.evaluate(() =>
    document.getElementById('diagBox')?.classList.contains('hide') === false);
  ok('and it stays revealed on that device across a reload',
     afterReload === true);

  ok('no errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n30. Changing your mind about one game must read correctly');
{
  /* FOUND BY DRIVING THE APP, not by reading it. A verification pass after
     an unrelated change tapped a selected team twice — clear, then re-pick,
     which is exactly what "I changed my mind" does — and the progress line
     read "1 games still need a rank".

     One is not an edge case here, it is the common case. Un-picking a game
     releases its rank, so a single change of mind is the usual way anybody
     arrives at this sentence, and it sits on the Picks tab mid-week where
     every player will meet it.

     The rest of the cycle is asserted alongside it, because this case had
     to prove the pick round trip still worked before the wording was worth
     arguing about: tapping a chosen team clears it, tapping again restores
     it, the rank stays outstanding until it is spent, and the write goes to
     the data layer rather than only to the screen. */
  const { ctx, page, errors } = await open({});
  const read = () => page.evaluate(() => ({
    tray:  document.querySelector('#trayCount')?.textContent || '',
    btn:   document.querySelector('#submitBtn')?.textContent || '',
    label: (document.querySelector('#plabel')?.textContent || '').trim(),
    dead:  document.querySelector('#submitBtn')?.disabled,
  }));

  const start = await read();
  ok('the stub sheet starts complete', /0 left/.test(start.tray), JSON.stringify(start));

  await page.click('#slate .card .side.l');
  await page.waitForTimeout(600);
  const cleared = await read();
  ok('tapping a chosen team clears that pick',
     /1 left/.test(cleared.tray) && /15 of 16/.test(cleared.label),
     JSON.stringify(cleared));
  ok('and the button offers to finish rather than to lock',
     /finish my picks/i.test(cleared.btn), cleared.btn);

  await page.click('#slate .card .side.l');
  await page.waitForTimeout(600);
  const back = await read();
  ok('tapping again re-picks the team',
     !/15 of 16/.test(back.label), JSON.stringify(back));
  /* The rank is NOT handed back automatically, and should not be: picking
     a winner and staking it are two decisions. So the rank stays
     outstanding and the line says so. */
  ok('the released rank is still outstanding', /1 left/.test(back.tray), back.tray);
  ok('and it says so in the singular',
     /1 game still needs a rank/.test(back.label), back.label);
  ok('the button is never dead in that state', back.dead === false);

  ok('every tap reached the data layer, not just the screen',
     (await page.evaluate(() => window.__ps?.calls('savePicks') || 0)) > 0);
  ok('no errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n31. An empty pool screen must still show that the pool exists');
{
  /* FROM THE FIRST REAL WEEK OF A LIVE POOL. People finished their picks,
     opened the app, and both the Grid and Standings correctly said there
     was nothing to show — and showed nothing else. No names, no count, no
     sign that anybody else had joined. They texted the owner asking
     whether they had done it right.

     Both empty states were behaving exactly as written, and both were
     right to withhold what they withheld: picks stay sealed until
     kickoff, and nobody leads a table where nothing has been scored. But
     WHO IS IN the pool was never the secret. Only what they picked is.

     The line this case defends is precisely that one. It asserts the
     roster appears, and it asserts the readiness information does NOT —
     because the tempting next step is a "ready" tick beside each name,
     and the app cannot know that without reading picks it is forbidden to
     read. A guessed tick is worse than no tick. */
  const { ctx, page, errors } = await open({
    members: ['Lee','Monse','Dad','Uncle Ray','Coach K','Sam','Priya','Marcus'],
    // Nothing kicked off yet: the state the complaint came from.
    startISO: new Date(Date.now() + 4 * 864e5).toISOString() });

  await page.click('[data-tab="grid"]').catch(() => {});
  await page.waitForTimeout(400);
  const g = await page.evaluate(() => {
    const el = document.getElementById('v-grid');
    return { chips: el.querySelectorAll('.rchip').length,
             mine:  el.querySelectorAll('.rchip.me').length,
             text:  el.innerText.replace(/\s+/g, ' ') };
  });
  ok('grid: the roster is named, not just counted', g.chips === 8, String(g.chips));
  ok('grid: it says how many are in', /8 in the pool/i.test(g.text));
  ok('grid: exactly one chip is marked as you', g.mine === 1, String(g.mine));

  /* Standings gets the fuller treatment: the field laid out as the rows it
     is about to become, so the tab does not spring into existence on
     Sunday. Everything that would RANK anybody has to stay off it. */
  await page.click('[data-tab="standings"]').catch(() => {});
  await page.waitForTimeout(400);
  const s = await page.evaluate(() => {
    const el = document.getElementById('v-standings');
    const rows = [...el.querySelectorAll('#board .row')];
    const nameColours = [...new Set(rows.map(r =>
      getComputedStyle(r.querySelector('.who b')).color))];
    return { rows: rows.length,
             mine: el.querySelectorAll('#board .row.me').length,
             lead: !!el.querySelector('.row.lead, .leadtag'),
             nameColours,
             text: el.innerText.replace(/\s+/g, ' ') };
  });
  ok('standings: every member has a row', s.rows === 8, String(s.rows));
  ok('standings: exactly one row is yours', s.mine === 1, String(s.mine));
  ok('standings: it says how many are in', /8 in the pool/i.test(s.text));
  /* NOBODY IS CROWNED. This is the rule the empty state existed to
     protect: with every player on zero the sort is arbitrary, so any
     leader styling would be gold-plating a coin toss. */
  ok('standings: nobody is rendered as the leader', s.lead === false);
  /* Checked on the rank and points CELLS, not on the page text. A first
     draft scanned innerText for a "1" and matched the words "Week 1",
     failing while the screen was perfectly correct. Ask the element that
     holds the fact. */
  const cells = await page.evaluate(() => ({
    ranks: [...document.querySelectorAll('#board .row .rank')].map(e => e.textContent.trim()),
    pts:   [...document.querySelectorAll('#board .row .pts b')].map(e => e.textContent.trim()),
  }));
  ok('standings: no row claims a position',
     cells.ranks.length === 8 && cells.ranks.every(t => !/\d/.test(t)),
     JSON.stringify(cells.ranks));
  /* A dash, not a zero. A column of zeroes reads as a score somebody
     earned; a dash reads as "not yet", which is the true statement. */
  ok('standings: points show a dash rather than a zero',
     cells.pts.length === 8 && cells.pts.every(t => !/\d/.test(t)),
     JSON.stringify(cells.pts));
  /* AND EVERY ROW LOOKS THE SAME. This caught a real defect: the class was
     first called `pre`, which collides with the gold PRESEASON badge's
     `.pre { color: var(--lock) !important }` — so all eight names rendered
     gold and the screen read as eight leaders. Nothing threw, and every
     structural assertion above still passed. Comparing the computed colour
     of every name is what catches a collision like that. */
  ok('standings: every name is painted the same colour',
     s.nameColours.length === 1, JSON.stringify(s.nameColours));
  ok('standings: and that colour is the normal ink, not the gold accent',
     /250, 247, 241/.test(s.nameColours[0] || ''), s.nameColours[0]);

  for (const [tab, v] of [['grid', g], ['standings', s]]) {
    /* THE GUARANTEE. Nothing on either screen may imply who has or has
       not finished — the app cannot know that, so it must not hint. */
    ok(`${tab}: claims nothing about who is ready`,
       !/\bready\b|finished|locked in|still picking|to go\b/i.test(v.text),
       v.text.slice(0, 160));
  }

  /* A pool of one must not announce itself. "1 in the pool" told the
     person who just created it something they already knew, in a lonely
     way, on the screen meant to reassure them. */
  await ctx.close();
  const solo = await open({ members: ['Lee'],
    startISO: new Date(Date.now() + 4 * 864e5).toISOString() });
  await solo.page.click('[data-tab="grid"]').catch(() => {});
  await solo.page.waitForTimeout(400);
  ok('a one-person pool shows no roster block at all',
     (await solo.page.evaluate(() => !!document.querySelector('.roster'))) === false);
  await solo.page.click('[data-tab="standings"]').catch(() => {});
  await solo.page.waitForTimeout(400);
  ok('and no field list either',
     (await solo.page.evaluate(() =>
        document.querySelectorAll('#board .row').length)) === 0);
  await solo.ctx.close();

  /* IT IS A LAUNCH-WEEK DEVICE AND IT MUST RETIRE ITSELF.

     `scored` is computed per VIEW, so the This Week tab is unscored every
     Tuesday of the season — and the first version of this therefore put a
     fresh list of dashes back on screen every week, on a tab with the real
     season table one press away. It read as though the app had forgotten
     the season had happened.

     The gate is now "has ANY game of the season ever gone final". This is
     the half that rots silently: week 1 will look right forever, and
     nobody re-checks week 6 in September. */
  const later = await open({
    members: ['Lee','Monse','Dad','Uncle Ray','Coach K','Sam','Priya','Marcus'],
    startISO: new Date(Date.now() - 40 * 864e5).toISOString() });
  await later.page.click('[data-tab="standings"]').catch(() => {});
  await later.page.waitForTimeout(400);
  const seasonTab = await later.page.evaluate(() => ({
    field: document.querySelectorAll('#board .row.rfield').length,
    real:  document.querySelectorAll('#board .row:not(.rfield)').length }));
  ok('weeks later: the season table is the real one, with everybody in it',
     seasonTab.field === 0 && seasonTab.real === 8, JSON.stringify(seasonTab));

  await later.page.evaluate(() =>
    document.querySelector('#standTabs [data-stand="week"]')?.click());
  await later.page.waitForTimeout(400);
  const weekTab = await later.page.evaluate(() =>
    document.querySelectorAll('#board .row.rfield').length);
  ok('and the field list never comes back on an unplayed later week',
     weekTab === 0, String(weekTab));
  ok('no errors in the later-week run', later.errors.length === 0, later.errors[0] || '');
  await later.ctx.close();
  ok('no errors', errors.length === 0 && solo.errors.length === 0,
     errors[0] || solo.errors[0] || '');
}

/* ------------------------------------------------------------------ */
console.log('\n32. A finished game must say it is submitted, on the card');
{
  /* STRAIGHT FROM PLAYERS IN A LIVE POOL. Several messaged the owner
     asking whether a game had been submitted, and whether the whole week
     had to go in before the first kickoff. Both worries are unfounded —
     every tap writes to Firestore immediately, and firestore.rules locks
     each game at its OWN kickoff — but nothing on the card said so.

     The row read "Your stake", which labels the number beside it and
     answers no question anyone was asking. The bottom bar does say "saved
     as you tap", but that is one line at the foot of a scrolling page,
     read once and never again; the question is asked ABOUT A GAME, every
     time the app is opened.

     Two properties, and they are in tension, which is why both are
     pinned: it has to say the pick is SAVED, and it must not thereby
     read as locked — the stake bar only exists before kickoff and really
     is still editable right up to it. */
  const { ctx, page, errors } = await open({});

  const bars = await page.evaluate(() => {
    const set = [...document.querySelectorAll('.stakebar:not(.empty) .sb-l')];
    return { n: set.length,
             labels: [...new Set(set.map(e => e.textContent.replace(/\s+/g, ' ').trim()))],
             okColour: (() => { const e = document.querySelector('.sb-ok');
               return e ? getComputedStyle(e).color : null; })(),
             /* A row that overflows its button silently truncates the very
                reassurance it exists to give. */
             clipped: [...document.querySelectorAll('.stakebar')]
                        .some(e => e.scrollWidth > e.clientWidth + 1) };
  });
  ok('there are staked games to check', bars.n > 0, String(bars.n));
  /* SUBMITTED, not SAVED. Every form anybody has filled in taught them
     that "saved" is a draft and "submitted" is turned in, so "Saved" left
     standing the exact doubt this line exists to remove. */
  ok('every staked card says the pick is submitted',
     bars.labels.length === 1 && /submitted/i.test(bars.labels[0]),
     JSON.stringify(bars.labels));
  ok('and it does not hedge with the draft word',
     !/\bsaved\b/i.test(bars.labels[0]), bars.labels[0]);
  ok('and it names how long there is to change it',
     /until kickoff/i.test(bars.labels[0]), bars.labels[0]);
  ok('the word "stake" no longer labels the row',
     !/your stake/i.test(bars.labels[0]), bars.labels[0]);
  ok('nothing is clipped at phone width', bars.clipped === false);

  /* --hit (#2F6E26) measures 5.09:1 on the card's #EDE8DE; --live
     (#63B257) measures 2.14 and would have failed. This is the assertion
     that stops somebody "brightening" it later. */
  ok('the tick uses the dark green that passes contrast, not the bright one',
     bars.okColour === 'rgb(47, 110, 38)', String(bars.okColour));

  /* A pick with no rank yet must still ASK, not reassure — otherwise the
     screen tells somebody they are done when they are one tap short. */
  const empty = await page.evaluate(() =>
    [...new Set([...document.querySelectorAll('.stakebar.empty .sb-l')]
      .map(e => e.textContent.trim()))]);
  if (empty.length) {
    ok('an unstaked pick still asks for the rank instead of saying saved',
       empty.every(t => /stake/i.test(t) && !/saved/i.test(t)), JSON.stringify(empty));
  }
  ok('no errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n33. A tiebreak guess must survive the list query failing');
{
  /* REPORTED BY PLAYERS AND REPRODUCED BY THE OWNER: type the Monday
     night total, see "Saved", close the app, reopen — blank. Every time.

     The write was never the problem; the guess was in Firestore the whole
     time. The READ lost it, and the structure of getTiebreaks is what
     turned a recoverable failure into missing data:

       const [res, members] = await Promise.all([getDocs(q), getMembers()])
       ... 20 lines later ...
       try { const own = await getDoc(<my own guess>) } catch {}

     That first await sat outside any try. The query filters on an equality
     (wk) plus an inequality on another field (revealAt), which Firestore
     refuses without a composite index — FAILED_PRECONDITION, every call,
     forever, until somebody runs a deploy. So the function rejected on its
     first line, the caller's optional() turned that into [], and the ONE
     read that fetches what the player actually typed never ran.

     STATIC, AND HERE IS WHY, because a test that cannot fail is worse than
     none: this harness replaces firebase-init.js wholesale with a stub, so
     no browser test in this file can execute the real getTiebreaks. The
     property being defended is structural — the own-document read must not
     be downstream of a query that is allowed to reject — so it is checked
     structurally, against the source. It would not catch a logic error
     inside the function. It does catch the exact regression, which is
     somebody re-sequencing these reads. */
  const fs = await import('node:fs');
  const src = fs.readFileSync('/root/work/pickem/firebase-init.js', 'utf8');
  const tb = src.slice(src.indexOf('async function getTiebreaks'),
                       src.indexOf('async function saveTiebreak'));
  ok('getTiebreaks exists to check', tb.length > 200);

  /* All three reads issued together, so no one of them gates another. */
  const promiseAll = tb.indexOf('Promise.all');
  const ownRead    = tb.indexOf(`tiebreaks', \`\${user.uid}_\${wk}\``);
  const closeAll   = tb.indexOf('  ]);', promiseAll);
  ok('your own guess is fetched by document id', ownRead > -1);
  ok('and it is issued alongside the list, not after it',
     promiseAll > -1 && ownRead > promiseAll && ownRead < closeAll,
     `Promise.all@${promiseAll} own@${ownRead} close@${closeAll}`);

  /* A rejected list must degrade, never propagate — that propagation is
     what discarded the guess. */
  ok('a failed list query is caught rather than thrown',
     /getDocs\(q\)\s*\.catch\(/.test(tb), 'getDocs(q) is unguarded');
  ok('and the own-document read is caught separately',
     /getDoc\(doc\([^)]*\)\)\s*[\r\n\s]*\.catch\(/.test(tb) ||
     /\.catch\(\(\)\s*=>\s*null\)/.test(tb), 'own read is unguarded');

  /* The rows must be built from whatever survived, not assumed present. */
  ok('an absent list yields an empty list rather than a crash',
     /\(res \? res\.docs : \[\]\)/.test(tb), 'res is dereferenced unguarded');

  /* THE SILENCE WAS HALF THE BUG. A missing index never fixes itself, so
     the failure has to name itself and name the command that repairs it —
     in BOTH queries that need that index. The Grid uses the same shape and
     would empty itself on Sunday with no explanation at all. */
  for (const [what, fn] of [['tiebreaks', tb],
                            ['grid', src.slice(src.indexOf('async function getRevealed'),
                                               src.indexOf('async function getTiebreaks'))]]) {
    ok(`${what}: a missing index is reported, not swallowed`,
       /failed-precondition/i.test(fn), 'no failed-precondition branch');
    ok(`${what}: and the message names the command that fixes it`,
       /firestore:indexes/.test(fn), 'no deploy command in the message');
  }
}

/* ------------------------------------------------------------------ */
console.log('\n34. Grid and Standings must grade real picks correctly');
{
  /* THE ONE THAT MATTERS MOST, asked for by name before the season
     opened: do these two screens actually take each player's pick and
     rank and score them right.

     Every other case in this file checks that something appears. This one
     checks that a NUMBER IS CORRECT, and it does it with an oracle that
     shares no code with the app: the expected points are recomputed here
     from the raw game and pick data, with pay() written out fresh below,
     and then compared against what the two screens display. If the app's
     scoring drifts, these disagree. If BOTH drift the same way the test
     is fooled — which is why the oracle is written from score_week.py's
     formula rather than copied from index.html.

     The week is deliberately PART-PLAYED. A fully settled week is served
     from the server's standings record, so it would test the stub's
     fabricated numbers instead of the app's arithmetic; mid-week is when
     the client calculates, and mid-week is when players are watching. */
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1000 } });
  const page = await ctx.newPage();
  await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.request.post(BASE + '/__plan',
    { data: { startISO: new Date(Date.now() - 4.2 * 864e5).toISOString() } });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);

  /* DATA ONLY out of the page — ids, winners, statuses, and each player's
     stored pick. No app function is consulted for anything computed. */
  const raw = await page.evaluate(() => {
    const wk = window.__state ? window.__state.week : null;
    const games = [...document.querySelectorAll('#gridBody thead th.gm')].length;
    return { games, wk };
  });

  const table = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#gridBody tbody tr')]
      .filter(tr => !tr.classList.contains('poolrow'));
    return rows.map(tr => ({
      name: tr.querySelector('.plmeta b')?.textContent || '',
      pts:  +(tr.querySelector('.tot .totnum')?.textContent || 'x'),
      hits: +((tr.querySelector('.tot .totsub')?.textContent || '').split('/')[0]),
      cells: [...tr.querySelectorAll('td .cell')].map(c => ({
        cls: [...c.classList].filter(k => k !== 'cell')[0] || '',
        txt: c.textContent.trim() })),
    }));
  });
  ok('the Grid rendered player rows', table.length > 0, String(table.length));

  /* THE ORACLE. Rebuilt from app-serve.mjs's own generators and
     score_week.py's pay(), independently of index.html. */
  const payOracle = (r, n) => !r ? 1 : Math.max(0, Math.min(n, n + 1 - r));
  const N = raw.games;
  const wk = 1;
  const gameState = await page.evaluate(() => {
    // The header cell's status chip is data the app read, not computed.
    return [...document.querySelectorAll('#gridBody thead th.gm .st')]
      .map(e => e.textContent.trim());
  });
  const finals = gameState.filter(s => s === 'Final').length;
  ok('the week is part-played, so the client is doing the arithmetic',
     finals > 0 && finals < N, `${finals} final of ${N}`);

  /* Stub rules, restated here rather than imported:
       game i winner   = ((wk+i) % 2) ? home : away
       player mi pick  = ((i+mi) % 2) ? home : away,  weight (i+mi)%16+1
     So player mi is right on every game when mi%2 === wk%2, else wrong on
     all of them — and a fully-correct 16-game week pays 1+2+...+16 = 136. */
  const expected = {};
  const roster = ['Lee','Monse','Dad','Uncle Ray','Coach K','Sam','Priya','Marcus'];
  roster.forEach((name, mi) => {
    let pts = 0, hits = 0;
    for (let i = 0; i < N; i++) {
      if (gameState[i] !== 'Final') continue;
      const correct = ((i + mi) % 2) === ((wk + i) % 2);
      if (correct) { hits++; pts += payOracle(((i + mi) % 16) + 1, N); }
    }
    expected[name] = { pts, hits };
  });

  let mismatches = [];
  for (const row of table) {
    const e = expected[row.name];
    if (!e) continue;
    if (row.pts !== e.pts || row.hits !== e.hits)
      mismatches.push(`${row.name}: screen ${row.pts}pts/${row.hits}hits, oracle ${e.pts}/${e.hits}`);
  }
  ok('every Grid total matches an independently computed score',
     mismatches.length === 0, mismatches.slice(0, 4).join(' | '));

  /* The oracle must be discriminating, or agreement means nothing: the
     scenario has to produce a spread, not all-zero or all-equal. */
  const spread = new Set(Object.values(expected).map(e => e.pts));
  ok('and the scenario actually produces different scores to tell apart',
     spread.size > 1, JSON.stringify([...spread]));

  /* CELL BY CELL. A right total can hide two errors that cancel. */
  let badCells = [];
  const mine = table.find(r => r.name === 'Lee');
  if (mine) {
    for (let i = 0; i < N; i++) {
      const c = mine.cells[i]; if (!c) continue;
      const isFinalGame = gameState[i] === 'Final';
      const correct = (i % 2) === ((wk + i) % 2);
      const want = !isFinalGame ? 'pend' : correct ? 'hit' : 'miss';
      if (c.cls !== want) badCells.push(`game ${i}: ${c.cls}, expected ${want}`);
      // A winning cell must print what it actually paid.
      if (want === 'hit') {
        const paid = payOracle((i % 16) + 1, N);
        if (!c.txt.includes('+' + paid))
          badCells.push(`game ${i}: cell says "${c.txt}", should pay +${paid}`);
      }
    }
  }
  ok('every one of your own Grid cells is graded right, and pays right',
     badCells.length === 0, badCells.slice(0, 4).join(' | '));

  /* A WINNER ON A GAME THAT IS NOT FINAL MUST NOT SCORE.

     Found by mutation-testing this very case: deleting weekPoints'
     `if(!isFinal(g))return;` guard changed nothing, because result()
     returns null for an unfinished game and no pick equals null. So the
     guard looked redundant and a future edit could remove it — right up
     until the day a game carries a winner while its status still says
     scheduled. That is not hypothetical here: import_schedule.py
     deliberately preserves `status: final` across re-imports and a
     postponement rescheduled forward produces the mirror of it, and the
     scorer writes winner and status as separate fields.

     Pushing exactly that state through watchWeek is the only way to tell
     a redundant guard from a load-bearing one. Points must not move. */
  const beforePush = await page.evaluate(() =>
    +(document.querySelector('#gridBody tbody tr .tot .totnum')?.textContent || 'x'));
  const pushed = await page.evaluate(() => {
    if (!window.__weekGames || !window.__pushWeek) return false;
    const games = window.__weekGames();
    const open = games.find(g => g.status !== 'final');
    if (!open) return false;
    open.winner = open.home;          // a result, with no final status
    window.__pushWeek(games);
    return true;
  });
  ok('a not-yet-final game could be given a winner for the check',
     pushed === true, 'no open game to test with');
  await page.waitForTimeout(600);
  const afterPush = await page.evaluate(() =>
    +(document.querySelector('#gridBody tbody tr .tot .totnum')?.textContent || 'x'));
  ok('and a winner on an unfinished game scores nobody anything',
     afterPush === beforePush, `${beforePush} -> ${afterPush}`);

  /* AND THE TWO SCREENS MUST AGREE. Different code paths (weekPoints vs
     weekSum) — if they diverge, a player sees one number on the Grid and
     another in Standings for the same week, which is the complaint that
     destroys trust in a pool. */
  await page.click('[data-tab="standings"]').catch(() => {});
  await page.evaluate(() =>
    document.querySelector('#standTabs [data-stand="week"]')?.click());
  await page.waitForTimeout(500);
  const board = await page.evaluate(() =>
    [...document.querySelectorAll('#board .row')].map(r => ({
      name: r.querySelector('.who b')?.textContent || '',
      pts:  +(r.querySelector('.pts b')?.textContent || 'x') })));
  ok('the weekly Standings rendered', board.length > 0, String(board.length));

  let disagree = [];
  for (const b of board) {
    const g = table.find(r => r.name === b.name);
    if (g && g.pts !== b.pts) disagree.push(`${b.name}: grid ${g.pts}, standings ${b.pts}`);
    const e = expected[b.name];
    if (e && b.pts !== e.pts) disagree.push(`${b.name}: standings ${b.pts}, oracle ${e.pts}`);
  }
  ok('Grid and weekly Standings agree, and both match the oracle',
     disagree.length === 0, disagree.slice(0, 4).join(' | '));

  /* Highest score must be top. A correct number in the wrong order is
     still a wrong leaderboard. */
  const ptsOrder = board.map(b => b.pts);
  ok('the weekly table is sorted by points, best first',
     ptsOrder.every((v, i) => i === 0 || ptsOrder[i - 1] >= v), JSON.stringify(ptsOrder));

  /* THE TWO IMPLEMENTATIONS OF pay() MUST STAY THE SAME FUNCTION.

     The oracle above is score_week.py's formula written out by hand, and
     it agrees with the app for every rank in play — but only for the
     ranks this scenario happens to use. The client was floored and not
     capped while the server was both, which for a weight of 0 or below
     pays more on the phone than the player is actually awarded. The write
     rule forbids those weights, so nothing live was ever mis-scored; the
     point is that "agrees on the data we have" is not "is the same
     function". Check the shape in both files. */
  const fsx = await import('node:fs');
  const jsPay = fsx.readFileSync('/root/work/pickem/index.html', 'utf8')
                   .match(/const pay=\(r,n\)=>[^;]+;/)?.[0] || '';
  const pyPay = fsx.readFileSync('/root/work/pickem/scripts/score_week.py', 'utf8');
  ok('the client payout is clamped at BOTH ends',
     /Math\.max\(0,\s*Math\.min\(n,/.test(jsPay), jsPay.slice(0, 90));
  ok('and the server payout is clamped at both ends too',
     /max\(0,\s*min\(n,\s*raw\)\)/.test(pyPay), 'score_week.py pay() changed shape');
  ok('both treat a missing rank as one point',
     /!r\?1:/.test(jsPay) && /if not rank:\s*\n\s*return 1/.test(pyPay), jsPay.slice(0, 60));

  ok('no page errors through any of it', errors.length === 0, errors[0] || '');
  await ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n35. A read that fails must say so, not show a believable blank');
{
  /* EVERY DEGRADED READ IN THIS APP HAS A FALLBACK THAT LOOKS LIKE DATA.
     myPicks falls back to {} — a sheet with no picks. getRevealed to [] —
     a Grid where nobody picked. getStandings to [] — a table where nobody
     scored. Each is a plausible screen and each is a lie: the picks are
     safe in Firestore the entire time.

     This is not hypothetical. It is exactly how the tiebreak bug reached
     players: a read that could not succeed, a fallback that looked like an
     answer, and a console line nobody opens. Somebody who sees an empty
     sheet on Sunday morning re-enters it or panics; nobody thinks "the
     standings query must have failed".

     The fallback stays — one bad read must not take down the app — but it
     has to be visible, it has to say what is missing, and above all it has
     to say the entries are safe, because that is the sentence that stops
     a player entering everything twice. */
  const { ctx, page, errors } = await open({ fail: { myPicks: true } });

  const t = await page.evaluate(() => {
    const el = document.getElementById('toast');
    return { shown: el.classList.contains('on'), kind: el.className,
             text: el.textContent.trim() };
  });
  ok('a failed read is announced on screen, not just in the console',
     t.shown === true, JSON.stringify(t));
  ok('it names what could not be loaded',
     /your own picks/i.test(t.text), t.text);
  ok('it promises nothing was lost',
     /nothing you entered is lost/i.test(t.text), t.text);
  ok('and it is the failure style, not the cheerful one',
     /\bfail\b/.test(t.kind), t.kind);

  /* STICKY. A warning about missing data that fades before it is read is
     the same as no warning — and the ordinary "Saved" toast clears after
     1.6s, so this has to be explicitly exempt. */
  await page.waitForTimeout(3000);
  const still = await page.evaluate(() =>
    document.getElementById('toast').classList.contains('on'));
  ok('and it stays on screen instead of fading', still === true);

  /* The app must still WORK. A warning is not a crash: the schedule is
     independent of the failed read and the week must still render. */
  const alive = await page.evaluate(() => ({
    weeks: document.querySelectorAll('#weeks .wk').length,
    cards: document.querySelectorAll('#slate .card').length }));
  ok('the app still renders the week around the failure',
     alive.weeks > 0 && alive.cards > 0, JSON.stringify(alive));

  ok('no page errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n36. A saved tiebreaker must actually be IN the box on launch');
{
  /* REPORTED BY PLAYERS, AND IT COST SIX WRONG THEORIES BEFORE ANYONE
     LOOKED IN THE RIGHT PLACE: "I enter the Monday night total, it says
     Saved, I close the app and reopen and it is blank."

     Everything upstream was innocent, and each was eliminated with
     evidence rather than argument: the write landed (every player's guess
     was in Firestore), the document id was right (the write rule would
     not have accepted it otherwise), the composite index was deployed,
     the security rules permitted the read, and running PS.getTiebreaks(1)
     in the console returned the row with total:31 and mine:true.

     The value was destroyed AFTER arriving, by the code meant to protect
     it. renderSlate remembers the input's value across a re-render so the
     keyboard is not dropped mid-number, and restored it whenever
     `el.value !== _tbVal`. That cannot distinguish a re-render wiping
     something half-typed from a re-render legitimately FILLING an empty
     box with the guess just loaded from the server. It restored both — so
     an early empty render's "" was put back over the freshly rendered 31,
     one microtask after paint.

     WHY IT HID SO WELL: the rendered HTML still said value="31" the whole
     time. Only the DOM property was cleared. Every check that reads
     markup, including a screenshot of the page source, would say the app
     was correct. This case therefore asserts the DOM PROPERTY, and
     deliberately asserts the attribute too, to document that the two
     disagreeing IS the signature. */
  const { ctx, page, errors } = await open({});

  const box = () => page.evaluate(() => {
    const e = document.getElementById('tbin');
    return e ? { dom: e.value, attr: e.getAttribute('value') } : null;
  });

  const first = await box();
  ok('the tiebreaker input exists', first !== null);
  ok('the saved guess is rendered into the markup',
     first.attr && first.attr.length > 0, JSON.stringify(first));
  /* THE ONE THAT WOULD HAVE CAUGHT IT. */
  ok('and it is actually IN the box, not only in the attribute',
     first.dom === first.attr, JSON.stringify(first));

  /* render() fires from tick() every second and from both live listeners,
     so the wipe had many chances to land. Outlast a few of them. */
  await page.waitForTimeout(3000);
  const later = await box();
  ok('and it survives a few seconds of re-renders',
     later.dom === first.attr, JSON.stringify(later));

  /* THE PROTECTION MUST NOT REGRESS. The restore exists for a real
     reason: a re-render replaces the input and drops the keyboard
     mid-number, on a Sunday evening when renders are constant. Fixing
     the wipe by deleting the restore outright would trade a visible bug
     for a worse invisible one. */
  await page.evaluate(() => document.getElementById('tbin').scrollIntoView());
  await page.click('#tbin');
  await page.fill('#tbin', '');
  await page.type('#tbin', '7');
  /* A REAL re-render, through the live listener the app actually uses.
     A first draft called window.render() — but the app's script is a
     module, so `render` is not global, the call did nothing, and the
     assertion below passed even with the restore deleted entirely. It
     was testing that typing survives no re-render at all. __pushWeek is
     the stub's handle on watchWeek's callback, which is precisely how a
     score landing mid-Sunday repaints the slate under a typing thumb. */
  const repainted = await page.evaluate(() => {
    if (!window.__pushWeek) return false;
    window.__pushWeek();
    return true;
  });
  ok('a real re-render could be triggered to test against', repainted === true);
  await page.waitForTimeout(400);
  const typing = await box();
  const stillFocused = await page.evaluate(() => document.activeElement?.id);
  ok('a half-typed number survives a re-render',
     typing.dom === '7', JSON.stringify(typing));
  ok('and the field keeps focus so the keyboard does not drop',
     stillFocused === 'tbin', String(stillFocused));

  await page.type('#tbin', '3');
  await page.waitForTimeout(200);
  ok('and typing continues from where it was',
     (await box()).dom === '73', JSON.stringify(await box()));

  ok('no errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n37. A player who is not in the pool must be told, not left picking');
{
  /* FROM A LIVE POOL, two days before the first kickoff. A player joined,
     told the owner they had entered and submitted their picks, and did not
     appear in the roster at all — no membership document, and therefore no
     picks, because firestore.rules refuses a pick write without
     isMember(). Nothing anywhere had told them.

     ensureJoined is the last line of defence: the PIN step gives up
     waiting on the join after seven seconds and trusts this function to
     finish the job on the next launch. Its repair attempt ended in
     `catch(e){ console.warn('self-join failed', e); }` and then carried on
     as though it had worked.

     Everything downstream degrades politely — getMembers falls back to [],
     myPicks to {} — so the result is a complete, ordinary-looking app with
     a full slate of games and no sign that the person is not in the pool.
     They rank sixteen games into the void.

     The app must still LOAD (the schedule is readable by any signed-in
     user, and a visible app with an honest error beats a blank screen),
     but it must say so, and it must not fade. */
  const { ctx, page, errors } = await open({
    // getMembers is refused, and the repair join then fails outright.
    notAMember: true, fail: { joinPool: true } });

  const t = await page.evaluate(() => {
    const el = document.getElementById('toast');
    return { shown: el.classList.contains('on'), kind: el.className,
             text: el.textContent.trim() };
  });
  ok('the failed join is announced on screen', t.shown === true, JSON.stringify(t));
  ok('it says plainly that picks will not count',
     /will count|not in the pool/i.test(t.text), t.text);
  ok('and it names the one action that fixes it',
     /open it again|close the app/i.test(t.text), t.text);
  ok('and it is the failure style', /\bfail\b/.test(t.kind), t.kind);

  /* STICKY. A warning that fades is the same as no warning — and this one
     has to survive long enough to be read by somebody who has just opened
     the app and is looking at the games, not the bottom of the screen. */
  await page.waitForTimeout(3000);
  ok('and it does not fade away',
     (await page.evaluate(() =>
        document.getElementById('toast').classList.contains('on'))) === true);

  /* The app must still be usable around the failure, or the warning is
     moot — they would just see a blank screen and reinstall. */
  const alive = await page.evaluate(() => ({
    weeks: document.querySelectorAll('#weeks .wk').length,
    cards: document.querySelectorAll('#slate .card').length }));
  ok('the week still renders so the message has something to sit on',
     alive.weeks > 0 && alive.cards > 0, JSON.stringify(alive));

  ok('no page errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n38. A player with no push token must be told, in the app');
{
  /* THE BUG, and it is the largest one this file records by headcount.

     alertsHealthy() was written in firebase-init.js, exported, and called
     by NOTHING. A comment in index.html described the banner it was for in
     detail; check_roster.py told the pool owner "have them open the app;
     the banner offers a one-tap fix". Neither existed.

     Opening the app could not have helped anyone, because
     refreshPushToken() returns on its first line unless permission is
     ALREADY granted. So the only code path in the whole app that could
     register a push token was the "Keep me honest" button on the
     onboarding alerts screen — which a returning player never sees again.
     Tap "Not now" once and you were dark for the season.

     Measured in week 1 of the first real season: twelve of nineteen
     players had zero tokens. Nothing in the app said a word about it, and
     the five preference switches sat there implying alerts were working. */
  const { ctx, page, errors } = await open({ alerts: { ok:false, reason:'permission' } });
  await page.click('[data-tab="settings"]');
  await page.waitForTimeout(700);

  const seen = await page.evaluate(() => {
    const box = document.querySelector('#alertfix .notice');
    return box ? { text: box.innerText.trim(),
                   btn: !!document.getElementById('alertFixGo') } : null;
  });
  ok('the banner appears in Settings when there is no token',
     seen !== null, 'no #alertfix .notice rendered');
  ok('and it says alerts are off in as many words',
     !!seen && /alerts are off/i.test(seen.text), (seen||{}).text);
  ok('and it names the cost rather than a status code',
     !!seen && /last call|thirty minutes|kickoff/i.test(seen.text), (seen||{}).text);
  ok('and it offers the one tap', !!seen && seen.btn === true);

  /* THE SWITCHES MUST STOP LYING. All five read "on" by default, and to a
     player with no token that is five controls claiming a feature the app
     cannot deliver. This is what made twelve people think the app was
     broken rather than their phone unregistered. */
  const sw = await page.evaluate(() => ({
    inert: document.getElementById('prefs').classList.contains('inert'),
    note: (document.querySelector('#alertfix .prefs-dead') || {}).innerText || '',
    tappable: !document.querySelector('.pref[disabled]') }));
  ok('and the preference switches are visibly inert', sw.inert === true);
  ok('and something says why they cannot help',
     /cannot turn alerts on|permission on your phone/i.test(sw.note), sw.note);
  ok('but they are still tappable, for setting up before turning alerts on',
     sw.tappable === true);

  /* THE HEALTH CHECK IS A NETWORK CALL. Firing it on every render would
     put a getToken() round trip behind every preference toggle. */
  const before = await page.evaluate(() => window.__ps.calls('alertsHealthy'));
  await page.click('.pref[data-pref="open"]');
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => window.__ps.calls('alertsHealthy'));
  ok('and toggling a preference does not re-run the health check',
     after === before, before + ' -> ' + after);

  ok('no page errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n39. The one tap must actually register, and say so honestly');
{
  const { ctx, page, errors } = await open({ alerts: { ok:false, reason:'permission' } });
  await page.click('[data-tab="settings"]');
  await page.waitForTimeout(700);
  await page.click('#alertFixGo');
  await page.waitForTimeout(600);

  ok('tapping it calls enablePush',
     (await page.evaluate(() => window.__ps.calls('enablePush'))) === 1);
  const t = await page.evaluate(() => {
    const el = document.getElementById('toast');
    return { on: el.classList.contains('on'), kind: el.className,
             text: el.textContent.trim() };
  });
  ok('and it confirms on screen', t.on === true, JSON.stringify(t));
  ok('and the confirmation is not the failure style', !/\bfail\b/.test(t.kind), t.kind);
  /* The banner is re-read afterwards rather than assumed away: enablePush
     can be granted and still fail to register a token. */
  const gone = await page.evaluate(() => !document.querySelector('#alertfix .notice'));
  ok('and the banner clears once the check passes', gone === true);
  ok('no page errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n40. A refused grant must not claim success, and must stay fixable');
{
  /* enablePush() THROWS rather than returning quietly when it cannot
     register — its own comment says so, because a silent null would tell
     someone their alerts are on when nothing was registered. That is only
     worth anything if the caller shows the throw. */
  const { ctx, page, errors } = await open({
    alerts: { ok:false, reason:'permission' },
    pushError: 'On iPhone, add the app to your Home Screen first, then turn on alerts from there.' });
  await page.click('[data-tab="settings"]');
  await page.waitForTimeout(700);
  await page.click('#alertFixGo');
  await page.waitForTimeout(600);

  const t = await page.evaluate(() => {
    const el = document.getElementById('toast');
    return { on: el.classList.contains('on'), kind: el.className,
             text: el.textContent.trim() };
  });
  ok('a refused grant is reported as a failure', t.on === true && /\bfail\b/.test(t.kind),
     JSON.stringify(t));
  /* Its own wording, not a generic one. "Add it to your Home Screen" is
     the entire answer for an iPhone player, and a caller that replaced it
     with "something went wrong" would strand them. */
  ok('and it passes through the reason rather than a generic message',
     /home screen/i.test(t.text), t.text);
  const still = await page.evaluate(() => !!document.querySelector('#alertfix .notice'));
  ok('and the banner is still there to try again', still === true);
  /* A disabled button that never comes back is a dead end — and the
     re-render is what restores it. */
  const btn = await page.evaluate(() => {
    const b = document.getElementById('alertFixGo');
    return b ? { disabled: b.disabled, label: b.textContent.trim() } : null; });
  ok('and the button is usable again, not stuck on "Turning on"',
     !!btn && btn.disabled === false && /turn alerts on/i.test(btn.label),
     JSON.stringify(btn));
  ok('no page errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n41. Working alerts must show no banner at all');
{
  /* The failure mode of a warning system is crying wolf. This box is red
     and says alerts are off; showing it to the seven people whose alerts
     work would teach all nineteen to ignore it. */
  const healthy = await open({});                       // stub default: {ok:true}
  await healthy.page.click('[data-tab="settings"]');
  await healthy.page.waitForTimeout(700);
  ok('a healthy player sees no banner',
     (await healthy.page.evaluate(() => !document.querySelector('#alertfix .notice'))) === true);
  ok('and the preference switches are still there',
     (await healthy.page.locator('.pref').count()) === 5);
  ok('and they are not dimmed',
     (await healthy.page.evaluate(() =>
        !document.getElementById('prefs').classList.contains('inert'))) === true);
  await healthy.ctx.close();

  /* FAIL SILENT, NOT ALARMING. alertsHealthy() was dead code long enough
     for the test stub's copy to drift to a bare `true`, which is neither
     {ok:true} nor {ok:false}. An unrecognised shape must read as "fine". */
  const odd = await open({ alerts: true });
  await odd.page.click('[data-tab="settings"]');
  await odd.page.waitForTimeout(700);
  ok('an unrecognised health result is treated as healthy, not broken',
     (await odd.page.evaluate(() => !document.querySelector('#alertfix .notice'))) === true);
  await odd.ctx.close();

  /* Signed out is the sign-in screen's problem and that screen is already
     in front of them. */
  const out = await open({ alerts: { ok:false, reason:'signed-out' } });
  await out.page.click('[data-tab="settings"]').catch(() => {});
  await out.page.waitForTimeout(700);
  ok('and a signed-out player is not told their alerts are broken',
     (await out.page.evaluate(() => !document.querySelector('#alertfix .notice'))) === true);
  await out.ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n42. An iPhone in a Safari tab must be told to install, not to tap');
{
  /* The wrong copy here is worse than none. On iOS in a browser tab
     permission is usually still 'default', so a naive reading offers a
     "Turn alerts on" button that CANNOT work — iOS does not deliver web
     push to a Safari tab, whatever anybody taps. Sending a player to tap
     a dead button costs you their trust in the whole app, and this is the
     platform most of the pool is on. */
  const { ctx, page, errors } = await open(
    { alerts: { ok:false, reason:'permission' } },
    { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) '
              + 'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
  await page.click('[data-tab="settings"]');
  await page.waitForTimeout(700);

  const seen = await page.evaluate(() => {
    const box = document.querySelector('#alertfix .notice');
    return { text: box ? box.innerText.trim() : '',
             btn: !!document.getElementById('alertFixGo') }; });
  ok('the banner still appears on an uninstalled iPhone', seen.text !== '');
  ok('and it says to add it to the Home Screen',
     /home screen/i.test(seen.text), seen.text);
  ok('and it does NOT offer a button that cannot work on iOS',
     seen.btn === false, seen.text);
  ok('no page errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n43. A player who blocked notifications must be sent somewhere real');
{
  /* Once a site is blocked, requestPermission() resolves 'denied' without
     ever prompting. Offering "Turn alerts on" there is a button that can
     only ever fail, so the copy has to point at browser settings instead.
     permissions:[] is exactly the blocked state. */
  const { ctx, page, errors } = await open(
    { alerts: { ok:false, reason:'permission' } }, { notify: 'denied' });
  await page.click('[data-tab="settings"]');
  await page.waitForTimeout(700);
  const seen = await page.evaluate(() => {
    const box = document.querySelector('#alertfix .notice');
    return { text: box ? box.innerText.trim() : '',
             btn: !!document.getElementById('alertFixGo') }; });
  ok('a blocked player gets the banner', seen.text !== '');
  ok('and is told it is a browser setting, not an app one',
     /blocked|browser settings/i.test(seen.text), seen.text);
  ok('and is told plainly that the app may not ask again',
     /ask you again|not allowed to ask/i.test(seen.text), seen.text);
  ok('and is not offered a tap that can only fail', seen.btn === false);
  ok('no page errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

/* ------------------------------------------------------------------ */
const SKEW = 8000;
console.log('\n44. The Grid must open itself at kickoff, without a reload');
{
  /* THE BUG. The reveal listener bakes `revealAt <= now - CLOCK_SKEW_MS`
     into its query when it subscribes, so a pick that reveals later can
     never enter that result set. scheduleRevealRefresh() exists to
     re-subscribe with a fresh bound — and waited `next - now + 5000`.

     Five seconds is not enough, and the miss is not marginal: the skew is
     120 seconds, so re-subscribing at kickoff+5s builds a bound of
     kickoff MINUS 115 seconds. The pick's revealAt is exactly kickoff. It
     still does not match. That pass then scheduled itself for the NEXT
     kickoff, so on a Thursday opener — one game, nothing else until
     Sunday — the first reveal of the week never arrived on its own at
     all. The Grid sat on sealed dots through the whole game and only a
     reload or a week switch fixed it, which is the exact failure the
     function's own comment says it exists to prevent.

     Broken for the first game of every week; fine from the second game of
     a Sunday block onwards, which is why nobody caught it. */
  const KICK_IN = 4000;
  const { ctx, page, errors } = await open({
    startISO: new Date(Date.now() + KICK_IN).toISOString(),
    weeks: 1, gamesPerWeek: 3, skewMs: SKEW });
  const kickAt = Date.now() + KICK_IN;

  await page.click('[data-tab="grid"]').catch(() => {});
  const before = await page.evaluate(() => (window.__revealBounds || []).slice());
  ok('one reveal subscription exists before kickoff', before.length === 1,
     JSON.stringify(before));
  ok('and its bound is short of the kickoff, so nothing is revealed yet',
     before[0] < kickAt, String(kickAt - before[0]) + 'ms short');

  /* Wait past kickoff + skew, and NEVER touch the page — no reload, no
     week switch, no tab change. That is the whole point. */
  await page.waitForTimeout(KICK_IN + SKEW + 4000);

  const bounds = await page.evaluate(() => window.__revealBounds || []);
  ok('the reveal listener re-subscribed after kickoff', bounds.length > 1,
     JSON.stringify(bounds.map(b => Math.round((b - Date.now()) / 1000))));
  /* The assertion that actually kills the bug: a re-subscribe is worth
     nothing unless its bound clears the kickoff it was scheduled for. */
  ok('and its bound is PAST the kickoff, not short of it',
     bounds.some(b => b >= kickAt),
     'latest bound is ' + Math.round((Math.max(...bounds) - kickAt) / 1000) + 's from kickoff');

  ok('no page errors', errors.length === 0, errors[0] || '');
  await ctx.close();

  /* THE HALF THIS CASE MISSED THE FIRST TIME, and it shipped.

     The block above loads the page BEFORE kickoff, which is the lucky
     ordering. scheduleRevealRefresh() filtered `k > now` — kickoffs still
     in the future — so a game that had ALREADY started was dropped and no
     timer was ever set for its reveal moment. Open the app at 9:36 for a
     9:35 kickoff and the column stayed sealed until a reload; the next
     timer was the following kickoff, days away.

     That is the most likely two minutes in the week for somebody to open
     the app — they open it BECAUSE a game just started. Reported by a
     player within twelve hours of the fix going live. */
  const afterKick = await open({
    startISO: new Date(Date.now() - 2000).toISOString(),   // kicked off 2s ago
    weeks: 1, gamesPerWeek: 3, skewMs: SKEW });
  const kickedAt = Date.now() - 2000;
  await afterKick.page.waitForTimeout(SKEW + 9000);
  const b2 = await afterKick.page.evaluate(() => window.__revealBounds || []);
  ok('a game that kicked off BEFORE the app opened still reveals itself',
     b2.some(x => x >= kickedAt), JSON.stringify(b2.map(x => Math.round((x-kickedAt)/1000))));
  await afterKick.ctx.close();

  /* AND A TIMER IS NOT ENOUGH ON A PHONE. iOS suspends JavaScript in a
     backgrounded home-screen app, so the reveal timer does not fire while
     the app is in a pocket — which is exactly where it is two minutes
     after a kickoff. Simulated by hiding the page, clearing its pending
     timers, waiting out the reveal moment, and coming back. */
  const bg = await open({
    startISO: new Date(Date.now() + 4000).toISOString(),
    weeks: 1, gamesPerWeek: 3, skewMs: SKEW });
  const bgKick = Date.now() + 4000;
  await bg.page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable:true, get:()=>'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    for (let i = 1; i < 99999; i++) clearTimeout(i);      // as a suspend would
  });
  await bg.page.waitForTimeout(Math.max(0, (bgKick + SKEW + 9000) - Date.now()));
  await bg.page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable:true, get:()=>'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await bg.page.waitForTimeout(1200);
  const b3 = await bg.page.evaluate(() => window.__revealBounds || []);
  ok('and it reveals on return after the timer was suspended',
     b3.some(x => x >= bgKick), JSON.stringify(b3.map(x => Math.round((x-bgKick)/1000))));
  await bg.ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n45. A finished game must stop pulsing like a live one');
{
  /* THE BUG. cdClass() took only a duration:

       const cdClass = ms => ms<=0 ? 'live' : ...

     so the class was 'live' from kickoff until the end of the season, and
     `.cd.live::before` attaches a green dot with `animation:pulse 1.6s
     infinite`. The badge read FINAL with a dot pulsing beside it saying
     the opposite, and it never stopped. One Thursday game is a curiosity;
     thirteen finished Sunday games pulsing at once drains the only piece
     of motion on the card of the one thing it is supposed to mean. */
  const started = new Date(Date.now() - 40 * 864e5).toISOString();
  const { ctx, page, errors } = await open({ startISO: started, weeks: 1, gamesPerWeek: 3 });
  await page.waitForTimeout(500);

  const read = () => page.evaluate(() => {
    const out = [];
    document.querySelectorAll('#slate .card').forEach(card => {
      const cd = card.querySelector('.meta .cd');
      if (!cd) return;
      out.push({ label: cd.textContent.trim(),
                 cls: cd.className,
                 dot: getComputedStyle(cd, '::before').content });
    });
    return out;
  });

  const cards = await read();
  const fin = cards.filter(c => /final/i.test(c.label));
  ok('the week has finished games to check', fin.length > 0, JSON.stringify(cards));
  ok('a finished game is not classed live',
     fin.every(c => !/\blive\b/.test(c.cls)), JSON.stringify(fin));
  /* The assertion that kills the bug: no ::before means no dot, and no
     dot means nothing to animate. */
  ok('and carries no pulsing dot',
     fin.every(c => c.dot === 'none' || c.dot === '' || c.dot === 'normal'),
     JSON.stringify(fin.map(c => c.dot)));

  /* The pulse must SURVIVE for a game that really is live, or this fix
     has just deleted the feature instead of scoping it. */
  const live2 = await open({ startISO: new Date(Date.now() - 60000).toISOString(),
                             weeks: 1, gamesPerWeek: 3 });
  await live2.page.waitForTimeout(500);
  const liveCards = await live2.page.evaluate(() =>
    [...document.querySelectorAll('#slate .card .meta .cd')]
      .map(cd => ({ label: cd.textContent.trim(), cls: cd.className })));
  const inProg = liveCards.filter(c => /in progress/i.test(c.label));
  ok('a game actually in progress is still classed live',
     inProg.length > 0 && inProg.every(c => /\blive\b/.test(c.cls)),
     JSON.stringify(liveCards));
  await live2.ctx.close();

  ok('no page errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

/* NOT COVERED HERE, deliberately, and worth knowing about.

   weekSum() now prefers the server's figure for any week that is not the
   one on screen, and the live client calculation for the week that is —
   which is what stops the Standings tab freezing at the Sunday-9pm
   scoring run all the way through Sunday Night Football, without also
   zeroing a week the moment you browse away from it.

   A test for that was written and then deleted: this harness's PS stub
   returns a fabricated standings record for every week that holds a
   final game, so both the old and the new code passed it. A test that
   cannot fail is worse than no test — it is a green tick that means
   nothing — and this file exists precisely because two of the earlier
   assertions in this project encoded broken behaviour as correct.

   Covering it properly needs the stub to model a week that has finals
   but has NOT been scored yet. That is the next thing to add here.

   The residual limitation, stated plainly: loadWeek() keeps only one
   week of everyone's picks in memory, so a week that has finals and no
   server record yet still shows zero for other players once you browse
   away from it. Scoring runs three times a week, so that window is
   real but short. Fixing it properly means caching revealed picks per
   week rather than per load. */

/* ------------------------------------------------------------------ */
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
if (fails.length) { console.log('FAILURES:'); fails.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);
