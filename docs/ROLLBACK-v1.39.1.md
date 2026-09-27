# Rolling back v1.39.1

**There is only one half to this release.** It is `git push` only, so the
undo is `git` only. No wrangler, no worker command, nothing on
Cloudflare.

## The undo

```
cd C:\Users\ancon\Downloads\poolsheet
```

```
git revert --no-edit HEAD
```

```
git push
```

Cloudflare Pages rebuilds and every phone is back on **v1.39.0** within a
couple of minutes of a cold start.

## What you land back on

v1.39.0, which is the football plus the alignment defect: the away score
sitting 27.6px right of its own team name on every card that has a score
but no football.

Nothing else differs. Picks, ranking, kickoff locking, the Grid,
Standings, scoring, reminders and sign-in are identical in both, because
the only code change between them is one CSS property.

## Do not touch the worker

The worker is on the version you rolled back to on 27 September, which
is the v1.38.3 worker. v1.39.1 does not change it, and this rollback
does not either. If you run `wrangler deploy` from the `worker` folder
you will redeploy whatever `live.js` is on disk, so leave it alone.

## Confirm it landed

1. <https://nflweeklypickem.com/sw.js> in the **address bar** reads
   `const VERSION = 'v1.39.0';`
2. On your phone, after a cold start, Settings reads `v1.39.0`.
3. A finished card has its away score out of line with the team name
   above it again. That is the defect returning, which is the proof.

## If the push fails

A rejected push has not deployed anything, so you are still on whatever
was live.

**`rejected, non-fast-forward`.** Something else pushed to the branch:

```
git pull --rebase
```

```
git push
```

**Authentication failed.** Your token is the fine-grained PAT scoped to
`mnqlee/pickem`. **Do not paste it into this or any other chat.** If it
has expired, make a new one in GitHub with **Actions: Read and write**
and nothing else, and let Windows Credential Manager store it.
