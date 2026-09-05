# Launching to hundreds of people

`SETUP.md` gets a family pool running. This is what changes when the
number is 300 instead of 5. Do `SETUP.md` steps 1–10 first — everything
here builds on that project.

**The one architectural change:** clients stop querying the picks
collection and read prebuilt snapshots instead. Everything else follows
from that.

---

## Why, in numbers

One pool, 300 players, 16 games.

| | Reads/day | Grid open |
|---|---|---|
| Querying picks directly | ~1,080,000 | 4,800 docs |
| Reading snapshots | ~750 | 2 docs |

The cost difference is about $19/month — survivable. The one that
matters is the right-hand column. Pulling 4,800 documents over cellular
is a multi-second spinner, every open, for every person, at the exact
moment everyone opens it at once. Snapshots make it two documents no
matter how many people are in the pool.

---

# Part 1 — Deploy the snapshot layer

**Before following this: step 5 below is stale and would reopen a bug
that's since been fixed.** `.github/workflows/live.yml`'s 5-minute
schedule (the thing step 5 tells you to add) is deliberately disabled
now — see the file's own header — because running it alongside
`worker/live.js` (the Cloudflare Worker that now handles live scores
every minute and reminders every five) sent every kickoff reminder
twice, from two dedupe stores that can't see each other. `worker/live.js`
does not build snapshots; it writes scores straight to the game
documents and computes reminders straight from `picks/*`. So if you do
adopt the snapshot layer below, step 5 needs to become "have something
call `build_snapshot.py` on a live cadence without also re-enabling
`remind.py` on that same schedule" — a Cloudflare Cron Trigger on
`worker/live.js` that shells out to snapshot-building logic, or a
GitHub Actions schedule that runs `build_snapshot.py` alone. Neither
exists yet; this needs to be built, not just switched on. The rest of
this part (rules, roster, `getBoard()`/`getShard()`) is otherwise
accurate and independent of that gap.

## 1. Publish the new rules

Firestore → Rules → paste `firestore.rules` → Publish.

Two blocks are new and one changed:

- **`snapshots/`** — members read, nobody writes. This is what the app reads.
- **`private/`** — nobody reads. Holds every pick including unrevealed
  ones, the roster, and reminder progress.
- **`picks/`** now allows reading **only your own**. Reveal happens by
  the snapshot job choosing what to publish, which is a stronger
  guarantee than a read rule: an unrevealed pick is never in any
  document a client can reach, so there is no query to get it wrong.

The roster carries one exception worth understanding:

```
allow update: if docId == 'roster'
  && isMember(poolId)
  && request.resource.data.diff(resource.data)
       .affectedKeys().hasOnly([request.auth.uid]);
```

Each member writes only the key named after their own uid. They write
blind — `updateDoc` needs no read, and no read is granted. That single
document is why `remind.py` does one read instead of 300.

## 2. Seed the roster

```bash
python - <<'EOF'
import firebase_admin
from firebase_admin import credentials, firestore
firebase_admin.initialize_app(credentials.Certificate("serviceAccount.json"))
db = firestore.client()
POOL = "YOUR_POOL_ID"
db.collection("pools").document(POOL).collection("private").document("roster").set({})
print("roster created")
EOF
```

The rules deny `create` on purpose, so this has to be an admin write
once. After that, clients fill in their own keys on sign-in.

## 3. Call `upsertRoster()` on sign-in

In your auth callback, right after `ensureMember()`:

```js
await PS.upsertRoster();   // name + IANA timezone
```

Without it a person is invisible to the reminder job. They can still
pick; they just never get nagged.

## 4. Swap the Grid onto snapshots

Replace the pick-scanning code with:

```js
const board = await PS.getBoard(week);   // standings + top 25 full rows
const mine  = await PS.getShard(week);   // your own row
```

`board.standings` is everyone's totals, ranked. `board.top` carries the
full pick grids for the leaders. `getShard()` fetches your own row from
a 100-player shard, and takes a uid if you add a player search later.

**At 300 players you cannot render 300 rows.** Show the top 25 from
`board.top`, then your own row pinned below with its real rank. That is
what every large pool does, and it is one read plus one.

## 5. Add the Live workflow

`.github/workflows/live.yml` replaces `remind.yml` — delete that one.
It runs every 5 minutes on game days: build snapshots, then send
reminders, in that order, because `remind.py` reads the progress
document the snapshot job writes.

The `concurrency: live` block matters. Two overlapping runs would
double-write snapshots and race the reminder markers.

Test it:

```
Actions → Live → Run workflow → dry_run = true
```

Snapshots get built for real; nothing is sent. Read the log.

---

# Part 2 — What else breaks at 300

## Sign-in

Google only will lose people. Add **Sign in with Apple** (mandatory if
you ever ship to the App Store, and a large share of iPhone users prefer
it) and **email link** as a fallback. Firebase Auth → Sign-in method.
Each needs its provider added to `signIn()`.

## Onboarding

Five people you can text. Three hundred need a first-run screen:

1. Detect iOS-not-installed, show Share → Add to Home Screen with the
   icon drawn in. **Half the people who never install simply didn't know
   they could.**
2. Join code entry
3. Ask for notifications only after they're launching from the icon —
   on iOS it fails otherwise, and a declined permission is hard to
   recover

## Multiple pools

Hundreds of people means several pools, not one giant one. `joinPool()`
already handles it; add a create-pool flow that generates a code:

```js
const code = Array.from({length:6}, () =>
  'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random()*32)]).join('');
```

No I/O/0/1 — those get misread when someone reads a code aloud. Check
for collision before writing.

## Display names

People will put things in there. `upsertRoster()` takes the Google
display name, which is usually fine, but add a length cap and a
profanity check if the audience is wider than people you know.

## Hosting

GitHub Pages handles this fine — the app is about 40KB and Pages' soft
limit is 100GB/month. If you outgrow it, Cloudflare Pages is a
drop-in with unlimited bandwidth.

## Costs

**The table that used to be here was wrong, and wrong in the dangerous
direction.** It said ~750 reads/day at 300 players and concluded "writes
are the ceiling, not reads — stay on the Spark plan." Both claims assumed
the snapshot architecture was serving the client. It is not. See the
header of `scripts/build_snapshot.py`: the migration never happened, and
`index.html` reads the raw `picks` collection through
`getRevealed()`/`watchRevealed()` instead. So the real read count is
roughly two orders of magnitude above what that table claimed.

What one app open actually costs, per the queries in `firebase-init.js`:

| Query | Docs read |
|---|---|
| `getAllWeeks()` — the whole `games` collection | ~272 (18 wks x 16) |
| `watchWeek()` — this week's games | 16 |
| `watchMembers()` — the roster | = player count |
| `watchRevealed()` — one doc per player per game | players x 16 |
| standings | = player count |
| pool doc + own tiebreak | 2 |

At 50 players that is roughly **1,200 reads per open** — dominated by the
800 pick documents, because a pick is stored one document per player per
game (`{uid}_{gameId}`).

| | Spark free tier | 50 players |
|---|---|---|
| Reads, one open each | 50k/day | ~60,000 — **already over** |
| Reads, a normal Sunday (~5 opens each) | 50k/day | ~300,000 — **6x over** |
| Writes | 20k/day | ~800 on Sundays — comfortable |

**Reads are the ceiling, not writes.** That is the exact inversion of what
this file used to say.

**Do not stay on Spark at 50 players.** When Spark hits the read ceiling it
does not throttle, it *stops* — reads fail until the quota resets at
midnight Pacific, and the app shows an error screen for the rest of the
day. On a Sunday that is the whole event.

On Blaze the same 50k/day is still free and overage is charged at roughly
$0.03–$0.06 per 100,000 reads depending on region, so a 300,000-read
Sunday costs about **8 to 15 cents**. The upgrade is a safety valve, not a
running cost. Nothing here needs Cloud Functions either way.

The real fix is to wire the client to the snapshot documents that
`build_snapshot.py` already writes correctly — that collapses ~1,200 reads
per open into about 5. It is deliberately deferred: it touches the Grid,
the Standings and `firestore.rules` at once, which is exactly the kind of
change not to make in-season. Blaze removes the cliff in the meantime.

**If the repo is private, Actions minutes will run out.** Every 5
minutes across four days is roughly 1,150 runs a week. Make it public —
no secrets live in the code; the service account is in GitHub Secrets.

## When you have real users

- **Actions → Live → check it's green.** A silently failing snapshot job
  means a frozen Grid and no reminders, and nobody will tell you.
- **Firebase → Usage.** Watch writes on Sunday afternoon.
- **Bump `VERSION` in `sw.js` on every deploy.** At 300 people, a
  forgotten bump means a lot of stale installs.

---

# Order to do it in

1. Rules, roster seed, `upsertRoster()` — 30 min
2. Grid onto snapshots, top-25 + your row — the real work
3. `live.yml`, delete `remind.yml`, dry run
4. Apple + email sign-in
5. Onboarding screen with the iOS install walkthrough
6. Create-pool flow and codes

**Run one week with about 20 people before opening it up.** Everything
that breaks at 300 also breaks at 20 — you just get to fix it without an
audience. The thing most likely to bite is the snapshot job silently
failing on a Sunday, and you want to have already seen that happen once.
