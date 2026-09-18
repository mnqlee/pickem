# Installing v1.37.0

**Two deploys this time, and they are different commands.**

| what | how | why |
|---|---|---|
| the app | `git push` | Cloudflare Pages is git-connected |
| the reminder sender | `wrangler deploy -c wrangler-live.toml` | Workers never deploy from git |

**This release also carries v1.35.0 and v1.36.0**, neither of which you
pushed. So one git push covers the rebuilt finished card, the version
card in Settings, and the new reminder wording, and one wrangler deploy
covers the sender.

Do the git push **first**. The Help tab's alert preview and the sender
have to say the same thing, and a test compares the two files precisely
so they cannot drift. If the worker goes first, there is a window where
the app is describing alerts it is not yet sending.

---

## Part 1 · The app

**1.1** Extract the zip **over** `C:\Users\ancon\Downloads\poolsheet`,
replacing files when Windows asks.

**1.2**

```
cd C:\Users\ancon\Downloads\poolsheet
git status
```

You should see `index.html`, `sw.js`, `firebase-init.js`,
`worker/live.js`, `DESIGN-DECISIONS.md`, files under `scripts/test/`,
and new ones under `docs/`.

**1.3**

```
git add -A
git commit -m "v1.37.0: reminders by bunch, version card, final card rebuild"
git push
```

**1.4** <https://dash.cloudflare.com> → **Workers & Pages** → **pickem**
→ newest deployment goes **Building** → **Success** in about 60 to 90
seconds.

**1.5** In a browser **address bar**, not a search box:

```
https://nflweeklypickem.com/sw.js
```

Line 8 should read `const VERSION = 'v1.37.0';`.

---

## Part 2 · The reminder sender

**2.1**

```
cd C:\Users\ancon\Downloads\poolsheet\worker
wrangler deploy -c wrangler-live.toml
cd ..
```

**2.2** It prints the worker name and a version id when it succeeds. No
secrets to set: `SA_JSON` and `ADMIN_KEY` are already there and this
release does not touch them.

> **Do not paste the admin key into this or any chat.** If you need to
> test a push, put the URL in the **address bar**.

**2.3** Nothing else. No KV to create, no new bindings, no Firebase
console.

---

## Part 3 · Confirm it

**3.1** On your phone: pull to refresh twice, then close the app from
the app switcher, wait ten seconds, reopen.

**3.2** **Settings**, scroll to the bottom. The **Version** card reads
`v1.37.0`. Tap **Check for update**: *"Checked just now. This is the
newest version."*

**3.3** **Help**, the alerts screen. The four example alerts now read as
bunches:

```
Thursday Night Football
Kicks off in 24 hours, Thu 8:20 PM. No team selected yet.

The early Sunday games
First kickoff in 18 hours, Sun 1:00 PM. 9 games unpicked.
```

**3.4** The real alerts arrive on their own schedule. The next one you
should see is the Thursday bunch, and it will read:

```
Lee, Thursday Night Football
Kicks off in 22 min. No team selected yet. Unselected games score 0.
```

---

## What changed in the reminders

**The unit is a bunch of games, not a kickoff time.** Five bunches a
week: Thursday Night Football, the early Sunday games, the late Sunday
games, Sunday Night Football, Monday Night Football. Each is on its own
schedule and counts its own unpicked games.

**Sunday sends one alert per tier instead of three.** It used to send
one per kickoff time, each naming a different clock reading and counting
only the games locking at that moment. A week where you pick nothing
until Saturday now produces seven alerts across the whole week instead
of ten, and a week you pick on Wednesday still produces none.

**Your name is on every alert.** You asked for it, and it also fixes
something real: two accounts on one phone used to produce two identical
notifications with no way to tell which was which.

**The wording is yours.**

| bunch | what it says |
|---|---|
| one game | `Kicks off in 22 min. No team selected yet. Unselected games score 0.` |
| several | `First kickoff in 3 hours. 6 games unpicked. Unselected games score 0.` |

- `Unselected games score 0.` appears from a few hours out. Two days
  before kickoff it is a warning about a hypothetical, and it was what
  pushed the message onto a third line, which iOS hides behind a
  pull-down.
- Two days out gives the clock (`First kickoff Sun 2:00 AM`) rather than
  a countdown in hours, because nobody thinks in 44 hours.
- No dashes anywhere. A full stop where one joined two clauses, a comma
  where it joined a countdown to a clock reading.

**One change I made on my own, and you should know about it.** The
mockup called the two Sunday bunches *morning* and *afternoon*. That is
wrong for almost everybody: the early block is 1pm in New York and 2am
in Japan, and neither is morning. They are **the early Sunday games**
and **the late Sunday games**, which is true in every timezone because
it describes the order rather than the hour.

**The bunch is named in Eastern time, the clock is shown in yours.**
"Thursday Night Football" is a fact about the NFL's schedule. In Iwakuni
it kicks off Friday morning, and your Picks tab already labels that card
FRIDAY. If the bunch were named from each reader's own zone, the same
game would be Thursday night for the pool and Friday morning for you,
and the alert would disagree with the schedule everybody talks about.

---

## Files in this release

| File | Why |
|---|---|
| `worker/live.js` | the slate table, and compose() rewritten. **This is the wrangler half.** |
| `index.html` | the Help tab's alert preview, the version card, the v1.35.0 card rebuild |
| `sw.js` | version bumped to v1.37.0 |
| `firebase-init.js` | the three service-worker calls the version card uses |
| `DESIGN-DECISIONS.md` | sections 3f, 3h and 4e |
| `docs/INSTALL-v1.37.0.md` | this file |
| `docs/ROLLBACK-v1.37.0.md` | how to undo both halves |
| `docs/mockups/*` | every sheet these choices were made from |
| `scripts/test/**` | the tests, including the new `reminder-send.test.mjs` |

**No `.github/workflows/` change. No `scripts/score_week.py` change. No
secrets, no Firebase console.**

---

## Still open, waiting on you

The all-white card writing and the thin white ring round the badge.
Sheets are `docs/mockups/white-ink-1-teams-390.png` and
`white-ink-2-ring-390.png`; nothing from them is built yet.
