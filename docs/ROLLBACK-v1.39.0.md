# Rolling back v1.39.0

**Read this before you deploy, not after.**

Two halves, two different commands. **Roll back the worker first**, the
reverse of the install order.

You land on **v1.38.3**, which is what you are running today.

---

## 1 · The live worker (the daily spreads)

```
cd C:\Users\ancon\Downloads\poolsheet\worker
wrangler rollback -c wrangler-live.toml
cd ..
```

`wrangler rollback` moves the worker to its previous version. It asks
you to confirm and prints which version it is going back to. If it
cannot find one, or you would rather be explicit:

```
wrangler deployments list -c wrangler-live.toml
wrangler rollback <version-id> -c wrangler-live.toml
```

**What this restores.** The spreads go back to refreshing only on a
scoring run, so the number on a Saturday card is Tuesday's again. Scores
and the live clock are untouched either way; they were never part of
this change.

---

## 2 · The app (the football)

```
cd C:\Users\ancon\Downloads\poolsheet
git revert --no-edit HEAD
git push
```

Cloudflare Pages rebuilds from the reverted commit and every phone is
back on **v1.38.3** within a couple of minutes of a cold start.

---

## Rolling back only one half

Unlike v1.38.3, **either half rolls back cleanly on its own.** The
football is drawn entirely by the app from data the app fetches itself,
and the spread refresh lives entirely in the worker. Nothing in the app
describes the refresh and nothing in the worker knows about the
football, so there is no Help-tab contradiction to worry about this
time.

**Only the football, keeping the daily spreads:** do step 2 alone.

**Only the daily spreads, keeping the football:** do step 1 alone.

---

## This is safe to roll back

Neither half touches scoring, picks, the roster, reminders, sign-in or a
workflow.

**The worker half writes one field.** `pullLines()` only ever patches
`spread` on games that already exist. Rolling it back leaves whatever
line was last written in place; it does not revert the numbers, and it
does not need to. The next scoring run writes them again from the same
source.

**The KV key it leaves behind** is `lines:day`, holding a date string.
After a rollback nothing reads it. It costs nothing and you can leave
it. If you want it gone, it expires on its own the moment nothing writes
it; there is no cleanup step.

**The app half adds no state.** `ESPN_BALL` lives in memory for as long
as the tab is open and is gone when the app closes. Nothing was written
to Firestore, nothing cached, nothing stored on the phone. A rollback
removes the football and leaves no trace of it.

---

## Confirm it landed

1. `wrangler deployments list -c wrangler-live.toml` shows the older
   version as current.
2. The Worker's own URL, the `pickem-live....workers.dev` one that
   `wrangler deploy` prints, with `/__live/lines?key=` and your admin
   key on the end, typed in the **address bar**, answers **404**. That
   endpoint only exists in v1.39.0, so its absence is the cleanest proof
   the worker rolled back. `wrangler tail -c wrangler-live.toml` showing
   no `lines:` line at midnight UTC is the same proof without a key.
3. <https://dash.cloudflare.com> then **Workers & Pages** then
   **pickem** then the newest deployment reads **Success**.
4. In a browser **address bar**: `https://nflweeklypickem.com/sw.js`
   reads `const VERSION = 'v1.38.3';`.
5. On your phone, after a cold start: **Settings** shows `v1.38.3` at
   the bottom, and a game in progress has **no football** beside either
   score. Everything else on the card is unchanged, because v1.39.0
   changed nothing else.

---

## If the push itself fails

A rejected push has not deployed anything, so you are still on whatever
was live.

**`rejected, non-fast-forward`.** Something else pushed to the branch:

```
git pull --rebase
git push
```

**Authentication failed.** Your token is the fine-grained PAT scoped to
`mnqlee/pickem`. **Do not paste it into this or any other chat.** If it
has expired, make a new one in GitHub with **Actions: Read and write**
and nothing else, and let Windows Credential Manager store it.

**wrangler says it is not logged in.** `wrangler login` opens a browser
and does not need the GitHub token at all. Workers and Pages are
separate deploy paths; nothing about the git push affects this half.
