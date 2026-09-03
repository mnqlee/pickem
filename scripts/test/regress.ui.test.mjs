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
  const { ctx, page, errors } = await open({ mode: 'straight' });
  await page.waitForTimeout(500);
  await page.click('[data-tab="settings"]').catch(() => {});
  await page.waitForTimeout(400);
  const on = await page.locator('.mbtn.on').first().getAttribute('data-mode').catch(() => null);
  ok('a straight-up pool shows Straight-up selected', on === 'straight', String(on));
  ok('no errors', errors.length === 0, errors[0] || '');
  await ctx.close();
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
