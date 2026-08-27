# Preseason shakedown — this weekend

Four days. The full stack in `BUILD.md` is not a four-day job, and
trying it is how you end up with nothing working on Saturday.

**So cut scope hard.** Everything below gets you a real, live, scoring
pool this weekend with five people. The rest lands before Week 1.

---

## Architecture decision, made

You have the time, so do it the good way. **Two changes from `BUILD.md`:**

**1. Live loop runs on Cloudflare Cron, not GitHub Actions.**
`worker/live.js` polls scores every minute and sends reminders every
five, on time. GitHub's scheduler routinely fires 10-20 minutes late,
which is tolerable for scores and genuinely bad for a "last call, 30
minutes out" notification arriving at 12 minutes out.

**2. No snapshot layer.** Snapshots exist so 300 people don't each read
4,800 documents. At 25 people that's 400 documents, which Firestore
serves instantly and free. Dropping it removes a whole job *and* makes
the app faster:

```
with snapshots     scores -> games -> snapshot job -> docs -> phones
                   (5 min, late)      (5 min, late)     ~45 min worst case

without            scores -> games -> phones (onSnapshot)
                   (1 min, on time)   instant          ~60 sec worst case
```

Clients read picks directly, with the `revealAt` rule keeping other
people's sealed until kickoff. That was the original design; snapshots
were the scale answer. Add them back if you pass ~100 players.

**Neither change affects the countdown or the lock.** Kickoff times are
written once at import. The countdown is computed in the browser. The
lock is a Firestore rule against Google's server clock. No scheduled job
touches any of it.

## Cut for this weekend

You said you want the full experience: link, name, email, PIN, the
walkthrough. That changes what can be cut.

| | Verdict |
|---|---|
| Custom domain | **KEEP.** See below — it is the unlock. |
| Email PIN + auth Worker | **KEEP.** It is the experience you asked for. |
| Snapshots | Cut. Not needed under ~100 players. |
| Apple / Google sign-in | Cut. PIN covers everyone. |

### The domain is not optional if you want the PIN flow

I previously told you to skip it and use `pages.dev` with anonymous
sign-in. That was the right call for a bare-bones test and the **wrong**
call for what you actually want. Two hard blockers:

1. **Resend will not send to arbitrary addresses** without a verified
   sending domain. On the free sandbox you can only email yourself, so
   your testers never receive a code.
2. **The 90-day session cookie has to be first-party.** A Worker on
   `workers.dev` talking to a page on `pages.dev` is cross-origin, and
   Safari drops that cookie. People would get signed out mid-test.

A domain is $10-15 and DNS is the only wait. Buy it first, tonight,
and let it propagate while you do Firebase.

## Keep — these are what you're testing

- Real preseason schedule with real kickoff times
- Picks writing to Firestore
- **The kickoff lock**
- The Grid revealing at kickoff
- Live scores during games
- Push notifications
- Scoring after the games

---

# Day by day

## Tonight — buy the domain first

Everything else can happen while DNS propagates.

1. Cloudflare Registrar, buy it, nameservers point to Cloudflare
2. `BUILD.md` Parts 1, 2, 7.1 — repo, Firebase project, Firestore rules
3. Cloudflare Pages, connect the repo, deploy, attach the apex domain
4. Resend: add the domain, paste the SPF/DKIM/DMARC records

**Stop when the app loads at your own domain and Resend says verified.**

## Wednesday — real data

Preseason is `seasontype=1` at ESPN, so the importer needs the flag:

```bash
python scripts/import_schedule.py --season 2026 --preseason --dry-run
python scripts/import_schedule.py --season 2026 --preseason
```

Check `seasons/2026/games` in Firestore. **Spot-check one kickoff
against the real schedule** — a timezone mistake here makes every lock
in the app wrong, and it is the single most damaging thing that can go
undetected.

Then `BUILD.md` Part 10: `DEMO = false` and wire

- `PS.getWeek(n)` for the slate
- `PS.myPicks(wk)` / `PS.savePicks(...)` for picks
- `PS.watchRevealed(wk, cb)` for the Grid — the small-pool path, not
  snapshots

**Wire the PIN screens for real.** They are already built; four fetch
calls replace the demo stubs, all marked `/* Real app: */` in
`index.html`:

| Stub | Replace with |
|---|---|
| screen 1 `go()` | `POST /api/request-code` |
| screen 2 `go()` | `POST /api/verify-code` → `signInWithCustomToken` |
| resend button | `POST /api/request-code` again |
| sign out | `POST /api/logout` + `PS.signOut()` |

Then on launch, before rendering: `GET /api/session`. If it returns a
token, sign in silently and skip onboarding entirely. That is what makes
it feel like an app rather than a website.

## Thursday — the Worker, then the important test

Deploy the live Worker before testing notifications:

```bash
cd worker
wrangler kv namespace create SESSIONS      # if you have not already
# paste the id into wrangler-live.toml, set GCP_PROJECT and SEASON
wrangler secret put SA_JSON -c wrangler-live.toml
wrangler deploy -c wrangler-live.toml
```

Test both jobs by hand before trusting the cron:

```bash
curl https://pickem-live.YOURNAME.workers.dev/__live/scores
curl https://pickem-live.YOURNAME.workers.dev/__live/remind   # dry run
```

`/__live/remind` prints who *would* be notified without sending. Watch
it live with `wrangler tail -c wrangler-live.toml`.

Then disable the GitHub `Live` workflow — the Worker has taken over.
Keep `Score the week`; it still handles badges and final standings.

## Thursday — the important test

1. Secrets: `FIREBASE_SERVICE_ACCOUNT`, variable `SEASON`
2. VAPID key, `firebase-messaging-sw.js` (Part 9.2)
3. **On your own phone, in this order:** open in Safari, sign in, Add to
   Home Screen, open from the icon, turn on alerts, make picks,
   force-quit, reopen, confirm the picks are still there
4. Actions → **Live** → dry run. Read the log.
5. `bash scripts/check.sh`

**Then set a kickoff two minutes out in Firestore and watch a pick get
rejected.** That is the one behavior the whole thing rests on, and it is
much easier to test now than to discover broken on Sunday.

## Friday — invite

Five people, not fifteen. Pick ones who will tell you plainly when
something is broken.

> Testing a pick 'em app on the last preseason weekend before we run it
> for real. Takes a minute:
>
> **https://pickem-xxx.pages.dev/?join=CODE**
>
> **Add it to your Home Screen when it asks** — notifications don't work
> on iPhone otherwise. Text me anything that looks wrong, however small.

Then check the roster document actually has five entries with
`tokens` arrays. **Anyone missing a token gets no alerts and will not
know why.**

## Saturday and Sunday — watch, don't fix

Leave the code alone unless it is completely broken. Take notes.

- Did reminders arrive, on time, to everyone?
- Did the Grid fill in as games kicked off?
- Did anyone get locked out who shouldn't have been?
- Did scores update during games?
- Did anyone lose their picks?

**Watch the Actions tab Saturday afternoon.** A failed `Live` run means
a frozen Grid and no reminders, and nobody will report it — they will
assume their phone is slow.

## Monday — the list

Everything they reported, in one place. Fix in this order: **anything
that lost picks or blocked a pick > notifications > scoring > cosmetics.**

Then start on the domain, PIN auth, and snapshots with two clear weeks
before Week 1.

---

# Known preseason quirks

**Fewer games, and it varies.** Preseason weeks run about 16 games but
not always. The app now takes its rank ceiling from the actual slate, so
a 13-game week ranks 1–13 and pays 13 down to 1. **Confirm the tray
shows the right number of stamps** when you first open it.

**Starters play a quarter.** Picks are close to coin flips, which is
fine — you are testing plumbing, not football.

**Games move.** Preseason times shift more than regular season.
Re-running the importer updates kickoffs without wiping scores.

**Odds are thin.** Many preseason games are never priced. The card will
show *line TBD*, which is correct behavior, not a bug.

---

# What will go wrong

| Likely | What it looks like |
|---|---|
| Somebody doesn't install to Home Screen | No notifications, and they blame the app |
| Kickoff times imported wrong | Games lock at the wrong moment. **Check on Wednesday.** |
| A `Live` run fails silently | Frozen Grid all afternoon |
| Someone clears Safari data | Anonymous account gone, picks gone. Expected — it's why PIN auth is next. |
| ESPN preseason feed differs | Import returns nothing. Fall back to `--csv`; it's one evening. |

---

# The one thing not to skip

**Test the kickoff lock on Wednesday**, with a real timestamp, on a real
phone, against the real security rule.

Everything else in this app degrades gracefully. A late-pick bug does
not — it silently invalidates the entire competition, and you will not
find out until somebody wins a week they should not have.

---

# Keeping preseason out of the real season

**Do not plan to delete things later.** Run preseason as its own pool on
its own season id, and the regular season never shares a document with
it. There is nothing to unwind, because nothing was ever mixed.

```
seasons/2026PRE/games/*     preseason schedule
pools/{preId}               season = "2026PRE"   <- disposable

seasons/2026/games/*        regular schedule
pools/{realId}              season = "2026"      <- untouched
```

Picks, standings, badges, week wins and the roster all live under
`pools/{id}/`. Separate pool means separate everything.

## Set it up

```bash
python scripts/setup_preseason.py --season 2026
```

Prints a pool id and a join code. Then:

```bash
python scripts/import_schedule.py --season 2026 --preseason
```

That writes into `seasons/2026PRE/games` — the `--preseason` flag
switches both the ESPN season type *and* the destination.

Finally set `SEASON = '2026PRE'` in `index.html` and `firebase-init.js`
and deploy. The header shows an amber **PRE** badge next to CONF so
nobody wonders later why their stats vanished, and the week strip drops
to three weeks because it now reads the actual data instead of assuming
eighteen.

## Tear it down

**Always dry run first.**

```bash
python scripts/reset_pool.py --pool POOLID --season 2026PRE --dry-run
python scripts/reset_pool.py --pool POOLID --season 2026PRE --yes
```

Firestore does **not** cascade deletes. Removing a pool document leaves
every subcollection behind as orphaned data that still counts against
quota and still answers queries. `reset_pool.py` walks them properly:
picks, tiebreaks, standings, members, private, reminders, snapshots,
config, then the games, then the pool.

Three guards, because this script deletes things:

1. Refuses any pool without `disposable: true`. Only
   `setup_preseason.py` sets that, so pasting the wrong id does nothing.
2. Refuses a season id not ending in `PRE`.
3. `--dry-run` prints counts and deletes nothing.

`--force` overrides the first two. You should never need it.

## Then the real season

```bash
python scripts/import_schedule.py --season 2026        # no --preseason
```

Create the real pool (BUILD.md 7.3), set `SEASON = '2026'`, deploy, and
send the new join link. **Everyone has to tap the new link** — the join
code is what binds a person to a pool, and it changed.

Say that plainly in the message, because otherwise a few people will
open the old icon, see an empty week, and assume it broke.

## An option worth considering

You do not have to delete it at all. Leaving the preseason pool in place
costs nothing, and it makes a useful reference — real picks, real
timings, real notification logs from the weekend everything was new. If
you hit a strange bug in Week 3, having a known-good week to compare
against is worth more than the storage.

Delete it at the end of the season if you want it gone.

---

# The Archive tab

You do not have to choose between keeping the preseason results and
having a clean season. Flatten the pool into one document, delete the
pool, and show the record in its own tab that you can hide later.

## Before you tear down

```bash
python scripts/archive_pool.py --from PREPOOLID --to REALPOOLID \
    --label "Preseason 2026" \
    --note "Three weeks, five players. Kept as a reference."
```

Reads the final standings and weekly winners, writes them as **one
document** at `pools/{real}/archive/preseason-2026`. Because it lives in
the *real* pool, `reset_pool.py` can then wipe the preseason pool
entirely and the record survives.

## Making it disappear

Three states, plus permanent deletion.

| Command | Who sees the tab |
|---|---|
| `--show` | everyone |
| `--hide` | you only, marked **Hidden from everyone else** |
| `--off` | **nobody, including you.** Tab does not exist. |
| `--remove` | nobody, and the record is deleted for good |

```bash
# tab gone completely once the real season starts
python scripts/archive_pool.py --to REALPOOLID --id preseason-2026 --off
```

`--off` keeps the data — the scripts can still read it, so you can bring
it back with `--show` any time. `--remove` deletes the document.

The security rule enforces all of it, rather than the app hiding a
button:

```
allow read: if isMember(poolId) && (
  resource.data.state == 'public' ||
  (resource.data.state == 'owner' && isOwner(poolId))
);
```

At `off` **nobody can read the document**, so the client never receives
it and the tab genuinely does not render. It is not a hidden element
somebody could reveal in dev tools.

One edge case handled: if somebody happens to be standing on the Archive
tab at the moment you switch it off, they get moved back to Picks rather
than left staring at an empty screen.

## What the tab shows

Final standings with the badges people earned, a **Champion** tag on the
winner, the week-by-week list, and a line making clear the pool is
closed and none of it counts toward the current season.

## One layout note

Six tabs do not fit on a phone — they come to about 402px against 362px
of room. The tab strip now scrolls sideways. With the archive hidden you
are back to five tabs, which fit without scrolling, so most of the
season it behaves exactly as before.

---

# Does everything clear for the real season?

**Server side: completely.** Nothing to clear, because nothing was
shared.

| | Preseason | Real season |
|---|---|---|
| Games | `seasons/2026PRE/games` | `seasons/2026/games` |
| Picks, ranks, tiebreaks | `pools/{preId}/…` | `pools/{realId}/…` |
| Standings, badges, week wins | `pools/{preId}/standings` | `pools/{realId}/standings` |
| Roster, push tokens | `pools/{preId}/private` | `pools/{realId}/private` |

The Grid, Standings and Picks tabs all read from the pool you are in. A
new pool is a blank sheet by construction: zero points, no badges, no
week winners, no pick history. There is no reset step to remember and no
chance of a stray preseason document scoring somebody a point in Week 1.

`reset_pool.py` then deletes the preseason pool outright. Firestore does
not cascade, so it walks all nine subcollections — picks, tiebreaks,
standings, members, private, reminders, snapshots, config, archive —
then the games, then the pool document.

## Two things that do NOT clear themselves

Both are on the phone, not the server, and **neither throws an error**.
They just quietly stop working.

**A stale pool id.** `localStorage.ps_pool` still points at the deleted
preseason pool for anyone who does not tap the new invite link. Every
read fails and they see an empty app.

`ensureCurrentPool()` handles it: on launch it checks the stored pool
still exists and its season matches, and clears it if not, dropping them
on the join screen. Call it before rendering anything.

**Push tokens.** Tokens live on the roster, which is per pool. Join a
new pool and your token is not there, so you get no reminders — and
because onboarding is skipped for anyone who already granted permission,
nothing ever re-registers it.

`refreshPushToken()` fixes it: if permission is already granted it
re-registers the token into the current pool on every launch. **Call it
after sign-in, every time.** Miss this and half your pool silently stops
getting kickoff reminders in Week 1.

## Handover checklist

```bash
# 1. keep the record before deleting anything
python scripts/archive_pool.py --from PREID --to REALID --label "Preseason 2026"

# 2. real schedule
python scripts/import_schedule.py --season 2026

# 3. real pool (BUILD.md 7.3), then set SEASON = '2026' and deploy

# 4. check, then wipe
python scripts/reset_pool.py --pool PREID --season 2026PRE --dry-run
python scripts/reset_pool.py --pool PREID --season 2026PRE --yes

# 5. hide the archive tab if you want it gone
python scripts/archive_pool.py --to REALID --id preseason-2026 --off
```

Then send the **new join link**. Everyone has to tap it — the join code
is what binds a person to a pool, and it changed. Say so plainly in the
message.

## Verify before Week 1 opens

- Open the app yourself: standings empty, no badges, Grid sealed
- Check `pools/{realId}/private/roster` has an entry with a `tokens`
  array for every person
- `Actions → Live → dry_run` and read the log: it prints everyone and
  what they are missing

That roster check is the one that matters. **A missing token is
invisible from the outside** — that person just never hears from the app
again and assumes it is broken.

---

# Making the push-token gap impossible

"Remember to call `refreshPushToken()`" is not a fix. Four layers, so
nobody has to remember anything.

## 1. It cannot be forgotten

Everything that must happen on sign-in now lives inside `watchAuth()`
itself, not in a checklist the app is expected to follow:

```js
onAuthStateChanged(auth, async u => {
  if (u) {
    const pool = await ensureCurrentPool();   // clear a stale pool id
    if (pool) {
      await ensureMember();
      await upsertRoster();                   // name + timezone
      await refreshPushToken();               // re-arm alerts for THIS pool
    }
  }
  cb(u);
});
```

There is no separate call to omit. Sign in and you are registered.

## 2. The app says so itself

`alertsHealthy()` checks on every render whether this device actually
has a working registration in the pool it is currently in. If not, an
amber banner sits at the top of Picks:

> **Kickoff reminders are off**
> This device is not registered with the pool yet. You will not be
> warned before games lock.  **[ TURN ON ]**

One tap repairs it. Four causes, each with its own wording: permission
denied, no token, unsupported browser, signed out.

This is the layer that matters, because **the person affected is the
only one who can see the problem** and previously had no way to know.

## 3. The jobs report who they missed

`remind.py` and `worker/live.js` now collect everyone they skipped for
having no token and print them:

```
  ! no push token, will hear nothing: Marco, Dave R
```

So a silent non-delivery shows up in a log you already check.

## 4. Audit before Week 1

```bash
python scripts/check_roster.py --season 2026
```

```
  name              alerts   timezone              status
  --------------------------------------------------------------
  Lee               2        America/New_York      ok  Sun 09:14
  Monse             1        Asia/Tokyo            ok  Sun 22:14
  Marco             0        America/Chicago       NO ALERTS
```

It also catches people who are members but never reached the roster at
all — they joined, but `upsertRoster()` never ran, so they get nothing.

Exit code is non-zero when there is a problem, so you can hang it off a
workflow later if you want.

## What to actually do

1. Invite everyone
2. Run `check_roster.py`
3. Text anyone showing **NO ALERTS**: open the app, tap the amber banner
4. Run it again

Two minutes, and it is the difference between a pool that stays alive
and half of it quietly drifting off by Week 4.

---

# Will alerts actually work this weekend?

**Yes. Real notifications, on the real preseason schedule.** Nothing
about them is stubbed or simulated. But they need four things in place,
and one has a deadline.

## What has to be true

1. **VAPID key** pasted into `firebase-init.js`, and
   `firebase-messaging-sw.js` sitting at the project root
2. **The live Worker deployed** with `SEASON = "2026PRE"` in
   `wrangler-live.toml` — it drives the ESPN feed, the game ids and the
   week ceiling, and must match `SEASON` in `index.html`
3. **Each person installed to their Home Screen** and granted permission.
   On iPhone this is not optional; Apple refuses otherwise.
4. **A token in the roster** for each of them — `check_roster.py` tells
   you

## The timing

Finish setup Tuesday evening and every tier fires for every game:

```
  kickoff               open    day     hours   final
  Thu 8:00 PM ET        yes     yes     yes     yes
  Fri 7:00 PM ET        yes     yes     yes     yes
  Sat 1:00 PM ET        yes     yes     yes     yes
  Sat 7:00 PM ET        yes     yes     yes     yes
```

Leave it until Thursday and the two-day and one-day windows for the
early games have already passed. Those games still get the "couple of
hours out" and "last call" tiers, which are the ones worth testing
anyway. Nothing breaks either way.

## Don't wait to find out

There is an on-demand test, so you can verify end to end in thirty
seconds rather than sitting around until a window opens:

```bash
# everyone in the pool
curl "https://pickem-live.YOURNAME.workers.dev/__live/test?key=ADMINKEY"

# one person
curl "https://pickem-live.YOURNAME.workers.dev/__live/test?key=ADMINKEY&name=Lee"
```

Sends a real push immediately:

> **Test alert**
> If you can read this, Lee, your reminders are working. Nothing to do.

The response lists everybody it reached and flags anyone with no token.

All `/__live/` endpoints require `?key=` matching the `ADMIN_KEY`
secret, because this one sends real notifications to real phones.

## The order to test in

1. Deploy the Worker, then `/__live/remind` — a dry run, prints who
   would be notified and sends nothing
2. `/__live/test&name=You` — confirm one push lands on your own phone
3. Invite people, then `check_roster.py`
4. `/__live/test` — everyone gets one, and you see any gaps immediately
5. Then let the real tiers run Thursday through Saturday

Step 2 before step 3 matters. Verify the pipe works on your own phone
before five other people are depending on it.
