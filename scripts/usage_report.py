#!/usr/bin/env python3
"""
How the app is actually used. Nothing about who is using it.

WHAT THIS ANSWERS, and none of it was visible before. How many times the
app was opened, whether people open it from the Home Screen or a browser
tab, how long a session lasts, which tabs they sit on, and for each tab
the total, the average, the shortest and the longest.

THE INTERESTING ONE IS PICKS DURING A SLATE. Time on Picks while games
are running is the closest thing this pool has to "are people actually
watching with this open", and it is the number most worth having before
deciding what to improve next season.

WHAT IS NOT HERE, ON PURPOSE. No uid, no name, no email. The session id
is minted fresh on every launch and never stored, so two sessions by the
same person cannot be joined up afterwards, by this script or by
anything else. firestore.rules enforces that by allowing only six keys
on these documents, so it is a property of the database rather than a
promise about the client.

READ-ONLY. It writes nothing and deletes nothing.

    python scripts/usage_report.py --season 2026
    python scripts/usage_report.py --season 2026 --days 7
    python scripts/usage_report.py --season 2026 --since 2026-09-27 --until 2026-09-29
    python scripts/usage_report.py --season 2026 --csv usage.csv

Run it from the folder that holds serviceAccount.json.
"""

import argparse
import csv
import os
import sys
from datetime import datetime, timedelta, timezone

TABS = ["picks", "grid", "standings", "help", "settings"]


def ms(v):
    """Milliseconds as something a person reads at a glance."""
    v = int(v or 0)
    if v < 1000:
        return f"{v}ms"
    s = v / 1000.0
    if s < 60:
        return f"{s:.0f}s"
    m = s / 60.0
    if m < 60:
        return f"{m:.1f}m"
    return f"{m/60.0:.1f}h"


def pct(part, whole):
    return "0%" if not whole else f"{100.0*part/whole:.0f}%"


def _ts(v):
    if v is None:
        return None
    if hasattr(v, "timestamp"):
        return v.timestamp()
    return float(v) / 1000


def summarise(rows):
    """Everything the report prints, computed in one place.

    SEPARATED FROM FIRESTORE SO IT CAN BE TESTED. The aggregation is the
    part with arithmetic in it, and arithmetic is the part that is wrong
    quietly. scripts/test/test_usage_report.py drives this function with
    fixture rows and never touches a database.
    """
    out = {
        "sessions": len(rows),
        "standalone": 0,
        "browser": 0,
        "total_visible": 0,
        "session_ms": [],
        "by_day": {},
        "tabs": {t: [] for t in TABS},
        "other_tabs": {},
    }
    for r in rows:
        mode = r.get("mode") or "browser"
        if mode == "standalone":
            out["standalone"] += 1
        else:
            out["browser"] += 1

        vis = int(r.get("visibleMs") or 0)
        out["total_visible"] += vis
        # A session with no visible time at all is a launch that was
        # backgrounded before anything could accrue. It counts as a visit
        # and would drag every duration average toward zero, so it is
        # kept in the session count and left out of the timings.
        if vis > 0:
            out["session_ms"].append(vis)

        ts = _ts(r.get("started"))
        if ts is not None:
            day = datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%d")
            out["by_day"][day] = out["by_day"].get(day, 0) + 1

        tabs = r.get("tabs") or {}
        for name, v in tabs.items():
            v = int(v or 0)
            if v <= 0:
                continue          # never opened in this session
            if name in out["tabs"]:
                out["tabs"][name].append(v)
            else:
                # A tab that no longer exists, or a new one added since.
                out["other_tabs"].setdefault(name, []).append(v)
    return out


def stat_line(name, vals, total_visible):
    """Total, share, sessions that touched it, average, shortest, longest."""
    if not vals:
        return f"  {name:<11} {'-':>8}  {'':>5}  {0:>5}  {'-':>8} {'-':>8} {'-':>8}"
    tot = sum(vals)
    return (f"  {name:<11} {ms(tot):>8}  {pct(tot, total_visible):>5}  "
            f"{len(vals):>5}  {ms(tot/len(vals)):>8} {ms(min(vals)):>8} "
            f"{ms(max(vals)):>8}")


def report(s, label):
    print(f"\n{'='*66}\n  {label}\n{'='*66}")
    if not s["sessions"]:
        print("\n  No sessions recorded in this window.")
        print("  If that is unexpected: the tracker ships in v1.40.0, and")
        print("  firestore.rules must be deployed for the writes to land.")
        return

    print(f"\n  Sessions (app opens)   {s['sessions']}")
    print(f"    from the Home Screen {s['standalone']:>5}  "
          f"({pct(s['standalone'], s['sessions'])})")
    print(f"    from a browser tab   {s['browser']:>5}  "
          f"({pct(s['browser'], s['sessions'])})")

    d = s["session_ms"]
    print(f"\n  Time with the app on screen")
    print(f"    total                {ms(s['total_visible']):>8}")
    if d:
        srt = sorted(d)
        med = srt[len(srt)//2] if len(srt) % 2 else (srt[len(srt)//2-1]+srt[len(srt)//2])/2
        print(f"    average session      {ms(sum(d)/len(d)):>8}")
        print(f"    median session       {ms(med):>8}")
        print(f"    shortest             {ms(min(d)):>8}")
        print(f"    longest              {ms(max(d)):>8}")
        if len(d) != s["sessions"]:
            print(f"    ({s['sessions']-len(d)} session(s) recorded no on-screen "
                  f"time at all and are left out of these averages)")

    print(f"\n  By tab")
    print(f"  {'tab':<11} {'total':>8}  {'share':>5}  {'used':>5}  "
          f"{'average':>8} {'shortest':>8} {'longest':>8}")
    for t in TABS:
        print(stat_line(t, s["tabs"][t], s["total_visible"]))
    for t, vals in sorted(s["other_tabs"].items()):
        print(stat_line(t + " *", vals, s["total_visible"]))
    if s["other_tabs"]:
        print("  * a tab name this script does not know about")

    print(f"\n  Sessions per day")
    for day in sorted(s["by_day"]):
        n = s["by_day"][day]
        print(f"    {day}   {n:>4}  {'#'*min(n, 50)}")


def main():
    ap = argparse.ArgumentParser(
        description="How the app is used. Anonymous, read-only.")
    ap.add_argument("--season", required=True)
    ap.add_argument("--pool")
    ap.add_argument("--days", type=int,
                    help="look back this many days (default 14)")
    ap.add_argument("--since", help="YYYY-MM-DD, UTC")
    ap.add_argument("--until", help="YYYY-MM-DD, UTC")
    ap.add_argument("--csv", help="also write one row per session to this file")
    a = ap.parse_args()

    if a.csv and os.path.isdir(a.csv):
        print(f"{a.csv} is a directory. Give me a file name.")
        return 1

    try:
        import firebase_admin
        from firebase_admin import credentials, firestore
    except ImportError:
        print("firebase_admin is not installed here. From the repo root:")
        print("  pip install -r requirements.txt")
        return 1
    if not os.path.exists("serviceAccount.json"):
        print("serviceAccount.json is not in this folder, so there is no way")
        print("to reach the database. Run this from the repo root:")
        print("  cd C:\\\\Users\\\\ancon\\\\Downloads\\\\poolsheet")
        return 1

    firebase_admin.initialize_app(credentials.Certificate("serviceAccount.json"))
    db = firestore.client()

    now = datetime.now(timezone.utc)
    if a.since:
        start = datetime.strptime(a.since, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    else:
        start = now - timedelta(days=a.days or 14)
    end = (datetime.strptime(a.until, "%Y-%m-%d").replace(tzinfo=timezone.utc)
           + timedelta(days=1)) if a.until else now

    if a.pool:
        snap = db.collection("pools").document(a.pool).get()
        if not snap.exists:
            print(f"No pool {a.pool}.")
            return 1
        pools = [snap]
    else:
        pools = list(db.collection("pools")
                     .where("season", "==", str(a.season)).stream())
    if len(pools) != 1:
        print(f"Found {len(pools)} pools for season {a.season}. "
              f"Name one with --pool.")
        for p in pools:
            print(f"  {p.id}  {(p.to_dict() or {}).get('name','')}")
        return 1
    pool = pools[0]

    rows = []
    for d in pool.reference.collection("usage").stream():
        v = d.to_dict() or {}
        ts = _ts(v.get("started"))
        if ts is None or not (start.timestamp() <= ts < end.timestamp()):
            continue
        rows.append(v)

    label = (f"Pool {pool.id}   "
             f"{start.strftime('%Y-%m-%d')} to {end.strftime('%Y-%m-%d')} UTC")
    report(summarise(rows), label)

    if a.csv:
        with open(a.csv, "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["started_utc", "mode", "wk", "visible_ms"] + TABS)
            for r in sorted(rows, key=lambda x: _ts(x.get("started")) or 0):
                t = r.get("tabs") or {}
                ts = _ts(r.get("started"))
                w.writerow([
                    datetime.fromtimestamp(ts, timezone.utc).isoformat()
                    if ts else "",
                    r.get("mode", ""), r.get("wk", ""),
                    int(r.get("visibleMs") or 0)]
                    + [int(t.get(k) or 0) for k in TABS])
        print(f"\n  Wrote {len(rows)} rows to {a.csv}")

    print("\n  Anonymous by construction: these rows carry no uid, no name")
    print("  and no email, and a session id that is never reused. There is")
    print("  no way to tell from them who did anything.\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
