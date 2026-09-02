# Rolling out to 20–25 people

`SETUP.md` builds it. `SCALE.md` is for hundreds. This is the specific
plan for your first real season with a couple dozen players.

---

## What 25 people changes (and doesn't)

**Doesn't:** you don't strictly need the snapshot layer. 25 players is
400 documents per Grid open — well inside the free tier and fast enough
on cellular. It can wait — and for now, "wait" means indefinitely: the
snapshot builder (`build_snapshot.py`) isn't wired to the client (the
Grid reads `picks/` directly, and always has — see that script's own
header) and its live-refresh piece doesn't exist yet either (see
SCALE.md Part 1's note at the top). Adopting it later is a real
migration, not a flag flip; SCALE.md walks through it when you're
actually past ~100 players.

**Does:** you can no longer walk everyone through installation in
person. The app has to do it. That's what the onboarding screens are
for.

---

# What people enter when they install

**One field: their name.** That's it.

Everything else is either captured silently or asked at the only moment
it can work.

| Thing | How |
|---|---|
| Name | The one question. Shown on the leaderboard. |
| Which pool | From the invite link — `?join=CODE`. Nobody types a code. |
| Timezone | `Intl.DateTimeFormat().resolvedOptions().timeZone`. Never asked. |
| Account | Anonymous auth behind the scenes, upgraded later. |
| Notifications | Screen 3, after Home Screen install. Never before. |

## Real names, not team names

Team names are fun in a 200-person office pool where you don't know
everybody. In a 25-person pool they're friction — you type something
clever once, then spend the season working out that "Gridiron Goblins"
is your brother-in-law. Real names make the leaderboard readable.

If you want the fun, add an optional team name later as a second line
under the real name. Don't make it the identity.

## Why notifications come last

**On iPhone, a notification request fails outright until the app is on
the Home Screen.** Worse, once someone declines, iOS makes it genuinely
hard to ask again — they have to dig through Settings.

So the order is fixed: name → install → alerts. Ask on screen one and
you'll lose a third of your players' notifications permanently, and
those are exactly the people who then miss kickoff and stop playing.

The install screen only appears for iPhone users who aren't already
installed. Android and desktop skip it.

---

# Accounts: the one real decision

The app uses **anonymous auth** — people are signed in the moment they
open the link, with no Google prompt, no password, nothing. Lowest
possible friction, which is what you want for 25 casual players.

**The catch:** an anonymous account lives in browser storage. New phone,
cleared data, or a long enough gap and iOS storage eviction, and their
uid is gone — along with their picks and their standing.

Over a five-month season that will happen to somebody.

**The fix is account linking.** Firebase can upgrade an anonymous
account to Google or Apple *while keeping the same uid*, so nothing is
lost:

```js
import { linkWithPopup, GoogleAuthProvider } from '.../firebase-auth.js';
await linkWithPopup(auth.currentUser, new GoogleAuthProvider());
```

Prompt for it **after they submit their first week**, not before — at
that point they have something worth protecting and the ask makes sense:

> *Save your account so you don't lose your picks if you change phones.*

Anyone who ignores it can be re-linked manually; you'll have 25 people,
not 25,000.

---

# The notification schedule

Five categories, each individually switchable in Settings → Alerts.
**Nobody is ever told about a game they've already picked.**

| Category | When | Example |
|---|---|---|
| Week opens | Tuesday, after the previous week finalises | "Week 4 is open. 16 games to pick." |
| Day before | 24 h before first kickoff | "Week 4 — 6 left." |
| Kickoff approaching | 90 min – 4 h before each slate | "3 unpicked. 2 hours until kickoff." |
| Last call | 10–75 min before each slate | "Last call — 3 games. Kickoff in 40 minutes." |
| Results | Sunday night, Tuesday final | "You finished 2nd with 94 points." |

Grouped per kickoff slot, so the whole 1:00 slate is one notification
rather than eight. Each person gets each tier once per slot, guaranteed
by a marker document.

**Quiet hours** are 22:00–07:00 in each person's own timezone — except
last call, which always goes through. That exception is deliberate: it's
the notification that actually saves someone's week.

---

# The two weeks before Week 1

## Two weeks out

1. Finish `SETUP.md` steps 1–10
2. Deploy `firestore.rules` and seed the roster document
3. Import the schedule, create the pool, set the join code
4. **Install it on your own phone and confirm the update banner works**
   by pushing a trivial change. If updates don't work you'll fight it
   all season.

## Ten days out — the soft test

Invite **three people who will tell you when something is broken.** Not
the whole 25.

Have them do the full install from the link, on their own phones,
without you standing there. Watch for:

- Did the iOS install screen make sense unaided?
- Did notifications actually arrive?
- Did anyone's name come out wrong or blank?

Then run `Actions → Live → dry_run = true` and read the log. It prints
every person, their timezone, and how many picks they owe.

## One week out — invite everyone

Text the link. Something like:

> Weekly NFL Pick’em is up for this season — 16 games a week, rank them 1 to 16
> by how confident you are. Free, no app store, works on the home screen
> like a normal app.
>
> **[link]**
>
> Takes about a minute. Add it to your Home Screen when it asks —
> notifications don't work on iPhone otherwise, and the reminders are
> the whole point.

Two things that matter in that message: **the link carries the join
code**, and **the Home Screen instruction is in the text**, not just in
the app. People skim.

## Week 1

- Live scores and reminders run on the `pickem-live` Cloudflare Worker
  now, not a GitHub Actions schedule — there is nothing to watch in the
  Actions tab on Thursday afternoon; that workflow is manual-only (see
  BUILD.md Part 9.4). Instead, `cd worker && wrangler tail -c
  wrangler-live.toml` while a game is live, or hit
  `https://YOURWORKER.workers.dev/__live/test?key=YOUR_ADMIN_KEY` once
  to confirm a real push lands.
- Check the roster document has 25 keys with `tokens` arrays. Anyone
  missing tokens gets no alerts and won't know why.
- After Monday night, verify standings against a manual count of one
  person's week. Once.

---

# What will actually go wrong

**Someone won't install to the Home Screen** and will wonder why they
get no reminders. Build a banner for iOS-not-installed users that says
so plainly.

**Someone will lose their account** by clearing Safari data. That's what
account linking is for; push the prompt.

**The live Worker will fail silently on a Sunday.** The Grid freezes, no
reminders go out, and nobody tells you because they assume it's their
phone. GitHub's workflow-failure emails won't catch this — the live path
is `worker/live.js` now, not an Actions job (that one only fires for the
Sunday/Monday/Tuesday `score_week.py` scoring run). Glance at `wrangler
tail -c wrangler-live.toml` or the Cloudflare dashboard's Worker logs on
Sunday morning instead.

**Somebody will rank two games the same number** if you ever write a
client that permits it. The scoring job catches it and scores that week
straight-up — check the log for `bad weights`.

---

# Don't do these in year one

- **Money.** Pooled entry fees turn a fun thing into an obligation and
  put you in the middle of every dispute.
- **Public leaderboards** beyond your invited group.
- **Mid-season rule changes.** Decide scoring mode, tiebreaker, and the
  rank convention before Week 1, and leave them alone. Changing the
  deadline in Week 6 costs you more goodwill than any feature buys.
