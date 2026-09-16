# Rolling back v1.34.0

**Read this before you deploy, not after.** It takes one command, and
knowing that it does is what makes shipping on a Thursday reasonable.

---

## The short version

```
cd C:\Users\ancon\Downloads\poolsheet
git revert --no-edit HEAD
git push
```

That is it. Cloudflare Pages rebuilds from the reverted commit and every
phone is back on v1.33.3 within a couple of minutes of a cold start.

---

## Why revert and not reset

`git revert` makes a NEW commit that undoes the last one. `git reset
--hard` rewrites history, which means a force-push, which means
Cloudflare and GitHub can disagree about what the branch is — and it
throws away the commit, so going forward again means re-extracting the
zip. Revert keeps both versions in the history and lets you re-apply
v1.34.0 later with one more command:

```
git revert --no-edit HEAD     # undoes the rollback, putting v1.34.0 back
```

---

## Confirm the rollback landed

1. <https://dash.cloudflare.com> → **Workers & Pages** → **pickem** →
   newest deployment reads **Success**.
2. In a browser **address bar**, open
   `https://nflweeklypickem.com/sw.js`. Line 8 reads
   `const VERSION = 'v1.33.3';`.
3. On your phone: close the app from the app switcher, wait ten seconds,
   reopen. The tab row has **six** tabs again, with **Archive** among
   them. That is the quickest visual confirmation that the old app is
   being served — the app does not print its version on screen.

---

## What the rollback does and does not undo

### Undone immediately

- Everything in the app: the shared week honours, the live-clock
  changes, the header clock's `pending` state, the tiebreaker column's
  sealed state, the archive moving into Settings.
- The week closer and the early exit, because they live in
  `.github/workflows/scores-loop.yml` and Actions reads the workflow
  from the branch on every run. The next window fires in its old shape.
- `scripts/score_week.py`, including `--status-file`. The `--scores-only`
  call in the old workflow does not pass that flag, so the two are
  consistent either way.

### NOT undone, and does not need to be

**Anything the week closer already scored stays scored, and it is
correct.** The closer runs the same `score_week.py` on the same data as
the Tuesday cron, and the scorer recomputes a week from scratch every
time — that is a property the script keeps deliberately, so a week can
be re-scored after a corrected result. So a week closed early is a week
scored normally, just earlier. Rolling back stops future weeks being
closed early; it does not unwind a week that was.

**Results notifications that were already sent stay sent.** Nothing can
recall a push. If a week was closed and the pool was notified, they were
notified about the right thing.

### One thing to know about the service worker

A phone that has already cached v1.34.0 keeps serving it until its next
cold start. There is no way to reach into somebody's phone and change
that. If you need the pool off v1.34.0 **now**, tell them: swipe the app
away from the app switcher and reopen it. That is the whole procedure.

---

## Rolling back only part of it

You almost certainly do not want this — a partial state is harder to
reason about than either whole version — but if one specific thing is
causing trouble, these are the smaller levers, in order of preference:

**The week closer is misbehaving.** Do not edit the workflow. Go to
<https://github.com/mnqlee/pickem/actions> → **Live scores (window)** →
**Run workflow**, and put `1` in **no_close**. That run pulls scores and
closes nothing. To stop the scheduled windows closing weeks too, revert
the whole release — the switch exists for diagnosing one run, not for
running the season on.

**The early exit is stopping windows too soon.** Same place, put `1` in
**no_early_exit**. The window then runs its full length as before.

**One file needs to go back.** For example the app only:

```
git checkout HEAD~1 -- index.html sw.js
git commit -m "revert index.html to v1.33.3"
git push
```

Be aware this leaves `sw.js` claiming v1.33.3 while the new
`score_week.py` and workflow are still live. They are compatible — the
status file is additive and the closer only reads it — but you now have
a version number that does not describe the whole tree, and the next
person to debug it will be misled. Prefer the full revert.

---

## If the push itself fails

A push that is rejected has not deployed anything, so you are still on
whatever was live before. Two usual causes:

**`rejected — non-fast-forward`.** Something else pushed to the branch.

```
git pull --rebase
git push
```

**Authentication failed.** Your token is the fine-grained PAT scoped to
`mnqlee/pickem`. **Do not paste it into this or any other chat.** If it
has expired, make a new one in GitHub with **Actions: Read and write**
and nothing else, and let Windows Credential Manager store it.

---

## The version you are rolling back to

**v1.33.3** — the version live before this release. Its tab row has six
tabs, its week seals go to rows one and two, and its Live-scores window
runs the full 350 minutes and never scores a week.
