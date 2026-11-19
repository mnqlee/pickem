"""repin_reveals.py against the in-memory Firestore double.

A game's kickoff moves after people have picked it. Their picks must stay
sealed until the NEW kickoff, in every league, and nothing else may change.

    python scripts/test/test_repin_reveals.py
"""
import os, sys
from datetime import datetime, timedelta, timezone
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE); sys.path.insert(0, os.path.dirname(HERE))
from fakestore import FakeFirestore
import repin_reveals as rr

passed = failed = 0
def ok(name, cond, extra=""):
    global passed, failed
    if cond: passed += 1; print("  ok   " + name)
    else: failed += 1; print("  FAIL " + name + (f"  -> {extra}" if extra else ""))

NOW = datetime(2026, 11, 15, 19, 0, tzinfo=timezone.utc)      # Sunday, 2 pm ET
OLD = NOW - timedelta(hours=1)        # the flexed game WAS a 1 pm game: that time has passed
NEW = NOW + timedelta(hours=6, minutes=20)                    # it is now the night game
LATER = NOW + timedelta(days=1)                                # Monday night, never moved
DONE = NOW - timedelta(hours=3)                                # an early game, long kicked off
quiet = lambda *a, **k: None

def world():
    db = FakeFirestore()
    G = "seasons/2026/games/"
    db.seed(G + "FLEX", {"wk": 11, "away": "KC", "home": "BUF", "kickoff": NEW, "status": "scheduled"})
    db.seed(G + "MNF",  {"wk": 11, "away": "DAL", "home": "PHI", "kickoff": LATER, "status": "scheduled"})
    db.seed(G + "EARLY", {"wk": 11, "away": "NYJ", "home": "MIA", "kickoff": DONE, "status": "live"})
    db.seed(G + "SOON", {"wk": 11, "away": "SF", "home": "SEA", "kickoff": NOW + timedelta(hours=2), "status": "scheduled"})
    for pid, season in (("P1", "2026"), ("P2", "2026"), ("OLD", "2025")):
        db.seed(f"pools/{pid}", {"name": pid, "season": season})
        for u in ("u_a", "u_b"):
            db.seed(f"pools/{pid}/picks/{u}_FLEX", {"uid": u, "gameId": "FLEX", "wk": 11, "winner": "KC", "weight": 3, "revealAt": OLD, "updatedAt": OLD - timedelta(days=2)})
            db.seed(f"pools/{pid}/picks/{u}_MNF", {"uid": u, "gameId": "MNF", "wk": 11, "winner": "PHI", "weight": 1, "revealAt": LATER})
            db.seed(f"pools/{pid}/picks/{u}_EARLY", {"uid": u, "gameId": "EARLY", "wk": 11, "winner": "MIA", "weight": 2, "revealAt": DONE})
        # u_b picked the 4 pm game back when it was listed LATER than it is now (moved earlier)
        db.seed(f"pools/{pid}/picks/u_b_SOON", {"uid": "u_b", "gameId": "SOON", "wk": 11, "winner": "SF", "weight": 4, "revealAt": NOW + timedelta(hours=5)})
        # u_b's pick on the early game carries an older listing's time. The game has kicked off: leave it.
        db.seed(f"pools/{pid}/picks/u_b_EARLY", {"uid": "u_b", "gameId": "EARLY", "wk": 11, "winner": "MIA", "weight": 2, "revealAt": DONE - timedelta(hours=1)})
        db.seed(f"pools/{pid}/tiebreaks/u_a_11", {"uid": "u_a", "wk": 11, "gameId": "FLEX", "total": 44, "revealAt": OLD})
        db.seed(f"pools/{pid}/reveals/11", {"wk": 11, "through": NOW - timedelta(minutes=2), "count": 4,
                "picks": {"u_a": {"EARLY": ["MIA", 2], "FLEX": ["KC", 3]}, "u_b": {"EARLY": ["MIA", 2], "FLEX": ["KC", 3]}}})
    return db

print("\nLooking only (no --fix)")
db = world()
w0 = db.writes
rows = rr.repin(db, "2026", now=NOW, fix=False, log=quiet)
ok("looking changes nothing in the database", db.writes == w0 and db.read("pools/P1/picks/u_a_FLEX")["revealAt"] == OLD, str(db.writes - w0))
ok("it reports every pick and guess that carries the wrong time, in every league of the season",
   sorted((r["pool"], r["kind"], r["id"]) for r in rows) == sorted(
     [(p, "picks", "u_a_FLEX") for p in ("P1", "P2")] + [(p, "picks", "u_b_FLEX") for p in ("P1", "P2")]
     + [(p, "picks", "u_b_SOON") for p in ("P1", "P2")] + [(p, "tiebreaks", "u_a_11") for p in ("P1", "P2")]), str(rows))
ok("it says which of them the league could already see", all(r["exposed"] for r in rows if r["game"] == "FLEX") and not any(r["exposed"] for r in rows if r["game"] == "SOON"))

print("\nFixing")
db = world()
rows = rr.repin(db, "2026", now=NOW, log=quiet)
ok("a pick for a game moved LATER is sealed until the new kickoff, in every league",
   all(db.read(f"pools/{p}/picks/{u}_FLEX")["revealAt"] == NEW for p in ("P1", "P2") for u in ("u_a", "u_b")))
ok("so the rule the database uses (revealAt <= now) hides it again", all(db.read(f"pools/{p}/picks/u_a_FLEX")["revealAt"] > NOW for p in ("P1", "P2")))
ok("a tiebreak guess on that game is sealed the same way", db.read("pools/P1/tiebreaks/u_a_11")["revealAt"] == NEW and db.read("pools/P2/tiebreaks/u_a_11").get("total") == 44 and db.read("pools/P2/tiebreaks/u_a_11").get("uid") == "u_a")
ok("a pick for a game moved EARLIER opens at the new kickoff", db.read("pools/P1/picks/u_b_SOON")["revealAt"] == NOW + timedelta(hours=2))
p = db.read("pools/P1/picks/u_a_FLEX")
ok("only the time changes: the pick itself is untouched", p.get("winner") == "KC" and p.get("weight") == 3 and p.get("uid") == "u_a" and p.get("wk") == 11 and p.get("updatedAt") == OLD - timedelta(days=2) and sorted(p) == ["gameId", "revealAt", "uid", "updatedAt", "weight", "winner", "wk"], str(p))
ok("picks for games that did not move are not written at all", db.read("pools/P1/picks/u_a_MNF")["revealAt"] == LATER and not any(r["game"] == "MNF" for r in rows))
ok("a game that has already kicked off keeps showing", db.read("pools/P1/picks/u_a_EARLY")["revealAt"] == DONE and db.read("pools/P1/picks/u_b_EARLY")["revealAt"] == DONE - timedelta(hours=1) and not any(r["game"] == "EARLY" for r in rows))
ok("last season's leagues are not touched", db.read("pools/OLD/picks/u_a_FLEX")["revealAt"] == OLD and db.read("pools/OLD/reveals/11")["count"] == 4)
rv = db.read("pools/P1/reveals/11")
ok("picks the league could already see are taken back out of the week's reveal document", rv["picks"] == {"u_a": {"EARLY": ["MIA", 2]}, "u_b": {"EARLY": ["MIA", 2]}}, str(rv["picks"]))
ok("and its count is put right, the rest of it left alone", rv["count"] == 2 and rv["wk"] == 11 and rv["through"] == NOW - timedelta(minutes=2), str(rv))
w1 = db.writes
again = rr.repin(db, "2026", now=NOW, log=quiet)
ok("running it a second time finds nothing and writes nothing", again == [] and db.writes == w1, str(again))

print("\nCalled by an import, for the games it just moved")
db = world()
rows = rr.repin(db, "2026", only={"FLEX"}, now=NOW, log=quiet)
ok("only the named game is looked at", {r["game"] for r in rows} == {"FLEX"} and db.read("pools/P1/picks/u_b_SOON")["revealAt"] == NOW + timedelta(hours=5))
ok("and it is fixed", db.read("pools/P2/picks/u_b_FLEX")["revealAt"] == NEW)
db = world()
ok("a game id that does not exist is no trouble", rr.repin(db, "2026", only={"NOPE"}, now=NOW, log=quiet) == [])
db = world()
db.seed("seasons/2026/games/NOKICK", {"wk": 11, "away": "A", "home": "B"})
db.seed("pools/P1/reveals/11", {"wk": 11, "broken": True})
rows = rr.repin(db, "2026", now=NOW, log=quiet)
ok("a game with no kickoff and a damaged reveal document do not stop the fix", db.read("pools/P1/picks/u_a_FLEX")["revealAt"] == NEW and db.read("pools/P1/reveals/11") == {"wk": 11, "broken": True})

print("\nWhat Lee reads")
said = []
rr.report(rr.repin(world(), "2026", now=NOW, fix=False, log=quiet), False, log=said.append)
ok("looking says how many can be seen right now and how to fix it", any("RIGHT NOW" in s for s in said) and any("--fix" in s for s in said), str(said))
said = []
rr.report([], True, log=said.append)
ok("nothing wrong says so in one line", len(said) == 1 and "Nothing to do" in said[0])
ok("no em dashes in anything printed", not any("—" in s for s in said))

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
