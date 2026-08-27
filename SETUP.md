> **Superseded by [BUILD.md](BUILD.md)**, which is the ordered start-to-finish
> guide. This file predates the move to Cloudflare and email-PIN sign-in, so
> its hosting and auth steps are out of date. The reference sections — ranks
> and points, tiebreaker, time zones, betting lines — are still accurate.

# The Pool Sheet — setup

**Going past a handful of players? Read  after this one.**
At a few hundred people the app must read prebuilt snapshots instead of
querying picks directly, and that changes the rules, the workflows and
the Grid.

Start to finish. Roughly two hours if nothing fights you, and the
Firebase console is the part most likely to fight you.

Do these in order. Steps 1–6 get a working app on phones. Steps 7–10
add scoring and alerts.

---

## Files in this repo

```
index.html                          the app (from pickem-v3)
firebase-init.js                    auth, database, push, updates
sw.js                               offline + update handling
manifest.json                       makes it installable
firestore.rules                     the actual security
icons/                              YOU make these — step 5
scripts/import_schedule.py          run once a season
scripts/score_week.py               runs three times a week
.github/workflows/score-week.yml    the scheduler
```

---

## 1 — Firebase project

1. <https://console.firebase.google.com> → **Add project**
2. Name it `pool-sheet`. Turn Google Analytics **off** — you don't need it
   and it adds a consent surface you'd have to explain to your family.
3. Wait for it to finish, then **Continue**.

## 2 — Turn on the three services

**Authentication**
1. Build → Authentication → Get started
2. Sign-in method → **Google** → Enable
3. Set a support email → Save

**Firestore**
1. Build → Firestore Database → Create database
2. **Production mode** (not test mode — test mode expires in 30 days
   and everything silently breaks)
3. Location: `nam5 (us-central)` unless you have a reason otherwise

**Cloud Messaging** is on by default. Nothing to click yet.

## 3 — Get your config into the app

1. Project settings (gear icon) → scroll to **Your apps**
2. Click the web icon `</>` → nickname `pool-sheet-web` → **Register**
3. Copy the `firebaseConfig` object
4. Paste it over the `PASTE_ME` block at the top of `firebase-init.js`

These keys are public by design. They identify your project; they don't
grant access. The rules file is what grants access.

## 4 — Deploy the rules

Easiest path, no CLI:

1. Firestore → **Rules** tab
2. Delete everything there
3. Paste the entire contents of `firestore.rules`
4. **Publish**

Or with the CLI:
```bash
npm i -g firebase-tools
firebase login
firebase init firestore     # point it at firestore.rules
firebase deploy --only firestore:rules
```

**Read the comment block at the bottom of that file before moving on.**
It explains the one thing the rules deliberately don't enforce.

## 5 — Icons

You need three PNGs in `icons/`:

| File | Size | Notes |
|---|---|---|
| `icon-192.png` | 192×192 | home screen |
| `icon-512.png` | 512×512 | splash screen |
| `icon-maskable-512.png` | 512×512 | keep art inside the middle 80% |

Make one 1024×1024 square — dark background `#1A1917`, the red stamp
circle, a number in it — and export the three sizes. Figma, Canva, or
Preview all do this. **The maskable one gets cropped to a circle on
Android**, so anything near the edge disappears.

If the icons are missing the app still installs, it just shows a
screenshot of the page as its icon, which looks broken.

## 6 — Put it online

```bash
git init
git add .
git commit -m "Pool Sheet"
git remote add origin https://github.com/YOURNAME/poolsheet.git
git push -u origin main
```

Then: repo → Settings → Pages → Source **Deploy from a branch** →
`main` / `(root)` → Save. Live at
`https://YOURNAME.github.io/poolsheet/` in about a minute.

**Now go back to Firebase** → Authentication → Settings → Authorized
domains → **Add domain** → `YOURNAME.github.io`. Sign-in fails silently
without this, and the error message won't tell you why.

HTTPS is required for service workers and push. GitHub Pages gives you
that for free.

## 7 — Load the schedule

You need a service account key — the credential that lets scripts write
data the rules would otherwise block.

1. Project settings → **Service accounts** → Generate new private key
2. Save as `serviceAccount.json` in the project root
3. **Add it to `.gitignore` right now**, before you commit anything:

```bash
echo "serviceAccount.json" >> .gitignore
```

That file is full admin access to your database. Never commit it.

```bash
pip install firebase-admin requests
python scripts/import_schedule.py --season 2026 --dry-run   # look first
python scripts/import_schedule.py --season 2026             # then write
```

The ESPN endpoint is undocumented and could stop working. If it does,
build the CSV by hand (`--csv schedule.csv`) — 272 rows, one evening,
and then nothing external can break your season.

## 8 — Create your pool

Firestore → Start collection → `pools` → auto-ID → these fields:

| Field | Type | Value |
|---|---|---|
| `name` | string | `Family Pool` |
| `season` | string | `2026` |
| `joinCode` | string | `HUDSON26` — uppercase, what you text people |
| `ownerUid` | string | your uid, see below |
| `scoringHistory` | array | `[{week: 1, mode: "straight"}]` |

For `ownerUid`: sign into the app once, then Authentication → Users →
copy the User UID.

## 9 — Push notifications

1. Project settings → **Cloud Messaging** tab
2. Web configuration → Web Push certificates → **Generate key pair**
3. Copy the key → paste into `VAPID_KEY` in `firebase-init.js`
4. Create `firebase-messaging-sw.js` in the root:

```js
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');
firebase.initializeApp({ /* same config as firebase-init.js */ });
firebase.messaging();
```

Yes, that's a second service worker. Firebase requires this exact
filename at the root. It doesn't conflict with `sw.js`.

### The iPhone rule

**Web push on iOS only works after the app is on the Home Screen.**
Not before. If you ask for notification permission in Safari, iOS
refuses, and once refused the prompt won't come back easily.

So the onboarding order has to be:

1. Sign in
2. "Add to Home Screen" instructions
3. Open from the Home Screen icon
4. *Then* offer alerts

`enablePush()` in `firebase-init.js` detects this and returns a clear
message instead of failing quietly. Don't reorder these steps.

## 10 — Turn on scoring

1. Repo → Settings → Secrets and variables → Actions
2. **New repository secret**: name `FIREBASE_SERVICE_ACCOUNT`, value =
   the entire contents of `serviceAccount.json`, pasted raw
3. **Variables** tab → New variable: `SEASON` = `2026`
4. Actions tab → *Score the week* → **Run workflow** to test it now

It'll then run Sunday night, Monday night, and Tuesday morning.
Cron on GitHub can fire up to 15 minutes late, which doesn't matter for
this.

---

# How updates reach people

This is the part you asked about, and the plain answer is: **not by
itself, no.** Force-closing and reopening is unreliable, and here's why.

## What actually happens by default

A service worker doesn't replace itself when you push code. The new one
downloads, then sits in a **waiting** state until *every* window of the
app is closed. On a home-screen app, iOS keeps that window alive in the
background for a long time. Force-close usually clears it — but the new
worker only *downloads* on a launch, so:

- **Launch 1** — fetches the new worker, keeps running the old one
- **Launch 2** — new one activates

That two-launch gap is exactly why people say "I updated it and nothing
changed." Some of your family would sit on an old version for days.

## What this setup does instead

Four things, all already in the files:

1. **`sw.js` calls `skipWaiting()` and `clients.claim()`** — the new
   worker takes over immediately instead of waiting for windows to close.
2. **App code is network-first.** `index.html` and the JS always try the
   network before the cache, so a fresh copy arrives the moment there's
   signal. Cache is only the offline fallback.
3. **`registerSW()` checks for updates on every launch *and* every time
   the app comes back to the foreground** — not just cold starts.
4. **When a new version is ready, the app shows a banner.** Tap it, the
   page reloads, done.

## Your actual deploy routine

```bash
# 1. bump the version in sw.js — THIS IS THE STEP PEOPLE FORGET
#    const VERSION = 'v1.0.1';

git add . && git commit -m "fix grid on small screens" && git push
```

That's it. Pages rebuilds in about a minute. Next time anyone opens the
app they get an **Update ready** banner, tap it, and they're current.
Nobody force-closes anything.

**If you forget to bump `VERSION`,** cached assets stay stale. The HTML
still refreshes because it's network-first, so you'll get a confusing
half-updated state. Bump it every time. Make it muscle memory.

## Wire up the banner

Add this to `index.html`, just before `</body>`:

```html
<div id="updateBar" style="
  position:fixed;left:14px;right:14px;bottom:96px;z-index:99;display:none;
  background:#C8342A;color:#fff;padding:13px 16px;border-radius:10px;
  font:700 12px/1.4 Archivo,sans-serif;letter-spacing:.04em;
  box-shadow:0 8px 24px rgba(0,0,0,.5);
  align-items:center;justify-content:space-between;gap:12px">
  <span>A new version is ready.</span>
  <button id="updateGo" style="
    border:0;background:#fff;color:#C8342A;border-radius:6px;
    padding:8px 14px;font:800 11px Archivo,sans-serif;
    letter-spacing:.08em;text-transform:uppercase;cursor:pointer">Reload</button>
</div>

<script type="module">
  import './firebase-init.js';
  window.PS.registerSW(apply => {
    const bar = document.getElementById('updateBar');
    bar.style.display = 'flex';
    document.getElementById('updateGo').onclick = apply;
  });
</script>
```

And in `<head>`:

```html
<link rel="manifest" href="./manifest.json">
<meta name="theme-color" content="#1A1917">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Pool Sheet">
<link rel="apple-touch-icon" href="./icons/icon-192.png">
```

---

# Getting people to install it

Text them the link. Then:

**iPhone (Safari only — Chrome on iOS can't install PWAs)**
1. Open the link in Safari
2. Share button → **Add to Home Screen** → Add
3. Open it from the new icon
4. Sign in, then turn on alerts

**Android (Chrome)**
1. Open the link
2. A "Install app" prompt usually appears — or menu → **Add to Home screen**
3. Sign in, turn on alerts

Worth building a first-run screen that detects iOS-not-installed and
shows those three steps with the share icon drawn in. Half the people
who don't install are people who didn't know they could.

---

# Swapping the demo data for real data

`index.html` currently generates its own schedule, opponents' picks, and
results. Four replacements:

| Demo | Real |
|---|---|
| `SLATES` / `WEEKS` | `await PS.getWeek(n)` |
| `BOT` seeded picks | `PS.watchRevealed(wk, cb)` |
| `result(g)` | `g.winner` from the game doc |
| `state.picks` in memory | `PS.myPicks(wk)` / `PS.savePicks(...)` |

Keep the demo generator behind a flag while you build. Being able to
run the UI with no network and no sign-in is worth a lot when you're
debugging layout at 11pm.

---

# Order I'd actually build this in

1. Steps 1–6. Get it on your own phone, signed in, no data. **Stop and
   confirm the update banner works** by pushing a trivial change — if
   updates don't work you'll fight it all season.
2. Step 7–8, then swap the schedule from demo to `PS.getWeek()`.
3. Picks: `savePicks` / `myPicks`. Test the lock by setting a kickoff
   two minutes out and watching the write get rejected.
4. Grid: `watchRevealed`.
5. Steps 9–10, scoring and push.
6. Then invite the family.

Don't invite anyone until 5 is done. A pool that scores wrong in Week 1
loses the room, and you don't get their attention back.

---

# Pre-kickoff reminders

`scripts/remind.py` + `.github/workflows/remind.yml`. Runs every 15
minutes Thursday through Monday and pushes only to people who are
actually missing picks.

## Four tiers

| Tier | When | Message |
|---|---|---|
| `open` | ~2 days out | "Week 4 is open. 16 games to pick." |
| `day` | ~1 day out | "Week 4 — 6 left." |
| `hours` | 90 min – 4 h out | "3 unpicked. 2 hours until kickoff." |
| `final` | 10 – 75 min out | "Last call — 3 games. Kickoff in 40 minutes." |

Nobody gets a message about games they've already picked. If you filled
out the whole week on Thursday, you hear nothing until results.

## Why windows instead of exact times

GitHub's cron is best-effort and routinely fires 10–20 minutes late.
Trying to send "exactly 60 minutes before kickoff" produces missed
sends and doubles.

So each tier is a **window**, and every send writes a marker doc at
`pools/{id}/reminders/{uid}_{season}_{wk}_{slot}_{tier}`. The script
checks that marker before sending. A late run still delivers; a double
run sends nothing twice. Wide windows plus a written record beats
precise timing you can't rely on.

Messages are grouped by kickoff instant, so the whole 1:00 slate is one
notification rather than eight.

## Timezones — set these before you invite anyone

Each member doc carries a `tz` field (IANA name, e.g.
`America/New_York`, `Asia/Tokyo`). Two things depend on it:

1. Kickoff times are written in the person's own local time
2. Quiet hours — nothing sends between 22:00 and 07:00 local, **except
   the `final` tier**, which always goes through

**This matters more than it looks if anyone is on JST.** A Sunday 1:00 PM
ET kickoff is 3:00 AM Monday in Japan. Without the timezone field the
script would tell them "Sunday 1:00 PM" for a game that locks while
they're asleep on Monday morning, and quiet hours would silence exactly
the reminders they need most. With `tz` set to `Asia/Tokyo` they get
"Mon 3:00 AM" and the last-call push still lands.

Practical consequence for a pool spread across Japan and the US: the
person on JST has to submit Sunday picks before bed Sunday night their
time, which is Sunday morning stateside. Worth saying out loud to the
family once, and worth considering a rule where their weekly deadline
is the Thursday game rather than each individual kickoff.

Capture `tz` at sign-up:

```js
await setDoc(doc(db,'pools',poolId,'members',user.uid), {
  tz: Intl.DateTimeFormat().resolvedOptions().timeZone
}, { merge: true });
```

## Dead tokens

Push tokens expire when someone reinstalls, clears data, or leaves the
app alone for months. The script catches `not-registered`, deletes the
token, and moves on. That person silently stops getting alerts, so if
someone says they've gone quiet, have them toggle alerts off and on.

## Test it before the season

1. Actions → *Pick reminders* → Run workflow with **dry run = true**
2. Read the log — it prints every person, their timezone, and how many
   picks they're missing, without sending anything
3. Run again with dry run off once you're happy

## Cost

Public repo: Actions minutes are free. Every 15 min × 5 days is about
480 runs a week at ~30 seconds each.

**Private repo: this will eat your free tier.** 4 hours a week against a
2,000 minute monthly allowance. Either make the repo public (the code
holds no secrets — the service account lives in GitHub Secrets) or drop
to `*/30` and lose some precision on the last-call tier.

---

# Time zones in the app

Kickoff is one moment in time. Store it once as a UTC `Timestamp` and
render it per person — never store `"1:00 PM"` as a string, or you will
be doing arithmetic in your head for the rest of the season.

## What is already wired

- **Every time is formatted locally** via `Intl.DateTimeFormat` from the
  kickoff instant. No conversion code, no DST table to maintain.
- **Day headers follow the viewer's calendar day.** In Japan the Sunday
  1:00 PM ET slate is Monday 2:00 AM, so the header reads MONDAY — with
  a small `SUNDAY SLATE` tag beside it so the US framing isn't lost.
- **A zone chip sits in the header** (`EDT`, `JST`, `CST`). Tap it to
  jump to the setting.
- **Settings → Time zone** offers the device zone plus common ones, so
  someone can check ET deadlines while sitting in Iwakuni. Saved to
  `localStorage`; in the real app write it to the member doc so
  reminders match what they see.
- **Countdowns were already immune.** "Locks in 4h 12m" is a duration —
  identical everywhere on earth. That's why the countdown is the primary
  deadline signal in the UI and the clock time is secondary.

## Store it on sign-up

```js
await setDoc(doc(db, 'pools', poolId, 'members', user.uid), {
  tz: Intl.DateTimeFormat().resolvedOptions().timeZone   // "Asia/Tokyo"
}, { merge: true });
```

`remind.py` reads that same field, so notification text and app text
agree. If they disagree, people stop trusting both.

## The part that isn't cosmetic

For anyone on JST the Sunday slate locks somewhere around 2:00–3:00 AM
Monday. The clock display can't fix that — it just stops it being a
surprise. Two options:

**Leave it.** They pick Sunday evening their time, which is Sunday
morning in the US. Works fine, needs saying out loud once.

**Give a single weekly deadline.** Lock the entire week at the Thursday
night kickoff instead of per-game. Everyone picks the full slate at one
moment, nobody is disadvantaged by sleeping, and the Grid reveals all at
once Thursday night — which is arguably more fun anyway.

The second is a small change: instead of comparing against each game's
kickoff, compare against the week's first kickoff.

```js
const weekLock = Math.min(...games.map(g => g.kick));
```

And in `firestore.rules`, swap `game().kickoff` for a `weekLock` field
written onto the pool config at import time. Same rule shape, one
timestamp instead of sixteen.

Worth deciding before Week 1. Changing it mid-season means explaining
to four people why the deadline moved.

---

# Ranks and points

**Rank 1 is your strongest pick. Rank 16 is your coin flip.**

Rank and points are two different things, and the gap between them is
the only thing about this convention that can trip you up. The number
you assign is a *rank*; what a correct pick *pays* is `17 − rank`.

| Rank | Pays | | Rank | Pays |
|---|---|---|---|---|
| **1** — lock of the week | **16** | | 9 | 8 |
| 2 | 15 | | 10 | 7 |
| 3 | 14 | | 11 | 6 |
| 4 | 13 | | 12 | 5 |
| 5 | 12 | | 13 | 4 |
| 6 | 11 | | 14 | 3 |
| 7 | 10 | | 15 | 2 |
| 8 | 9 | | **16** — coin flip | **1** |

- Perfect week: **136**
- Coin-flipping every game averages **68**
- One rank-1 miss costs 16 — the same as missing ranks 13, 14, 15 and 16 combined

## Where this lives in code

One constant in two files, and **they must agree**:

```js
// index.html
const RANK_ONE_IS_BEST = true;
const pay = r => !r ? 1 : (NGAMES + 1 - r);
```
```python
# scripts/score_week.py
RANK_ONE_IS_BEST = True
def pay(rank): ...
```

Flip both to `false`/`False` for the conventional pool where a stake of
16 pays 16. Nothing else changes — the stored field is still a 1–16
integer, and `firestore.rules` validates the range either way.

**If they ever disagree, the app shows one score and the standings show
another, and you will lose an evening to it.** Change them together.

## What people see

- The tray reads **1 → 16**, left to right, strongest first
- The stamp on a card is the rank
- The picker shows the rank large with `16 pts` underneath, so the
  payout is never a thing you have to remember
- The card footer reads `You took KC · rank 3 · 14 pts`
- In the Grid, a correct cell flips to **+14** — what it actually paid.
  Pending and missed cells stay as `#3`, the rank

## One thing to tell the family

Every other pool they'll ever join uses the opposite convention, where
16 is the lock and pays 16. "My number one pick" reads better and is how
people actually talk, which is why it's set this way — but it's worth
saying once so nobody carries the habit into an office pool and stakes
their season on a coin flip.

---

# The tiebreaker

Sits at the bottom of the Picks tab, under the last day of games. One
number: **combined points scored by both teams in the week's final
game** — Monday night.

## How it behaves

- Locks at that game's kickoff, same as any pick
- Everyone's guess stays sealed until then, same as any pick
- **You can't submit the week without it.** The bar reads
  "Tiebreaker still needs a number" until you fill it in
- Once Monday night kicks off, the Grid tab grows a tiebreaker panel
  showing every guess. When it goes final, the actual total appears,
  overshoots get struck through, and the winner is marked

## The rule

**Closest without going over.** If everybody overshoots, closest wins
outright. Anyone who never guessed sits behind anyone who did.

Only applied when two players finish the week on identical points. It
never changes the order of people who aren't tied.

```python
def key(r):
    g = guesses.get(r["uid"])
    if g is None:      return (2, 0)              # no guess, last
    if g <= actual:    return (0, actual - g)     # under, closest first
    return (1, g - actual)                        # over, only if nobody's under
```

## Storage

`pools/{poolId}/tiebreaks/{uid}_{week}`

```js
{ uid, wk, gameId, total: 47, revealAt: <kickoff>, updatedAt }
```

Same shape as a pick and the same four rule conditions: the doc id must
be yours, kickoff must still be ahead, `revealAt` must match the game's
kickoff, and `total` must be an integer from 0 to 120. Deployed in
`firestore.rules` under a `tiebreaks` block.

## Worth knowing

Real NFL games land between about 33 and 54 combined points, so guesses
cluster hard. Exact ties on the tiebreaker itself do happen in a
five-person pool.

Decide now what happens then — coin flip, earliest submission, or split
the week. Earliest submission is easy since `updatedAt` is already on
the document, and it quietly rewards picking early, which is the
behavior you want anyway.

---

# Betting lines

Lines don't exist months ahead. Books post the coming week's numbers
after Sunday's late window, plus a lookahead line roughly one more week
out. Nothing is priced in September for a Week 12 game.

**In the app:** a spread only renders when kickoff is within 8 days.
Outside that it shows a muted *line TBD*. One constant:

```js
const LINE_WINDOW = 8 * 24 * 3600 * 1000;
```

**In the data:** `import_schedule.py` writes matchups and kickoffs for
the whole season, and leaves `spread` empty for anything unpriced —
that's ESPN returning nothing, which is correct. `score_week.py` then
calls `pull_lines()` on every run and refreshes the current and next
week only. Lines fill in as the season moves.

Nothing in scoring depends on the spread. It's context for making a
pick, not an input to anything, so a missing line never breaks a week.

---

# Sign-in: email + PIN on your own domain

## Why a PIN and not a link

A magic link opens in the **default browser**, not the installed
home-screen app. Someone signs in successfully in Safari, opens the Pool
Sheet icon, and is still logged out. Same wall OAuth hits.

**Six digits never leave the app.** Switch to Mail, read the code, switch
back, type it. Works identically everywhere, installed or not. It is the
only flow immune to the PWA sandbox problem.

No password either. Nothing to forget, no reset flow to build, and it
proves they own the address as a side effect.

## The three clocks

| | Lifetime |
|---|---|
| **PIN** | 10 minutes, single use, 5 attempts |
| **Firebase session** | Indefinite in theory — but Safari evicts its storage after roughly a week idle |
| **Session cookie** | 90 days, and slides forward on every visit |

That middle row is why the cookie exists. Firebase keeps its session in
IndexedDB, which iOS clears after about a week of not visiting. For a
weekly pool that means people get signed out over bye weeks and the
offseason.

The Worker runs on **your** domain, so it can set a first-party
`HttpOnly` cookie — not script-writable storage, not subject to the same
eviction. On launch the app calls `/api/session`, gets a fresh Firebase
token, and is signed in without touching email.

**That is the real reason to pay for the domain.** Not the nice URL.

## Setup

1. **Buy the domain** and add it to Cloudflare (change nameservers).
2. **Cloudflare Pages** — connect the repo, deploy. Point the apex at it.
3. **Two KV namespaces:**
   ```bash
   wrangler kv namespace create PINS
   wrangler kv namespace create SESSIONS
   ```
   Paste the ids into `worker/wrangler.toml`.
4. **Secrets:**
   ```bash
   cd worker
   wrangler secret put SA_JSON      # the whole serviceAccount.json
   wrangler secret put RESEND_KEY
   ```
5. **Resend** — sign up, add the domain, set the DNS records it gives you.
6. **Deploy:** `wrangler deploy`

## Deliverability — do not skip this

**A PIN email in the spam folder is indistinguishable from a broken app,
and the person just gives up.** Set SPF, DKIM and DMARC — Resend gives
you the exact records, it takes about twenty minutes.

Send a test to **Gmail, Outlook and iCloud** specifically before you
invite anyone. Those three cover almost everybody and they behave
differently.

## Client wiring

```js
// on launch, before showing anything
const r = await fetch('/api/session', { credentials: 'include' });
if (r.ok) {
  const { token } = await r.json();
  await signInWithCustomToken(auth, token);   // straight in, no email
} else {
  showPinScreen();
}
```

```js
await fetch('/api/request-code', { method:'POST', credentials:'include',
  headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email }) });

const v = await fetch('/api/verify-code', { method:'POST', credentials:'include',
  headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email, code }) });
const { token } = await v.json();
await signInWithCustomToken(auth, token);
```

Firebase Console → Authentication → Sign-in method → enable **Anonymous**
(custom tokens need a provider enabled). Nothing else required.

## Security notes

- PINs are stored **hashed**, never in plaintext, and compared in
  constant time.
- `/api/request-code` always returns success, even for unknown
  addresses — otherwise it becomes a way to enumerate who is in the pool.
- 60-second cooldown per address, 5 verify attempts, then the code dies.
- The uid derives from a hash of the email, so the same address always
  lands on the same account.

## Costs

| | |
|---|---|
| Domain | $10–15/yr |
| Cloudflare Pages + Workers + KV | free |
| Resend | free to 3,000 emails/month |
| Firebase | free |
