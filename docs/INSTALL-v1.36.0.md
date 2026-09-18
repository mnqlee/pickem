# Installing v1.36.0

**This release contains v1.35.0 as well.** v1.35.0 was packaged and
tested but never pushed, so everything in it is still here: the rebuilt
finished card, the WIN / LOSS pill, the centred `FINAL` head, the
narrow-side pool figure. On top of that, v1.36.0 adds the version card
in Settings.

One push covers both. Same three commands, **no wrangler**: Cloudflare
Pages is git-connected to `mnqlee/pickem`, so the push is the deploy.

Total time: about three minutes, most of it Cloudflare building.

---

## Part 1 · Put the files in place

**1.1** Download the zip and save it to your Downloads folder.

**1.2** Extract it **over** `C:\Users\ancon\Downloads\poolsheet`,
replacing files when Windows asks.

**1.3** Open a terminal there:

```
cd C:\Users\ancon\Downloads\poolsheet
```

**1.4** Check git agrees with you:

```
git status
```

You should see `index.html`, `sw.js`, `firebase-init.js`,
`DESIGN-DECISIONS.md`, files under `scripts/test/`, and new ones under
`docs/`.

> **If `git status` lists nothing**, the extract went to the wrong place.
> Find the folder with `index.html` in it and run from there.

---

## Part 2 · Deploy

**2.1** Stage everything:

```
git add -A
```

**2.2** Commit:

```
git commit -m "v1.36.0: version card in Settings, plus the v1.35.0 final card rebuild"
```

**2.3** Push. This is the deploy:

```
git push
```

**2.4** Watch it: <https://dash.cloudflare.com> → **Workers & Pages** →
**pickem** → the newest deployment. **Building** → **Success** in about
60 to 90 seconds.

---

## Part 3 · Confirm it is live

**3.1** In a browser **address bar**, not a search box:

```
https://nflweeklypickem.com/sw.js
```

Line 8 should read `const VERSION = 'v1.36.0';`. That is the deployed
file straight from Cloudflare, with no phone cache in the way.

**3.2** On your phone: pull to refresh twice, then **close the app from
the app switcher**, wait ten seconds, reopen.

**3.3** Open **Settings** and scroll to the bottom. Under First run
there is now a **Version** card reading `v1.36.0`, with a **Check for
update** button. Tap it. It should come back with *"Checked just now.
This is the newest version."*

**3.4** Open **Picks** on a finished week. Every card should carry the
centred `FINAL · CHI 59-37` head, the green or red pick line, and the
slanted WIN or LOSS pill. That is the v1.35.0 half.

**3.5** Then check a game that has **not** kicked off and one that is
**being played**. Both unchanged.

---

## What the version card is for

**Not "what version is this."** The question it answers is *"is this
phone on the new one"*, which came up on every deploy and was answered
by telling twenty eight people to swipe the app away and reopen.

- **The number comes from the service worker**, not from the page. The
  only version constant in the project is line 8 of `sw.js`, which is
  also the file whose change makes a phone fetch anything. A second
  constant in `index.html` would be a second line to remember, and the
  day it was missed the app would display the wrong version, which is
  worse than displaying none.
- **Check for update** asks the server. Three answers: this is the
  newest, a newer one is ready, or the check could not happen because
  you are offline or the app is not installed. A failed check says so
  rather than claiming you are up to date.
- **When one is ready**, the same button turns green and says **Update
  now**. It reloads once and you are on the new version, which is the
  end of the cold-start instruction.
- **An update also announces itself at the top of the Picks tab**, in
  the banner that was already there. A check started from Settings
  raises that banner too, so it is waiting where you will look next.
- **Opened in a browser tab on a first visit** there is no worker and no
  cache, so the card says `Not installed yet` and tells you to add it to
  the home screen. It never guesses.

### What to tell the pool

Nothing. It changes no behaviour for them. But when somebody says the
app is behaving oddly, "open Settings, scroll to the bottom, tap Check
for update" now replaces the whole swipe-and-reopen routine.

---

## Files in this release

| File | Why |
|---|---|
| `index.html` | the app: the version card, plus the v1.35.0 card rebuild |
| `sw.js` | version bumped to v1.36.0, and it answers when the page asks what it is |
| `firebase-init.js` | `swVersion` / `swCheck` / `swActivate`, the three platform calls the card uses |
| `DESIGN-DECISIONS.md` | sections 3f and 3h |
| `docs/INSTALL-v1.36.0.md` | this file |
| `docs/ROLLBACK-v1.36.0.md` | how to undo it |
| `docs/mockups/*` | the sheets every choice was made from, and screenshots of the real thing |
| `scripts/test/**` | the tests; they ship with the repo and never run in production |

**Nothing in `worker/`. No `.github/workflows/` change. No
`scripts/score_week.py` change. No wrangler, no secrets, no Firebase
console.**

---

## If something is wrong

`docs/ROLLBACK-v1.36.0.md` puts you back on v1.34.0 with one command,
and v1.34.0 is the version that came through Thursday night and has been
running since.
