# START HERE

Line by line, in order, nothing assumed. Roughly 4 hours of actual work.

**Cost:** $10–15 for the domain. Everything else is free.

Tick each box. Do not skip ahead — later steps depend on earlier ones.

---

## What you need open

- A terminal
- <https://console.firebase.google.com>
- <https://dash.cloudflare.com>
- <https://resend.com>
- Your phone

Check your machine first:

```bash
node --version      # need 18 or higher
python3 --version   # need 3.10 or higher
git --version
```

Missing Node → <https://nodejs.org>. Missing Python → <https://python.org>.

---

# PART 1 · The domain (do this first, it takes longest)

DNS propagation is the only thing you cannot speed up. Start it, then do
Part 2 while it settles.

**1.1** Go to <https://dash.cloudflare.com> → sign up or log in.

**1.2** Left sidebar → **Domain Registration** → **Register Domain**.

**1.3** Search something short with no hyphens. People read these aloud.
Examples: `poolsheet.app`, `weeklypickem.co`.

**1.4** Buy it. Cloudflare sells at cost, about $10–15/year.

**1.5** It appears in your dashboard as **Active** within minutes,
because Cloudflare is already the registrar and the nameservers.

> Bought elsewhere? Add the site to Cloudflare, change the nameservers at
> your registrar, and wait. Can take up to 24 hours. Continue with Part 2
> while you wait.

---

# PART 2 · Firebase

**2.1** <https://console.firebase.google.com> → **Create a project**.

**2.2** Name it `pickem`. Continue.

**2.3** **Turn Google Analytics OFF.** You do not need it and it adds a
consent notice you would have to explain. Create project. Wait. Continue.

**2.4** Left sidebar → **Build** → **Firestore Database** → **Create database**.

**2.5** Choose **Production mode**. Not test mode — test mode expires
after 30 days and everything silently stops working mid-season.

**2.6** Location: `nam5 (us-central)`. Enable.

**2.7** **Build** → **Authentication** → **Get started**.

**2.8** **Sign-in method** tab → **Anonymous** → toggle Enable → Save.

> Only Anonymous. You are not using Google sign-in. The auth Worker mints
> custom tokens, and custom tokens require at least one provider enabled.

**2.9** Gear icon (top left) → **Project settings** → scroll to
**Your apps** → click the web icon `</>`.

**2.10** Nickname `pickem-web` → **Register app**.

**2.11** Copy the whole `firebaseConfig = { ... }` object.

**2.12** In your project folder, open `firebase-init.js`. Replace the
block at the top that says `PASTE_ME` with what you copied. It should
end up looking like:

```js
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "pickem-xxxx.firebaseapp.com",
  projectId: "pickem-xxxx",
  storageBucket: "pickem-xxxx.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123:web:abc"
};
```

> These keys are public by design. They identify the project; they do not
> grant access. `firestore.rules` grants access.

**2.13** Project settings → **Cloud Messaging** tab → scroll to
**Web configuration** → **Generate key pair**.

**2.14** Copy that key. In `firebase-init.js`, replace:

```js
const VAPID_KEY = "PASTE_ME";
```

**2.15** Create a new file `firebase-messaging-sw.js` in the project
root — same folder as `index.html`:

```js
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');
firebase.initializeApp({
  // paste the SAME firebaseConfig object here
});
firebase.messaging();
```

> Yes, a second service worker. Firebase requires this exact filename at
> the root. It does not conflict with `sw.js`.

**2.16** Project settings → **Service accounts** tab → **Generate new
private key** → **Generate key**. Save the downloaded file as
`serviceAccount.json` in your project root.

**2.17** Immediately verify it will never be committed:

```bash
cd path/to/poolsheet
cat .gitignore | grep serviceAccount
```

Must print `serviceAccount.json`. If not, stop and add it.

---

# PART 3 · Get the code online

**3.1**

```bash
cd path/to/poolsheet
git init
git add .
git commit -m "Weekly NFL Pick'em"
```

**3.2** Confirm the key is not in the commit:

```bash
git ls-files | grep serviceAccount
```

**Must print nothing.** If it prints the filename, run
`git rm --cached serviceAccount.json` and commit again.

**3.3** Go to <https://github.com/new>. Name: `pickem`. **Public.**
Do not add a README. Create.

> Public matters: GitHub Actions minutes are unlimited on public repos.
> No secrets live in the code.

**3.4**

```bash
git remote add origin https://github.com/YOURNAME/pickem.git
git branch -M main
git push -u origin main
```

**3.5** Cloudflare dashboard → **Workers & Pages** → **Create** →
**Pages** tab → **Connect to Git**.

**3.6** Authorise GitHub, pick `pickem`, **Begin setup**.

**3.7** Build settings:
- Framework preset: **None**
- Build command: **leave empty**
- Build output directory: `/`

**3.8** **Save and Deploy.** About a minute.

**3.9** In the Pages project → **Custom domains** → **Set up a custom
domain** → type your apex domain (no `www`) → **Activate domain**.

**3.10** Open `https://yourdomain.com` on your phone. You should see the
app with an amber **Demo data** banner. Good — that is expected until
Part 7.

---

# PART 4 · Email

**4.1** <https://resend.com> → sign up.

**4.2** **Domains** → **Add Domain** → enter your domain → Add.

**4.3** Resend shows DNS records — SPF, DKIM, DMARC. Keep the tab open.

**4.4** Cloudflare → your domain → **DNS** → **Records** → add each one
exactly as Resend shows it. **Set the proxy status to DNS only (grey
cloud)** for all of them.

**4.5** Back in Resend → **Verify DNS Records**. Usually a few minutes.

**4.6** **API Keys** → **Create API Key** → name it `pickem`, permission
**Sending access** → Add. **Copy it now, you cannot see it again.**

---

# PART 5 · The two Workers

**5.1**

```bash
npm install -g wrangler
wrangler login
```

A browser opens. Authorise.

**5.2** Edit `worker/wrangler.toml` — replace all three occurrences of
`yourdomain.com` with your actual domain.

**5.3**

```bash
cd worker
wrangler kv namespace create PINS
wrangler kv namespace create SESSIONS
```

Each prints an `id = "..."`. Paste them into the matching `REPLACE_ME`
in `wrangler.toml`.

**5.4** Secrets for the auth Worker:

```bash
wrangler secret put SA_JSON
```

Paste the **entire contents** of `serviceAccount.json`, then press
**Ctrl+D**.

```bash
wrangler secret put RESEND_KEY
```

Paste the Resend key, Ctrl+D.

**5.5**

```bash
wrangler deploy
```

**5.6** Test it:

```bash
curl -X POST https://yourdomain.com/api/request-code \
  -H 'Content-Type: application/json' \
  -d '{"email":"YOUR@EMAIL.COM"}'
```

Expect `{"ok":true}` and an email within seconds.

**Check spam.** If it is in spam, your DNS records are not right. Fix
that now — a sign-in code in spam is indistinguishable from a broken app.

**5.7** Now the live Worker. Edit `worker/wrangler-live.toml`:
- `GCP_PROJECT` = your Firebase project id (from `firebaseConfig`)
- `SEASON` = `2026PRE`
- KV `id` = the **same SESSIONS id** from 5.3

**5.8**

```bash
wrangler secret put SA_JSON -c wrangler-live.toml     # same JSON, Ctrl+D
wrangler secret put ADMIN_KEY -c wrangler-live.toml   # any long random string, save it
wrangler deploy -c wrangler-live.toml
cd ..
```

---

# PART 6 · Rules and data

**6.1** Firebase console → **Firestore Database** → **Rules** tab.
Delete everything in the box. Paste the entire contents of
`firestore.rules`. **Publish.**

**Nothing works until this is done.**

**6.2**

```bash
pip install firebase-admin requests
```

**6.3** Create the preseason pool:

```bash
python scripts/setup_preseason.py --season 2026
```

**Write down the POOL ID and the JOIN CODE it prints.**

**6.4** Import the preseason schedule:

```bash
python scripts/import_schedule.py --season 2026 --preseason --dry-run
```

Read the output. If the matchups look right:

```bash
python scripts/import_schedule.py --season 2026 --preseason
```

**6.5** **Spot-check one kickoff time.** Firebase console → Firestore →
`seasons` → `2026PRE` → `games` → open any document → compare `kickoff`
against the real schedule.

> Kickoff times are stored in UTC. If these are wrong, every lock in the
> app is wrong, and nothing will tell you. This is the single most
> important check in this document.

---

# PART 7 · Turn off demo mode

**7.1** Open `index.html`. Near the top of the `<script>` block:

```js
const DEMO = true;
```

Change to:

```js
const DEMO = false;
```

**7.2** Two lines below, confirm:

```js
const SEASON = '2026PRE';
```

**7.3** Confirm all three season values agree:

```bash
bash scripts/check.sh
```

Every line must be a green ✓. Fix anything red before continuing.

**7.4**

```bash
git add .
git commit -m "go live"
git push
```

Cloudflare redeploys in about a minute.

---

# PART 8 · Your own phone

Do every one of these yourself before anyone else sees it.

**8.1** Open `https://yourdomain.com/?join=YOURCODE` in **Safari** on
your iPhone.

**8.2** You should see the sign-in screen with the animated card. Enter
your name and email → **Deal me in**.

**8.3** Check email, enter the six digits. You should land in the app.

**8.4** Share button → **Add to Home Screen** → Add.

**8.5** Open it from the new icon. **You should still be signed in** —
that is the session cookie working. If it asks for a code again,
`/api/session` is not being reached; check the route in
`worker/wrangler.toml`.

**8.6** Turn on alerts when prompted.

**8.7** Set yourself as owner. Firebase → Authentication → Users → copy
your **User UID**. Then:

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

**8.8** Make some picks. Force-quit the app. Reopen. **The picks must
still be there.**

**8.9** Test a push right now:

```bash
curl "https://pickem-live.YOURNAME.workers.dev/__live/test?key=YOURADMINKEY&name=YOURNAME"
```

Your phone should buzz within seconds.

**8.10** Test the update flow. Open `sw.js`, change:

```js
const VERSION = 'v1.0.0';
```

to `v1.0.1`. Then:

```bash
git add . && git commit -m "test update" && git push
```

Wait a minute, reopen the app. You should get a red **A new version is
ready** banner. **Do not skip this** — if updates do not reach phones you
will fight it all season.

---

# PART 9 · The kickoff lock

The one behaviour everything else rests on. Test it deliberately.

**9.1** Firebase → Firestore → `seasons/2026PRE/games` → pick any game
that has not started.

**9.2** Edit its `kickoff` to **two minutes from now**. Save.

**9.3** In the app, watch that card. The countdown should turn red, then
the card should lock and grey out.

**9.4** Try to change that pick. **It must refuse.**

**9.5** Set the `kickoff` back to the real time.

---

# PART 10 · Invite people

**10.1** Send this:

> Testing a pick 'em app for the last preseason weekend before we run it
> for real. Takes a minute:
>
> **https://yourdomain.com/?join=YOURCODE**
>
> **Add it to your Home Screen when it asks** — notifications don't work
> on iPhone otherwise, and the reminders are the whole point.
>
> Text me anything that looks wrong, however small.

**10.2** Once they have joined:

```bash
python scripts/check_roster.py --season 2026PRE
```

**10.3** Anyone showing **NO ALERTS**: tell them to open the app and tap
the amber banner at the top.

**10.4** Run it again. Everyone should be clear.

**10.5** Send everyone a test push:

```bash
curl "https://pickem-live.YOURNAME.workers.dev/__live/test?key=YOURADMINKEY"
```

---

# PART 11 · The weekend

**Leave the code alone** unless something is completely broken. Take
notes.

**Saturday afternoon:** check the Worker is running.

```bash
cd worker && wrangler tail -c wrangler-live.toml
```

Watch for a minute. You should see score checks. Ctrl+C to stop.

**What to write down:**
- Did reminders arrive, on time, to everyone?
- Did the Grid fill in as games kicked off?
- Did anyone get locked out who should not have been?
- Did scores update during games?
- Did anyone lose picks?

---

# PART 12 · Handover to the real season

**12.1** Keep the record before deleting anything:

```bash
python scripts/archive_pool.py --from PREPOOLID --to REALPOOLID \
    --label "Preseason 2026"
```

(Create the real pool first — `BUILD.md` Part 7.3.)

**12.2** Real schedule:

```bash
python scripts/import_schedule.py --season 2026
```

**12.3** Set `SEASON = '2026'` in **all three**: `index.html`,
`firebase-init.js`, `worker/wrangler-live.toml`. Redeploy the Worker:

```bash
cd worker && wrangler deploy -c wrangler-live.toml && cd ..
bash scripts/check.sh
git add . && git commit -m "regular season" && git push
```

**12.4** Wipe the preseason pool:

```bash
python scripts/reset_pool.py --pool PREPOOLID --season 2026PRE --dry-run
python scripts/reset_pool.py --pool PREPOOLID --season 2026PRE --yes
```

**12.5** Hide the archive tab:

```bash
python scripts/archive_pool.py --to REALPOOLID --id preseason-2026 --off
```

**12.6** Send the **new join link**. Everyone must tap it — the join code
binds a person to a pool, and it changed. Say so plainly or a few people
will open the old icon, see an empty week, and assume it broke.

---

# Every time you change anything, forever

```bash
# 1. BUMP THE VERSION IN sw.js  ← the step everyone forgets
# 2.
git add . && git commit -m "what changed" && git push
```

Forget the bump and people sit on stale versions.

---

# When something is wrong

| Symptom | Cause |
|---|---|
| `permission-denied` in console | Rules not published — 6.1 |
| Code email never arrives | DNS not verified, or check spam — Part 4 |
| `{"ok":true}` but no email | Rate limited (60s) or unknown address. `wrangler tail` |
| Signed out every launch | `/api/session` unreachable. Check the route in `wrangler.toml` |
| No notifications on iPhone | Not on the Home Screen. Apple requires it |
| Some people get no alerts | Run `check_roster.py`, look for NO ALERTS |
| Grid empty during games | `wrangler tail -c wrangler-live.toml` |
| Standings not updating | Actions → Score the week → Run workflow, read the log |
| Game locked at the wrong time | Kickoff imported in local time, not UTC — 6.5 |
| Updates not reaching phones | `VERSION` in `sw.js` not bumped |
| App shows demo data | `DEMO` still `true` — 7.1 |
| Blank screen, console errors | `node scripts/smoke-test.js` |

---

# The three that actually matter

**6.5** — kickoff times in UTC. Wrong here, everything locks wrong.

**8.10** — the update banner. If this does not work you cannot ship fixes
all season.

**9.4** — the lock refusing a late pick. Everything else degrades
gracefully. A late-pick bug silently invalidates the whole competition
and you will not find out until someone wins a week they should not have.
