# Rolling back v1.36.0

**Read this before you deploy, not after.**

```
cd C:\Users\ancon\Downloads\poolsheet
git revert --no-edit HEAD
git push
```

That is it. Cloudflare Pages rebuilds from the reverted commit, and
every phone is back on **v1.34.0** within a couple of minutes of a cold
start.

---

## What you land on, and why it is not v1.35.0

**v1.34.0.** v1.35.0 was packaged and tested but never pushed, so it was
never live anywhere. v1.36.0 carries it, which means one revert takes
out both the version card and the final-card rebuild and leaves you on
the version that has been running since Thursday night.

If you want the v1.35.0 half back without the version card, the zip for
it is still `pickem-v1.35.0.zip` and its own install notes are
`docs/INSTALL-v1.35.0.md`. You would be extracting that over the folder
and pushing again, not reverting to it.

---

## This one is safe to roll back

v1.36.0 changes **how a card is drawn** and **adds one read-only card to
Settings**. It touches no scoring code, no notification code, no
workflow, no Worker, and writes nothing to Firestore. A rollback cannot
leave anything half-done: there is no state to unwind, and no week that
got scored differently because of it.

The one thing worth knowing: `sw.js` gained a message handler that
answers when the page asks which version is running. Reverting removes
it, and the Settings card goes with it, so nothing is left asking a
question that will not be answered.

---

## Why revert and not reset

`git revert` makes a NEW commit that undoes the last one. `git reset
--hard` rewrites history, which means a force-push, which means
Cloudflare and GitHub can disagree about what the branch is, and it
throws the commit away, so going forward again means re-extracting the
zip. Revert keeps both versions and lets you re-apply with one more
command:

```
git revert --no-edit HEAD     # undoes the rollback, putting v1.36.0 back
```

---

## Confirm the rollback landed

1. <https://dash.cloudflare.com> → **Workers & Pages** → **pickem** →
   newest deployment reads **Success**.
2. In a browser **address bar**: `https://nflweeklypickem.com/sw.js`.
   Line 8 reads `const VERSION = 'v1.34.0';`.
3. On your phone: close the app from the app switcher, wait ten seconds,
   reopen. **Settings** has no Version card at the bottom, and a
   finished card on **Picks** has the kickoff time, network and spread
   back across the top with a solid green or red strip along the bottom.

---

## One thing to know about the service worker

A phone that has already cached v1.36.0 keeps serving it until its next
**cold start**. There is no way to reach into somebody's phone and
change that. If you need the pool off it now, tell them: swipe the app
away from the app switcher and reopen.

The irony is not lost: the card that would have made this easy is the
thing you just rolled back.

---

## If the push itself fails

A rejected push has not deployed anything, so you are still on whatever
was live.

**`rejected — non-fast-forward`.** Something else pushed to the branch:

```
git pull --rebase
git push
```

**Authentication failed.** Your token is the fine-grained PAT scoped to
`mnqlee/pickem`. **Do not paste it into this or any other chat.** If it
has expired, make a new one in GitHub with **Actions: Read and write**
and nothing else, and let Windows Credential Manager store it.
