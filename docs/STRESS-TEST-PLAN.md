# Stress-test plan — before Thursday night

Two halves. **Part A runs in the sandbox and is already done** — the
numbers are below so you can see what was actually checked rather than
take "tested" on faith. **Part B is yours**, on your own phone against
the live site, and it is twenty minutes.

Part B matters because everything in Part A runs against a stub. The
stub is shaped exactly like Firestore holds the data, deliberately, but
it is not Firestore, it is not your phone, and it is not your pool.

---

# Part A · What has already been run

```
1197 checks, 0 failed.
```

| Suite | Checks | What it is for |
|---|---|---|
| `regress.ui.test.mjs` | 499 | every bug that has ever shipped, so it cannot return |
| `season_sim.py` | 128 | the REAL scorer, 50 players, 18 weeks, no Firebase |
| `stress.ui.test.mjs` | 113 | **new** — this release's stress suite, described below |
| `auth.stress.test.mjs` | 49 | the sign-in Worker, adversarially |
| `test_loop_window.py` | 49 | **new** — the Live-scores window's own shell logic |
| `signin.ui.test.mjs` | 48 | the sign-in screens in a real browser |
| `nudge.test.mjs` | 42 | reminder scheduling |
| `polish.ui.test.mjs` | 41 | layout, states, degradation, edges |
| `test_status_env.py` | 32 | **new** — the four variables that decide the week closer |
| `test_result_copy.py` | 30 | what a player actually reads on Tuesday morning |
| `picks-audit.mjs` | 30 | every design choice you made, still present in the build |
| `auth.core.test.mjs` | 27 | the sign-in Worker, happy path and edges |
| `sw.push.test.mjs` | 22 | service worker push, and what it may cache |
| `season.ui.test.mjs` | 21 | a full 18-week season, 25–40 players |
| `scale.ui.test.mjs` | 21 | 50 players, all 18 weeks, at 390px and 320px |
| `live-auth.test.mjs` | 20 | the live Worker's auth |
| `reminder-copy.test.mjs` | 20 | the words in every reminder |
| `invite.ui.test.mjs` | 5 | bare-domain invite links |

## The new stress suite, in detail

`stress.ui.test.mjs` — 113 checks in seven sections. What fails here is
never slowness alone: a timing budget that passes on one machine and
fails on a loaded one teaches nothing. What fails is a thrown error, a
screen that renders nothing, a number that contradicts another number on
the same screen, a listener or node count that grows without bound, or
an interaction that stops responding.

**1 · A full pool on a full slate.** 50 players, 16 games, every tab
rendered and counted. The Grid comes out 50 rows × 19 columns = 969
cells, 482px tall — that last number is the one that matters, because
the collapse bug pinned it at a 200px floor showing about three rows
whatever the pool size. Then the Grid is scrolled to its far right edge
and the pinned Player cells are checked for opacity, including the
leader's. Then 320px, 768px and 1024px, with a hard requirement that
nothing overflows the page horizontally.

**2 · Rapid week switching.** 24 switches in ~4 seconds — faster than
anyone can tap. Every switch reloads a week's picks and rebuilds three
tables. Afterwards: the slate still renders, exactly one week is
selected, the open tab was not reset, and **no movement arrows appear**,
because nobody's points changed while the buttons were being mashed.

**3 · ESPN gone, three ways.** `down` (503), `throw` (no network at
all), `junk` (a 200 whose body is not JSON). Since v1.31.0 your phone
reads the ESPN scoreboard itself, so these are the app's own failure
paths. In each: the slate renders, locked games still say so, nothing
prints `undefined` or `NaN`, the header still says something, ESPN was
actually asked, and all five tabs still work. Then ESPN recovers and the
poll is confirmed to still be trying.

**4 · A score storm.** 40 forced refreshes in ~3 seconds with the Grid
open — Sunday 4:25pm. Then the check that matters: the Grid's weekly
total and the This-week Standings total are read for all 30 players and
required to be **the same number for every one of them**. That is the
disagreement that once had one player on 120 and 119 on two screens.

**5 · A long session.** Twelve full rounds of tab switching, view
switching, week switching and forced polling — the app that was opened
at noon and is still open at midnight. DOM node count and JS heap are
sampled before and after and required not to grow without bound (nodes
went 3957 → 3995; the heap did not move). Then it is tapped again, to
prove the numbers were not taken from a frozen page.

**6 · Offline boot.** The schedule read is made to fail, which is what
the app sees in airplane mode or a stadium. The page must not be blank
and must say something a person can read.

**7 · The Thursday-night path.** Walked at 320px and 390px, at two
moments:

- **Thursday** — one game being played, the rest of the week to come.
  ESPN's clock reads `3rd · 5:42` on the left, `IN PROGRESS` on the
  right, exactly one pulsing dot on the row, nothing decided yet, and
  the header still counting down to Sunday.
- **Monday night** — the same live row with fifteen decided cards above
  it. All fifteen strips **filled**, and the header reading exactly
  `1 game live`.

At both widths: no horizontal overflow, and no text clipped in the clock
or the card's meta row.

## And every test was checked against the bug it is for

```
27 batches, 38 mutations, 0 problems.
```

The suite is run 27 more times with a specific bug put back each time —
mutation testing — and each named assertion has to go red. This is the
part that catches a green tick that means nothing, and this project has
shipped two of those. Among the 38 mutations: the week honours handed to
rows 0 and 1 again, the runner-up made the next row instead of the next
score, a week with no scores crowned anyway, `liveClock` accepting
ESPN's "Final", the kickoff-time fallback styled as a live clock, the
six-hour ceiling on "live" removed, the Tie header back to two states,
the archive put back in its own tab, its member names printed
unescaped, and — deliberately — the *wrong* variant of the card strip
rebuilt, because a test that only asked "is there green here" would have
passed on it.

**Four of my own new tests failed this step first, and that is the
point.** Each was asserting something weaker than it looked:

- the runner-up banner was **counted**, and the count stayed right while
  every banner floated near the top of the board instead of sitting on
  its row (`.leadtag` is `position:absolute` and only `.row.lead`
  declares `position:relative`) — now checked by measured position;
- a finished week in which nobody scored had no fixture at all, so the
  guard that stops the app crowning somebody in one was untested — now
  case 59, which took three plan keys at once to reach;
- the archive's content checks all passed on a section nobody could
  see, because `textContent` and `getComputedStyle` read straight
  through `display:none` — now checked by measured height;
- and one fixture key, `noRevealed`, was honoured by the first Firestore
  read and ignored by the listener that followed it, so a pool meant to
  have no revealed picks got a full set pushed in a moment later. That
  is a bug in the stub, and it was hiding a real test.

---

# Part B · What you do, on your phone

Twenty minutes. Do it after the deploy and **before** Thursday's
kickoff. Tick each box.

## B1 · The version is actually new (2 min)

- [ ] In a browser **address bar**, open
      `https://nflweeklypickem.com/sw.js`. Line 8 reads
      `const VERSION = 'v1.34.0';`. That is what Cloudflare is serving,
      with no phone cache in the way.
- [ ] Open the app. Pull down to refresh twice, then **close it from the
      app switcher**, wait ten seconds, and reopen. A service worker
      serves the cached app until its next cold start; a refresh alone
      is often not enough.
- [ ] The tab row has **five** tabs: Picks, Grid, Standings, Help,
      Settings. No Archive tab.
- [ ] **Settings** → the **Preseason 2026** archive is the first section,
      above Scoring, with five final standings rows and a week-by-week
      list.

> The app does not print its version on screen. Those last two boxes
> are the fingerprint: five tabs and the archive in Settings means the
> phone is on v1.34.0.

## B2 · Nothing you already did has moved (5 min)

This is the part that catches me breaking something you were not
thinking about.

- [ ] **Picks** — your existing picks for this week are still there,
      with the same ranks on the same games.
- [ ] Tap a game that has **not** kicked off. The rank tray opens, your
      current rank is highlighted, changing it saves and says so.
- [ ] Every card shows the network, the line (or `line TBD`), and a
      countdown reading `Locks in …`.
- [ ] The pool bar under each locked card shows a split and a sub-line
      with the pick count.
- [ ] **Grid** — every member has a row. Scroll it sideways to the last
      game: names stay pinned and readable, not see-through.
- [ ] **Standings** — both tabs. **Season** lists everyone with their
      seals. **This week** lists everyone on this week's points.
- [ ] **Help** and **Settings** both render. Your timezone is still what
      you set it to. All five alert switches are where you left them.

## B3 · One point is one point (1 min)

- [ ] Open the rank tray on any unlocked game and look at rank 16.
- [ ] It says **1 pt**. Not `1 pts`.

## B4 · A live game, Thursday night (5 min, at kickoff)

Do this one **while the Thursday game is actually being played** — it is
the only way to see it, and it is the main thing this release changed.

- [ ] Top-left of the Thursday card: the quarter and the game clock,
      green, with a **pulsing dot** in front of it — for example
      `3rd · 5:42`. Or ESPN's own word, like `Halftime`.
- [ ] Top-right of the same card: **IN PROGRESS**.
- [ ] **Exactly one dot on that row.** Not two.
- [ ] The header at the top of the screen still counts down to the next
      game, in gold, because the rest of the week has not kicked off.
- [ ] Tap into **Grid**. The Thursday column header says **Live**.
- [ ] Scores on the card update **within about a minute** without you
      doing anything.

> **If the top-left shows a plain kickoff time instead of a clock**,
> that is correct behaviour, not a bug — it means ESPN has not sent a
> clock string yet. The dot moves to IN PROGRESS so the row still
> pulses. Check that it does.

> **If the top-left ever shows the word "Final" with a pulsing dot**,
> that is the bug this release fixed and it has come back. Tell me.

## B5 · The game going final (5 min, after the whistle)

- [ ] Within about five minutes of the real final whistle, the card
      flips: top-right reads **Final**, the score appears, and the
      losing side greys out while **keeping its team badge colour**.
- [ ] The bottom strip of the card **fills**: green if you called it
      right, red if you did not, and **every letter on it is white**.
- [ ] It is a **fill**, not a thin ring around a dark strip. If it is a
      ring, the wrong variant shipped — tell me.
- [ ] A game that ended level leaves the strip dark, and the line reads
      `no score (tie)`.

## B6 · The week closing (Monday night, 2 min)

The point of the week closer. Do this after Monday Night Football goes
final.

- [ ] Within about **five minutes** of the last game going final:
      **Standings → This week** shows the 1ST seal and the gold
      `Week n winner` banner on the winner, and the 2ND seal with the
      silver `Runner up` banner below.
- [ ] The header at the top reads `Week n · Final`, grey, with a tick
      and **no pulsing dot**.
- [ ] You get a results notification on your phone.
- [ ] **If two people tied for the week**, they both wear the 1ST seal
      and both get the gold banner. Neither is given the runner-up seal.
      This is the change — check it if it happens.

> It used to take about four hours. If you are still waiting after
> twenty minutes, it fell back to the Tuesday cron, which is the
> designed failure. Check
> <https://github.com/mnqlee/pickem/actions> → **Live scores (window)**
> → the current run → expand the pull step and look for a `::warning::`
> line about closing the week. Send me that line. Nothing is broken; it
> is just slow again.

## B7 · The narrow phone (2 min)

If you have an older or smaller phone, or you can make the window
narrow, do this. Every clipping bug this app has had has been here.

- [ ] Nothing scrolls sideways except the Grid and the tab row.
- [ ] The header clock is not cut off with an ellipsis.
- [ ] The card's top row — clock, network, line, IN PROGRESS — fits
      without anything being clipped.
- [ ] All 16 ranks are reachable in the tray.

---

## What to send me if something is wrong

A screenshot, the tab you were on, and what you expected instead. If it
is about a game: which game, and roughly what time. Do not send me
anything from the Firebase console and do not send keys or tokens — I
do not need them to read a screenshot.

If the app is broken badly enough to matter to the pool, roll back
first and tell me after: `docs/ROLLBACK-v1.34.0.md`, one command.
