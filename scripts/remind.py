#!/usr/bin/env python3
"""
Nag people who haven't picked yet.

Runs every 15 minutes on game days. For each upcoming kickoff window it
finds who is missing picks and pushes them a reminder — once per tier,
never twice.

    python scripts/remind.py --season 2026
    python scripts/remind.py --season 2026 --dry-run

WHY WINDOWS AND NOT EXACT TIMES
GitHub's cron is best-effort and routinely fires 10-20 minutes late. So
this does not try to send "exactly 60 minutes before kickoff." It asks
"which kickoffs fall inside this tier's window right now" and uses a
written record to guarantee each person gets each tier once. Late runs
still deliver; they just deliver a little late.
"""

import argparse, os, sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import firebase_admin
from firebase_admin import credentials, firestore, messaging

# tier key, window opens, window closes (minutes before kickoff), urgent?
# Windows are wide enough to survive a late cron and never overlap.
TIERS = [
    ("open",   2880, 1440, False),   # 2 days out — "the week is open"
    ("day",    1440,  600, False),   # ~1 day out
    ("hours",   240,   90, False),   # a few hours out
    ("final",    75,   10, True),    # last call
]

QUIET_START, QUIET_END = 22, 7      # local hours; urgent tier ignores these


def get_db():
    key = os.environ.get("FIREBASE_SERVICE_ACCOUNT_FILE", "serviceAccount.json")
    if not firebase_admin._apps:
        firebase_admin.initialize_app(credentials.Certificate(key))
    return firestore.client()


def quiet_now(tz_name):
    """True if it's the middle of the night for this person."""
    try:
        h = datetime.now(ZoneInfo(tz_name)).hour
    except Exception:
        return False
    return h >= QUIET_START or h < QUIET_END


def local_kick(dt, tz_name):
    try:
        return dt.astimezone(ZoneInfo(tz_name))
    except Exception:
        return dt.astimezone(ZoneInfo("America/New_York"))


def run(season, dry):
    """Two document reads per pool per run, and pushes go out in batches
    of 500. At 300 players that is ~4 reads a run instead of ~4,800."""
    db = get_db()
    now = datetime.now(timezone.utc)

    upcoming = [
        {"id": d.id, **d.to_dict()}
        for d in db.collection("seasons").document(str(season)).collection("games")
                   .where("kickoff", ">", now)
                   .where("kickoff", "<", now + timedelta(minutes=TIERS[0][1]))
                   .stream()
    ]
    if not upcoming:
        print("Nothing kicking off soon.")
        return
    weeks = sorted({g["wk"] for g in upcoming})
    print(f"{len(upcoming)} games in the next 48h, weeks {weeks}")

    for pool in db.collection("pools").where("season", "==", str(season)).stream():
        pid = pool.id
        pref = db.collection("pools").document(pid)

        # 1 read: everyone's name, timezone and device tokens
        roster = pref.collection("private").document("roster").get().to_dict() or {}
        if not roster:
            continue

        # 1 read per active week: who is still missing which games
        progress = {}
        for w in weeks:
            d = pref.collection("private").document(f"progress_w{w}").get().to_dict()
            if d:
                progress[w] = d.get("missing", {})

        sent_marks = []
        unreachable = set()
        for tier, lo, hi, urgent in TIERS:
            lo_t, hi_t = now + timedelta(minutes=hi), now + timedelta(minutes=lo)
            in_tier = [g for g in upcoming if lo_t <= g["kickoff"] <= hi_t]
            if not in_tier:
                continue

            slots = defaultdict(list)
            for g in in_tier:
                slots[g["kickoff"]].append(g)

            for kick, games in slots.items():
                slot_key = int(kick.timestamp())
                wk = games[0]["wk"]
                gids = {g["id"] for g in games}
                mins = int((kick - now).total_seconds() / 60)

                # Group people by how many they owe — one message per group,
                # one multicast per 500 recipients.
                groups = defaultdict(list)
                for uid, info in roster.items():
                    tokens = info.get("tokens") or []
                    if not tokens:
                        unreachable.add(info.get("name", uid))
                        continue
                    missing = [g for g in progress.get(wk, {}).get(uid, []) if g in gids]
                    if not missing:
                        continue
                    # Per-person opt-outs, set in Settings → Alerts.
                    if not (info.get("prefs") or {}).get(tier, True):
                        continue
                    tz = info.get("tz", "America/New_York")
                    if quiet_now(tz) and not urgent:
                        continue
                    groups[(len(missing), tz)].append((uid, tokens))

                for (n, tz), people in groups.items():
                    when = local_kick(kick, tz).strftime("%a %-I:%M %p")
                    title, body = compose(tier, wk, n, when, mins)

                    # Skip anyone already told about this slot at this tier.
                    fresh = []
                    for uid, tokens in people:
                        mid = f"{uid}_{season}_{wk}_{slot_key}_{tier}"
                        if pref.collection("reminders").document(mid).get().exists:
                            continue
                        fresh.append((uid, tokens, mid))
                    if not fresh:
                        continue

                    print(f"  [{tier}] {len(fresh)} people, {n} missing, {tz}, kick {when}")
                    if dry:
                        continue

                    flat = [(uid, t, mid) for uid, tokens, mid in fresh for t in tokens]
                    for i in range(0, len(flat), 500):
                        chunk = flat[i:i + 500]
                        resp = messaging.send_each_for_multicast(
                            messaging.MulticastMessage(
                                tokens=[c[1] for c in chunk],
                                notification=messaging.Notification(title=title, body=body),
                                webpush=messaging.WebpushConfig(
                                    fcm_options=messaging.WebpushFCMOptions(link="/index.html"),
                                    notification={"tag": f"ps-{wk}-{slot_key}",
                                                  "renotify": urgent})))
                        for c, r in zip(chunk, resp.responses):
                            if r.success:
                                continue
                            code = getattr(r.exception, "code", "")
                            if "not-registered" in str(code) or "invalid" in str(code):
                                prune_token(pref, c[0], c[1])

                    for uid, _, mid in fresh:
                        sent_marks.append((mid, {"sentAt": now, "uid": uid,
                                                 "tier": tier, "wk": wk, "missing": n}))

        if unreachable:
            print(f"  ! no push token, will hear nothing: {', '.join(sorted(unreachable))}")

        # One batched write for every marker.
        for i in range(0, len(sent_marks), 400):
            b = db.batch()
            for mid, data in sent_marks[i:i + 400]:
                b.set(pref.collection("reminders").document(mid), data)
            b.commit()


def compose(tier, wk, n, when, mins):
    g = "game" if n == 1 else "games"
    if tier == "open":
        return f"Week {wk} is open", f"{n} {g} to pick. First kickoff {when} your time."
    if tier == "day":
        return f"Week {wk}, {n} left", f"You still need {n} {'pick' if n==1 else 'picks'} before {when}."
    if tier == "hours":
        hrs = max(1, mins // 60)
        return f"{n} unpicked", f"{hrs} hour{'s' if hrs>1 else ''} until kickoff. After that they score zero."
    return f"Last call, {n} {g}", f"Kickoff in {mins} minutes. Unpicked games score zero."


def prune_token(pref, uid, token):
    """Drop a dead device token from the roster."""
    ref = pref.collection("private").document("roster")
    snap = ref.get().to_dict() or {}
    info = snap.get(uid) or {}
    toks = [t for t in (info.get("tokens") or []) if t != token]
    info["tokens"] = toks
    ref.set({uid: info}, merge=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, required=True)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    run(a.season, a.dry_run)
    print("Done.")


if __name__ == "__main__":
    sys.exit(main())
