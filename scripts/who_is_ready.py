#!/usr/bin/env python3
"""
Who has finished their picks, and who has not.

THE APP CANNOT SHOW YOU THIS, BY DESIGN. Everybody's picks stay hidden
until each game kicks off — that is the whole point of the Grid opening
one game at a time — and `firestore.rules` enforces it for every player
including you. So there is no screen anywhere that answers "who still
owes me picks", and there should not be one: an owner who could read
picks early would be an owner with an advantage.

This script reads with the ADMIN service account, which is outside those
rules. That is why it is a script on your machine and not a tab in the
app. Use it to know who to nudge, not to look at what anyone picked —
it deliberately prints COUNTS ONLY and never a team name.

    python scripts/who_is_ready.py --season 2026
    python scripts/who_is_ready.py --season 2026 --week 3
    python scripts/who_is_ready.py --season 2026 --nudge

--nudge prints just the names and emails of people with something
missing, ready to paste into a message. Nothing is sent by this script.

READ-ONLY. It writes nothing, anywhere.
"""

import argparse, sys
from datetime import datetime, timezone

import firebase_admin
from firebase_admin import credentials, firestore


def pick_week(games_by_week, now):
    """The week a person would call 'this week'.

    Same rule the app uses (see weekOpen in index.html): the first week
    still holding a game that is not final and kicked off less than six
    hours ago. Falls back to the last week that exists, so the script
    still says something sensible in February.
    """
    SIX_H = 6 * 3600
    for wk in sorted(games_by_week):
        for g in games_by_week[wk]:
            kick = g.get("kickoff")
            if kick is None:
                continue
            ks = kick.timestamp() if hasattr(kick, "timestamp") else float(kick) / 1000
            if g.get("status") != "final" and now.timestamp() < ks + SIX_H:
                return wk
    return max(games_by_week) if games_by_week else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", required=True)
    ap.add_argument("--week", type=int, help="default: the current week")
    ap.add_argument("--pool")
    ap.add_argument("--nudge", action="store_true",
                    help="print only the people with something missing")
    a = ap.parse_args()

    firebase_admin.initialize_app(credentials.Certificate("serviceAccount.json"))
    db = firestore.client()
    now = datetime.now(timezone.utc)

    # ---- the schedule -------------------------------------------------
    games_by_week = {}
    for g in db.collection("seasons").document(str(a.season)).collection("games").stream():
        d = g.to_dict() or {}
        d["_id"] = g.id
        games_by_week.setdefault(d.get("wk"), []).append(d)
    games_by_week.pop(None, None)
    if not games_by_week:
        print(f"No games found for season {a.season}. Is --season right?")
        return 1

    wk = a.week or pick_week(games_by_week, now)
    games = games_by_week.get(wk, [])
    if not games:
        print(f"Week {wk} has no games.")
        return 1

    # Games already kicked off cannot be picked any more, so counting them
    # as "missing" would nag about something nobody can fix. Split them out.
    def kicked(g):
        k = g.get("kickoff")
        if k is None:
            return False
        ks = k.timestamp() if hasattr(k, "timestamp") else float(k) / 1000
        return now.timestamp() >= ks
    open_ids = {g["_id"] for g in games if not kicked(g)}
    shut_ids = {g["_id"] for g in games if kicked(g)}
    last_kick = max((g.get("kickoff") for g in games if g.get("kickoff")), default=None)

    pools = ([db.collection("pools").document(a.pool).get()] if a.pool
             else list(db.collection("pools").where("season", "==", str(a.season)).stream()))

    for pool in pools:
        if not pool.exists:
            continue
        pd, pid = pool.to_dict(), pool.id
        print(f"\n{pd.get('name')}  ({pid})")
        print(f"Week {wk} — {len(games)} games, {len(open_ids)} still open, "
              f"{len(shut_ids)} already locked\n")

        members = {m.id: (m.to_dict() or {}) for m in
                   db.collection("pools").document(pid).collection("members").stream()}

        # One query for the week, not one per player.
        picked, ranked = {}, {}
        for p in (db.collection("pools").document(pid).collection("picks")
                    .where("wk", "==", wk).stream()):
            d = p.to_dict() or {}
            if d.get("winner") is None:          # a cleared pick is not a pick
                continue
            uid = d.get("uid")
            picked.setdefault(uid, set()).add(d.get("gameId"))
            if d.get("weight") is not None:
                ranked.setdefault(uid, set()).add(d.get("gameId"))

        tb = {t.to_dict().get("uid") for t in
              (db.collection("pools").document(pid).collection("tiebreaks")
                 .where("wk", "==", wk).stream())}

        rows, chase = [], []
        for uid, m in members.items():
            name = m.get("name") or "(no name)"
            email = m.get("email") or ""
            mine_p, mine_r = picked.get(uid, set()), ranked.get(uid, set())
            miss_p = len(open_ids - mine_p)
            miss_r = len((open_ids | shut_ids) - mine_r)
            done = miss_p == 0 and miss_r == 0 and uid in tb
            rows.append((done, name, len(mine_p), len(games), miss_p, miss_r, uid in tb))
            if not done:
                chase.append((name, email, miss_p, miss_r, uid in tb))

        if a.nudge:
            if not chase:
                print("  Everybody is done. Nothing to chase.")
            else:
                print(f"  {len(chase)} still to finish:\n")
                for name, email, mp, mr, has_tb in sorted(chase):
                    bits = []
                    if mp: bits.append(f"{mp} unpicked")
                    if mr: bits.append(f"{mr} unranked")
                    if not has_tb: bits.append("no tiebreaker")
                    print(f"  {name:<20}{email:<32}{', '.join(bits)}")
        else:
            print(f"  {'name':<20}{'picked':<10}{'status'}")
            print("  " + "-" * 60)
            for done, name, np, tot, mp, mr, has_tb in sorted(rows, key=lambda r: (r[0], r[1])):
                if done:
                    status = "ready"
                else:
                    bits = []
                    if mp: bits.append(f"{mp} unpicked")
                    if mr: bits.append(f"{mr} unranked")
                    if not has_tb: bits.append("no tiebreaker")
                    status = ", ".join(bits)
                print(f"  {name[:19]:<20}{f'{np}/{tot}':<10}{status}")

            ready = sum(1 for r in rows if r[0])
            print(f"\n  {ready} of {len(rows)} ready.")
            if last_kick is not None:
                secs = (last_kick.timestamp() if hasattr(last_kick, 'timestamp')
                        else float(last_kick) / 1000) - now.timestamp()
                if secs > 0:
                    print(f"  Last kickoff of the week is in "
                          f"{int(secs // 86400)}d {int(secs % 86400 // 3600)}h.")

    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
