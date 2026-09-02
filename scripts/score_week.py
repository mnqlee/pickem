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
from zoneinfo import ZoneInfo

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
    Bye weeks run 13-15 games, so the ceiling moves with the slate.

    CLAMPED AT BOTH ENDS, and both ends are load-bearing.

    The floor: a rank can outlive the slate it was made against. Rank 16
    games, have one postponed into another week (flex scheduling,
    weather), and the week is scored with 15. The pick holding rank 16
    paid 15 + 1 - 16 = 0, and on a 14-game week it paid MINUS ONE — a
    correct pick that took points away.

    The ceiling: it makes the payout incapable of exceeding one week's
    top prize whatever a weight document contains. A negative weight
    would otherwise pay n + 1 + |rank|, i.e. MORE than rank 1. That
    matters because it is what lets the sanity check below stay narrow:
    the only shape that can now beat an honest sheet is a duplicate."""
    if not rank:
        return 1
    raw = (n + 1 - rank) if RANK_ONE_IS_BEST else rank
    return max(0, min(n, raw))


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

    unmatched = []
    for ev in r.json().get("events", []):
        # ONE BAD EVENT MUST NOT COST THE WHOLE WEEK ITS SCORES.
        # Every subscript below is a guess about ESPN's shape, and this
        # function runs before score_pools in the same process: an
        # IndexError on a TBD placeholder or a null score used to abort
        # main() outright, so nothing was scored, no standings were
        # written and nobody was notified — for the entire week.
        # worker/live.js wraps each event for exactly this reason.
        try:
            c = ev["competitions"][0]
            st = c["status"]["type"]
            state = st["state"]                       # pre | in | post
            by = {t["homeAway"]: t for t in c["competitors"]}
            away = by["away"]["team"]["abbreviation"]
            home = by["home"]["team"]["abbreviation"]
        except Exception as e:
            print(f"  !! skipped a malformed ESPN event: {e}")
            continue
        gid = f"{sid}_W{week}_{away}_{home}"

        old = current.get(gid)
        # NEVER CREATE A GAME DOCUMENT HERE.
        #
        # `set(..., merge=True)` creates on a miss, and the id is built
        # from ESPN's CURRENT abbreviation. When ESPN renames a team
        # mid-season (WAS -> WSH, LA -> LAR — both have happened), this
        # wrote a brand-new document holding only a score: no `wk`, no
        # `kickoff`, no teams. The real game then never received its
        # result from anyone and stayed `scheduled` forever, so that
        # week could never be complete — no winner, no runner-up, no
        # perfect week, and the tiebreak dead — for the rest of the
        # season. The phantom is invisible to scoring (it has no `wk`),
        # which is why nothing ever surfaced it.
        if old is None:
            unmatched.append(gid)
            continue

        # A POSTPONED GAME IS NOT A 0-0 FINAL.
        #
        # ESPN reports a postponed or cancelled game as state "post"
        # with no score. Reading that as final wrote winner=None over a
        # game that was never played — which silently made the week
        # "complete", handed out weekly awards on it, published
        # standings and fired result notifications, while every player
        # who picked that game lost their confidence stake on it.
        # worker/live.js guards this and refuses to write; this script
        # runs LATER on the same data and would overwrite live.js's
        # correct refusal, so the guard has to exist in both.
        blurb = " ".join(str(st.get(k, "")) for k in ("name", "description", "detail")).upper()
        abandoned = any(w in blurb for w in
                        ("POSTPON", "CANCEL", "SUSPEND", "DELAY", "FORFEIT", "ABANDON"))
        raw_a, raw_h = by["away"].get("score"), by["home"].get("score")
        no_score = raw_a in (None, "") or raw_h in (None, "")
        if state == "post" and (abandoned or no_score):
            print(f"  .. {gid}: reported final with no result "
                  f"({st.get('description') or st.get('name')}) — left alone")
            continue

        patch = {"status": {"pre": "scheduled", "in": "live", "post": "final"}[state]}
        if state in ("in", "post"):
            try:
                a, h = int(raw_a or 0), int(raw_h or 0)
            except (TypeError, ValueError):
                print(f"  !! {gid}: unreadable score {raw_a!r}-{raw_h!r} — left alone")
                continue
            patch.update(awayScore=a, homeScore=h)
            if state == "post":
                # A tie leaves winner None; nobody is credited. Rare but real.
                patch["winner"] = home if h > a else (away if a > h else None)

        if any(old.get(k) != v for k, v in patch.items()):
            col.document(gid).set(patch, merge=True)
            updated += 1

    print(f"  {updated} game(s) changed")
    if unmatched:
        # Loud, because this is the failure that quietly ends a week.
        print(f"  !! NO MATCHING GAME for {len(unmatched)}: {', '.join(unmatched)}")
        print(f"  !! the schedule and ESPN disagree about team codes — "
              f"re-run import_schedule.py for week {week}")


# ---------- 1b. refresh betting lines ----------
def pull_lines(db, season, week):
    sid, year, stype = season_parts(season)
    """Lines are only posted a week or so ahead, so refresh the current
    and next week every run rather than importing them all in the spring.
    A Week 12 spread does not exist in September and should not be shown."""
    col = db.collection("seasons").document(sid).collection("games")
    for wk in (week, week + 1):
        # 4, not 3: the preseason has a Hall of Fame week that shifts the
        # numbering, and import_schedule.py and worker/live.js both use 4.
        # At 3, preseason week 4 lines never refreshed.
        if wk > (4 if stype == 1 else 18):
            continue
        try:
            r = requests.get(ESPN, params={"seasontype": stype, "week": wk, "dates": year}, timeout=20)
            r.raise_for_status()
        except Exception as e:
            print(f"  lines wk{wk} unavailable: {e}")
            continue
        # Same rule as pull_scores: only ever UPDATE a game we already
        # have. A merge-set on an unknown id creates a document holding
        # nothing but a spread, with no wk and no kickoff.
        known = {d.id for d in col.where("wk", "==", wk).stream()}
        n = 0
        for ev in r.json().get("events", []):
            try:
                c = ev["competitions"][0]
                odds = c.get("odds") or []
                if not odds:
                    continue
                by = {t["homeAway"]: t["team"]["abbreviation"] for t in c["competitors"]}
            except Exception:
                continue
            gid = f"{sid}_W{wk}_{by['away']}_{by['home']}"
            if gid not in known:
                continue
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
            # A pick whose gameId is not in THIS week's slate does not
            # belong to this week, whatever its `wk` field claims. The
            # rules now pin wk to the game's real week, but old documents
            # written before that predate the guarantee — and one stray
            # entry is enough to make a player's weights look invalid.
            if v.get("gameId") not in games:
                print(f"  !! pool {pid}: pick {p.id} claims wk{week} "
                      f"but game {v.get('gameId')} is not in it — ignored")
                continue
            # A cleared pick is stored as a tombstone (winner: null)
            # because picks can never be deleted. It is not a pick.
            if v.get("winner") is None:
                continue
            picks[v["uid"]][v["gameId"]] = v

        # Weight sanity check — see the note at the bottom of firestore.rules.
        #
        # SCOPED TO THE OFFENDER. This used to set mode = "straight" for
        # the WHOLE POOL: one person with a duplicated rank — which the UI
        # itself could produce, since "take the stamp back" freed a rank
        # without saving, letting it be reused — silently erased confidence
        # scoring for every other player that week. Everyone's carefully
        # ranked sheet quietly became one point per correct pick, and the
        # only trace was a line in a log nobody reads.
        #
        # The person who broke their own sheet is scored straight-up. Nobody
        # else is touched.
        # WHAT COUNTS AS BAD. Only a set that could pay MORE than an honest
        # sheet: a repeated rank (two picks both worth the top payout), or a
        # rank outside 1..N.
        #
        # It used to demand an exact 1..k run, and that was wrong in the
        # ordinary case. Un-picking a game — tapping the selected team again
        # — leaves the rank it held unused, so a sheet of 16 minus the game
        # holding rank 7 is {1..6, 8..16}: a hole, not a duplicate. So is
        # "take the stamp back". Both are one tap, both are things people do
        # on a Sunday morning, and both quietly converted that player's
        # entire week to straight-up scoring — every ranked point gone, no
        # message, no mark on the sheet, and the phone still showing the
        # confidence total right up until the standings updated.
        #
        # A hole can never help you: the skipped rank is points forfeited,
        # and an unranked pick pays 1. There is nothing to defend against.
        #
        # NOR CAN A RANK ABOVE THE SLATE, and that check is gone with it.
        # It fired on the most innocent scenario there is: a player ranks
        # all 16 games, one is postponed out of the week, the week scores
        # with 15 — and they now hold a 16 on a 15-game week through no
        # act of their own. That cost them ~90% of the week. pay() already
        # clamps such a rank to zero, so it costs them that pick's points;
        # taking the whole week as well is punishing them for the schedule
        # changing. The clamp at the other end means a negative weight
        # cannot beat rank 1 either.
        #
        # What is left is the one shape that can genuinely pay more than
        # an honest sheet: the same rank used twice.
        flagged = []
        if mode == "confidence":
            for uid, ps in picks.items():
                ws = [x.get("weight") for x in ps.values() if x.get("weight")]
                if len(ws) != len(set(ws)):
                    flagged.append(uid)
            if flagged:
                who = ", ".join(flagged)
                print(f"  !! pool {pid}: duplicated or out-of-range ranks from "
                      f"{who} — those players scored straight-up; everyone "
                      f"else unaffected")

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
                    # `flagged` is per-player: only someone whose own weight
                    # set is invalid loses confidence scoring.
                    use_conf = mode == "confidence" and uid not in flagged
                    wpts += pay(p.get("weight"), len(games)) if use_conf else 1

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
                            # tz drives quiet hours in notify(); without it
                            # every result push landed at 1am local.
                            "tz": entry.get("tz") or "America/New_York",
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
                    """Set this week's holders, and UNSET everyone else's.

                    This used only to add. `got.add(week)` with no removal
                    made the badge lists monotonic, which broke the one
                    promise the rest of this script keeps: that re-running
                    a week recomputes it from scratch.

                    What that looked like. ESPN posts a wrong final on
                    Sunday night; Alice is scored the week's winner and
                    gets a gold 1ST seal. The result is corrected and the
                    week is re-scored; Bob is the real winner. `_weeks` is
                    replaced and correctly names Bob — but Alice still
                    carries weeksWon [4] and weekWins 1 forever. The
                    Standings tab reads weekWins, so it shows two week-4
                    winners, while the Week-by-week row underneath —
                    recomputed from points — shows only Bob. The same
                    screen contradicts itself and only one of the two is
                    right. The same thing happens after any postponed
                    game is finally played, or any scoring-mode change
                    applied retroactively.

                    Every member is visited, not just the winners,
                    because the player who has to LOSE the badge is by
                    definition not in `rows`."""
                    hold = {w["uid"] for w in rows}
                    for muid in members:
                        ref = db.collection("pools").document(pid) \
                                .collection("standings").document(muid)
                        prev = ref.get().to_dict() or {}
                        got = set(prev.get(key_list, []))
                        if muid in hold:
                            got.add(week)
                        else:
                            got.discard(week)
                        if got == set(prev.get(key_list, [])):
                            continue                     # nothing to write
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
    weeks stay reproducible when the toggle is flipped later.

    THE DEFAULT MUST MATCH THE CLIENT. This said "straight" while
    firebase-init.js's getScoringMode() said "confidence" — and that
    file's comment claimed the two agreed. They only agree once
    `scoringHistory` covers the week being scored. For a pool with no
    history, or whose earliest entry is a later week, every player's
    phone showed the confidence tray, the stake bars and a live ranked
    total all week, and then the standings published one point per
    correct pick. Nothing on either surface explained the gap.

    This app is a confidence pool; confidence is what the screens
    promise, so confidence is the default and straight-up is the
    deliberate opt-in."""
    hist = sorted((pool_doc.get("scoringHistory") or []), key=lambda h: h["week"])
    mode = "confidence"
    if not any(h["week"] <= week for h in hist):
        print(f"  !! no scoringHistory covering week {week} — "
              f"defaulting to confidence (matches the app)")
    for h in hist:
        if h["week"] <= week:
            mode = h["mode"]
    return mode


# ---------- 3. push ----------
APP_ORIGIN = os.environ.get("APP_ORIGIN", "https://nflweeklypickem.com").rstrip("/")
QUIET_START, QUIET_END = 22, 7      # local hours, same as remind.py


def quiet_now(tz_name):
    """True if it is the middle of the night where this person is."""
    try:
        h = datetime.now(ZoneInfo(tz_name or "America/New_York")).hour
    except Exception:
        return False
    return h >= QUIET_START or h < QUIET_END


def notify(reports):
    """Tell everyone how their week went.

    FOUR THINGS WERE WRONG HERE, and together they meant this function
    has never successfully told anyone anything.

    1. `link` was the relative string "/index.html". FCM requires an
       absolute HTTPS URL and rejects the entire message with 400
       INVALID_ARGUMENT — so every result notification was refused by
       Google before it reached a device. worker/live.js hit exactly this
       and documents the fix at its push(); this file was never updated.
       The except below then printed one line into a GitHub Actions log
       nobody opens and the job exited 0, so it looked like it worked
       every single week.
    2. The place announced was the SEASON rank, not the week's. `results`
       is sorted by season total, so someone third overall who had just
       WON the week was told "You finished 3rd". The number people care
       about most was the one number this got wrong.
    3. No quiet hours, and two of the three scheduled runs are at 01:00
       ET. Every player got a phone buzz in the middle of the night,
       twice a week, all season — while remind.py, reading the same
       roster, has honoured tz and quiet hours all along.
    4. No tag, so sw.js fell back to the shared 'pickem' tag and a
       result could silently replace an unread "kickoff in 30 minutes"
       reminder in the tray, or be replaced by one."""
    for rep in reports:
        if not rep["results"]:
            continue
        leader = rep["results"][0]

        # Weekly places, computed from the WEEK's points. Ties share a
        # place, so two players on 96 are both "1st" and the next is 3rd.
        by_week = sorted({r["wpts"] for r in rep["results"]}, reverse=True)
        place_of = {}
        seen = 0
        for pts in by_week:
            tied = [r for r in rep["results"] if r["wpts"] == pts]
            for r in tied:
                place_of[r["uid"]] = seen + 1
            seen += len(tied)

        for r in rep["results"]:
            tokens = r.get("tokens") or []
            if not tokens:
                continue
            prefs = r.get("prefs") or {}
            if not prefs.get("results", True):
                continue
            if quiet_now(r.get("tz")):
                continue
            place = place_of.get(r["uid"], len(rep["results"]))
            if rep["complete"]:
                title = f"Week {rep['week']} final"
                body = (f"You finished {ordinal(place)} with {r['wpts']} points. "
                        + ("You lead the season." if r is leader
                           else f"{leader['name']} leads with {leader['total']}."))
            else:
                title = f"Week {rep['week']} so far"
                body = (f"{r['wpts']} points, {r['whits']} correct. "
                        f"{ordinal(place)} this week.")
            for tk in tokens:
                try:
                    messaging.send(messaging.Message(
                        token=tk,
                        notification=messaging.Notification(title=title, body=body),
                        webpush=messaging.WebpushConfig(
                            fcm_options=messaging.WebpushFCMOptions(
                                link=f"{APP_ORIGIN}/index.html"),   # MUST be absolute
                            notification={
                                # Its own tag, so a result never collapses
                                # onto an unread kickoff reminder.
                                "tag": f"result-{rep['week']}-{'final' if rep['complete'] else 'live'}",
                                "renotify": False,
                            })))
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
