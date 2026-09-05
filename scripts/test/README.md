# Tests

455 checks. Nothing here touches Firebase, Resend, KV or the live site.

    npm i -D playwright && npx playwright install chromium   # once
    openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out test_key.pem
    cp ../../worker/auth.js /tmp/auth.mjs      # NOTE: /tmp — see below

    node auth.core.test.mjs      # 27  sign-in Worker, happy path and edges
    node auth.stress.test.mjs    # 49  sign-in Worker, adversarial

    node serve.mjs &
    node signin.ui.test.mjs      # 48  sign-in screens in a real browser
    node invite.ui.test.mjs      #  5  bare-domain invite links

    node app-serve.mjs &
    node polish.ui.test.mjs      # 41  layout, states, degradation, edges
    node season.ui.test.mjs      # 21  full 18-week season, 25-40 players
    node scale.ui.test.mjs       # 21  50 players, all 18 weeks, 390 and 320px
    node regress.ui.test.mjs     # 109 bugs that shipped, so they cannot return
    node sw.push.test.mjs        # 16  service worker push + what it may cache
    node shots.mjs all           #     screenshots to /tmp/shots

    python season_sim.py         # 118 the REAL scorer, 50 players, 18 weeks

`season_sim.py` needs no Firebase and no credentials: `fakestore.py` is an
in-memory stand-in for the Firestore client, so `score_week.py` runs
unmodified against a seeded season. It is the only thing that tests the
code deciding who actually wins — the browser suite never runs the scorer,
it renders standings the scorer already wrote.

**The auth tests import `/tmp/auth.mjs`, not `./auth.mjs`.** Copying to the
local directory leaves a stale `/tmp` copy in place, and the suite then
grades a previous version of the Worker while reporting a clean pass — it
happened, and it hid four real failures behind a green run. Copy to `/tmp`,
and re-copy after every edit to `worker/auth.js`.

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

**Clearing one pick wiped a whole week's confidence points.** The scorer
demanded an exact 1..k run of ranks and scored anyone else straight-up.
Un-picking a game leaves the rank it held unused, so an ordinary tap
produced `{1..6, 8..16}` — a hole, not a duplicate — and cost that player
every ranked point for the week, with no message and nothing on the sheet
to show it. The out-of-range half of that check was wrong too, and for a
worse reason: a game postponed OUT of a week leaves the players who
ranked it holding a 16 on a 15-game slate, through no act of their own —
and that also cost them the week. `pay()` is now clamped at both ends, so
the only shape that can beat an honest sheet is a repeated rank, and that
is the only thing penalised. `season_sim.py` covers all of it.

**A correct pick could score minus one.** `pay()` is `n + 1 - rank`, and a
rank can outlive the slate it was made against: rank sixteen games, have
one postponed into another week, and rank 16 on the resulting 14-game week
paid −1. Floored at zero in all three implementations — the app, the
scorer, and the snapshot builder — which now have to stay in step.

**The Grid's sticky header stuck to nothing.** `thead th{position:sticky}`
binds to the nearest scrollport, which was a box with `overflow-x:auto`
and no height — so the page scrolled, the box left with it, and the header
was gone by row 12. Reading the CSS never showed this; scrolling a 50-row
pool does. `scale.ui.test.mjs` scrolls and asserts the header is still on
screen.

**The atomic rate limiter rebuilt the lockout it was added to prevent.**
`verifyCode` checks the code before the KV counters precisely so a correct
PIN always beats a lockout aimed at someone's address. The new
`PINS_LIMITER` check went in ABOVE that comparison, keyed on the email —
so eight wrong guesses a minute would answer the real owner 429 while they
typed the right code, the same DoS as before and cheaper to run. The
address key now lives in the wrong-guess branch — and so does the IP key,
because an IP is not a person either: four players on one living-room
WiFi, or anyone behind carrier NAT, share it, and the fifth to sign in on
game day was refused while holding the right code. Section K covers the
bindings themselves, which nothing tested before: every other test runs
with no binding at all, so an inverted check would have passed the suite
green.

**The service worker cached `/api/session` forever.** It is a GET whose
path ends in neither `.html` nor `.js` nor a slash, so it fell through to
the cache-first branch — and its body is a Firebase custom token that
expires in an hour. Signing out did not sign you out (the reload re-read
the cached token and signed the same person back in; on a shared iPad,
the next person was signed in as the previous player); every returning
player was sent back to the PIN screen weekly, forever, because the
stale token was rejected and never re-fetched; and a 401 cached on the
first-ever visit killed session restore from day one. Bumping VERSION did
not help, because nothing ever activated a waiting worker — the update
prompt was passed to a function that dropped it, so `SKIP_WAITING` was
unreachable code. Both fixed; `sw.push.test.mjs` asserts `/api/*` is
never intercepted.

**Every weekly result notification was rejected by Google.** `link` must
be an absolute HTTPS URL; `score_week.py` and `remind.py` both passed
`"/index.html"`, so FCM answered 400 INVALID_ARGUMENT and the failure
went to a log line in a green workflow run. `worker/live.js` had already
found and fixed exactly this; the two Python senders were never updated.

**A postponed game was scored as a 0-0 final.** ESPN reports it as state
`post` with no score. `live.js` guards that and refuses to write;
`score_week.py` did not, runs later, and overwrote the refusal — which
silently made the week "complete", handed out weekly awards on it, and
took the confidence stake off everyone who had picked that game.

**Weekly badges could never be revoked.** `award()` only ever added, so
re-scoring a week after a corrected result left the old winner holding a
1ST seal beside the new one — the Standings tab and the Week-by-week row
disagreeing on the same screen.

**A stranger could lock you out of your own account.** The 45-second
"we already sent you one" cooldown was keyed on the delivery mailbox
while the PIN is derived from the identity, and outside Gmail those
differ. Requesting a code for `you+x@yahoo.com` set the cooldown on
`you@yahoo.com`, so your own request was answered "already sent" with no
email — while the code in your inbox belonged to a different identity and
could never verify.

**"Show me the walkthrough again" landed one tap from the end.**
`replayOnboarding()` searched for the single screen flagged `howto` — the
"Six rules" recap, which is also the LAST screen before "Let's play" —
so Settings' "Show me the walkthrough again," for someone already
signed in, skipped the install prompt and the alerts screen entirely
and opened on the final page. The function's own comment always said
the intent was to skip only the two sign-in screens, not the rest of
the tour; it now looks for the first screen that isn't one of those two,
which is what actually honours that comment.

**Every alert switch in Settings had the browser's own button drawn
underneath the app's.** They were changed from bare `<div>`s to real
`<button role="switch">` elements for keyboard and screen-reader access,
but nothing reset a `<button>`'s own border, background and padding —
only `border-top` was ever set, so the platform's native button chrome
showed through on the other three sides of every row, which is what
made the list read as offset and uneven rather than flat rows in one
list. Toggling one off made it worse: the off-state track was 16%-white
on a dark card with no border of its own, legible only by contrast with
a same-row native button box that no longer exists once the reset is
applied — so the fix pairs a full button reset with a border on the
switch track itself, on or off.

**A picks write in the first second of a fresh sign-in could be told
"check your connection" for a connection that was never the problem.**
A brand-new custom-token sign-in hands the browser a Firestore
connection that is still finishing its own handshake, and a write that
lands in that window can be rejected for reasons that have nothing to
do with the pick, the network, or the game being locked — which is
exactly what "your picks didn't save" right after signing in, that then
silently stopped happening a few minutes later with no code change,
actually was. `commitPicks()` now retries once, silently, about 1.2s
later before saying anything is wrong; a genuinely locked game is never
retried, since it will only ever fail the same way twice.

**A newly-registered player was invisible to everyone already in the
app.** `PLAYERS` was populated once, from a single `getMembers()` read
inside `loadSeason()` at boot — so anyone already using the app, on any
device, kept the roster exactly as it stood at their own page load.
Someone who signed up after that never appeared in Standings or the
Grid for anybody else until they manually reloaded; their own device
was fine, since their own `boot()` ran after they had joined, which is
what made this easy to miss testing alone. `watchMembers()` is a live
listener now, subscribed once at boot, guarded on its own so a missing
or failing roster listener degrades the roster refresh rather than
failing the whole boot.

**Every player was shown an invented season for the first seconds of
every launch, and it was reported twice as a caching bug.** index.html
builds a mock season at module scope — `slateFor()` shuffles matchups,
`SLATES` hard-codes weeks 1-4, and `W1OFF` places kickoffs at minute
offsets from `Date.now()`. That loop ran unconditionally, `DEMO` or not.
The first EIGHT week-1 offsets are negative, and `isLive()` is nothing
but `Date.now() >= g.kick`, so half of week 1 was "IN PROGRESS · LOCKED"
the instant the page parsed, under teams who are not playing each other,
until `loadSeason()` finished its round trips and swapped the real
schedule in underneath. Tapping to week 2 and back appeared to fix it and
fixed nothing — it forced a render against data that had since become
real. Two separate investigations went looking at service-worker caching,
Firestore consistency and listener teardown before anyone looked at what
fills `WEEKS` *before* the first read returns. Live, `WEEKS` now stays
empty until real games arrive; `render()` and `tick()` return early on an
empty schedule.

The test for it is worth reading before writing another like it. Two
earlier versions asserted on the rendered slate, and BOTH stayed green
with the bug fully reintroduced: nothing paints `#slate` until boot
finishes, so against a local stub the assertion always ran after the real
schedule had replaced the mockup. The working version asserts on
`#countdown`, which `tick()` writes every second from module scope with
no sign-in and no boot required, while `getAllWeeks` is held open by the
stub's `delay`. Mutation-tested in both directions.

**The Home Screen prompt described a browser the reader was not using.**
The first person outside the owner to be sent the link gave up on "tap
the three dots, tap Share, scroll, Add to Home Screen" — instructions
written for Safari, being read in Edge. Safari puts Share in the toolbar;
Chrome, Edge and Firefox on iOS each bury it behind their own menu first.
The steps are now chosen from the user agent, Android gets the real
`beforeinstallprompt` dialog instead of any instructions at all, laptops
are never shown the screen, and there is always a "Just use the browser"
way past it — everything except the kickoff alert works fine in a tab,
and a forced install wall in front of a stranger is how you lose them.
iPhone cannot install from a button: Apple ships no API for it, so
accurate per-browser instructions are the whole of what is possible.

**The scoring-mode switch is gone, and the test that guarded it had to be
re-pointed rather than deleted.** Straight-up / Confidence was owner-only,
changed how the whole pool scored for the rest of the season, and sat one
tab away from the timezone picker. There is one scoring system now.
`regress.ui.test.mjs` case 6 used to assert which `.mbtn` carried the `on`
class; the bug underneath — the client reading the wrong Firestore path,
silently falling through to 'straight', and wiping every ranked point
while `score_week.py` settled the season in confidence — is *more*
dangerous without a switch on screen, because nothing is left to reveal
the mismatch. It now asserts what the mode DOES (stake bars, the `#modeTag`
badge) in both directions, plus that the switch stays gone.

**A test that failed for nine hours out of every day.** `notify()` honours
quiet hours (22:00–07:00 local, matching `remind.py`) and every seeded
player in `season_sim.py` carries `tz="America/New_York"` — so running the
suite overnight correctly suppressed every message, `SENT` stayed empty,
and "a full pool of 50 produces notifications" failed on an app that was
working perfectly. Caught at 05:47 ET. `score_week.quiet_now` is now
pinned for that block instead of being depended on, and quiet hours are
asserted in both directions, which nothing had ever covered. A suite that
cries wolf overnight is how real failures start getting waved through.

**The whole live path was untested, because it was untestable.** The stub's
`watchWeek` and `watchRevealed` logged their own name and threw the callback
away, so nothing in this suite had ever seen a score arrive — the one thing
fifty people will be staring at on a Sunday afternoon. `app-serve.mjs` now
hands those callbacks out on `window` (`__pushWeek`, `__pushRevealed`,
`__weekGames`), and case 13 pushes a week to final and asserts the Grid
recolours and the Standings reorder without a reload.

**The Grid header printed a negative number.** "6 final · -5 live · 5 to
come". `isFinal` reads the status field, `isLive` is only
`Date.now() >= kickoff`, and a game can be BOTH final and not yet kicked
off — `import_schedule.py` deliberately preserves `status: final` while
refreshing kickoff on a re-import, so correcting a kickoff after the game
was played produces exactly that, as does a postponement rescheduled
forward. The counts were `started - finals` and `gs.length - started`,
which double-counted such a game. Three disjoint buckets now, and case 14
asserts they sum to the slate and never go negative.

**Two clubs in the same colour made the consensus bar unreadable.** Each
side of "How the pool picked" is painted in that club's own colour, and the
NFL has a lot of navy. Measured across all 496 possible matchups, 151 put
the two colours under 1.3:1 against each other and six pairs are the SAME
HEX — Dallas and the Rams are both `#003594`, Denver and Tennessee both
`#0C2340`, New England and Seattle both `#002244`, and Las Vegas, New
Orleans and Pittsburgh are all `#101820`. Those games rendered as one
unbroken block with two labels floating in it, the split invisible. A 3px
gap fixes every one of them and depends on no colour at all.

**The app abandoned a week the moment its last game kicked off.** The
opening week was "the first week still holding a game that has not
started", so at 8:15pm on Monday — the second MNF kicked — every player
was moved to next week's empty slate, while this week's standings were
still settling. Standings then fell back to Season too, because a week
with no results has nothing to show. The one night the whole pool is
watching. A week now stays current while any game is unresolved AND
kicked off less than six hours ago. That clamp is the entire safety of
it: "not final" alone would strand all 50 players on week 3 forever the
first time a game was postponed and never resolved, with no way out from
inside the app. Case 17 covers it, and the mutation check is real — put
the old rule back and "during Monday Night Football it stays on that
week" reports `week 2`.

**A master switch that moved on its own, twice.** "All alerts" was a switch
whose position was DERIVED from the five categories below it — on only when
every one was on. Truthful, and it still felt broken: flipping your last
individual category made a control the player had not touched slide over by
itself. A switch is a promise that it holds a setting of its own, and this one
never did. It also INVERTED (`next = !every(on)`), so one tap meant opposite
things depending on state you could not read off the control.

Replacing it with an All on / All off button pair fixed the movement and
introduced a second problem: a row of controls competing with the five that
matter, in a box and type size that matched nothing else on the screen. Both
are gone now. Every category defaults ON — merged over the stored object
rather than replacing it, so a preferences file written before a category
existed can only fall back to on, never silently off — and case 18 asserts the
panel contains the five switches and NO other pressable control. That last
assertion is the point: the urge to add a convenience control above the list
is what produced two rounds of this.

**A contrast bug created by fixing a colour bug.** `.num small` — the payout
under each rank, and the team code on a rank already spent — carried
`opacity:.75`. Harmless on the cream sheet. On the dark sheet it stacked with
a numeral colour ALREADY softened for the dark ground, and two softenings
multiply: 4.35:1 for the payout, **2.03:1** for the team code, which is the
only record anywhere of which ranks are spent. Case 19 measures the real
computed styles. Note the helper reads BOTH alphas — the colour's own and the
element's `opacity`. The first version took only the RGB triple, scored a
2.03:1 label as 6.7:1, and passed while looking straight at the defect.

**Two cream sheets over a dark app.** Both bottom sheets were `--paper` on a
`--shell` page. The unpicked-picks prompt is the worse of the two: it appears
at the moment somebody is being told they still owe picks. Case 19 asserts a
luminance CEILING rather than an exact hex, so a palette tweak stays free but
a return to a light panel does not.

**Two paragraphs that were "the same size" and still not a pair.** The
unpicked-picks sheet holds two message blocks. Their `font-size` matched
exactly, which is why every reading of the CSS said they agreed, and they
still did not look alike. Measured on the shipping build at 390px: the text
left edges were **14px and 26px** (the boxed one's own padding pushed its
text in while the message above began at the sheet's edge), the line-heights
were **1.45 and 1.5**, and the heading inside the box was a **third size** at
11px against 11.5px body. The two rules sat forty lines apart and each was
perfectly defensible alone.

They are one declaration now. Case 19 asserts the RENDERED geometry — text
left edge, width, line-height, type size, and that the button beneath shares
the same edges — because asserting the declarations is what missed it.

**"Same font" was true and the screen still showed two typefaces.** The sheet
title and the panel heading both resolved to Archivo, so every check of the
font family agreed. They differed on everything else: **16px/800/sentence
case/-0.32px tracking** against **11.5px/700/UPPERCASE/+0.69px**, starting
14px and 26px from the left. Uppercase at wide tracking in a lighter weight
does not read as the same face whatever the family says. All headings in the
sheet are one style now, and the title is indented by the panels' own padding
so every line of text in the dialog begins on one left edge. The assertion
compares family, size, weight, case, tracking AND left edge, and names each
mismatch — family alone is what let this through.

**Red is the action colour, and case 19 keeps it that way.** Red marks the
thing you tap — the button, the CONF badge, the rank borders — and a player
learns that in about two screens without being told. Painting a panel heading
in it was considered and rejected: it would put the button's own colour on
text that does nothing, on the single screen whose entire purpose is getting
that button pressed. The assertion compares each heading's colour against the
button's COMPUTED background rather than a hard-coded hex, so the palette can
move without the rule going stale. Worth knowing if a heading ever needs an
accent: the brand red `#C8342A` is only **3.19:1** on the panel background,
and these headings are 16px — under the 18.66px where WCAG's large-text
allowance begins — so they need 4.5:1. `#E4564A` is the nearest step that
passes, at 4.59:1.

## Known limit, deliberately not "fixed" in code

KV has no atomic increment, so the failed-attempt counters lose a race
against guesses fired in parallel. Those counters are now only the
friendly "3 tries left" layer; the real gate is the `PINS_LIMITER` /
`SEND_LIMITER` bindings in `worker/wrangler.toml`, which are atomic and
evaluated at the edge. `auth.stress.test.mjs` asserts the KV undercount on
purpose (the fail-open path, for an account without the Rate Limiting
API) and separately tests the bindings in section K.
