# Installing v1.39.1

**This is one CSS property, and it fixes something I shipped broken in
v1.39.0 this afternoon.**

## What was wrong

On the **away** team, the left side of every card, the score sat **27.6
pixels too far right** whenever that team did not have the football. It
happened on live cards and on every finished card. The home side was
never affected.

The number itself was correct. It was sitting out of line with the team
name above it.

**Why.** I reversed the away score row so the football would land on the
gutter side, toward the `@`. A reversed row packs its contents to the
right. With a football present that is invisible, because the football,
the gap and the digits already fill the row. With no football the row
has slack and the number slides into it.

**Why no test caught it.** Every check written for the football looked at
a card that HAD a football. The defect lives on the cards that do not. A
new check now measures the away score against the team name above it on
a card with no possession, and mutation 58 puts the defect back and has
to be caught.

## What is in this zip

| file | what changed |
|---|---|
| `index.html` | one property: `justify-content:flex-end` on `.side.l .scr` |
| `sw.js` | version to `v1.39.1`, which is what makes phones fetch |
| `worker/live.js` | **reverted** to the v1.38.3 version, matching the worker you rolled back to |
| `DESIGN-DECISIONS.md`, `docs/**`, `scripts/test/**` | records and tests, none of it runs in production |

**`worker/live.js` is back to what is actually deployed.** You rolled the
worker back tonight, so the repo was carrying a version that no longer
matched. Now they agree, and if anyone ever runs `wrangler deploy` from
that folder they get the worker that works rather than the one ESPN
refuses.

**`scripts/test/lines.test.mjs` is gone** along with the code it graded.
It comes back with the GitHub Actions version of the refresh.

## Install

**1.** Download `pickem-v1.39.1.zip` to Downloads.

**2.** Right-click it, **Extract All…**

**3.** Destination box, type exactly:

```
C:\Users\ancon\Downloads\poolsheet
```

**4.** Click **Extract**, then **Replace the files in the destination**.

**5.** Open a terminal and go to the folder:

```
cd C:\Users\ancon\Downloads\poolsheet
```

**6.** Stage everything:

```
git add -A
```

**7.** Commit:

```
git commit -m "v1.39.1: keep the away score aligned when no football is shown; revert worker to the deployed version"
```

**8.** Push. This is the deploy.

```
git push
```

**9.** Confirm, in a browser **address bar**:

```
https://nflweeklypickem.com/sw.js
```

Line 8 must read:

```
const VERSION = 'v1.39.1';
```

## Do NOT run wrangler

There is no worker half to this release. The worker stays exactly where
you rolled it back to tonight. If you run `wrangler deploy` you will put
the refused version back.

## Confirm on your phone

Swipe the app away from the app switcher, wait ten seconds, reopen.
Settings at the bottom reads `v1.39.1`.

On a finished card, the away score sits directly under its own team
name, left edges lined up, the way it did before this afternoon.

During a live game, the football is on the gutter side of both teams,
three characters from the score on the team you did not take and four on
the team you did.

## Verified before shipping

1399 checks across nineteen suites, 0 failed.

| suite | |
|---|---|
| regress | 627, including the two new alignment checks |
| polish, season, scale, stress | 41, 21, 21, 115 |
| sw.push, reminder-copy, reminder-send, nudge | 33, 50, 22, 42 |
| live-auth, auth.core, auth.stress | 20, 27, 49 |
| signin, invite | 48, 5 |
| audit | 39 of 39 |

60 mutations all still apply. Mutation 58 is the new one: it removes the
fixed property and must turn the suite red. It was run, and it does,
reporting the exact 27.6px.

The fix was measured rather than argued. The away score sits at the same
pixel in v1.39.1 as it did in v1.38.3, on a live card and on a final
card, and the football's own position is unchanged: 48px from the score
on the picked side, 36px on the other, 16.5px and 12.1px from the
gutter.

## Rolling back

`docs/ROLLBACK-v1.39.1.md`. The short version is `git revert --no-edit
HEAD` and `git push`, which puts you back on v1.39.0, alignment defect
and all. There is no worker command, because there is no worker half.
