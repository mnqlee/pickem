#!/usr/bin/env python3
"""A whole season, 50 players, run through the REAL scorer.

    python scripts/test/season_sim.py            # quiet, exits 1 on failure
    python scripts/test/season_sim.py -v         # print every week

WHY THIS EXISTS
scripts/score_week.py decides who wins. Every other test in this repo
drives the UI, and the UI never runs that file — it renders standings the
scorer already wrote. So the money code was the least covered thing here.

This builds a full 18-week season with the things a real season actually
contains and that a hand-clicked test never produces: bye weeks, so the
confidence ceiling moves from 16 to 13 mid-season; two people with the
same first name; non-ASCII names; a tie game, where nobody is credited; a
player who duplicates a rank; a player who picks only part of the slate;
a player who clears a pick, leaving a tombstone; a stray pick carrying
another week's game id; players who never guess the tiebreak; and a final
week where only half the games are done.

Then it checks the scorer's output against an expected value computed
independently, in a different shape, from the same inputs. Two
implementations agreeing is evidence; one implementation agreeing with
itself is not.
"""

import os
import random
import sys
import types
from collections import defaultdict
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "scripts"))

from fakestore import FakeFirestore                      # noqa: E402

# ---- stub firebase_admin so the real scorer imports without credentials --
SENT = []


def _fake_send(msg, *a, **k):
    SENT.append(msg)
    return "ok"


fb = types.ModuleType("firebase_admin")
fb._apps = {}
fb.initialize_app = lambda *a, **k: None
fb.credentials = types.ModuleType("firebase_admin.credentials")
fb.credentials.Certificate = lambda *a, **k: None
fb.firestore = types.ModuleType("firebase_admin.firestore")
fb.firestore.client = lambda *a, **k: None
msg_mod = types.ModuleType("firebase_admin.messaging")
msg_mod.send = _fake_send
msg_mod.Message = lambda **k: k
msg_mod.Notification = lambda **k: k
msg_mod.WebpushConfig = lambda **k: k
msg_mod.WebpushFCMOptions = lambda **k: k
fb.messaging = msg_mod
sys.modules["firebase_admin"] = fb
sys.modules["firebase_admin.credentials"] = fb.credentials
sys.modules["firebase_admin.firestore"] = fb.firestore
sys.modules["firebase_admin.messaging"] = msg_mod

import score_week                                         # noqa: E402

VERBOSE = "-v" in sys.argv
PASS = 0
FAIL = 0
FAILURES = []


def ok(name, cond, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        if VERBOSE:
            print("  ok   " + name)
    else:
        FAIL += 1
        FAILURES.append(name + (" -> " + str(extra) if extra else ""))
        print("  FAIL " + name + ("  -> " + str(extra) if extra else ""))


# --------------------------------------------------------------------------
# The season
# --------------------------------------------------------------------------
SEASON = "2026"
POOL = "p_sim"
RNG = random.Random(7)

TEAMS = ["KC", "BAL", "BUF", "CIN", "DAL", "PHI", "SF", "DET", "GB", "MIN",
         "NYJ", "MIA", "LAC", "DEN", "SEA", "ATL", "NO", "TB", "HOU", "IND",
         "JAX", "TEN", "CLE", "PIT", "LV", "ARI", "LAR", "CHI", "WSH", "NYG",
         "CAR", "NE"]

# Deliberately awkward: two Mikes, a duplicate full name, non-ASCII, a very
# long name, a name that is only spaces after trimming, a numeric-looking
# name. All of these are things people actually type into a join screen.
NAMES = ["Lee", "Mike", "Mike", "José", "Anaïs", "Bartholomew Fitzgerald-Wentworth III",
         "Dad", "Uncle Ray", "Coach K", "Sam", "Priya", "Marcus", "Jo", "Tay",
         "Ali", "Rob", "Kim", "Nate", "Inés", "Gus", "Val", "Otis", "Rae",
         "Dex", "Mira", "Cy", "Wren", "Bo", "Ivy", "Zed", "Hal", "Fern",
         "Ada", "Ora", "Sol", "Tam", "Uri", "Vex", "Wyn", "Xan", "Yao",
         "Zia", "Ari", "Bex", "Cal", "Mike", "12", "O'Brien", "Ann-Marie", "Zoë"]
N_PLAYERS = 50
assert len(NAMES) == N_PLAYERS

WEEKS = 18
# Bye weeks are real: the slate shrinks, and with it the confidence ceiling.
GAMES_PER_WEEK = {w: 16 for w in range(1, WEEKS + 1)}
for w in range(5, 15):
    GAMES_PER_WEEK[w] = [16, 15, 14, 13, 14, 15, 13, 14, 16, 15][w - 5]

SEASON_START = datetime(2026, 9, 10, 0, 20, tzinfo=timezone.utc)

# Week 12 game 3 ends in a tie — nobody may be credited for it.
TIE_WEEK, TIE_INDEX = 12, 3
# Week 18 is only half final, so no awards and no perfect weeks.
PARTIAL_WEEK = 18

uid = lambda i: "u_%02d" % i


def build(db):
    """Seed a complete season: games, pool, members, roster, picks, tiebreaks.

    Returns the truth we will check the scorer against: what each player
    picked, at what rank, and who actually won each game."""
    truth = {"picks": defaultdict(dict), "winners": {}, "games": defaultdict(list),
             "tb": {}, "flagged": set()}

    for w in range(1, WEEKS + 1):
        n = GAMES_PER_WEEK[w]
        base = SEASON_START + timedelta(days=7 * (w - 1))
        for i in range(n):
            away, home = TEAMS[(w * 7 + i * 2) % 32], TEAMS[(w * 7 + i * 2 + 1) % 32]
            gid = "%s_W%d_%s_%s" % (SEASON, w, away, home)
            if i == 0:
                off = timedelta(0)                                  # Thu night
            elif i == n - 1:
                off = timedelta(days=4, seconds=15000)              # Mon night
            else:
                off = timedelta(days=3, seconds=61200 + i)          # Sunday
            kickoff = base + off

            final = not (w == PARTIAL_WEEK and i >= n // 2)
            if w == TIE_WEEK and i == TIE_INDEX:
                winner, a, h = None, 20, 20                 # a real NFL tie
            else:
                winner = home if (w + i) % 2 else away
                a, h = (17, 24) if winner == home else (27, 13)

            db.seed("seasons/%s/games/%s" % (SEASON, gid), {
                "wk": w, "away": away, "home": home, "kickoff": kickoff,
                "network": "CBS", "spread": home + " -3.0",
                "status": "final" if final else "scheduled",
                "awayScore": a if final else None,
                "homeScore": h if final else None,
                "winner": winner if final else None,
            })
            truth["games"][w].append(gid)
            if final:
                truth["winners"][gid] = winner

    db.seed("pools/%s" % POOL, {
        "season": SEASON, "name": "Sim Pool", "ownerUid": uid(0),
        "joinCode": "SIMCODE",
        "scoringHistory": [{"week": 1, "mode": "confidence"}],
    })

    roster = {}
    for i, name in enumerate(NAMES):
        db.seed("pools/%s/members/%s" % (POOL, uid(i)), {"name": name, "joinedAt": SEASON_START})
        roster[uid(i)] = {"name": name, "tz": "America/New_York",
                          "tokens": ["tok_%d" % i] if i % 3 else [],
                          "prefs": {"results": i % 7 != 0}}
    db.seed("pools/%s/private/roster" % POOL, roster)

    for w in range(1, WEEKS + 1):
        gids = truth["games"][w]
        n = len(gids)
        for i in range(N_PLAYERS):
            u = uid(i)

            # --- the awkward cases, one per player, on a chosen week ------
            if i == 1 and w == 3:
                # Duplicated rank: two picks both paying the top value. This
                # is the only shape that can pay MORE than an honest sheet,
                # so it is the only one that should be penalised.
                ranks = list(range(1, n)) + [n - 1]
                truth["flagged"].add((u, w))
            elif i == 2 and w == 7:
                # Picked only part of the slate, ranked 1..k. Legal.
                ranks = list(range(1, n + 1))
            elif i == 3 and w == 8:
                # Ranks with a HOLE in them — 4..n, nothing at 1, 2 or 3.
                # This is what un-picking a game leaves behind, and it costs
                # the player points rather than gaining them, so it must NOT
                # be penalised.
                ranks = list(range(4, n + 1)) + [1, 2, 3]
            elif i == 7 and w == 13:
                # A rank ABOVE the slate: what a player is left holding
                # when a game they ranked is postponed out of the week.
                # NOT penalised — see below. This assertion used to say
                # "penalised", which is how a real bug got written down
                # as a requirement.
                ranks = list(range(1, n)) + [n + 3]
            else:
                ranks = list(range(1, n + 1))
                RNG.shuffle(ranks)

            if i == 4 and w == 9:
                continue                       # never picked at all this week

            limit = n
            if i == 2 and w == 7:
                limit = n - 3                  # short sheet, contiguous ranks
            if i == 3 and w == 8:
                limit = n - 3                  # short sheet, ranks 4..n

            for j, gid in enumerate(gids[:limit]):
                pick_winner = db.read("seasons/%s/games/%s" % (SEASON, gid))
                # Beat the spread about 60% of the time so scores spread out.
                right = RNG.random() < (0.75 if i < 5 else 0.55)
                actual = pick_winner["winner"]
                if actual is None:              # tie game: pick either side
                    choice = pick_winner["home"]
                else:
                    choice = actual if right else (
                        pick_winner["away"] if actual == pick_winner["home"]
                        else pick_winner["home"])

                if i == 5 and w == 10 and j == 0:
                    # Cleared pick: a tombstone, not a pick.
                    db.seed("pools/%s/picks/%s_%s" % (POOL, u, gid),
                            {"uid": u, "wk": w, "gameId": gid, "winner": None,
                             "weight": None, "updatedAt": SEASON_START})
                    continue

                db.seed("pools/%s/picks/%s_%s" % (POOL, u, gid),
                        {"uid": u, "wk": w, "gameId": gid, "winner": choice,
                         "weight": ranks[j], "updatedAt": SEASON_START})
                truth["picks"][(u, w)][gid] = (choice, ranks[j])

            # A stray pick claiming this week but carrying another week's
            # game id. Old documents predate the rule that pins wk.
            if i == 6 and w == 11:
                stray = truth["games"][12][0]
                db.seed("pools/%s/picks/%s_stray" % (POOL, u),
                        {"uid": u, "wk": w, "gameId": stray, "winner": "KC",
                         "weight": 99, "updatedAt": SEASON_START})

            # Tiebreak guesses. Every 9th player never guesses.
            if i % 9 != 0:
                guess = 40 + (i * 3 + w) % 25
                db.seed("pools/%s/tiebreaks/%s_%d" % (POOL, u, w),
                        {"uid": u, "wk": w, "total": guess, "updatedAt": SEASON_START})
                truth["tb"][(u, w)] = guess

    return truth


def expected_week(truth, w):
    """The same scoring rules, written a different way, from the same inputs.

    Deliberately NOT a copy of score_week.py's loop: it walks players and
    their picks rather than games, and computes the payout inline. If the
    two agree, the rule is probably right. If they disagree, one of them is
    wrong and the diff says which game."""
    gids = truth["games"][w]
    n = len(gids)
    finals = {g: truth["winners"][g] for g in gids if g in truth["winners"]}
    out = {}
    for i in range(N_PLAYERS):
        u = uid(i)
        mine = truth["picks"].get((u, w), {})
        straight = (u, w) in truth["flagged"]
        pts = hits = 0
        for gid, (choice, rank) in mine.items():
            if gid not in finals:
                continue
            actual = finals[gid]
            if actual is None or choice != actual:
                continue
            hits += 1
            pts += 1 if straight else max(0, min(n, n + 1 - rank))
        out[u] = (pts, hits)
    return out, len(finals) == n


# --------------------------------------------------------------------------
def main():
    db = FakeFirestore()
    truth = build(db)
    print("Seeded %d players, %d weeks, %d games, %d picks."
          % (N_PLAYERS, WEEKS, sum(len(v) for v in truth["games"].values()),
             sum(1 for k in db.docs if k[:3] == ("pools", POOL, "picks"))))

    running = defaultdict(int)
    for w in range(1, WEEKS + 1):
        reports = score_week.score_pools(db, SEASON, w) if VERBOSE else _quiet(db, w)
        exp, complete = expected_week(truth, w)
        n = len(truth["games"][w])

        # 1. every player's week matches the independent calculation
        bad = []
        for u, (pts, hits) in exp.items():
            row = db.read("pools/%s/standings/%s" % (POOL, u)) or {}
            got = (row.get("weeks", {}).get(str(w), {}).get("pts"),
                   row.get("weeks", {}).get(str(w), {}).get("hits"))
            if got != (pts, hits):
                bad.append("%s wk%d expected %s got %s" % (u, w, (pts, hits), got))
            running[u] += pts
        ok("week %2d: all 50 players scored correctly (%d games)" % (w, n),
           not bad, "; ".join(bad[:3]))

        # 2. season totals are the sum of the weeks, every week
        drift = [u for u in exp
                 if (db.read("pools/%s/standings/%s" % (POOL, u)) or {}).get("pts")
                 != running[u]]
        ok("week %2d: season totals equal the sum of weekly points" % w, not drift,
           drift[:3])

        # 3. awards only exist once the week is complete
        wk_doc = (db.read("pools/%s/standings/_weeks" % POOL) or {}).get(str(w))
        if complete:
            best = max(p for p, _ in exp.values())
            want = sorted(u for u, (p, _) in exp.items() if p == best)
            got = sorted(x["uid"] for x in (wk_doc or {}).get("winners", []))
            ok("week %2d: winner list matches, ties shared" % w, want == got,
               "%s vs %s" % (want, got))
            lower = [p for p, _ in exp.values() if p < best]
            second = max(lower) if lower else 0
            want2 = sorted(u for u, (p, _) in exp.items() if p == second) if second else []
            got2 = sorted(x["uid"] for x in (wk_doc or {}).get("seconds", []))
            ok("week %2d: runner-up is the next distinct score" % w, want2 == got2,
               "%s vs %s" % (want2[:4], got2[:4]))
        else:
            ok("week %2d: an incomplete week awards nothing" % w, wk_doc is None,
               wk_doc)

        # 4. perfect weeks
        want_perfect = {u for u, (p, h) in exp.items() if complete and h == n}
        got_perfect = {u for u in exp
                       if (db.read("pools/%s/standings/%s" % (POOL, u)) or {})
                       .get("weeks", {}).get(str(w), {}).get("perfect")}
        ok("week %2d: perfect-week flag is exact" % w, want_perfect == got_perfect,
           want_perfect ^ got_perfect)

    # ---- cross-cutting checks -------------------------------------------
    print("\nSeason-wide invariants")

    # The bad-weight penalty is confined to the offender.
    row = db.read("pools/%s/standings/%s" % (POOL, uid(1)))
    wk3 = row["weeks"]["3"]
    ok("a duplicated rank scores that player straight-up",
       wk3["pts"] == wk3["hits"], wk3)
    others = [db.read("pools/%s/standings/%s" % (POOL, uid(i)))["weeks"]["3"]
              for i in (7, 8, 9, 10)]
    ok("and leaves everyone else on confidence",
       all(o["pts"] > o["hits"] for o in others), others[:2])

    # A short sheet with contiguous ranks is legal, not a penalty.
    r2 = db.read("pools/%s/standings/%s" % (POOL, uid(2)))["weeks"]["7"]
    ok("a partial sheet ranked 1..k is still confidence-scored",
       r2["pts"] > r2["hits"], r2)

    # THE ONE THAT SHIPPED. Un-picking a game leaves the rank it held
    # unused, so the sheet has a hole. That used to be treated as cheating
    # and cost the player every ranked point for the week, silently.
    r3 = db.read("pools/%s/standings/%s" % (POOL, uid(3)))["weeks"]["8"]
    ok("a gap in the ranks does NOT cost confidence scoring",
       r3["pts"] > r3["hits"], r3)
    r5 = db.read("pools/%s/standings/%s" % (POOL, uid(5)))["weeks"]["10"]
    ok("clearing one pick does NOT cost confidence scoring",
       r5["pts"] > r5["hits"], r5)

    # THE ASSERTION THAT WAS WRONG. It read "a rank above the slate is
    # penalised" and it passed, because the scorer did penalise it — the
    # test and the code were wrong together, which is the only way a bug
    # survives a green suite. The scenario is a game postponed out of the
    # week under a player who had already ranked it: they did nothing,
    # and it cost them ~90% of the week. A rank the slate cannot honour
    # pays zero for that one pick. That is the whole correct penalty.
    r7 = db.read("pools/%s/standings/%s" % (POOL, uid(7)))["weeks"]["13"]
    ok("a rank above the slate does NOT cost the week",
       r7["pts"] > r7["hits"], r7)
    ok("pay() never returns a negative",
       all(score_week.pay(r, n) >= 0
           for n in (13, 14, 15, 16) for r in range(1, 25)))
    ok("and never pays more than the week's top prize, whatever the weight",
       all(score_week.pay(r, n) <= n
           for n in (13, 14, 15, 16) for r in range(-20, 40)))
    ok("no player ever holds negative points in any week",
       all(wk["pts"] >= 0
           for i in range(N_PLAYERS)
           for wk in (db.read("pools/%s/standings/%s" % (POOL, uid(i))) or {})
           .get("weeks", {}).values()))

    # Nobody is credited for a tie.
    tie_gid = truth["games"][TIE_WEEK][TIE_INDEX]
    credited = [u for (u, w), ps in truth["picks"].items()
                if w == TIE_WEEK and tie_gid in ps]
    exp12, _ = expected_week(truth, TIE_WEEK)
    ok("a tie game credits nobody", all(
        db.read("pools/%s/standings/%s" % (POOL, u))["weeks"]["12"]["hits"]
        == exp12[u][1] for u in (uid(i) for i in range(10))), len(credited))

    # A player who never picked still gets a row, at zero.
    r4 = db.read("pools/%s/standings/%s" % (POOL, uid(4)))["weeks"]["9"]
    ok("a player who never picked scores zero, not nothing", r4 == {
        "pts": 0, "hits": 0, "mode": "confidence", "perfect": False}, r4)

    # The tombstone is not a pick.
    tomb_gid = truth["games"][10][0]
    ok("a cleared pick cannot score",
       tomb_gid not in truth["picks"][(uid(5), 10)], tomb_gid)

    # The stray pick did not flag its owner's weights.
    r6 = db.read("pools/%s/standings/%s" % (POOL, uid(6)))["weeks"]["11"]
    ok("a stray out-of-week pick is ignored, not treated as a bad rank",
       r6["pts"] > r6["hits"], r6)

    # weekWins bookkeeping agrees with the list it counts.
    mismatch = [u for u in (uid(i) for i in range(N_PLAYERS))
                if (db.read("pools/%s/standings/%s" % (POOL, u)) or {}).get("weekWins", 0)
                != len((db.read("pools/%s/standings/%s" % (POOL, u)) or {}).get("weeksWon", []))]
    ok("weekWins always equals len(weeksWon)", not mismatch, mismatch[:3])

    # ---- idempotency: the scorer promises it can be re-run ---------------
    before = {u: db.read("pools/%s/standings/%s" % (POOL, u))
              for u in (uid(i) for i in range(N_PLAYERS))}
    before_weeks = db.read("pools/%s/standings/_weeks" % POOL)
    for w in range(1, WEEKS + 1):
        _quiet(db, w)
    after = {u: db.read("pools/%s/standings/%s" % (POOL, u))
             for u in (uid(i) for i in range(N_PLAYERS))}
    changed = [u for u in before
               if {k: v for k, v in before[u].items() if k != "updatedAt"}
               != {k: v for k, v in after[u].items() if k != "updatedAt"}]
    ok("re-scoring the whole season changes nothing", not changed, changed[:3])
    ok("and does not duplicate weekly awards",
       before_weeks == db.read("pools/%s/standings/_weeks" % POOL))

    # ---- re-scoring with a CHANGED result ---------------------------------
    # The idempotency check above re-runs against identical data, which is
    # the easy half. The half that matters is a result that changes after
    # the week was already scored — a corrected ESPN final, or a postponed
    # game finally played — because that is when a badge has to move from
    # one player to another.
    print("\nRe-scoring after a corrected result")
    _before = {w["uid"] for w in
               ((db.read("pools/%s/standings/_weeks" % POOL) or {}).get("1") or {})
               .get("winners", [])}
    # Invert every result in week 1, so the week's order genuinely changes.
    # Flipping one game often leaves the same person on top, and a test
    # that silently stops exercising its own scenario is worse than no
    # test — the first version of this did exactly that and still passed
    # against the broken code.
    for _gid in truth["games"][1]:
        _g = db.read("seasons/%s/games/%s" % (SEASON, _gid))
        if not _g.get("winner"):
            continue
        _flip = _g["home"] if _g["winner"] == _g["away"] else _g["away"]
        db.seed("seasons/%s/games/%s" % (SEASON, _gid), {**_g, "winner": _flip})
    _quiet(db, 1)
    _after = {w["uid"] for w in
              ((db.read("pools/%s/standings/_weeks" % POOL) or {}).get("1") or {})
              .get("winners", [])}
    ok("PRECONDITION: the week's winner actually moved", _before != _after,
       "before=%s after=%s" % (sorted(_before), sorted(_after)))
    wk1 = (db.read("pools/%s/standings/_weeks" % POOL) or {}).get("1") or {}
    named = {w["uid"] for w in wk1.get("winners", [])}
    holders = {uid(i) for i in range(N_PLAYERS)
               if 1 in ((db.read("pools/%s/standings/%s" % (POOL, uid(i))) or {})
                        .get("weeksWon") or [])}
    ok("after a result changes, exactly the new winners hold the week-1 badge",
       named == holders, "named=%s holders=%s" % (sorted(named), sorted(holders)))
    bad = [uid(i) for i in range(N_PLAYERS)
           if ((db.read("pools/%s/standings/%s" % (POOL, uid(i))) or {}).get("weekWins", 0)
               != len((db.read("pools/%s/standings/%s" % (POOL, uid(i))) or {})
                      .get("weeksWon", [])))]
    ok("and the badge count still matches the badge list", not bad, bad[:3])

    # ---- the tiebreak ----------------------------------------------------
    print("\nTiebreak")
    finals = {g: db.read("seasons/%s/games/%s" % (SEASON, g))
              for g in truth["games"][1]}
    rows = [{"uid": uid(i), "name": NAMES[i], "total": 100} for i in range(6)]
    db2 = FakeFirestore()
    actual = None
    last = max(finals.values(), key=lambda g: g["kickoff"])
    actual = (last["awayScore"] or 0) + (last["homeScore"] or 0)
    guesses = {0: actual, 1: actual - 1, 2: actual + 1, 3: actual - 10,
               4: actual + 30}          # 5 has no guess at all
    for i, g in guesses.items():
        db2.seed("pools/p/tiebreaks/t%d" % i, {"uid": uid(i), "wk": 1, "total": g})
    out = score_week.apply_tiebreak(db2, "p", 1, list(rows), finals)
    order = [r["uid"] for r in out]
    ok("exact guess wins", order[0] == uid(0), order)
    ok("closest under beats closest over", order.index(uid(1)) < order.index(uid(2)), order)
    ok("further under still beats any over", order.index(uid(3)) < order.index(uid(2)), order)
    ok("no guess finishes last", order[-1] == uid(5), order)

    everyone_over = [{"uid": uid(i), "name": NAMES[i], "total": 100} for i in range(3)]
    db3 = FakeFirestore()
    for i, g in enumerate([actual + 5, actual + 1, actual + 9]):
        db3.seed("pools/p/tiebreaks/t%d" % i, {"uid": uid(i), "wk": 1, "total": g})
    out3 = score_week.apply_tiebreak(db3, "p", 1, everyone_over, finals)
    ok("if everyone overshoots, closest still wins",
       [r["uid"] for r in out3][0] == uid(1), [r["uid"] for r in out3])

    # ---- notifications ---------------------------------------------------
    print("\nNotifications")
    reports = _quiet(db, 1)

    # THIS BLOCK USED TO FAIL FOR NINE HOURS OUT OF EVERY DAY.
    #
    # notify() honours quiet hours (QUIET_START/QUIET_END = 22..07 local,
    # matching remind.py), and every seeded player carries
    # tz="America/New_York". So running the suite between 10pm and 7am
    # Eastern correctly suppressed every message, SENT stayed empty, and
    # "a full pool of 50 produces notifications" failed — an app that was
    # working perfectly, reported as broken, on a clock. Caught at 05:47
    # ET. A suite that cries wolf overnight is how real failures start
    # getting waved through.
    #
    # Pin the clock instead of depending on it, and while we are here,
    # assert the quiet-hours behaviour itself in both directions — it was
    # never covered, which is why nothing noticed it was driving this
    # result.
    real_quiet_now = score_week.quiet_now
    try:
        score_week.quiet_now = lambda tz: False        # daytime, everywhere
        SENT.clear()
        score_week.notify(reports)
        ok("a full pool of 50 produces notifications", len(SENT) > 0, len(SENT))
        ok("nobody without a token is messaged",
           len(SENT) <= sum(1 for i in range(N_PLAYERS) if i % 3), len(SENT))
        ok("opting out of results is respected",
           all("tok_0" != m.get("token") for m in SENT))

        score_week.quiet_now = lambda tz: True         # the middle of the night
        SENT.clear()
        score_week.notify(reports)
        ok("nobody is buzzed during quiet hours", len(SENT) == 0, len(SENT))
    finally:
        score_week.quiet_now = real_quiet_now
    ordinals = [score_week.ordinal(i) for i in (1, 2, 3, 4, 11, 12, 13, 21, 22, 50)]
    ok("ordinals are right past 10th",
       ordinals == ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th",
                    "21st", "22nd", "50th"], ordinals)

    print("\n%d passed, %d failed" % (PASS, FAIL))
    if FAILURES:
        print("FAILURES:")
        for f in FAILURES:
            print("  - " + f)
    return 1 if FAIL else 0


def _quiet(db, w):
    """score_pools prints per-pool progress; 18 weeks of it drowns the result."""
    import io
    import contextlib
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        r = score_week.score_pools(db, SEASON, w)
    return r


if __name__ == "__main__":
    sys.exit(main())
