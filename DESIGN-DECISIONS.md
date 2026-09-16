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
| J → K → N → Q — final strip | **Q2** | strip FILLS `--hit`/`--stamp`, all letters white |
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

## 3b. The card's bottom strip — Q2, the solid fill

**This is the one I got wrong, so it is written out in full.** The strip
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

## 5. Open, not yet decided

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

## Built — v1.34.0

Everything below is in the build and checked by
`scripts/test/picks-audit.mjs` (30 of 30) plus the named cases in
`scripts/test/regress.ui.test.mjs`.

| item | where it is checked |
|---|---|
| **C1** header, **G4** tab order, **U3** week label | audit `C1` / `G4` / `U3` |
| **P1 + P5** live row, **P4** the empty case | audit `P1` / `P4` / `P4 dot` / `P5`, case 58a |
| **S2** meta centring | audit `S2` |
| **R2** losing side keeps its badge colour | audit `R2`, case 53 |
| **Q2** the strip FILLS, all letters white | audit `Q2`, case 53 |
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
| the FINAL label is readable on the card | audit `FINAL label`, case 53b |
| the live no-pick line at 4.91:1 | audit `live no-pick` |
| the archive as a Settings section | case 57 |
| the week closer and the early exit | `test_status_env.py`, `test_loop_window.py` |
| the results-notification copy | `test_result_copy.py` |
