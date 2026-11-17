#!/usr/bin/env python3
"""The before-kickoff lines refresh (lines-prekick.yml -> pre_kickoff_lines).

Proves, against the in-memory Firestore stand-in:
  * it refreshes once when a slate is inside the 2 hour lead,
  * it does nothing when the next game is further away,
  * it never refreshes the same slate twice, but does refresh the next one,
  * a failed ESPN pull leaves no marker, so the next hour retries,
  * it writes nothing except spreads and its own marker,
  * pull_lines now reports how many games it priced, and still never
    creates games or erases a line ESPN stopped quoting,
  * the daily --lines-only path is unchanged.

Run: python scripts/test/test_prekick_lines.py
"""
import importlib.util, os, sys, types, copy
from datetime import datetime, timedelta, timezone

for n in ("firebase_admin", "firebase_admin.credentials", "firebase_admin.firestore",
          "firebase_admin.messaging", "requests"):
    sys.modules.setdefault(n, types.ModuleType(n))
for a in ("credentials", "firestore", "messaging"):
    setattr(sys.modules["firebase_admin"], a, sys.modules["firebase_admin." + a])

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from fakestore import FakeFirestore

SW = os.environ.get("SW_PATH") or os.path.join(HERE, "..", "score_week.py")
spec = importlib.util.spec_from_file_location("sw", SW)
sw = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sw)

P = F = 0
def ok(name, cond, extra=""):
    global P, F
    if cond:
        P += 1; print("  ok   " + name)
    else:
        F += 1; print("  FAIL " + name + (("  -> " + str(extra)) if extra else ""))

UTC = timezone.utc
T0 = datetime(2026, 11, 15, 18, 0, tzinfo=UTC)          # Sunday 1:00 PM ET

def db_with(games):
    db = FakeFirestore()
    for gid, wk, kick in games:
        db.seed(f"seasons/2026/games/{gid}", {"wk": wk, "kickoff": kick,
                                               "away": gid.split("_")[2],
                                               "home": gid.split("_")[3],
                                               "spread": "OLD"})
    return db

class Pull:
    """Stands in for pull_lines: records the call and fills per-week counts.
    ret = games priced in the slate's own week, nxt = in the week after."""
    def __init__(self, ret=14, nxt=13):
        self.calls, self.ret, self.nxt = [], ret, nxt
    def __call__(self, db, season, wk, counts=None):
        self.calls.append((season, wk))
        if counts is not None:
            counts[wk], counts[wk + 1] = self.ret, self.nxt
        return self.ret + self.nxt

def marker(db):
    return db.read("seasons/2026/meta/lines")

SLATE = [("2026_W10_NE_DET", 10, T0), ("2026_W10_BUF_NYJ", 10, T0),
         ("2026_W10_KC_ATL", 10, T0 + timedelta(minutes=185)),     # 4:05
         ("2026_W10_MIA_IND", 10, T0 + timedelta(minutes=205)),    # 4:25
         ("2026_W11_IND_HOU", 11, T0 + timedelta(days=4))]

print("timing")
db = db_with(SLATE); p = Pull()
r = sw.pre_kickoff_lines(db, "2026", now=T0 - timedelta(hours=5), pull=p)
ok("5 hours out: nothing to do", r == "early" and not p.calls and marker(db) is None, r)
ok("5 hours out costs one read", db.reads == 1, db.reads)

db = db_with(SLATE); p = Pull()
r = sw.pre_kickoff_lines(db, "2026", now=T0 - timedelta(minutes=121), pull=p)
ok("121 min out: still early", r == "early" and not p.calls, r)
r = sw.pre_kickoff_lines(db, "2026", now=T0 - timedelta(minutes=120), pull=p)
ok("120 min out: refreshes", r == "refreshed" and p.calls == [("2026", 10)], (r, p.calls))

db = db_with(SLATE); p = Pull()
r = sw.pre_kickoff_lines(db, "2026", now=T0 - timedelta(minutes=90), pull=p)
ok("90 min out: refreshes week 10", r == "refreshed" and p.calls == [("2026", 10)], (r, p.calls))
m = marker(db)
ok("marker holds the slate's kickoff", m and m["preKickFor"] == T0 and m["week"] == 10 and m["priced"] == 14, m)

print("once per slate")
r = sw.pre_kickoff_lines(db, "2026", now=T0 - timedelta(minutes=30), pull=p)
ok("next hour, same slate: no second pull", r == "done" and len(p.calls) == 1, (r, p.calls))
r = sw.pre_kickoff_lines(db, "2026", now=T0 - timedelta(minutes=1), pull=p)
ok("1 min before: still no second pull", r == "done" and len(p.calls) == 1, (r, p.calls))
r = sw.pre_kickoff_lines(db, "2026", now=T0, pull=p)
ok("at 1:00 kickoff the next game is 4:05, 185 min away: early", r == "early" and len(p.calls) == 1, r)
r = sw.pre_kickoff_lines(db, "2026", now=T0 + timedelta(minutes=95), pull=p)
ok("90 min before 4:05: a new slate, refreshes", r == "refreshed" and len(p.calls) == 2, (r, p.calls))
r = sw.pre_kickoff_lines(db, "2026", now=T0 + timedelta(minutes=190), pull=p)
ok("4:25 is the same slate as 4:05: no pull", r == "done" and len(p.calls) == 2, (r, p.calls))
r = sw.pre_kickoff_lines(db, "2026", now=T0 + timedelta(days=4) - timedelta(minutes=70), pull=p)
ok("next week's game: refreshes week 11", r == "refreshed" and p.calls[-1] == ("2026", 11), p.calls)

print("a dropped hour is covered")
db = db_with(SLATE); p = Pull()
r = sw.pre_kickoff_lines(db, "2026", now=T0 - timedelta(minutes=40), pull=p)
ok("first run GitHub let through was 40 min out: still refreshes", r == "refreshed", r)

print("ESPN gave nothing")
db = db_with(SLATE); p = Pull(ret=0)
r = sw.pre_kickoff_lines(db, "2026", now=T0 - timedelta(minutes=100), pull=p)
ok("failed pull: reported as failed", r == "failed", r)
ok("failed pull: no marker written", marker(db) is None, marker(db))
db = db_with(SLATE); p = Pull(ret=0, nxt=16)
r = sw.pre_kickoff_lines(db, "2026", now=T0 - timedelta(minutes=100), pull=p)
ok("ESPN failed for this week but priced next week: still failed", r == "failed" and marker(db) is None, (r, marker(db)))
p.ret = 12
r = sw.pre_kickoff_lines(db, "2026", now=T0 - timedelta(minutes=40), pull=p)
ok("next hour retries and succeeds", r == "refreshed" and len(p.calls) == 2, (r, p.calls))

print("slate width, exactly")
for gap, want in ((60, "done"), (61, "refreshed")):
    db = db_with([("2026_W10_A_B", 10, T0), ("2026_W10_C_D", 10, T0 + timedelta(minutes=gap))])
    db.seed("seasons/2026/meta/lines", {"preKickFor": T0})
    r = sw.pre_kickoff_lines(db, "2026", now=T0 + timedelta(minutes=1), pull=Pull())
    ok(f"kickoff {gap} min after the refreshed one: {want}", r == want, r)

print("edges")
db = FakeFirestore(); p = Pull()
ok("no games left: nothing", sw.pre_kickoff_lines(db, "2026", now=T0, pull=p) == "none" and not p.calls)
db = db_with([("2026_W10_NE_DET", 10, T0)]); p = Pull()
ok("game kicking off this second is not 'next'", sw.pre_kickoff_lines(db, "2026", now=T0, pull=p) == "none")
db = FakeFirestore(); db.seed("seasons/2026/games/2026_W10_A_B", {"kickoff": T0}); p = Pull()
ok("next game without a week: nothing, no crash",
   sw.pre_kickoff_lines(db, "2026", now=T0 - timedelta(minutes=60), pull=p) == "none" and not p.calls)
db = db_with([("2026_W10_NE_DET", 10, T0)]); p = Pull()
ok("naive 'now' read as UTC",
   sw.pre_kickoff_lines(db, "2026", now=(T0 - timedelta(minutes=60)).replace(tzinfo=None), pull=p) == "refreshed")
class TS:                                   # what google.api_core hands back
    def __init__(self, d): self.d = d
    def timestamp(self): return self.d.timestamp()
ok("timestamp-like objects and naive datetimes convert", sw._utc(TS(T0)) == T0 and sw._utc(T0.replace(tzinfo=None)) == T0 and sw._utc(None) is None and sw._utc("x") is None)
db = db_with(SLATE); db.seed("seasons/2026/meta/lines", {"preKickFor": T0 - timedelta(days=3)}); p = Pull()
ok("last week's marker does not block this slate",
   sw.pre_kickoff_lines(db, "2026", now=T0 - timedelta(minutes=80), pull=p) == "refreshed")
db = db_with(SLATE); db.seed("seasons/2026/meta/lines", {"preKickFor": T0 + timedelta(minutes=30)}); p = Pull()
ok("a game moved EARLIER than the marked slate still refreshes",
   sw.pre_kickoff_lines(db, "2026", now=T0 - timedelta(minutes=80), pull=p) == "refreshed")
db = FakeFirestore(); db.seed("seasons/2026PRE/games/2026PRE_W2_A_B", {"wk": 2, "kickoff": T0})
db.seed("seasons/2026/games/2026_W1_C_D", {"wk": 1, "kickoff": T0 - timedelta(minutes=30)}); p = Pull()
r = sw.pre_kickoff_lines(db, "2026PRE", now=T0 - timedelta(minutes=60), pull=p)
ok("preseason season id reads its own games", r == "refreshed" and p.calls == [("2026PRE", 2)], r)

db = FakeFirestore(); db.seed("seasons/2026PRE/games/2026PRE_W0_A_B", {"wk": 0, "kickoff": T0}); p = Pull()
r = sw.pre_kickoff_lines(db, "2026PRE", now=T0 - timedelta(minutes=60), pull=p)
ok("week 0 (Hall of Fame game) is a real week", r == "refreshed" and p.calls == [("2026PRE", 0)], r)

print("writes nothing else")
db = db_with(SLATE)
db.seed("pools/P1/picks/x", {"uid": "u", "winner": "NE"}); db.seed("pools/P1/standings/u", {"total": 50})
before = copy.deepcopy(db.docs)
sw.pre_kickoff_lines(db, "2026", now=T0 - timedelta(minutes=90), pull=Pull())
changed = {k for k in set(before) | set(db.docs) if before.get(k) != db.docs.get(k)}
ok("only the marker changed (pull stubbed)", changed == {("seasons", "2026", "meta", "lines")}, changed)

print("pull_lines, with ESPN faked")
class Resp:
    def __init__(self, events, fail=False): self.events, self.fail = events, fail
    def raise_for_status(self):
        if self.fail: raise RuntimeError("503")
    def json(self): return {"events": self.events}
def ev(away, home, details):
    return {"competitions": [{"odds": [{"details": details}] if details is not None else [],
                              "competitors": [{"homeAway": "away", "team": {"abbreviation": away}},
                                              {"homeAway": "home", "team": {"abbreviation": home}}]}]}
FEED = {10: [ev("NE", "DET", "DET -3"), ev("BUF", "NYJ", ""), ev("XX", "YY", "YY -1"),
             ev("KC", "ATL", None)],
        11: [ev("IND", "HOU", "HOU -10")]}
def fake_get(url, params=None, timeout=None):
    return Resp(FEED.get(params["week"], []))
sw.requests.get = fake_get
db = db_with(SLATE)
cnt = {}
n = sw.pull_lines(db, "2026", 10, cnt)
ok("returns games priced across both weeks", n == 2, n)
ok("reports games priced per week", cnt == {10: 1, 11: 1}, cnt)
ok("changed line stored", db.read("seasons/2026/games/2026_W10_NE_DET")["spread"] == "DET -3")
ok("blank line from ESPN keeps the old one", db.read("seasons/2026/games/2026_W10_BUF_NYJ")["spread"] == "OLD")
ok("game ESPN has no odds for is untouched", db.read("seasons/2026/games/2026_W10_KC_ATL")["spread"] == "OLD")
ok("unknown game is never created", db.read("seasons/2026/games/2026_W10_XX_YY") is None)
ok("next week priced too", db.read("seasons/2026/games/2026_W11_IND_HOU")["spread"] == "HOU -10")
sw.requests.get = lambda *a, **k: Resp([], fail=True)
cnt = {}
ok("ESPN down: returns 0, no crash", sw.pull_lines(db_with(SLATE), "2026", 10, cnt) == 0 and cnt == {}, cnt)
ok("week past 18 is skipped", sw.pull_lines(db_with(SLATE), "2026", 19) == 0)

print("the command line")
calls = []
fakedb = db_with(SLATE)
sw.firebase_admin.initialize_app = lambda *a, **k: None
sw.credentials.Certificate = lambda *a, **k: None
sw.firestore.client = lambda: fakedb
real_pre, real_pull = sw.pre_kickoff_lines, sw.pull_lines
sw.pre_kickoff_lines = lambda db, season, **k: calls.append(("pre", season)) or "early"
sw.pull_lines = lambda db, season, wk, counts=None: calls.append(("pull", season, wk)) or 1
def boom(*a, **k): raise AssertionError("scoring path reached")
real_scores, real_score_pools = sw.pull_scores, sw.score_pools
sw.pull_scores = boom; sw.score_pools = boom
sys.argv = ["score_week.py", "--season", "2026", "--before-kickoff"]
try:
    sw.main(); ok("--before-kickoff runs only the before-kickoff check", calls == [("pre", "2026")], calls)
except AssertionError as e:
    ok("--before-kickoff never reaches scoring", False, e)
calls.clear()
sys.argv = ["score_week.py", "--season", "2026", "--lines-only", "--week", "10"]
try:
    sw.main(); ok("daily --lines-only unchanged: pulls week 10 only", calls == [("pull", "2026", 10)], calls)
except AssertionError as e:
    ok("daily --lines-only never reaches scoring", False, e)
sw.pre_kickoff_lines, sw.pull_lines, sw.pull_scores, sw.score_pools = real_pre, real_pull, real_scores, real_score_pools

print(f"\n{P} passed, {F} failed")
sys.exit(1 if F else 0)
