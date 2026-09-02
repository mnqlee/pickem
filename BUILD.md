# Build and launch Weekly NFL Pick’em

Start to finish, assuming nothing. Follow in order — later parts depend
on earlier ones.

**Time:** about 4 hours of actual work, spread over a few evenings.
The Firebase and DNS steps involve waiting.

**Cost:** $10–15 for the domain. Everything else is free at your size.

---

## Before you start

Accounts you'll create (all free unless noted):

- **GitHub** — you have one
- **Google/Firebase** — database, notifications
- **Cloudflare** — hosting, the auth Worker, DNS
- **Resend** — sends the sign-in emails
- **A domain registrar** — Cloudflare Registrar is fine and sells at cost

Install on your machine:

```bash
node --version     # need 18+
python3 --version  # need 3.10+
git --version
```

Missing Node: <https://nodejs.org>. Missing Python: <https://python.org>.

---

# Part 1 — Get the code

## 1.1 Unzip and open a terminal there

```bash
cd ~/Downloads
unzip poolsheet.zip
cd poolsheet
ls
```

You should see `index.html`, `firebase-init.js`, `sw.js`, `worker/`,
`scripts/`, `.github/`.

## 1.2 Make it a repo

```bash
git init
git add .
git commit -m "Pool Sheet initial"
```

## 1.3 Push to GitHub

Create an empty repo at <https://github.com/new> named `poolsheet`.
**Public** — GitHub Actions minutes are unlimited on public repos and
you'll be running a job every 5 minutes. No secrets live in the code.

```bash
git remote add origin https://github.com/YOURNAME/poolsheet.git
git branch -M main
git push -u origin main
```

## 1.4 Confirm nothing dangerous is tracked

```bash
cat .gitignore     # must contain serviceAccount.json
```

---

# Part 2 — Firebase

## 2.1 Create the project

1. <https://console.firebase.google.com> → **Add project**
2. Name: `pool-sheet`
3. **Turn Google Analytics OFF** — you don't need it and it adds a
   consent surface you'd have to explain
4. Create, wait, Continue

## 2.2 Firestore

1. Build → **Firestore Database** → Create database
2. **Production mode** — *not* test mode. Test mode expires after 30
   days and everything silently breaks mid-season.
3. Location: `nam5 (us-central)`
4. Enable

## 2.3 Authentication

1. Build → **Authentication** → Get started
2. Sign-in method → **Anonymous** → Enable → Save

Only Anonymous. The Worker mints custom tokens, and custom tokens need
at least one provider enabled. You are not using Google sign-in.

## 2.4 Get your config into the app

1. Project settings (gear) → scroll to **Your apps** → web icon `</>`
2. Nickname `pool-sheet-web` → Register
3. Copy the `firebaseConfig` object
4. Open `firebase-init.js`, replace the `PASTE_ME` block at the top

These keys are public by design. They identify the project; they don't
grant access. `firestore.rules` grants access.

## 2.5 Service account key

This is the credential that lets your scripts write data the rules would
otherwise block.

1. Project settings → **Service accounts** → Generate new private key
2. Save it as `serviceAccount.json` in the project root
3. Verify immediately:

```bash
git status     # serviceAccount.json must NOT appear
```

If it appears, stop and fix `.gitignore` before doing anything else.
That file is full admin access to your database.

---

# Part 3 — Domain and Cloudflare

## 3.1 Buy the domain

Cloudflare Registrar sells at cost. Something like `thepoolsheet.app`
or a `.co`. Avoid hyphens — people read these aloud.

If you buy elsewhere, add the site to Cloudflare and change the
nameservers at your registrar. **Propagation takes 1–24 hours.** Start
this early and do other parts while you wait.

## 3.2 Confirm it's active

Cloudflare dashboard → your domain should say **Active**, not *Pending
nameserver update*. Don't continue until it does.

---

# Part 4 — Deploy the site

## 4.1 Cloudflare Pages

1. Cloudflare dashboard → **Workers & Pages** → Create → **Pages**
2. **Connect to Git** → authorise GitHub → pick `poolsheet`
3. Build settings:
   - Framework preset: **None**
   - Build command: *leave empty*
   - Build output directory: `/`
4. **Save and Deploy**

It's a static site, so there's nothing to build. First deploy takes
about a minute.

## 4.2 Point your domain at it

1. In the Pages project → **Custom domains** → Set up a domain
2. Enter your apex domain (`thepoolsheet.app`, no `www`)
3. Cloudflare adds the DNS record itself

Visit it. You should see the app with an amber **Demo data** banner.

## 4.3 Icons

Three PNGs in `icons/`:

| File | Size |
|---|---|
| `icon-192.png` | 192×192 |
| `icon-512.png` | 512×512 |
| `icon-maskable-512.png` | 512×512 |

Make one 1024×1024 square — dark `#1A1917` background, the red stamp
circle, a number in it — and export three sizes. Figma, Canva or Preview
all do this.

**The maskable one gets cropped to a circle on Android**, so keep
artwork inside the middle 80%.

```bash
git add icons && git commit -m "icons" && git push
```

Pages redeploys automatically on every push.

---

# Part 5 — Email

## 5.1 Resend

1. <https://resend.com> → sign up
2. **Domains** → Add domain → enter yours
3. It gives you DNS records — **SPF, DKIM, DMARC**

## 5.2 Add the records

Cloudflare → your domain → **DNS** → add each record exactly as Resend
shows it. Set proxy status to **DNS only** (grey cloud) for these.

Back in Resend, click **Verify**. Usually minutes.

## 5.3 API key

**API Keys** → Create → **Sending access** only. Copy it now; you can't
see it again.

## 5.4 Do not skip deliverability

**A sign-in code in the spam folder is indistinguishable from a broken
app, and people just give up.**

Once the Worker is live (Part 6), send yourself a code at a **Gmail, an
Outlook and an iCloud address.** Those three cover nearly everyone and
they behave differently. Check spam folders. Fix before inviting anyone.

---

# Part 6 — The auth Worker

## 6.1 Install wrangler and edit config

```bash
npm install -g wrangler
wrangler login
```

Open `worker/wrangler.toml` and replace every `yourdomain.com` with your
actual domain — there are three.

## 6.2 Create the KV namespaces

```bash
cd worker
wrangler kv namespace create PINS
wrangler kv namespace create SESSIONS
```

Each prints an `id`. Paste them into the matching `REPLACE_ME` in
`wrangler.toml`.

## 6.3 Secrets

```bash
wrangler secret put SA_JSON
# paste the ENTIRE contents of serviceAccount.json, then Ctrl-D

wrangler secret put RESEND_KEY
# paste the Resend key
```

## 6.4 Deploy

```bash
wrangler deploy
cd ..
```

## 6.5 Test it

```bash
curl -X POST https://YOURDOMAIN/api/request-code \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@gmail.com"}'
```

Expect `{"ok":true}` and an email within seconds.

**`{"ok":true}` but no email** is expected behavior for an unknown or
rate-limited address — the endpoint always says ok so nobody can use it
to discover who's in the pool. Check the Worker logs:

```bash
cd worker && wrangler tail
```

---

# Part 7 — Rules and pool setup

## 7.1 Publish the rules

Firebase Console → Firestore → **Rules** tab. Delete everything there,
paste the entire contents of `firestore.rules`, **Publish**.

Nothing works until this is done, and getting it wrong is the one
mistake with real consequences. Read the comment block at the bottom of
that file — it explains the one thing rules deliberately don't enforce
and why the scoring job catches it instead.

## 7.2 Install Python dependencies

```bash
pip install firebase-admin requests
```

## 7.3 Create your pool

```bash
python - <<'EOF'
import firebase_admin, secrets
from firebase_admin import credentials, firestore
firebase_admin.initialize_app(credentials.Certificate("serviceAccount.json"))
db = firestore.client()

# No I, O, 0 or 1 — those get misread when a code is read aloud.
ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
code = "".join(secrets.choice(ALPHA) for _ in range(6))

ref = db.collection("pools").document()
ref.set({
    "name": "Family Pool 2026",
    "season": "2026",
    "joinCode": code,
    "ownerUid": "SET_THIS_LATER",
    "scoringHistory": [{"week": 1, "mode": "confidence"}],
})
ref.collection("private").document("roster").set({})
print("POOL ID  ", ref.id)
print("JOIN CODE", code)
EOF
```

**Write both down.** The join code goes in the invite link.

## 7.4 Set yourself as owner

Sign into the app once (Part 10 or after), then Firebase →
Authentication → Users → copy your User UID. Then:

```bash
python - <<'EOF'
import firebase_admin
from firebase_admin import credentials, firestore
firebase_admin.initialize_app(credentials.Certificate("serviceAccount.json"))
firestore.client().collection("pools").document("YOUR_POOL_ID") \
    .update({"ownerUid": "YOUR_UID"})
print("done")
EOF
```

---

# Part 8 — Load the schedule

```bash
python scripts/import_schedule.py --season 2026 --dry-run
```

Read the output. If it looks right:

```bash
python scripts/import_schedule.py --season 2026
```

Check Firestore → `seasons/2026/games` → 272 documents.

**If the ESPN endpoint has stopped working** (it's undocumented and can
change), build the CSV by hand:

```
week,away,home,kickoff_utc,network,spread
1,BAL,KC,2026-09-11T00:20:00Z,NBC,KC -3
```

```bash
python scripts/import_schedule.py --season 2026 --csv schedule.csv
```

272 rows is one evening, and then nothing external can break your season.

**Kickoff times must be UTC.** Get this wrong and every lock in the app
is wrong. Spot-check one game against the real schedule before moving on.

---

# Part 9 — Scheduled jobs

## 9.1 GitHub secrets

Repo → Settings → Secrets and variables → **Actions**

- **New repository secret**: name `FIREBASE_SERVICE_ACCOUNT`, value =
  the entire contents of `serviceAccount.json`, pasted raw
- **Variables** tab → New variable: `SEASON` = `2026`

## 9.2 Push notification key

1. Firebase → Project settings → **Cloud Messaging** tab
2. Web Push certificates → **Generate key pair**
3. Copy it into `VAPID_KEY` in `firebase-init.js`
4. `firebase-messaging-sw.js` is already in the repo — you do NOT need to
   create it or register it. It used to be step 4 here, and the file is
   still checked in with the right code, but `getToken()` in
   `firebase-init.js` passes `serviceWorkerRegistration: reg` explicitly
   (`reg` = `sw.js`'s own registration), which is what actually receives
   pushes — see the PUSH comment near the top of `sw.js`. Nothing ever
   registers `firebase-messaging-sw.js`, and nothing needs to.

## 9.3 Deploy the live Worker

This is the part that actually keeps the Grid live. It's easy to miss
because nothing earlier in this guide points here — Part 6 deploys the
**auth** Worker (`worker/auth.js`, `wrangler.toml`); this is a second,
separate Worker (`worker/live.js`, `wrangler-live.toml`) that polls ESPN
and sends kickoff reminders on Cloudflare Cron Triggers. Skip this step
and the site still works, but scores never update and nobody gets
reminded of anything.

`wrangler-live.toml` already reuses the `SESSIONS` KV namespace id from
Part 6.2 and has `SEASON` set — no KV namespace to create here, just
secrets and deploy:

```bash
cd worker
wrangler secret put SA_JSON -c wrangler-live.toml
# paste the ENTIRE contents of serviceAccount.json, then Ctrl-D

wrangler secret put ADMIN_KEY -c wrangler-live.toml
# any long random string — guards the /__live/ endpoints below, one of
# which sends a real push to a real phone

wrangler deploy -c wrangler-live.toml
cd ..
```

Confirm `SEASON` in `wrangler-live.toml` matches `SEASON` in
`index.html` and `firebase-init.js` — `bash scripts/check.sh` checks
this for you. A mismatch means the Worker polls the wrong season's
schedule and nothing it does ever shows up in the app.

**Test it**, once alerts are turned on in a real (non-InPrivate) browser
tab so there's a token to receive it:

```
https://YOURWORKER.workers.dev/__live/test?key=YOUR_ADMIN_KEY
```

A real notification should appear within a few seconds. That's the one
piece of this whole guide that can't be verified from a terminal —
it has to land on an actual phone or browser.

You do **not** need to redeploy the auth Worker (Part 6) for anything
in this part — they're independent.

## 9.4 Test the GitHub Actions jobs

```
Actions → Live → Run workflow → dry_run = true
```

Snapshots get built for real; no notifications go out. Read the log.

Then `Actions → Score the week → Run workflow`.

Both green tells you the code in each job runs — it does NOT mean a
schedule is now ticking. `Live`'s `schedule:` trigger is commented out
(see the file's own header): the Cloudflare Worker at `worker/live.js`
is what actually runs on a timer now — scores every minute, reminders
every five — deployed with `wrangler deploy -c wrangler-live.toml`, not
by anything in this Actions tab. `Live` here is a manual fallback only.
`Score the week` **is** still schedule-driven and runs Sunday night,
Monday night, Tuesday
morning.

---

# Part 10 — Take it live

Everything so far is infrastructure. The app itself is still showing
generated demo data. This part connects them.

## 10.1 The switch

Open `index.html`. At the very top of the `<script>` block:

```js
const DEMO = true;      // <- change to false
const SEASON = '2026';
const POOL_LABEL = 'Family Pool 2026';
```

## 10.2 What has to be replaced

With `DEMO = false` the app needs real data in four places. Each is
marked in the file, and `firebase-init.js` already exposes the function:

| Demo | Replace with |
|---|---|
| `WEEKS` / `slateFor()` | `await PS.getWeek(n)` |
| `BOT` seeded picks | `PS.watchBoard(wk, cb)` |
| `result(g)` | `g.winner` from the game document |
| `state.picks` in memory | `PS.myPicks(wk)` / `PS.savePicks(...)` |
| onboarding step 0 | the PIN screen — snippets below |

## 10.3 Session restore on launch

Add this before anything renders:

```js
const r = await fetch('/api/session', { credentials: 'include' });
if (r.ok) {
  const { token } = await r.json();
  await signInWithCustomToken(auth, token);    // straight in, no email
} else {
  showPinScreen();
}
```

## 10.4 The PIN exchange

```js
await fetch('/api/request-code', { method:'POST', credentials:'include',
  headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email }) });

const v = await fetch('/api/verify-code', { method:'POST', credentials:'include',
  headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email, code }) });
const { token } = await v.json();
await signInWithCustomToken(auth, token);

await PS.joinPool(new URLSearchParams(location.search).get('join'));
await PS.upsertRoster();       // name + timezone, silently
```

## 10.5 Keep the demo path

Don't delete the demo generators — keep them behind `if (DEMO)`. Being
able to run the whole UI with no network and no sign-in is worth a great
deal when you're debugging layout at 11pm.

## 10.6 Verify

```bash
bash scripts/check.sh
```

Every line must be a green ✓ before you invite anyone.

---

# Part 11 — Test on your own phone

Do all of these yourself before anyone else sees it.

1. **Open the site in Safari on your iPhone.** Sign in with the PIN.
2. **Share → Add to Home Screen.** Open from the new icon.
3. **Confirm you're still signed in.** This is the cookie session
   working. If you have to PIN again, `/api/session` isn't being reached
   — check the Worker route pattern in `wrangler.toml`.
4. **Turn on alerts** from the Home Screen app, not Safari.
5. **Make some picks. Force-quit. Reopen.** They must still be there —
   that's autosave.
6. **Test the update flow.** Bump `VERSION` in `sw.js`, push, wait a
   minute, reopen the app. You should get the red **Update ready**
   banner.

**Do not skip step 6.** If updates don't reach phones you'll fight it
all season, and it's far easier to debug now with one user.

---

# Part 12 — Invite people

## 12.1 The link

```
https://YOURDOMAIN/?join=YOURCODE
```

The code is in the link, so nobody types it.

## 12.2 Soft test first — three people

Not all 25. Pick three who will actually tell you when something is
broken. Have them install from the link on their own phones **without
you standing there**.

Watch for: did the iOS install screen make sense unaided? Did the PIN
email arrive, and in the inbox? Did notifications work? Is anyone's name
blank?

Then `Actions → Live → dry_run = true` and read the log — it prints
every person, their timezone, and how many picks they owe.

## 12.3 Then everyone

> Weekly NFL Pick’em is up for this season — 16 games a week, rank them 1 to 16
> by how confident you are. Free, no app store.
>
> **https://YOURDOMAIN/?join=YOURCODE**
>
> Takes a minute. **Add it to your Home Screen when it asks** —
> notifications don't work on iPhone otherwise, and the reminders are
> the whole point.

The Home Screen instruction goes in the text as well as the app. People
skim.

---

# Your routine from here

```bash
# 1. BUMP THE VERSION IN sw.js — the step everyone forgets
#    const VERSION = 'v1.0.1';
git add . && git commit -m "what changed" && git push
```

Cloudflare Pages redeploys in about a minute. Next time anyone opens the
app they get an **Update ready** banner, tap it, done. Nobody
force-quits anything.

**Forget the version bump** and cached assets go stale while the HTML
refreshes, giving a confusing half-updated state.

## Weekly during the season

- **Sunday morning:** glance at Actions. A silently failed `Live` run
  means a frozen Grid and no reminders, and nobody will tell you —
  they'll assume it's their phone.
- **Tuesday:** check standings updated.
- Turn on GitHub's workflow-failure emails.

---

# When something is wrong

| Symptom | Cause |
|---|---|
| `permission-denied` in console | Rules not published — Part 7.1 |
| Sign-in code never arrives | SPF/DKIM not verified, or check spam — Part 5 |
| `{"ok":true}` but no email | Rate limited (60s), or unknown address. `wrangler tail` |
| Signed out every time the app opens | `/api/session` unreachable. Check the route in `wrangler.toml` |
| No notifications on iPhone | Not installed to Home Screen. Apple requires it |
| Notifications work for some people | Those without them never installed, or declined |
| Grid empty during games | `Live` workflow failing — check Actions |
| Standings wrong | Run `Score the week` manually and read the log |
| Game locked at the wrong time | Kickoff imported in local time, not UTC — Part 8 |
| Updates not reaching phones | `VERSION` in `sw.js` not bumped |
| Someone ranked two games the same | Scoring job flags `bad weights` and scores that week straight-up |

---

# Order of work

**Evening 1** — Parts 1–3. Domain propagation runs overnight.
**Evening 2** — Parts 4–6. Site live, email working, Worker deployed.
**Evening 3** — Parts 7–9. Data and jobs.
**Evening 4** — Part 10. The real coding.
**Evening 5** — Part 11 on your own phone, then Part 12 soft test.

Then a full week with three people before you open it up. Everything
that breaks at 25 also breaks at 3 — you just get to fix it without an
audience.

---

# How live data actually flows

*(Updated — this section originally described a GitHub-Actions-driven
snapshot pipeline. That pipeline is now superseded by the Cloudflare
Worker below; the old design is kept nowhere else, so the corrected
version is here instead of a separate changelog.)*

Three moving parts. Nothing polls from the phone.

```
ESPN scoreboard
      |  every minute, game windows only (Cloudflare Worker: pickem-live)
      v
seasons/2026/games/*          scores, status, winner
      |  Firestore onSnapshot listener
      v
every phone, instantly
```

Reminders run on their own cron in the same Worker, every five minutes,
computed straight from `picks/*` — no intermediate document, nothing
that can go stale between runs.

## The live Worker

`worker/live.js`, deployed on its own with `wrangler deploy -c
wrangler-live.toml` (this is separate from `.github/workflows/live.yml`
below — same name, different mechanism). One Worker, two Cloudflare Cron
Triggers:

1. **Every minute**, `* * * * *` — pull the current and next week from
   ESPN and write any game whose score or status moved. Exits
   immediately, at no cost, when nothing is live.
2. **Every five minutes**, `*/5 * * * *` — send kickoff reminders to
   anyone still missing a pick, checked directly against `picks/*`.

Cloudflare Cron Triggers fire on the minute, which is the whole reason
this runs on a Worker instead of GitHub Actions — see "Be honest about
the lag" below for the problem that led here.

## `.github/workflows/live.yml` — manual fallback only now

This used to be the live loop: `score_week.py --scores-only` →
`build_snapshot.py` → `remind.py`, on a 5-minute GitHub Actions
schedule. Its `schedule:` trigger is commented out now — running it
alongside the Worker sent every kickoff reminder twice, from two dedupe
stores that can't see each other (Cloudflare KV vs. Firestore; see the
file's own header). It's kept as `workflow_dispatch` only, for a manual
run if the Worker is ever down. Note that `build_snapshot.py`'s output
(`pools/{id}/snapshots/*`) isn't read by the client — see that script's
own header — so what running this workflow by hand is actually useful
for is its `score_week.py --scores-only` step.

## How phones find out

They don't poll. `watchWeek()` and `watchRevealed()` open Firestore
`onSnapshot` listeners directly on the game and pick documents, so when
one changes every open app updates within a second or two. No refresh,
no pull-to-reload.

Countdown timers are the exception: those tick locally every second,
because a duration doesn't need a server.

## What each timer actually is

| | Cadence | Does what |
|---|---|---|
| Kickoff lock | instant | Server-side rule. No job involved. |
| Countdown | 1 sec, local | Ticks in the browser |
| Scores | 1 min, game windows only | ESPN into Firestore (`pickem-live` Worker) |
| Grid + standings | instant | Client listens on games/picks directly, no rebuild step |
| Reminders | 5 min | Only to people missing picks (`pickem-live` Worker) |
| Final scoring, badges, push | 3x weekly | Sun night, Mon night, Tue morning |

## Be honest about the lag

**GitHub's cron is best-effort and routinely fires 10 to 20 minutes
late.** That's fine for a Sunday-night scoring run, but useless for a
"last call, 30 minutes out" reminder — which is exactly why scores and
reminders moved off GitHub Actions and onto the Cloudflare Worker above:
Cloudflare Cron Triggers fire on time, at one-minute granularity.
`Score the week` (Part 9's other workflow) is still on GitHub's
schedule, and still subject to this lag — fine there, since it only
needs to land sometime Sunday night through Tuesday morning, not to the
minute.

## Load

Every 5 minutes across five days is about 1,150 runs a week.

- **ESPN:** 2 calls per run. Undocumented endpoint, no published limit.
  If it ever starts refusing, the job logs it and carries on with the
  scores it already has.
- **Firestore writes:** only changed games. Roughly 300 a day on a
  Sunday, against a 20,000 free-tier limit. Blind writes would have been
  4,600.
- **Actions minutes:** free on a public repo. On a private repo this
  will exhaust the free tier.

## When it breaks

A failed `Live` run means a frozen Grid and no reminders, and **nobody
will tell you** — they will assume their phone is being slow. Turn on
GitHub's workflow-failure emails and glance at the Actions tab on Sunday
morning.
