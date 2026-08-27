# Weekly NFL Pick’em

Weekly NFL confidence pick 'em. Single-page app, Firestore, email-PIN
sign-in, push reminders before every kickoff.

## Read these in order

| | |
|---|---|
| **[START-HERE.md](START-HERE.md)** | **Start here.** Every step, line by line, in order. |
| [PRESEASON.md](PRESEASON.md) | Why preseason is isolated, teardown, alert testing |
| [BUILD.md](BUILD.md) | The full build, every step from zip to live, in order. |
| [ROLLOUT.md](ROLLOUT.md) | Onboarding, notification schedule, the two weeks before Week 1 |
| [SCALE.md](SCALE.md) | Only if you pass ~100 players |
| SETUP.md | Superseded by BUILD.md. Kept for the reference sections. |

## What's here

```
index.html                     the app
firebase-init.js               auth, Firestore, push, updates
sw.js                          offline + update handling
manifest.json                  makes it installable
firestore.rules                the actual security
worker/auth.js                 email-PIN sign-in + session cookie
scripts/import_schedule.py     once a season (--preseason for the shakedown)
scripts/setup_preseason.py     isolated preseason pool
scripts/reset_pool.py          wipe a disposable pool, guarded
scripts/archive_pool.py        flatten a finished pool into one doc, hide/show it
scripts/check_roster.py        who will silently get no notifications
scripts/make_icons.py          regenerate the PWA icons
icons/                         generated, committed
scripts/build_snapshot.py      every 5 min — what the app reads
scripts/remind.py              pre-kickoff notifications
scripts/score_week.py          scores and final standings
scripts/check.sh               preflight config check
scripts/smoke-test.js          runs the app JS headless, catches runtime errors
.github/workflows/             the schedule
```

## Two things that will bite you

**Bump `VERSION` in `sw.js` on every deploy.** Forget it and people sit
on stale versions.

**Never commit `serviceAccount.json`.** It's full admin access to the
database. `bash scripts/check.sh` verifies this.
