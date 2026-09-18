# Rolling back v1.38.3

**Read this before you deploy, not after.**

There are two halves and they roll back with two different commands.
**Roll back the worker first**, the reverse of the install order: the
Help tab describes the alerts the sender sends, so if the app goes back
first there is a window where it is describing alerts that are still
arriving in the new shape.

---

## 1 · The reminder sender

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

**What this restores.** Reminders go back to one per kickoff time, so
Sunday sends three per tier again, with the titles that read
`1 pick due Fri 9:15 AM` over a week total. That is the wording you
reported, so rolling this half back on its own is only worth doing if
the new sender is misbehaving, not because you dislike the words.

---

## 2 · The app

```
cd C:\Users\ancon\Downloads\poolsheet
git revert --no-edit HEAD
git push
```

Cloudflare Pages rebuilds from the reverted commit and every phone is
back on **v1.34.0** within a couple of minutes of a cold start.

---

## What you land on, and why it is v1.34.0

v1.35.0, v1.36.0 and v1.37.0 were all packaged and tested but never
pushed, so none of them was ever live, and nor were v1.38.0, v1.38.1 or
v1.38.2. v1.38.3 carries the lot, which means one revert takes out:

- the white card writing and the badge ring
- the reminder wording (the app half, the Help tab preview)
- the version card in Settings
- the rebuilt finished card

and leaves you on the version that has been running since Thursday
night.

If you want any one of those back without the others, its own zip and
install notes still exist: `pickem-v1.35.0.zip`, `pickem-v1.36.0.zip` and `pickem-v1.37.0.zip`,
each with its own `docs/INSTALL-*.md`. That is a re-extract and a push,
not a revert.

---

## Rolling back only one half

**Only the reminder wording, keeping everything else:**

```
cd worker
wrangler rollback -c wrangler-live.toml
cd ..
git checkout HEAD~1 -- index.html
git commit -m "revert the alert preview to match the rolled-back sender"
git push
```

Be aware this leaves `sw.js` on v1.38.3 while `index.html` is older,
which is untidy but harmless: the version card reports the worker's
number, and the worker is the thing that changed. Regress case 24 will
fail until both files agree again.

**Only the app, keeping the new sender:** do not. The Help tab would
promise the old alert wording while the new alerts arrive, which is
exactly the contradiction case 24 exists to prevent.

---

## This is safe to roll back

Neither half touches scoring, writes to Firestore, or changes a
workflow. The sender only reads: games, the roster, and picks. The KV
dedupe keys changed shape (they name the bunch now instead of a
timestamp), so immediately after either rollback a member could receive
one duplicate alert for a bunch they had already been reminded about,
because the old key and the new key are different strings. It expires
within three days and it is one notification, not a repeat every five
minutes.

---

## Confirm it landed

1. `wrangler deployments list -c wrangler-live.toml` shows the older
   version as current.
2. <https://dash.cloudflare.com> → **Workers & Pages** → **pickem** →
   newest deployment reads **Success**.
3. In a browser **address bar**: `https://nflweeklypickem.com/sw.js`
   reads `const VERSION = 'v1.34.0';`.
4. On your phone, after a cold start: **Settings** has no Version card;
   a finished card on **Picks** has the kickoff time, network and spread
   back across the top; and a Bengals, Dolphins, Panthers or Chargers
   card has **black writing** on its winning side again, with **no white
   ring** round the badge. The club's colour bar inside the badge looks
   the same either way, since v1.38.3 leaves it alone, so the ring and
   the black writing are the two things to look for. That is the
   quickest visual check.

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
