# Installing v1.35.0

**The whole release is the finished game card.** Nothing else changed:
no scoring, no notifications, no workflows, no Workers, no secrets, no
Firebase console. One file of app, one line of version.

Same command sequence as v1.34.0. **No wrangler.** Cloudflare Pages is
git-connected to `mnqlee/pickem`, so the push IS the deploy.

Total time: about three minutes, most of it Cloudflare building.

---

## Part 1 · Put the files in place

**1.1** Download the zip and save it to your Downloads folder.

**1.2** Extract it **over** `C:\Users\ancon\Downloads\poolsheet`,
replacing files when Windows asks.

**1.3** Open a terminal there:

```
cd C:\Users\ancon\Downloads\poolsheet
```

**1.4** Check git agrees with you:

```
git status
```

You should see `index.html`, `sw.js`, `DESIGN-DECISIONS.md`, some files
under `scripts/test/`, and a few new ones under `docs/`.

> **If `git status` lists nothing**, the extract went to the wrong place.
> Find the folder with `index.html` in it and run from there.

---

## Part 2 · Deploy

**2.1** Stage everything:

```
git add -A
```

**2.2** Commit:

```
git commit -m "v1.35.0: final card rebuilt - WIN/LOSS pill, centred head, narrow-side figure"
```

**2.3** Push. This is the deploy:

```
git push
```

**2.4** Watch it: <https://dash.cloudflare.com> → **Workers & Pages** →
**pickem** → the newest deployment. **Building** → **Success** in about
60–90 seconds.

---

## Part 3 · Confirm it is live

**3.1** In a browser **address bar** — not a search box:

```
https://nflweeklypickem.com/sw.js
```

Line 8 should read `const VERSION = 'v1.35.0';`. That is the deployed
file straight from Cloudflare, with no phone cache in the way.

**3.2** On your phone: pull to refresh twice, then **close the app from
the app switcher**, wait ten seconds, reopen. A service worker serves
the cached app until its next cold start; a refresh alone is often not
enough.

**3.3** Open **Picks** on **Week 1**, which is finished. Every card
there should now look like this:

- **Top of the card**, centred: `FINAL · CHI 59-37`. No kickoff time, no
  network badge, no spread — those were answers to pre-game questions.
- **No coloured strip along the bottom.** Instead, one line where the
  stake bar sits: `You took CHI · Rank 9` in **green**, `+8 pts`, and a
  slanted **WIN** pill. Called it wrong: the same line in **red**,
  `0 pts`, and **LOSS**.
- A game you **didn't pick**: `No pick`, `0 pts`, a dash in the pill.
- A game that **ended level**: `no score` and a grey **TIE** pill.
- Under the pool bar, on a lopsided game: the small side's percentage
  with a **coloured square** in that team's colour, sitting on the same
  side as its own sliver, with `26 picks` at the other end.

**3.4** Then check a game that has **not** kicked off, and one that is
**being played**. Both should be completely unchanged — kickoff time,
network, spread, the stake bar, and on a live one the pulsing clock with
`IN PROGRESS`. This release is final-cards-only.

---

## What changed

### On a finished card

| | before | now |
|---|---|---|
| top row | kickoff time, network, spread, `FINAL` at the right | `FINAL · CHI 59-37`, centred |
| bottom | whole strip filled green or red, all letters white | one line: your pick, the points, a WIN / LOSS pill |
| a loss | `0 pts` on a red fill | `0 pts` in red on the card's own paper |
| an **unstaked** pick that won | `You took CHI · +1 pt`, nothing explaining the 1 | `You took CHI · Unstaked · +1 pt · WIN` |
| `rank 9` | lower case | **`Rank 9`** |
| the pool's narrow side | its percentage as plain text, always at the left | a coloured square and the figure, under its own sliver |

### The one thing that was actually wrong, not just plain

An **unstaked pick that comes in has always scored one point** — `pay()`
returns 1 for a falsy rank, the same as the lowest rank. The scoring was
never wrong. The card simply had no line for it, because `Rank 9` can't
be printed when there is no rank, so it read "+1 pt" with nothing
explaining why 1 and not 8. It says `Unstaked` now.

### The hairline ring you couldn't see

`docs/mockups/chip-ring-zoom-390.png` shows it at real size and at 8x.
It is one pixel at 30% black inside the 9px square, and it is there for
one club: Cincinnati's orange is 2.76:1 against the card's paper, under
the 3:1 a graphic needs, so without an edge that chip can fade into the
card. On the other 31 it is invisible, which is the point. Kept.

### What is NOT in this release

Making the pool bar's percentage and the team abbreviation print black
on the four clubs whose colour is too light for white text — Cincinnati
3.37:1, Miami 3.95, Carolina 4.03, the Chargers 4.28, against a 4.5:1
floor. It was built and rendered and then taken back out, because none
of it is actually hard to read.
`docs/mockups/label-ink-before-after-390.png` is the sheet it was judged
from, and DESIGN-DECISIONS section 5 keeps the measurements. **Nothing
about a club's colours changes in this release.**

### Two measured colour changes, both on purpose

- The losing line is **#BE2F26**, not `--stamp` #C8342A. On the card's
  light paper `--stamp` measures **4.32:1** — under the 4.5:1 floor —
  and this is now a whole line of text rather than one word. #BE2F26 is
  **4.75:1** and you can't tell them apart side by side. The app already
  does exactly this in reverse: the live no-pick line uses a lighter red
  because `--stamp` is only 3.18:1 on the dark strip.
- The narrow-side chip carries a **hairline ring**. Cincinnati's orange
  is 2.76:1 against that paper and is the one chip in the league that
  can fade into it. Invisible on the other 31 teams.

### Files in this release

| File | Why |
|---|---|
| `index.html` | the app |
| `sw.js` | version bump to v1.35.0, which is what makes phones fetch it |
| `DESIGN-DECISIONS.md` | section 3f records W3 + Z1 + W1 and what was rejected |
| `docs/INSTALL-v1.35.0.md` | this file |
| `docs/ROLLBACK-v1.35.0.md` | how to undo it |
| `docs/mockups/*` | the rendered sheets every choice was made from, including the ring at 8x |
| `scripts/test/**` | the tests; they ship with the repo and never run in production |

**Nothing in `worker/`. No `.github/workflows/` change. No
`scripts/score_week.py` change. No wrangler, no secrets.**

---

## If something is wrong

`docs/ROLLBACK-v1.35.0.md` puts you back on v1.34.0 with one command,
and v1.34.0 is the version that already came through Thursday night.
