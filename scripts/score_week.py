#!/usr/bin/env python3
"""
Pull final scores, score every pool, update standings, send push.

Runs on a schedule from GitHub Actions. Safe to run repeatedly — it
recomputes from scratch each time rather than accumulating.

    python scripts/score_week.py --season 2026
    python scripts/score_week.py --season 2026 --week 4 --no-push
"""

import argparse, json, os, sys
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
        # winners/seconds are declared out here rather than inside the
        # branch because the report carries them now: the results
        # notification names who took the week, and it can only do that
        # if this scope hands them over. Empty for an unfinished week,
        # which is exactly when the notification must not claim a winner.
        winners, seconds, best, second_pts = [], [], 0, 0
        if len(finals) == len(games) and results:
            best = max(r["wpts"] for r in results)
            if best > 0:
                winners = [r for r in results if r["wpts"] == best]
                # Runner-up is the next distinct score down, not the next row.
                lower = [r["wpts"] for r in results if r["wpts"] < best]
                second_pts = max(lower) if lower else 0
                seconds = ([r for r in results if r["wpts"] == second_pts]
                           if second_pts > 0 else [])
                # (Two locals that built name lists used to sit here. The
                # report below takes uid+name pairs directly and nothing
                # ever read them; a dead variable next to a live one that
                # looks just like it is how the wrong one gets used.)
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
                        "complete": len(finals) == len(games),
                        "winners": [w["name"] for w in winners], "best": best,
                        "seconds": [w["name"] for w in seconds],
                        "secondPts": second_pts,
                        "winnerUids": {w["uid"] for w in winners}})
        print(f"  scored {pd.get('name')}: {len(results)} players, mode={mode}")
    return reports


def names_phrase(names, cap=2):
    """'Steven Kern' | 'Steven Kern and Ron Ron' | '3 players'.

    A shared week is common in a confidence pool and a notification that
    reads "Steven Kern, Ron Ron, Coker and Vic won it" is unreadable on a
    lock screen, so past two it counts instead of listing.

    IT HAS TO BE A NOUN PHRASE THAT SURVIVES THE SENTENCE AROUND IT.
    This returned "3 players tied", which is a clause, and every caller
    puts a verb straight after it: "3 players tied won it with 120
    points", "3 players tied second on 113". Both are broken English, on
    a lock screen, about the one message in this app people screenshot
    and send to each other. "3 players" reads correctly in every slot —
    "3 players won it with 120 points" — and the tie is already implied
    by there being three of them."""
    if not names:
        return ""
    if len(names) == 1:
        return names[0]
    if len(names) <= cap:
        return " and ".join(names)
    return f"{len(names)} players"


def pts_label(n):
    """'1 point', '0 points', '104 points'.

    The bodies printed a bare "{wpts} points", so a straight-up week —
    or any week somebody scored exactly one point in — sent "1 points."
    This is the same off-by-one-word the cards and the Grid already fixed
    (1 PTS -> 1 PT). The push had been missed because it is the one
    surface nobody reads in a browser."""
    return f"{n} point" if abs(n) == 1 else f"{n} points"


def result_copy(rep, r, place, leaders):
    """Title and body for one player's results notification.

    SEPARATE FUNCTION SO IT CAN BE TESTED. It used to be four lines
    inline in notify(), which meant the only way to see what a player
    actually receives was to send real notifications to real phones.

    WHAT CHANGED AND WHY: the old body was "You finished 6th with 104
    points. Lee leads with 119." — the player's own placing and the
    SEASON leader, and nothing about who won the week. So the one fact
    everybody in a pool wants on a Tuesday, and the only one the app was
    in a position to state authoritatively, was the one it left out.

    The week winner now leads the sentence, because it is the news. Own
    placing second, because they already suspect it. Season leader last,
    and only when it is somebody else — telling the leader that they lead
    twice over is filler.

    TWO THINGS WERE WRONG IN THE LINE THAT NAMES THE SEASON LEADER.

    First, `leaders` is a LIST, and it used to be one dict compared with
    `r is not leader` — identity. The season order is `sort(-total)` then
    apply_tiebreak, so results[0] is whichever of the level players came
    out first; a two-way tie at the top therefore had the app telling one
    co-leader that the other "leads the season", flatly contradicting the
    Standings screen that player was looking at. Every player level on the
    top total is a leader, the sentence says so, and nobody in that set is
    told about it. (Identity was also wrong on its own terms: it passes
    only because the caller hands over an element of the very list it is
    iterating. The moment anything copies a row — a test fixture did
    exactly this — the leader is told they lead.)

    Second, every number in here went out bare: "won it with 120", "with
    104", "second on 113". A points total with no unit reads as a score
    line from the game itself. pts_label() supplies the unit and the
    singular."""
    wk = rep["week"]
    if not rep.get("complete"):
        return (f"Week {wk} so far",
                f"{pts_label(r['wpts'])}, {r['whits']} correct. "
                f"{ordinal(place)} this week.")

    won = r["uid"] in (rep.get("winnerUids") or set())
    snd = names_phrase(rep.get("seconds") or [])
    win = names_phrase(rep.get("winners") or [])

    if won:
        title = f"You won Week {wk}"
        body = f"{pts_label(r['wpts'])}."
        if snd:
            body += f" {snd} second on {pts_label(rep.get('secondPts') or 0)}."
    elif win:
        title = f"Week {wk} final"
        body = (f"{win} won it with {pts_label(rep.get('best') or 0)}. "
                f"You finished {ordinal(place)} with {pts_label(r['wpts'])}.")
    else:
        # Every game final and nobody scored: possible in a tiny pool, and
        # claiming a winner there would be inventing one.
        title = f"Week {wk} final"
        body = f"You finished {ordinal(place)} with {pts_label(r['wpts'])}."

    # A single dict still works, so an old call site cannot silently send
    # the wrong sentence — it just describes one leader.
    if isinstance(leaders, dict):
        leaders = [leaders]
    leaders = leaders or []
    if r["uid"] not in {l["uid"] for l in leaders}:
        who = names_phrase([l["name"] for l in leaders])
        if who:
            body += f" {who} {'leads' if len(leaders) == 1 else 'lead'} the season."
    return title, body


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
        # EVERY player level on the top season total is a leader. This was
        # results[0], one row, which on a tie at the top is whichever of
        # the level players apply_tiebreak happened to put first — and the
        # sentence built from it told the other co-leader that somebody
        # else led, while their own Standings screen showed them level at
        # the top. The tiebreaker orders the season table; it does not
        # decide who is leading it.
        top_total = max(r["total"] for r in rep["results"])
        leaders = [r for r in rep["results"] if r["total"] == top_total]

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
            title, body = result_copy(rep, r, place, leaders)
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


def week_status(db, season, week):
    """What state this week is in, as plain data.

    WHY A MACHINE-READABLE STATUS AT ALL. Two things the Live-scores
    window could not do without one, both of which cost real time on a
    real Monday night:

      1. IT COULD NOT NOTICE THAT THE WEEK WAS OVER. Monday Night
         Football goes final around 23:30 ET and the next scoring run is
         the Tuesday cron — so for roughly four hours the app showed a
         finished week with no winner, no seals and no result
         notification, while every player refreshed it. The window is
         already awake and already talking to Firestore at that moment;
         all it lacked was a way to know.
      2. IT COULD NOT STOP. Every window ran its full 350 minutes even
         when the last whistle went in the first twenty, pulling ESPN
         seventy more times for a week that could not change again.

    Deliberately NOT a decision — this reports, the caller decides.
    `complete` is every game in the week carrying status 'final', which
    is the same test score_week.py itself uses for the weekly awards
    (`len(finals) == len(games)`), so the window cannot conclude the week
    is over on a rule the scorer would disagree with.

    `next_kick` looks across the WHOLE SEASON, not this week, because the
    window that covers Thursday night covers the first game of the NEXT
    week: a caller asking "can anything still happen before my window
    closes" has to be told about that game too or it exits into a live
    kickoff.
    """
    sid, _year, _stype = season_parts(season)
    col = db.collection("seasons").document(sid).collection("games")
    games = [d.to_dict() for d in col.where("wk", "==", week).stream()]
    now = datetime.now(timezone.utc)

    def kick_ms(g):
        k = g.get("kickoff")
        try:
            return int(k.timestamp() * 1000)
        except Exception:
            return None

    finals = [g for g in games if g.get("status") == "final"]
    started = [g for g in games
               if (kick_ms(g) or 0) and kick_ms(g) <= int(now.timestamp() * 1000)]
    live = [g for g in started if g.get("status") != "final"]

    # The earliest kickoff anywhere in the season that has not happened
    # yet. One ordered query, one document.
    nxt = None
    for d in col.where("kickoff", ">", now) \
                .order_by("kickoff").limit(1).stream():
        nxt = kick_ms(d.to_dict())

    return {
        "season": sid,
        "week": week,
        "games": len(games),
        "final": len(finals),
        "live": len(live),
        "complete": bool(games) and len(finals) == len(games),
        "next_kick_ms": nxt,
        "now_ms": int(now.timestamp() * 1000),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", required=True,
                    help="Season id: 2026, or 2026PRE for the preseason pool")
    ap.add_argument("--week", type=int)
    ap.add_argument("--no-push", action="store_true")
    ap.add_argument("--scores-only", action="store_true",
                    help="Refresh scores and lines, skip scoring and notifications. "
                         "This is what the 5-minute Live loop calls.")
    ap.add_argument("--status-file",
                    help="Also write this week's state as JSON to PATH: games, "
                         "final, live, complete and the season's next kickoff. "
                         "Written on every run, including --scores-only, and "
                         "written LAST so a partial file never reads as a "
                         "complete week. Read by scores-loop.yml, which uses it "
                         "to close a finished week straight away instead of "
                         "waiting for the Tuesday cron, and to stop a window "
                         "that has nothing left to watch.")
    args = ap.parse_args()

    key = os.environ.get("FIREBASE_SERVICE_ACCOUNT_FILE", "serviceAccount.json")
    firebase_admin.initialize_app(credentials.Certificate(key))
    db = firestore.client()

    week = args.week or current_week(db, args.season)
    print(f"Scoring season {args.season}, week {week}")

    pull_scores(db, args.season, week)
    pull_lines(db, args.season, week)

    def write_status():
        """WRITTEN LAST, AND NEVER ALLOWED TO FAIL THE RUN.

        Last, because the caller treats `complete: true` as permission to
        score the week; a file written before pull_scores would describe
        the week as it was five minutes ago.

        And never fatal: this is an optimisation for the Live window. If
        it throws, the correct outcome is that scores were still pulled
        and the Tuesday cron still scores the week — which is exactly
        where this started. A status file that could take down the
        scores loop would be a worse trade than not having one.

        Written via a temporary file and renamed, so a reader that opens
        it between the two never sees half a JSON document."""
        if not args.status_file:
            return
        try:
            st = week_status(db, args.season, week)
            tmp = args.status_file + ".part"
            with open(tmp, "w") as f:
                json.dump(st, f)
            os.replace(tmp, args.status_file)
            print(f"  status: {st['final']}/{st['games']} final, "
                  f"{st['live']} live, complete={st['complete']}")
        except Exception as e:
            print(f"  !! could not write status file: {e}")

    if args.scores_only:
        write_status()
        print("Scores only. Done.")
        return
    reports = score_pools(db, args.season, week)
    if reports and not args.no_push:
        notify(reports)
    write_status()
    print("Done.")


if __name__ == "__main__":
    sys.exit(main())
