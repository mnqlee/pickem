# Installing v1.39.2

**App only. One `git push`. Do not run wrangler.**

Two things, both from what you saw during the Sunday slate.

## 1. The Grid no longer says everybody missed the game

You watched the Rams game lock while sitting on the Grid: the column went
LIVE immediately, then every player showed a red dash for over two
minutes before the picks filled in.

**The data was never wrong. The screen was.** Two clocks:

- whether a cell shows a pick was decided by your phone's clock, which
  flips exactly at kickoff
- the picks arrive from a database query deliberately bounded a margin
  behind now, because the rules check the reveal time against Google's
  clock, not your phone's, and refuse the whole query rather than part of
  it if your phone asks for too much

Between the two, every cell was told to show a pick that could not have
arrived, and the symbol for "no pick" is the one that means **did not
pick**.

**Two fixes went in.**

A cell now waits for the data instead of the clock, so during any gap it
shows sealed dots, which honestly mean "not revealed yet".

And the gap itself went from **two minutes to about ten seconds**. The
margin now starts at 5 seconds and only widens to the old two minutes if
your phone's clock turns out to be far enough off that the database
actually refuses the query. Nearly every phone sets its time
automatically, so nearly every phone gets the fast one. A phone with a
wrong clock still works, it just asks twice.

## 2. Live updates every 30 seconds instead of 60

The score, the game clock and the possession football all come out of the
same request, so this halves the delay on all three at once.

**It costs nothing.** That request never touches your database or
Cloudflare, so there is no read, no write and no bill, and the loop stops
entirely while the app is off screen.

**Why not 15, which you asked about.** There is a hard 20 second floor
between requests that exists to absorb the duplicate triggers iOS throws
off when you switch apps. At 15 seconds the floor swallows every other
tick, so the real rate would be about 20 seconds arriving irregularly:
slower than it claims and less predictable than 30. And ESPN's own feed
takes its time to register a change of possession, so a good part of the
lag you saw was never ours to shorten.

---

# Install

**1.** Open a terminal and go to the folder:

```
cd C:\Users\ancon\Downloads\poolsheet
```

**2.** Delete one stale test file. It grades a worker feature you rolled
back yesterday, so it fails if anyone runs it:

```
git rm scripts/test/lines.test.mjs
```

**3.** Check what changed:

```
git status
```

You should see `index.html`, `firebase-init.js`, `sw.js`,
`DESIGN-DECISIONS.md`, files under `scripts/test/`, and new files under
`docs/`.

**4.** Stage everything:

```
git add -A
```

**5.** Commit:

```
git commit -m "v1.39.2: reveal the Grid at kickoff instead of two minutes later, 30 second live updates"
```

**6.** Push. This is the deploy.

```
git push
```

**7.** Confirm, in a browser **address bar**:

```
https://nflweeklypickem.com/sw.js
```

Line 8 must read:

```
const VERSION = 'v1.39.2';
```

Give it 60 to 90 seconds. If you still see `v1.39.1`, wait and reload, or
run `curl -s https://nflweeklypickem.com/sw.js | findstr VERSION` which
ignores the browser cache.

---

# Do NOT run wrangler

There is no worker half. The worker stays on the version you rolled back
to on Saturday.

---

# What to watch at the next kickoff

**Sit on the Grid as a game locks.** The column header goes LIVE, and the
cells should fill within a few seconds. If there is any gap at all, it
shows **sealed dots**, never red dashes. A red dash on a live column now
means one thing only: that player really did not pick.

**During play**, the football should move within about 30 seconds of a
change of possession, plus whatever ESPN's own feed adds.

---

# Verified before shipping

**1432 checks across twenty suites**, run on 2026-09-28.

| suite | |
|---|---|
| regress | 639, including two new reveal cases |
| reveal (new) | 19, the margin and its widening |
| polish, season, scale, stress | 41, 21, 21, 115 |
| sw.push, nudge, reminder-copy, live-auth | 33, 42, 50, 20 |
| auth.core, auth.stress | 27, 49 |
| signin, invite | 48, 5 |
| audit | 41 of 41 |
| python: season_sim, result_copy, status_env, loop_window | 128, 30, 32, 49 |

**62 mutations all still apply.** Eight were run against this change and
every one was caught:

| the mistake | caught by |
|---|---|
| unseal a live cell on the clock again | case 43b, reporting 7 red dashes |
| schedule on the widened fallback instead of the live margin | cases 43b and 43c |
| put the 60 second poll back | audit `live rate` |
| a literal 60000 back in the interval | audit `live rate` |
| never widen, so a fast clock gets an empty Grid forever | `reveal.test.mjs` |
| abandon the refused listener instead of closing it | `reveal.test.mjs` |
| export the margin as a number frozen at load | `reveal.test.mjs` |
| start at the safe margin, so nothing is ever fast | `reveal.test.mjs` |

**Three things the tests got wrong first, and all three are worth
knowing:**

The "it fills in" assertion counted **your own row**, which is visible at
every moment by design, so it passed against a build that revealed nobody
else at all.

A `.click(...).catch(() => {})` on the week strip meant a swallowed click
silently graded the wrong week, failing about one run in five in a way
that looked like a real defect. It now asserts the switch happened.

And the test harness had to learn the new margin, or every reveal-timing
case would have been grading a build nobody runs.

**One suite is not green and it is not this change.**
`reminder-send.test.mjs` reports 21 of 22 between midnight and 7am ET,
because the reminder sender correctly suppresses non-urgent alerts during
quiet hours and the fixture does not know what time it is. It passes at
any other hour. Nothing in this release touches the reminder path.

---

# Rolling back

`docs/ROLLBACK-v1.39.2.md`. The short version is `git revert --no-edit
HEAD` and `git push`. No worker command, because there is no worker half.
