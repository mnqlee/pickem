# Rolling back v1.40.0

**Two halves, and they undo independently.** Reverse of the install
order: app first, rules second.

## 1 · The app

```
cd C:\Users\ancon\Downloads\poolsheet
```

```
git revert --no-edit HEAD
```

```
git push
```

Every phone is back on **v1.39.2** within a couple of minutes of a cold
start, and nothing writes usage rows any more.

**This alone is usually enough.** With the app reverted the rule simply
governs a collection nobody writes to, which costs nothing and breaks
nothing. You can stop here.

## 2 · The rules, only if you want them back too

```
git checkout HEAD -- firestore.rules
```

```
npx firebase-tools deploy --only firestore:rules --project pickem-c0d06
```

The revert in step 1 already put the old `firestore.rules` back in your
working folder, so this deploys it.

**Do not do step 2 without step 1.** Removing the rule while the app is
still trying to write usage rows means every write is refused. Nothing
visible breaks, because those writes are silent by design, but it is
pointless noise.

## The rows already written

They stay. They are anonymous, they are a few kilobytes, and nothing
reads them unless you run the report. If you want them gone, tell me and
I will write a deletion script with a dry run, the same shape as
`remove_member.py`. There is no reason to do it in a hurry.

## Do not touch the worker

The worker is on the version you rolled back to on 27 September. v1.40.0
does not change it and this rollback does not either.

## Confirm it landed

1. `curl -s https://nflweeklypickem.com/sw.js | findstr VERSION` reads
   `const VERSION = 'v1.39.2';`
2. On your phone, after a cold start, Settings reads `v1.39.2`.
3. `python scripts\usage_report.py --season 2026 --days 1` reports no new
   sessions after the revert.

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

**`firebase-tools` says you are not logged in.** `npx firebase-tools
login` opens a browser. It is unrelated to your GitHub token and to
wrangler, which are three separate credentials for three separate
systems.
