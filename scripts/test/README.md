# Tests

149 checks. Nothing here touches Firebase, Resend, KV or the live site.

    npm i -D playwright && npx playwright install chromium   # once
    openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out test_key.pem
    cp ../../worker/auth.js ./auth.mjs

    node auth.core.test.mjs      # 27  sign-in Worker, happy path and edges
    node auth.stress.test.mjs    # 38  sign-in Worker, adversarial

    node serve.mjs &             # sign-in screens
    node stress-ui.mjs           # 48  the real screens in a real browser
    node invite.ui.test.mjs      #  5  bare-domain invite links

    node app-serve.mjs &         # whole app, real Firestore-shaped data
    node polish.ui.test.mjs      # 31  standings, layout, states, edges
    node shots.mjs all           #     screenshots to /tmp/shots

`auth.js` runs against a fake KV whose staleness the test controls.
`serve.mjs` and `app-serve.mjs` serve the real `index.html` with a stub `PS`
and a scriptable `/api`; `app-serve.mjs` returns data in the exact shape
Firestore holds it, per `import_schedule.py` and `score_week.py`, so the
app's own mapping and scoring layers are exercised rather than bypassed.

## What these exist to catch

Every bug below shipped, and none of them would surface by clicking around.

**Sign-in.** Two independent causes of "I typed the code straight away and it
said expired": the PIN was stored in KV and read back on verify (KV is
eventually consistent, and a successful sign-in deleted the key, so the next
attempt could read a stale miss), and the code auto-submits on the sixth
digit *and* the button is tappable, with no in-flight guard, so one code got
verified twice and the losing request painted a failure over the winner.

**Standings were wrong all season.** `renderBoard` summed points out of
`BOT`, but `loadWeek` wipes `BOT` and refills it for one week, because
`getRevealed(wk)` is a per-week query. So every completed week scored zero
and the table sat on 0 points for everybody. The authoritative per-week
figures were already in `standings/{uid}.weeks`, written by `score_week.py`,
and simply were not being read. See `weekSum()`.

**Real data vs demo keys.** The render layer was written against the demo's
short keys (`a`/`h`/`sp`/`net`). The Firestore mapping covered the first
three and missed `network`, so `g.net` printed the literal word "undefined"
on every card. `mapGames()` is now the single place that mapping happens.

**One unknown team abbreviation blanked the whole app.** `T[code]`
destructured undefined and threw, and because every render runs in one
synchronous chain that took out games, grid and standings with no error
shown. Team lookups go through `TEAM()` now.

**Blank screen on boot.** Onboarding was hidden and then eight Firestore
reads ran in series with nothing on screen — and nothing caught a failure,
so any one of them dying left the user on an empty shell permanently.

Add a case here before changing any of this again.

## Known limit, deliberately not "fixed" in code

KV has no atomic increment, so the failed-attempt counters lose a race
against guesses fired in parallel: they stop a person retyping by hand,
which is their job, but not a script. That belongs to a Cloudflare Rate
Limiting rule on `/api/verify-code` (10 requests / 1 minute / IP, Block).
`auth.stress.test.mjs` asserts the undercount on purpose, so if someone
later believes they have fixed it in code, the test will say otherwise.
