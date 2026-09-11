#!/usr/bin/env python3
"""
WHY IS THERE NO LIVE SCORE ON THE CARD? — READ-ONLY. Writes nothing, ever.

    python scripts/why_no_live_score.py --season 2026

Run it WHILE A GAME IS ACTUALLY IN PROGRESS. That is the only moment the
question has an answer, because every part of this chain only does
anything between kickoff and final.

WHY THIS EXISTS
    A live score has to survive four separate steps, and when it does not
    appear on a phone, all four look identical from the outside — the card
    just says IN PROGRESS with no numbers. The four:

      1. ESPN has the score.          (this script asks ESPN directly)
      2. Something ran the pull.      (a scheduled GitHub Actions run)
      3. The pull wrote it to the
         RIGHT season's game document.(this script reads Firestore)
      4. The app renders it.          (verified separately, in the test
                                       harness, against the real
                                       index.html — it does)

    Steps 1 and 3 are facts this script can read out loud. Once you can
    see both columns side by side, the broken step names itself, and
    nobody has to guess:

      ESPN has a score, Firestore does not  -> the pull is not running,
                                               or is running against the
                                               wrong season/week. Look at
                                               the "Live scores" workflow
                                               in the Actions tab.
      Both have the score                   -> the write half is fine;
                                               the problem is on the phone
                                               (old cached version — tap
                                               Update on the Picks tab).
      Neither has a score                   -> ESPN has not posted one
                                               yet. Nothing is broken.

    It also prints the week this script's own auto-detect lands on, which
    is the same current_week() the scheduled run uses with no --week
    argument. A pull that writes week 1's scores perfectly on the Thursday
    of week 2 looks exactly like a pull that is not running at all.

    And it prints which season id it read, because `vars.SEASON` on the
    repository has been wrong before: a run against 2026PRE goes green,
    prints "Done.", writes real scores into the preseason season document,
    and touches nothing the pool can see.
"""

import argparse, os, sys
from datetime import datetime, timezone

import requests
import firebase_admin
from firebase_admin import credentials, firestore

ESPN = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"


def season_parts(season_id):
    """Same split score_week.py uses, so this cannot disagree with it."""
    sid = str(season_id)
    if sid.upper().endswith("PRE"):
        return sid, int(sid[:-3]), 1
    return sid, int(sid), 2


def current_week(db, sid):
    """Verbatim copy of score_week.current_week. If this returns the wrong
    week, the scheduled pull is refreshing the wrong week too."""
    now = datetime.now(timezone.utc)
    live = db.collection("seasons").document(sid).collection("games") \
             .where("kickoff", "<=", now).order_by("kickoff", direction="DESCENDING").limit(1).stream()
    for g in live:
        return g.to_dict()["wk"]
    return 1


def espn_week(year, stype, wk):
    r = requests.get(ESPN, params={"seasontype": stype, "week": wk, "dates": year}, timeout=20)
    r.raise_for_status()
    out = {}
    for ev in r.json().get("events", []):
        try:
            c = ev["competitions"][0]
            st = c["status"]["type"]
            by = {t["homeAway"]: t for t in c["competitors"]}
            away = by["away"]["team"]["abbreviation"]
            home = by["home"]["team"]["abbreviation"]
        except Exception as e:
            print(f"  !! skipped a malformed ESPN event: {e}")
            continue
        out[(away, home)] = {
            "state": st["state"],                       # pre | in | post
            "detail": st.get("shortDetail") or st.get("description") or "",
            "away": by["away"].get("score"),
            "home": by["home"].get("score"),
        }
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", required=True, help="2026, or 2026PRE")
    ap.add_argument("--week", type=int, help="Override the auto-detected week")
    args = ap.parse_args()

    sid, year, stype = season_parts(args.season)

    key = os.environ.get("FIREBASE_SERVICE_ACCOUNT_FILE", "serviceAccount.json")
    if not os.path.exists(key):
        print(f"Cannot find {key}. Run this from the poolsheet folder, the one")
        print("with serviceAccount.json in it.")
        return 1
    firebase_admin.initialize_app(credentials.Certificate(key))
    db = firestore.client()

    print(f"season document : seasons/{sid}   (ESPN seasontype={stype}, year={year})")
    auto = current_week(db, sid)
    week = args.week or auto
    print(f"auto-detected week: {auto}" + ("" if not args.week else f"   (overridden to {week})"))
    print(f"now             : {datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC\n")

    live = espn_week(year, stype, week)
    col = db.collection("seasons").document(sid).collection("games")
    stored = {d.id: (d.to_dict() or {}) for d in col.where("wk", "==", week).stream()}

    if not stored:
        print(f"!! seasons/{sid}/games has NO documents for week {week}.")
        print("   Nothing can ever show a score for this week. The schedule")
        print("   was never imported into this season, or the season id is wrong.")
        return 1

    print(f"{'GAME':<18} {'ESPN SAYS':<28} {'STORED IN FIRESTORE':<22} VERDICT")
    print("-" * 92)

    verdicts = {"waiting": 0, "not_written": 0, "written": 0, "no_espn": 0}
    for gid in sorted(stored, key=lambda g: stored[g].get("kickoff") or 0):
        g = stored[gid]
        # ids are {sid}_W{wk}_{away}_{home}
        bits = gid.split("_")
        pair = (bits[-2], bits[-1]) if len(bits) >= 4 else None
        e = live.get(pair)

        s_status = g.get("status") or "scheduled"
        s_a, s_h = g.get("awayScore"), g.get("homeScore")
        s_txt = s_status if s_a is None or s_h is None else f"{s_status} {s_a}-{s_h}"

        if e is None:
            e_txt, v = "(not in ESPN feed)", "?? id does not match ESPN"
            verdicts["no_espn"] += 1
        else:
            has = e["away"] not in (None, "") and e["home"] not in (None, "")
            e_txt = f"{e['state']:<5}" + (f" {e['away']}-{e['home']}" if has else " --")
            e_txt = f"{e_txt}  {e['detail']}"[:27]
            if not has:
                v = "waiting on ESPN"
                verdicts["waiting"] += 1
            elif s_a is None or s_h is None or str(s_a) != str(e["away"]) or str(s_h) != str(e["home"]):
                v = "<<< NOT WRITTEN"
                verdicts["not_written"] += 1
            else:
                v = "ok, stored"
                verdicts["written"] += 1

        print(f"{(pair and f'{pair[0]} @ {pair[1]}') or gid:<18} {e_txt:<28} {s_txt:<22} {v}")

    print()
    if verdicts["not_written"]:
        print(f"{verdicts['not_written']} game(s): ESPN HAS A SCORE AND FIRESTORE DOES NOT.")
        print("   The write half is the broken half. Check the Actions tab ->")
        print('   "Live scores": are there scheduled runs at all, are they green,')
        print(f'   and does the log say "Scoring season {sid}, week {week}"?')
        print("   You can force one right now: Actions -> Live scores -> Run workflow.")
    elif verdicts["written"]:
        print(f"{verdicts['written']} game(s) have the live score stored correctly.")
        print("   The write half is working. If a phone is not showing it, that")
        print("   phone is on an old cached version — Picks tab, tap Update.")
    elif verdicts["waiting"]:
        print("ESPN has not posted a score for any of these yet. Nothing is broken;")
        print("   there is simply nothing to show. Re-run after kickoff.")
    if verdicts["no_espn"]:
        print(f"{verdicts['no_espn']} stored game(s) do not match any ESPN matchup this week.")
        print("   Those can never receive a score. Run find_stale_games.py.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
