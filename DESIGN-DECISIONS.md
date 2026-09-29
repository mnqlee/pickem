# Approved design decisions

Every item was settled from a rendered mockup, not a description. The
sheets themselves are in `docs/mockups/`, and `scripts/test/picks-audit.mjs`
checks the build still matches each chosen option — including that it is
not one of the OTHER options from the same sheet.

**Why all three of those exist.** These decisions took many rounds and
were living only in a chat transcript. When that transcript was
summarised, the summary kept "the green and red one on the bottom" and
lost the label — so the perimeter variant got built instead of the fill.
A sheet where two options both have green and red on the bottom of the
card cannot be recovered from a description. Hence: the images, the
option letters, the rejected alternatives named, and a test.

## The picks, in one place

| sheet | chosen | what it is |
|---|---|---|
| C — header placement | **C1** | unchanged: brand left, clock right |
| G — week label & tab order | **G4** | tabs first, label centred, weeks below |
| T then U — label size | **U3** | 9px / 800 / .2em, `padding:4px 0 5px` |
| I → L → M → P — live row | **P1 + P5** | dot + ESPN's clock left, IN PROGRESS right |
| S — meta centring | **S2** | network and line centred between the ends |
| R — losing side | **R2** | panel greys, badge keeps its team colour |
| J → K → N → Q — final strip | ~~**Q2**~~ | **superseded by W3** — see 3b |
| W → X → Y → Z — the final card | **W3 + Z1** | WIN/LOSS in a slanted pill; head centred `Final · CHI 59-37` |
| V → W — the narrow pool side | **W1** | its figure under its own sliver, chip in that team's colour |
| the tiebreaker column | **TB-A, numbers only** | no +/- deltas |
| the week honours | **S3** | gold winner banner, silver runner-up |
| the header clock | **H3** | grey tick, `Week n · Final` |
| the live count | **"3 games live"** | pulsing dot, words steady |
| the archive | **in Settings** | first section, above Scoring; no sixth tab |

---

## 1. Grid — tiebreaker becomes a column

Replaces `tbPanel()`'s 28-row block, which is what makes the Grid
unusable after the last game.

**Why the Grid collapses to three rows today.** `#v-grid` is
`calc(100dvh - topbar)` as a flex column. `.gridscroll` is `flex:1 1 auto`
with `min-height:200px`; `tbPanel` and `.legend` are fixed-height siblings
that take their space first. At 28 players the panel is ~950px, so the
table is pinned at its 200px floor — about three rows — whatever the pool
size. Measured, not guessed.

**The column.** A 17th column between the last game and `Pts`:

- Header: `TIE` / divider / the actual combined total / `TOTAL`, using the
  same `.aw` / `.sep` / `.hm` / `.st` structure as a game column.
- **Width must be 50px, exactly a game column.** `.sep`'s length is
  `column width − 18` (it carries `margin:2px 9px`), so any other width
  gives a divider that visibly disagrees with its neighbours.
- **The `.hm` override must be colour only.** `thead th` is
  `vertical-align:bottom`, so a taller bottom row lifts everything above
  it. Setting the total to 12px/800 against the games' 10px/700 pushed
  `TIE` and its divider ~2px high. Inherit the size; change only colour.
- Cell contents: the guess, and a word only where a word is true. No
  `+n` / `−n` deltas — the total is in the header.

| state | treatment | label |
|---|---|---|
| closest, dead on the total | green numeral | `EXACT` |
| closest without going over | green numeral | `CLOSEST` |
| under, beaten | white numeral | — |
| over (busted) | struck through, dimmed | — |

Green numeral on the neutral cell, **not** a filled green cell: a filled
cell reads as a 17th correct pick, and the tiebreaker is not a game.

**THERE IS NO `WINNER` LABEL, and removing it is a correction of my own
mistake.** I built the column saying `WINNER` when the top two rows were
level on points, on the theory that the tiebreaker then decided the
week. It does not. `score_week.py`'s `apply_tiebreak` sorts by
`(-r["total"], tiebreak_key)` where **`total` is the SEASON total**
(`sum(w["pts"] for w in weeks.values())`) — so the guess only ever
reorders the season standings. The weekly award is explicitly shared:
the comment above it reads *"Ties share a place"*, and
`winners = [r for r in results if r["wpts"] == best]`.

So the tiebreaker never wins anybody a week, and a cell claiming it did
was the app inventing a rule the scorer does not have. The column says
`CLOSEST`, or `EXACT` when dead on, and nothing else.

This was found by an adversarial review of the diff, not by using the
app — and the test written to defend the old behaviour **passed the
entire time the app was wrong**, because it graded the code against the
same false premise. The replacement asserts the fixture reaches the hard
branch (the whole top of the table level on points) and that no cell
says `WINNER` even there; mutation batch 2 puts the label back and
requires it to go red.

**Every player at the closest distance is green, not the first one found.**
`reduce()` returns whichever row it meets first, so two players on the same
guess got two different colours. Compute the closest distance, then mark
the whole set.

Below the table, one line replaces the panel: the matchup, the combined
total, and who was closest — naming **all** of them when several tie.

## 2. Header clock — three states

Today the fallback text scans the whole season
(`Object.values(WEEKS).flat().some(g => !isLive(g))`), so it cannot tell
"all kicked off" from "all finished" and says `all locked` for both.

`next` is already `the earliest game in this week that has not kicked
off`, so the gold countdown already holds between games on Sunday. **That
branch is correct and must not be touched.** Only the fallback splits:

| condition | text | treatment |
|---|---|---|
| a game in this week has not kicked off | `AWAY @ HOME · 2d 23h` | gold, dot pulsing — unchanged |
| all kicked off, some not final, kicked within 6h | `3 games live` / `1 game live` | `--live` green, dot pulsing |
| all kicked off, unfinished but all older than 6h | `Week 1 · pending` | grey, still |
| every game final | `Week 1 · Final` | grey `--chalk`, tick mark, **no dot, no pulse** |

- **"Live" needs a ceiling, and that fourth row is it.** `isLive(g)` is
  `Date.now() >= g.kick` and nothing else; `final` is a SERVER write. A
  postponed game still carrying its original kickoff, one failed scoring
  run, or an ESPN outage across a Monday night therefore leaves a game
  "live" by the only test the client has — and unclamped, the header sat
  on a pulsing green `1 game live` for the rest of the week. That is the
  app's one signal that something is happening *right now*, spent on a
  game that finished on Sunday. `LIVE_MAX` is the same six-hour window
  the ESPN poll already uses to stop polling a game, so the clock and
  the poll now agree about when a game stops being live.
- `Week 1 · pending` was chosen over saying `Final` (a lie — the week is
  not final) and over saying nothing (the header would have no state).
  It is short enough for 320px, unlike anything containing "awaiting".

- **The dot pulses; the words never do.** Fading the text makes the count
  unreadable for about a second per cycle.
- **`--live` (#63B257) is correct here and `--hit` is not** — the exact
  inverse of the cards. On the dark header: `--live` 6.77:1 (passes),
  `--hit` 2.85:1 (fails). On the light card paper `--live` is 2.43:1,
  which is why card text uses `--hit`. Same tokens, opposite grounds.
- Wording measured in **Archivo** at real viewport widths:
  `Week 1 · 3 games in progress` needs 211px against a 204px slot at
  390px — clips on every phone. `3 games live` is 82px and fits at 320px
  with room. `1 game live` likewise.
- Raising the narrow-phone `max-width:46vw` cap does **not** buy room:
  tested at 48.5vw and nothing changed, because at 320px the brand is
  already being squeezed and the cap is not the binding constraint.

## 3. This Week — winner and runner-up banners

Seals now appear on the This Week table, not only on Season. The comment
in `renderBoard` that restricts them was over-strict: on Season the seal
carries a *count*; on This Week it marks who won *that* week. Different
claim, not a duplicate one.

- The winner: 1ST seal, gold `.leadtag` reading `Week 1 winner`,
  sub-line `Won week 1 · 13 of 16 correct`.
- The runner-up: 2ND seal, silver `.leadtag` reading `Runner up`,
  sub-line `Runner-up · 13 of 16 correct`.
- The runner-up row also gets the quieter silver treatment: silver left
  border,
  `linear-gradient(90deg, rgba(185,193,203,.10), rgba(185,193,203,.02))`,
  silver rank and points.
- Silver is **#B9C1CB — the `SILVER` constant `badgeSVG` already uses**,
  so the banner and the seal cannot drift apart.
- `.row.lead` is the only row with `position:relative`. The runner-up
  needs its own, or its absolutely-positioned banner anchors to the
  whole board. `.row.hastag` supplies it.
- **`.row.me` sets its own flat background, and `.row.second`'s gradient
  replaced it outright** — so the one row a player scrolls to find,
  theirs, lost the "me" tint and kept only a red edge. `.row.me.second`
  now blends the two, exactly as `.row.me.lead` has always done for
  gold.
- **Nothing appears until every game in the week is final.** Otherwise
  whoever leads at 2pm Sunday is crowned and un-crowned all afternoon.

### 3a. THE HONOURS ARE SHARED, AND THEY GO BY POINTS VALUE

**This was wrong when it shipped and it is the most important thing on
this page.** The seals and the banners were handed to rows 0 and 1 —
`view==='week' && weekDone && i<2`. `score_week.py` shares them by
SCORE, and says so in a comment above the code: *"Ties share a place"*.

```python
best = max(r["wpts"] for r in results)
if best > 0:
    winners = [r for r in results if r["wpts"] == best]
    # Runner-up is the next distinct score down, not the next row.
    lower   = [r["wpts"] for r in results if r["wpts"] < best]
    second_pts = max(lower) if lower else 0
    seconds = [...] if second_pts > 0 else []
```

So three rules, all taken from that block:

1. **Every player on the best score is a winner.** On a two-way tie the
   old code crowned one of the two co-winners and gave the *other*
   co-winner the runner-up seal — a claim Tuesday's scoring run then
   contradicted on the same screen.
2. **The runner-up is the next DISTINCT score down**, which may be one
   player or eight, and is not "row two".
3. **Nothing is awarded when the best score is zero** (`if best > 0:`).
   A finished week in which nobody scored used to crown whoever sorted
   first.

Consequences in the app, each deliberate:

- Every co-winner gets the gold row, the gold banner and the 1ST seal.
  Two gold rows on equal points reads as the tie it is.
- The rank numbers stay positional (1, 2, 3…). Competition ranking
  (1, 1, 1, 4) would also be defensible, but it reaches the movement
  arrows, the `prev` history and the pinned "you" bar, and this release
  is not the place to change how twenty-eight people read their
  position. The equal points are visible on the rows.
- The pinned "you" bar follows the honour too, so a co-winner who
  happened to sort second still reads as having won it.
- A points tie now sorts by NAME as a second key. **That is not a
  tiebreak** — it is only determinism, because `Array#sort` left to
  itself reordered level players between renders and made the movement
  arrows flicker on a Sunday with nobody's points changing. The
  tiebreaker guess is NOT used here; see the `WINNER` note above.
- `0 behind Jim` was what the "you" bar printed for a points tie. Level
  is level: it now says `level with Jim`.

## 3c. The archive lives in Settings

It was a sixth tab, shown or hidden by one field in the pool document —
so the tab row grew a button whenever a pool carried an archive and lost
it again when the flag was flipped, on a row that already scrolls at
320px. The five tabs people use every Sunday moved sideways for a closed
pool nobody opens twice.

It is now the **first section of Settings**, above Scoring: when it is
there at all it answers "what happened last season", which is a
question, and everything below it is a control. Rendered at
`docs/mockups/archive-in-settings.png`.

What had to survive the move, and each of these is a test in case 57:

- The three visibility states, unchanged and still decided by
  `archiveVisible()`: `public` everyone, `owner` the owner only (marked
  hidden), `off` nobody — with the security rule denying the read
  outright, so the client never holds the document at all.
- The `esc()` on member names. `archive_pool.py` copies
  `members/{uid}.name` verbatim and any member can write their own name
  from a console call, so this renderer prints attacker-controlled text
  on the origin holding everybody's sign-in cookie.
- The tab row's width, now fixed at five.
- No `#v-archive` left in the view list that drives tab switching — a
  stale entry there throws on the first tab press, which boot cannot
  show.

Three things had to be restyled, because every `.arch` rule was written
for a full-width tab: `.opt` already pads 15px so `.arch` must not pad
again; the 23px page title becomes 15px to sit beside 13.5px section
headings; and `.arch-foot`'s `var(--shell-2)` is exactly `.opt`'s own
background, which made the closing note an invisible box.

## 3b. The card's bottom strip — Q2, and what replaced it

### Q2 IS SUPERSEDED. Read this first.

Q2 filled the whole bottom strip with `--hit` or `--stamp` and turned
every letter white. It was chosen from a rendered sheet, it was built,
it shipped in v1.34.0, and it worked. **It is gone as of v1.35.0**,
replaced by the **W3 pill** — the word WIN or LOSS in a slanted outline
at the rank circle's own size, in a result bar that also carries the
points and what you took.

Not a revert, and not a correction: a different and better home for the
same fact. The rest of this section stays exactly as written, because
the *reasoning* behind Q2 — what was measured, what was rejected, what
got built by mistake — is why the W series was judged the way it was.
Section 3f records the replacement.

**The history it must not lose.** The strip
was mocked as an N series and then a Q series. Lee chose **N4 — solid
fill** over N3 — inset perimeter — and then, from the follow-up mockups
of N4 with white letters, chose **Q2**. I built N3. Recorded here with
the alternatives named, so "the green and red one on the bottom" can
never again be read as the wrong one of two things that both have green
and red on the bottom.

The chosen spec, from `/tmp/mock/mock-q.html`:

| state | strip |
|---|---|
| your pick won | fills `var(--hit)` `#2F6E26`, every letter white |
| your pick lost, or no pick | fills `var(--stamp)` `#C8342A`, every letter white |
| game still being played | unchanged dark `#1F1D1B` strip |
| game ended level | unchanged dark strip — a tie decided nothing |

- Q2 rather than Q1 (a darker custom pair) or Q3 (brighter): Q2 uses
  `--hit` and `--stamp` exactly as the palette already defines them, so
  no new colour enters the app.
- Measured white on the fill: **6.2:1 on the green, 5.3:1 on the red.**
  Both clear 4.5:1, so the 9px text passes as small text rather than
  leaning on the large-text allowance. Q3 was rejected on exactly this:
  white on its green is 2.6:1.
- **NOT a perimeter.** `box-shadow: inset 0 0 0 1.5px` round the dark
  strip is N3, which was shown beside this and not chosen.
- `.lockband .miss` keeps its own red (`#E0645A`, 4.91:1 — the old
  `--stamp` was 3.18:1 and failed) because on a **live** game with no
  pick the strip carries no fill and the text is the only signal. That
  makes the `span` half of the white-text selector load-bearing: without
  it the losing line stays red on the red fill, which is the "red on
  red" Q2 exists to replace. Mutation testing is what proved this — a
  first version deleted the `.miss` rule, which made the span selector
  redundant and silently dropped the live-game signal.
  **`.miss` is the only span that makes it load-bearing.** An earlier
  version of that comment also named `.won-pts`, which carries no colour
  rule at all — and naming a second reason would have made deleting the
  `.miss` rule look safe.

## 3d. The live row's empty case — P4, and where the dot goes

`P4` is "ESPN has sent no clock string yet, so the slot falls back to
the kickoff time". It was written as `liveClock(g) || fT(g.show)` INSIDE
the live-clock span, so the fallback inherited `cd live lefted`: a
static kickoff time in live green with a pulsing dot in front of it,
saying "this is the running clock" about a time that is not running.

The fix is a branch, not a fallback string — and the second half is the
part that is easy to lose. The right-hand `IN PROGRESS` chip carries
`nodot` **precisely because** the clock owns the dot, so stripping the
left slot's styling without moving the dot back leaves a live game with
no pulse anywhere on the row. One decision (`lc`), made once, read
twice.

**And `liveClock` refuses ESPN's own "Final".** `pullEspn` only skips
`state === 'pre'`, so a game in `post` passes straight through and
`shortDetail` becomes `"Final"` or `"Final/OT"`. Our `isFinal(g)` is a
SERVER write that lands when the scoring run gets there — minutes later.
In between, the card printed the word **Final** styled as a running
clock, beside `IN PROGRESS` on the right. `liveClock` now returns null
for `final`, `postponed`, `canceled`, `suspended`, `delayed` and
`forfeit`, and the kickoff time is shown instead. Not a contradiction,
even if it is less informative for a few minutes.

## 3e. The Tie column header has three states, like a game column

It was a two-way switch — `TB.final ? 'final' : 'live'` — so before the
tiebreak game had kicked off it read **Open** in live green, the one
colour in that table meaning a game is being played right now. It also
left `.st.open` as dead CSS, which is how the mistake hid: the rule
existed and nothing ever emitted the class. Sealed is not live; it is
not yet.

| state | class | text |
|---|---|---|
| the tiebreak game has not kicked off | `open` | `Open` |
| kicked off, not final | `live` | `Live` |
| final | `final` | `Total` |

## 3f. The final card, rebuilt — W3 + Z1 + W1

Four rendered sheets, in order, each answering the question the last one
raised: `result-badge-W-series.png`, then the X, Y and Z follow-ups, then
`pool-bar-V-series` and `pool-subline-W-series`. Every one is in
`docs/mockups/`, drawn on the app's own stylesheet at 390px **and**
320px, with a measured overflow check rather than my opinion of whether
it fits.

### W3 — the result is a word in a slanted pill

The pill is **literally `.sb-num`'s geometry**: 26px, a 2px ring, 13px
at weight 900, rotated −7°. Only the colour changes and the content
becomes a word. That is deliberate — it is the same stamp as the rank
circle in the stake bar, so the card uses one shape for "this is your
number on this game" in both states.

What was rejected, and why, from the same sheet:

| | rejected because |
|---|---|
| **W1 / W2** — a single letter `W` / `L` | a letter is a code; the word needs no learning |
| **W4** — the same pill unslanted | reads as a button, and stops echoing the rank circle |
| **W5** — the rank in the circle, the word on the left | puts the settled fact in the smaller slot |
| **W6** — points moved left, pill alone on the right | the right side reads lopsided against the left stack |
| **X3** — one line carrying the score AND your result | **it clips.** 261px needed against 236px at 390px, 178px at 320px |
| **X4** — two lines, points beside the score | works, but unbalances the bar for no gain |

### The five pick states, and the one that had no line at all

`pay(r,n)` is `!r ? 1 : …`, so **an unstaked pick that comes in has
always scored one point** — the same as the lowest rank. The scoring was
never wrong. The card had no line for it, because `Rank 9` cannot be
printed when there is no rank, so it read "You took CHI · +1 pt" with
nothing explaining why 1 and not 8.

| state | left | points | pill |
|---|---|---|---|
| staked, won | `You took CHI · Rank 9` | `+8 pts` | WIN |
| staked, lost | `You took LAC · Rank 3` | `0 pts` | LOSS |
| **unstaked, won** | `You took CHI · Unstaked` | `+1 pt` | WIN |
| **unstaked, lost** | `You took LAC · Unstaked` | `0 pts` | LOSS |
| no pick | `No pick` | `0 pts` | – |
| ended level | `You took DET · Rank 2` | `no score` | TIE |

`Unstaked` over `No rank` and `Unranked`: the app already calls the act
staking ("tap to stake points"), and "unranked" reads as a judgement of
the game rather than of the pick.

**`Rank`, capitalised**, everywhere on the card. And `pay(w,N)` replaces
`w?pay(w,N):1` — the same number by a shorter road, since `pay()`
already returns 1 for a falsy rank.

### THE PAPER-SIDE RED — #BE2F26, and it is measured

`--stamp` #C8342A is **4.32:1** on the card's `#EDE8DE` paper: under the
4.5:1 floor, and this is now a whole line of real information rather
than one word. **#BE2F26 is 4.75:1** and is indistinguishable from
`--stamp` at a glance.

This is the exact mirror of `.lockband .miss`, which exists because
`--stamp` is 3.18:1 on the **dark** strip. Same problem, opposite
ground, so it gets its own token: `--sink`, scoped to `.resbar`.
`--hit` needs no adjustment — 5.09:1 on this paper.

### Z1 — the head says what happened

Kickoff time, the network badge and the spread are all answers to
pre-game questions: when do I watch this, which channel, who is
favoured. The moment the whistle goes, none of the three has a question
left, and all three were still sitting across the top of every finished
card. `Final · CHI 59-37` takes the row instead, **centred**.

- **Z2** (a tick before it) and **Z3** (a dot) were both rejected: the
  tick belongs to the header clock's own "week finished" state, and a
  dot on a card means *being played right now* everywhere else in the
  app. A grey non-pulsing dot would make that signal mean two things.
- **Z4** — the winner's code in its own team colour — reads well for
  Chicago and needs the badges' luminance test to be safe for all 32.
  More machinery than the row is worth.
- **CENTRED WITH `justify-content`, NOT BY ACCIDENT.** `.meta` gives its
  first child `margin-right:auto` and `.cd` `margin-left:auto`, so a row
  holding one item centres itself as a side effect of those cancelling
  out. It rendered right for the wrong reason. `.fmeta` says it, and
  regress case 53b measures the head's centre against the card's.
- **And it made the bar one line.** Once the head carries FINAL and the
  score, the bar has only your own result to say — which is why X3's
  clipping problem disappeared and the bar went back to 44px, so a card
  does not change height when it goes final.
- **Nothing here touches a live or unplayed card.** While a game is
  being played the meta row still carries ESPN's clock, the network and
  the line, which is P1/P5. The lock band is live-only now, and cannot
  be coloured at all.

### W1 — the narrow pool side's figure sits under its own sliver

A segment under 22% cannot hold its own label. It used to drop it, and
the sub-line carried the number as plain text **at the left, whichever
end the sliver was on** — so on an 8%-on-the-right split the figure sat
as far from the segment it describes as the card allows.

Now the sub-line is a two-ended row: the figure pins to the sliver's
side with a chip in that team's colour, and the pick count takes the
other end. The DOM order decides which end each takes, so there is no
left/right CSS to keep in step.

- **Only one side can ever be narrow** — the two percentages sum to 100,
  so under 22% on one means over 78% on the other. A unanimous pool has
  one segment and no narrow side, and the line is then just the count,
  where it has always been.
- **V1/V2/V3** put the figure *inside* the big segment, against the
  split. Rejected: Lee wanted it below the bar, on the card's own paper.
- **THE CHIP CARRIES THE COLOUR AND THE WORDS DO NOT**, and that is
  measured. As **text** on this paper, seven primaries fail 4.5:1 —
  Cincinnati #FB4F14 at **2.76:1**, Miami 3.24, Carolina 3.30, the
  Chargers 3.51, Kansas City 3.86, Detroit 4.03, Tampa Bay 4.44. As a
  **chip**, which is a graphic wanting 3:1, only Cincinnati fails — and
  the hairline ring covers that, the same device `.mark` already carries
  for the same reason. W2, the coloured-text version, was rendered
  specifically so it could be ruled out on sight.

### A contrast problem this turned up that is not new

`.cseg` paints its label `#fff` on the team's own primary, and **four
primaries fail 4.5:1 for white text**: Cincinnati 3.37:1, Miami 3.95,
Carolina 4.03, the Chargers 4.28. That is true in the shipped app, on
their own labels, and predates all of this. `onColor()` — the luminance
test the badges already use — fixes it in one line. **Not done yet**;
see section 5.

## 4. Two bugs found while mocking

- **The leader's sticky Player cell is transparent.**
  `tbody tr.lead td{background:rgba(232,184,75,.09)}` also matches
  `td.pl` and beats its opaque `var(--shell)`, so scrolling the Grid
  sideways drags team codes through the leader's name. `#211D16` is
  `--shell` under that gold at full opacity. `td.tot` needs the same.
- **`tbPanel` sorts by the wrong rule.** It orders by
  `Math.abs(guess − actual)`, so a player who went *over* by 1 is listed
  above the one who won by being 2 under — contradicting the
  "closest without going over" line printed directly above it. Order
  unders by closeness first, then overs.

## 4b. Where the Grid and Standings are allowed to disagree

Written down because it looks like a bug and is not, and because the
temptation is to "fix" it by pointing both at one function.

The Grid's `Pts` column uses `weekPoints()`. Standings uses `weekSum()`.

- The Grid's total sits at the end of a row of per-game cells and has to
  be the sum of **those cells**, or the row visibly does not add up.
  Every cell is computed client-side from the revealed picks and the
  game documents, so the total has to be too.
- Standings answers a different question — where does this player stand
  — so `weekSum()` prefers the SERVER's banked record whenever that
  record is current, because the record was scored under the mode that
  week actually used while `weekPoints()` applies the pool's **current**
  mode.

They can therefore differ in exactly two situations: a settled week
whose scoring mode was changed afterwards, and a load in which the
revealed picks did not arrive (the Grid shows empty cells and a zero,
which is at least self-consistent; Standings shows the banked figure
rather than a screen of zeroes). Neither is wrong.

## 4c. The results notification

Three things in `result_copy()` were wrong, all found by reading it
rather than by receiving one:

- **`names_phrase` returned a clause, not a noun phrase.** `"3 players
  tied"` with a verb after it is `"3 players tied won it with 120"` and
  `"3 players tied second on 113"` — broken English, on a lock screen,
  in the one message people screenshot and send each other. It returns
  `"3 players"` now; the tie is implied by there being three of them.
- **Every number went out bare.** `"won it with 120"`, `"with 104"`,
  `"second on 113"` — a points total with no unit reads as a score from
  the game. And `f"{wpts} points"` sent `"1 points"`, which is the same
  off-by-one-word the cards fixed months ago (`1 PTS` → `1 PT`).
  `pts_label()` supplies the unit and the singular.
- **The season leader was `results[0]`, compared by identity.** The
  season order is `sort(-total)` then `apply_tiebreak`, so a two-way tie
  at the top had the app telling one co-leader that the other *"leads the
  season"* — contradicting the Standings screen that player was looking
  at. Every player level on the top total is a leader, the sentence says
  so (`"Lee and Vic lead the season"`), and nobody in that set is told
  about it. Identity was also wrong on its own terms: it passed only
  because the caller handed over an element of the list it was
  iterating, and the test fixture's own `LEADER` — a separate dict with
  the same uid — was already proof of that.

## 4d. The week closer, and the window that stops

Not a design decision about pixels, but the same class of thing: a state
the app described wrongly.

**Monday Night Football goes final around 23:30 ET and the next
scheduled scoring run is the Tuesday cron.** So for about four hours the
app showed a finished week with no winner, no seals and no result
notification, on the one night the whole pool is watching — while the
Live-scores window was awake, connected to Firestore, and holding the
very fact needed to fix it.

`score_week.py --status-file` now writes what state the week is in, and
`scores-loop.yml` reads it to do two things:

- **Close a finished week**, once, by running the full scorer. Seals land
  in about five minutes. Gated on `games > 0 and final == games`, the
  same test the scorer's own weekly awards use — and `status_env.py`
  recomputes that from the counts rather than trusting the boolean,
  because a week is scored off the back of that line.
- **Stop when there is nothing left to watch.** Nothing live AND no
  kickoff before the window closes. **Both halves are required**: the
  Thursday window opens at 23:00 UTC for a 00:15 kickoff, so for 75
  minutes nothing is live, and a window that exited on that would leave
  Thursday night football entirely uncovered. `next_kick_ms` therefore
  spans the SEASON, not the week, so the Thursday window can see next
  week's opener.

Every malformed, partial or hostile status file produces the defaults —
no week, not complete, one game live — so no information produces no new
behaviour: the window keeps pulling and the Tuesday cron still scores
the week, which is exactly where this started.

## 3h. The version card, and why the number is not in index.html

**Built, in v1.36.0.** Lee asked for a version somewhere in the app and
suggested Settings. Settings is right, at the very bottom, under First
run. Four placements were rendered first:
`docs/mockups/version-line-390.png`.

**The question it answers is not "what version is this."** It is *"is
this phone on the new one"*, which came up on every deploy and was
answered by telling twenty eight people to swipe the app away and reopen
it. A label answers half of that. So it is a card: the number, and a
button that asks the server.

**One version constant in the whole project, and it is line 8 of
`sw.js`.** That file is the one whose change makes a phone fetch
anything, so it is the only sane place for the number to live. The page
asks the running worker over a `MessageChannel` and prints the reply; if
there is no answer, the cache name (`poolsheet-v1.36.0`) carries the
same figure; if there is neither, the card says `Not installed yet`
rather than guessing. A second constant in `index.html` would have been
one line and two problems: something else to remember to bump, and a
number describing a file rather than the worker that served it. Audit
`version card` fails the build if one ever appears.

**Four states**, all in regress case 60: resting, checking, nothing new,
and one waiting where the same button turns green and says **Update
now**. A failed check says it failed rather than claiming you are up to
date, which mutation batch 39 exists to keep true.

**Where an update announces itself: the top of the Picks tab**, in the
`#updbar` banner that already existed. Lee asked for that specifically.
`swCheck()` calls `swAnnounce()`, so an update found from a card in
Settings is also waiting on the tab people actually open. Both the
banner's button and the card's green one end in the same
`postMessage('SKIP_WAITING')`, so the route can only break in one place.

**All three platform calls live in `firebase-init.js`** (`swVersion`,
`swCheck`, `swActivate`) with the rest of the worker plumbing. The page
makes no `navigator.serviceWorker` call of its own, which is what lets
the test stub walk the card through every state without a real worker,
and audit `version routes` checks it stays that way.

**Two things the suite caught that looking at it would not have.** The
button measured 35px and `polish.ui.test.mjs` asserts a 36px minimum tap
target. And mutation batch 37 hid the banner while two of the three
banner assertions stayed green: a hidden element's bounding rect is all
zeros, so "above the slate" was trivially true, and `innerText` is not a
fix, because the spec has it fall back to `textContent` for anything not
being rendered. `offsetHeight` is the only one of the three that knows.

## 4e. Reminders are about a bunch of games, not a kickoff time

**Built, in v1.37.0.** Mockups:
`docs/mockups/reminder-copy-390.png` (the four shapes I proposed and Lee
rejected), `reminder-slate-*` (his framing), and
`reminder-g1t-1-spec-390.png` plus `reminder-g1t-2-edges-390.png` (the
spec that shipped).

**What he received, and why it was wrong.** `1 pick due Fri 9:15 AM`
over `Less than a day. 16 Week 2 games still need a pick.` Both numbers
were true: the title counted the picks due at ONE deadline (Thursday
night is one game) and the body counted what the week still owed. The
title is the line a phone shows first, so the 1 read as the whole job
and the 16 arrived as a contradiction.

**This was the second version of that mistake.** The first had a
week-level title over a slot-level body, `Week 1 is open` above `1 game
to pick`, sent three times to somebody with the whole Sunday slate
unpicked. Rewriting the sentence fixed one and created the other,
because the problem was never the sentence.

**The unit was wrong.** Lee said what it should be: *"a reminder for
what's about to come up. 1 game still needs a pick before Thursday Night
Football. Then on Saturday for Sunday, 14 games still need a pick for
Sunday football."* The alert is about a NAMED BUNCH, and every number in
it counts that bunch, so there is no second figure to mistake for the
first.

| | |
|---|---|
| title | `Lee, Thursday Night Football` |
| one game | `Kicks off in 22 min. No team selected yet. Unselected games score 0.` |
| several | `First kickoff in 3 hours. 6 games unpicked. Unselected games score 0.` |

**Five bunches**, from his own list: Thursday Night Football, the early
Sunday games, the late Sunday games, Sunday Night Football, Monday Night
Football, plus `sat` for December Saturdays and `other` as a
backstop. **Sunday sends one alert per tier instead of three**, because
it used to key on kickoff time and Sunday has three of them. Seven
alerts across a week if you pick nothing until Saturday, where it used
to be ten; still none at all if you pick on Wednesday.

**The bunch is named in ET, the clock is localised.** "Thursday Night
Football" is a fact about the schedule; in Iwakuni it kicks off Friday
morning and the Picks tab already labels that card FRIDAY. Naming the
bunch from the reader's own zone would put one member's alert at odds
with the schedule the other twenty seven talk about. `etSlate()` takes a
timestamp, so the reader's zone cannot reach it.

**Not "morning" and "afternoon", which the mockup used and I changed.**
The early Sunday block is 1pm in New York and 2am in Japan. Neither is
morning, so the names describe the order instead of the hour.

**The name is on every alert.** Lee asked for it, and it solves the
thing that made two alerts look like a bug: two accounts on one phone
produced two identical notifications. Measured on the mockup sheet,
every name in the pool fits one title line against the longest bunch
name in the league.

**Three smaller calls, all reversible.** A bunch of one game gets no
count, because "1 of 1 unpicked" is a worse sentence than "No team
selected yet". `Unselected games score 0.` starts at the hours tier:
two days out it warns about a hypothetical, and it was what pushed the
body onto a third line, which iOS hides behind a pull-down. Two days
out gives the clock rather than "in 44 hours".

**The sender had no test at all before this.**
`reminder-copy.test.mjs` graded the words; nothing graded `remind()`,
which is where "three Sunday alerts became one" actually lives.
`reminder-send.test.mjs` is new and does: one alert per bunch with that
bunch's own count, a finished bunch never mentioned again, a cleared
pick still counting as unpicked, one alert per member, a tier switched
off respected, and the dedupe key naming the bunch rather than a
timestamp.

**Deploying it takes both commands.** `worker/live.js` is a Worker, so
`wrangler deploy -c wrangler-live.toml`; the Help tab's preview is in
`index.html`, so `git push`. Regress case 24 compares the two files as a
pair precisely so they cannot drift, and it has caught that drift twice.

## 3i. White on every club, and the ring that pays for it

**Built, in v1.38.3.** Sheets:
`docs/mockups/white-ink-1-teams-390.png` and
`white-ink-2-ring-390.png`. Lee chose variant **E**. It took three
corrections after that to land, and both of the wrong turns are recorded
below rather than tidied away: the fade, and the strip.

**The instruction:** no black writing anywhere on a game card, white
throughout, with a thin white ring round the badge on the team you took
or the team that won.

**What was black.** `onColor()` measured each club's primary and
returned near-black for the four too light for white text, so the lit
side of a CIN, MIA, CAR or LAC card printed its name in `#15171B` while
the other twenty eight printed white. Nothing else on a card was ever
dark; the badge letters and the pool bar label were white on all 32.

**What replaced it, three lines:**

```
.side.won{flex-grow:1.12;color:#fff}
.side.won .mark{box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.92)}
.side.won .city{opacity:.92}
```

**And the badge's own secondary strip, which the build took away and Lee
put back.** `.mark::after` paints a 6px bar of the club's SECONDARY
colour across the bottom of the badge: gold on Green Bay, `#101820` on
Carolina, `#000000` on Atlanta, Cincinnati and the Jets. Once the
writing was all white, that bar was the only dark thing left inside the
colour block, so I read "no black writing anywhere" as covering it and
added `.side.won .mark::after{display:none}`.

**That was wrong, and the rule is now the correction.** In Lee's words:
*"Put the color on the bottom, why did you remove it from inside the
small square logo on the card."* The bar is not writing. It is the
club's second colour, it is what tells one badge from another at 42px,
and it is on both badges, lit and unlit. There is no `display:none`
rule and there must not be one.

Mutation batch 44 is therefore **inverted**: it re-applies my mistake,
hiding the strip on the selected side, and regress case 61 has to catch
it. Only a test that reads the pseudo-element can, which is why case 61
reads `getComputedStyle(mark, '::after')` for `display` and for
`backgroundColor` and asserts the bar is present on both badges and
painted from the club's own `--sec`. Audit `white ink` keeps
`.side.won .mark::after{display:none}` in its `lacks()` list so the
rule cannot creep back in.

`onColor()` is **deleted**, not merely unused. While it existed, one
line reinstating the call would have brought the black back with no test
failing anywhere near the place it was reintroduced; audit `white ink`
now fails the build if the function reappears.

**The ring earns its place.** It separates the badge from a light panel,
which is the one thing white text cannot do for itself. On the lit side
only: putting it on both sides would make it decoration rather than the
mark of the side you took, which is mutation batch 42.

**The city line is faded slightly, and the number is measured.** Lee
wants it set back from the team name, the way the reference shot reads.
The old value was `.62`, which is far too much: white at 62% over
Cincinnati orange is **2.08:1**, the worst text on any card. Full white
is 3.37 there and makes the line as loud as the name. **`.92` is the
most fade that keeps the worst club in the league at 3:1 or better** —
Cincinnati 3.05, Miami 3.58, Carolina 3.65, the Chargers 3.86, every
other club well clear. Case 61 asserts the window `0.9` to `0.95`
rather than the exact value, because either direction out of it is a
different decision: batch 43 puts `.62` back, batch 45 removes the fade
entirely, and the window assertion is in **both** batches' expectation
lists because it is the one thing that fails at either end.

**What was knowingly given up.** On those four clubs the team name sits
under the 4.5:1 floor:

| club | primary | white at 16px |
|---|---|---|
| Cincinnati | `#FB4F14` | 3.37:1 |
| Miami | `#008E97` | 3.95:1 |
| Carolina | `#0085CA` | 4.03:1 |
| Chargers | `#0080C6` | 4.28:1 |

The score line is 21px at weight 800, which is WCAG large text at a 3:1
floor, so it passes on every club. Variant **C** on the sheet cleared
4.5:1 everywhere by darkening the lit panel 3 to 15 per cent, and was
rejected: it prints a colour that is not the club's. Regress case 61
asserts those four ranges explicitly rather than letting them drift from
a decision into an oversight. Variant **D**, a text shadow, changes
nothing measurable and is on the sheet to be ruled out.

## 3j. The dark ink that stays, and why white IS the selection

**Decided, nothing built.** Sheets:
`docs/mockups/paper-ink-1-what-is-dark-390.png` and
`paper-ink-2-options-390.png`, from `scripts/test/mock-paper-ink.mjs`.
Lee chose **P1**, which is the build as it already stands.

**The question.** Lee asked twice, in the same words both times: *"no
black writing anywhere on the cards or outside of it, only white."*
After 3i there is no dark ink on any club colour at all, so the second
asking had to be about something else, and it was worth finding out
what before changing anything.

**What was actually left, all of it on the cream paper**, not on a
colour: the head `FINAL · CAR 34-23`, the gutter `@`, the losing side's
city, name and score, `HOW THE POOL PICKED`, `13 picks`, and the result
line. Sheet 1 marks each one on a real card, numbered in a gutter
beside it rather than over the words, and states the fact that decides
the whole thing: **white on `#EDE8DE` measures 1.22:1.** Not faint,
gone. So this was never an ink change. It was a question about the
paper.

**The four, drawn and measured.** P1 as shipped. **P2**, the card's
paper becomes the app's own shell tones so every word on the card is
white, the only variant that literally does what was asked, and it
needs the result colours re-picked: `--hit #2F6E26` measures 2.39:1 on
`#2A2724`, so the sheet uses `#6C9966` at 4.52:1. **P3**, only the head
and the result bar go dark. **P4**, the losing side takes its own club
colour darkened enough to carry white text. Dark pieces left per
variant: **P1 18, P2 0, P3 15, P4 12** of 21. P4 costs the exact thing
that got variant C rejected in 3i, a colour that is not the club's, and
the sheet shows its own cost: the Bengals' darkened `#D54311` losing
panel sits directly above the pool bar's true `#FB4F14`.

**Lee's answer, and it reframed the whole thing:**

> "The black is fine on the card, before you select it, once a side is
> selected it goes white writing."

So the dark ink is not a leftover. **White ink is what selection looks
like**, and the dark side is the other half of that signal. Whitening
the paper side would not finish the job, it would delete the job.

**This is now guarded, because it is the mistake I would make next.**
Regress case 61 section 5 asserts an unselected side writes in dark
ink, that white appears on the lit side and only there, that the four
paper bands keep their dark ink, and it reads the white-on-paper ratio
off the card rather than quoting it from this note. Mutation batch 46
whitens the unselected side and batch 47 whitens the pool label; both
have to be caught. Without those, a later pass "completing" the white
treatment would go in green.

## 3k. Who has the ball, and why it sits on the gutter side

Lee asked for it in one line: "is there a way to put a football or
indicator to the team that has the ball in its current drive since we
are already updating the live score?" The app was already polling ESPN
every 60 seconds for the score and the clock, and the same payload
carries `situation.possession`, so this costs no new request.

Four mockup sheets settled it, and each round moved one thing.

| sheet | what was asked | what came back |
|---|---|---|
| 1 | anything at all | emoji, a dot, a chevron, an outline football |
| 2 | "the football that has the strings", on the LEFT of the score | the laced outline, drawn in `currentColor` |
| 3 | "move it more to the left about 4 spaces", and mirror it | the away football moved right of the score, the home football left |
| 4 | 2, 3, 4 and 5 characters, both sides | **unselected 3, selected 4** |

**The chosen geometry.** The football always sits on the GUTTER side of
its own panel: right of the away score, left of the home score. Lee put
the reason plainly when the first mirror attempt got it wrong: "it needs
to mimick the same as the opposite side." A football that hugs the
outer edge of one panel and the inner edge of the other reads as two
different indicators.

**The two gaps, and why they are not one number.** Lee looked at the
four-way sheet and said "the filled in team selected 3 and 4 look
different then the unselected team 3 and 4. I like unselected team 3 and
selected team 4." He is seeing a real thing. The picked panel grows to
`flex-grow:1.12` and the unpicked shrinks to `.94`, so the same pixel
gap sits inside two different panel widths and reads tighter on the wide
one. In Roboto Mono at 21px one space measures **12.0px**, so:

    .side .scr      { gap: 36px }   /* 3 characters, unselected */
    .side.won  .scr { gap: 48px }   /* 4 characters, selected */

Those are measured widths, not guesses, and regress case 62 measures
them back off the render at ±1.5px.

**Drawn, not typed.** The football is an inline SVG at 18x12 with
`stroke="currentColor"` and `fill="none"`, an outline with four laces.
It inherits the side's ink, so it is white on a lit panel and the club's
dark ink on paper, with no second colour to keep in step. The emoji was
rejected on sheet 1: it renders as a different object on every platform
and carries its own brown against a navy panel.

**It has to go away, and that is the part that breaks.** Two of the four
mutations written for this were about clearing, not showing:

- `if (pos)` instead of an explicit null would leave the last team that
  held the ball wearing the football through halftime and into the
  postgame show. Batch 56.
- possession has to drop at the whistle. `ballOf()` returns null when
  the game is final, independently of what ESPN last said. Batch 57.

**AND ONE GOT PAST ALL OF IT.** v1.39.0 shipped with the away score
27.6px right of where it belonged on every card that had a score but no
football, which is most live cards and every final one. A reversed flex
row packs to the right, and with a football present that is invisible
because ball plus gap plus digits already fill the box. Every assertion
written for this feature looked at a card that HAD a football, so all of
them stayed green. It was found by diffing the shipped build against
v1.38.3 and measuring, not by a test. `justify-content:flex-end` fixes
it in v1.39.1, and case 62 now also grades the card the feature did not
add anything to. THE LESSON: a feature has to be graded on what it does
to everything it did not touch.

Both of the clearing mutations went uncaught on the first run, and both
times the code was right and the FIXTURE was missing: the "nobody has it" case never had
possession to lose, and a week that was final from the first frame never
polls ESPN at all. Case 62 now runs a 21-second sequence that holds the
ball, strips `situation`, and forces a re-poll, plus a live week pushed
to final. That is the outcome mutation testing exists to produce.

## 4f. The spreads, and the refresh that ESPN would not allow

Lee: "I just noticed, when you pill espn spreads, they dont change."

Not a bug, a schedule. The lines were only refreshed by `pull_lines()`
inside `scripts/score_week.py`, which runs on the SCORING cadence, so
the last number written before a Sunday slate was Tuesday's and every
card showed it from Wednesday to Saturday.

`pullLines()` was built in `worker/live.js`, tested to 21 checks, and
deployed on 27 September. **It was refused by ESPN within minutes and
rolled back the same evening.** The log, from Lee's own `wrangler tail`:

    lines: espn 403 week 3 :: Access Denied
    lines: weeks 3,4, 0 priced, 0 changed

No data was damaged, because the "no odds must not erase" rule meant
zero writes. What it did do was retry every five minutes forever, since
a failed day is deliberately not stamped. **That is 576 refused requests
a day and it is a real defect**: a retry rule written for a transient
blip has no business running unchanged against a permanent refusal.
Whatever replaces this needs a backoff.

**WHY IT WAS REFUSED, proved by four requests from Lee's laptop against
the same URL in the same minute:**

| User-Agent sent | answer |
|---|---|
| curl's own default | **200** |
| `curl/8.7.1`, set explicitly | **200** |
| `Mozilla/5.0 (compatible; WeeklyNFLPickem/1.0; +https://...)` | 403 |
| `WeeklyNFLPickem/1.0 (+https://...)` | 403 |
| `pickem-live-worker` | 403 |
| a full, real Chrome string | 403 |

A real Chrome header is refused while plain curl is allowed, which
inverts the usual pattern and gives the rule away: **ESPN is matching
the User-Agent against the TLS fingerprint.** A client whose header
agrees with its handshake is let through. Anything claiming to be
something its handshake is not, or that they do not recognise, is not.

**THE CONSEQUENCE, AND IT IS THE WHOLE DECISION.** No header chosen on a
laptop can be trusted from a Cloudflare Worker, because the Worker has
its own fingerprint and it is not curl's. Putting `curl/8.7.1` in the
Worker would be the exact mismatch ESPN is now catching. So the answer
is not a header.

**Where it goes instead.** `scripts/score_week.py` already talks to this
endpoint successfully from GitHub Actions every week, using python's
`requests`, and already contains `pull_lines()`. The daily refresh
becomes a scheduled Actions job calling code already proven in
production, on a client ESPN already accepts.

**AND THE SAME HEADER IS IN `scores()`**, at `worker/live.js` line 411,
so the Worker's own score puller is very likely refused too. It has gone
unnoticed because scores reach Firestore by two other routes: the
Actions loop, and each player's phone reading ESPN itself. The Worker
was the third of three. Losing it lost a backstop, not the feature.

## 4g. The Grid told the whole pool they had missed a game

Lee sat on the Grid as the Sunday night Rams game locked. The column
header went LIVE the instant the clock passed kickoff, and then every
player's cell showed a red dash for over two minutes before the picks
appeared.

**Nothing was wrong with the data. Two clocks disagreed, and only one of
them was being asked.**

| what | driven by | when it flips |
|---|---|---|
| the cell deciding to show a pick | `isLive(g)`, arithmetic on the phone | exactly at kickoff |
| the picks themselves | a Firestore query bounded at `now - margin` | a margin later |

The margin is load bearing. The rules only return a pick once
`revealAt <= request.time` on the SERVER, and Firestore refuses a list
query outright unless the rule can be proven for every document it could
return. A phone whose clock runs fast and asks for everything up to "now"
gets the entire Grid denied rather than fewer rows, which has happened on
this app before. So the client deliberately asks for less than it is
entitled to.

**And the cell's answer to "no pick" is the symbol for DID NOT PICK.** So
for the length of that margin the screen told 28 people that every one of
them had missed the game. That is the most alarming thing it could have
said and it was not true.

### Two fixes, and they are separate

**1. Unseal on the data, not on the clock.** The app already records
`revealBound`, the exact instant the open listener was created with:

    const shown = r.p===ME || (isLive(g) && g.kick <= revealBound);

Sealed dots mean "not revealed yet", which is true. This is the half that
matters, because it is honest whatever the margin turns out to be.

**2. Stop paying two minutes for a margin almost nobody needs.** The
margin now starts at **5 seconds** and widens to 120 only when Firestore
actually refuses the query. **The refusal is the measurement.** A phone
with a correct clock pays one query and reveals in seconds; a phone with
a wrong one pays two and still works.

Rejected: measuring the offset from a server `Date` header. It is another
request, on boot, in the path that must succeed before anything renders,
to fix a problem the retry handles with no request at all.

**Five seconds, not zero**, because zero would refuse on a device one
second fast, which is common enough to be the normal case.

### What the tests had to learn

**Every check written for the football looked at a card that had a
football.** The same blind spot appeared here twice:

- The first version of the "it fills in" assertion counted **your own
  row**, which is visible at every moment by design. It passed against a
  build that revealed nobody else at all. Mutation 60 found it.
- A `page.click(...).catch(() => {})` on the week strip in case 59 meant a
  swallowed click silently graded the wrong week, failing about one run
  in five in a way that looked like a real defect. It now asserts the
  switch happened.

A feature has to be graded on what it does to everything it did not
touch, and a fixture that can quietly skip is not a fixture.

## 4h. Thirty seconds, and why not fifteen

Lee, after a full Sunday: the football took too long to move to the
receiving team after a punt.

`ESPN_EVERY` is 30000, down from 60000. **One request carries the score,
the game clock and possession**, so this single number is the whole
live-update rate and halving it needs no new request kinds.

**It costs nothing but battery.** The poll never touches Firestore or
Cloudflare, so there is no read, no write and no bill, and the loop stops
entirely while the app is off screen.

**Fifteen was asked for and is the wrong number.** `ESPN_FLOOR` is 20000,
a hard minimum gap that exists to collapse the duplicate triggers iOS
throws off on a tab switch. At 15000 the floor swallows every other tick,
so the real rate is about 20 seconds arriving irregularly: slower than it
claims and less predictable than 30. Lowering the floor to chase it would
give up a real guard for a few seconds that ESPN's own feed lag mostly
eats anyway.

**Half the delay is not ours.** ESPN takes its own time to register a
change of possession. Halving our interval halves our share of it.

## 4i. How the app is used, and deliberately nothing about who

Lee: "I don't need to know exactly who is on it and how often, just would
like to know how many people are opening it through browser or home
screen, how long they spend on it, which tabs they are clicking and how
long they spend on each tab."

And the question underneath it: **"how long our players sit on the pick
tab watching the games as they progress."** That is the number that says
what to improve next season, and nothing in the app could answer it.

### Why Cloudflare Web Analytics is not enough on its own

It is one dashboard toggle and it is worth having: it counts launches,
by hour, by device, which answers "how many people and when". But a page
view is one page load, and this is a single page with five tabs.
Switching from Picks to Grid is not a navigation, so it produces nothing.
Session length and tab time are outside what it measures at all.

### And why not Google Analytics

It would answer everything. It also means a third-party script on the
launch path that took real work to make fast, cookies and consent on an
app used by one family and their friends, and handing Google the
behaviour of 28 people who did not sign up for that.

### One row per session, in our own Firestore

`pools/{pool}/usage/{sessionId}`, written by the app, read only by
`scripts/usage_report.py` under the admin credentials.

| field | |
|---|---|
| `mode` | `standalone` or `browser`, which answers the Home Screen question |
| `started`, `updated` | when |
| `visibleMs` | how long the app was **on screen** |
| `tabs` | milliseconds per tab, five keys |
| `wk` | the week being looked at |

**ANONYMOUS BY CONSTRUCTION, NOT BY INTENTION.** There is no uid, no
name, no email, and the document id is minted fresh on every launch and
never stored, so two sessions by the same person cannot be joined up
afterwards by anybody, including whoever holds the service account.

**And the absence is enforced by the database.** The rule allows only
those six keys, so a later edit that starts attaching a uid is refused by
Firestore rather than by somebody remembering the promise. Reads are
denied outright, owner included: there is no screen anywhere in the app
that could ever show who was where. That is the property worth having,
because the alternative is a promise that decays the first time a field
is added and nothing objects.

### The decision that makes the numbers mean anything

**Visible time only.** A phone in a pocket with Picks open would
otherwise report hours of rapt attention on whatever tab was last
showing, exactly inverting the thing being measured. The accumulator
stops on `hidden` and restarts on `visible`, and a single segment longer
than six hours is dropped rather than banked, because a laptop that
sleeps with the tab visible fires no event on some platforms and one such
row would swamp every average.

### Two things the report refuses to do, and both are arithmetic traps

**A launch backgrounded before anything accrued is a VISIT, not a session
of length zero.** Averaging it in would make "average time on the app" a
measure of how often people get interrupted.

**A tab nobody opened is absent, not a zero.** If Help is opened once for
four minutes and ignored in nine other sessions, the average time on Help
is four minutes. Counting the nine as zeros gives 24 seconds, which
describes how rarely Help is opened rather than how long it is read. The
report has a separate column for how many sessions touched it.

### Cost

About one to three writes per session, so roughly 150 a day at this size
against a free allowance of 20,000. Reading is a script Lee runs, not
something the app does.

### The blast radius, measured rather than asserted

Lee asked whether this could disturb scoring, picks or anything else.
Diffed against the live build rather than answered from memory:

| file | existing lines changed |
|---|---|
| `index.html` | **1** |
| `firebase-init.js` | **0** |
| `firestore.rules` | **0** |

Everything else is addition. The one changed line is in the tab click
handler, where the two statements that were there still run in the same
order with the tracker call inserted between them.

**And that call is wrapped**, because the tab switch is the most pressed
control in the app: if a counter threw there, the two statements after it
would never run and the tab would be dead. Nothing in it should throw,
but "should" is what the try is for.

**The obvious test for that guard was written, passed, and was inert.**
`usageTab` is declared inside a module, so the
`window.usageTab = () => { throw }` used to break it overrode a different
function that nobody calls. It passed identically with the guard removed,
which is the only reason it was caught. There is no injection point from
a browser test that reaches a module-scoped function without breaking
half the app on the way past, so the guard is graded by the audit and
mutation 65 instead. That is a source check rather than a behaviour
check, and saying so is better than an assertion that grades nothing.

## 4j. And a fixture that only failed on Mondays

`reminder-send.test.mjs` had been reporting 21 of 22 and was written off
twice as a quiet-hours flake. It was not. It failed at 11:37am ET.

The sender emits **one alert per bunch per TIER**. The fixture counted
**one alert per bunch**. Those are the same number on most days, because
two kickoffs six hours apart usually fall in different bunches. On a
**Monday** they are both `mnf`, so the sender correctly sent two alerts,
one for the `hours` tier and one for `day`, and the case failed reporting
want and got as the identical `{"mnf":3}`.

It looked exactly like a defect in the sender and it was a fixture
disagreeing with the sender about what an alert is. The fixture now
groups both ways, because the sender does: an alert is a bunch in a tier,
while the "N games unpicked" count is per bunch.

**The lesson is the one this repo keeps relearning.** A test that fails
intermittently is not noise to be waited out. It is a claim that
something is wrong, and twice I attributed it to the hour rather than
reading it.

## 4k. The jump under your thumb, found by real phones

Cloudflare Web Analytics, three days including a Sunday slate: **CLS
0.122 against `#v-picks` on 29 of 33 loads.** Not a sample. Very nearly
every launch.

Reproduced frame by frame against the real build:

| | `#weeks` | `#v-picks` |
|---|---|---|
| **40ms** | height **9px**, 0 children | y = 140 |
| **171ms** | height **53px**, 1 child | y = **184** |

The week strip is an empty sliver until the season arrives, then it
appears at full height and **shoves the entire picks view down 44
pixels**. Anybody reaching for a team in that window watches the card
move out from under their thumb, and on a slow connection the window is
seconds rather than milliseconds.

**The fix is one property and the number is arithmetic**, not taste: a
`.wk` button is `min-height:44px` and the strip carries 9px of bottom
padding, so a populated strip is always exactly 53px.

    .weeks{ ... min-height:53px}

**Measured before and after: CLS 0.1108 to 0.0038.** The browser's own
"good" boundary is 0.1.

### Why this one is worth recording beyond the fix

**Nothing in the app was broken and no test could have found it.** Every
element rendered correctly, every number was right, and the suite was
green throughout. The defect only exists in the gap between two paints,
which is invisible unless something is watching the browser's own
layout-shift reports.

**It took production telemetry to see it at all.** This is the first
defect in this app that arrived as a measurement from other people's
phones rather than from Lee noticing something or a test going red. That
is the argument for having turned Web Analytics on, in one finding.

**And it is now guarded on the same quantity production reports.** Case
43f observes real layout-shift entries and asserts the total stays in the
good band and that `#v-picks` specifically never moves, so the test and
the dashboard cannot disagree about what improved. Mutation 66 removes
the reserved height and both assertions go red at the measured 0.111.

## 5. Open, not yet decided

- **The gutter `@` is 3.77:1**, found while drawing the paper-ink
  sheets for 3j. It is
  `--ink-faint` on `--paper-2` at 15px/700, which is normal text at a
  4.5:1 floor, on every card in the app rather than only final ones.
  The token's comment saying 4.6:1 is right about `--paper` and the
  gutter is painted on `--paper-2`. `--ink-mute` puts it at 5.30:1 and
  is indistinguishable. A one-line fix, offered and not yet asked for,
  so it has not been made.
- `apply_tiebreak` keys unders as `(0, actual − guess)`, which is
  *identical* for two equal guesses, so nothing breaks that tie and
  Firestore's ordering decides it. If two players tie on points **and**
  tie on the tiebreaker, the SEASON order between them is arbitrary and
  the app should say so rather than silently picking one. (The WEEK is
  not affected: a week is shared on points and the tiebreaker plays no
  part — see 3a.)
- **Rank numbering on a tie.** Positional (1, 2, 3) with shared seals
  and banners, which is what 3a settled for this release. Competition
  ranking (1, 1, 1, 4) is arguably more honest but reaches the movement
  arrows, the `prev` history and the pinned "you" bar; worth doing
  deliberately, not as a side effect.

## 6. Still unbuilt

- *(nothing from the approved set)*

---

## Built — v1.35.0

Everything below is in the build and checked by
`scripts/test/picks-audit.mjs` (43 of 43) plus the named cases in
`scripts/test/regress.ui.test.mjs`.

| item | where it is checked |
|---|---|
| **C1** header, **G4** tab order, **U3** week label | audit `C1` / `G4` / `U3` |
| **P1 + P5** live row, **P4** the empty case | audit `P1` / `P4` / `P4 dot` / `P5`, case 58a |
| **S2** meta centring | audit `S2` |
| **R2** losing side keeps its badge colour | audit `R2`, case 53 |
| **W3** the result is a word in a slanted pill | audit `W3 pill`, case 53c |
| the pill is the rank circle's own geometry | case 53c, measured against `.sb-num` |
| **Z1** the head is `Final · CHI 59-37`, centred | audit `Z1 head`, case 53b |
| **W1** the narrow side's figure under its own sliver | audit `W1 sub-line`, cases 52 and 53b |
| the unstaked pick says so, and scores its one point | audit `Unstaked`, case 53c |
| the paper-side red #BE2F26, not `--stamp` | audit `paper red`, cases 53b and 53c |
| the version card, its number read from the worker | audit `version card` / `version routes`, case 60 |
| white on every club, the ring, the full-white city line | audit `white ink`, case 61 |
| Q2 retired — the lock band is live-only | audit `Q2 retired`, case 53c |
| every colour on a final card measured on that paper | case 53b |
| true card colours — no wholesale desaturation | audit `true colour` |
| colour follows the winner once final | audit `winner` |
| pool sub-line on every card | audit `pool sub-line` |
| `1 PTS` → `1 PT` | audit `1 PT`, case 54 |
| the tiebreaker as a 50px column, numbers only | audit `TB column` / `TB cells` |
| no `WINNER` label anywhere in it | audit `TB no winner`, case 3785 block |
| the closest overshoot wins and is not struck through | audit `TB overshoot` |
| the 28-row panel replaced by one strip | audit `TB strip` |
| **S3** gold winner banner, silver runner-up | audit `S3 banners` |
| honours shared by points value, gated on `best > 0` | audit `week honours` / `week seals`, case 16 |
| your own row keeps its tint in second place | audit `me second`, case 58d |
| **H3** header clock, three states plus `pending` | audit `H3 clock` / `live ceiling`, case 58b |
| ESPN's "Final" never renders as a live clock | audit `ESPN final`, case 58a |
| the Tie column's third state | audit `tie header`, case 58c |
| the leader's sticky cells are opaque | audit `leader cells`, case 55 |
| the FINAL label is readable in its new home | audit `FINAL label`, case 53b |
| the live no-pick line at 4.91:1 | audit `live no-pick` |
| the archive as a Settings section | case 57 |
| the week closer and the early exit | `test_status_env.py`, `test_loop_window.py` |
| the results-notification copy | `test_result_copy.py` |
| the possession football, mirrored, 3 and 4 characters | audit `possession`, case 62 |
| the away score still starts where its team name does | case 62, mutation 58 |
| a live cell waits for the reveal bound before it unseals | audit `reveal honesty`, case 43b, mutation 59 |
| the reveal margin is fast by default and widens only on a refusal | `reveal.test.mjs`, case 43c, mutation 60 |
| a watched game refreshes every 30 seconds | audit `live rate` |
| the usage row carries no identity, ever | audit `usage anonymity`, case 43d, mutations 61-64, firestore.rules |
| only on-screen time is counted | case 43d, mutation 62 |
| the week strip holds its height before it fills | audit `no jump`, case 43f, mutation 66 |
