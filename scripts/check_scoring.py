#!/usr/bin/env python3
"""
Show — and if necessary repair — the pool's scoring mode. READ-ONLY unless
you pass --force-confidence.

WHY THIS EXISTS

    The Straight-up / Confidence switch was removed from Settings: it was
    owner-only, it changed how the whole pool scored for the rest of the
    season, and one mis-tap rewrote everyone's game. Removing it closed
    that hole and opened a smaller one — there is no longer a button that
    can put the mode BACK.

    That matters because the mode is not a single field. score_week.py's
    scoring_mode() reads a `scoringHistory` array on the pool document,
    sorted by week, and applies the last entry whose week has arrived:

        hist = sorted(pool_doc.get("scoringHistory") or [], key=week)
        for h in hist:
            if h["week"] <= week: mode = h["mode"]

    So an entry left behind by a stray tap during testing — say
    {"week": 3, "mode": "straight"} — is not doing anything visible today
    and does not become visible until week 3 is scored. At that point
    every ranked point in the pool quietly becomes one point per correct
    pick, the standings publish it, and there is no longer any UI to
    change it back.

    Probability is low. Consequence is a wrecked season and an unhappy
    pool. One read settles it.

USAGE
    python scripts/check_scoring.py --season 2026
    python scripts/check_scoring.py --season 2026 --force-confidence

    Needs the same serviceAccount.json / FIREBASE_SERVICE_ACCOUNT_FILE as
    the other scripts here.
"""

import argparse, os, sys

import firebase_admin
from firebase_admin import credentials, firestore


def mode_at(hist, week):
    """Exactly score_week.scoring_mode()'s rule, kept in step with it."""
    mode = "confidence"
    for h in sorted(hist or [], key=lambda h: h.get("week", 0)):
        if h.get("week", 0) <= week:
            mode = h.get("mode", mode)
    return mode


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, required=True)
    ap.add_argument("--force-confidence", action="store_true",
                    help="Clear scoringHistory so the pool is confidence for "
                         "every week, past and future. Only does anything if "
                         "something other than confidence was found.")
    args = ap.parse_args()

    key = os.environ.get("FIREBASE_SERVICE_ACCOUNT_FILE", "serviceAccount.json")
    firebase_admin.initialize_app(credentials.Certificate(key))
    db = firestore.client()

    pools = [d for d in db.collection("pools").stream()
             if (d.to_dict() or {}).get("season") == str(args.season)]
    if not pools:
        print(f"No pool found for season {args.season}.")
        return 1

    bad = []
    for p in pools:
        d = p.to_dict() or {}
        hist = d.get("scoringHistory") or []
        print(f"\nPool {p.id}  ({d.get('name','unnamed')})")
        if not hist:
            print("  scoringHistory: empty -> confidence for the whole season. "
                  "This is the healthy state.")
        else:
            print(f"  scoringHistory: {hist}")
            for h in sorted(hist, key=lambda h: h.get("week", 0)):
                print(f"    from week {h.get('week')}: {h.get('mode')}")

        # Walk the season the way the scorer will.
        weeks = [mode_at(hist, w) for w in range(1, 19)]
        for w, m in enumerate(weeks, start=1):
            if m != "confidence":
                bad.append((p.id, w, m))
        if any(m != "confidence" for m in weeks):
            first = next(w for w, m in enumerate(weeks, 1) if m != "confidence")
            print(f"  !! WEEK {first} ONWARD SCORES {weeks[first-1].upper()}, "
                  f"not confidence — every ranked point becomes 1 point per "
                  f"correct pick from there, and there is no longer a button "
                  f"in the app to change it back.")
        else:
            print("  All 18 weeks score confidence. Nothing to do.")

        if bad and args.force_confidence:
            db.collection("pools").document(p.id).update({"scoringHistory": []})
            print("  -> scoringHistory cleared; the whole season is confidence now.")

    if bad and not args.force_confidence:
        print("\nRe-run with --force-confidence to clear it.")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
