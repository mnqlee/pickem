#!/usr/bin/env python3
"""
Import a full NFL season schedule into Firestore. Run this ONCE in the
spring when the schedule drops, then again only if a game is flexed.

    python scripts/import_schedule.py --season 2026

Pulls from ESPN's public scoreboard endpoint. That endpoint is
undocumented and can change or close without notice. If it does, use
--csv instead and hand-build the file (272 rows, one evening's work,
and then you own your data):

    week,away,home,kickoff_utc,network,spread
    1,BAL,KC,2026-09-10T00:20:00Z,NBC,KC -3
"""

import argparse, csv, os, sys
from datetime import datetime, timezone

import requests
import firebase_admin
from firebase_admin import credentials, firestore

ESPN = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"


def from_espn(season: int, preseason: bool = False):
    games = []
    st = 1 if preseason else 2
    # ESPN numbers the Hall of Fame Game as its own preseason week 1, which
    # pushes the "real" three preseason weeks to ESPN weeks 2-4. Fetching
    # only 1-3 silently drops the actual final preseason week — confirmed
    # 2026-08-29: ESPN week=4 is the real Week 3 slate (Steelers/Bills,
    # Commanders/Ravens, Lions/Colts, etc., Aug 27-29), and it was missing.
    for wk in range(1, 5 if preseason else 19):
        r = requests.get(ESPN, params={"seasontype": st, "week": wk, "dates": season}, timeout=20)
        r.raise_for_status()
        for ev in r.json().get("events", []):
            c = ev["competitions"][0]
            teams = {t["homeAway"]: t["team"]["abbreviation"] for t in c["competitors"]}
            net = ""
            bc = c.get("broadcasts") or []
            if bc and bc[0].get("names"):
                net = bc[0]["names"][0]
            odds = c.get("odds") or []
            games.append({
                # Doc id carries the season id, which already says PRE or
                # not. One format everywhere: no P/W split to keep in sync.
                "id": f"{season}{'PRE' if st == 1 else ''}_W{wk}_{teams['away']}_{teams['home']}",
                "wk": wk,
                "preseason": st == 1,
                "away": teams["away"],
                "home": teams["home"],
                "kickoff": datetime.fromisoformat(ev["date"].replace("Z", "+00:00")),
                "network": net,
                # Only the next week or two are priced. Everything else
                # comes back empty here, which is correct — score_week.py
                # fills lines in as the season moves.
                "spread": (odds[0].get("details") if odds else "") or "",
                "status": "scheduled",
                "awayScore": None,
                "homeScore": None,
                "winner": None,
            })
        print(f"  week {wk}: {len([g for g in games if g['wk'] == wk])} games")
    return games


def from_csv(path: str, season: int):
    games = []
    with open(path) as f:
        for row in csv.DictReader(f):
            wk = int(row["week"])
            games.append({
                "id": f"{season}_W{wk}_{row['away']}_{row['home']}",
                "wk": wk,
                "away": row["away"].strip().upper(),
                "home": row["home"].strip().upper(),
                "kickoff": datetime.fromisoformat(row["kickoff_utc"].replace("Z", "+00:00")),
                "network": row.get("network", "").strip(),
                "spread": row.get("spread", "").strip(),
                "status": "scheduled",
                "awayScore": None, "homeScore": None, "winner": None,
            })
    return games


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, required=True)
    ap.add_argument("--preseason", action="store_true",
                    help="Import preseason (seasontype=1) instead of the regular season. "
                         "Preseason is 3 weeks; they import as weeks P1-P3.")
    ap.add_argument("--csv")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    games = (from_csv(args.csv, args.season) if args.csv
             else from_espn(args.season, args.preseason))
    print(f"\n{len(games)} games total")

    if args.dry_run:
        for g in games[:5]:
            print(f"  {g['id']}  {g['kickoff'].isoformat()}")
        return

    key = os.environ.get("FIREBASE_SERVICE_ACCOUNT_FILE", "serviceAccount.json")
    firebase_admin.initialize_app(credentials.Certificate(key))
    db = firestore.client()

    # Preseason lands in its own season id so the regular season shares
    # nothing with it. Nothing to unwind later.
    season_id = f"{args.season}PRE" if args.preseason else str(args.season)
    col = db.collection("seasons").document(season_id).collection("games")
    # What is already stored, so a re-import cannot walk over results.
    existing = {d.id: (d.to_dict() or {}) for d in col.stream()}

    batch, n, kept = db.batch(), 0, 0
    for g in games:
        gid = g.pop("id")
        prev = existing.get(gid)

        # merge=True protects fields we DON'T send. It does not protect
        # fields we DO send — and this payload always carries
        # status="scheduled", awayScore=None, homeScore=None, winner=None.
        #
        # So re-running this mid-season (the documented fix for a flexed
        # kickoff time) reset every finished game to "scheduled" with no
        # score and no winner. The Grid emptied, every player's points
        # dropped to zero, and the app would not put them back: score_week
        # only looks at games that are not already final, and the client's
        # isFinal() reads `status`. One routine re-import erased the
        # season's results, on purpose, quietly.
        #
        # A game already carrying a result keeps it. Only the schedule
        # fields — kickoff, network, spread — are refreshed, which is the
        # only reason to re-import in the first place.
        if prev and (prev.get("status") == "final" or prev.get("winner")):
            for f in ("status", "awayScore", "homeScore", "winner"):
                g.pop(f, None)
            kept += 1

        batch.set(col.document(gid), g, merge=True)
        n += 1
        if n % 400 == 0:
            batch.commit(); batch = db.batch()
    batch.commit()
    print(f"Wrote {n} games to seasons/{season_id}/games")
    if kept:
        print(f"  ({kept} already final — kept their scores, refreshed only the schedule)")


if __name__ == "__main__":
    sys.exit(main())
