#!/usr/bin/env python3
"""
Pull final scores, score every pool, update standings, send push.

Runs on a schedule from GitHub Actions. Safe to run repeatedly — it
recomputes from scratch each time rather than accumulating.

    python scripts/score_week.py --season 2026
    python scripts/score_week.py --season 2026 --week 4 --no-push
"""

import argparse, os, sys
from collections import defaultdict
from datetime import datetime, timezone

import requests
import firebase_admin
from firebase_admin import credentials, firestore, messaging

ESPN = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"


def season_parts(season_id):
    """'2026PRE' -> ('2026PRE', 2026, 1)   '2026' -> ('2026', 2026, 2)

    One place decides the ESPN season type and the calendar year, so a
    preseason run cannot silently query the regular-season feed."""
    sid = str(season_id)
    if sid.upper().endswith("PRE"):
        return sid, int(sid[:-3]), 1
    return sid, int(sid), 2

# Rank 1 is the strongest pick and pays the most. Points are NOT the rank.
# Set RANK_ONE_IS_BEST = False for the conventional pool where a stake of
# 16 pays 16. This must match RANK_ONE_IS_BEST in index.html.
RANK_ONE_IS_BEST = True


def pay(rank, n):
    """Points a correct pick is worth. `n` is the number of games THAT WEEK.
    Bye weeks run 13-15 games, so the ceiling moves with the slate."""
    if not rank:
        return 1
    return (n + 1 - rank) if RANK_ONE_IS_BEST else rank


# ---------- 1. refresh scores ----------
def pull_scores(db, season, week):
    sid, year, stype = season_parts(season)
    """Refresh scores for one week.

    Only writes documents whose score or status actually changed. During a
    Sunday this runs every 5 minutes, and blind writes would burn ~4,600
    writes a day for nothing."""
    r = requests.get(ESPN, params={"seasontype": stype, "week": week, "dates": year}, timeout=20)
    r.raise_for_status()
    col = db.collection("seasons").document(sid).collection("games")
    current = {d.id: d.to_dict() for d in col.where("wk", "==", week).stream()}
    updated = 0

    for ev in r.json().get("events", []):
        c = ev["competitions"][0]
        state = c["status"]["type"]["state"]          # pre | in | post
        by = {t["homeAway"]: t for t in c["competitors"]}
        away, home = by["away"]["team"]["abbreviation"], by["home"]["team"]["abbreviation"]
        gid = f"{sid}_W{week}_{away}_{home}"

        patch = {"status": {"pre": "scheduled", "in": "live", "post": "final"}[state]}
        if state in ("in", "post"):
            a, h = int(by["away"].get("score", 0)), int(by["home"].get("score", 0))
            patch.update(awayScore=a, homeScore=h)
            if state == "post":
                # A tie leaves winner None; nobody is credited. Rare but real.
                patch["winner"] = home if h > a else (away if a > h else None)

        old = current.get(gid, {})
        if any(old.get(k) != v for k, v in patch.items()):
            col.document(gid).set(patch, merge=True)
            updated += 1

    print(f"  {updated} game(s) changed")


# ---------- 1b. refresh betting lines ----------
def pull_lines(db, season, week):
    sid, year, stype = season_parts(season)
    """Lines are only posted a week or so ahead, so refresh the current
    and next week every run rather than importing them all in the spring.
    A Week 12 spread does not exist in September and should not be shown."""
    col = db.collection("seasons").document(sid).collection("games")
    for wk in (week, week + 1):
        if wk > (3 if stype == 1 else 18):
            continue
        try:
            r = requests.get(ESPN, params={"seasontype": stype, "week": wk, "dates": year}, timeout=20)
            r.raise_for_status()
        except Exception as e:
            print(f"  lines wk{wk} unavailable: {e}")
            continue
        n = 0
        for ev in r.json().get("events", []):
            c = ev["competitions"][0]
            odds = c.get("odds") or []
            if not odds:
                continue
            by = {t["homeAway"]: t["team"]["abbreviation"] for t in c["competitors"]}
            gid = f"{sid}_W{wk}_{by['away']}_{by['home']}"
            col.document(gid).set({"spread": odds[0].get("details") or ""}, merge=True)
            n += 1
        print(f"  lines wk{wk}: {n} priced")


# ---------- 2. score every pool ----------
def score_pools(db, season, week):
    games = {d.id: d.to_dict()
             for d in db.collection("seasons").document(str(season))
                        .collection("games").where("wk", "==", week).stream()}
    finals = {gid: g for gid, g in games.items() if g.get("status") == "final"}
    print(f"  {len(finals)} of {len(games)} final")
    if not finals:
        return []

    reports = []
    for pool in db.collection("pools").where("season", "==", str(season)).stream():
        pd, pid = pool.to_dict(), pool.id
        mode = scoring_mode(pd, week)

        picks = defaultdict(dict)
        for p in db.collection("pools").document(pid).collection("picks") \
                   .where("wk", "==", week).stream():
            v = p.to_dict()
            picks[v["uid"]][v["gameId"]] = v

        # Weight sanity check — see the note at the bottom of firestore.rules.
        flagged = []
        if mode == "confidence":
            for uid, ps in picks.items():
                ws = sorted(x.get("weight") for x in ps.values() if x.get("weight"))
                if ws and ws != list(range(1, len(ws) + 1)):
                    flagged.append(uid)
            if flagged:
                print(f"  !! pool {pid}: bad weights from {flagged} — week scored straight-up")
                mode = "straight"

        members = {m.id: m.to_dict()
                   for m in db.collection("pools").document(pid).collection("members").stream()}

        # Push tokens and alert preferences live on private/roster as
        # {uid: {name, tz, tokens: [...], prefs: {...}}} — written by
        # enablePush()/upsertRoster() in firebase-init.js, and read that way
        # by worker/live.js. This script was reading members[uid]["pushToken"],
        # a field nothing has ever written, so r["token"] was always None and
        # notify() skipped every single player. Weekly result notifications
        # have never gone out. A person may have a phone and a laptop, so it
        # is a LIST.
        roster_doc = (db.collection("pools").document(pid)
                        .collection("private").document("roster").get().to_dict()) or {}

        results = []
        for uid, name in ((u, m.get("name", "Player")) for u, m in members.items()):
            wpts = whits = 0
            for gid, g in finals.items():
                p = picks.get(uid, {}).get(gid)
                if not p or not g.get("winner"):
                    continue
                if p["winner"] == g["winner"]:
                    whits += 1
                    wpts += pay(p.get("weight"), len(games)) if mode == "confidence" else 1

            # A perfect week: every game in a completed week called right.
            perfect = (len(finals) == len(games) and whits == len(games) and len(games) > 0)

            ref = db.collection("pools").document(pid).collection("standings").document(uid)
            prev = ref.get().to_dict() or {}
            weeks = prev.get("weeks", {})
            weeks[str(week)] = {"pts": wpts, "hits": whits, "mode": mode,
                                "perfect": perfect}
            ref.set({
                "name": name,
                "weeks": weeks,
                "pts": sum(w["pts"] for w in weeks.values()),
                "hits": sum(w["hits"] for w in weeks.values()),
                "perfectWeeks": sum(1 for w in weeks.values() if w.get("perfect")),
                "updatedAt": datetime.now(timezone.utc),
            }, merge=True)

            entry = roster_doc.get(uid) or {}
            results.append({"uid": uid, "name": name, "wpts": wpts, "whits": whits,
                            "total": sum(w["pts"] for w in weeks.values()),
                            "tokens": entry.get("tokens") or [],
                            "prefs": entry.get("prefs") or {}})

        results.sort(key=lambda r: -r["total"])
        results = apply_tiebreak(db, pid, week, results, finals)

        # Weekly awards, once every game is final. Ties share a place.
        if len(finals) == len(games) and results:
            best = max(r["wpts"] for r in results)
            if best > 0:
                winners = [r for r in results if r["wpts"] == best]
                # Runner-up is the next distinct score down, not the next row.
                lower = [r["wpts"] for r in results if r["wpts"] < best]
                second_pts = max(lower) if lower else 0
                seconds = ([r for r in results if r["wpts"] == second_pts]
                           if second_pts > 0 else [])

                db.collection("pools").document(pid).collection("standings") \
                  .document("_weeks").set({str(week): {
                      "winners": [{"uid": w["uid"], "name": w["name"]} for w in winners],
                      "pts": best,
                      "seconds": [{"uid": w["uid"], "name": w["name"]} for w in seconds],
                      "secondPts": second_pts}}, merge=True)

                def award(rows, key_list, key_count):
                    for w in rows:
                        ref = db.collection("pools").document(pid) \
                                .collection("standings").document(w["uid"])
                        prev = ref.get().to_dict() or {}
                        got = set(prev.get(key_list, []))
                        got.add(week)
                        ref.set({key_list: sorted(got), key_count: len(got)}, merge=True)

                award(winners, "weeksWon", "weekWins")
                award(seconds, "weeksSecond", "weekSeconds")

                print(f"  week {week}: 1st {', '.join(w['name'] for w in winners)} ({best})"
                      + (f" | 2nd {', '.join(w['name'] for w in seconds)} ({second_pts})"
                         if seconds else ""))
        reports.append({"pool": pid, "name": pd.get("name", "Pool"),
                        "week": week, "results": results,
                        "complete": len(finals) == len(games)})
        print(f"  scored {pd.get('name')}: {len(results)} players, mode={mode}")
    return reports


def scoring_mode(pool_doc, week):
    """Mode as of a given week. History, not a single field, so old
    weeks stay reproducible when the toggle is flipped later."""
    hist = sorted((pool_doc.get("scoringHistory") or []), key=lambda h: h["week"])
    mode = "straight"
    for h in hist:
        if h["week"] <= week:
            mode = h["mode"]
    return mode


# ---------- 3. push ----------
def notify(reports):
    for rep in reports:
        if not rep["results"]:
            continue
        leader = rep["results"][0]
        for i, r in enumerate(rep["results"]):
            tokens = r.get("tokens") or []
            if not tokens:
                continue
            if not (r.get("prefs") or {}).get("results", True):
                continue
            if rep["complete"]:
                title = f"Week {rep['week']} final"
                body = (f"You finished {ordinal(i+1)} with {r['wpts']} points. "
                        + ("You lead the season." if i == 0
                           else f"{leader['name']} leads with {leader['total']}."))
            else:
                title = f"Week {rep['week']} so far"
                body = f"{r['wpts']} points, {r['whits']} correct. {ordinal(i+1)} place."
            for tk in tokens:
                try:
                    messaging.send(messaging.Message(
                        token=tk,
                        notification=messaging.Notification(title=title, body=body),
                        webpush=messaging.WebpushConfig(
                            fcm_options=messaging.WebpushFCMOptions(link="/index.html"))))
                except Exception as e:
                    # One dead device token must not stop the rest of the pool
                    # from hearing how their week went.
                    print(f"  push failed for {r['name']}: {e}")


def apply_tiebreak(db, pid, week, results, games):
    """Order tied players by the Monday-night total.

    Closest without going over takes it. If everyone overshot, closest
    outright wins. Anyone who never guessed sits behind anyone who did.
    """
    last = max(games.values(), key=lambda g: g["kickoff"])
    if last.get("status") != "final":
        return results
    actual = (last.get("awayScore") or 0) + (last.get("homeScore") or 0)

    guesses = {}
    for d in db.collection("pools").document(pid).collection("tiebreaks") \
               .where("wk", "==", week).stream():
        v = d.to_dict()
        guesses[v["uid"]] = v["total"]

    def key(r):
        g = guesses.get(r["uid"])
        if g is None:
            return (2, 0)            # no guess, always last
        if g <= actual:
            return (0, actual - g)   # under: closest wins
        return (1, g - actual)       # over: only if nobody is under

    out = sorted(results, key=lambda r: (-r["total"], key(r)))
    for r in out:
        r["tbGuess"] = guesses.get(r["uid"])
        r["tbActual"] = actual
    return out


def ordinal(n):
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1:'st',2:'nd',3:'rd'}.get(n % 10,'th')}"


def current_week(db, season):
    now = datetime.now(timezone.utc)
    live = db.collection("seasons").document(str(season)).collection("games") \
             .where("kickoff", "<=", now).order_by("kickoff", direction="DESCENDING").limit(1).stream()
    for g in live:
        return g.to_dict()["wk"]
    return 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", required=True,
                    help="Season id: 2026, or 2026PRE for the preseason pool")
    ap.add_argument("--week", type=int)
    ap.add_argument("--no-push", action="store_true")
    ap.add_argument("--scores-only", action="store_true",
                    help="Refresh scores and lines, skip scoring and notifications. "
                         "This is what the 5-minute Live loop calls.")
    args = ap.parse_args()

    key = os.environ.get("FIREBASE_SERVICE_ACCOUNT_FILE", "serviceAccount.json")
    firebase_admin.initialize_app(credentials.Certificate(key))
    db = firestore.client()

    week = args.week or current_week(db, args.season)
    print(f"Scoring season {args.season}, week {week}")

    pull_scores(db, args.season, week)
    pull_lines(db, args.season, week)

    if args.scores_only:
        print("Scores only. Done.")
        return
    reports = score_pools(db, args.season, week)
    if reports and not args.no_push:
        notify(reports)
    print("Done.")


if __name__ == "__main__":
    sys.exit(main())
