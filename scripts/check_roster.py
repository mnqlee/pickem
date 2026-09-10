#!/usr/bin/env python3
"""
Who is going to silently get no notifications?

A missing push token is invisible. That person hears nothing from the
app all season, assumes it is broken, and stops playing. Nobody reports
it, because there is nothing to report.

Run this after you invite people and before Week 1 opens.

    python scripts/check_roster.py --season 2026
    python scripts/check_roster.py --season 2026 --pool POOLID
"""

import argparse, sys
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import firebase_admin
from firebase_admin import credentials, firestore


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", required=True)
    ap.add_argument("--pool")
    a = ap.parse_args()

    firebase_admin.initialize_app(credentials.Certificate("serviceAccount.json"))
    db = firestore.client()

    pools = ([db.collection("pools").document(a.pool).get()] if a.pool
             else list(db.collection("pools").where("season", "==", str(a.season)).stream()))

    problems = 0
    for pool in pools:
        if not pool.exists:
            continue
        pd, pid = pool.to_dict(), pool.id
        print(f"\n{pd.get('name')}  ({pid})  season {pd.get('season')}")

        roster = (db.collection("pools").document(pid)
                    .collection("private").document("roster").get().to_dict() or {})
        members = {m.id: m.to_dict() for m in
                   db.collection("pools").document(pid).collection("members").stream()}

        if not roster:
            print("  ! roster document is empty. Nobody will get anything.")
            problems += 1
            continue

        print(f"  {len(roster)} in roster, {len(members)} members\n")
        print(f"  {'name':<18}{'alerts':<9}{'timezone':<22}status")
        print("  " + "-" * 62)

        for uid, info in sorted(roster.items(), key=lambda kv: (kv[1] or {}).get("name", "")):
            if uid.startswith("_"):
                continue
            info = info or {}
            name = info.get("name", "(no name)")
            tokens = info.get("tokens") or []
            tz = info.get("tz", "")
            notes = []
            if not tokens:
                notes.append("NO ALERTS")
                problems += 1
            if not tz:
                notes.append("no timezone, will assume Eastern")
                problems += 1
            if uid not in members:
                notes.append("in roster but not a member")
                problems += 1
            local = ""
            if tz:
                try:
                    local = datetime.now(ZoneInfo(tz)).strftime("%a %H:%M")
                except Exception:
                    notes.append("bad timezone")
                    problems += 1
            print(f"  {name[:17]:<18}{len(tokens):<9}{(tz or '-')[:21]:<22}"
                  f"{', '.join(notes) if notes else 'ok  ' + local}")

        # anyone signed in who never reached the roster at all
        ghosts = [m for m in members if m not in roster]
        if ghosts:
            print(f"\n  ! {len(ghosts)} member(s) with no roster entry — they joined but "
                  f"upsertRoster() never ran. They get nothing.")
            problems += len(ghosts)

    print()
    if problems:
        print(f"{problems} problem(s). Anyone marked NO ALERTS will hear nothing all season.")
        # THIS LINE USED TO SAY "have them open the app; the banner offers a
        # one-tap fix", and there was no banner. Worse, opening the app could
        # not possibly help: refreshPushToken() returns on its first line
        # unless permission is ALREADY granted, so the only code path that
        # registered a token was a button on the onboarding screen, which a
        # returning player never sees again. Advice that cannot work is worse
        # than none — the owner chases people, the people do as asked,
        # nothing changes, and everyone concludes the app is broken. The
        # banner exists now (renderAlertFix() in index.html).
        print("Tell them: open the app, Settings, then tap 'Turn alerts on' in")
        print("the red box at the top of the Alerts panel.")
        print()
        print("On a version older than v1.30.0 that box does not exist. There the")
        print("path is Settings -> Sign out, sign back in with THE SAME email, and")
        print("tap 'Keep me honest' when it is offered.")
        print()
        print("iPhone users must add the app to their Home Screen first. iOS")
        print("cannot deliver web push to a Safari tab, whatever they tap.")
        return 1
    print("Everyone is registered. Alerts will reach the whole pool.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
