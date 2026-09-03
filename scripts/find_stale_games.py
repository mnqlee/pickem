#!/usr/bin/env python3
"""
Find leftover game documents in Firestore that no longer match the real
schedule — READ-ONLY by default. Nothing is deleted unless you pass --delete.

WHY THIS EXISTS
    import_schedule.py's doc id is `{season}_W{wk}_{away}_{home}` — built
    from the teams, not the week alone. That is deliberate (it is what
    lets a re-import update kickoff/network/spread without walking over a
    game that has already gone final, per the comment in that file), but
    it has a blind spot: if the schedule for a week was ever DIFFERENT the
    first time this was run than it is now — an early speculative import
    before ESPN had finalized things, a since-corrected matchup, a flexed
    game that swapped an opponent rather than just a kickoff time — the
    OLD matchup's document is not overwritten. It is not touched at all.
    It just sits there forever, still claiming to be that week's game,
    with whatever kickoff time it had back then.

    The app has no de-duplication anywhere: getAllWeeks() and watchWeek()
    both group purely by the `wk` field and render everything they get
    back. Two documents both saying wk=1, one correct and one years-stale,
    show up side by side on the Picks tab. If the stale one's kickoff has
    already passed, it renders as "In progress" or "Final" next to real
    games that have not started yet — which matches "half the games show
    in progress on first load" exactly, and explains why it is real teams
    playing a real game that never actually happened on this device: it's
    a leftover document, not a rendering bug.

USAGE
    python scripts/find_stale_games.py --season 2026            # report only
    python scripts/find_stale_games.py --season 2026 --delete   # remove the orphans it found

    Needs the same serviceAccount.json / FIREBASE_SERVICE_ACCOUNT_FILE
    this project's other scripts use, and network access to ESPN's public
    scoreboard (the same endpoint import_schedule.py itself reads from —
    this is the CURRENT truth to compare the database against).
"""

import argparse, os, sys
from datetime import datetime, timezone

import requests
import firebase_admin
from firebase_admin import credentials, firestore

ESPN = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"


def current_matchups(season: int):
    """away/home pairs ESPN reports right now for each regular-season week —
    the same call import_schedule.py makes, used here only to compare."""
    by_week = {}
    for wk in range(1, 19):
        r = requests.get(ESPN, params={"seasontype": 2, "week": wk, "dates": season}, timeout=20)
        r.raise_for_status()
        pairs = set()
        for ev in r.json().get("events", []):
            c = ev["competitions"][0]
            teams = {t["homeAway"]: t["team"]["abbreviation"] for t in c["competitors"]}
            pairs.add((teams["away"], teams["home"]))
        by_week[wk] = pairs
    return by_week


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, required=True)
    ap.add_argument("--delete", action="store_true",
                     help="Actually remove the orphaned documents this finds. "
                          "Without this flag, nothing is changed.")
    args = ap.parse_args()

    key = os.environ.get("FIREBASE_SERVICE_ACCOUNT_FILE", "serviceAccount.json")
    firebase_admin.initialize_app(credentials.Certificate(key))
    db = firestore.client()
    col = db.collection("seasons").document(str(args.season)).collection("games")

    print("Fetching the current real schedule from ESPN to compare against...")
    real = current_matchups(args.season)

    print(f"Reading everything stored in seasons/{args.season}/games ...")
    docs = list(col.stream())
    print(f"{len(docs)} documents stored.\n")

    now = datetime.now(timezone.utc)
    by_week = {}
    for d in docs:
        g = d.to_dict() or {}
        by_week.setdefault(g.get("wk"), []).append((d.id, g))

    orphans = []
    for wk in sorted(k for k in by_week if k is not None):
        games = by_week[wk]
        expected = real.get(wk, set())
        print(f"Week {wk}: {len(games)} stored, {len(expected)} on ESPN right now")
        for doc_id, g in sorted(games, key=lambda x: x[1].get("kickoff") or now):
            pair = (g.get("away"), g.get("home"))
            kick = g.get("kickoff")
            kick_s = kick.isoformat() if hasattr(kick, "isoformat") else str(kick)
            past = ""
            if hasattr(kick, "tzinfo"):
                k = kick if kick.tzinfo else kick.replace(tzinfo=timezone.utc)
                if k < now and g.get("status") != "final":
                    past = "  <-- kickoff already passed, not marked final"
            if pair not in expected:
                orphans.append(doc_id)
                print(f"  ORPHAN  {doc_id:32s} {pair[0]}@{pair[1]:4s} {kick_s}{past}"
                      f"  (not on ESPN's current Week {wk} slate)")
            else:
                print(f"  ok      {doc_id:32s} {pair[0]}@{pair[1]:4s} {kick_s}{past}")
        print()

    if not orphans:
        print("No orphaned documents found. The stale-data theory is ruled out for "
              "this collection — the games showing wrong are the current, correct ones, "
              "which points back at either the stored kickoff time or the viewing "
              "device's clock for that specific game.")
        return

    print(f"{len(orphans)} orphaned document(s) found: {', '.join(orphans)}")
    if args.delete:
        batch = db.batch()
        for doc_id in orphans:
            batch.delete(col.document(doc_id))
        batch.commit()
        print("Deleted.")
    else:
        print("Nothing deleted (this was a dry run). Re-run with --delete once you've "
              "checked the list above and are sure these are the leftover ones, not "
              "current picks/scores you still need.")


if __name__ == "__main__":
    main()
