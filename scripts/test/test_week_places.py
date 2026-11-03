#!/usr/bin/env python3
"""Weekly places: week points first, then the tiebreaker.

v1.44.4. Built from the real Week 8 of the 2026 season, which crowned
two winners on 91 while one had guessed 48 and the other 58 on a game
(Bears @ Seahawks) that finished on 51.

Run: python scripts/test/test_week_places.py
"""
import importlib.util, os, sys, types

for n in ("firebase_admin", "firebase_admin.credentials", "firebase_admin.firestore",
          "firebase_admin.messaging", "requests"):
    sys.modules.setdefault(n, types.ModuleType(n))
for a in ("credentials", "firestore", "messaging"):
    setattr(sys.modules["firebase_admin"], a, sys.modules["firebase_admin." + a])

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("sw", os.path.join(HERE, "..", "score_week.py"))
sw = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sw)

P = F = 0
def ok(name, cond, extra=""):
    global P, F
    if cond:
        P += 1; print("  ok   " + name)
    else:
        F += 1; print("  FAIL " + name + (("  -> " + str(extra)) if extra else ""))

def row(uid, name, wpts, guess, actual=51):
    return {"uid": uid, "name": name, "wpts": wpts, "whits": 10, "total": wpts,
            "tbGuess": guess, "tbActual": actual}

def awards(results):
    """The award block's own logic, through week_places, as score_pools runs it."""
    ranked, place = sw.week_places(results)
    winners = [r["name"] for r in ranked if place[r["uid"]] == 1]
    nxt = next((r for r in ranked if place[r["uid"]] > 1), None)
    seconds = ([r["name"] for r in ranked if place[r["uid"]] == place[nxt["uid"]]]
               if nxt and nxt["wpts"] > 0 else [])
    return winners, seconds, place

print("\nWeek 8 as it really happened")
WEEK8 = [row("jer", "Jeremy A. Hazel", 91, 48), row("lub", "Lubbylubbs", 91, 58),
         row("blu", "Blue balls", 87, 41), row("cha", "Charles Evans", 87, None),
         row("lem", "Lemon", 87, 35), row("ron", "Ron Ron", 85, 48),
         row("mar", "Mario Minton", 84, 42), row("vic", "Vic", 84, 52)]
w, s, p = awards(WEEK8)
ok("Jeremy wins outright: 48 is under 51, 58 went over", w == ["Jeremy A. Hazel"], w)
ok("Lubbylubbs is second, alone, on the same 91", s == ["Lubbylubbs"], s)
ok("the 87s are 3rd, 4th, 5th: Blue balls 41, Lemon 35, Charles with no guess",
   [p["blu"], p["lem"], p["cha"]] == [3, 4, 5], [p["blu"], p["lem"], p["cha"]])
ok("Mario on 42 under beats Vic on 52 over, both on 84", p["mar"] < p["vic"], (p["mar"], p["vic"]))

print("\nTies the tiebreaker cannot break")
w, s, p = awards([row("a", "A", 90, 45), row("b", "B", 90, 45), row("c", "C", 80, 40)])
ok("the same guess on the same points still shares first", w == ["A", "B"], w)
ok("and the next player is 3rd, not 2nd", p["c"] == 3, p)
ok("so there is a runner-up: C", s == ["C"], s)
w, s, p = awards([row("a", "A", 90, None), row("b", "B", 90, None)])
ok("two players with no guess share", w == ["A", "B"], w)

print("\nThe edges of the rule")
w, s, p = awards([row("a", "A", 90, 60), row("b", "B", 90, 55)])
ok("both over: the smaller overshoot wins", w == ["B"], w)
w, s, p = awards([row("a", "A", 90, 51), row("b", "B", 90, 50)])
ok("exactly right beats one under", w == ["A"], w)
w, s, p = awards([row("a", "A", 90, 48), row("b", "B", 90, 54)])
ok("three under beats three over: without going over", w == ["A"], w)
w, s, p = awards([row("a", "A", 90, 90), row("b", "B", 90, None)])
ok("any guess, even a wild one, beats no guess", w == ["A"], w)
w, s, p = awards([row("a", "A", 95, 10), row("b", "B", 90, 51)])
ok("points always come first: a perfect guess cannot pass a higher score", w == ["A"], w)

print("\nLee's ruling: in 2026 it starts at Week 8")
_, p = sw.week_places(WEEK8, "2026", 7)
ok("2026 Week 7: the 91s still share first", p["jer"] == p["lub"] == 1, p)
_, p = sw.week_places(WEEK8, "2026", 8)
ok("2026 Week 8: Jeremy first, Lubbylubbs second", (p["jer"], p["lub"]) == (1, 2), p)
_, p = sw.week_places(WEEK8, "2027", 1)
ok("2027 Week 1: the tiebreaker decides from the start", (p["jer"], p["lub"]) == (1, 2), p)

print("\nBefore the total is known")
live = [dict(r, tbActual=None) for r in WEEK8]
_, p = sw.week_places(live)
ok("no final total: players level on points share a place", p["jer"] == p["lub"] == 1, p)
ok("and the 87s all sit 3rd", p["blu"] == p["cha"] == p["lem"] == 3, p)

print("\nThe notification says so")
results = WEEK8
rep = {"week": 8, "complete": True, "results": results, "winners": ["Jeremy A. Hazel"],
       "winnerUids": {"jer"}, "best": 91, "seconds": ["Lubbylubbs"], "secondPts": 91}
t, b = sw.result_copy(rep, WEEK8[0], 1, [WEEK8[0]])
ok("the winner is told it came down to the tiebreaker", t == "You won Week 8" and "on the tiebreaker" in b, b)
t, b = sw.result_copy(rep, WEEK8[1], 2, [WEEK8[0]])
ok("the runner-up is told who won, and that it was the tiebreaker",
   "Jeremy A. Hazel won it with 91 points on the tiebreaker" in b and "2nd" in b, b)
rep2 = dict(rep, secondPts=87, seconds=["Blue balls"])
t, b = sw.result_copy(rep2, WEEK8[0], 1, [WEEK8[0]])
ok("a week won on points does not mention the tiebreaker", "tiebreaker" not in b, b)

print(f"\n{P} passed, {F} failed")
sys.exit(1 if F else 0)
