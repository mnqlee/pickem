# Installing v1.34.0

**Read this first: one command sequence, and it is the one you already
use.** There is no wrangler in this release. Nothing in `worker/`
changed, so the Cloudflare Workers keep running exactly as they are.
Everything in this release deploys by pushing to `mnqlee/pickem`,
because Cloudflare Pages is git-connected to it — **the push IS the
deploy** — and GitHub Actions reads its workflows and scripts straight
out of the repo.

Total time: about three minutes, most of it Cloudflare building.

---

## Before you start

You need nothing open except a terminal. No keys, no tokens, no
secrets. **If any step below seems to want your `ADMIN_KEY`, your
`serviceAccount.json`, or your GitHub token, you are in the wrong
document — stop.** This release needs none of them.

---

## Part 1 · Put the files in place

**1.1** Download the zip and save it to your Downloads folder.

**1.2** Extract it **over** `C:\Users\ancon\Downloads\poolsheet`,
replacing files when Windows asks. It is the same layout as every
previous zip.

**1.3** Open a terminal there:

```
cd C:\Users\ancon\Downloads\poolsheet
```

**1.4** Check you are where you think you are, and that git agrees:

```
git status
```

You should see modified files including `index.html`, `sw.js`,
`scripts/score_week.py` and `.github/workflows/scores-loop.yml`, plus
one new file, `scripts/status_env.py`.

> **If `git status` lists nothing**, the extract went to the wrong
> place. Find the folder that has `index.html` in it and run from there.

---

## Part 2 · Deploy

**2.1** Stage everything:

```
git add -A
```

**2.2** Commit:

```
git commit -m "v1.34.0: shared week honours, live-clock fixes, archive in settings, week closer"
```

**2.3** Push:

```
git push
```

That is the deploy. Cloudflare Pages starts building the moment the push
lands.

**2.4** Watch it: <https://dash.cloudflare.com> → **Workers & Pages** →
**pickem** → the newest deployment. It goes **Building** → **Success** in
about 60–90 seconds.

---

## Part 3 · Confirm it is actually live

This part matters more than usual, because a service worker can serve
yesterday's app to a phone that thinks it is up to date.

**3.1** First, check what Cloudflare is actually serving. In a browser
**address bar** — not a search box — open:

```
https://nflweeklypickem.com/sw.js
```

Line 8 should read:

```
const VERSION = 'v1.34.0';
```

That is the deployed file, straight from Cloudflare, with no phone cache
in the way. If it still says `v1.33.3`, the build has not finished —
go back to Part 2.4 and wait.

> **The app itself does not print its version anywhere**, which is why
> this step uses the URL. Adding a version line to Settings would be a
> code change, and this release is not the place for one. Steps 3.2 and
> 3.3 below are how you tell what your own phone is running.

**3.2** On your phone, open the app and **pull down to refresh**, twice.
Then close it completely — swipe it away from the app switcher — wait
ten seconds, and reopen.

> A service worker serves the cached app until its next **cold start**. A
> pull-to-refresh alone is often not enough. If a phone seems stuck on
> the old app, this is almost always why.

**3.3** Three things to look at. These are the fingerprint of v1.34.0 —
if you can see all three, that phone is on the new app:

- **Settings** now has the **Preseason 2026** archive at the top, and
  the tab row has **five** tabs. The sixth Archive tab is gone.
- On a **live** game, the top-left of the card shows the quarter and the
  clock with a pulsing green dot, and the top-right says **IN PROGRESS**.
- On a **finished** game you called right, the bottom strip of the card
  is **filled green**, with every letter white. Called wrong, filled
  red.

---

## Part 4 · One thing to check on GitHub

The week closer and the early exit live in a workflow file, so they
arrive with the push. Nothing to configure — but it is worth confirming
GitHub accepted the file.

**4.1** Go to <https://github.com/mnqlee/pickem/actions>.

**4.2** In the left sidebar you should see **Live scores (window)**. Open
it.

**4.3** Press **Run workflow**. Leave all four inputs blank and run it.

**4.4** It should go green. Open the run and expand **Pull scores every
few minutes until the window closes**. You are looking for one line near
the top:

```
  status: 0/16 final, 0 live, complete=False
```

Numbers will differ. What matters is that the line is **there** — that is
the new status file being written, which is what the week closer reads.

**4.5** If there are no games being played right now, the run will also
print:

```
Nothing live and no kickoff before this window closes.
```

and stop in well under a minute instead of running for five and a half
hours. That is the early exit working.

> **If step 4.3 fails**, nothing about the app is broken — scores still
> come from the phones and the week still gets scored by the Tuesday
> cron. Send me the failing log. Do not start editing the workflow.

---

## What changed, in one page

### Things a player will notice

| What | Before | Now |
|---|---|---|
| A week that two people tie | one of them crowned, the other given the runner-up seal | both wear the 1ST seal and the gold banner |
| The runner-up | whoever is on row two | everybody on the next score down |
| A week nobody scored | row one crowned anyway | nobody crowned |
| A live card before ESPN sends a clock | kickoff time in live green with a pulsing dot | kickoff time in plain type, dot on IN PROGRESS |
| A game ESPN calls Final before our server does | the word "Final" as a pulsing live clock | kickoff time, until the server says final |
| A postponed or stuck game | "1 game live" pulsing green all week | `Week n · pending`, grey and still |
| The tiebreaker column before that game kicks off | "Open" in live green | "Open" in the sealed colour |
| Your own row when you come second | lost its highlight | keeps it |
| The archive | a sixth tab that came and went | a section at the top of Settings |
| A results notification for a three-way tie | "3 players tied won it with 120" | "3 players won it with 120 points" |
| A one-point week in a notification | "1 points" | "1 point" |
| A season led by two people | one of them told the other leads | "Lee and Vic lead the season" |

### Things only the machinery will notice

- **The week closer.** When the last game of a week goes final, the
  Live-scores window now scores that week immediately instead of leaving
  it for the Tuesday cron. Seals, the winner banner and the results
  notification land in about five minutes rather than about four hours.
  It runs at most once per week per window, is gated on the same
  `games > 0 and final == games` test the scorer's own weekly awards
  use, and if it fails the Tuesday cron still does the job.
- **The early exit.** A window with nothing live and no kickoff before it
  closes stops instead of polling ESPN for another five hours. It will
  not exit while a kickoff is still coming, which is what keeps Thursday
  night covered.

### Files in this release

| File | Why |
|---|---|
| `index.html` | the app |
| `sw.js` | version bump to v1.34.0, which is what makes phones fetch the new app |
| `scripts/score_week.py` | `--status-file`, `week_status()`, and the notification copy fixes |
| `scripts/status_env.py` | **new** — reads that status file for the workflow |
| `.github/workflows/scores-loop.yml` | the week closer and the early exit |
| `DESIGN-DECISIONS.md` | the record of what was chosen, updated |
| `docs/INSTALL-v1.34.0.md` | this file |
| `docs/ROLLBACK-v1.34.0.md` | how to undo it |
| `docs/STRESS-TEST-PLAN.md` | what to run before Thursday |
| `docs/mockups/archive-in-settings.png` | the archive in its new home |
| `scripts/test/**` | the tests; they ship with the repo and never run in production |

**Nothing in `worker/` changed. No wrangler. No secrets. No Firebase
console.**

---

## If something is wrong

`docs/ROLLBACK-v1.34.0.md` gets you back to v1.33.3 in one command.
Read it before you need it.
