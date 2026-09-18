# Rolling back v1.35.0

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

## This one is unusually safe to roll back

v1.35.0 changes **how a finished card is drawn** and nothing else. It
touches no scoring code, no notification code, no workflow, no Worker,
and writes nothing to Firestore. So a rollback cannot leave anything
half-done: there is no state to unwind, and no week that got scored
differently because of it.

That is not true of every release, and it is why this one is worth
shipping on its own rather than bundled with anything.

---

## Why revert and not reset

`git revert` makes a NEW commit that undoes the last one. `git reset
--hard` rewrites history, which means a force-push, which means
Cloudflare and GitHub can disagree about what the branch is — and it
throws the commit away, so going forward again means re-extracting the
zip. Revert keeps both versions and lets you re-apply with one more
command:

```
git revert --no-edit HEAD     # undoes the rollback, putting v1.35.0 back
```

---

## Confirm the rollback landed

1. <https://dash.cloudflare.com> → **Workers & Pages** → **pickem** →
   newest deployment reads **Success**.
2. In a browser **address bar**: `https://nflweeklypickem.com/sw.js`.
   Line 8 reads `const VERSION = 'v1.34.0';`.
3. On your phone: close the app from the app switcher, wait ten seconds,
   reopen. Open **Picks** on a finished week. A final card has the
   **kickoff time, network and spread back across the top**, and a
   **solid green or red strip along the bottom**. That is the quickest
   visual confirmation — the app does not print its version on screen.

---

## One thing to know about the service worker

A phone that has already cached v1.35.0 keeps serving it until its next
**cold start**. There is no way to reach into somebody's phone and
change that. If you need the pool off it now, tell them: swipe the app
away from the app switcher and reopen. That is the whole procedure.

---

## Rolling back only part of it

You almost certainly do not want this — a partial state is harder to
reason about than either whole version — but the app is one file, so:

```
git checkout HEAD~1 -- index.html sw.js
git commit -m "revert the card to v1.34.0"
git push
```

Be aware this leaves `DESIGN-DECISIONS.md` and the test suite describing
a card the app no longer draws, so the next person to read either will
be misled, and `picks-audit.mjs` will fail. Prefer the full revert.

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

---

## The version you are rolling back to

**v1.34.0** — the version that came through Thursday night. Its finished
cards carry the kickoff time, network and spread across the top and a
filled green or red strip along the bottom. Its install notes are
`docs/INSTALL-v1.34.0.md`.
