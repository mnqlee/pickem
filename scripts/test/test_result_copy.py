#!/usr/bin/env python3
"""What a player actually reads on Tuesday morning.

These four lines used to be inline in notify(), which meant the only way
to see them was to send real notifications to real phones. Extracted into
result_copy() so they can be read here instead.

Run: python scripts/test/test_result_copy.py
"""
import importlib.util, os, sys, types

# score_week imports firebase_admin at module scope; stub it out.
for n in ("firebase_admin", "firebase_admin.credentials", "firebase_admin.firestore",
          "firebase_admin.messaging", "requests"):
    m = types.ModuleType(n); sys.modules.setdefault(n, m)
sys.modules["firebase_admin"].credentials = sys.modules["firebase_admin.credentials"]
sys.modules["firebase_admin"].firestore = sys.modules["firebase_admin.firestore"]
sys.modules["firebase_admin"].messaging = sys.modules["firebase_admin.messaging"]

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location(
    "sw", os.path.join(HERE, "..", "score_week.py"))
sw = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sw)

P = F = 0
def ok(name, cond, extra=""):
    global P, F
    if cond:
        P += 1; print("  ok   " + name)
    else:
        F += 1; print("  FAIL " + name + (("  -> " + str(extra)) if extra else ""))

def player(uid, name, wpts, whits=10):
    return {"uid": uid, "name": name, "wpts": wpts, "whits": whits, "total": wpts}

STEVEN = player("u1", "Steven Kern", 120, 13)
RONRON = player("u2", "Ron Ron", 113, 13)
LEE    = player("u3", "Lee", 104, 10)
LEADER = player("u3", "Lee", 119)

DONE = {"week": 1, "complete": True, "winners": ["Steven Kern"], "best": 120,
        "seconds": ["Ron Ron"], "secondPts": 113, "winnerUids": {"u1"},
        "results": [STEVEN, RONRON, LEE]}

print("\n1. The week winner is the news, and it leads the sentence")
t, b = sw.result_copy(DONE, LEE, 6, LEADER)
print(f"     {t}\n     {b}")
ok("names who won the week", "Steven Kern won it with 120" in b, b)
ok("and still gives the player their own placing", "You finished 6th with 104" in b, b)
ok("title is short enough for a lock screen", len(t) <= 32, f"{t} ({len(t)})")

print("\n2. The winner's own notification does not congratulate them by name")
t, b = sw.result_copy(DONE, STEVEN, 1, LEADER)
print(f"     {t}\n     {b}")
ok("title says they won", t == "You won Week 1", t)
ok("does not say 'Steven Kern won it' to Steven Kern", "Steven Kern won" not in b, b)
ok("names the runner-up instead", "Ron Ron second on 113" in b, b)

print("\n3. The season leader is not told twice that they lead")
t, b = sw.result_copy(DONE, LEE, 6, LEE)
ok("no season line for the leader", "leads the season" not in b, b)
t, b = sw.result_copy(DONE, STEVEN, 1, LEADER)
ok("but everyone else gets one", "Lee leads the season" in b, b)
# IDENTITY WAS THE WRONG TEST, and this fixture has been the proof all
# along: LEADER is a different dict from LEE carrying the same uid, so
# `r is not leader` told Lee that Lee leads the season. Compared by uid.
t, b = sw.result_copy(DONE, LEE, 6, LEADER)
ok("not even when the leader row is a separate copy of their own row",
   "leads the season" not in b, b)

print("\n3b. A tie at the top of the SEASON has more than one leader")
# apply_tiebreak ORDERS the season table; it does not decide who leads
# it. Naming results[0] told one co-leader that the other led, which
# contradicted the Standings screen that player was looking at.
CO = [player("u3", "Lee", 119), player("u4", "Vic", 119)]
t, b = sw.result_copy(DONE, STEVEN, 1, CO)
print(f"     {t}\n     {b}")
ok("both are named and the verb agrees", "Lee and Vic lead the season" in b, b)
_, b = sw.result_copy(DONE, CO[0], 6, CO)
ok("and neither of them is told somebody else leads",
   "lead the season" not in b and "leads the season" not in b, b)
THREE = CO + [player("u5", "Coker", 119)]
_, b = sw.result_copy(DONE, STEVEN, 1, THREE)
ok("three or more is counted, not listed", "3 players lead the season" in b, b)

print("\n4. A shared week reads properly rather than listing everybody")
ok("one name", sw.names_phrase(["A"]) == "A")
ok("two names joined", sw.names_phrase(["A", "B"]) == "A and B")
# A NOUN PHRASE, NOT A CLAUSE. It returned "3 players tied", and every
# caller puts a verb straight after it: "3 players tied won it with 120
# points", "3 players tied second on 113".
ok("three or more counted, not listed", sw.names_phrase(["A", "B", "C"]) == "3 players")
tie = dict(DONE, winners=["Steven Kern", "Ron Ron"], winnerUids={"u1", "u2"})
t, b = sw.result_copy(tie, LEE, 3, LEADER)
print(f"     {t}\n     {b}")
ok("a shared win names both", "Steven Kern and Ron Ron won it" in b, b)
three = dict(DONE, winners=["Steven Kern", "Ron Ron", "Coker"],
             winnerUids={"u1", "u2", "u6"})
t, b = sw.result_copy(three, LEE, 4, LEADER)
print(f"     {t}\n     {b}")
ok("and a three-way win is a sentence, not word salad",
   "3 players won it with 120 points" in b, b)

print("\n4b. Points carry their unit, and one point is singular")
ok("plural", sw.pts_label(104) == "104 points", sw.pts_label(104))
ok("singular", sw.pts_label(1) == "1 point", sw.pts_label(1))
ok("zero is plural", sw.pts_label(0) == "0 points", sw.pts_label(0))
# A straight-up week pays one point per correct pick, so "1 points" was
# reachable in a real pool rather than a contrived case.
one = dict(DONE, winners=["Steven Kern"], best=1, winnerUids={"u1"},
           seconds=[], secondPts=0)
_, b = sw.result_copy(one, player("u9", "Nick", 1), 2, LEADER)
print(f"     {b}")
ok("no '1 points' anywhere in a real body", "1 points" not in b, b)
ok("and the winner's total carries its unit too", "won it with 1 point." in b, b)

print("\n5. An unfinished week must never claim a winner")
mid = {"week": 1, "complete": False, "results": [STEVEN, LEE]}
t, b = sw.result_copy(mid, LEE, 2, LEADER)
print(f"     {t}\n     {b}")
ok("titled 'so far', not 'final'", t == "Week 1 so far", t)
ok("says nothing about winning", "won" not in b.lower(), b)
ok("reports progress only", "104 points, 10 correct" in b, b)

print("\n6. Every game final and nobody scored: no invented winner")
zero = {"week": 1, "complete": True, "winners": [], "best": 0, "seconds": [],
        "secondPts": 0, "winnerUids": set(), "results": [LEE]}
t, b = sw.result_copy(zero, LEE, 1, LEADER)
print(f"     {t}\n     {b}")
ok("no winner claimed", "won it" not in b, b)
ok("still tells them their own line", "You finished 1st with 104" in b, b)

print("\n7. Bodies stay short enough to read on a lock screen")
for label, rep, who, place in [("loser", DONE, LEE, 6), ("winner", DONE, STEVEN, 1),
                               ("mid-week", mid, LEE, 2)]:
    _, b = sw.result_copy(rep, who, place, LEADER)
    ok(f"{label} body under 120 chars", len(b) <= 120, f"{len(b)}: {b}")

print(f"\n{P} passed, {F} failed")
sys.exit(1 if F else 0)
