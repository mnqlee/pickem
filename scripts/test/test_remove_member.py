"""remove_member.py against the in-memory Firestore double.

    python scripts/test/test_remove_member.py
"""
import copy, json, os, sys, tempfile
from datetime import datetime, timezone
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE); sys.path.insert(0, os.path.dirname(HERE))
from fakestore import FakeFirestore
import remove_member as rm

passed = failed = 0
def ok(name, cond, extra=""):
    global passed, failed
    if cond: passed += 1; print("  ok   " + name)
    else: failed += 1; print("  FAIL " + name + (f"  -> {extra}" if extra else ""))

P = "pools/P1"
GONE, KEEP, OWNER = "u_aaaa", "u_aaaab", "u_owner"   # KEEP's id starts with GONE's
T = lambda d: datetime(2026, 9, d, 12, tzinfo=timezone.utc)

def seed(game_live=False):
    db = FakeFirestore()
    db.seed(P, {"name": "Pool", "season": "2026", "ownerUid": OWNER})
    for u, n in ((GONE, "Gone Guy"), (KEEP, "Keeper"), (OWNER, "Lee")):
        db.seed(f"{P}/members/{u}", {"name": n})
        db.seed(f"{P}/standings/{u}", {"pts": 50, "weeks": {"1": {"pts": 50}}})
    for g in ("2026_W1_A_B", "2026_W1_C_D"):
        db.seed(f"{P}/picks/{GONE}_{g}", {"uid": GONE, "wk": 1, "winner": "A", "weight": 3, "updatedAt": T(5)})
        db.seed(f"{P}/picks/{KEEP}_{g}", {"uid": KEEP, "wk": 1, "winner": "B", "weight": 4, "updatedAt": T(20)})
    # The traps: a pick of GONE's with no uid field, and one of KEEP's whose
    # field wrongly names GONE. Match by document id, never by field.
    db.seed(f"{P}/picks/{GONE}_2026_W1_E_F", {"wk": 1, "winner": "E", "weight": 2, "updatedAt": T(5)})
    db.seed(f"{P}/picks/{KEEP}_2026_W1_E_F", {"uid": GONE, "wk": 1, "winner": "F", "weight": 5, "updatedAt": T(20)})
    db.seed(f"{P}/tiebreaks/{GONE}_1", {"uid": GONE, "wk": 1, "total": 44})
    db.seed(f"{P}/tiebreaks/{KEEP}_1", {"uid": KEEP, "wk": 1, "total": 50})
    db.seed(f"{P}/private/roster", {GONE: {"name": "Gone Guy", "tokens": ["t1"]},
                                    KEEP: {"name": "Keeper"}, OWNER: {"name": "Lee"}})
    kick = datetime.now(timezone.utc).timestamp() - (3600 if game_live else 30 * 86400)
    db.seed("seasons/2026/games/g1", {"away": "A", "home": "B", "kickoff": datetime.fromtimestamp(kick, tz=timezone.utc),
                                      "status": "in" if game_live else "final"})
    return db

def args(*a):
    return rm.parse(["--season", "2026", "--backup-dir", BK, *a])

def lines(): 
    buf = []; return buf, (lambda *x: buf.append(" ".join(str(y) for y in x)))

BK = tempfile.mkdtemp()

print("\nListing")
db = seed(); buf, out = lines()
rm.run(db, args("--list"), out=out)
# list prints through print(), so capture via run's own list path
import io, contextlib
s = io.StringIO()
with contextlib.redirect_stdout(s): rm.run(db, args("--list"))
txt = s.getvalue()
ok("lists every player", all(n in txt for n in ("Gone Guy", "Keeper", "Lee")), txt)
ok("least recent first, so the quiet ones are on top", txt.index("Gone Guy") < txt.index("Keeper"), txt)
ok("marks the owner", "(owner)" in txt)

print("\nDry run changes nothing")
db = seed(); before = copy.deepcopy(db.docs); buf, out = lines()
rm.run(db, args("--uid", GONE), out=out)
ok("without --delete nothing is written", db.docs == before)
ok("it reports what it found", any("pick documents          3" in l for l in buf), buf)
ok("and says nothing was changed", any("Nothing was changed" in l for l in buf))

print("\nDelete")
db = seed(); buf, out = lines()
code = rm.run(db, args("--uid", GONE, "--delete"), confirm=lambda _: "DELETE", out=out)
ok("finishes cleanly", code == 0, buf)
ok("member record gone", db.read(f"{P}/members/{GONE}") is None)
ok("every pick by document id gone, including one with no uid field",
   not any(k[-1].startswith(GONE + "_2026") for k in db.docs if "picks" in k))
ok("KEEP's picks all untouched, including the one whose field wrongly names GONE",
   sum(1 for k in db.docs if "picks" in k and k[-1].startswith(KEEP + "_")) == 3)
ok("a player whose id merely STARTS WITH the removed id keeps everything",
   db.read(f"{P}/members/{KEEP}") and db.read(f"{P}/tiebreaks/{KEEP}_1") and db.read(f"{P}/standings/{KEEP}"))
ok("tiebreak gone", db.read(f"{P}/tiebreaks/{GONE}_1") is None)
ok("standings row gone", db.read(f"{P}/standings/{GONE}") is None)
r = db.read(f"{P}/private/roster")
ok("roster key gone, so no more reminders", GONE not in r)
ok("the other roster entries are intact", r.get(KEEP) == {"name": "Keeper"} and OWNER in r, r)
bk = [f for f in os.listdir(BK) if GONE in f]
ok("a backup file was written first", len(bk) == 1, os.listdir(BK))

print("\nRestore puts it all back")
db2 = seed(); orig = copy.deepcopy(db2.docs)
rm.run(db2, args("--uid", GONE, "--delete"), confirm=lambda _: "DELETE", out=lambda *x: None)
path = sorted(os.path.join(BK, f) for f in os.listdir(BK) if GONE in f)[-1]
rm.run(db2, args("--restore", path), out=lambda *x: None)
ok("every document is back exactly as it was", db2.docs == orig,
   [k for k in set(orig) | set(db2.docs) if orig.get(k) != db2.docs.get(k)][:3])

print("\nRefusals")
db = seed(); before = copy.deepcopy(db.docs); buf, out = lines()
code = rm.run(db, args("--uid", GONE, "--delete"), confirm=lambda _: "no", out=out)
ok("anything but DELETE cancels, and nothing changes", code == 1 and db.docs == before)
db = seed(); before = copy.deepcopy(db.docs); buf, out = lines()
code = rm.run(db, args("--uid", OWNER, "--delete"), confirm=lambda _: "DELETE", out=out)
ok("refuses to remove the pool owner", code == 2 and db.docs == before, buf)
db = seed(game_live=True); before = copy.deepcopy(db.docs); buf, out = lines()
code = rm.run(db, args("--uid", GONE, "--delete"), confirm=lambda _: "DELETE", out=out)
ok("refuses while a game is being played", code == 2 and db.docs == before, buf)
code = rm.run(db, args("--uid", GONE, "--delete", "--anytime"), confirm=lambda _: "DELETE", out=out)
ok("unless --anytime", code == 0 and db.read(f"{P}/members/{GONE}") is None)
db = seed(); before = copy.deepcopy(db.docs); buf, out = lines()
code = rm.run(db, args("--uid", GONE, "--delete"), confirm=lambda _: "DELETE", out=out) if False else None
bad = rm.parse(["--season", "2026", "--backup-dir", "/proc/nope/x", "--uid", GONE, "--delete"])
code = rm.run(db, bad, confirm=lambda _: "DELETE", out=out)
ok("if the backup cannot be written, nothing is deleted", code == 2 and db.docs == before, buf[-1:])
db = seed(); buf, out = lines()
code = rm.run(db, args("--uid", "u_typo"), out=out)
ok("an unknown uid is reported, not silently ignored", code == 1 and any("not in any pool" in l for l in buf))

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
