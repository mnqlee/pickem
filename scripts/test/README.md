# Tests

189 checks. Nothing here touches Firebase, Resend, KV or the live site.

    npm i -D playwright && npx playwright install chromium   # once
    openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out test_key.pem
    cp ../../worker/auth.js ./auth.mjs

    node auth.core.test.mjs      # 27  sign-in Worker, happy path and edges
    node auth.stress.test.mjs    # 38  sign-in Worker, adversarial

    node serve.mjs &
    node stress-ui.mjs           # 48  sign-in screens in a real browser
    node invite.ui.test.mjs      #  5  bare-domain invite links

    node app-serve.mjs &
    node polish.ui.test.mjs      # 40  layout, states, degradation, edges
    node season.ui.test.mjs      # 21  full 18-week season, 25-40 players
    node sw.push.test.mjs        # 10  service worker push display
    node shots.mjs all           #     screenshots to /tmp/shots

`app-serve.mjs` returns data in the exact shape Firestore holds it, per
`import_schedule.py` and `score_week.py`, so the app's own mapping and
scoring layers are exercised rather than bypassed.

## What these exist to catch

Every bug below shipped. None would surface by clicking around.

**Membership and pool membership are two different records.**
`setup_season.py` wrote `pools/{id}` with an `ownerUid` but no
`members/{uid}`, and `firestore.rules` gates the roster, standings, picks
and tiebreaks on `isMember()`. So the pool OWNER could read the pool
document and nothing else — and because a pool *was* found, the app never
offered the join screen that would have fixed it. A locked door with the
key on the far side. Fixed in three places: the script now writes the
member doc, `ensureJoined()` self-heals an existing half-joined pool, and
the error screen offers "Start over".

**Sign-in.** Two independent causes of "I typed the code straight away and
it said expired": the PIN was stored in KV and read back on verify (KV is
eventually consistent, and a successful sign-in deleted the key), and the
code auto-submits on the sixth digit *and* the button is tappable, with no
in-flight guard.

**Standings were wrong all season.** `renderBoard` summed points out of
`BOT`, but `loadWeek` wipes `BOT` and refills it for one week. Every
completed week scored zero. The authoritative figures were already in
`standings/{uid}.weeks`. See `weekSum()`.

**Real data vs demo keys.** The render layer was written against the
demo's short keys (`a`/`h`/`sp`/`net`). The Firestore mapping covered the
first three and missed `network`, so `g.net` printed "undefined" on every
card. `mapGames()` is the single place that mapping happens now.

**One unknown team abbreviation blanked the whole app.** `T[code]`
destructured undefined and threw; all rendering is one synchronous chain.
Lookups go through `TEAM()` now.

**Boot was all-or-nothing.** Eight reads ran in series with a blank screen,
nothing caught a failure, and one failing read killed everything. Now only
the schedule is essential — every other read degrades to an empty value
via `optional()`, and `watchAuth` re-entry is guarded so a token refresh
can no longer yank the onboarding out from under someone mid-sign-in.

Add a case here before changing any of this again.

## Known limit, deliberately not "fixed" in code

KV has no atomic increment, so the failed-attempt counters lose a race
against guesses fired in parallel. That belongs to a Cloudflare Rate
Limiting rule on `/api/verify-code` (10 requests / 1 minute / IP, Block).
`auth.stress.test.mjs` asserts the undercount on purpose.
