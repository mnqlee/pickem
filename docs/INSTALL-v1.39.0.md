# Installing v1.39.0, every step in order

**This is built on top of v1.38.3, which is what you are running now.**
Nothing from v1.38.3 is undone, moved or restyled. The cards look
exactly as they look today until a game is actually being played.

**Two things are new, and they are the two you asked for:**

1. **A football on the team that has the ball.** It appears only on a
   game in progress, on the gutter side of that team's score, and it
   disappears the moment the game goes final.
2. **The spreads refresh once a day.** They used to refresh only on a
   scoring run, which meant the number on a Saturday card was last
   written on **Tuesday**. Now the live worker refreshes them once every
   day until each game kicks off.

**Two commands do it, and they are different systems:**

| half | command | why |
|---|---|---|
| the app, the football | `git push` | Cloudflare Pages is git-connected to `mnqlee/pickem` |
| the worker, the daily spreads | `wrangler deploy -c wrangler-live.toml` | Workers never deploy from git |

**Do them in this order, app first.** The football is drawn by the app
from data the app fetches itself, so it works the moment the push lands,
with or without the worker. The spread refresh is entirely inside the
worker. They do not depend on each other, and app-first keeps the same
order as every previous release.

---

# PART 1 · Put the files in place

**1.1** Download **`pickem-v1.39.0.zip`** to your Downloads folder.

There is no separate mockups zip this time. The four possession sheets
are inside the one zip, under `docs/mockups/`, and they are small.

**1.2** Right-click `pickem-v1.39.0.zip` and choose **Extract All…**

**1.3** In the destination box, type exactly:

```
C:\Users\ancon\Downloads\poolsheet
```

**1.4** Click **Extract**. When Windows asks about existing files,
choose **Replace the files in the destination**.

---

# PART 2 · Deploy the app

**2.1** Open a terminal (Windows Terminal, PowerShell or Git Bash) and
go to the folder:

```
cd C:\Users\ancon\Downloads\poolsheet
```

**2.2** Check git can see the new files:

```
git status
```

You should see `index.html`, `sw.js`, `worker/live.js`,
`DESIGN-DECISIONS.md`, files under `scripts/test/`, and new files under
`docs/`.

> **If `git status` says nothing to commit**, the extract went somewhere
> else. Find the folder that has `index.html` in it, `cd` there, and run
> `git status` again.

**2.3** Stage everything:

```
git add -A
```

**2.4** Commit:

```
git commit -m "v1.39.0: possession football on live cards, daily spread refresh in the live worker"
```

**2.5** Push. **This is the deploy.**

```
git push
```

**2.6** Watch it build: <https://dash.cloudflare.com> then **Workers &
Pages** then **pickem** then the newest deployment. It goes **Building**
to **Success** in about 60 to 90 seconds.

**2.7** Confirm the file that is actually live. In a browser **address
bar**, not a search box:

```
https://nflweeklypickem.com/sw.js
```

Line 8 must read:

```
const VERSION = 'v1.39.0';
```

If it still says `v1.38.3`, the build has not finished or the push did
not land. Do not go on to Part 3 until this line is right.

---

# PART 3 · Deploy the live worker

This is the only part that is not git. It is a Cloudflare Worker, and it
is the half that carries the daily spread refresh.

**3.1** From the same terminal:

```
cd C:\Users\ancon\Downloads\poolsheet\worker
```

**3.2** Deploy:

```
wrangler deploy -c wrangler-live.toml
```

**3.3** It prints the worker name, the uploaded size and a **Current
Version ID**. That is success.

> **If it says you are not logged in**, run `wrangler login`. It opens a
> browser. This has nothing to do with your GitHub token.
>
> **No secrets, no KV to create, no Firebase console.** The refresh uses
> the `SESSIONS` KV binding the worker already has, and writes through
> the same Firestore credentials the score puller already uses. Do not
> paste the admin key or the service account JSON anywhere.

**3.4** Go back up:

```
cd ..
```

---

# PART 4 · Prove the spread refresh, on upload day

You do not have to wait until tomorrow. There are two ways, and the
first one needs no key at all.

## 4A · The no-key way: watch the log (recommended)

**4A.1** In the same terminal, still in the `worker` folder:

```
cd C:\Users\ancon\Downloads\poolsheet\worker
wrangler tail -c wrangler-live.toml
```

**4A.2** Leave it running. The cron fires every five minutes, so you
wait at most five minutes.

**4A.3** On the first tick after midnight UTC (8pm ET in the autumn) you
will see a line like:

```
lines: weeks 4, 16 priced, 3 changed
```

On any other tick that day the job has already run and logs nothing,
which is correct. **If you are deploying during the day and do not want
to wait until 8pm ET, use 4B.**

**4A.4** Press `Ctrl+C` to stop the tail.

## 4B · The force switch, which does need your admin key

**4B.1** The deploy in Part 3 printed the Worker's own URL. It looks
like:

```
https://pickem-live.<your-subdomain>.workers.dev
```

That is **not** `nflweeklypickem.com`. The admin endpoints are on the
Worker, not on the site.

**4B.2** In a browser **address bar**, never a search box, type that
URL followed by:

```
/__live/lines?force=1&key=
```

and then type your admin key on the end.

> **This is the same rule as always.** The key goes in the address bar
> only. A key typed into a search box has to be rotated, and it must
> never be pasted into this or any other chat.

**4B.3** It answers with one line of JSON. A good answer looks like:

```
{"weeks":[4],"seen":16,"changed":3,"unmatched":0,"stamped":true}
```

Read it like this:

| field | what it means |
|---|---|
| `weeks` | the weeks with a game inside the next nine days. One or two |
| `seen` | games ESPN had a price for. On a normal week this is the whole slate |
| `changed` | lines that actually moved since the last write. **Zero is a perfectly good answer** if nothing moved |
| `unmatched` | ESPN games with no matching game in your schedule. **This should be 0.** If it is not, see the note at the bottom of this file |
| `stamped` | whether the day was recorded as done. True means tomorrow is the next run |

**4B.4** Load the same URL again **without** `force=1`:

```
/__live/lines?key=
```

It should answer `{"skipped":"already ran today"}`. That is the
once-a-day guard confirming itself, and it is the whole point: the
worker wakes every five minutes and this job runs once.

**4B.5** Close that browser tab when you are done, so the key is not
sitting in a visible address bar.

## From tomorrow

It runs on its own, on the first cron tick after midnight UTC. Nothing
to schedule, nothing to watch.

---

# PART 5 · Confirm the football, on your phone

**5.1** Open the app. Pull down to refresh twice.

**5.2** **Close the app from the app switcher** (swipe it away), wait
ten seconds, reopen. A service worker keeps serving the old app until
its next cold start; a refresh alone is often not enough.

**5.3** **Settings**, scroll to the bottom. The **Version** card reads:

```
v1.39.0
```

**5.4** **Picks**, during a game that is actually being played. This is
the only time the football exists, so it cannot be checked on a
Wednesday.

- the team with the ball has a **small outlined football with laces**
  beside its live score
- on the **left-hand** team it sits to the **right** of the score
- on the **right-hand** team it sits to the **left** of the score

So on both sides it sits toward the `@` in the middle. That is the
mirror you asked for.

**5.5** The spacing, which is the thing you picked off the last sheet:

- on the **team you did not take** the gap is **3 characters** wide
- on the **team you took** it is **4 characters**

They are different numbers on purpose. The selected panel is wider, so
the same gap reads tighter on it; 36px and 48px are what make the two
sides look the same to the eye.

**5.6** The football is **white** on the side you took and the **club's
dark ink** on the paper side. It has no colour of its own and never
prints a colour that is not the club's.

**5.7** **When possession changes**, the football moves within a minute.
The app polls ESPN every 60 seconds and possession rides along with the
score and the clock, so there is no new request and no extra battery.

**5.8** **When the game ends, the football goes.** It is gone at the
final whistle even if ESPN's last frame still named a team. Check one
finished card: no football anywhere on it.

**5.9** **A game that has not kicked off**: no football, and the card is
otherwise identical to today, including the spread, which is now at most
one day old instead of up to five.

---

# If something looks wrong

`docs/ROLLBACK-v1.39.0.md` has both halves of the undo. The short
version: `wrangler rollback -c wrangler-live.toml` in the `worker`
folder, then `git revert --no-edit HEAD` and `git push` in the main one.
That puts you back on v1.38.3, which is what you are running now.

---

# What changed, in detail

### The football

`pullEspn()` in `index.html` already ran every 60 seconds and already
kept two things out of each game: `ESPN_LIVE` (the score) and
`ESPN_CLOCK`. It now keeps a third, `ESPN_BALL`, read from
`competitions[0].situation.possession`, which is in the same payload.
**No new network request was added.**

```js
const sit = c.situation || {};
const pid = sit.possession == null ? null : String(sit.possession);
const own = pid && String(by.away.team.id) === pid ? a
          : pid && String(by.home.team.id) === pid ? h
          : null;
if (ESPN_BALL[k] !== own) { ESPN_BALL[k] = own; changed = true; }
```

The `== null` is deliberate and is the part that took a test to get
right. Writing `if (pid)` would mean that when ESPN stops sending a
situation, at halftime or a TV timeout, the last team to hold the ball
keeps wearing the football. It has to clear.

`ballOf()` returns null on any game that is final, independently of what
ESPN last said, so the football cannot survive the whistle even if the
feed is slow to catch up.

The football itself is an inline SVG, 18 by 12, `stroke="currentColor"`
and `fill="none"`, with four laces. Because it is `currentColor` it
inherits the side's ink and there is no second colour to keep in step
with the club palette. The emoji football was drawn on the first sheet
and rejected: it renders as a different object on every phone and brings
its own brown to a navy panel.

The two gaps:

```css
.side .scr      { gap: 36px }   /* 3 characters, unselected */
.side.won  .scr { gap: 48px }   /* 4 characters, selected */
.side.l .scr    { flex-direction: row-reverse }   /* the mirror */
```

One space in Roboto Mono at 21px measures **12.0px**, measured, not
assumed, so those are exactly 3 and 4 characters.

### The daily spreads

`pullLines()` is new in `worker/live.js`. It runs from the cron the
worker already has, guarded by a KV key `lines:day` holding a UTC date
string, so it does real work once a day and returns immediately on the
other 287 ticks.

It looks 9 days ahead, which covers next week's whole slate from any day
of this one, groups the games by week, and asks the same ESPN scoreboard
endpoint the score puller already uses.

Six rules, and each one is a way this job could have damaged data:

| rule | what it prevents |
|---|---|
| a failed day is **not** stamped | one bad afternoon costing a whole day of lines. The retry is five minutes away |
| it can only patch a game **already in your schedule** | ESPN renamed WAS to WSH once. A patch to an unmatched id would insert a phantom 17th game with no kickoff, there for the season |
| no odds does **not** erase the line you had | a book pulling a number would otherwise blank the card |
| an unchanged line is not rewritten | 16 pointless Firestore writes a day |
| the patch carries `{ spread }` and nothing else | the update mask is built from those keys, so a stray one could overwrite a kickoff, a score or a winner |
| `?force=1` ignores the day stamp | so the whole path can be proved on upload day, which is Part 4 |

**What it does not touch.** `scripts/score_week.py` still has its own
`pull_lines()` and it is unchanged. The two cannot fight: they write the
same field from the same source, and whichever runs last writes the same
number.

### If `unmatched` is not 0

It means ESPN is using an abbreviation your schedule does not have,
almost always a club rename. Nothing breaks and nothing is written for
that game; it simply keeps the line it had. Tell me the number and I
will map the abbreviation. Do not edit the schedule by hand.

### Files

| File | Which deploy |
|---|---|
| `index.html` | git |
| `sw.js` | git, and the version bump is what makes phones fetch |
| `worker/live.js` | **wrangler** |
| `DESIGN-DECISIONS.md`, `docs/**`, `scripts/test/**` | git, and none of it runs in production |

**No `firebase-init.js` change. No `.github/workflows/` change. No
`scripts/score_week.py` change. No secrets. No Firebase console.**

### Verified before shipping

1418 checks across twenty suites, 0 failed, run on 2026-09-27. Audit 39
of 39 design choices present. 59 mutations across 45 batches still
apply, and the four written for this release were each run against the
real suite:

| batch | the mistake it makes | caught by |
|---|---|---|
| 54 | puts the football on the outer edge instead of the gutter side | case 62, the mirror assertion |
| 55 | uses one gap on both sides | case 62, the 36 / 48 measurement |
| 56 | keeps the last holder when ESPN sends no situation | case 62, the 21-second sequence |
| 57 | lets the football outlive the final whistle | case 62, the live-then-final push |

Three of those four went uncaught on the first attempt, and in all three
cases the code was right and the **test fixture** was missing: there was
no game that lost possession, and no game that went final while being
watched. Those fixtures exist now. That is what mutation testing is for
and it is the reason this release took a second pass.

The line refresh has its own suite, `scripts/test/lines.test.mjs`, 21
checks, which runs the real `worker/live.js` with Firestore and ESPN
swapped for fixtures, so nothing leaves the machine.

### Still offered, still not done

The gutter `@` measures **3.77:1** against a 4.5:1 floor, on every card
in the app. One line moves it to 5.30:1 and it looks identical. It is
not in this release because you did not ask for it and this release was
kept to the two things you did.
