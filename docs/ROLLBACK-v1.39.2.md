# Rolling back v1.39.2

**One half, so one command. No wrangler, nothing on Cloudflare.**

```
cd C:\Users\ancon\Downloads\poolsheet
```

```
git revert --no-edit HEAD
```

```
git push
```

Pages rebuilds and every phone is back on **v1.39.1** within a couple of
minutes of a cold start.

## What you land back on

v1.39.1: the possession football with the alignment fix, live updates
every 60 seconds, and the Grid showing a red dash against every player
for about two minutes after each kickoff.

Nothing else differs. Picks, ranking, kickoff locking, scoring,
Standings, reminders and sign-in are identical in both.

## Do not touch the worker

The worker is on the version you rolled back to on 27 September. v1.39.2
does not change it and this rollback does not either. Running `wrangler
deploy` from the `worker` folder would redeploy whatever is on disk, so
leave it alone.

## Rolling back only one of the two changes

They are independent and both live in `index.html`.

**Keep the faster updates, undo the Grid change:** not worth it. The Grid
change makes the screen honest; the only thing you would be restoring is
the red dashes.

**Keep the Grid change, undo the faster updates:** change one line back
and push.

```
const ESPN_EVERY=30000;
```

becomes

```
const ESPN_EVERY=60000;
```

Note that `scripts/test/picks-audit.mjs` will then report 40 of 41, by
design, because the interval is a recorded decision rather than a
preference. That is the audit doing its job, not a fault.

## Confirm it landed

1. In a browser **address bar**: `https://nflweeklypickem.com/sw.js`
   reads `const VERSION = 'v1.39.1';`
2. On your phone, after a cold start, Settings reads `v1.39.1`.
3. At the next kickoff, the Grid shows red dashes against every player
   for about two minutes. That is the old behaviour returning, which is
   the proof.

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
has expired, make a new one in GitHub with **Actions: Read and write** and
nothing else, and let Windows Credential Manager store it.
