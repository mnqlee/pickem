# Installing v1.41.0

**The finished card, tightened, in cream. App only, one `git push`. No
rules deploy, no wrangler.**

## What changes

The card you picked from the mockups, built into the app.

| part of a finished card | v1.40.1 | v1.41.0 |
|---|---|---|
| FINAL and score line | 26px | **20px**, and darker |
| How the pool picked | 75px | **48px** |
| "27 picks" line | shown | **gone** (a lopsided game keeps one short line for the thin side) |
| You took / pts / LOSS row | 44px | **32px** |
| **Whole card** | **217px** | **172px** |

On a phone that is **three full finished cards on screen instead of
two.**

Three smaller fixes you asked for along the way:

1. **The red "Pool got it wrong" box** is shorter, sits 1px higher, and
   the space above and below the words is now exactly equal.
2. **The bar labels** ("CAR 74%") are centred top to bottom inside the
   bar. They used to sit low.
3. **A thin side of the bar** (like "MIA 7%", too narrow to hold its own
   label) still shows its figure under the bar, and the small colour
   square now sits **centred directly under the sliver it stands for**,
   with the team and percentage on its inner side. Only those lopsided
   games keep that short line, so their cards are 187px; every other
   finished card is 172px.

## What does NOT change

- **The Submitted / tap-to-rank bar before kickoff stays 44px.** It is
  the button people press to rank a pick, and a tap target needs that
  height. Only the result bar after the game got shorter, because it
  is not a button. A test now guards this.
- Cards before kickoff look exactly as they do today.
- Nothing touches picks, ranking, locking, scoring, standings, the
  Grid, reminders, sign-in, the worker or the database.

The pool block also appears on games in progress, so live cards get
the shorter pool block too. Same look, one row lighter.

---

# Install

```
cd C:\Users\ancon\Downloads\poolsheet
```

```
git add -A
```

```
git commit -m "v1.41.0: tightened finished card in cream, 217px to 172px"
```

```
git push
```

```
curl -s https://nflweeklypickem.com/sw.js | findstr VERSION
```

Must read `const VERSION = 'v1.41.0';`

**No `firebase-tools`. No wrangler.**

---

# What to look for afterwards

On your phone, two cold starts as usual, then Settings reads `v1.41.0`.

Open **week 3**. Every finished card should be noticeably shorter, with
no "27 picks" line, and you should see three whole cards on the screen
at once.

---

# Rolling back

```
cd C:\Users\ancon\Downloads\poolsheet
```

```
git revert --no-edit HEAD
```

```
git push
```

Back on v1.40.1. Nothing else differs.

---

# Verified before shipping

**1499 checks across twenty-one suites, 0 failed**, on 29 Sep 2026.
Regress 670, audit 45 of 45, all other suites unchanged and green.

**Every mutation that touches the card was run, sixteen batches, and
every one was caught.** Five were written for this release:

| the mistake | caught by |
|---|---|
| the red tag stretches its card | a tagged card measures the same as an untagged one |
| the capitals are not trimmed, so words sit off centre | the trim is checked on the tag and the bar labels |
| the result bar goes back to 44px | a finished card is 172px: head 20, pool 48, result 32 |
| the ranking button shrinks along with it | the stake bar is still a 44px tap target |
| the colour square is pinned to the edge, not centred | the square is centred under its sliver, to half a pixel |

**One check was found too weak and fixed.** The "figure sits on its own
side" check measured the words, and the words are wide enough to reach
the right half from a square in the wrong place. It now measures the
square.

**One old flaky check was fixed too.** The header-clock case read the
screen one tick early about one run in four, on v1.40.1 as well; it now
waits for the header to change.
