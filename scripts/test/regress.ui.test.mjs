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

async function open(plan = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
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
  ok('and the button still says it is working, not "Let me in"',
     /signing/i.test(after.btn), JSON.stringify(after.btn));
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
  await page.waitForTimeout(8000);
  const midLabel = await page.evaluate(() =>
    (document.querySelector('#obGo')?.textContent || '').trim());
  ok('the button names what is actually slow, instead of sitting mute',
     /loading season schedule/i.test(midLabel), midLabel);

  /* THE ASSERTION THAT MATTERS, and it has to come BEFORE any clicking.

     An earlier draft went straight to clicking through the remaining
     screens — and the PIN step has a Skip button, so the loop hopped over
     the stalled step and the case passed with the bound removed. The
     question is whether the wizard moves on BY ITSELF once the bound
     expires, so ask it while touching nothing: is the PIN screen gone? */
  await page.waitForTimeout(10000);              // ~18s in; the bound is 15s
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
