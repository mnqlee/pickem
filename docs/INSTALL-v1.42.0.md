# Installing v1.42.0

**The week 5 polish, everything you picked from the Card Polish page.
App only, one `git push`. No rules deploy, no wrangler.**

## What changes

On every game card:

1. Scores in the new font (Oswald), bigger, centred under the team name,
   and level with each other on both sides.
2. Each team's record under its badge, like (2-2). Both records sit on
   one line.
3. The football sits right beside the score and never pushes it off
   centre.
4. Your pick is a small box in your team's colour instead of "You took".
   It has a tick while the pick stands and a cross if it loses.
5. Your rank sits in a circle in the middle of the card, where the @
   was, once the pick has a rank. It is red before kickoff and while the
   game is on, and grey once it is final. Before kickoff you can tap it
   to change the rank.
6. The first time you rank a pick, the circle slides up out of the bar
   into the middle.
7. The live strip is one line: "Locked" on the left, your pick on the
   right.

Across the app:

8. No slashed zeros anywhere.
9. Finished weeks in the week strip get the gold fade with your points.
   The week numbers are bigger, and every number sits on one line.
10. The header and the bottom bar are fully solid. Cards no longer show
    through behind the week numbers.
11. Once a game this week is final and your picks are all in, the bottom
    bar shows three buttons:
    - **Week points:** opens your week, game by game.
    - **Your place:** shows a green up or red down arrow, and opens
      Standings on This week.
    - **Games final:** opens what is still to play.
12. Standings says "tied with" and "10th of 33", with the points in the
    new font.
13. Help has one new sentence: "The coloured box beside a team is your
    pick."
14. **Season seals now count every week won.** Each 1st and 2nd place
    seal on the Season table is counted from the weeks themselves, the
    same way the This week table crowns its winner. It used to read a
    counter only the server's week-closing job writes, so a late close
    left Craig with one 1ST after winning weeks 3 and 4.
15. **One seal per week won.** Two 1st place weeks and a 2nd now show as
    1ST, 1ST, 2ND side by side, instead of one seal with a number. Up to
    three sit apart; four to six overlap slightly; past six it shows five
    and "+N".

## What does NOT change

- Nothing about scoring, picks, ranks, locking, the Grid, reminders,
  sign-in, the worker or the database.
- The new numbers are worked out on the phone from results it already
  has, so there are **no extra database reads**.
- The bar you press to rank a pick is still 44px tall.
- The header is the same height, so the launch-jump fix from v1.40.1 is
  untouched.
- The live clock still reads "12:53 - 1ST".

---

# Install

```
cd C:\Users\ancon\Downloads\poolsheet
```

```
git add -A
```

```
git commit -m "v1.42.0: week 5 polish, scores, records, team box, rank circle, week so far"
```

```
git push
```

```
curl -s https://nflweeklypickem.com/sw.js | findstr VERSION
```

It must read `const VERSION = 'v1.42.0';`

**No `firebase-tools`. No wrangler.**

---

# What to look for afterwards

1. On your phone, do two cold starts as usual. Settings should read
   `v1.42.0`.
2. Week strip: weeks 1 to 4 wear the gold fade with your points.
3. Week 5 cards before kickoff:
   - The @ is in the middle until a pick has a rank.
   - Ranked picks show the red circle there instead.
   - Tap a circle and the rank picker opens.
4. Pick and rank a new game: the circle slides into the middle.
5. Thursday night, once the game is final:
   - If your picks are all in, the bottom bar becomes the three buttons.
   - Tap each one: your week, Standings, and what is left.

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

That puts you back on v1.41.0. Nothing else differs.

---

# Verified before shipping

**1872 checks across twenty-two suites, 0 failed**, on 6 Oct 2026.

## The new accounting suite (week5.ui.test.mjs, 370 checks)

It does not trust the app's own maths. It reads the raw data straight
from the test server: the schedule, your picks, everybody's picks, the
roster and the saved standings. It works out every number from the rules
alone, then checks what the screen prints. That covers:

- Your week points, your place, "of N", the up or down arrow, and the
  games count, on the bottom bar.
- Every line in the points sheet: tick or cross, the points paid, and
  that the lines add up to the total.
- Every game in the "still to play" sheet, with what your pick pays if
  it holds.
- Every row of Standings, This week, after tapping your place, including
  "tied with".
- Your points on each finished week in the strip, and that the season
  total equals those weeks plus this week.
- Every team record on every card, including looking back at an old
  week, where the records must be as they stood then.
- Every player's 1st and 2nd seals on the Season table, against the
  weeks they actually won or came second in, including a week everyone
  tied (every tied player gets the seal).
- The order of the seals in each row (every 1st, then every 2nd, then
  any perfect-week trophy), the spacing, the "+N" past six, and that no
  row's seals run into the points.

It runs at fifteen points through a week (Thursday final, Sunday
afternoon, Monday morning) across five pools of 9 to 31 players. It also
checks the fixtures really produced a move up, a move down, a tie, wins,
losses and an unranked pick, so no comparison passed by having nothing
to compare.

## Mutation testing

**31 mutation batches were run against this release, and every one was
caught.** Each one put a real bug back into the app, for example:

- the arrow pointing the wrong way
- the move measured from the wrong game
- points paid on a losing pick
- records counting games from later weeks
- the bar hiding "Finish my picks" while picks were missing
- the circle staying red after the final
- scores or records drifting off level
- the down arrow pinned to the top
- the slashed zero coming back
- "level with" coming back
- the Season seals read from the server's counter again
- a shared week giving the seal to only one of the tied players
- the seals squeezed too close, the "+N" cap removed, or the trophy
  put first

## Two weaknesses found in my own tests and fixed

1. The football checks only ever saw the ball on two of the four
   possible card positions. They now cover all four.
2. The records check never looked at a past week, so a bug counting
   later games went unnoticed. It now looks back at week 3 from week 9.

## One fixture bug found and fixed

The test server sent one set of pick ranks on the first read and a
different set a moment later. The new oracle is what caught it.
