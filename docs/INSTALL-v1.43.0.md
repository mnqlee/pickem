# Installing v1.43.0

**The week so far from the first final, chosen from the Finish Picks Flow
mockups. App only, one `git push`. No rules deploy, no wrangler.**

## What changes

1. **The three boxes show as soon as any game this week is final**, even
   if picks are not finished. Points and place count from the first final.
2. **Until everything is in, the third box is red: "Picks 5/16 finish".**
   Tapping it goes straight to the first game still to pick, on the real
   card on the Picks tab, outlined in gold. If only the Monday night total
   is missing, it reads "tiebreak" and takes you to that box.
3. **Once every game is picked and ranked and the Monday night total is
   in, it flips to "Games 1/16 final"** in the regular colour.
4. **The arrow shows from the first final.** After game one: green up if
   it scored for you, red down if it did not and it scored for someone
   else, no number. From the second final on, places moved, as before.
5. **"Next unpicked" button.** After each save, while picks are
   unfinished, a button names the next game to pick and takes you there.
   It waits until "Saved" has cleared.
6. **The points sheet is grouped.** Your picks on top in kickoff order,
   finished games with what they paid, games still to play with what they
   pay if they hold. A game you missed shows as "No pick, 0 pts".
7. **The red card.** Games not selected fold into one centred red card:
   "10 Games not selected", "First game locks Saturday 1:58 AM", "Tap to see
   the matchups and select your team". Tap it to see each matchup with its
   kickoff and a Pick button that goes to that game's card.
8. **The sheet updates while it is open.** A pick you save, or a game going
   final, changes it in place.

## What does NOT change

- Scoring, picks, ranks, locking, saving, the Grid, Standings, seals,
  reminders, sign-in, the worker and the database.
- Before the first final of the week the bar is exactly as it is today,
  "Finish my picks" and all.
- No extra database reads. Everything is worked out on the phone.

---

# Install

```
cd C:\Users\ancon\Downloads\poolsheet
```

```
git add -A
```

```
git commit -m "v1.43.0: week so far from the first final, red Picks box, jump to card, grouped points sheet"
```

```
git push
```

```
curl -s https://nflweeklypickem.com/sw.js | findstr VERSION
```

It must read `const VERSION = 'v1.43.0';`

---

# What to look for afterwards

1. Two cold starts. Settings reads `v1.43.0`.
2. Before Thursday's game ends: the bar is unchanged.
3. Thursday night after the final, if your picks are not finished:
   - The three boxes, with a red "Picks" box on the right.
   - Tap it: you land on the first game still to pick, outlined in gold.
   - Pick and rank it: "Next unpicked" appears with the next game.
   - Tap the points box: your picks on top, the red card below.

---

# Rolling back

```
git revert --no-edit HEAD
```

```
git push
```

That puts you back on v1.42.2.

---

# Verified before shipping

**1976 checks across twenty-two suites, 0 failed**, on 6 Oct 2026.

week5.ui.test.mjs now has 474 checks (was 372). New ones cover the red
box and its count, the jump landing on the first unpicked game in kickoff
order and in view, Next unpicked naming and reaching the next game and
never sitting on top of "Saved", the tiebreak case, the flip back to Games
final, the first-final arrow both ways against an independent oracle, the
grouped sheet's order and payouts, the red card's wording, first lock time,
one-line hint (also at 320px) and matchup list, the live refresh while open,
and no second Finish button in the sheet.

**Nine new mutations, every one caught:** waiting for every pick again,
jumping to the last game instead of the first, Next never appearing, the
sheet not refreshing, no arrow after game one, Next on top of Saved, the
matchups in reverse order, the box never saying tiebreak, and the "if it
holds" points one rank off. One old mutation that guarded the old rule was
retired, since this release reverses that rule on purpose.

**One weakness in my own tests, found and fixed:** when a bug removed a
button, the suite crashed on the next tap and never printed the failures it
had already found, so the mutation runner read "0 red" for two real
catches. The suite now always reports what failed, then the crash.
