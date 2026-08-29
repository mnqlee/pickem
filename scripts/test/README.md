# Sign-in tests

118 checks over the one screen the whole app is judged on: name, email, code.

    npm i -D playwright && npx playwright install chromium   # once
    openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out test_key.pem
    cp ../../worker/auth.js ./auth.mjs

    node auth.core.test.mjs        # 27 — the happy path and its edges
    node auth.stress.test.mjs      # 38 — adversarial and real-world edges
    node serve.mjs &               # then, in another shell:
    node signin.ui.test.mjs        # 48 — the real screens in a real browser
    node invite.ui.test.mjs        #  5 — bare-domain invite links

Nothing here touches Firebase, Resend, KV or the live site. `auth.js` runs
against a fake KV whose staleness the test controls; the UI tests serve the
real `index.html` with a stub `PS` and a scriptable `/api`.

## What these exist to catch

The sign-in path had two independent bugs that both showed up as "I typed the
code straight away and it said expired", which is why neither was obvious:

1. **Server** — the PIN was written to KV and read back on verify. KV is
   eventually consistent, and a successful sign-in deleted the key, so the
   next attempt could read a stale miss and reject a correct, seconds-old
   code. `auth.stress.test.mjs` forces that exact staleness.
2. **Client** — the code auto-submits when the sixth digit lands *and* the
   button is tappable, with no in-flight guard, so one code got verified
   twice concurrently and the losing request painted a failure over the one
   that had already succeeded. `signin.ui.test.mjs` fires both at once.

Add a case here before fixing anything in this path again. A bug that only
appears under a race or a stale read will not show up by clicking around.

## Known limit, deliberately not "fixed" in code

KV has no atomic increment, so the failed-attempt counters lose a race
against guesses fired in parallel: they stop a person retyping by hand,
which is their job, but not a script. That belongs to a Cloudflare Rate
Limiting rule on `/api/verify-code` (10 requests / 1 minute / IP, Block).
`auth.stress.test.mjs` asserts the undercount on purpose, so if someone
later believes they have fixed it in code, the test will say otherwise.
