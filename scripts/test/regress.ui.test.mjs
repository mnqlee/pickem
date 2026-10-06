/* td:not(.tbtd), not td — the Grid grew a tiebreaker column, and every
   place below that walks a row's cells POSITIONALLY to line them up with
   the week's games has to skip it or it reads the tiebreaker guess as a
   seventeenth game. That is not a hypothetical: it is how these cases
   first failed. */
/* Regression tests for bugs that shipped and were fixed.

   Every case here is a defect that was live in production, that clicking
   around would not have surfaced, and that a plausible future edit could
   quietly reintroduce. A test named after the symptom is worth more than
   one named after the function, so they read as user complaints.

   Run:  node app-serve.mjs &   then   node regress.ui.test.mjs
*/
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = 'http://127.0.0.1:8098';
/* THE VERSION UNDER TEST IS READ OUT OF sw.js, never typed here. The
   whole point of the Settings card is that one file holds the number,
   so a test carrying its own copy would defeat the thing it checks and
   would go stale on the next release. */
const SW_VERSION = (fs.readFileSync(new URL('../../sw.js', import.meta.url).pathname, 'utf8')
  .match(/const VERSION = '([^']+)'/) || [])[1];
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
  /* opts.observeShifts: record every layout shift the browser reports,
     from before the first paint. Installed as an init script because a
     PerformanceObserver added after load has already missed the shifts
     that matter, which all happen in the first few hundred ms. */
  if (opts.observeShifts) await ctx.addInitScript(() => {
    window.__shifts = [];
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) {
        if (e.hadRecentInput) continue;      // a shift the user caused is not a defect
        window.__shifts.push({ t: Math.round(e.startTime), value: +e.value.toFixed(4),
          sources: (e.sources || []).map(sc => {
            const n = sc.node;
            if (!n || !n.tagName) return '(node gone)';
            return n.tagName.toLowerCase() + (n.id ? '#' + n.id : '')
              + '   y ' + Math.round(sc.previousRect.y) + ' -> ' + Math.round(sc.currentRect.y);
          }) });
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
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

  /* WAIT FOR THE STEPS, DO NOT GUESS AT 400ms. This pair of checks was
     flaky, and a flaky check in the suite that clears a release is worse
     than no check: it teaches you to re-run and shrug. Pressing #obGo
     rebuilds #obBody, and on a loaded machine that can take longer than
     a fixed pause, so `.ob-steps` was read empty and the assertion failed
     on the harness rather than on the app. Wait for the list to exist
     AND to have text in it. */
  const steps = async page => {
    const el = page.locator('.ob-steps');
    await el.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
    for (let i = 0; i < 40; i++) {
      const t = await el.innerText().catch(() => '');
      if (t.trim().length > 20) return t;
      await page.waitForTimeout(100);
    }
    return await el.innerText().catch(() => '');
  };

  const saf = await openUA(UA.safari);
  ok('an iPhone lands on the Home Screen prompt before signing in',
     /Home Screen/i.test(await saf.page.locator('#obBody').innerText().catch(() => '')));
  ok('and is always offered a way straight past it',
     await saf.page.locator('#obSkip').isVisible().catch(() => false));
  await saf.page.click('#obGo').catch(() => {});
  const safSteps = await steps(saf.page);
  ok('Safari is pointed at the Share button in its own toolbar',
     /bottom of the screen/i.test(safSteps) && !/⋯/.test(safSteps), safSteps.slice(0, 70));
  ok('no errors', saf.errors.length === 0, saf.errors[0] || '');
  await saf.ctx.close();

  const edg = await openUA(UA.edge);
  await edg.page.click('#obGo').catch(() => {});
  const edgSteps = await steps(edg.page);
  ok('both browsers actually produced instructions to compare',
     safSteps.trim().length > 20 && edgSteps.trim().length > 20,
     JSON.stringify([safSteps.length, edgSteps.length]));
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
    cells: [...document.querySelectorAll('#gridBody tbody tr:first-child td:not(.tbtd) .cell')]
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
    /* A SEASON seal prints a count next to the badge; a WEEK seal never
       does. badgeSVG only emits that <text> when n > 1, so counting the
       numerals inside the badge svgs is how the two are told apart. */
    sealCounts: [...document.querySelectorAll('#board .row svg')]
      .reduce((n, g) => n + [...g.querySelectorAll('text')]
        .filter(t => /^\d+$/.test(t.textContent.trim())).length, 0),
    second: document.querySelectorAll('#board .row.second').length,
    silver: document.querySelectorAll('#board .leadtag.silver').length,
    gold: [...document.querySelectorAll('#board .leadtag')]
      .filter(e => !e.classList.contains('silver')).length,
    /* Per-row points, so the seal count can be graded against the RULE
       rather than against a number somebody typed in. */
    pts: [...document.querySelectorAll('#board .row .pts b')]
      .map(e => Number(e.textContent)).filter(Number.isFinite),
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
  /* "leader" while it is being played, "winner" once every game is
     final — this fixture's week is complete, so it is the latter. Both
     spellings are accepted here because this case is about WHICH TABLE
     loaded, not about the word; the word has its own case below. */
  ok('a week with results opens on This week, not Season',
     /week \d+ (leader|winner)/i.test(landed.lead), landed.lead);

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
  ok('names the WEEK, not the season',
     /week \d+ (leader|winner)/i.test(week.lead) && !/season/i.test(week.lead),
     week.lead);
  /* The banner has to say which of the two it means. A finished week
     saying "leader" invites the question the seal already answered. */
  ok('and says "winner" now the week is over, not "leader"',
     /week \d+ winner/i.test(week.lead), week.lead);
  /* THE RUNNER-UP IS A SCORE, NOT A ROW — "Ties share a place". This
     asserted `week.second === 1`, which is only right when nobody is
     level; score_week.py's runner-up is every row at the next DISTINCT
     score down, and this fixture's generator happens to put the whole
     top of the table on the same total, so "1" was wrong here the
     moment the seals started following points instead of position. */
  const shareCount = (arr, v) => arr.filter(x => x === v).length;
  const wBest = week.pts.length ? Math.max(...week.pts) : 0;
  const wLower = week.pts.filter(p => p < wBest);
  const wSnd = wLower.length ? Math.max(...wLower) : 0;
  const nWin = wBest > 0 ? shareCount(week.pts, wBest) : 0;
  const nSnd = wSnd > 0 ? shareCount(week.pts, wSnd) : 0;
  ok('the fixture actually reaches the shared-honour case',
     nWin > 1, `${nWin} on the best score of ${wBest}`);
  ok('every row at the runner-up score is banded, and only those',
     week.second === nSnd, `${week.second} banded, ${nSnd} on ${wSnd}`);
  ok('and every co-winner gets the gold banner, not just the first row',
     week.gold === nWin, `${week.gold} gold, ${nWin} winners`);
  ok('with a silver banner on each runner-up',
     week.silver === nSnd, `${week.silver} silver, ${nSnd} runners-up`);

  /* AND EVERY BANNER HAS TO BE ON ITS OWN ROW.
     `.leadtag` is position:absolute and `.row.lead` is the only row that
     declares position:relative — so a banner on any other row anchors
     to whatever IS positioned above it and lands somewhere near the top
     of the board, detached from the player it is describing.
     `.row.hastag` exists for exactly that and nothing else.

     Counting the banners does not catch this: the right number of tags
     render, in the wrong places. Mutation-tested — batch 6 drops the
     `second hastag` classes and this is the assertion that goes red. */
  const anchored = await page.evaluate(() => {
    const out = [];
    for (const row of document.querySelectorAll('#board .row')) {
      const tag = row.querySelector('.leadtag');
      if (!tag) continue;
      const r = row.getBoundingClientRect(), t = tag.getBoundingClientRect();
      out.push({
        kind: tag.classList.contains('silver') ? 'silver' : 'gold',
        // the tag sits at top:-7px right:11px of its row
        dTop: Math.round(t.top - r.top),
        inside: t.right <= r.right + 2 && t.left >= r.left,
      });
    }
    return out;
  });
  ok('there are banners to place', anchored.length === nWin + nSnd,
     `${anchored.length} tags for ${nWin + nSnd} honours`);
  ok('every banner is anchored to its own row, not floating on the board',
     anchored.length > 0 && anchored.every(a => Math.abs(a.dTop + 7) <= 3 && a.inside),
     JSON.stringify(anchored.filter(a => Math.abs(a.dTop + 7) > 3 || !a.inside)
       .slice(0, 4)));
  ok('ranks them on a different order',
     JSON.stringify(week.order) !== JSON.stringify(season.order));
  ok('on smaller numbers than the season total',
     Number(week.top) < Number(season.top), `${week.top} vs ${season.top}`);
  /* THE DISTINCTION THIS CASE DEFENDS.
     The week table does carry seals — 1ST for whoever won THAT week and
     2ND for the runners-up — but it must never carry the SEASON seals,
     which are a different claim: those count how many weeks a player
     has won and print that count beside the badge. So: one seal per
     honour, and not one of them with a count. Two earlier versions of
     this assertion were both wrong by a different number — zero seals,
     then exactly two — which is what happens when a rule is graded
     against a literal instead of against itself. */
  ok('carries one week seal per honour and not one more',
     week.seals === nWin + nSnd,
     `${week.seals} seals for ${nWin} winners + ${nSnd} runners-up`);
  ok('and none of them carries a season count',
     week.sealCounts === 0, String(week.sealCounts));
  ok('while the season table still counts its own',
     season.seals > 0, String(season.seals));
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
  /* The onboarding screen captioned "that's the entire list" has been
     wrong twice, in the same way both times: compose() moved on and the
     preview did not. First it promised "First kickoff Sunday 1:00 PM"
     when nearly every NFL week opens on a Thursday. Then, after the
     titles were rewritten, it was still promising "8 picks due Thu,
     8:20 PM" — a slate that cannot exist, since a Thursday deadline is
     one game.

     The alerts themselves were never wrong. A preview that contradicts
     them is still expensive: it is the first alert copy a new member
     reads, and it teaches them to expect a sentence that never arrives.

     Static, and checked as a PAIR every time, so drift in EITHER file
     fails. */
  const fs = await import('node:fs');
  const app  = fs.readFileSync('/root/work/pickem/index.html', 'utf8');
  const live = fs.readFileSync('/root/work/pickem/worker/live.js', 'utf8');

  const preview = (app.match(/\$\{nt\((.|\n)*?\)\}/g) || []).join(' ');
  const prows = app.match(/\$\{nt\([^)]*\)\}/g) || [];
  ok('the preview exists to check', preview.length > 0);
  ok('there are four preview rows, one per tier', prows.length === 4, String(prows.length));

  /* ---- the unit: a named bunch, in both files ---- */
  ok('the sender names bunches rather than kickoff times',
     /const SLATE_NAMES = \{/.test(live) && /function etSlate\(/.test(live),
     'SLATE_NAMES or etSlate missing from worker/live.js');
  ok('and groups by slate, not by kickoff time',
     /bunches\[etSlate\(g\.kickoff\.getTime\(\)\)\]/.test(live) &&
     !/slots\[g\.kickoff\.getTime\(\)\]/.test(live),
     'the send loop is still grouping by kickoff time');
  ok('the preview names bunches too, and one of them is Thursday night',
     /Thursday Night Football/.test(preview), preview.slice(0, 160));
  ok('and it shows a Sunday bunch, not a Sunday kickoff time',
     /early Sunday games/.test(preview) && !/First kickoff Sunday 1:00 PM'/.test(preview),
     preview.slice(0, 200));

  /* ---- the sentences, matched between the files ---- */
  ok('compose() says "No team selected yet" for a one-game bunch',
     /'No team selected yet\.'/.test(live));
  ok('and the preview shows that sentence',
     /No team selected yet\./.test(preview), preview.slice(0, 200));
  ok('compose() counts a bunch as "N games unpicked"',
     /game\$\{unpicked === 1 \? '' : 's'\} unpicked\./.test(live),
     'the count sentence in compose() has changed shape');
  ok('and the preview shows a count in the same words',
     /\d+ games unpicked\./.test(preview), preview.slice(0, 260));
  ok('compose() warns about the zero from the hours tier down',
     /' Unselected games score 0\.'/.test(live));
  ok('and the preview carries that warning on its late rows',
     /Unselected games score 0\./.test(preview), preview.slice(0, 260));
  ok('"First kickoff" for a bunch, "Kicks off" for a single game, in both',
     /`Kicks off \$\{when\}` : `First kickoff \$\{when\}`/.test(live) &&
     /First kickoff in/.test(preview) && /Kicks off in/.test(preview));

  /* ---- THE SHAPES THAT MUST NOT COME BACK ----
     Both of these shipped, and each read as a contradiction on the
     phone: a week-level title over a slot-level body, then a
     slot-level title over a week-level body. */
  ok('no "N picks due" title survives in either file',
     !/picks\(n\)\} due/.test(live) && !/picks? due/.test(preview),
     preview.slice(0, 200));
  ok('and no reminder mentions a week total any more',
     !/Week \$\{wk\} games still need a pick/.test(live) &&
     !/Week \d+ games still need a pick/.test(preview),
     preview.slice(0, 200));
  ok('nor claims a week just opened',
     !/Week \$\{wk\} is open/.test(live) && !/is open/.test(preview));

  /* ---- THE NUMBERS IN THE PREVIEW HAVE TO BE POSSIBLE ----
     A Thursday bunch is one game, so it can never print a count, and a
     row that prints a count must be a bunch of more than one. Two of
     these rows once described a slate that does not exist. */
  for (const row of prows) {
    const cnt = (row.match(/(\d+) games unpicked/) || [])[1];
    if (/Thursday Night|Sunday Night|Monday Night/.test(row))
      ok('a single-game bunch prints no count',
         !cnt && /No team selected yet/.test(row), row);
    if (cnt) {
      ok('a counted row is a bunch of several, so it says First kickoff',
         /First kickoff/.test(row), row);
      ok('and the count is more than one', Number(cnt) > 1, row);
    }
  }
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
    const rows = [...el.querySelectorAll('#gridBody table.pool tbody tr')]
      .filter(tr => !tr.classList.contains('poolrow'));
    const others = rows.filter(tr => !tr.classList.contains('me'));
    return { chips: el.querySelectorAll('.rchip').length,
             rows:  rows.length,
             mine:  rows.filter(tr => tr.classList.contains('me')).length,
             otherCellClasses: others.flatMap(tr =>
               [...tr.querySelectorAll('td:not(.tbtd) .cell')].map(c => c.className.trim())),
             text:  el.innerText.replace(/\s+/g, ' ') };
  });
  /* THE GRID NOW ANSWERS THIS WITH THE TABLE ITSELF, not a chip list.
     The principle this case defends is unchanged and is the reason the
     assertions moved rather than went away: WHO IS IN the pool was
     never the secret, only what they picked. A named row per player
     says who is in more completely than a chip did, and it is the same
     screen the Grid becomes on Thursday instead of a different one.

     The second half of the principle is asserted harder than before.
     "Readiness must not leak" used to be a note about a tick nobody had
     built; now that every player has a row with sixteen cells in it,
     the cells are where it WOULD leak — so this checks that every cell
     on somebody else's row is identical, which makes a picked game and
     an unpicked one indistinguishable. */
  ok('grid: every member has a named row', g.rows === 8, String(g.rows));
  ok('grid: exactly one row is yours', g.mine === 1, String(g.mine));
  ok('grid: no chip list is used any more', g.chips === 0, String(g.chips));
  ok('grid: nobody else\'s cells reveal whether they have picked',
     g.otherCellClasses.length > 0 &&
     new Set(g.otherCellClasses).size === 1 &&
     /hidden/.test(g.otherCellClasses[0]),
     JSON.stringify([...new Set(g.otherCellClasses)]));

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
             /* v1.42.0: the tick is the team box, in the colour of the
                team taken, and it must be the team the card has lit. */
             boxes: [...document.querySelectorAll('.stakebar:not(.empty)')].map(b => {
               const card = b.closest('.card'), pk = b.querySelector('.pk');
               const lit = card.querySelector('.side.won');
               return { code: (b.textContent.match(/\b([A-Z]{2,3}) ·/) || [])[1] || '',
                        lit: lit ? (lit.querySelector('.mark span') || {}).textContent : '',
                        tick: !!(pk && pk.classList.contains('pk-ok')),
                        box: pk ? getComputedStyle(pk).backgroundColor : null,
                        litBg: lit ? getComputedStyle(lit).backgroundColor : null,
                        ink: pk ? getComputedStyle(pk).color : null }; }),
             /* A row that overflows its button silently truncates the very
                reassurance it exists to give. */
             clipped: [...document.querySelectorAll('.stakebar')]
                        .some(e => e.scrollWidth > e.clientWidth + 1) };
  });
  ok('there are staked games to check', bars.n > 0, String(bars.n));
  /* SUBMITTED, not SAVED. Every form anybody has filled in taught them
     that "saved" is a draft and "submitted" is turned in, so "Saved" left
     standing the exact doubt this line exists to remove. */
  /* v1.42.0 THE TEAM BOX REPLACED "✓ Submitted". Lee chose it from the
     round 5 to 8 mockups: a box in the colour of the team taken, with a
     tick, then the team, then how long there is to change it. The two
     properties this case exists for still hold and are still graded:
     it reassures (a ticked box against the team's name, on every staked
     card) and it does not read as locked (it names kickoff). */
  ok('every staked card shows a ticked team box and the team taken',
     bars.boxes.length === bars.n && bars.boxes.every(b => b.tick && b.code && b.code === b.lit),
     JSON.stringify(bars.boxes.filter(b => !(b.tick && b.code === b.lit)).slice(0, 3)));
  ok('the box is in the colour of the team it names',
     bars.boxes.every(b => b.box && b.box === b.litBg),
     JSON.stringify(bars.boxes.filter(b => b.box !== b.litBg).slice(0, 3)));
  ok('and it does not hedge with the draft word',
     bars.labels.every(l => !/\bsaved\b/i.test(l)), bars.labels[0]);
  ok('and it names how long there is to change it',
     bars.labels.every(l => /· change until kickoff$/i.test(l)), JSON.stringify(bars.labels.slice(0, 3)));
  ok('the word "stake" no longer labels the row',
     bars.labels.every(l => !/your stake/i.test(l)), bars.labels[0]);
  ok('nothing is clipped at phone width', bars.clipped === false);

  /* --hit (#2F6E26) measures 5.09:1 on the card's #EDE8DE; --live
     (#63B257) measures 2.14 and would have failed. This is the assertion
     that stops somebody "brightening" it later. */
  ok('the tick is drawn in white on the team colour',
     bars.boxes.every(b => b.ink === 'rgb(255, 255, 255)'), JSON.stringify(bars.boxes[0]));

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
    /* th.gm is the GAME columns only; the tiebreaker header is th.tbcol
       precisely so this count stays honest. When it was a th.gm too this
       read 17, payOracle used n=17, and every payout came out a point
       high — 15 points across 15 hits, which is what this case caught. */
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
      cells: [...tr.querySelectorAll('td:not(.tbtd) .cell')].map(c => ({
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
console.log('\n43b. A live column must never say NOBODY PICKED while it waits');
{
  /* THE BUG, REPORTED FROM A REAL SUNDAY NIGHT KICKOFF. Lee sat on the
     Grid as the Rams game locked. The column header went LIVE the instant
     the clock passed kickoff, and then every player's cell showed the DID
     NOT PICK dash for over two minutes before the picks appeared.

     TWO CLOCKS, AND ONLY ONE OF THEM WAS BEING ASKED. The cell decided
     whether to show a pick with `isLive(g)`, which is local arithmetic
     and flips exactly at kickoff. The picks arrive from a Firestore query
     whose bound is deliberately behind now, because the rules compare
     revealAt against the SERVER clock and refuse the whole query if the
     client asks for more than it can prove. So between kickoff and that
     bound, every cell was told to render a pick that could not possibly
     have arrived, and drew the symbol meaning the player missed the game.

     Nothing was wrong with the data. The screen told 28 people they had
     all failed to pick, which is the most alarming thing available to it
     and was not true.

     SEALED IS THE HONEST SYMBOL. It means "not revealed yet". */
  const GAP = 6000;
  const KICK_IN = 3000;
  const { ctx, page, errors } = await open({
    startISO: new Date(Date.now() + KICK_IN).toISOString(),
    weeks: 1, gamesPerWeek: 3, playerCount: 8, revealSkewMs: GAP });
  const kickAt = Date.now() + KICK_IN;
  await page.click('[data-tab="grid"]').catch(() => {});

  /* YOUR OWN ROW IS COUNTED SEPARATELY THROUGHOUT. It is visible at every
     moment by design, so folding it into the totals lets a build that
     reveals nobody else look identical to one that works. The first
     version of this reader did exactly that and mutation 60 walked
     straight through it. */
  const readGrid = () => page.evaluate(() => {
    const out = { dash: 0, sealed: 0, filledOthers: 0, filledMine: 0, live: 0 };
    document.querySelectorAll('#v-grid tbody tr').forEach(tr => {
      if (tr.classList.contains('poolrow')) return;
      const isMe = tr.classList.contains('me');
      tr.querySelectorAll('td:not(.tbtd):not(.tot):not(.pl) .cell').forEach(c => {
        if (c.classList.contains('none')) out.dash++;
        else if (c.classList.contains('hidden')) out.sealed++;
        else if (isMe) out.filledMine++;
        else out.filledOthers++;
      });
    });
    out.live = document.querySelectorAll('#v-grid .hstate.live, #v-grid .live').length;
    return out;
  });

  const pre = await readGrid();
  ok('the fixture has a grid of cells to grade',
     pre.sealed + pre.dash + pre.filledOthers > 0, JSON.stringify(pre));
  ok('before kickoff everything is sealed', pre.dash === 0, JSON.stringify(pre));

  /* Just past kickoff, deliberately well short of the bound. This is the
     exact window the bug lived in. */
  await page.waitForTimeout((kickAt - Date.now()) + 900);
  const during = await readGrid();
  ok('the fixture really is inside the gap', Date.now() < kickAt + GAP,
     String(kickAt + GAP - Date.now()) + 'ms left');
  ok('a kicked-off game shows NO did-not-pick dashes while it waits',
     during.dash === 0, JSON.stringify(during));
  ok('it is still showing sealed cells instead',
     during.sealed > 0, JSON.stringify(during));

  /* AND THEN IT MUST ACTUALLY OPEN. A fix that just sealed forever would
     pass every assertion above and be worse than the bug.

     WAIT TO AN ABSOLUTE MOMENT, not for a duration: the re-subscribe
     fires at kickoff + margin + 5s, and a relative wait measured from
     wherever page load finished lands short of it often enough to flap. */
  await page.waitForTimeout(Math.max(0, (kickAt + GAP + 5000 + 5000) - Date.now()));
  const after = await readGrid();
  ok('once the bound passes the kickoff, the picks fill in on their own',
     after.filledOthers > 0, JSON.stringify(after));
  ok('and they are not dashes', after.dash === 0, JSON.stringify(after));
  ok('no page errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

console.log('\n43c. The app schedules on the margin queries USE, not the fallback');
{
  /* THE WIRING THIS PINS. firebase-init now starts at a 5 second margin
     and widens to CLOCK_SKEW_MS only when a device's clock turns out to
     be fast enough for Firestore to refuse. index.html has to read the
     live value; reading CLOCK_SKEW_MS would schedule every re-subscribe
     two minutes late on the phones that never needed the margin, which is
     nearly all of them, and the two-minute wait would be back.

     So: a fast margin of 1.5 seconds with the SAFE one left at the full
     two minutes. Reading the right number opens the column in seconds.
     Reading CLOCK_SKEW_MS opens it in 120 and this case sees nothing. */
  const { ctx, page, errors } = await open({
    startISO: new Date(Date.now() + 2500).toISOString(),
    weeks: 1, gamesPerWeek: 2, playerCount: 6,
    revealSkewMs: 1500, skewMs: 120000 });
  const kickAt = Date.now() + 2500;
  await page.click('[data-tab="grid"]').catch(() => {});
  await page.waitForTimeout(Math.max(0, (kickAt + 1500 + 5000 + 5000) - Date.now()));
  /* NOT YOUR OWN ROW. `shown` is `r.p===ME || ...`, so your own cells are
     visible regardless of any margin, and counting them made this case
     pass against a build scheduling on the two-minute fallback. */
  const filled = await page.evaluate(() => {
    let n = 0, mine = 0;
    document.querySelectorAll('#v-grid tbody tr').forEach(tr => {
      if (tr.classList.contains('poolrow')) return;
      const isMe = tr.classList.contains('me');
      tr.querySelectorAll('td:not(.tbtd):not(.tot):not(.pl) .cell').forEach(c => {
        if (c.classList.contains('hidden') || c.classList.contains('none')) return;
        if (isMe) mine++; else n++; });
    });
    return { others: n, mine };
  });
  ok('the fixture has somebody else to reveal', filled.mine >= 0);
  ok('OTHER players opened within seconds of kickoff, not minutes',
     filled.others > 0, 'other-player cells filled: ' + filled.others
       + ' (own row: ' + filled.mine + '), '
       + Math.round((Date.now() - kickAt) / 1000) + 's after kickoff');
  ok('no page errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n43d. How the app is used, and nothing about who used it');
{
  /* WHAT THIS IS FOR. Lee had no way to see how many people open the
     app, whether from the Home Screen or a browser tab, or which screens
     they sit on. The question he actually cares about is how long a
     player stays on Picks while the games run, because that is the one
     that says what to improve next season.

     THE PROMISE THAT MATTERS MORE THAN THE NUMBERS. He asked for this
     anonymous, and anonymity is the kind of property that decays: a
     field gets added, nothing objects, and a curiosity has quietly
     become surveillance of 28 friends. firestore.rules refuses any key
     outside the six, and this case asserts the client never even tries.

     AND VISIBLE TIME ONLY. A phone in a pocket with Picks open would
     otherwise report hours of rapt attention on the tab that happened to
     be showing, which inverts the thing being measured. */
  const { ctx, page, errors } = await open({
    startISO: new Date(Date.now() + 3 * 864e5).toISOString(),
    weeks: 1, gamesPerWeek: 4, playerCount: 6 });

  const usage = () => page.evaluate(() => (window.__usage || []).slice());
  const flush = () => page.evaluate(() => {
    /* What backgrounding does, without actually needing a background. */
    Object.defineProperty(document, 'visibilityState',
      { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const wake = () => page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState',
      { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });

  ok('nothing is written just for opening the app',
     (await usage()).length === 0, JSON.stringify(await usage()));

  await page.waitForTimeout(1200);          // on Picks, the default tab
  await page.click('[data-tab="grid"]').catch(() => {});
  await page.waitForTimeout(800);
  await page.click('[data-tab="standings"]').catch(() => {});
  await page.waitForTimeout(600);
  await flush();
  await page.waitForTimeout(300);

  const rows = await usage();
  ok('backgrounding writes exactly one row', rows.length === 1,
     JSON.stringify(rows));
  const r = rows[0] || {};

  /* ---- THE ANONYMITY, ASSERTED ON THE WHOLE PAYLOAD ---- */
  const flat = JSON.stringify(r);
  ok('the row carries no uid, name or email field',
     !('uid' in r) && !('name' in r) && !('email' in r), Object.keys(r).join());
  /* A uid in this app is `u_` plus 24 hex, and a name or address would
     show up as a string with an @ or a space. Asserting on the KEYS
     alone would miss a value smuggled into `mode` or `id`. */
  ok('and nothing uid-shaped anywhere in its values',
     !/u_[0-9a-f]{8}/.test(flat) && !/@/.test(flat), flat.slice(0, 160));
  ok('its keys are only the ones the security rule permits',
     Object.keys(r).every(k =>
       ['id', 'mode', 'started', 'visibleMs', 'tabs', 'wk'].includes(k)),
     Object.keys(r).join());

  /* ---- THE TIMINGS ---- */
  ok('it says how the app was opened',
     r.mode === 'browser' || r.mode === 'standalone', r.mode);
  ok('it recorded on-screen time', r.visibleMs > 0, r.visibleMs);
  ok('the tabs it reports are the five real ones',
     Object.keys(r.tabs || {}).sort().join() ===
       'grid,help,picks,settings,standings', Object.keys(r.tabs || {}).join());
  /* THE ATTRIBUTION IS THE WHOLE FEATURE. Time must land on the tab it
     was spent on, not the one opened next, which is why the handler
     banks BEFORE state.tab moves. Picks was open longest, so if the
     banking were off by one the largest number would sit on Grid. */
  ok('picks holds the most time, because it was open longest',
     r.tabs.picks > r.tabs.grid && r.tabs.picks > r.tabs.standings,
     JSON.stringify(r.tabs));
  ok('grid and standings both recorded something',
     r.tabs.grid > 0 && r.tabs.standings > 0, JSON.stringify(r.tabs));
  ok('a tab never opened stays at zero', r.tabs.help === 0, r.tabs.help);
  const summed = Object.values(r.tabs).reduce((a, b) => a + b, 0);
  ok('the tabs add up to the on-screen total',
     Math.abs(summed - r.visibleMs) <= 60, [summed, r.visibleMs]);

  /* ---- AND THE ONE THAT MAKES THE NUMBERS MEAN ANYTHING ---- */
  const before = r.visibleMs;
  await page.waitForTimeout(2500);          // 2.5s spent HIDDEN
  /* FLUSH WITHOUT WAKING FIRST, and that ordering is the whole test.

     The first version of this woke the page and then flushed, which
     passes whatever the code does: coming back to visible resets the
     clock, so the background stretch is gone before anything can bank
     it. Removing the line that stops the clock left this green. Found
     by mutating exactly that.

     Nor does pagehide work here, for a different reason: that handler
     stops the clock itself before flushing, so it masks the same defect
     from the other side. The sequence that actually exposes it is a
     SECOND visibilitychange while still hidden, which iOS genuinely
     fires in bursts on an app switch — the code's own comments say so.
     With the clock left running, that second pass banks the whole
     background stretch. With it stopped, there is nothing to bank. */
  await flush();
  await page.waitForTimeout(300);
  const after = (await usage()).slice(-1)[0] || {};
  ok('a second flush rewrites the same session rather than starting one',
     after.id === r.id, [r.id, after.id]);
  /* THE DEFECT THIS CATCHES. Leave the clock running across a background
     and a phone in a pocket reports the whole night on whatever tab was
     last showing, which inverts the thing being measured. */
  ok('time spent in the background is NOT counted',
     (after.visibleMs || 0) - before < 500,
     'grew by ' + ((after.visibleMs || 0) - before)
       + 'ms over a 2500ms background');
  await wake();
  ok('no page errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

console.log('\n43e. A failed usage write must never reach a player');
{
  /* THE TAB-SWITCH GUARD IS NOT TESTED HERE, AND THAT IS DELIBERATE.

     The usage call sits inside the tab click handler, wrapped in a try
     so that an anonymous counter can never stop somebody reaching their
     picks. The obvious test is to make it throw and check the tab still
     switches — and that test was written, passed, and was then found to
     be inert: `usageTab` is declared inside a module, so the
     `window.usageTab = () => { throw }` used to break it overrides
     nothing at all. It passed identically with the guard REMOVED, which
     is the only reason it was caught.

     There is no injection point from out here that reaches a
     module-scoped function without breaking half the app on the way
     past. So the guard is covered where it can honestly be covered: the
     audit asserts the call is wrapped, and a mutation that unwraps it
     turns the audit red. That is a source check, not a behaviour check,
     and saying so is better than an assertion that grades nothing. */
  const { ctx, page, errors } = await open({
    startISO: new Date(Date.now() + 3 * 864e5).toISOString(),
    weeks: 1, gamesPerWeek: 4, playerCount: 6, usageError: 'nope' });
  await page.waitForTimeout(900);
  await page.click('[data-tab="grid"]').catch(() => {});
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState',
      { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(400);
  ok('a rejected usage write raises no page error',
     errors.length === 0, errors[0] || '');
  const toast = await page.evaluate(() =>
    (document.body.innerText || '').toLowerCase());
  ok('and says nothing to the player about it',
     !/usage|analytic|telemetr/.test(toast));
  /* AND THE APP IS STILL THERE. A throw inside the handler could take
     out whatever else it was about to do. */
  ok('the app is still rendered', await page.evaluate(
     () => !!document.querySelector('.tab.on')));
  await ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n43f. The picks view must not jump while somebody is reaching for it');
{
  /* FOUND IN PRODUCTION, BY MEASUREMENT, NOT BY LOOKING. Cloudflare Web
     Analytics reported CLS 0.122 against #v-picks on 29 of 33 real loads
     across a Sunday, which is very nearly every launch. Reproduced frame
     by frame against this build:

       t= 40ms   #weeks 130/9  (0 children)   #v-picks at y 140
       t=171ms   #weeks 130/53 (1 child)      #v-picks at y 184

     The week strip is an empty 9px sliver until the season loads, then
     it appears at its full 53px and shoves the entire picks view down 44
     pixels. Anybody reaching for a team in that window watches the card
     move out from under their thumb, and on a slow connection that
     window is seconds rather than milliseconds.

     `min-height` on .weeks fixes it, and the number is arithmetic: a .wk
     button is 44px and the strip has 9px of bottom padding.

     WHY THIS IS GRADED ON THE BROWSER'S OWN NUMBER rather than on a
     pixel comparison: CLS is what real phones report and what the
     dashboard shows, so asserting the same quantity means this test and
     the production measurement cannot disagree about what improved. */
  const { ctx, page, errors } = await open({
    startISO: new Date(Date.now() + 3 * 864e5).toISOString(),
    weeks: 1, gamesPerWeek: 16, playerCount: 12 }, { observeShifts: true });
  await page.waitForTimeout(3500);

  const shifts = await page.evaluate(() => window.__shifts || []);
  const cls = shifts.reduce((a, x) => a + x.value, 0);
  ok('the observer actually ran', Array.isArray(shifts), typeof shifts);
  /* 0.1 is the browser's own "good" boundary. This build measures about
     0.004; before the fix it was 0.111, so the threshold has a lot of
     room either side and is not tuned to today's exact number. */
  ok('cumulative layout shift is inside the good band',
     cls < 0.05, 'CLS ' + cls.toFixed(4) + '  ' + JSON.stringify(shifts.slice(0, 2)));

  /* AND THE NAMED ELEMENT SPECIFICALLY. A future change could keep CLS
     low overall while moving this one, and #v-picks is the tab people
     are touching. */
  const movedPicks = shifts.some(x =>
    (x.sources || []).some(src => /#v-picks/.test(src) && /y (\d+) -> (?!\1\b)/.test(src)));
  ok('and the picks view itself never moves',
     !movedPicks, JSON.stringify(shifts.filter(x =>
       (x.sources || []).some(s => /#v-picks/.test(s))).slice(0, 2)));
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
      /* .cd[data-cd] is the RIGHT-hand slot — the one tick() writes the
         countdown into. Since P1 the live clock on the LEFT is a .cd
         too, so a bare '.meta .cd' returns the clock and a case reading
         it for "In progress" silently gets "5:38 AM" instead. */
      const cd = card.querySelector('.meta .cd[data-cd]');
      if (!cd) return;
      out.push({ label: cd.textContent.trim(),
                 cls: cd.className,
                 dot: getComputedStyle(cd, '::before').content });
    });
    return out;
  });

  /* THE BUG IS NOW UNREACHABLE BY CONSTRUCTION, and that is a stronger
     fix than the class being right — so this case changed shape rather
     than being deleted.

     A final card no longer has a `.cd[data-cd]` chip at all: its whole
     meta row is replaced by the centred FINAL head, which has no `.cd`,
     no `::before` and nothing to animate. So the thing to assert is
     that the chip is ABSENT from a finished card and PRESENT on a live
     one — if a final card ever grows one again, the pulse can come back
     with it, and this notices. */
  const cards = await read();
  ok('a finished card has no countdown chip to mis-class',
     cards.length === 0, JSON.stringify(cards));
  const heads = await page.evaluate(() => [...document.querySelectorAll('#slate .card')]
    .map(c => {
      const fin = c.querySelector('.meta.fmeta .fin');
      return fin ? { txt: fin.textContent.trim(),
                     dot: getComputedStyle(fin, '::before').content } : null;
    }));
  ok('the week has finished games to check', heads.filter(Boolean).length > 0,
     JSON.stringify(heads));
  ok('each one is headed Final', heads.filter(Boolean).every(h => /^Final/.test(h.txt)),
     JSON.stringify(heads.filter(Boolean).map(h => h.txt)));
  /* The assertion that kills the bug: no ::before means no dot, and no
     dot means nothing to animate. */
  ok('and carries no pulsing dot',
     heads.filter(Boolean).every(h => h.dot === 'none' || h.dot === '' || h.dot === 'normal'),
     JSON.stringify(heads.filter(Boolean).map(h => h.dot)));

  /* The pulse must SURVIVE for a game that really is live, or this fix
     has just deleted the feature instead of scoping it. */
  const live2 = await open({ startISO: new Date(Date.now() - 60000).toISOString(),
                             weeks: 1, gamesPerWeek: 3 });
  await live2.page.waitForTimeout(500);
  const liveCards = await live2.page.evaluate(() =>
    [...document.querySelectorAll('#slate .card .meta .cd[data-cd]')]
      .map(cd => ({ label: cd.textContent.trim(), cls: cd.className })));
  const inProg = liveCards.filter(c => /in progress/i.test(c.label));
  ok('a game actually in progress is still classed live',
     inProg.length > 0 && inProg.every(c => /\blive\b/.test(c.cls)),
     JSON.stringify(liveCards));
  await live2.ctx.close();

  ok('no page errors', errors.length === 0, errors[0] || '');
  await ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n46. A live score must appear without waiting on any scheduler');
{
  /* THE BUG: for the whole of week 1 a game in progress showed IN
     PROGRESS and no numbers, because the score on a card depended on a
     scheduled job writing it to Firestore first, and no host would run
     that job. Cloudflare's egress is denied by Akamai (`espn 403 ::
     Access Denied`). GitHub Actions ran green in 23 seconds when
     invoked by hand and never once fired its own cron — the workflow
     sat on main eleven hours before its first window opened, then
     skipped ~16 consecutive ticks inside it: "0 workflow runs".

     The badge made it worse rather than revealing it: isLive() is
     Date.now() >= kick, pure clock, so IN PROGRESS appeared exactly on
     time whether or not one byte had ever been written about the game.
     Nothing on the screen distinguished "0-0" from "nobody asked".

     ESPN answers a BROWSER, so pullEspn() asks from the phone. These
     cases pin the behaviour AND the four properties that make it safe
     to run in a live pool: it cannot move a point, it does not fire
     when there is nothing live, it prefers the server once a game is
     final, and every failure path lands back on today's screen rather
     than a wrong one. */
  const ev = (away, home, as, hs, state = 'in') => ({
    competitions: [{ status: { type: { state } },
      competitors: [
        { homeAway: 'away', team: { abbreviation: away }, score: as == null ? null : String(as) },
        { homeAway: 'home', team: { abbreviation: home }, score: hs == null ? null : String(hs) }] }] });

  /* Week 1 game 0 in the fixture is DET @ GB (TEAMS[7], TEAMS[8]), and
     at kickoff-minus-a-minute it is live with status 'scheduled' and
     both scores null — the exact state that showed nothing all week. */
  const justLive = () => new Date(Date.now() - 60000).toISOString();
  const cards = pg => pg.evaluate(() =>
    [...document.querySelectorAll('#slate .card')].map(c => ({
      teams: [...c.querySelectorAll('.side .team')].map(t => t.textContent.trim()),
      scr:   [...c.querySelectorAll('.side .scr')].map(t => t.textContent.trim()),
      cd:    (c.querySelector('.meta .cd[data-cd]') || {}).textContent || '',
      /* TWO PLACES NOW, BECAUSE THE CARD HAS TWO STATES. While a game
         is being played its bottom strip is the lock band; once it is
         final that strip is gone and the score lives in the centred
         head. A reader that only knew about the band came back empty
         the moment the server wrote `final`, which is exactly the
         transition this case is about. */
      band:  (c.querySelector('.lockband') || {}).textContent || '',
      head:  (c.querySelector('.meta.fmeta .fin') || {}).textContent || '',
      bar:   (c.querySelector('.resbar') || {}).textContent || '' })));

  {
    const { ctx, page, errors } = await open({
      startISO: justLive(), weeks: 1, gamesPerWeek: 3,
      espn: [ev('DET', 'GB', 14, 17)] });
    await page.waitForTimeout(1200);

    const cs = await cards(page);
    const g0 = cs[0];
    ok('the fixture game under test is the live one',
       /in progress/i.test(g0.cd), JSON.stringify(cs.map(c => c.cd)));
    /* THE ASSERTION THAT KILLS THE BUG. Firestore holds no score for
       this game; the only place 14 and 17 can have come from is the
       phone's own read. */
    ok('a live score the server never wrote still reaches the card',
       g0.scr.join('-') === '14-17', JSON.stringify(g0));

    const calls = await page.evaluate(() => window.__espnCalls.slice());
    ok('and it asked ESPN for the right season, week and type',
       calls.length > 0 && /seasontype=2/.test(calls[0]) &&
       /week=1/.test(calls[0]) && /dates=2026/.test(calls[0]),
       JSON.stringify(calls));

    /* THE LOOP MUST NOT RE-POLL ON EVERY TICK. espnLoop() is called once
       a second from tick(); a version that cleared and restarted its
       interval on each call would hit ESPN every second — sixty times
       the intended rate, per phone, which is how an address gets blocked
       halfway through a Sunday.

       NOT COVERED, and worth saying so: the opposite mutation — one that
       restarts the interval WITHOUT pulling — is indistinguishable here,
       because its symptom is "the score updates once and then never
       again" and observing that needs a real 60-second wait. The
       idempotence note on espnLoop() is the only defence there. */
    await page.waitForTimeout(2500);
    const calls2 = await page.evaluate(() => window.__espnCalls.length);
    ok('and it polls once, not once per tick', calls2 === 1, String(calls2));

    /* SCORING MUST BE UNTOUCHED. `winner` and `status` come from the
       server alone, so a score arriving from a browser must not flip
       the game to final or bank anybody's points. */
    /* v1.42.0: the strip reads "Locked" and your pick "if it holds";
       "In progress" moved to the green clock above it. */
    ok('the game is still in progress, not final',
       /^\s*Locked/.test(g0.band) && /if it holds/.test(g0.band) && !/final/i.test(g0.band), g0.band);
    ok('and points are still only "if it holds", never banked',
       !/\+\d+\s*pts/.test(g0.band), g0.band);

    ok('no page errors', errors.length === 0, errors[0] || '');
    await ctx.close();
  }

  /* ONCE THE SERVER SAYS FINAL, THE SERVER WINS. This is the case that
     could contradict the Grid: a phone holding a stale in-progress
     score while the standings were computed from the real final one.
     Two numbers on one screen that cannot both be true is how people
     stop trusting a scoring app. */
  {
    const { ctx, page, errors } = await open({
      startISO: justLive(), weeks: 1, gamesPerWeek: 3,
      espn: [ev('DET', 'GB', 14, 17)] });
    await page.waitForTimeout(1200);
    const before = await cards(page);
    ok('the phone is holding an in-progress score first',
       before[0].scr.join('-') === '14-17', JSON.stringify(before[0]));

    await page.evaluate(() => {
      const gs = window.__weekGames();
      gs[0].status = 'final'; gs[0].winner = gs[0].home;
      gs[0].awayScore = 20; gs[0].homeScore = 23;
      window.__pushWeek(gs);
    });
    await page.waitForTimeout(400);
    const after = await cards(page);
    ok("the server's final score replaces the phone's, not the other way round",
       after[0].scr.join('-') === '20-23', JSON.stringify(after[0]));
    /* The card's own summary of the game has to agree with the two
       numbers on the team rows. That summary is the head now, not the
       band — and it names the winner as well as the score, so check
       both: the server said the HOME team won 23-20. */
    ok('and the head agrees with it',
       /23-20/.test(after[0].head), JSON.stringify([after[0].head, after[0].band]));
    ok('and the head names the team the server said won',
       /Final\s*·\s*[A-Z]{2,3}\s*23-20/.test(after[0].head.trim()), after[0].head);
    ok('while the live lock band has gone with the live state',
       after[0].band === '', JSON.stringify(after[0].band));

    ok('no page errors', errors.length === 0, errors[0] || '');
    await ctx.close();
  }

  /* NOTHING LIVE, NOTHING ASKED. A poll that runs on a Tuesday is a
     poll that will eventually get somebody rate-limited, and it is also
     a timer nobody remembered starting. */
  {
    const { ctx, page, errors } = await open({
      weeks: 1, gamesPerWeek: 3, espn: [ev('DET', 'GB', 14, 17)] });
    await page.waitForTimeout(1200);
    const calls = await page.evaluate(() => window.__espnCalls.slice());
    ok('a week with no game under way never touches ESPN',
       calls.length === 0, JSON.stringify(calls));
    ok('no page errors', errors.length === 0, errors[0] || '');
    await ctx.close();
  }

  /* EVERY FAILURE PATH MUST LAND ON TODAY'S SCREEN, not a wrong one.
     These are the whole reason this can ship into a live pool: the
     worst case is the card players already had. */
  for (const [mode, why] of [['down', 'ESPN returns 503'],
                             ['throw', 'the network is gone'],
                             ['junk', 'ESPN returns something that is not JSON']]) {
    const { ctx, page, errors } = await open({
      startISO: justLive(), weeks: 1, gamesPerWeek: 3, espn: mode });
    await page.waitForTimeout(1200);
    const cs = await cards(page);
    ok(`when ${why}, the card shows no score rather than a wrong one`,
       cs[0].scr.length === 0, JSON.stringify(cs[0]));
    ok(`and ${why} raises nothing at the player`,
       errors.length === 0, errors[0] || '');
    await ctx.close();
  }

  /* A SCORE ESPN HAS NOT POSTED MUST NOT BECOME 0-0.

     The app calls a game live off the clock alone (isLive is
     Date.now() >= kick), so at kickoff there is always a window where
     the card says IN PROGRESS and ESPN still reports the game as 'pre'
     with null scores. `parseInt(null)` is NaN, which is why the guards
     are there — but `|| 0` is the obvious-looking tidy-up, and it would
     paint a confident 0-0 on a game that has not kicked a ball.

     THE FIRST VERSION OF THIS TEST WAS VACUOUS and deserves recording:
     it sent 'pre' for a game four days out and asserted no score
     appeared. Of course none did — scoreOf returns null for anything
     not yet live, whatever ESPN said, so the assertion passed with the
     guards deliberately removed. The game ESPN is quiet about has to be
     the LIVE one or the test proves nothing. */
  for (const [state, why] of [['pre', "ESPN still calls the game scheduled"],
                              ['in',  'ESPN has it live but has posted no score']]) {
    const { ctx, page, errors } = await open({
      startISO: justLive(), weeks: 1, gamesPerWeek: 3,
      espn: [ev('DET', 'GB', null, null, state)] });
    await page.waitForTimeout(1200);
    const cs = await cards(page);
    ok('the game under test is live on the clock', /in progress/i.test(cs[0].cd), cs[0].cd);
    ok(`when ${why}, the card shows no score rather than 0-0`,
       cs[0].scr.length === 0, JSON.stringify(cs[0]));
    ok('no page errors', errors.length === 0, errors[0] || '');
    await ctx.close();
  }

  /* AN UNKNOWN MATCHUP IS IGNORED, NOT GUESSED AT. ESPN has renamed
     teams mid-season before (WAS -> WSH, LA -> LAR). A rename must cost
     that one card its live number, never put a score on the wrong
     game. */
  {
    const { ctx, page, errors } = await open({
      startISO: justLive(), weeks: 1, gamesPerWeek: 3,
      espn: [ev('ZZZ', 'QQQ', 31, 3)] });
    await page.waitForTimeout(1200);
    const cs = await cards(page);
    ok('a matchup the app does not know scores nothing',
       cs.every(c => c.scr.length === 0), JSON.stringify(cs.map(c => c.scr)));
    ok('no page errors', errors.length === 0, errors[0] || '');
    await ctx.close();
  }
}

/* ------------------------------------------------------------------ */
console.log('\n47. Season and This Week must not disagree about the same week');
{
  /* THE BUG, reported from a live pool with 27 players in it.

     Mid-week-1, with two of sixteen games final, the two Standings tabs
     showed different numbers for the same people:

       THIS WEEK            SEASON
       Lee      16          Lee      16
       Bob      15          Mario    15
       Mario    15          Star     15
       Ron Ron  15          Charles  13
       Star     15          Dr House 12
       Dr House 14          TK       11
       Charles  13          Bob      10
       Chris    12          Chris    10

     The tell was who matched. Every player whose second pick was WRONG
     agreed across both tabs; every player who got it RIGHT was short on
     the Season tab by exactly the stake they had on it. Ron Ron fell out
     of the top eight entirely. And every Season row read "1 of 2
     correct" — the same figure for all of them, which is not something a
     per-player calculation produces.

     So the Season tab was showing the last scoring run's snapshot,
     banked when the opener was final and the second game was not, while
     This Week showed the live calculation. Both were internally
     consistent; they were answers to different moments.

     THE CAUSE, and it is one character. weekSum() decides live-vs-server
     with `const loaded = w === state.week`. The weekly branch passes
     state.week, a NUMBER. The season branch sums `for (const w in WEEKS)`
     — and a for-in key is a STRING. "1" === 1 is false, so `loaded` was
     false for every week including the one on screen, `!loaded` was
     true, and the server record won whenever one existed.

     Which makes the comment above that line an accurate description of
     behaviour the code did not have: "Live figures ONLY for the week
     currently loaded" was true on one tab and false on the other.

     This test pins the invariant rather than the mechanism: with a
     single week in the fixture, the Season total and the This Week total
     are the same sum and must agree to the point. The stub deliberately
     returns a server record whose points are unrelated to the picks, so
     a test cannot pass by accident if the wrong source is read. */
  const { ctx, page, errors } = await open({
    // One game final, the rest of the week still to come — the exact
    // shape that makes a scoring snapshot disagree with live play.
    startISO: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
    weeks: 1, gamesPerWeek: 4 });

  const board = pg => pg.evaluate(() =>
    [...document.querySelectorAll('#board .row')].map(r => ({
      name: (r.querySelector('.who b') || {}).textContent || '',
      pts:  (r.querySelector('.pts b') || {}).textContent || '',
      sub:  (r.querySelector('.who .mono') || {}).textContent || '' })));

  await page.click('[data-tab="standings"]').catch(() => {});
  await page.waitForTimeout(500);
  await page.click('#standTabs [data-stand="week"]').catch(() => {});
  await page.waitForTimeout(400);
  const wkRows = await board(page);

  await page.click('#standTabs [data-stand="season"]').catch(() => {});
  await page.waitForTimeout(400);
  const seRows = await board(page);

  ok('both tabs rendered a table', wkRows.length > 2 && seRows.length > 2,
     `week=${wkRows.length} season=${seRows.length}`);

  const seBy = Object.fromEntries(seRows.map(r => [r.name, r.pts]));
  const mismatched = wkRows.filter(r => seBy[r.name] !== undefined
                                     && seBy[r.name] !== r.pts);
  /* THE ASSERTION THAT KILLS THE BUG. */
  ok('every player has the same points on both tabs for a one-week season',
     mismatched.length === 0,
     JSON.stringify(mismatched.map(r => [r.name, r.pts, seBy[r.name]])).slice(0, 300));

  /* The order follows from the points, but check it anyway: the reported
     symptom people actually noticed was a player vanishing from the top
     of one table while sitting fourth on the other. */
  ok('and both tabs rank them in the same order',
     wkRows.map(r => r.name).join('|') === seRows.map(r => r.name).join('|'),
     `week=${wkRows.map(r => r.name).slice(0, 5).join(',')} season=${seRows.map(r => r.name).slice(0, 5).join(',')}`);

  /* "1 of 2 correct" on every row was the loudest clue and is worth its
     own assertion: a per-player figure that is identical for everybody
     is a figure being read from the wrong place. */
  const subs = seRows.map(r => r.sub.match(/(\d+) of (\d+) correct/)).filter(Boolean);
  ok('the correct-count is not the same value for every player',
     subs.length > 2 && new Set(subs.map(m => m[1])).size > 1,
     JSON.stringify(seRows.slice(0, 6).map(r => r.sub)));

  /* AND THE LINE ITSELF, because that sentence is what a player reads.
     It is assembled from two sources — `${hits} of ${gp} correct` —
     where hits came from weekSum and gp was counted live on the phone.
     With the bug that put a STALE number and a FRESH one in the same
     sentence: "1 of 2 correct" for a player who had gone 2 for 2, with
     the Grid beside it showing both picks green. Checking points alone
     would not have caught a future edit that reads hits from somewhere
     else again. */
  const hitsOf = rows => Object.fromEntries(rows.map(r =>
    [r.name, (r.sub.match(/(\d+) of (\d+) correct/) || [,'?','?']).slice(1, 3).join('/')]));
  const wkHits = hitsOf(wkRows), seHits = hitsOf(seRows);
  const hitMismatch = Object.keys(wkHits).filter(n =>
    seHits[n] !== undefined && seHits[n] !== wkHits[n]);
  ok('and the "X of Y correct" line agrees on both tabs',
     hitMismatch.length === 0,
     JSON.stringify(hitMismatch.map(n => [n, wkHits[n], seHits[n]])).slice(0, 300));

  ok('no page errors', errors.length === 0, errors[0] || '');
  await ctx.close();

  /* THE OTHER HALF OF THE SAME FUNCTION, and it had no test at all —
     which I only discovered by mutating the fix above. Replacing the
     comparison with `const loaded = true` — the obvious-looking way to
     "just always use the live figure" — passed all 320 checks.

     It must not. weekSum's comment records that this already happened in
     production: loadWeek() keeps one week of everyone's picks in memory,
     so weekPoints() finds no picks for any past week. Prefer the client
     calculation for a week that is not loaded and that week's points
     vanish from the season total for every player at once — and
     permanently, for any week that never fully finalises.

     Mid-Sunday, the way a player reaches this is entirely ordinary:
     tap week 2 to look at next week's slate, tap Standings, and the
     season table has forgotten the season.

     The invariant, stated so it survives the stub's fabricated numbers:
     switching to a week whose picks are NOT loaded must not zero out a
     player's season total. It is allowed to change — live-for-loaded
     versus banked-for-everything-else is the design — but a week that
     scored points may never contribute nothing. */
  {
    const { ctx, page, errors } = await open({
      startISO: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
      weeks: 2, gamesPerWeek: 4 });

    const total = pg => pg.evaluate(() => {
      const r = document.querySelector('#board .row');
      return r ? ((r.querySelector('.pts b') || {}).textContent || '') : '';
    });

    await page.click('[data-tab="standings"]').catch(() => {});
    await page.waitForTimeout(400);
    await page.click('#standTabs [data-stand="season"]').catch(() => {});
    await page.waitForTimeout(400);
    const onWk1 = await total(page);
    ok('the season table has points while week 1 is loaded',
       Number(onWk1) > 0, `top row = ${JSON.stringify(onWk1)}`);

    // Peek at next week's slate, exactly as a player would.
    await page.click('.wk[data-wk="2"]').catch(() => {});
    await page.waitForTimeout(600);
    await page.click('[data-tab="standings"]').catch(() => {});
    await page.click('#standTabs [data-stand="season"]').catch(() => {});
    await page.waitForTimeout(400);
    const onWk2 = await total(page);
    ok('and still has them after browsing to a week whose picks are not loaded',
       Number(onWk2) > 0, `top row = ${JSON.stringify(onWk2)} (was ${JSON.stringify(onWk1)})`);

    ok('no page errors', errors.length === 0, errors[0] || '');
    await ctx.close();
  }
}

/* ------------------------------------------------------------------ */
console.log('\n48. A finished week must not read differently on the Grid and in Standings');
{
  /* THE BUG, reported the Tuesday after week 1 closed.

     Monday night football went final at about 12:30, and for the five
     hours until the Tuesday scoring run the two screens disagreed:

       GRID (live)                 STANDINGS (banked)
       Steven Kern  120  13/16     Steven Kern  119  12 of 16
       Ron Ron      113  13/16     Ron Ron      108  12 of 16
       Coker        109  12/16     Coker        103  11 of 16

     One game missing from every row, and the point gaps — 1, 5, 6 —
     were exactly each player's stake on the Monday night game.

     THE CAUSE: weekSum treated `settled` (every game final) as though
     it meant `scored` (the server has since run). The instant the last
     game finalised, the week became settled and the code handed over to
     the banked record — a record written the previous afternoon, before
     that game existed as a result.

     THE TEST FOR STALENESS IS `hits`. For the week on screen the client
     holds every revealed pick and every game document, so it can only
     ever see more correct picks than an older record counted, never
     fewer. Client ahead means the record predates a result.

     These cases pin the user-visible invariant — the two screens agree —
     and both directions of the choice, because preferring the client
     unconditionally would break a different thing: the record is scored
     under the mode that week actually used, while weekPoints() uses the
     pool's current mode. */
  const six = () => new Date(Date.now() - 6 * 864e5).toISOString();

  const gridPts = pg => pg.evaluate(() =>
    [...document.querySelectorAll('#gridBody table.pool tbody tr')]
      .filter(tr => !tr.classList.contains('poolrow'))
      .map(tr => ({
        name: (tr.querySelector('.plmeta b') || {}).textContent || '',
        pts:  (tr.querySelector('.tot .totnum') || {}).textContent.trim() || '',
        sub:  (tr.querySelector('.tot .totsub') || {}).textContent.trim() || '' })));
  const standPts = pg => pg.evaluate(() =>
    [...document.querySelectorAll('#board .row')].map(r => ({
      name: (r.querySelector('.who b') || {}).textContent || '',
      pts:  (r.querySelector('.pts b') || {}).textContent || '' })));

  /* ---- the banked record is BEHIND: the client must win ---- */
  {
    const { ctx, page, errors } = await open({
      startISO: six(), weeks: 1, gamesPerWeek: 4,
      recPts: 0, recHits: 0 });          // a record written before the last game

    await page.click('[data-tab="grid"]').catch(() => {});
    await page.waitForTimeout(500);
    const grid = await gridPts(page);
    ok('the week is fully final and the Grid scored it',
       grid.length > 2 && grid.some(r => Number(r.pts) > 0),
       JSON.stringify(grid.slice(0, 3)));

    await page.click('[data-tab="standings"]').catch(() => {});
    await page.click('#standTabs [data-stand="week"]').catch(() => {});
    await page.waitForTimeout(400);
    const wk = await standPts(page);
    const gBy = Object.fromEntries(grid.map(r => [r.name, r.pts]));
    const off = wk.filter(r => gBy[r.name] !== undefined && gBy[r.name] !== r.pts);
    /* THE ASSERTION THAT KILLS THE BUG. */
    ok('This Week matches the Grid point for point',
       off.length === 0,
       JSON.stringify(off.map(r => [r.name, gBy[r.name], r.pts])).slice(0, 300));
    ok('and it is not showing the stale zero',
       wk.some(r => Number(r.pts) > 0), JSON.stringify(wk.slice(0, 3)));

    await page.click('#standTabs [data-stand="season"]').catch(() => {});
    await page.waitForTimeout(400);
    const se = await standPts(page);
    const offS = se.filter(r => gBy[r.name] !== undefined && gBy[r.name] !== r.pts);
    ok('Season matches the Grid too', offS.length === 0,
       JSON.stringify(offS.map(r => [r.name, gBy[r.name], r.pts])).slice(0, 300));

    ok('no page errors', errors.length === 0, errors[0] || '');
    await ctx.close();
  }

  /* ---- the banked record is CURRENT: it must win ----
     Not symmetry for its own sake. The record carries the scoring mode
     that week was settled under; the client recomputes with today's.
     Preferring the client whenever it merely disagrees would silently
     rescore old weeks after a mode change. */
  {
    const { ctx, page, errors } = await open({
      startISO: six(), weeks: 1, gamesPerWeek: 4,
      recPts: 777, recHits: 99 });       // impossible to beat from 4 games

    await page.click('[data-tab="standings"]').catch(() => {});
    await page.click('#standTabs [data-stand="week"]').catch(() => {});
    await page.waitForTimeout(500);
    const wk = await standPts(page);
    ok('a record that is not behind is still trusted',
       wk.length > 2 && wk.every(r => r.pts === '777'),
       JSON.stringify(wk.slice(0, 3)));
    ok('no page errors', errors.length === 0, errors[0] || '');
    await ctx.close();
  }
}

/* ------------------------------------------------------------------ */
console.log('\n49. The Grid before kickoff must be the grid, not a list of names');
{
  /* THE COMPLAINT: opening week 2 showed "Nothing to show yet" over a
     block of name chips. Two problems with that. It is a different
     screen from the one it becomes on Thursday, so the Grid appears to
     change shape rather than fill in — and a player could not see their
     OWN picks on it, even though a row is revealed to its owner from
     the start.

     So the table renders from the beginning, with sealed dots the
     legend already explains. Nothing can leak: a cell shows only when
     its game has kicked off or the row is yours, and the reveal query
     means the client does not hold anybody else's unrevealed pick. */
  const { ctx, page, errors } = await open({ weeks: 2, gamesPerWeek: 4 });
  await page.click('[data-tab="grid"]').catch(() => {});
  await page.waitForTimeout(600);

  const g = await page.evaluate(() => {
    const body = document.querySelector('#gridBody');
    const rows = [...document.querySelectorAll('#gridBody table.pool tbody tr')]
      .filter(tr => !tr.classList.contains('poolrow'));
    const mine = rows.find(tr => tr.classList.contains('me'));
    const other = rows.find(tr => !tr.classList.contains('me'));
    const cells = tr => [...tr.querySelectorAll('td:not(.tbtd) .cell')].map(c => c.className);
    return {
      chips: !!body.querySelector('.roster'),
      emptyHead: /Nothing to show yet/.test(body.textContent),
      rowCount: rows.length,
      players: rows.map(tr => (tr.querySelector('.plmeta b') || {}).textContent || ''),
      ranks: rows.map(tr => (tr.querySelector('.plrank') || {}).textContent.trim()),
      totals: rows.map(tr => (tr.querySelector('.tot .totnum') || {}).textContent.trim()),
      subs: rows.map(tr => (tr.querySelector('.tot .totsub') || {}).textContent.trim()),
      mineCells: mine ? cells(mine) : null,
      otherCells: other ? cells(other) : null,
      legend: !!body.querySelector('.legend')
    };
  });

  ok('the table renders instead of the chip list',
     g.rowCount > 2 && !g.chips && !g.emptyHead,
     JSON.stringify({ rows: g.rowCount, chips: g.chips, empty: g.emptyHead }));
  ok('every player has a row', g.rowCount === g.players.length && g.rowCount >= 8,
     String(g.rowCount));
  ok('and they are in name order, not an invented ranking',
     JSON.stringify(g.players) === JSON.stringify([...g.players].sort((a, b) => a.localeCompare(b))),
     JSON.stringify(g.players.slice(0, 5)));
  /* A dash, not a nought. A column of zeroes reads as a score somebody
     posted; that was the reasoning on the Standings cold start and it
     applies identically here. */
  ok('the points column shows a dash rather than a nought',
     g.totals.every(t => t === '–') && g.subs.every(s => s === ''),
     JSON.stringify(g.totals.slice(0, 4)));
  ok('no rank numbers before anything is scored',
     g.ranks.every(r => r === '·'), JSON.stringify(g.ranks.slice(0, 4)));

  /* THE POINT OF THE CHANGE: you can see your own sheet, nobody
     else's. */
  ok('your own row shows your picks',
     !!g.mineCells && g.mineCells.some(c => /\bpend\b|\bnone\b/.test(c)),
     JSON.stringify(g.mineCells));
  ok("and everybody else's row stays sealed",
     !!g.otherCells && g.otherCells.every(c => /hidden/.test(c)),
     JSON.stringify(g.otherCells));
  ok('the legend explaining the dots is still there', g.legend);

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
console.log('\n50. A finished week must not still be pulsing "all locked"');
{
  /* THE BUG: the header clock's fallback text tested the WHOLE SEASON
     for an unstarted game — `Object.values(WEEKS).flat().some(g=>!isLive(g))`
     — so it could not tell "every game has kicked off and three are
     still being played" from "this week finished on Monday night". Both
     read `Week 1 · all locked`, a phrase that means nothing to a player,
     and both kept the pulsing gold dot: the app's one signal for
     something happening RIGHT NOW, left running against a week that was
     over. Week 1 sat like that for six days. */
  const past = new Date(Date.now() - 12*24*3600*1000).toISOString();
  const { ctx, page, errors } = await open(
    { startISO: past, weeks: 3, gamesPerWeek: 4, playerCount: 6 });

  const clock = () => page.evaluate(() => {
    const c = document.getElementById('clock');
    const dot = c && c.querySelector('.dot');
    const tick = c && c.querySelector('.tick');
    const seen = e => !!e && getComputedStyle(e).display !== 'none';
    return { cls: c ? c.className : '',
             txt: (document.getElementById('countdown') || {}).textContent || '',
             dot: seen(dot), tick: seen(tick),
             colour: c ? getComputedStyle(c).color : '' };
  });

  /* The app opens on the CURRENT week, which here is an upcoming one —
     so week 1 has to be selected explicitly. My first version of this
     case did not, graded the countdown state against the finished-week
     assertions, and failed for the wrong reason. */
  /* WAIT FOR THE HEADER TO CHANGE, not for a fixed 800ms. Same trap as
     case 59, found again on 29 Sep 2026 while building v1.41.0: the
     week strip flips at once but the header only redraws on the first
     tick after loadWeek resolves, so a flat wait read the OLD countdown
     about one run in four, on v1.40.1 as well (reproduced 3 of 12). Not
     tautological: if the header never changes, this times out and the
     assertions below grade the stale text and fail. */
  const before = (await clock()).txt;
  await page.click('.wk[data-wk="1"]');
  await page.waitForFunction(t =>
    (document.getElementById('countdown') || {}).textContent !== t,
    before, { timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(150);
  const done = await clock();
  ok('a finished week says Final, not "all locked"',
     /week 1\s*·\s*final/i.test(done.txt) && !/locked/i.test(done.txt), done.txt);
  ok('and stops pulsing: no dot at all',        done.dot === false, JSON.stringify(done));
  ok('showing a tick in the dot\'s place',      done.tick === true, JSON.stringify(done));
  ok('and drops the gold',                      /done/.test(done.cls), done.cls);

  /* Now a week that has NOT started: the countdown, untouched. This is
     the half of the behaviour that was already right, and the reason
     the fix had to be surgical — `next` already picks the earliest
     game in the week that has not kicked off, which is why the gold
     countdown correctly survives the gaps BETWEEN games on a Sunday. */
  /* Same wait as week 1 above. The flat 800ms here read "Week 1 · Final"
     once on 6 Oct 2026 while building v1.42.0 (the header had not yet
     redrawn). With this wait the full suite passed 672 of 672. */
  const beforeSoon = (await clock()).txt;
  await page.click('.wk[data-wk="3"]');
  await page.waitForFunction(t =>
    (document.getElementById('countdown') || {}).textContent !== t,
    beforeSoon, { timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(150);
  const soon = await clock();
  ok('an upcoming week still counts down to its next kickoff',
     /@/.test(soon.txt) && /\d/.test(soon.txt), soon.txt);
  ok('in gold, with the dot pulsing',
     soon.dot === true && soon.tick === false && soon.cls.trim() === 'clock',
     JSON.stringify(soon));
  ok('no page errors', errors.length === 0, errors[0]);
  await ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n51. The Grid must not collapse to three rows after Monday night');
{
  /* THE BUG, and it is geometry rather than logic. #v-grid is a
     fixed-height flex column: the scrolling table, then the tiebreaker
     block, then the legend. The table carried min-height:200px; the
     tiebreaker block carried no height limit at all and listed every
     player's guess. At 28 players that block stood ~950px, so the
     table was squeezed to its 200px floor and showed THREE ROWS — the
     same three whether the pool had five people or fifty, and whatever
     the screen size. The guesses moved into a column of the table, and
     the block became one line. */
  const past = new Date(Date.now() - 12*24*3600*1000).toISOString();
  const { ctx, page, errors } = await open(
    { startISO: past, weeks: 2, gamesPerWeek: 16, playerCount: 28 });
  await page.click('[data-tab="grid"]').catch(() => {});
  await page.waitForTimeout(700);

  const m = await page.evaluate(() => {
    const scroll = document.querySelector('#gridBody .gridscroll');
    const strip  = document.querySelector('#gridBody .tbstrip');
    const rows   = [...document.querySelectorAll('#gridBody tbody tr')];
    const rowH   = rows.length ? rows[0].getBoundingClientRect().height : 0;
    return {
      scrollH: scroll ? Math.round(scroll.getBoundingClientRect().height) : 0,
      stripH:  strip  ? Math.round(strip.getBoundingClientRect().height)  : 0,
      rows: rows.length, rowH: Math.round(rowH),
      oldPanel: !!document.querySelector('#gridBody .tbpanel'),
      guessRows: document.querySelectorAll('#gridBody .tbrow').length,
    };
  });
  ok('the 28-row tiebreaker panel is gone',
     m.oldPanel === false && m.guessRows === 0, JSON.stringify(m));
  ok('replaced by one strip, not a wall',
     m.stripH > 0 && m.stripH < 110, String(m.stripH));
  /* The real assertion: the table gets the screen. Four rows was the
     old ceiling, so anything at or under that is the bug back. */
  const visible = m.rowH ? Math.floor(m.scrollH / m.rowH) : 0;
  ok('and the table is no longer pinned at its 200px floor',
     m.scrollH > 260, String(m.scrollH));
  ok('so more than four player rows fit on screen',
     visible >= 8, `${visible} rows of ${m.rows} (${m.scrollH}px / ${m.rowH}px)`);
  ok('no page errors', errors.length === 0, errors[0]);
  await ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n52. The tiebreaker column must grade by the rule it prints');
{
  /* Two things this pins.

     ONE: closest-without-going-over is a SET, not a person. The first
     implementation used reduce(), which returns whichever row it meets
     first — so two players on the same closest guess got two different
     colours for identical answers, and the summary line named one of
     them. On a single two-digit number across 28 guesses that is not an
     edge case.

     TWO: the column may only say WINNER when the guess actually decided
     something. score_week.py sorts by (-total, tiebreak), so a guess
     changes an outcome only when the top two are level on points.
     Otherwise the closest guess won nothing and must say CLOSEST. */
  const past = new Date(Date.now() - 12*24*3600*1000).toISOString();
  // Roster index 0 is Lee. Two players share 46; the actual total decides.
  const { ctx, page, errors } = await open(
    { startISO: past, weeks: 2, gamesPerWeek: 16, playerCount: 6,
      tbTotals: [46, 46, 99, 40, 41, 42] });
  await page.click('[data-tab="grid"]').catch(() => {});
  await page.waitForTimeout(700);

  const t = await page.evaluate(() => {
    const head = document.querySelector('#gridBody thead th.tbcol');
    const cells = [...document.querySelectorAll('#gridBody tbody tr')]
      .filter(tr => !tr.classList.contains('poolrow'))
      .map(tr => {
        const c = tr.querySelector('td.tbtd .cell');
        return { name: (tr.querySelector('.plmeta b') || {}).textContent || '',
                 cls: c ? c.className : '', txt: c ? c.textContent.trim() : '' };
      });
    return {
      hasHead: !!head,
      isGameCol: !!document.querySelector('#gridBody thead th.gm.tbcol'),
      gameCols: document.querySelectorAll('#gridBody thead th.gm').length,
      actual: head ? (head.querySelector('.hm') || {}).textContent.trim() : '',
      // Geometry: the divider under TIE must be the same line as a game's.
      sep: (() => {
        const a = document.querySelector('#gridBody thead th.gm .sep');
        const b = head && head.querySelector('.sep');
        if (!a || !b) return null;
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        return { w: Math.round(ra.width) - Math.round(rb.width),
                 y: Math.round(ra.top) - Math.round(rb.top) };
      })(),
      cells, strip: (document.querySelector('.tbstrip') || {}).textContent || '',
    };
  });

  ok('the column exists', t.hasHead, JSON.stringify(t).slice(0, 120));
  /* It shares the games' geometry but not their identity — counting
     th.gm is how the slate size gets read, and a 17th "game" made every
     payout a point high once already. */
  ok('but it is NOT counted as a game column',
     t.isGameCol === false && t.gameCols === 16, `gm=${t.gameCols}`);
  ok('its divider is the same width as a game\'s',
     t.sep && t.sep.w === 0, JSON.stringify(t.sep));
  ok('and sits on the same line',
     t.sep && t.sep.y === 0, JSON.stringify(t.sep));

  const actual = Number(t.actual);
  ok('the header shows the combined total', Number.isFinite(actual), t.actual);

  const green  = t.cells.filter(c => /\bwon\b/.test(c.cls));
  const struck = t.cells.filter(c => /\bover\b/.test(c.cls));
  const guessOf = c => Number((c.txt.match(/^\d+/) || [])[0]);

  // Whatever the fixture's total turns out to be, the RULE must hold.
  const unders = t.cells.filter(c => guessOf(c) <= actual);
  const pool = unders.length ? unders : t.cells;
  const best = Math.min(...pool.map(c => Math.abs(guessOf(c) - actual)));
  const expect = pool.filter(c => Math.abs(guessOf(c) - actual) === best);

  ok('every guess at the closest distance is green, not just the first',
     green.length === expect.length &&
     expect.every(e => green.some(g => g.name === e.name)),
     `green=${JSON.stringify(green.map(g => g.name + ':' + g.txt))} expected=${
       JSON.stringify(expect.map(e => e.name + ':' + e.txt))}`);
  ok('and the count is right even when two players tie on it',
     expect.length < 2 || green.length >= 2,
     `${expect.length} tied, ${green.length} green`);
  ok('anything over the total is struck through',
     struck.length === t.cells.filter(c => guessOf(c) > actual).length,
     `${struck.length} struck of ${t.cells.filter(c => guessOf(c) > actual).length} over`);
  ok('a struck cell is never also green',
     struck.every(c => !/\bwon\b/.test(c.cls)), JSON.stringify(struck));

  /* THE WORD "WINNER" MUST NEVER APPEAR IN THIS COLUMN, and this case
     used to assert the opposite — that it appears exactly when the top
     two rows are level on points. That was built on a misreading of
     score_week.py: apply_tiebreak sorts (-r["total"], key) where
     `total` is the SEASON total, so the guess only ever reorders the
     season standings, never a week; and the weekly award is explicitly
     shared ("Ties share a place", winners = every row at the best week
     score). So the tiebreaker cannot win anybody a week, and a cell
     saying it did was the app inventing a rule the scorer does not have.
     A test asserting a false rule is worse than no test: this one PASSED
     the whole time the app was wrong.
     This fixture is the hard branch — the deterministic picks put the
     whole top of the table on the same week total, which is exactly
     where the old code printed WINNER — so it is asserted explicitly,
     and the case fails if the generator ever stops producing it. */
  const pts = await page.evaluate(() => [...document.querySelectorAll('#gridBody .tot .totnum')]
    .map(e => Number(e.textContent)).filter(Number.isFinite));
  ok('the fixture still puts the top of the table level on points',
     pts.length > 1 && pts[0] === pts[1], JSON.stringify(pts.slice(0, 3)));
  const winners = t.cells.filter(c => /winner/i.test(c.txt));
  ok('and even so, no cell claims to have won the week',
     winners.length === 0, JSON.stringify(winners.map(c => c.name + ':' + c.txt)));
  ok('every green cell says CLOSEST or EXACT and nothing else',
     green.length > 0 && green.every(c => /closest|exact/i.test(c.txt)),
     JSON.stringify(green.map(c => c.txt)));

  /* And the line underneath must agree with the column — they used to
     compute it separately, and one of them was wrong. */
  ok('the summary names every player the column turned green',
     expect.every(e => t.strip.includes(e.name)),
     `${t.strip} | expected ${JSON.stringify(expect.map(e => e.name))}`);
  ok('no page errors', errors.length === 0, errors[0]);
  await ctx.close();

  /* THE OTHER BRANCH, AND IT TAKES TWO PASSES TO BUILD.

     The point of this fixture is: the top scorer ALSO holds the closest
     guess, and the top two are NOT level on points. Only then does
     "WINNER" versus "CLOSEST" actually distinguish correct code from
     code that says WINNER whenever a week is final — and my first
     version of this case did not arrange it, so mutation testing showed
     the assertion passing with the bug put back. A test that cannot
     fail is worse than no test.

     So: load once to learn who finishes top and what the combined total
     is, then reload with that player given a guess one under it and
     everybody else pushed over. The generator is deterministic, so the
     second pass reproduces the same order. */
  const learn = await open(
    { startISO: past, weeks: 2, gamesPerWeek: 8, playerCount: 8, promo: true });
  await learn.page.click('[data-tab="grid"]').catch(() => {});
  await learn.page.waitForTimeout(700);
  const seen = await learn.page.evaluate(() => {
    const rows = [...document.querySelectorAll('#gridBody tbody tr')]
      .filter(tr => !tr.classList.contains('poolrow'));
    const head = document.querySelector('#gridBody thead th.tbcol .hm');
    return {
      names: rows.map(tr => (tr.querySelector('.plmeta b') || {}).textContent.trim()),
      pts: rows.map(tr => Number((tr.querySelector('.tot .totnum') || {}).textContent)),
      actual: Number(head ? head.textContent.trim() : NaN),
    };
  });
  await learn.ctx.close();
  ok('the learning pass separates the top two on points',
     seen.pts.length > 1 && seen.pts[0] !== seen.pts[1],
     JSON.stringify(seen.pts.slice(0, 4)));
  ok('and reports a combined total to aim at',
     Number.isFinite(seen.actual), String(seen.actual));

  /* Roster order in the harness is ['Lee', ...NAMES], so the index a
     name sits at is the index tbTotals addresses. */
  const ROSTER = ['Lee','Monse','Dad','Uncle Ray','Coach K','Sam','Priya','Marcus','Jo','Tay'];
  const topIdx = ROSTER.indexOf(seen.names[0]);
  ok('the top scorer is findable in the roster', topIdx >= 0,
     `${seen.names[0]} in ${JSON.stringify(ROSTER.slice(0, 8))}`);
  const totals = ROSTER.slice(0, 8).map((_, i) =>
    i === topIdx ? seen.actual - 1 : seen.actual + 20);

  const b2 = await open(
    { startISO: past, weeks: 2, gamesPerWeek: 8, playerCount: 8,
      promo: true, tbTotals: totals });
  await b2.page.click('[data-tab="grid"]').catch(() => {});
  await b2.page.waitForTimeout(700);
  const d = await b2.page.evaluate(() => {
    const rows = [...document.querySelectorAll('#gridBody tbody tr')]
      .filter(tr => !tr.classList.contains('poolrow'));
    return {
      pts: rows.map(tr => Number((tr.querySelector('.tot .totnum') || {}).textContent)),
      cells: rows.map(tr => {
        const c = tr.querySelector('td.tbtd .cell');
        return { name: (tr.querySelector('.plmeta b') || {}).textContent.trim(),
                 cls: c ? c.className : '', txt: c ? c.textContent.trim() : '' }; }),
    };
  });
  ok('the second fixture still separates the top two on points',
     d.pts.length > 1 && d.pts[0] !== d.pts[1], JSON.stringify(d.pts.slice(0, 4)));
  /* THE ARRANGEMENT THAT MAKES THIS BITE: the row at the top of the
     table is also the one holding the closest guess. */
  ok('and the top scorer is the one holding the closest guess',
     d.cells.length > 0 && /\bwon\b/.test(d.cells[0].cls),
     JSON.stringify(d.cells.slice(0, 2)));
  ok('so nothing in the column claims to be the WINNER',
     !d.cells.some(c => /winner/i.test(c.txt)),
     JSON.stringify(d.cells.map(c => c.txt)));
  ok('and the closest guess says CLOSEST',
     /closest|exact/i.test(d.cells[0].txt), JSON.stringify(d.cells[0]));
  ok('no page errors in the second fixture', b2.errors.length === 0, b2.errors[0]);
  await b2.ctx.close();

  /* THE BRANCH BOTH FIXTURES ABOVE MISS: everybody overshoots.
     The rule is closest-without-going-over, and when nobody is under it
     falls back to closest outright — so the nearest OVERSHOOT wins. The
     first build drew that cell green AND struck through, saying "this
     won" and "this busted" in the same 50 pixels. Neither fixture above
     reaches it, because both have somebody under, so the assertion "a
     struck cell is never also green" passed while being false. Found by
     screenshotting the real app; pinned here. */
  const over = await open(
    { startISO: past, weeks: 2, gamesPerWeek: 16, playerCount: 8,
      tbTotals: [300, 301, 302, 303, 304, 305, 306, 307] });
  await over.page.click('[data-tab="grid"]').catch(() => {});
  await over.page.waitForTimeout(700);
  const o = await over.page.evaluate(() => {
    const head = document.querySelector('#gridBody thead th.tbcol .hm');
    const rows = [...document.querySelectorAll('#gridBody tbody tr')]
      .filter(tr => !tr.classList.contains('poolrow'));
    return {
      actual: Number(head ? head.textContent.trim() : NaN),
      cells: rows.map(tr => {
        const c = tr.querySelector('td.tbtd .cell');
        return { cls: c ? c.className : '', txt: c ? c.textContent.trim() : '' }; }),
      strip: (document.querySelector('.tbstrip') || {}).textContent || '',
    };
  });
  ok('every guess really is over the total',
     o.cells.every(c => Number((c.txt.match(/^\d+/) || [])[0]) > o.actual),
     `actual ${o.actual} vs ${JSON.stringify(o.cells.map(c => c.txt))}`);
  const win = o.cells.filter(c => /\bwon\b/.test(c.cls));
  ok('the closest overshoot still wins it', win.length >= 1,
     JSON.stringify(o.cells.map(c => c.cls)));
  ok('and is NOT struck through as busted',
     win.every(c => !/\bover\b/.test(c.cls)), JSON.stringify(win));
  ok('while the rest of the overshoots are struck',
     o.cells.filter(c => !/\bwon\b/.test(c.cls)).every(c => /\bover\b/.test(c.cls)),
     JSON.stringify(o.cells.map(c => c.cls)));
  ok('and the line says everybody went over, so the number makes sense',
     /everybody went over/i.test(o.strip), o.strip);
  ok('no page errors in the all-over fixture', over.errors.length === 0, over.errors[0]);
  await over.ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n53. A live card must say where the game is, and a final one who won');
{
  /* TWO FIXTURES, because one cannot be both. The harness marks a game
     final once kickoff + 200 minutes has passed — the same rule the app
     uses — so a card that is live and NOT final only exists inside that
     window. My first attempt used a three-day-old fixture, seeded ESPN
     into a game that was already final, and graded the live assertions
     against a finished card. */

  // (a) kicked off an hour ago: live, not final.
  const justOn = new Date(Date.now() - 60*60*1000).toISOString();
  /* espnDetail seeds the scoreboard SERVER-side, before the app boots.
     Setting window.__espn from the test instead grades the second poll,
     sixty seconds later, and there is no visibilitychange hook to force
     one — which is why the first version of this saw the bare "Live"
     fallback and read it as a failure. */
  const A = await open({ startISO: justOn, weeks: 2, gamesPerWeek: 16,
                         playerCount: 6, espnDetail: '3rd 5:42' });
  await A.page.waitForTimeout(1200);

  /* Feed ESPN a game in the third quarter. shortDetail is ESPN's own
     phrasing and the card must print it verbatim: a hand-rolled
     "Q3 5:42" gets halftime, end of quarter and overtime wrong, which
     is exactly why this is not parsed. */
  const seeded = await A.page.evaluate(() => {
    const el = [...document.querySelectorAll('.card')]
      /* .meta .cd[data-cd] — the RIGHT slot. Since P1 the left slot is a
         .cd too, so a bare '.meta .cd' matches the clock first and this
         find never succeeded. */
      .find(c => /in progress/i.test((c.querySelector('.meta .cd[data-cd]') || {}).textContent || ''));
    return el ? { id: el.getAttribute('data-game') } : null;
  });
  ok('a live, unfinished game is on screen', !!seeded, JSON.stringify(seeded));
  ok('and the app actually asked ESPN for it',
     (await A.page.evaluate(() => window.__espnCalls.length)) > 0);

  const card = await A.page.evaluate(id => {
    const el = document.querySelector(`.card[data-game="${id}"]`);
    if (!el) return null;
    /* P1: BOTH halves are .cd.live. The left one carries .lefted, the
       right one .nodot and the data-cd hook tick() writes to. Address
       them that way — a bare '.meta .cd' matches the clock, which is
       how this case first read null for the left slot and the clock's
       own text for the right one. */
    const lv = el.querySelector('.meta .cd.lefted');
    const cd = el.querySelector('.meta .cd[data-cd]');
    const sty = e => e ? getComputedStyle(e) : null;
    return {
      lv: lv ? lv.textContent.trim() : null,
      cd: cd ? cd.textContent.trim() : null,
      /* One dot on the row, and it travels with the clock.
         Probed on DISPLAY, not on `content`: .nodot hides the dot with
         display:none, and display:none does not clear the computed
         `content` of a pseudo-element — so a content-based check reports
         a dot that is not being drawn. P2 ("a dot on both") was shown
         and ruled out, so exactly one is the requirement. */
      lvDot: lv ? getComputedStyle(lv, '::before').display !== 'none' : false,
      cdDot: cd ? getComputedStyle(cd, '::before').display !== 'none' : false,
      /* "Same green, weight and size throughout" was the whole heading
         of the P sheet, so assert it rather than trusting that two
         classes happen to agree. */
      lvStyle: lv ? [sty(lv).color, sty(lv).fontSize, sty(lv).fontWeight].join('|') : null,
      cdStyle: cd ? [sty(cd).color, sty(cd).fontSize, sty(cd).fontWeight].join('|') : null,
      // S2: the network and line sit between the two, centred.
      order: [...el.querySelectorAll('.meta > *')].map(e => e.className || e.tagName),
    };
  }, seeded ? seeded.id : '');

  /* ESPN's own string, with no word of ours in front of it. P1 reads
     "3rd · 5:42" — my first build prepended "Live", which appears in
     none of the five P variants. */
  ok("the live card shows ESPN's own clock, top left",
     card && /3rd\s*·\s*5:42/i.test(card.lv || ''), JSON.stringify(card));
  ok('and does not invent a word in front of it',
     card && !/live/i.test(card.lv || ''), JSON.stringify(card && card.lv));
  ok('both halves share the same green, size and weight',
     card && card.lvStyle && card.lvStyle === card.cdStyle,
     JSON.stringify([card && card.lvStyle, card && card.cdStyle]));
  ok('with IN PROGRESS on the right',
     card && /in progress/i.test(card.cd || ''), JSON.stringify(card));
  ok('exactly one dot on the row, and it is on the clock',
     card && card.lvDot === true && card.cdDot === false, JSON.stringify(card));
  ok('with the clock first and IN PROGRESS last',
     card && /lefted/.test(card.order[0] || '') &&
             /nodot/.test(card.order[card.order.length-1] || ''),
     JSON.stringify(card && card.order));
  ok('no page errors on the live fixture', A.errors.length === 0, A.errors[0]);
  await A.ctx.close();

  // (b) a finished week: finals to inspect, and sixteen pool bars.
  const past = new Date(Date.now() - 12*24*3600*1000).toISOString();
  const B = await open({ startISO: past, weeks: 2, gamesPerWeek: 16, playerCount: 8 });
  await B.page.waitForTimeout(600);
  /* WEEK 1 SPECIFICALLY. The generator's pick winner is (i+mi)%2 and the
     game winner is (w+i)%2, so in an even week they coincide and Lee
     happens to have called every game right — which is precisely the
     fixture that CANNOT show whether colour follows the winner or the
     pick, because the two agree. Week 1 is the week where they differ. */
  await B.page.click('.wk[data-wk="1"]');
  await B.page.waitForTimeout(800);

  /* v1.41.0: THE COUNT LINE IS GONE, ON EVERY CARD. Lee struck "27
     picks" off the finished card, so the pool block is one row shorter
     everywhere it appears. What must NOT go with it is the pool block
     being the same shape on all sixteen cards, which is why the line
     was put on every card in the first place: so assert both, that the
     old line is nowhere and that every pool block measures the same. */
  const subs = await B.page.evaluate(() => {
    const cards = [...document.querySelectorAll('.card')]
      .filter(c => c.querySelector('.cons'));
    return { withCons: cards.length,
             withSub: cards.filter(c => c.querySelector('.cons-sub, .pcount')).length,
             heights: [...new Set(cards.map(c =>
               Math.round(c.querySelector('.cons').getBoundingClientRect().height)))] };
  });
  ok('no card carries the old pick-count line',
     subs.withCons > 1 && subs.withSub === 0, JSON.stringify(subs));
  ok('and every pool block is the same height',
     subs.heights.length === 1, JSON.stringify(subs.heights));
  /* THE WHOLE POINT OF v1.41.0, as one number. Lee picked the tightened
     card from mockups at 172px (head 20, teams 72, pool 48, result 32)
     against today's 217. Graded on every finished card on the screen. */
  const tight = await B.page.evaluate(() => [...document.querySelectorAll('#slate .card')]
    .filter(c => c.querySelector('.resbar') && c.querySelector('.cons'))
    .map(c => { const h = e => Math.round(e.getBoundingClientRect().height);
      return [h(c), h(c.querySelector('.meta')), h(c.querySelector('.cons')), h(c.querySelector('.resbar'))].join('/'); }));
  ok('a finished card is 172px: head 20, pool 48, result 32',
     tight.length > 1 && tight.every(x => x === '172/20/48/32'), JSON.stringify([...new Set(tight)]));
  /* VACUOUS UNTIL NOW, and worth recording. This filtered the cards
     holding an unlabelled segment and asserted every one of them showed
     a percentage below — but the default generator splits every game
     (i+mi)%2, so no segment is ever narrow, `subs.narrow` was always
     empty, and .every() on nothing is true. It has been green for
     months without once seeing the case it names.
     P.lopsided makes one member the lone dissenter, so the fixture
     really does produce narrow segments, and the non-emptiness check
     below is what stops this going hollow again. */
  const LOP = await open({ startISO: past, weeks: 2, gamesPerWeek: 16,
                           playerCount: 13, lopsided: true });
  await LOP.page.waitForTimeout(800);
  const nar = await LOP.page.evaluate(() =>
    [...document.querySelectorAll('.card')]
      .filter(c => [...c.querySelectorAll('.cbar:not(.cons-key) .cseg')].some(sg => !sg.textContent.trim()))
      .map(c => (c.querySelector('.cons-key b') || {}).textContent || ''));
  ok('the fixture really does produce narrow segments', nar.length > 0, String(nar.length));
  /* It used to share the count line under the bar. The count is gone;
     the figure keeps a line under the bar of its own, only on the cards
     that need one. The W1 case further down grades which end it sits. */
  ok('and a segment too narrow to label still shows its percentage under the bar',
     nar.length > 0 && nar.every(t => /%/.test(t)), JSON.stringify(nar.slice(0, 4)));
  /* THE RED TAG IS TALLER THAN THE LABEL, which is why the head row has
     a fixed height: without it a card whose pool got it wrong grew a
     couple of pixels and the slate stopped lining up. This fixture has
     upsets (the default one never does), so this is where it can fail. */
  /* WEEK 1, where this fixture has upset and non-upset cards of the
     same shape side by side; the week it opens on happened to put every
     red tag on one shape, which proves nothing about the tag. */
  await LOP.page.click('.wk[data-wk="1"]').catch(() => {});
  await LOP.page.waitForTimeout(900);
  const lop = await LOP.page.evaluate(() => {
    /* Cards WITHOUT a narrow figure: a lopsided card is meant to be one
       line taller, and that is graded separately just below. */
    const cons = [...document.querySelectorAll('.card .cons')].filter(c => !c.querySelector('.cons-key'));
    const noted = [...document.querySelectorAll('.card .cons')].filter(c => c.querySelector('.cons-key'));
    const tag = document.querySelector('.card .upset'), lab = document.querySelector('.card .cseg span');
    /* Within each shape (with a narrow figure, and without), a card with
       the red tag and a card without it must measure the same. */
    const mixed = [cons, noted].filter(g => g.some(c => c.querySelector('.upset'))
                                          && g.some(c => !c.querySelector('.upset')));
    return { upsets: [...cons, ...noted].filter(c => c.querySelector('.upset')).length,
             mixedGroups: mixed.length,
             heights: [...new Set(cons.map(c => Math.round(c.getBoundingClientRect().height)))],
             notedHeights: [...new Set(noted.map(c => Math.round(c.getBoundingClientRect().height)))],
             tagTrim: tag ? getComputedStyle(tag).textBoxTrim : null,
             labTrim: lab ? getComputedStyle(lab).textBoxTrim : null };
  });
  ok('a pool block with the red tag is the same height as one without',
     lop.upsets > 0 && lop.mixedGroups > 0 && lop.heights.length === 1
       && lop.notedHeights.length === 1, JSON.stringify(lop));
  /* THE COST OF NEVER LOSING THE NUMBER, pinned so it cannot creep: a
     lopsided card is exactly one 15px line taller than the rest. */
  ok('and a lopsided card is exactly one short line taller, no more',
     lop.notedHeights.length === 1 && lop.heights.length === 1
       && lop.notedHeights[0] - lop.heights[0] === 15, JSON.stringify(lop));
  /* Centred on the capitals, which is what Lee measured as off: capitals
     have no descenders, so an untrimmed box leaves more room under the
     words than over them, by an amount that depends on the typeface. */
  ok('the red tag and the bar labels are trimmed to their capitals',
     lop.tagTrim === 'trim-both' && lop.labTrim === 'trim-both', JSON.stringify(lop));
  ok('no page errors on the lopsided fixture', LOP.errors.length === 0, LOP.errors[0]);
  await LOP.ctx.close();

  /* Colour follows the WINNER once final, not the pick. And the losing
     side keeps its badge colour — that badge is the only thing on the
     side identifying the team, and it used to be greyscaled away. */
  /* HOW A FINAL CARD IS RECOGNISED NOW. It used to be "the .cd[data-cd]
     chip says Final", and the winner came out of the lock band's text.
     Neither exists on a final card any more: the meta row is replaced
     by the centred `.meta.fmeta .fin` head, which is where FINAL and
     the winning code live, and the lock band is live-only. Who you took
     comes from the result bar. */
  const fin = await B.page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('.card')) {
      const head = el.querySelector('.meta.fmeta .fin');
      if (!head) continue;
      const m = head.textContent.match(/Final\s*·\s*([A-Z]{2,3})/);
      if (!m) continue;                       // a tie names no winner
      const bt = (el.querySelector('.resbar') || {}).textContent || '';
      const sides = [...el.querySelectorAll('.side')].map(sd => ({
        code: (sd.querySelector('.mark span') || {}).textContent || '',
        cls: sd.className,
        markFilter: getComputedStyle(sd.querySelector('.mark')).filter,
      }));
      out.push({ winner: m[1], sides, took: (/\b([A-Z]{2,3}) · /.exec(bt) || [])[1] || '' });
      if (out.length === 4) break;
    }
    return out;
  });
  ok('there are final cards to inspect', fin.length > 0, String(fin.length));
  ok('the lit side is the team that WON, whoever you took',
     fin.every(c => c.sides.some(sd => sd.code === c.winner && /\bwon\b/.test(sd.cls))),
     JSON.stringify(fin.map(c => ({ w: c.winner, took: c.took,
       lit: c.sides.filter(sd => /\bwon\b/.test(sd.cls)).map(sd => sd.code) }))));
  ok('and the other side is the one greyed',
     fin.every(c => c.sides.some(sd => sd.code !== c.winner && /\blost\b/.test(sd.cls))),
     JSON.stringify(fin.map(c => c.sides.map(sd => sd.code + ':' + sd.cls))));
  /* THE POINT OF THE CHANGE: at least one of these cards is one where
     the player backed the loser. If colour still followed the pick,
     that card would light the wrong side. */
  ok('including at least one card where you took the losing team',
     fin.some(c => c.took && c.took !== c.winner),
     JSON.stringify(fin.map(c => [c.took, c.winner])));
  ok('but the losing badge keeps its team colour',
     fin.every(c => c.sides.every(sd => !/grayscale/.test(sd.markFilter))),
     JSON.stringify(fin.map(c => c.sides.map(sd => sd.markFilter))));
  /* The desaturation that used to drain every colour on a locked card,
     and was why the badge disagreed with the pool bar below it. */
  const sat = await B.page.evaluate(() => {
    const m = document.querySelector('.card.locked .match');
    return m ? getComputedStyle(m).filter : 'none';
  });
  ok('a locked card is no longer desaturated wholesale', sat === 'none', sat);
  ok('no page errors on the finished fixture', B.errors.length === 0, B.errors[0]);
  await B.ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n53c. A final card reports the result as a WIN / LOSS pill (W3)');
{
  /* WHAT REPLACED Q2, AND WHY THE SHAPE IS STILL THE THING CHECKED.

     Q2 filled the whole bottom strip with --hit or --stamp and turned
     every letter white. It was chosen from a rendered sheet, it was
     built, and it shipped. It is gone because the result it reported
     now has a better home: the W3 pill — the word WIN or LOSS in a
     slanted outline at the rank circle's own size — in a result bar
     that also carries the points and what you took.

     The reason this case is still shaped around "prove the variant" is
     the reason it was written that way the first time: I built the
     WRONG variant of the strip once (N3, an inset ring, shown beside
     Q2 and not chosen) and a test asking "is there something green
     here" passed on it. So the checks below are specific enough to
     fail if W1, W2 or W4 had been built instead of W3, and to fail if
     a coloured lock band came back.

     FIVE STATES, each with its own fixture or branch:
       staked win   -> +n pts, WIN, everything in --hit
       staked loss  -> 0 pts, LOSS, everything in the paper-side red
       unstaked win -> +1 pt and the word Unstaked
       no pick      -> 0 pts and a dash
       ended level  -> no score and TIE, in neutral ink, neither colour */
  const HIT  = 'rgb(47, 110, 38)';    // --hit  #2F6E26
  const SINK = 'rgb(190, 47, 38)';    // the measured paper-side red
  const DARK = 'rgb(31, 29, 27)';     // the lock band's own #1F1D1B

  const past = new Date(Date.now() - 12*24*3600*1000).toISOString();
  const A = await open({ startISO: past, weeks: 2, gamesPerWeek: 16, playerCount: 8 });
  await A.page.waitForTimeout(600);
  /* BOTH WEEKS, because one is not enough. The generator's pick winner
     is (i+mi)%2 and the game winner is (w+i)%2, so in week 1 Lee calls
     every game WRONG and in week 2 every one RIGHT. Reading only one
     week left an assertion filtering an empty list, and .every() on
     nothing is true — which is how N3 passed as Q2. The non-emptiness
     checks below are what stop that recurring. */
  const collect = () => A.page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('.card')) {
      const bar = el.querySelector('.resbar');
      if (!bar) continue;
      const head = el.querySelector('.meta.fmeta .fin');
      const left = bar.querySelector('.sb-l.res');
      const pts  = bar.querySelector('.sb-pts');
      const word = bar.querySelector('.sb-word');
      const cs = el => el ? getComputedStyle(el) : null;
      const w = cs(word);
      out.push({
        head: head ? head.textContent.trim() : null,
        winner: head ? (head.textContent.match(/Final\s*·\s*([A-Z]{2,3})/) || [])[1] || null : null,
        took: left ? (/\b([A-Z]{2,3}) · /.exec(left.textContent) || [])[1] || null : null,
        unstaked: left ? /Unstaked/.test(left.textContent) : false,
        noPick: left ? /^No pick$/.test(left.textContent.trim()) : false,
        leftTxt: left ? left.textContent.trim() : '',
        leftInk: cs(left) ? cs(left).color : '',
        ptsTxt: pts ? pts.textContent.trim() : '',
        ptsInk: cs(pts) ? cs(pts).color : '',
        wordTxt: word ? word.textContent.trim() : '',
        wordInk: w ? w.color : '',
        wordBorder: w ? w.borderTopColor : '',
        wordFill: w ? w.backgroundColor : '',
        /* offsetHeight, NOT the bounding rect: the pill is rotated -7deg
           and a rotated box's RECT height grows with its width, so WIN
           measured 33 and LOSS 32 for two elements that are both
           exactly 26px + 2px of border tall. The layout height is the
           one that can be compared with the rank circle's. */
        wordH: word ? word.offsetHeight : 0,
        wordSlant: w ? w.transform : '',
        // the bar must not be a coloured strip
        barFill: cs(bar) ? cs(bar).backgroundColor : '',
        // and the lock band must be absent entirely
        band: !!el.querySelector('.lockband'),
      });
    }
    return out;
  });
  await A.page.click('.wk[data-wk="1"]');
  await A.page.waitForTimeout(800);
  const w1 = await collect();
  await A.page.click('.wk[data-wk="2"]');
  await A.page.waitForTimeout(800);
  const w2 = await collect();
  const all = [...w1, ...w2];
  const decided = all.filter(b => b.winner && b.took);
  const right = decided.filter(b => b.took === b.winner);
  const wrong = decided.filter(b => b.took !== b.winner);

  ok('there are decided cards to inspect', decided.length > 0, String(decided.length));
  ok('including games you called RIGHT', right.length > 0, String(right.length));
  ok('and games you called WRONG', wrong.length > 0, String(wrong.length));

  ok('a card you called right says WIN',
     right.every(b => b.wordTxt === 'WIN'),
     JSON.stringify(right.slice(0, 3).map(b => b.wordTxt)));
  ok('and one you called wrong says LOSS',
     wrong.every(b => b.wordTxt === 'LOSS'),
     JSON.stringify(wrong.slice(0, 3).map(b => b.wordTxt)));

  /* W3, NOT W1/W2/W4 — the specifics that tell the four apart. It is a
     WORD, so a single letter fails; it is an OUTLINE, so a filled pill
     fails; it is SLANTED, so the unslanted W4 fails; and it is at the
     rank circle's 26px, so anything else is a different control. */
  ok('the pill is a word, not a letter',
     decided.every(b => b.wordTxt.length > 1),
     JSON.stringify(decided.slice(0, 3).map(b => b.wordTxt)));
  ok('it is an outline, not a filled pill',
     decided.every(b => b.wordFill === 'rgba(0, 0, 0, 0)' || b.wordFill === 'transparent'),
     JSON.stringify(decided.slice(0, 2).map(b => b.wordFill)));
  ok('it is slanted, like the rank circle',
     decided.every(b => /matrix/.test(b.wordSlant) && b.wordSlant !== 'none'),
     JSON.stringify(decided.slice(0, 2).map(b => b.wordSlant)));
  /* AGAINST THE RANK CIRCLE ITSELF, not a number I typed. The whole
     point of the pill is that it is the same stamp as the rank circle
     in the stake bar, so the assertion has to be "the same as that
     thing" — a literal drifts the moment either changes, and the first
     version of this check used one and failed at 33px against a
     25-to-31 window I had guessed. Both boxes are the rotated bounding
     box of a 26px element with a 2px border, so they agree exactly. */
  /* THE CIRCLE NEEDS ITS OWN FIXTURE. Every game in this one has been
     played, so there is no stake bar anywhere on screen and nothing to
     compare against — the first version of this check read null and
     failed for that reason rather than for a real one. A week that has
     not kicked off has the bar, and it is the same stylesheet. */
  const U = await open({ startISO: new Date(Date.now() + 3*864e5).toISOString(),
                         weeks: 1, gamesPerWeek: 4, playerCount: 8 });
  await U.page.waitForTimeout(700);
  const circleH = await U.page.evaluate(() => {
    /* v1.42.0: the rank circle lives in the middle of the card now. */
    const n = document.querySelector('#slate .gutter .rkc');
    return n ? n.offsetHeight : null;
  });
  /* THE STAKE BAR IS A BUTTON AND KEEPS ITS 44px. v1.41.0 shortened the
     result bar, which shares the .stakebar class, and the one way that
     could go wrong is by shrinking the tap target people use to rank a
     pick. Graded on the unplayed week, where the stake bars are. */
  const stakeH = await U.page.evaluate(() => [...document.querySelectorAll('#slate .stakebar')]
    .filter(b => !b.classList.contains('resbar')).map(b => b.offsetHeight));
  ok('the stake bar is still a 44px tap target',
     stakeH.length > 0 && stakeH.every(h => h === 44), JSON.stringify([...new Set(stakeH)]));
  await U.ctx.close();
  ok('the rank circle is on screen to compare against', circleH !== null, String(circleH));
  /* v1.41.0: SMALLER THAN THE CIRCLE NOW, ON PURPOSE. The pill matched
     the rank circle's 26px because the result bar matched the stake
     bar's 44px. Lee took the result bar to 32px (it is not a tap target;
     the stake bar still is, and keeps 44), and a 26px stamp slanted 7
     degrees fills a 32px bar edge to edge. So the pill is 21px, and the
     honest assertions are the ones that still hold: it is SMALLER than
     the circle, it keeps the slant (above), and its slanted box sits
     inside its bar with room above and below. */
  const fit = await A.page.evaluate(() => [...document.querySelectorAll('.card .resbar')]
    .map(bar => { const w = bar.querySelector('.sb-word'); if (!w) return null;
      const b = bar.getBoundingClientRect(), r = w.getBoundingClientRect();
      return { top: +(r.top - b.top).toFixed(1), bottom: +(b.bottom - r.bottom).toFixed(1) }; })
    .filter(Boolean));
  ok('and the pill is smaller than the rank circle, to fit the shorter bar',
     circleH !== null && decided.every(b => b.wordH < circleH),
     JSON.stringify([circleH, ...new Set(decided.map(b => b.wordH))]));
  ok('with its slanted box clear of the bar above and below',
     fit.length > 0 && fit.every(f => f.top >= 2 && f.bottom >= 2),
     JSON.stringify(fit.slice(0, 3)));

  /* THE COLOUR RULE: green all through on a win, the paper-side red all
     through on a loss — the word, its outline, the points and the line
     about what you took. */
  ok('a win is green all through',
     right.every(b => b.wordInk === HIT && b.wordBorder === HIT &&
                      b.ptsInk === HIT && b.leftInk === HIT),
     JSON.stringify(right.slice(0, 2).map(b => [b.wordInk, b.ptsInk, b.leftInk])));
  ok('a loss is the paper-side red all through',
     wrong.every(b => b.wordInk === SINK && b.wordBorder === SINK &&
                      b.ptsInk === SINK && b.leftInk === SINK),
     JSON.stringify(wrong.slice(0, 2).map(b => [b.wordInk, b.ptsInk, b.leftInk])));
  /* NOT --stamp, and this is the assertion that says so. --stamp is
     4.32:1 on the card paper; the measured replacement is 4.75:1. */
  ok('and that red is NOT --stamp, which fails on this paper',
     wrong.every(b => b.ptsInk !== 'rgb(200, 52, 42)'),
     JSON.stringify(wrong.slice(0, 2).map(b => b.ptsInk)));

  ok('a loss scores zero and says so',
     wrong.every(b => b.ptsTxt === '0 pts'),
     JSON.stringify(wrong.slice(0, 3).map(b => b.ptsTxt)));
  ok('a win scores something and says so',
     right.every(b => /^\+\d+ pts?$/.test(b.ptsTxt)),
     JSON.stringify(right.slice(0, 3).map(b => b.ptsTxt)));
  ok('Rank is capitalised on every one of them',
     decided.every(b => !/\brank \d/.test(b.leftTxt)),
     JSON.stringify(decided.slice(0, 3).map(b => b.leftTxt)));

  /* NO COLOURED STRIP ANYWHERE. The bar sits on the card's own paper,
     and the lock band — which used to carry the fill — is not on a
     final card at all. */
  ok('the result bar is not a coloured strip',
     decided.every(b => b.barFill !== HIT && b.barFill !== SINK && b.barFill !== DARK),
     JSON.stringify(decided.slice(0, 2).map(b => b.barFill)));
  ok('and a final card has no lock band',
     decided.every(b => b.band === false),
     JSON.stringify(decided.slice(0, 3).map(b => b.band)));
  ok('no page errors', A.errors.length === 0, A.errors[0]);
  await A.ctx.close();

  ok('no card ever prints a rank it does not have',
     decided.every(b => !/Rank (undefined|null|NaN|0)\b/.test(b.leftTxt)),
     JSON.stringify(decided.slice(0, 3).map(b => b.leftTxt)));

  /* THE UNSTAKED PICK — the state Lee spotted, and the one that had no
     fixture anywhere until mutation batch 30 proved it.

     pay(r,n) returns 1 for a falsy rank, so a pick with no rank that
     comes in has ALWAYS scored one point — the same as rank 16. The
     scoring was never wrong; the card had no line for it, because
     "Rank 9" cannot be printed when there is no rank, so it read
     "+1 pt" with nothing explaining why 1 and not 8.

     Every fixture staked every pick — the weight was (i+mi)%16+1, never
     zero — so a mutation that deleted the word "Unstaked" and printed
     "Rank undefined" instead had nothing to show, and the assertion
     above passed with the bug in place. P.unstaked leaves the first n
     games of each week picked but unranked, which is what a player who
     taps a team and never opens the tray actually produces. */
  /* THE UNSTAKED CARDS ARE FOUND BY POSITION, NOT BY THE WORD.

     The first version of this case built its list with
     `.filter(b => /Unstaked/.test(b.left))` — which is the one way of
     picking the cards that cannot survive the bug it is here for.
     Delete the word and the list empties, every `.every()` below passes
     on nothing, and only "there are unstaked picks on screen" goes red.
     Mutation batch 30 reported exactly that.

     P.unstaked leaves the FIRST UN_N games of each week picked but
     unranked, and app-serve's kickoff offsets put game 0 on Thursday
     and games 1..n-4 at the same Sunday 1pm, so slate order is index
     order for the first few cards. Selecting by index means the content
     assertions read the cards that are SUPPOSED to say Unstaked and
     fail when they do not. The count assertion below is what catches a
     reordering, so a positional selector cannot go quietly wrong. */
  const UN_N = 3;
  const NS = await open({ startISO: past, weeks: 2, gamesPerWeek: 16,
                          playerCount: 8, unstaked: UN_N });
  await NS.page.waitForTimeout(700);
  /* BOTH WEEKS, for the same reason the main collection reads both: the
     generator's pick winner is (i+mi)%2 and the game winner is (w+i)%2,
     so one week has Lee calling every game right and the other every
     game wrong. Reading one week gave an unstaked WIN and no unstaked
     LOSS, and the loss branch had to be written as a conditional —
     which is an assertion that can vanish. */
  const readUn = () => NS.page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('.card')) {
      const bar = el.querySelector('.resbar'); if (!bar) continue;
      const head = el.querySelector('.meta.fmeta .fin');
      const l = bar.querySelector('.sb-l.res'), p = bar.querySelector('.sb-pts');
      const w = bar.querySelector('.sb-word');
      out.push({
        idx: out.length,
        winner: head ? (head.textContent.match(/Final\s*·\s*([A-Z]{2,3})/) || [])[1] || null : null,
        took: (/\b([A-Z]{2,3}) · /.exec(l.textContent) || [])[1] || null,
        left: l.textContent.trim(), pts: p.textContent.trim(),
        word: w.textContent.trim(),
        ink: getComputedStyle(l).color,
      });
    }
    return out;
  });
  await NS.page.click('.wk[data-wk="1"]').catch(() => {});
  await NS.page.waitForTimeout(800);
  const un1 = await readUn();
  await NS.page.click('.wk[data-wk="2"]').catch(() => {});
  await NS.page.waitForTimeout(800);
  const un2 = await readUn();
  const unst = [...un1, ...un2].filter(b => b.idx < UN_N && b.winner && b.took);
  /* EXACTLY UN_N PER WEEK, not "more than none". A positional selector
     that drifted — a reordered slate, a fixture that stopped unstaking
     the first games — would otherwise feed the content assertions the
     wrong cards, and they would fail for a reason that has nothing to
     do with the card. This assertion is the one that says so plainly. */
  ok('there are unstaked picks on screen, UN_N of them in each week',
     unst.length === UN_N * 2, String(unst.length));
  ok('an unstaked pick says Unstaked, not a rank',
     unst.every(b => b.left === `${b.took} · Unstaked`),
     JSON.stringify(unst.slice(0, 3).map(b => b.left)));
  ok('and never prints a rank it does not have',
     unst.every(b => !/Rank/.test(b.left)),
     JSON.stringify(unst.slice(0, 3).map(b => b.left)));
  const unWin = unst.filter(b => b.took === b.winner);
  const unLose = unst.filter(b => b.took !== b.winner);
  ok('the fixture covers an unstaked pick that WON', unWin.length > 0, String(unWin.length));
  /* ONE POINT, AND EXACTLY ONE. This is the number the whole state
     exists to explain, and "+1 pt" also proves ptsLbl's singular is
     still being used on this line. */
  ok('an unstaked pick that comes in is worth exactly one point',
     unWin.every(b => b.pts === '+1 pt'),
     JSON.stringify(unWin.slice(0, 3).map(b => b.pts)));
  ok('and it still says WIN', unWin.every(b => b.word === 'WIN'),
     JSON.stringify(unWin.slice(0, 3).map(b => b.word)));
  ok('and it is green', unWin.every(b => b.ink === HIT),
     JSON.stringify(unWin.slice(0, 2).map(b => b.ink)));
  ok('and an unstaked pick that lost', unLose.length > 0, String(unLose.length));
  ok('which scores nothing, in red, and says LOSS',
     unLose.length > 0 &&
     unLose.every(b => b.pts === '0 pts' && b.word === 'LOSS' && b.ink === SINK),
     JSON.stringify(unLose.slice(0, 3)));
  ok('no page errors on the unstaked fixture', NS.errors.length === 0, NS.errors[0]);
  await NS.ctx.close();

  /* NO PICK AT ALL. A card you never picked is a loss of a different
     kind: zero points, red, and a dash rather than a word, because
     there was no call to be right or wrong about. */
  const C = await open({ startISO: past, weeks: 2, gamesPerWeek: 16,
                         playerCount: 8, noPicks: true });
  await C.page.waitForTimeout(700);
  const none = await C.page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('.card')) {
      const bar = el.querySelector('.resbar'); if (!bar) continue;
      const l = bar.querySelector('.sb-l.res'), p = bar.querySelector('.sb-pts');
      const w = bar.querySelector('.sb-word');
      out.push({ left: l.textContent.trim(), pts: p.textContent.trim(),
                 word: w.textContent.trim(), ink: getComputedStyle(l).color });
    }
    return out;
  });
  ok('there are unpicked final cards to inspect', none.length > 0, String(none.length));
  ok('an unpicked card says No pick, not a rank',
     none.every(b => b.left === 'No pick'), JSON.stringify(none.slice(0, 3)));
  ok('scores zero', none.every(b => b.pts === '0 pts'), JSON.stringify(none.slice(0, 2)));
  ok('in the paper-side red', none.every(b => b.ink === SINK),
     JSON.stringify(none.slice(0, 2).map(b => b.ink)));
  ok('and the pill is a dash, not the word LOSS',
     none.every(b => !/LOSS|WIN/.test(b.word)), JSON.stringify(none.slice(0, 3).map(b => b.word)));
  ok('no page errors on the unpicked fixture', C.errors.length === 0, C.errors[0]);
  await C.ctx.close();

  /* A GAME STILL BEING PLAYED HAS DECIDED NOTHING. It keeps the lock
     band, the band keeps its dark #1F1D1B, and there is no result bar
     and no pill anywhere on it. */
  const justOn = new Date(Date.now() - 60*60*1000).toISOString();
  const B = await open({ startISO: justOn, weeks: 2, gamesPerWeek: 16, playerCount: 8 });
  await B.page.waitForTimeout(700);
  const live = await B.page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('.card')) {
      const band = el.querySelector('.lockband'); if (!band) continue;
      out.push({ cls: band.className, fill: getComputedStyle(band).backgroundColor,
                 txt: band.textContent.trim().slice(0, 40),
                 hasBar: !!el.querySelector('.resbar'),
                 hasPill: !!el.querySelector('.sb-word'),
                 hasFinHead: !!el.querySelector('.meta.fmeta') });
    }
    return out;
  });
  ok('a live game has a lock band', live.length > 0, String(live.length));
  ok('it is the neutral dark one and cannot be coloured',
     live.every(b => b.fill === DARK && !/\bwon\b|\blost\b/.test(b.cls)),
     JSON.stringify(live.slice(0, 2)));
  ok('it says the game is in progress, not final',
     live.every(b => /^Locked/.test(b.txt) && (/if it holds|No pick|Unstaked|^Locked[A-Z]{2,3}$/.test(b.txt))),
     JSON.stringify(live.slice(0, 2).map(b => b.txt)));
  ok('and a live card has no result bar, no pill and no final head',
     live.every(b => !b.hasBar && !b.hasPill && !b.hasFinHead),
     JSON.stringify(live.slice(0, 2)));
  ok('no page errors on the live fixture', B.errors.length === 0, B.errors[0]);
  await B.ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n53b. Everything on a final card must be readable on it');
{
  /* THE ORIGINAL BUG: `.meta .cd.done{color:var(--chalk)}`. --chalk is
     rgba(250,247,241,.62) — a near-white built for the dark shell — and
     the card's meta row is --paper-2, a near-white too. Measured
     1.09:1, so the word FINAL was all but invisible on every finished
     card, and by Sunday night that is most of the slate. Nothing
     errored and no test looked at colour, so it survived. Measured
     here rather than eyeballed, because "looks a bit faint" is how it
     got shipped.

     THE WORD MOVED, SO THE MEASUREMENT FOLLOWED IT — and grew, because
     the final card now carries five pieces of coloured text instead of
     one. FINAL is the `<b>` inside the centred `.fin` head; the score
     is the rest of that line; the result bar has the line about your
     pick, the points, and the pill. Every one of them sits on the
     card's own light paper, and three of them are in colours chosen
     BECAUSE of this measurement — which makes leaving them unmeasured
     the obvious way to lose it again.

     The method is unchanged: getComputedStyle resolves alpha but not
     the blend, so walk up for the first opaque background, composite,
     and take the ratio. The pill's OUTLINE is measured against 3:1
     rather than 4.5, because a border is a graphic and not text. */
  const past = new Date(Date.now() - 12*24*3600*1000).toISOString();
  const { ctx, page, errors } = await open(
    { startISO: past, weeks: 2, gamesPerWeek: 16, playerCount: 6 });
  await page.waitForTimeout(600);

  const CONTRAST = `(sel, which) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const px = v => (v.match(/[\\d.]+/g) || []).map(Number);
    const lin = x => { x /= 255; return x <= 0.03928 ? x/12.92
      : Math.pow((x + 0.055)/1.055, 2.4); };
    const lum = ([r,g,b]) => 0.2126*lin(r) + 0.7152*lin(g) + 0.0722*lin(b);
    let node = el, bg = null;
    while (node && !bg) {
      const v = px(getComputedStyle(node).backgroundColor);
      if (v.length >= 3 && (v.length < 4 || v[3] > 0)) bg = v.slice(0, 3);
      node = node.parentElement;
    }
    if (!bg) return null;
    const raw = which === 'border'
      ? getComputedStyle(el).borderTopColor : getComputedStyle(el).color;
    const f = px(raw);
    const a = f.length > 3 ? f[3] : 1;
    const fg = [0,1,2].map(i => f[i]*a + bg[i]*(1-a));
    const l1 = lum(fg), l2 = lum(bg);
    return { ratio: (Math.max(l1,l2) + 0.05) / (Math.min(l1,l2) + 0.05),
             colour: raw, txt: el.textContent.trim().slice(0, 24) };
  }`;
  const measure = (sel, which) =>
    page.evaluate(`(${CONTRAST})(${JSON.stringify(sel)}, ${JSON.stringify(which || 'color')})`);

  const head = await measure('.card .meta.fmeta .fin b');
  ok('a final card is on screen', !!head, JSON.stringify(head));
  ok('and its FINAL label clears 4.5:1 against the card',
     head && head.ratio >= 4.5,
     head && `${head.ratio.toFixed(2)}:1 (${head.colour})`);
  const score = await measure('.card .meta.fmeta .fin');
  ok('so does the score beside it',
     score && score.ratio >= 4.5,
     score && `${score.ratio.toFixed(2)}:1 (${score.colour}) "${score.txt}"`);

  /* THE RESULT BAR. Green and the paper-side red both had to be chosen
     against this exact paper — --stamp measured 4.32:1 here, which is
     why it is not used — so these three are the assertions that keep
     that decision honest. Checked on whichever card is first, then on
     a winning and a losing one specifically. */
  for (const [what, sel] of [
    ['the line about your pick', '.card .resbar .sb-l.res'],
    ['the points', '.card .resbar .sb-pts'],
    ['the word in the pill', '.card .resbar .sb-word'],
  ]) {
    const m = await measure(sel);
    ok(`${what} clears 4.5:1 too`, m && m.ratio >= 4.5,
       m && `${m.ratio.toFixed(2)}:1 (${m.colour}) "${m.txt}"`);
  }
  const ring = await measure('.card .resbar .sb-word', 'border');
  ok('and the pill\'s outline clears 3:1 as a graphic',
     ring && ring.ratio >= 3, ring && `${ring.ratio.toFixed(2)}:1 (${ring.colour})`);

  /* BOTH COLOURS, not just whichever the first card happens to be. The
     generator calls week 1 wrong and week 2 right, so one of the two
     weeks has the green and the other the red. */
  for (const [wk, want] of [['1', 'a loss'], ['2', 'a win']]) {
    await page.click(`.wk[data-wk="${wk}"]`).catch(() => {});
    await page.waitForTimeout(700);
    const m = await measure('.card .resbar .sb-pts');
    ok(`${want}'s points clear 4.5:1 on the card paper`,
       m && m.ratio >= 4.5,
       m && `week ${wk}: ${m.ratio.toFixed(2)}:1 (${m.colour}) "${m.txt}"`);
  }

  /* THE CHIP on the pool sub-line is a graphic, so 3:1. Only one team
     colour in the league fails it against this paper — Cincinnati's
     #FB4F14 at 2.76:1 — which is why the chip carries a hairline ring.
     Assert the ring exists rather than the colour passing, because the
     colour is the team's and not ours to change. */
  /* A LOPSIDED FIXTURE FOR THE NARROW SIDE, because the default one
     never produces it. The generator splits every game (i+mi)%2, so
     consensus is always ~50/50 and nothing is ever under the 22%
     threshold — the first version of these three checks reported "no
     narrow split in this fixture" and asserted nothing at all.
     P.lopsided makes one member the lone dissenter and alternates which
     side they are on, so one fixture has a narrow segment on the left
     and one on the right. */
  await ctx.close();
  const { ctx: LC, page: LP, errors: LE } = await open(
    { startISO: past, weeks: 2, gamesPerWeek: 16, playerCount: 13, lopsided: true });
  await LP.waitForTimeout(800);
  const page2 = LP;
  const chip = await page2.evaluate(() => {
    const c = document.querySelector('.card .cons-key .pchip');
    return c ? { shadow: getComputedStyle(c).boxShadow,
                 w: Math.round(c.getBoundingClientRect().width) } : null;
  });
  ok('the narrow-side chip is on screen', !!chip, JSON.stringify(chip));
  ok('it carries its hairline ring',
     chip && /rgba?\(/.test(chip.shadow) && chip.shadow !== 'none', JSON.stringify(chip));
  ok('and is 9px square', chip && chip.w === 9, chip && String(chip.w));

  /* THE HEAD IS CENTRED, AND MEASURED RATHER THAN TRUSTED. `.meta` gives
     its first child margin-right:auto and `.cd` margin-left:auto, so a
     row holding one item centres itself as a side effect of those
     cancelling out — it looked right for the wrong reason, and `.fmeta`
     was added to say it on purpose. Which means the assertion has to be
     about the pixels, not about the class being present: compare the
     head's centre with the card's. */
  const centred = await page2.evaluate(() => {
    const out = [];
    document.querySelectorAll('.card').forEach((card, i) => {
      const fin = card.querySelector('.meta.fmeta .fin');
      if (!fin) return;
      const c = card.getBoundingClientRect(), f = fin.getBoundingClientRect();
      out.push({ i, off: Math.round(((f.left + f.right) / 2) - ((c.left + c.right) / 2)) });
    });
    return out;
  });
  ok('there are final heads to measure', centred.length > 0, String(centred.length));
  ok('and every one is centred on its card',
     centred.every(h => Math.abs(h.off) <= 1),
     JSON.stringify(centred.filter(h => Math.abs(h.off) > 1).slice(0, 4)));

  /* W1: THE NARROW SIDE'S FIGURE SITS ON ITS OWN SIDE OF THE SPLIT.
     This is the whole point of the change and the one thing that could
     silently not be true — the figure would still be on screen, still
     say the right number, and just be at the wrong end. So compare the
     centre of the figure with the centre of the bar, and the centre of
     the narrow segment with the centre of the bar, and require them to
     agree. */
  const sides = await page2.evaluate(() => {
    const out = [];
    document.querySelectorAll('.cons').forEach((cons, i) => {
      const note = cons.querySelector('.cons-key b'); if (!note) return;
      const bar = cons.querySelector('.cbar:not(.cons-key)');
      const segs = [...bar.children]; if (segs.length < 2) return;
      const br = bar.getBoundingClientRect(), mid = (br.left + br.right) / 2;
      const small = segs.reduce((m, sg) =>
        sg.getBoundingClientRect().width < m.getBoundingClientRect().width ? sg : m);
      /* THE SQUARE IS THE FIGURE'S ANCHOR, so its side is graded, not the
         words'. The words hang off the square's inner side and are wide
         enough that, from a square in the wrong place, they can still
         reach the right half: mutation 31 walked straight through a
         version of this check that measured the words. */
      const anchor = cons.querySelector('.cons-key .pchip') || note;
      const sr = small.getBoundingClientRect(), nr = anchor.getBoundingClientRect();
      out.push({ i, txt: note.textContent.trim(),
                 sliver: (sr.left + sr.right) / 2 > mid ? 'right' : 'left',
                 note: (nr.left + nr.right) / 2 > mid ? 'right' : 'left' });
    });
    return out;
  });
  /* NOT CONDITIONAL. The fixture is built to produce these, so "if
     there are any" would let the whole check disappear the moment the
     generator drifted — which is the failure this replaced. */
  ok('the lopsided fixture produced narrow splits', sides.length > 0, String(sides.length));
  ok("the narrow side's figure sits on its own side of the split",
     sides.length > 0 && sides.every(x => x.sliver === x.note),
     JSON.stringify(sides.filter(x => x.sliver !== x.note).slice(0, 4)));
  ok('and it names the team whose sliver it is',
     sides.every(x => /^[A-Z]{2,3} \d+%$/.test(x.txt)),
     JSON.stringify(sides.slice(0, 3).map(x => x.txt)));
  /* LEE'S RULE, v1.41.0: the colour square is the key to a colour, so it
     sits CENTRED under the sliver it stands for, and the words hang off
     its inner side. Measured against the real bar, both ways round: the
     square's centre against the sliver's centre, to half a pixel. */
  const keys = await page2.evaluate(() => [...document.querySelectorAll('.cons')].map(cons => {
    const chip = cons.querySelector('.cons-key .pchip'); if (!chip) return null;
    const segs = [...cons.querySelectorAll('.cbar:not(.cons-key) .cseg')]; if (segs.length < 2) return null;
    const sm = segs.reduce((m, sg) => sg.getBoundingClientRect().width < m.getBoundingClientRect().width ? sg : m)
      .getBoundingClientRect();
    const ch = chip.getBoundingClientRect(), words = cons.querySelector('.cons-key b').getBoundingClientRect();
    const box = cons.getBoundingClientRect(), left = (sm.left + sm.right) / 2 < (box.left + box.right) / 2;
    return { off: +(((ch.left + ch.right) / 2) - ((sm.left + sm.right) / 2)).toFixed(2),
             inner: left ? words.left >= ch.right : words.right <= ch.left,
             onCard: words.left >= box.left && words.right <= box.right,
             side: left ? 'left' : 'right' };
  }).filter(Boolean));
  ok('the colour square is centred under the sliver it stands for',
     keys.length > 0 && keys.every(k => Math.abs(k.off) <= 0.5),
     JSON.stringify(keys.filter(k => Math.abs(k.off) > 0.5).slice(0, 3)));
  ok('with the words on its inner side, on the card, both ways round',
     keys.every(k => k.inner && k.onCard) && new Set(keys.map(k => k.side)).size === 2,
     JSON.stringify(keys.slice(0, 4)));
  /* BOTH WAYS ROUND, or the check passes on a fixture that only ever
     puts the sliver on one side and never exercises the swap. */
  ok('and the fixture covers a narrow left AND a narrow right',
     new Set(sides.map(x => x.sliver)).size === 2,
     JSON.stringify([...new Set(sides.map(x => x.sliver))]));
  ok('no page errors', LE.length === 0, LE[0]);
  await LC.close();
}

/* ------------------------------------------------------------------ */
console.log('\n54. One point is "1 pt"');
{
  /* Four places printed "1 PTS" — the stake bar, the rank picker and
     both halves of the lock band — because the lowest rank pays exactly
     one point and every one of them hardcoded the plural. */
  const { ctx, page, errors } = await open({ weeks: 2, gamesPerWeek: 16, playerCount: 6 });
  await page.waitForTimeout(400);
  const bad = await page.evaluate(() => {
    const txt = document.body.innerText;
    return (txt.match(/\b1 pts\b/gi) || []).length;
  });
  ok('nothing on the Picks tab says "1 pts"', bad === 0, String(bad));
  // The rank picker is where it was most visible: rank 16 pays one point.
  await page.evaluate(() => {
    const b = document.querySelector('[data-stake]'); if (b) b.click(); });
  await page.waitForTimeout(500);
  const tray = await page.evaluate(() => {
    const t = document.body.innerText;
    return { one: /\b1 pt\b/.test(t), plural: (t.match(/\b1 pts\b/gi) || []).length };
  });
  ok('the rank that pays one point says "1 pt"', tray.one === true, JSON.stringify(tray));
  ok('and never "1 pts"', tray.plural === 0, JSON.stringify(tray));
  ok('no page errors', errors.length === 0, errors[0]);
  await ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n55. The leader\'s pinned cells must not be see-through');
{
  /* THE BUG: `tbody tr.lead td{background:rgba(232,184,75,.09)}` also
     matched td.pl and td.tot, and a translucent colour beats the opaque
     var(--shell) those sticky columns are declared with. So on exactly
     one row — the leader's, and only while scrolled sideways — the
     pinned name column became a window and team codes slid through the
     name. Every other row was fine, and standing still it looks
     correct, which is why it survived. */
  const past = new Date(Date.now() - 12*24*3600*1000).toISOString();
  const { ctx, page, errors } = await open(
    { startISO: past, weeks: 2, gamesPerWeek: 16, playerCount: 10 });
  await page.click('[data-tab="grid"]').catch(() => {});
  await page.waitForTimeout(700);
  const bg = await page.evaluate(() => {
    const lead = document.querySelector('#gridBody tbody tr.lead');
    if (!lead) return null;
    const alpha = el => {
      const c = getComputedStyle(el).backgroundColor;
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return 1;
      const p = m[1].split(',').map(s => parseFloat(s));
      return p.length > 3 ? p[3] : 1;
    };
    return { pl: alpha(lead.querySelector('td.pl')),
             tot: alpha(lead.querySelector('td.tot')),
             plain: alpha(lead.querySelector('td:not(.pl):not(.tot)')) };
  });
  ok('the leader row exists', !!bg, JSON.stringify(bg));
  ok('its sticky name cell is fully opaque', bg && bg.pl === 1, JSON.stringify(bg));
  ok('and so is its sticky points cell',     bg && bg.tot === 1, JSON.stringify(bg));
  ok('while the scrolling cells keep the gold tint',
     bg && bg.plain < 1, JSON.stringify(bg));
  ok('no page errors', errors.length === 0, errors[0]);
  await ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n56. Week seals wait for the last whistle');
{
  /* The guard on the whole This-week honours feature. At 2pm on a
     Sunday the top row is whoever is ahead with nine games left, so a
     seal there would be awarded and withdrawn all afternoon. Nothing
     appears until every game in the week is final. */
  const mid = new Date(Date.now() - 3*24*3600*1000 - 2*3600*1000).toISOString();
  const { ctx, page, errors } = await open(
    { startISO: mid, weeks: 2, gamesPerWeek: 16, playerCount: 8 });
  await page.click('[data-tab="standings"]').catch(() => {});
  await page.waitForTimeout(600);
  await page.click('[data-stand="week"]').catch(() => {});
  await page.waitForTimeout(600);
  const live = await page.evaluate(() => ({
    finals: document.querySelectorAll('#gridBody thead th.gm .st.final').length,
    seals: document.querySelectorAll('#board .row svg').length,
    lead: (document.querySelector('#board .leadtag') || {}).textContent || '',
    silver: document.querySelectorAll('#board .leadtag.silver').length,
    second: document.querySelectorAll('#board .row.second').length,
  }));
  ok('this week is part-played, not finished',
     /leader/i.test(live.lead), live.lead);
  ok('so no seals yet', live.seals === 0, String(live.seals));
  ok('no runner-up banner either',
     live.silver === 0 && live.second === 0, JSON.stringify(live));
  ok('and the banner says "leader", not "winner"',
     !/winner/i.test(live.lead), live.lead);
  ok('no page errors', errors.length === 0, errors[0]);
  await ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n57. The archive is a Settings section, not a sixth tab');
{
  /* WHY IT MOVED. It was a tab that appeared when a pool document
     carried an archive and vanished when the flag was flipped, on a row
     that already scrolls at 320px — so the five tabs people use every
     Sunday shifted sideways for a closed pool nobody opens twice.

     WHAT HAD TO SURVIVE THE MOVE, and each of these is asserted below:
       the three visibility states, unchanged ('public' / 'owner' /
         'off'), decided by the same archiveVisible();
       the esc() on member names — archive_pool.py copies
         members/{uid}.name verbatim and any member can write their own
         name, so this renderer prints attacker-controlled text;
       the tab row's width, which is now FIXED at five;
       and nothing may look up a #v-archive that no longer exists — the
         view list drives every tab switch, so a stale entry there
         throws on the first press rather than at boot. */
  const ARCH = {
    id: 'preseason-2026', label: 'Preseason 2026', state: 'public',
    note: 'Three weeks, five players. Kept as a reference.',
    standings: [
      { name: '<img src=x onerror="window.__xss=1">', pts: 214, hits: 31, of: 42,
        wins: 2, seconds: 0, perfect: 0 },
      { name: 'Monse', pts: 198, hits: 29, of: 42, wins: 1, seconds: 2, perfect: 0 }],
    weeks: [{ wk: 3, winner: 'Mateo', pts: 78 }, { wk: 2, winner: 'Monse', pts: 71 }],
  };
  const look = async page => {
    await page.click('[data-tab="settings"]').catch(() => {});
    await page.waitForTimeout(500);
    return page.evaluate(() => {
      const box = document.getElementById('archOpt');
      const opts = [...document.querySelectorAll('#v-settings .opt')];
      return {
        tabs: document.querySelectorAll('.tabs .tab').length,
        archTab: document.querySelectorAll('[data-tab="archive"]').length,
        archView: !!document.getElementById('v-archive'),
        box: !!box,
        shown: !!box && !box.classList.contains('hide'),
        /* ON SCREEN, not merely un-classed. The content is written into
           #archBody whether or not the section is shown, and
           textContent and getComputedStyle both read straight through
           display:none — so every content check below passes on a
           section nobody can see. Measured height is what a player
           actually gets. */
        tall: !!box && Math.round(box.getBoundingClientRect().height),
        first: !!box && opts[0] === box,
        label: (document.querySelector('#archBody .arch-head h2') || {}).textContent || '',
        rows: document.querySelectorAll('#archBody .row').length,
        xss: !!window.__xss,
        raw: (document.querySelector('#archBody .who b') || {}).textContent || '',
        imgs: document.querySelectorAll('#archBody img').length,
        // the closing note must not be an invisible box on .opt's own
        // background, which is what var(--shell-2) on both would give
        footBg: (() => { const f = document.querySelector('#archBody .arch-foot');
          if (!f) return ''; const a = getComputedStyle(f).backgroundColor;
          const b = getComputedStyle(f.closest('.opt')).backgroundColor;
          return a === b ? 'same' : 'different'; })(),
      };
    });
  };

  const pub = await open({ playerCount: 6, weeks: 2, archive: ARCH });
  const p = await look(pub.page);
  ok('there is no Archive tab any more', p.archTab === 0);
  ok('and no #v-archive view to switch to', p.archView === false);
  ok('the tab row is a fixed five', p.tabs === 5, String(p.tabs));
  ok('the archive is a Settings section', p.box === true);
  ok('shown when the pool says public', p.shown === true);
  ok('and it takes up real space on the screen', p.tall > 200, String(p.tall));
  ok('and it is the FIRST section, above Scoring', p.first === true, String(p.first));
  ok('it renders the archived pool', /Preseason 2026/.test(p.label), p.label);
  ok('with its final standings', p.rows === 2, String(p.rows));
  ok('the closing note is not invisible on the section background',
     p.footBg === 'different', p.footBg);
  /* THE ESCAPE, CHECKED THREE WAYS: the payload did not execute, no
     element was created from it, and the name is on screen as text. */
  ok('a member name is escaped, not executed', p.xss === false);
  ok('and it created no element', p.imgs === 0, String(p.imgs));
  ok('while still printing the name as text', /onerror/.test(p.raw), p.raw);
  ok('no page errors', pub.errors.length === 0, pub.errors[0]);

  /* EVERY TAB STILL WORKS. The view list that drives tab switching
     named 'archive'; left in place it looks up a null and throws on the
     press, which is a failure that boot cannot show. */
  for (const t of ['picks', 'grid', 'standings', 'help', 'settings']) {
    await pub.page.click(`[data-tab="${t}"]`).catch(() => {});
    await pub.page.waitForTimeout(220);
  }
  ok('and pressing every tab in turn throws nothing',
     pub.errors.length === 0, pub.errors[0]);
  await pub.ctx.close();

  // 'owner' with a non-owner viewer, and 'off', are both invisible —
  // and invisible must mean the section, not the whole Settings screen.
  for (const st of ['owner', 'off']) {
    const h = await open({ playerCount: 6, weeks: 2, archive: { ...ARCH, state: st } });
    const r = await look(h.page);
    ok(`hidden when the pool says ${st}`,
       r.shown === false && r.tall === 0, JSON.stringify([r.shown, r.tall]));
    ok(`and Settings itself still renders with a ${st} archive`,
       (await h.page.locator('#v-settings .opt').count()) >= 4);
    ok(`no page errors with a ${st} archive`, h.errors.length === 0, h.errors[0]);
    await h.ctx.close();
  }

  // No archive at all is the normal case for a running pool.
  const none = await open({ playerCount: 6, weeks: 2 });
  const n = await look(none.page);
  ok('hidden when there is no archive',
     n.shown === false && n.tall === 0, JSON.stringify([n.shown, n.tall]));
  ok('and the tab row is still five', n.tabs === 5, String(n.tabs));
  ok('no page errors without an archive', none.errors.length === 0, none.errors[0]);
  await none.ctx.close();
}

/* ------------------------------------------------------------------ */
console.log('\n58. Four states that only exist when something has gone wrong');
{
  /* Every one of these was found by an adversarial read of the diff, not
     by using the app, and every one of them only appears in a situation
     the happy path never reaches. They are grouped because they share
     that shape: each is a case where the app kept SAYING "this is
     happening right now" after it had stopped being true. */

  /* 58a. ESPN GOES FINAL BEFORE WE DO, AND THAT GAP IS MINUTES LONG.
     pullEspn only skips state==='pre', so a game in 'post' passes
     straight through and shortDetail becomes "Final". Our own isFinal()
     is a SERVER write that lands when the scoring run gets there. In
     between, the card printed the word "Final" in the live-clock slot:
     green, with a pulsing dot, beside "In progress" on the right. */
  {
    const mnf = new Date(Date.now() - (4 * 864e5 + 5 * 3600e3)).toISOString();
    const { ctx, page, errors } = await open(
      { playerCount: 10, weeks: 2, gamesPerWeek: 16, startISO: mnf,
        espnDetail: 'Final' });
    await page.waitForTimeout(1700);
    const s = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('#slate .card')];
      // the live card is the one whose right-hand chip says In progress
      const live = cards.find(c => /in progress/i.test(
        ([...c.querySelectorAll('.meta .cd')].pop() || {}).textContent || ''));
      if (!live) return { none: true };
      const lefted = live.querySelector('.meta .cd.live.lefted');
      const first = live.querySelector('.meta > :first-child');
      return {
        none: false,
        clock: lefted ? lefted.textContent.trim() : null,
        firstTxt: first ? first.textContent.trim() : '',
        firstCls: first ? first.className : '',
        dots: [...live.querySelectorAll('.meta .cd.live')]
          .filter(e => !e.classList.contains('nodot')).length,
      };
    });
    ok('a live game is on screen with ESPN reporting Final', s.none === false);
    ok('ESPN\'s "Final" never renders as a running clock',
       s.clock === null, JSON.stringify(s.clock));
    ok('and the left slot falls back to the kickoff time instead',
       /^\d/.test(s.firstTxt) && /mono/.test(s.firstCls) &&
       !/\blive\b/.test(s.firstCls), JSON.stringify([s.firstTxt, s.firstCls]));
    /* THE HALF THAT IS EASY TO LOSE. The right-hand chip carries `nodot`
       precisely BECAUSE the clock owns the dot, so stripping the left
       slot's live styling without moving the dot back leaves a live game
       with no pulse anywhere on the row. */
    ok('with the dot moved to the right-hand chip, so the row still pulses',
       s.dots === 1, String(s.dots));
    ok('no page errors', errors.length === 0, errors[0]);
    await ctx.close();
  }

  /* 58b. "LIVE" NEEDS A CEILING. isLive() is a clock; `final` is a
     server write. A postponed game keeping its original kickoff, or one
     failed scoring run, left the header pulsing green on "1 game live"
     for the rest of the week — the app's one signal that something is
     happening right now, spent on a game that finished on Sunday.
     P.stuck holds the last game of each week on `scheduled` however
     long ago it kicked off, which the clock-derived generator cannot
     otherwise produce. */
  {
    const old = new Date(Date.now() - 5 * 864e5).toISOString();
    const { ctx, page, errors } = await open(
      { playerCount: 10, weeks: 2, gamesPerWeek: 16, startISO: old, stuck: 1 });
    await page.waitForTimeout(1500);
    /* ON WEEK 1 DELIBERATELY. The app has already moved on to week 2,
       and it is right to: the same six-hour clamp that this test is
       about also stops one stuck game pinning the whole pool on a dead
       week in December. So the app's own choice is correct and the
       header it shows for week 2 is a countdown. The bug lives on the
       week the stuck game is IN, which a player reaches by tapping its
       number — and used to find pulsing green there all week. */
    await page.click('.wk[data-wk="1"]').catch(() => {});
    await page.waitForTimeout(900);
    const s = await page.evaluate(() => ({
      header: (document.querySelector('#countdown') || {}).textContent.trim(),
      cls: (document.querySelector('#clock') || {}).className || '',
      // the stuck game kicked off days ago and is not final
      stale: [...document.querySelectorAll('#slate .card')].filter(c =>
        /in progress/i.test(c.textContent)).length,
    }));
    ok('the fixture has a game stuck unfinished', s.stale > 0, String(s.stale));
    ok('a stale unfinished game is not still "live" hours later',
       !/\blive\b/.test(s.header) && !/\blive\b/.test(s.cls),
       JSON.stringify([s.header, s.cls]));
    ok('and the header says the week is pending instead',
       /pending/i.test(s.header), JSON.stringify(s.header));
    ok('no page errors', errors.length === 0, errors[0]);
    await ctx.close();
  }

  /* 58c. THE TIE COLUMN'S THIRD STATE. Its header was a two-way switch
     — final, or else `live` — so before the tiebreak game had kicked
     off it read "Open" in live green, the one colour in that table that
     means a game is being played right now. It also left `.st.open` as
     dead CSS, which is how the mistake hid: the rule existed and
     nothing ever emitted the class. */
  {
    const soon = new Date(Date.now() + 2 * 864e5).toISOString();
    const { ctx, page, errors } = await open(
      { playerCount: 10, weeks: 2, gamesPerWeek: 16, startISO: soon });
    await page.click('[data-tab="grid"]').catch(() => {});
    await page.waitForTimeout(700);
    const s = await page.evaluate(() => {
      const th = document.querySelector('#gridBody thead th.tbcol');
      const st = th ? th.querySelector('.st') : null;
      const games = [...document.querySelectorAll('#gridBody thead th.gm .st')];
      return {
        txt: st ? st.textContent.trim() : '',
        cls: st ? st.className : '',
        // the game columns' own sealed state, for comparison: the Tie
        // column has to behave like one of them, not like its own thing
        gameStates: [...new Set(games.map(e => e.className))],
      };
    });
    ok('the tiebreaker column has a state label', s.txt.length > 0, JSON.stringify(s));
    ok('a sealed tiebreaker is not painted as live',
       !/\blive\b/.test(s.cls), JSON.stringify([s.txt, s.cls]));
    ok('it uses the same open state the game columns use',
       /\bopen\b/.test(s.cls) &&
       s.gameStates.some(c => /\bopen\b/.test(c)), JSON.stringify(s));
    ok('no page errors', errors.length === 0, errors[0]);
    await ctx.close();
  }

  /* 58d. YOUR OWN ROW, WHEN YOU CAME SECOND. .row.me sets its own flat
     background and .row.second's gradient replaced it outright, so the
     one row a player scrolls to find — theirs — lost the "me" tint and
     kept only a red edge. .row.me.lead has always blended the two; this
     is the same blend for silver.

     Asserted on the CSS rather than by arranging for ME to finish
     second, because who finishes where is the generator's business and a
     fixture built to put one player in one place is a fixture that
     stops testing this the moment the generator changes. Two probe rows,
     same stylesheet, compared. */
  {
    const { ctx, page, errors } = await open({ playerCount: 8, weeks: 2 });
    const s = await page.evaluate(() => {
      const mk = cls => {
        const d = document.createElement('div');
        d.className = cls;
        d.style.position = 'absolute';
        d.style.left = '-9999px';
        document.body.appendChild(d);
        const c = getComputedStyle(d);
        const v = { bg: c.backgroundColor, img: c.backgroundImage,
                    edge: c.borderLeftColor };
        d.remove();
        return v;
      };
      return { plain: mk('row'), second: mk('row second'),
               me: mk('row me'), meSecond: mk('row me second'),
               lead: mk('row lead'), meLead: mk('row me lead') };
    });
    ok('a runner-up row is tinted silver',
       s.second.img !== 'none' && s.second.img !== s.plain.img, JSON.stringify(s.second));
    ok('your own row is tinted too', s.me.bg !== s.plain.bg, JSON.stringify(s.me));
    ok('your own row keeps its highlight when you come runner-up',
       s.meSecond.img !== s.second.img, JSON.stringify([s.second.img, s.meSecond.img]));
    ok('which is what the gold row already did',
       s.meLead.img !== s.lead.img, JSON.stringify([s.lead.img, s.meLead.img]));
    ok('and the red left edge still marks it as yours',
       s.meSecond.edge === s.me.edge, JSON.stringify([s.me.edge, s.meSecond.edge]));
    ok('no page errors', errors.length === 0, errors[0]);
    await ctx.close();
  }
}

/* ------------------------------------------------------------------ */
console.log('\n59. A finished week in which nobody scored crowns nobody');
{
  /* `score_week.py` gates the entire weekly-award block on one line:

       best = max(r["wpts"] for r in results)
       if best > 0:

     Without it, a week that is over and in which every score is zero
     still hands out a 1ST seal and a gold "Week n winner" banner — and
     because the honours go by POINTS VALUE now, it hands them to
     EVERYBODY, since everybody is on the best score of nought.

     WHY THIS NEEDS ITS OWN FIXTURE. Case 56 covers "no seals before the
     last whistle", and that is a different gate: there `weekDone` is
     false, so the honours are never computed at all and removing the
     `best > 0` line changes nothing. The only way to reach this line is
     a week that IS finished with nothing scored in it — every player on
     zero — which takes three plan keys at once: no revealed picks, none
     of my own, and a banked server record of zero so `weekSum` does not
     quietly hand back the stub's fabricated 60-115 points instead.

     Reachable in a real pool? A whole pool scoring nothing across
     sixteen games is vanishingly unlikely. A week with one game that got
     postponed and re-scored, in a two-person pool, is not. And the
     scorer has the guard, so the app has to agree with the scorer. */
  const done = new Date(Date.now() - 9 * 864e5).toISOString();
  const { ctx, page, errors } = await open(
    { playerCount: 8, weeks: 2, gamesPerWeek: 16, startISO: done,
      noRevealed: true, noPicks: true, recPts: 0, recHits: 0 });
  await page.click('[data-tab="standings"]').catch(() => {});
  await page.waitForTimeout(500);
  await page.click('[data-stand="week"]').catch(() => {});
  await page.waitForTimeout(400);
  /* A FLAT WAIT HERE WAS A COIN TOSS, and it cost a diagnosis before it
     was understood. Measured, with the strip and the header sampled every
     400ms across a real switch:

       t+400ms   strip says week 1   header still the OLD week's countdown
       t+1200ms  strip says week 1   header finally reads "Week 1 Final"

     Three things happen at different times. state.week changes and
     renderWeeks() marks the button immediately; loadWeek() then fetches
     the week, taking most of a second; and the header is only rewritten
     by tick(), which runs once a second, so it shows the PREVIOUS week's
     text until the first tick after that fetch lands. A 900ms wait read
     the header at about 1300ms, right on the boundary, so this case
     failed perhaps one run in five with the header naming a future game
     — which reads exactly like a real defect and is not one.

     Waiting on the strip is not enough, as the trace above shows. Waiting
     for the header to SAY "Final" would make the assertion below
     tautological. So wait for the header to CHANGE from whatever it was
     before the click: that proves the app has re-rendered, and leaves the
     assertion free to fail if it re-rendered the wrong thing. */
  const headerBefore = await page.evaluate(
    () => (document.querySelector('#countdown') || {}).textContent);
  // Week 1 is the one that is entirely final in this fixture.
  await page.click('.wk[data-wk="1"]').catch(() => {});
  await page.waitForFunction(
    prev => document.querySelector('.wk[data-wk="1"]')?.classList.contains('on')
         && (document.querySelector('#countdown') || {}).textContent !== prev,
    headerBefore, { timeout: 15000 }).catch(() => {});
  const switched = await page.evaluate(
    () => !!document.querySelector('.wk[data-wk="1"]')?.classList.contains('on'));
  ok('the fixture actually switched to week 1', switched);
  await page.waitForTimeout(400);
  const s = await page.evaluate(() => ({
    rows: document.querySelectorAll('#board .row').length,
    pts: [...document.querySelectorAll('#board .row .pts b')]
      .map(e => e.textContent.trim()),
    seals: document.querySelectorAll('#board .row svg').length,
    tags: document.querySelectorAll('#board .leadtag').length,
    silver: document.querySelectorAll('#board .leadtag.silver').length,
    lead: document.querySelectorAll('#board .row.lead').length,
    second: document.querySelectorAll('#board .row.second').length,
    winnerWord: /winner/i.test(document.getElementById('board').textContent),
    // the header has to agree: the week IS final, it just has no winner
    header: (document.querySelector('#countdown') || {}).textContent.trim(),
  }));
  ok('the whole pool is on the board', s.rows === 8, String(s.rows));
  /* THE FIXTURE HAS TO ACTUALLY BE THE ZERO CASE, or everything below is
     vacuous — and getting here took three plan keys, any one of which
     could stop working without this check noticing. */
  ok('and every one of them scored nothing',
     s.pts.length === 8 && s.pts.every(p => p === '0'), JSON.stringify(s.pts));
  ok('the week is over, and the header says so',
     /Final/i.test(s.header), JSON.stringify(s.header));
  ok('nobody is sealed', s.seals === 0, String(s.seals));
  ok('nobody is crowned', s.tags === 0, String(s.tags));
  ok('no runner-up either', s.silver === 0 && s.second === 0, JSON.stringify(s));
  ok('and no row wears the gold treatment', s.lead === 0, String(s.lead));
  ok('the word "winner" appears nowhere on the board', s.winnerWord === false);
  ok('no page errors', errors.length === 0, errors[0]);
  await ctx.close();
}

/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
console.log('\n60. The version card in Settings, and where an update shows up');
{
  /* WHAT THIS IS FOR. "Is this phone on the new one" was answered for
     three releases by telling twenty eight people to swipe the app away
     and reopen it. The card is the number plus a button that asks, and
     the banner at the top of the Picks tab is where an update announces
     itself.

     THE NUMBER MUST COME FROM sw.js AND NOWHERE ELSE. That file holds
     the only version constant in the project and is the file whose
     change makes a phone fetch anything; a second constant in
     index.html would be a second line to remember to bump, and a wrong
     version on screen is worse than none. The stub reports what the
     server read off sw.js on disk, and this case compares the rendered
     text with the same file. */
  const openSettings = async page => {
    await page.click('[data-tab="settings"]').catch(() => {});
    await page.waitForTimeout(500);
  };
  const read = page => page.evaluate(() => {
    const opt = document.getElementById('verOpt');
    const opts = [...document.querySelectorAll('.settings > .opt')];
    const btn = document.getElementById('verBtn');
    const bar = document.getElementById('updbar');
    return {
      present: !!opt,
      last: !!opt && opts[opts.length - 1] === opt,
      visible: !!opt && opt.offsetHeight > 0,
      num: (document.getElementById('verNum') || {}).textContent.trim(),
      sub: (document.getElementById('verSub') || {}).textContent.trim(),
      label: btn ? btn.textContent.trim() : null,
      green: btn ? btn.classList.contains('now') : null,
      disabled: btn ? btn.disabled : null,
      barHidden: bar ? bar.classList.contains('hide') : null,
      activated: !!window.__swActivated,
      /* The button must sit on ONE row with the number, which is the
         whole reason .vbtn overrides .mbtn's full width. */
      sameRow: (() => {
        if (!btn) return null;
        const n = document.getElementById('verNum').getBoundingClientRect();
        const b = btn.getBoundingClientRect();
        return b.left > n.right && Math.abs((b.top + b.bottom) / 2 - (n.top + n.bottom) / 2) < 30;
      })(),
    };
  });

  /* ---- up to date, the state twenty seven of twenty eight see ---- */
  {
    const { ctx, page, errors } = await open({ playerCount: 6, weeks: 1, gamesPerWeek: 4 });
    await openSettings(page);
    const a = await read(page);
    ok('Settings carries a version card', a.present && a.visible, JSON.stringify(a));
    ok('and it is the last thing on the tab', a.last, String(a.last));
    ok('it prints the version sw.js declares, not one of its own',
       a.num === SW_VERSION, `${a.num} vs ${SW_VERSION}`);
    ok('the button offers a check', a.label === 'Check for update', a.label);
    ok('and it is not the green one yet', a.green === false, String(a.green));
    ok('the number and the button share a row', a.sameRow === true, JSON.stringify(a));
    ok('no update banner on the Picks tab', a.barHidden === true, String(a.barHidden));
    await page.click('#verBtn');
    await page.waitForTimeout(700);
    const b = await read(page);
    ok('checking reports back that this is the newest',
       /newest version/i.test(b.sub), b.sub);
    ok('and the version did not change under it', b.num === SW_VERSION, b.num);
    ok('still no banner, because nothing is waiting', b.barHidden === true);
    ok('no page errors', errors.length === 0, errors[0]);
    await ctx.close();
  }

  /* ---- one parked and waiting, which is the state that matters ---- */
  {
    const { ctx, page, errors } = await open(
      { playerCount: 6, weeks: 1, gamesPerWeek: 4, sw: 'waiting' });
    /* THE BANNER FIRST, BEFORE SETTINGS IS EVEN OPENED. A worker parked
       from a previous visit is announced at registration, which is what
       Lee asked for: the notice belongs at the top of the Picks tab,
       not only on a card in Settings. */
    await page.waitForTimeout(600);
    const boot = await page.evaluate(() => {
      const bar = document.getElementById('updbar');
      return { hidden: bar.classList.contains('hide'),
               /* EVERY CHECK ON THIS BANNER CARRIES ITS HEIGHT, and
                  that is the lesson of mutation batch 37. Hiding the
                  banner left both the wording and the position checks
                  green: a hidden element's bounding rect is all zeros,
                  so "above the slate" was trivially true at top 0, and
                  reading its text works fine either way. innerText was
                  my first fix and it is not one — the spec says innerText
                  falls back to textContent for an element that is not
                  being rendered, so it reads a display:none banner
                  exactly as textContent does. offsetHeight is the only
                  one of the three that actually knows. Same trap as the
                  archive-in-Settings case. */
               text: (bar.innerText || '').replace(/\s+/g, ' ').trim(),
               height: bar.offsetHeight,
               top: Math.round(bar.getBoundingClientRect().top),
               slate: Math.round(document.getElementById('slate').getBoundingClientRect().top) };
    });
    ok('an update parked from a previous visit raises the banner at once',
       boot.hidden === false, JSON.stringify(boot));
    ok('the banner says a new version is ready',
       boot.height > 0 && /new version is ready/i.test(boot.text), JSON.stringify(boot));
    ok('and it sits above the games, not below them',
       boot.height > 0 && boot.top < boot.slate, JSON.stringify(boot));

    await openSettings(page);
    await page.click('#verBtn');
    await page.waitForTimeout(700);
    const c = await read(page);
    ok('the card turns its button green when one is waiting', c.green === true, JSON.stringify(c));
    ok('and says so plainly', /newer version is ready/i.test(c.sub), c.sub);
    ok('the label becomes Update now', c.label === 'Update now', c.label);
    /* TAPPING IT ACTUALLY APPLIES IT. The stub records the call rather
       than reloading, because a reload here would throw away the
       assertion. */
    await page.click('#verBtn');
    await page.waitForTimeout(400);
    const d = await read(page);
    ok('tapping it applies the waiting worker', d.activated === true, JSON.stringify(d));
    ok('no page errors', errors.length === 0, errors[0]);
    await ctx.close();
  }

  /* ---- no worker at all: a browser tab on a first visit ---- */
  {
    const { ctx, page, errors } = await open(
      { playerCount: 6, weeks: 1, gamesPerWeek: 4, sw: 'none' });
    await openSettings(page);
    const a = await read(page);
    /* NOT INSTALLED IS AN ANSWER. The temptation is to fall back to a
       constant in index.html, which is the one thing this card must
       never do. */
    ok('with no worker it says so rather than inventing a number',
       /not installed/i.test(a.num), a.num);
    ok('and tells you how to get one', /home screen/i.test(a.sub), a.sub);
    await page.click('#verBtn');
    await page.waitForTimeout(600);
    const b = await read(page);
    ok('checking cannot succeed, and says that too',
       /could not check/i.test(b.sub), b.sub);
    ok('the button is not green and not stuck on Checking',
       b.green === false && b.label === 'Check for update', JSON.stringify(b));
    ok('no page errors', errors.length === 0, errors[0]);
    await ctx.close();
  }

  /* ---- the check itself fails, which is a phone on bad wifi ---- */
  {
    const { ctx, page, errors } = await open(
      { playerCount: 6, weeks: 1, gamesPerWeek: 4, sw: 'offline' });
    await openSettings(page);
    const a = await read(page);
    ok('offline, the version it already has is still printed',
       a.num === SW_VERSION, a.num);
    await page.click('#verBtn');
    await page.waitForTimeout(600);
    const b = await read(page);
    ok('and a failed check says so instead of claiming to be up to date',
       /could not check/i.test(b.sub), b.sub);
    ok('the button recovers rather than staying disabled',
       b.disabled === false, String(b.disabled));
    ok('no page errors', errors.length === 0, errors[0]);
    await ctx.close();
  }
}

/* ------------------------------------------------------------------ */
console.log('\n61. White writing on every club, and the ring that makes it work');
{
  /* THE INSTRUCTION: no black writing anywhere on a game card, white
     throughout, with a thin white ring round the badge on the team you
     took or the team that won.

     WHAT WAS BLACK. onColor() measured each club's primary and returned
     near-black for the four too light for white text, so the lit side
     of a CIN, MIA, CAR or LAC card printed its name in #15171B and the
     other twenty eight printed white. onColor is gone.

     WHAT WE KNOWINGLY GAVE UP is asserted here too, at the bottom, with
     the real ratios: on those four the team name sits between 3.37 and
     4.28:1 rather than 4.5. That is a decision, not an oversight, and a
     test that quietly stopped measuring it would let it drift into an
     oversight. */
  const past61 = new Date(Date.now() - 12 * 864e5).toISOString();
  const { ctx, page, errors } = await open(
    { startISO: past61, weeks: 2, gamesPerWeek: 16, playerCount: 8 });
  await page.waitForTimeout(700);

  const readSides = () => page.evaluate(() => {
    const px = s => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const lin = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
    const lum = c => .2126 * lin(c[0]) + .7152 * lin(c[1]) + .0722 * lin(c[2]);
    const cr = (a, b) => { const x = lum(a), y = lum(b);
      return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
    const out = [];
    for (const side of document.querySelectorAll('.card .side')) {
      const cs = getComputedStyle(side);
      const bg = px(cs.backgroundColor);
      const mark = side.querySelector('.mark');
      const one = sel => {
        const el = side.querySelector(sel); if (!el) return null;
        const s2 = getComputedStyle(el);
        const a = parseFloat(s2.opacity);
        /* THE OPACITY HAS TO BE COMPOSITED HERE. getComputedStyle
           reports the city line as white with an opacity beside it, and
           reading only the colour would grade a line that is not on
           screen: at 62% over Cincinnati orange it measured 2.08:1. */
        return { raw: s2.color, opacity: a,
                 ratio: +cr(px(s2.color).map((v, i) => v * a + bg[i] * (1 - a)), bg).toFixed(2),
                 size: parseFloat(s2.fontSize), weight: +s2.fontWeight };
      };
      out.push({
        won: side.classList.contains('won'),
        lost: side.classList.contains('lost'),
        code: mark ? mark.textContent.trim() : null,
        ring: mark ? getComputedStyle(mark).boxShadow : null,
        /* THE BADGE'S SECONDARY STRIP, which is the thing "no black
           writing on the card" actually came down to. It is a 6px
           ::after bar of the club's secondary colour, and for Atlanta,
           Cincinnati and the Jets that colour is #000000. Reading the
           pseudo-element is the only way to see it: nothing about the
           .mark element itself changes. */
        strip: mark ? getComputedStyle(mark, '::after').display : null,
        stripBg: mark ? getComputedStyle(mark, '::after').backgroundColor : null,
        city: one('.city'), team: one('.team'), scr: one('.scr'),
        inline: side.getAttribute('style') || '',
      });
    }
    return out;
  });

  await page.click('.wk[data-wk="1"]').catch(() => {});
  await page.waitForTimeout(900);
  const s1 = await readSides();
  await page.click('.wk[data-wk="2"]').catch(() => {});
  await page.waitForTimeout(900);
  const s2 = await readSides();
  const all = [...s1, ...s2];
  const lit = all.filter(x => x.won);
  const WHITE = 'rgb(255, 255, 255)';

  ok('the fixture puts lit sides from the whole league on screen',
     new Set(lit.map(x => x.code)).size >= 24, String(new Set(lit.map(x => x.code)).size));

  /* ---- 1. NO BLACK WRITING, and no inline colour to put it back ---- */
  const notWhite = lit.filter(x => x.team.raw !== WHITE || x.city.raw !== WHITE
                                || x.scr.raw !== WHITE);
  ok('every lit side writes in white, on all 32 clubs', notWhite.length === 0,
     JSON.stringify(notWhite.slice(0, 3).map(x => x.code + ' ' + x.team.raw)));
  /* THE ROUTE THE BLACK CAME BY. onColor put a colour in the side's
     inline style attribute, which beats any stylesheet rule, so the one
     assertion that cannot be satisfied by accident is that the
     attribute carries a background and nothing else. */
  ok('and the inline style sets a background only, never a colour',
     lit.every(x => /^background:/.test(x.inline.trim()) && !/color:/.test(x.inline)),
     JSON.stringify(lit.slice(0, 2).map(x => x.inline)));

  /* ---- 2. THE RING ---- */
  const ringed = lit.filter(x => /rgba?\(255, 255, 255/.test(x.ring || ''));
  ok('every lit badge carries the white ring', ringed.length === lit.length,
     `${ringed.length} of ${lit.length}`);
  ok('and it is a hairline, not a border',
     lit.every(x => /inset/.test(x.ring) && /1\.5px|2px/.test(x.ring)),
     JSON.stringify(lit[0] && lit[0].ring));
  /* THE LOSING BADGE MUST NOT HAVE ONE. The ring is what marks the side
     you took; putting it on both would make it decoration. */
  const dim = all.filter(x => x.lost && x.ring);
  ok('a losing badge has no white ring', dim.length > 0
     && dim.every(x => !/rgba?\(255, 255, 255/.test(x.ring)),
     JSON.stringify(dim.slice(0, 2).map(x => x.code + ' ' + x.ring)));

  /* ---- 2b. THE BADGE KEEPS ITS SECOND COLOUR, BOTH SIDES ----
     I removed this strip from the selected badge, reading "no black
     writing anywhere" as covering it. It is the club's second colour,
     not writing, and Lee wants it: gold on Green Bay, #101820 on
     Carolina. Both sides keep it; the ring is the only thing the
     selected badge gains. */
  ok('a selected badge keeps its second-colour strip',
     lit.every(x => x.strip && x.strip !== 'none'),
     JSON.stringify(lit.filter(x => !x.strip || x.strip === 'none')
       .slice(0, 3).map(x => x.code + ' ' + x.strip)));
  const keepStrip = all.filter(x => x.lost && x.strip);
  ok('and so does an unselected one', keepStrip.length > 0
     && keepStrip.every(x => x.strip !== 'none'),
     JSON.stringify(keepStrip.slice(0, 2).map(x => x.code + ' ' + x.strip)));
  /* AND IT IS THE CLUB'S OWN SECOND COLOUR, not a fixed accent. The
     strip is what tells a Packers badge from a Panthers badge at 42px,
     so a rule that hardcoded one colour would pass "the strip is there"
     while throwing away the reason for it. */
  ok('the strip is painted from the club\u2019s own --sec',
     lit.every(x => x.stripBg && x.stripBg !== 'rgba(0, 0, 0, 0)'),
     JSON.stringify(lit.slice(0, 3).map(x => x.code + ' ' + x.stripBg)));

  /* ---- 3. THE CITY LINE AT FULL WHITE ---- */
  /* FADED SLIGHTLY, WHICH IS A RANGE AND NOT A LOOK. Lee wants the city
     line set back from the team name. .62 was the old value and is far
     too much (2.08:1 on Cincinnati, the worst text on any card); full
     white made it as loud as the name. .92 is the most fade that keeps
     the worst club at 3:1 or better. The window below is deliberately
     narrow: anything outside it is either not faded or too faded. */
  ok('the lit city line is faded, but only slightly',
     lit.every(x => x.city.opacity >= 0.9 && x.city.opacity <= 0.95),
     JSON.stringify(lit.slice(0, 3).map(x => x.code + ' ' + x.city.opacity)));
  ok('so it sits back from the team name rather than matching it',
     lit.every(x => x.city.ratio < x.team.ratio),
     JSON.stringify(lit.slice(0, 3).map(x => `${x.code} city ${x.city.ratio} name ${x.team.ratio}`)));
  /* AND IT IS STILL WHITE, which is the part the fade must not cost.
     An opacity is not a colour: the declared colour stays #fff and the
     composite stays a light grey, never a dark one. */
  ok('and it is still white, not grey ink',
     lit.every(x => x.city.raw === WHITE),
     JSON.stringify(lit.slice(0, 2).map(x => x.city.raw)));
  ok('and nothing on a lit side is under 3:1 any more',
     lit.every(x => x.city.ratio >= 3 && x.team.ratio >= 3 && x.scr.ratio >= 3),
     JSON.stringify(lit.filter(x => x.city.ratio < 3 || x.team.ratio < 3)
       .slice(0, 3).map(x => x.code + ' ' + x.city.ratio + '/' + x.team.ratio)));

  /* ---- 4. WHAT WAS GIVEN UP, stated rather than hidden ---- */
  /* The score line is 21px at weight 800, which is WCAG large text, so
     3:1 is its floor and every club clears it. */
  ok('the score line is large text, and passes its own 3:1 floor',
     /* v1.42.0: 28px Oswald at 600. WCAG large text is 24px at any
        weight (or 18.66px bold), so 3:1 is still the floor. */
     lit.every(x => (x.scr.size >= 24 || (x.scr.size >= 18.66 && x.scr.weight >= 700)) && x.scr.ratio >= 3),
     JSON.stringify(lit.slice(0, 2).map(x => `${x.scr.size}px/${x.scr.weight} ${x.scr.ratio}`)));
  const LIGHT = ['CIN', 'MIA', 'CAR', 'LAC'];
  const soft = lit.filter(x => x.team.ratio < 4.5);
  ok('the only clubs under 4.5:1 are the four light ones, by decision',
     soft.every(x => LIGHT.includes(x.code)),
     JSON.stringify([...new Set(soft.map(x => x.code))]));
  ok('and they are between 3.3 and 4.3, which is where the sheet said',
     soft.every(x => x.team.ratio >= 3.3 && x.team.ratio <= 4.3),
     JSON.stringify(soft.slice(0, 4).map(x => x.code + ' ' + x.team.ratio)));

  /* ---- 5. THE DARK INK THAT STAYS, AND IT IS A DECISION ----

     Lee asked twice for "no black writing anywhere on the cards or
     outside of it, only white", and the sheets
     docs/mockups/paper-ink-1-what-is-dark-390.png and
     paper-ink-2-options-390.png put four answers in front of him. He
     picked the one that changes nothing:

       "The black is fine on the card, before you select it, once a
        side is selected it goes white writing."

     So the rule is exactly that: WHITE IS WHAT SELECTION LOOKS LIKE.
     Dark ink on the cream paper is not a defect to be chased, it is
     the other half of the signal. A well-meant later pass that
     "finishes the job" by whitening the paper side would delete the
     contrast that tells a picked side from an unpicked one, and would
     be invisible anyway: white on this paper measures about 1.2:1.

     These four assertions exist so that pass cannot land quietly. */
  const paper = await page.evaluate(() => {
    const px = s => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const lin = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
    const lum = c => .2126 * lin(c[0]) + .7152 * lin(c[1]) + .0722 * lin(c[2]);
    const surfaceOf = el => {
      for (let n = el; n; n = n.parentElement) {
        const bg = getComputedStyle(n).backgroundColor;
        const p = px(bg), a = (bg.match(/[\d.]+/g) || [])[3];
        if (p.length === 3 && (a === undefined || +a > .9)) return p;
      }
      return [255, 255, 255];
    };
    /* BOTH ALPHAS. Nearly every quiet ink in this app is an rgba
       COLOUR, not an element opacity: --ink-mute is
       rgba(21,23,27,.66). Reading cs.opacity alone reports the head as
       near-black and grades a pixel that is not on screen. */
    const read = (sel, label) => {
      const el = document.querySelector(sel); if (!el) return null;
      const cs = getComputedStyle(el);
      const parts = (cs.color.match(/[\d.]+/g) || []).map(Number);
      const ca = parts.length > 3 ? parts[3] : 1;
      const a = ca * parseFloat(cs.opacity);
      const bg = surfaceOf(el.parentElement || el);
      const fg = parts.slice(0, 3).map((v, i) => v * a + bg[i] * (1 - a));
      const r = (Math.max(lum(fg), lum(bg)) + .05) / (Math.min(lum(fg), lum(bg)) + .05);
      return { label, darker: lum(fg) < lum(bg), ratio: +r.toFixed(2) };
    };
    const one = [
      read('.card .meta .fin', 'head'),
      read('.card .cons-head span', 'pool label'),
      read('.card .gutter span', 'gutter @'),
    ].filter(Boolean);
    /* AND WHAT WHITE WOULD ACTUALLY MEASURE on that paper, read off the
       card rather than quoted from a note. */
    const surf = surfaceOf(document.querySelector('.card .cons'));
    const wr = (Math.max(lum([255, 255, 255]), lum(surf)) + .05)
             / (Math.min(lum([255, 255, 255]), lum(surf)) + .05);
    return { one, whiteOnPaper: +wr.toFixed(2) };
  });

  const dimInk = all.filter(x => x.lost);
  ok('an unselected side writes in DARK ink, which is the decision',
     dimInk.length > 0 && dimInk.every(x => x.team.raw !== WHITE && x.city.raw !== WHITE),
     JSON.stringify(dimInk.slice(0, 2).map(x => x.code + ' ' + x.team.raw)));
  ok('so white ink is what selecting a side looks like, and only that',
     lit.length > 0 && dimInk.length > 0
       && lit.every(x => x.team.raw === WHITE) && dimInk.every(x => x.team.raw !== WHITE),
     `${lit.length} lit white, ${dimInk.length} unselected dark`);
  ok('and the card’s paper bands keep their dark ink too',
     paper.one.length === 3 && paper.one.every(x => x.darker),
     JSON.stringify(paper.one.map(x => x.label + ' ' + (x.darker ? 'dark' : 'LIGHT'))));
  /* THE REASON, MEASURED. This is the number that makes the decision
     more than a preference: there is no usable white ink on this paper
     at all. */
  ok('because white on that paper would be invisible, not faint',
     paper.whiteOnPaper > 1 && paper.whiteOnPaper < 1.3,
     `white on the card paper is ${paper.whiteOnPaper}:1`);

  ok('no page errors', errors.length === 0, errors[0]);
  await ctx.close();
}

console.log('\n62. Who has the ball, on a live card');
{
  /* WHAT THIS IS. ESPN sends situation.possession on a game in
     progress, and index.html already fetches that scoreboard once a
     minute for the score and the clock, so the football is a third
     value out of a request that was already being made. No Firestore
     write, no Worker change.

     THE FOUR THINGS THAT WERE DECIDED, each from a rendered sheet, and
     each of them a separate way to get this wrong:
       the ball is on the GUTTER side of both panels, mirrored
       the gaps differ per side, 3 characters unselected and 4 selected
       the ink is currentColor, so white on the colour and dark on cream
       it appears ONLY while a game is being played */
  const px = s => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  const readBalls = page => page.evaluate(() => {
    const px = s => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const lin = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
    const lum = c => .2126 * lin(c[0]) + .7152 * lin(c[1]) + .0722 * lin(c[2]);
    const cr = (a, b) => { const x = lum(a), y = lum(b);
      return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
    const surf = el => {
      for (let n = el; n; n = n.parentElement) {
        const bg = getComputedStyle(n).backgroundColor;
        const p = px(bg), a = (bg.match(/[\d.]+/g) || [])[3];
        if (p.length === 3 && (a === undefined || +a > .9)) return p;
      }
      return [255, 255, 255];
    };
    const out = [];
    for (const card of document.querySelectorAll('#slate .card')) {
      const ball = card.querySelector('.ball');
      if (!ball) continue;
      const side = ball.closest('.side');
      const num = side.querySelector('.scrn');
      const gut = card.querySelector('.gutter');
      const cs = getComputedStyle(ball);
      const bg = surf(ball.parentElement);
      const parts = (cs.color.match(/[\d.]+/g) || []).map(Number);
      const ca = parts.length > 3 ? parts[3] : 1;
      const fg = parts.slice(0, 3).map((v, i) => v * ca + bg[i] * (1 - ca));
      const br = ball.getBoundingClientRect(), nr = num.getBoundingClientRect(),
            gr = gut.getBoundingClientRect(), sr = side.getBoundingClientRect();
      const away = side.classList.contains('l');
      out.push({
        club: (side.querySelector('.mark span') || {}).textContent.trim(),
        away, lit: side.classList.contains('won'),
        toNumber: +(away ? br.left - nr.right : nr.left - br.right).toFixed(1),
        /* v1.42.0: the ball hangs beside a score that is CENTRED under the
           team name, and must not push it off centre. */
        centred: (() => { const mr = side.querySelector('.names').getBoundingClientRect();
          return Math.abs((nr.left + nr.right) / 2 - (mr.left + mr.right) / 2) <= 1; })(),
        /* MEASURED AGAINST THE NUMBER, NOT THE GUTTER, and the first
           version was measured against the gutter and could not see the
           bug. "Is the ball left of the gutter" is TRUE for the entire
           away panel, badge side included, so dropping the mirror left
           this assertion green: the away ball moved to the far end of
           the card and the test did not notice. The mirror is really a
           claim about which side of the SCORE the ball sits on, so that
           is what this reads. Found by mutation batch 54. */
        onGutterSide: away ? br.left >= nr.right - 1 : br.right <= nr.left + 1,
        inside: br.left >= sr.left - .5 && br.right <= sr.right + .5,
        sameLine: Math.abs((br.top + br.bottom) / 2 - (nr.top + nr.bottom) / 2) < 3,
        ratio: +cr(fg, bg).toFixed(2),
        strokes: ball.querySelectorAll('[stroke]').length,
      });
    }
    return out;
  });

  /* ---- a live slate, both possessions, so BOTH kinds of side appear.
          Two runs rather than one, and then an assertion that both were
          actually seen. The first version ran only the alternating
          fixture and guarded the selected-side gap with `if (li.length)`
          — and in that fixture no LIT side ever held the ball, so the
          one assertion covering the 4-character gap never ran and the
          case passed without it. An assertion that can quietly skip is
          the same failure as one that grades nothing. ---- */
  {
    const runs = [];
    /* v1.42.0: 'alt' too. With only home and away, the ball only ever
       sat on a selected AWAY side or an unselected HOME side, so a bug
       on one side of the card could hide behind the other (mutation
       batches 54 and 55 showed it). Alternating covers all four. */
    for (const who of ['home', 'away', 'alt']) {
      /* Forty minutes into the SUNDAY window, not Thursday's: Thursday is
         one game, so one pick and one ball, and two of the four
         side-and-ball combinations could never occur. */
      const { ctx, page, errors } = await open({
        startISO: new Date(Date.now() - (3 * 864e5 + 61200000 + 40 * 60000)).toISOString(),
        weeks: 1, gamesPerWeek: 8, playerCount: 10,
        espnDetail: '2nd 5:42', espnBall: who });
      await page.waitForTimeout(2600);
      runs.push({ balls: await readBalls(page), errors });
      await ctx.close();
    }
    const balls = runs.flatMap(r => r.balls);
    const errors = runs.flatMap(r => r.errors);
    ok('a live game shows the football', balls.length > 0, String(balls.length));
    ok('and the fixture covered a selected side AND an unselected one',
       [true, false].every(lit => [true, false].every(away => balls.some(b => b.lit === lit && b.away === away))),
       JSON.stringify(balls.map(b => b.club + (b.lit ? ' lit' : ' unlit'))));
    /* MIRRORED, which is the thing a first pass gets wrong: the home
       panel is right-aligned and the away panel left-aligned, so one
       source order puts the ball on opposite ends of the card. */
    ok('and it is on the gutter side of whichever panel holds it',
       balls.every(b => b.onGutterSide),
       JSON.stringify(balls.filter(b => !b.onGutterSide).slice(0, 2)));
    ok('on the same line as the score',
       balls.every(b => b.sameLine), JSON.stringify(balls.slice(0, 2)));
    /* THE TWO GAPS ARE DIFFERENT ON PURPOSE. The panels are not the
       same width (flex-grow 1.12 against .94), so one number cannot
       look even; 3 characters unselected and 4 selected was chosen from
       a sheet and measured at 4.4px apart to the gutter instead of
       12.2px. A single gap would pass a looser assertion. */
    const un = balls.filter(b => !b.lit), li = balls.filter(b => b.lit);
    /* v1.42.0 THE SCORE IS CENTRED NOW, so the ball no longer has to make
       up for the panels being different widths: it hangs 8px off the
       number on both sides, and the number stays centred whichever side
       holds it. The 36/48px pair belonged to the left-aligned score. */
    ok('the unselected side hangs the ball 8px off the number',
       un.length > 0 && un.every(b => Math.abs(b.toNumber - 8) < 1.5),
       JSON.stringify(un.map(b => b.club + ' ' + b.toNumber)));
    ok('and the selected side the same 8px',
       li.length > 0 && li.every(b => Math.abs(b.toNumber - 8) < 1.5),
       JSON.stringify(li.map(b => b.club + ' ' + b.toNumber)));
    ok('and the ball does not push the score off centre',
       balls.every(b => b.centred), JSON.stringify(balls.filter(b => !b.centred).slice(0, 2)));
    ok('nothing leaves its panel at that distance',
       balls.every(b => b.inside), JSON.stringify(balls.slice(0, 2)));
    /* WHITE ON THE COLOUR, DARK ON THE PAPER, from one currentColor
       drawing. Asserting the ratio rather than the hex, because the
       point is that it is readable on whichever ground it lands on. */
    ok('it is readable on whichever side it lands on',
       balls.every(b => b.ratio >= 3),
       JSON.stringify(balls.map(b => b.club + ' ' + b.ratio)));
    /* AN OUTLINE, NOT A FILLED OVAL. Filled, the laces have to be drawn
       in the background colour and vanish on the white side, which is
       what the first draft did and why it read as a dot. */
    ok('and it is drawn as an outline, so the laces show on both',
       balls.every(b => b.strokes >= 2), JSON.stringify(balls[0]));
    ok('no page errors', errors.length === 0, errors[0]);
  }

  /* ---- ESPN sends no situation at all ---- */
  {
    const { ctx, page, errors } = await open({
      startISO: new Date(Date.now() - 40 * 60000).toISOString(),
      weeks: 1, gamesPerWeek: 6, playerCount: 10,
      espnDetail: 'Halftime', espnBall: 'none' });
    await page.waitForTimeout(2600);
    const balls = await readBalls(page);
    ok('no situation from ESPN means no football at all',
       balls.length === 0, String(balls.length));

    /* ---- AND THE SCORE MUST NOT HAVE MOVED, which is the bug the
       football's own assertions could not see.

       THE DEFECT THIS EXISTS FOR, shipped in v1.39.0 and found only by
       diffing the build against v1.38.3 and measuring. `.scr` became a
       flex row and the away side was reversed so the ball would land on
       the gutter side. A REVERSED ROW PACKS TO THE RIGHT. With a ball
       present that is invisible, because ball plus gap plus digits
       already fills the box, so every possession assertion above stayed
       green. With NO ball the box is wider than the digits and the away
       score slid 27.6px right of where it had always sat: on every live
       card the away side was not holding, and on EVERY final card.

       WHY NOTHING CAUGHT IT. Every check written for this feature looked
       at a card that HAD a football. The regression lives in the card
       that does not. A feature's tests must also grade what the feature
       does to everything it did not add.

       THE ASSERTION IS THE PANEL, NOT A PIXEL COUNT. The score starts at
       the same left edge as the team name above it, because they are the
       same column of the same panel. That is true at any width, on any
       club, and it does not have to be re-measured if the layout is ever
       retuned. */
    const aligned = await page.evaluate(() => {
      const out = [];
      for (const card of document.querySelectorAll('.match')) {
        for (const side of card.querySelectorAll('.side.l')) {
          const num = side.querySelector('.scrn');
          const name = side.querySelector('.team') || side.querySelector('.city');
          if (!num || !name) continue;
          /* v1.42.0: the score is centred under the name column, so the
             measure is the two centres, not the two left edges. */
          const nr = num.getBoundingClientRect(), tr = side.querySelector('.names').getBoundingClientRect();
          out.push({ num: +((nr.left + nr.right) / 2).toFixed(1), name: +((tr.left + tr.right) / 2).toFixed(1),
                     off: +((nr.left + nr.right) / 2 - (tr.left + tr.right) / 2).toFixed(1) });
        }
      }
      return out;
    });
    ok('the fixture actually has an away score to grade',
       aligned.length > 0, String(aligned.length));
    ok('with no football, the away score still sits centred under its name',
       aligned.every(a => Math.abs(a.off) <= 1.5),
       JSON.stringify(aligned.filter(a => Math.abs(a.off) > 1.5).slice(0, 3)));
    ok('no page errors', errors.length === 0, errors[0]);
    await ctx.close();
  }

  /* ---- AND THE ONE THAT MATTERS: possession that GOES AWAY ----

     This is the bug that would look like a feature. A guard of
     `if (own)` around the write passes every check above, because a
     fixture that never had possession and never gets it looks exactly
     like one that clears correctly. The failure only appears in a
     SEQUENCE: the ball is held, then ESPN stops sending `situation` at
     halftime or between drives, and the last holder keeps wearing the
     football until the week rolls over.

     Reported by mutation batch 56 as uncaught, which was right: there
     was no fixture for the state.

     THE 21 SECONDS ARE THE PRICE OF REACHING IT. The app polls ESPN
     once a minute and refuses any pull within 20 seconds of the last
     one (ESPN_FLOOR). espnLoop() is idempotent while its timer is
     alive, so the only way to force a second poll is to let the timer
     be torn down — which happens when the visible week has nothing
     live — and then come back past the floor. Hence: switch to a week
     with no live game, wait out the floor, switch back. One case in the
     suite pays this, and it is the only route to the one bug here that
     a user would actually notice. */
  {
    const { ctx, page, errors } = await open({
      startISO: new Date(Date.now() - 40 * 60000).toISOString(),
      weeks: 2, gamesPerWeek: 6, playerCount: 10,
      espnDetail: '2nd 5:42', espnBall: 'home' });
    await page.waitForTimeout(2600);
    const before = await readBalls(page);
    ok('a held ball is on the card to start with', before.length > 0, String(before.length));

    /* ESPN stops sending it, exactly as it does at halftime. */
    await page.evaluate(() => {
      window.__espn = (window.__espn || []).map(e => {
        const c = e.competitions[0];
        delete c.situation;
        return e;
      });
    });
    /* Away to a week with nothing live, so the poll timer is dropped. */
    await page.click('.wk[data-wk="2"]').catch(() => {});
    await page.waitForTimeout(21000);
    await page.click('.wk[data-wk="1"]').catch(() => {});
    await page.waitForTimeout(2600);
    const after = await readBalls(page);
    ok('and it clears when ESPN stops sending one, rather than sticking',
       after.length === 0, JSON.stringify(after.map(b => b.club)));
    ok('no page errors', errors.length === 0, errors[0]);
    await ctx.close();
  }

  /* ---- before kickoff, and after the server says final ---- */
  {
    const { ctx, page, errors } = await open({
      startISO: new Date(Date.now() + 3 * 864e5).toISOString(),
      weeks: 1, gamesPerWeek: 6, playerCount: 10, espnBall: 'home' });
    await page.waitForTimeout(1400);
    const balls = await readBalls(page);
    ok('a game that has not kicked off never shows one',
       balls.length === 0, String(balls.length));
    ok('no page errors', errors.length === 0, errors[0]);
    await ctx.close();
  }
  /* ---- AND THE WHISTLE, which also needed a sequence ----

     A week that is already final never polls ESPN at all: espnWanted()
     filters to live-and-unfinished, so ESPN_BALL stays empty and no
     football appears whether the isFinal() guard is there or not. That
     fixture passed with the guard removed, and mutation batch 57 said
     so.

     The state that matters is a game that was LIVE, recorded a
     possession, and then goes final underneath it: the card keeps its
     score forever, so a football left on it would sit there until the
     week rolled over. __pushWeek is the watcher hook the stub already
     exposes, so the whistle can be blown without a reload. */
  {
    const { ctx, page, errors } = await open({
      startISO: new Date(Date.now() - 40 * 60000).toISOString(),
      weeks: 1, gamesPerWeek: 6, playerCount: 10,
      espnDetail: '4th 0:41', espnBall: 'home' });
    await page.waitForTimeout(2600);
    const before = await readBalls(page);
    ok('a live game has the football before the whistle',
       before.length > 0, String(before.length));
    await page.evaluate(() => {
      window.__pushWeek(window.__weekGames().map(g => ({
        ...g, status: 'final', awayScore: 17, homeScore: 13, winner: g.away })));
    });
    await page.waitForTimeout(900);
    const after = await readBalls(page);
    ok('and a finished game drops it, however stale ESPN is',
       after.length === 0, JSON.stringify(after.map(b => b.club)));
    ok('no page errors', errors.length === 0, errors[0]);
    await ctx.close();
  }
}

/* ------------------------------------------------------------------ */
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
if (fails.length) { console.log('FAILURES:'); fails.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);
