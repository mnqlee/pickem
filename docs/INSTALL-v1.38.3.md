# Installing v1.38.3, every step in order

**This replaces the v1.38.0, v1.38.1 and v1.38.2 zips. Delete all three
so you cannot extract one by mistake.** v1.38.3 is the version that
matches the photo you sent: white writing, a thin white ring round the
selected badge, the city line faded slightly, and **the club's colour bar
back inside the badge**, which v1.38.2 wrongly took away.

**This is the only install note you need.** v1.38.3 carries everything
from v1.35.0, v1.36.0 and v1.37.0, none of which you pushed. One git
push and one wrangler deploy makes all of it live.

**What is in it, in one line each:**

- the rebuilt finished card (`FINAL · CAR 34-23` centred, the WIN / LOSS
  pill, the narrow-side pool figure)
- the Version card at the bottom of Settings, with **Check for update**
- reminders rebuilt around bunches of games, with your name on each one
- **white writing on every club**, a thin white ring round the badge on
  the team you took or the team that won, the city line **faded
  slightly**, and the club's second colour still barred across the
  bottom of **both** badges

**Two commands do it, and they are different systems:**

| half | command | why |
|---|---|---|
| the app | `git push` | Cloudflare Pages is git-connected to `mnqlee/pickem` |
| the reminder sender | `wrangler deploy -c wrangler-live.toml` | Workers never deploy from git |

**Do them in this order.** The Help tab describes the alerts the sender
sends, and a test compares those two files as a pair. App first, worker
second.

---

# PART 1 · Put the files in place

**1.1** Download **both** zips to your Downloads folder:

- `pickem-v1.38.3.zip`, the code and docs
- `pickem-v1.38.3-mockups.zip`, the rendered sheets

They are separate only because the images are large. Both extract into
the same place.

**1.2** Right-click `pickem-v1.38.3.zip` → **Extract All…**

**1.3** In the destination box, type exactly:

```
C:\Users\ancon\Downloads\poolsheet
```

**1.4** Click **Extract**. When Windows asks about existing files,
choose **Replace the files in the destination**.

**1.5** Do **1.2 through 1.4 again** for
`pickem-v1.38.3-mockups.zip`, into the same folder.

---

# PART 2 · Deploy the app

**2.1** Open a terminal (Windows Terminal, PowerShell or Git Bash) and
go to the folder:

```
cd C:\Users\ancon\Downloads\poolsheet
```

**2.2** Check git can see the new files:

```
git status
```

You should see `index.html`, `sw.js`, `firebase-init.js`,
`worker/live.js`, `DESIGN-DECISIONS.md`, files under `scripts/test/`,
and new files under `docs/`.

> **If `git status` says nothing to commit**, the extract went
> somewhere else. Find the folder that has `index.html` in it, `cd`
> there, and run `git status` again.

**2.3** Stage everything:

```
git add -A
```

**2.4** Commit:

```
git commit -m "v1.38.3: white card writing, badge ring, badge colour bar kept, reminders by bunch, version card, final card rebuild"
```

**2.5** Push. **This is the deploy.**

```
git push
```

**2.6** Watch it build: <https://dash.cloudflare.com> → **Workers &
Pages** → **pickem** → the newest deployment. It goes **Building** →
**Success** in about 60 to 90 seconds.

**2.7** Confirm the file that is actually live. In a browser **address
bar**, not a search box:

```
https://nflweeklypickem.com/sw.js
```

Line 8 must read:

```
const VERSION = 'v1.38.3';
```

If it still says `v1.34.0`, the build has not finished or the push did
not land. Do not go on to Part 3 until this line is right.

---

# PART 3 · Deploy the reminder sender

This is the only part that is not git. It is a Cloudflare Worker.

**3.1** From the same terminal:

```
cd C:\Users\ancon\Downloads\poolsheet\worker
```

**3.2** Deploy:

```
wrangler deploy -c wrangler-live.toml
```

**3.3** It prints the worker name, the uploaded size and a **Current
Version ID**. That is success.

> **If it says you are not logged in**, run `wrangler login`. It opens
> a browser. This has nothing to do with your GitHub token.
>
> **Do not paste the admin key or the service account JSON anywhere.**
> Nothing in this release needs either. No secrets to set, no KV to
> create, no Firebase console.

**3.4** Go back up:

```
cd ..
```

---

# PART 4 · Confirm it on your phone

**4.1** Open the app. Pull down to refresh twice.

**4.2** **Close the app from the app switcher** (swipe it away), wait
ten seconds, reopen. A service worker keeps serving the old app until
its next cold start; a refresh alone is often not enough.

**4.3** **Settings**, scroll to the bottom. The **Version** card reads:

```
v1.38.3
```

Tap **Check for update**. It should come back with *"Checked just now.
This is the newest version."* **This is your test from now on**, and that
card is why it exists.

**4.4** **Picks**, on a finished week. Zoom in on the winning side of a
card, the way you did with the Panthers. Four things, and this is the
list to check against your photo:

- every word is **white**: the city line, the team name, the score, the
  letters in the badge
- the badge has a **thin white ring** round it
- the city line above the team name is **slightly faded**, set back
  from the team name, not as loud as it, not washed out either
- the club's second colour is **still barred across the bottom of the
  badge**, on the selected side and the other one. On Carolina that bar
  is the dark navy. It stays. It is the club's colour, not writing, and
  it is what tells one badge from another at that size.

`docs/mockups/zoom-lit-CAR.png` in this zip is that exact card,
captured out of the app at four times phone density, so you can hold it
next to your photo.

**4.5** The **losing** badge has **no** ring, and keeps its colour bar.
The ring is the only thing that marks the side you took.

**4.6** Any finished card: `FINAL · CAR 34-23` centred across the top,
the pick line in green or red, the slanted **WIN** or **LOSS** pill.

**4.7** A game that has **not** kicked off, and one **being played**:
both unchanged. Kickoff time, network, spread, the stake bar, and on a
live one the pulsing clock with `IN PROGRESS`.

**4.8** **Help**, the alerts screen. The four examples read as bunches:

```
Thursday Night Football
Kicks off in 24 hours, Thu 8:20 PM. No team selected yet.

The early Sunday games
First kickoff in 18 hours, Sun 1:00 PM. 9 games unpicked.
```

**4.9** The real alerts arrive on their own schedule. The next one will
look like:

```
Lee, Thursday Night Football
Kicks off in 22 min. No team selected yet. Unselected games score 0.
```

---

# If something looks wrong

`docs/ROLLBACK-v1.38.3.md` has both halves of the undo. The short
version: `wrangler rollback -c wrangler-live.toml` in the `worker`
folder, then `git revert --no-edit HEAD` and `git push` in the main one.
That puts you back on v1.34.0, which is what has been running since
Thursday night.

---

# What changed, in detail

### The card writing, and the two corrections it took

**The text.** `onColor()` is deleted. It measured each club's primary
and returned near-black for the four too light for white text, so a
Bengals, Dolphins, Panthers or Chargers card printed its winning side in
black while the other twenty eight printed white. Three lines replace
it, and these are the three that are actually in the build:

```
.side.won{flex-grow:1.12;color:#fff}
.side.won .mark{box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.92)}
.side.won .city{opacity:.92}
```

**The ring is on the lit side only**, the team you took, or the team
that won once the game is final. It is what separates the badge from a
light panel, which is the one thing white text cannot do for itself.

**Correction one, the city line.** v1.38.0 put it at full white, which
made it as loud as the team name. The old value before that was 62%,
which is far too far the other way: white at 62% over Cincinnati orange
is 2.08:1, the worst text on any card. **92%** is the most fade that
keeps the worst club in the league at 3:1 or better, so it sits back
from the team name without going soft. The test asserts a window, 0.90
to 0.95, not the exact number, because either direction out of it is a
different decision.

**Correction two, the bar inside the badge, and this one was mine.**
`.mark::after` paints a 6px strip of the club's secondary colour across
the bottom of the badge. On Carolina that is `#101820`; on Atlanta,
Cincinnati and the Jets it is black. With every letter white, that bar
was the only dark thing left inside the colour block, so in v1.38.2 I
read *"no black writing anywhere"* as covering it and hid it on the
selected side. That was wrong, and you said so: it is the club's second
colour, not writing. **v1.38.3 has no such rule.** The bar is on both
badges, and the test that used to check it was gone now checks it is
there, and the mutation that hides it has to make the suite go red.

**What this costs, stated plainly.** On those four clubs the team name
sits at 3.37 to 4.28:1 instead of the 4.5:1 standard. The score line is
21px bold, which is large text at a 3:1 floor, so it passes everywhere.
Darkening the club colour 3 to 15 per cent would have cleared 4.5 and
you turned it down, which is the right call: it prints a colour that is
not the club's.

### The reminders

One alert per **bunch** of games instead of one per kickoff time. Five
bunches: Thursday Night Football, the early Sunday games, the late
Sunday games, Sunday Night Football, Monday Night Football. Sunday sends
one per tier instead of three, so a week you leave until Saturday
produces seven alerts instead of ten, and a week you pick on Wednesday
still produces none.

The two Sunday bunches count their own unpicked games:
`6 games unpicked`. A one-game bunch says `No team selected yet`,
because "1 of 1 unpicked" is a worse sentence.

I changed one thing you did not ask for: the Sunday bunches are **the
early Sunday games** and **the late Sunday games**, not morning and
afternoon. The early block is 1pm in New York and 2am in Japan, so
"morning" would be wrong for 27 of your 28 people.

### Files

| File | Which deploy |
|---|---|
| `index.html` | git |
| `sw.js` | git, and the version bump is what makes phones fetch |
| `firebase-init.js` | git |
| `worker/live.js` | **wrangler** |
| `DESIGN-DECISIONS.md`, `docs/**`, `scripts/test/**` | git, and none of it runs in production |

**No `.github/workflows/` change. No `scripts/score_week.py` change. No
secrets. No Firebase console.**

### Verified before shipping

1375 checks across nineteen suites, 0 failed. 55 mutations across 42
batches; the five that cover the card writing were each re-run and each
one is caught by the assertion named for it, including the inverted
batch 44, which hides the badge's colour bar and must be caught, and the
two new ones that whiten the unselected side and the pool label and must
also be caught. Audit 38 of 38. Both zips byte-verified against the
working tree, and every lit panel in the fixture audited pixel by pixel:
the bar present and painted from the club's own second colour, and city,
name, score and badge letters all white on all 32 clubs.

### One decision recorded in this release, with no code change

You were asked twice for no dark writing anywhere, so the four ways to
do that were drawn and measured before anything was built
(`docs/mockups/paper-ink-1-what-is-dark-390.png` and
`paper-ink-2-options-390.png`). Your answer was that the dark writing is
right before a side is selected and white is what selection looks like,
which is what the app already does, so **nothing in `index.html`
changed for it.** What did change is that the decision is now guarded:
regress case 61 fails if an unselected side or a paper band goes white,
and two mutations exist that make exactly that mistake so the guard has
to catch them. The one thing still offered and not done is the gutter
`@`, which measures 3.77:1 against a 4.5:1 floor on every card in the
app; one line moves it to 5.30:1 and it looks identical.
