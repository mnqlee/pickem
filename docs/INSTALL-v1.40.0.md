# Installing v1.40.0

**This one has TWO deploys and they are not both git.** Read the order
before you start.

| half | command | why |
|---|---|---|
| the security rules | `npx firebase-tools deploy --only firestore:rules --project pickem-c0d06` | rules live in Firebase, not Cloudflare |
| the app | `git push` | Pages is git-connected |

**Rules first.** The new usage rows cannot be written until the rule
exists, and the rule is harmless on its own because nothing writes to
that collection until the app ships. In that order nothing is ever
broken. The other way round, the app spends however long it takes you
silently failing to record anything.

**No wrangler.** The worker is untouched.

---

# What this adds

**One anonymous row per session**, saying how long the app was on screen,
how that time split across the five tabs, and whether it was opened from
the Home Screen or a browser tab. Then `scripts/usage_report.py` adds it
all up.

It answers the question you actually asked: **how long do players sit on
the Picks tab while the games run.**

## Anonymous, and not just by promise

There is **no uid, no name and no email** on these rows, and the session
id is minted fresh on every launch and never stored, so two sessions by
the same person cannot be joined up afterwards. Not by the script, not by
you, not by anyone holding the service account.

**The rule enforces it rather than trusting the app.** It permits exactly
six keys. If a future change ever starts attaching a uid, Firestore
refuses the write. Reads are denied to everyone including you, so there
is no screen in the app that could ever show who was where. The only
place these rows are assembled is the report script.

## Only time on screen counts

A phone in a pocket with Picks open would otherwise report six hours of
rapt attention. The clock stops when the app is backgrounded and starts
again when it comes back.

---

# Install

**1.** Open a terminal and go to the folder:

```
cd C:\Users\ancon\Downloads\poolsheet
```

**2. Deploy the rules first.**

```
npx firebase-tools deploy --only firestore:rules --project pickem-c0d06
```

**Expect** it to print `+  Deploy complete!`. If it asks you to log in,
run `npx firebase-tools login` first. This has nothing to do with your
GitHub token or with wrangler.

> **If this step fails, stop and tell me.** Do not push the app yet.
> Nothing is broken at that point: the app on everyone's phone is
> unchanged and the rules are whatever they were.

**3.** Check what changed:

```
git status
```

**4.** Stage everything:

```
git add -A
```

**5.** Commit:

```
git commit -m "v1.40.0: anonymous usage rows and the report that reads them"
```

**6.** Push. This deploys the app.

```
git push
```

**7.** Confirm, and use curl rather than the address bar because a
service worker file is the thing a browser caches hardest:

```
curl -s https://nflweeklypickem.com/sw.js | findstr VERSION
```

Must read `const VERSION = 'v1.40.0';`

---

# Also worth doing, one toggle, no code

**Cloudflare Web Analytics.** Dashboard, **Workers & Pages → pickem →
Metrics → Enable** under Web Analytics. It counts launches by hour and
device without any script from us, and it is a useful cross-check against
the session rows. It cannot see tabs or time on screen, which is exactly
the gap the rows fill.

---

# Reading the numbers

Give it a few days of real use first. Then, from the repo root:

```
python scripts\usage_report.py --season 2026
```

That is the last 14 days. Other windows:

```
python scripts\usage_report.py --season 2026 --days 7
```

```
python scripts\usage_report.py --season 2026 --since 2026-10-05 --until 2026-10-07
```

And to get it into a spreadsheet, one row per session:

```
python scripts\usage_report.py --season 2026 --csv usage.csv
```

It is read-only. It writes nothing and deletes nothing.

**What it prints:** sessions and the Home Screen versus browser split;
total, average, median, shortest and longest session; and per tab the
total, the share, how many sessions used it, and the average, shortest
and longest. Plus sessions per day as a small bar chart.

**Two things it deliberately does not do.** A launch that was
backgrounded before anything accrued counts as a visit but is left out of
the duration averages, because averaging it in would make "average time
on the app" a measure of how often people get interrupted. And a tab
nobody opened is absent rather than a zero: if Help is read once for four
minutes and ignored nine times, the average time on Help is four minutes,
not 24 seconds. The "used" column tells you how often it was opened.

---

# Rolling back

`docs/ROLLBACK-v1.40.0.md`. Both halves undo independently and the app
half is the usual `git revert` and push.

---

# Can this disturb scoring, picks or anything else

Diffed against what is live rather than answered from memory:

| file | existing lines changed |
|---|---|
| `index.html` | **1** |
| `firebase-init.js` | **0** |
| `firestore.rules` | **0** |

Everything else in this release is new code that nothing existing calls.

**The one changed line** is in the tab click handler. Both statements
that were there still run, in the same order, with the tracker call
inserted between them, and that call is wrapped so it cannot stop a tab
from switching even if it throws.

**Nothing touches** picks, ranking, kickoff locking, the Grid, Standings,
scoring, results, reminders, sign-in or the worker. The usage row is
written to its own collection that nothing else reads, and a failed write
is swallowed on purpose, because everything the pool depends on is
written somewhere else entirely.

---

# Verified before shipping

**1484 checks across twenty-one suites, 0 failed**, on 2026-09-29.

| suite | |
|---|---|
| regress | 657, including two new usage cases |
| usage report (new) | 33, the aggregate arithmetic |
| reveal | 19 |
| polish, season, scale, stress | 41, 21, 21, 115 |
| sw.push, nudge, reminder-copy, reminder-send, live-auth | 33, 42, 50, 22, 20 |
| auth.core, auth.stress | 27, 49 |
| signin, invite | 48, 5 |
| audit | 42 of 42 |
| python: season_sim, result_copy, status_env, loop_window | 128, 30, 32, 49 |

**67 mutations all still apply.** Five were written for this change and
every one is caught:

| the mistake | caught by |
|---|---|
| bank a segment against the tab being opened, not the one left | case 43d, reporting picks at zero |
| keep the clock running while backgrounded | case 43d, reporting 2.8s it should not have |
| attach the uid to the row | case 43d, twice |
| let a refused write escape into the app | case 43e |
| unwrap the tracker inside the tab switch | audit `usage anonymity` |

**Two fixtures had to be fixed before they could catch anything**, and
both were hiding a defect rather than proving its absence.

The background-time check woke the page before flushing, which resets the
clock and makes the defect invisible whatever the code does. And a
`pagehide` flush masks it from the other side, because that handler stops
the clock itself. The sequence that actually exposes it is a second
`visibilitychange` while still hidden, which iOS genuinely fires in
bursts.

**And the long-standing 21 of 22 in `reminder-send.test.mjs` is fixed,
and it was never quiet hours.** I said that twice and it was wrong. The
sender sends one alert per bunch **per tier**; the fixture counted one
per bunch. Identical on most days, but on a **Monday** both fixture
kickoffs fall in the same bunch, so the sender correctly sent two and the
case failed reporting want and got as the same `{"mnf":3}`. The fixture
now groups both ways, because the sender does.
