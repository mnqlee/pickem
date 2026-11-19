#!/usr/bin/env python3
"""Following a kickoff the NFL moves (score_week.py follow_kickoff, run by
the daily lines refresh and the before-kickoff refresh).

Proves, against the in-memory Firestore stand-in and a stand-in ESPN:
  * a game moved later or earlier gets ESPN's new time, and only that field,
  * every pick and tiebreak guess saved for it, in every league, is sealed
    until the new time (repin_reveals.py), and nothing else is touched,
  * left alone: a game already started (ours or ESPN's), a placeholder
    time (timeValid false), a new time already past, a change under a
    minute, a game we do not have (never created),
  * spreads still refresh exactly as before,
  * nothing printed carries an em dash.
Then part 2 breaks score_week.py on purpose and the named checks must fail.

Run: python scripts/test/test_kickoff_sync.py      (NOMUT=1 skips part 2)
"""
import importlib.util, io, os, sys, tempfile, types, contextlib
from datetime import datetime, timedelta, timezone

for n in ("firebase_admin", "firebase_admin.credentials", "firebase_admin.firestore",
          "firebase_admin.messaging", "requests"):
    sys.modules.setdefault(n, types.ModuleType(n))
for a in ("credentials", "firestore", "messaging"):
    setattr(sys.modules["firebase_admin"], a, sys.modules["firebase_admin." + a])

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.dirname(HERE)
sys.path.insert(0, HERE); sys.path.insert(0, SCRIPTS)
from fakestore import FakeFirestore

SRC = open(os.path.join(SCRIPTS, "score_week.py"), encoding="utf-8").read()
UTC = timezone.utc
NOW = datetime(2026, 11, 19, 12, 0, tzinfo=UTC)
D = timedelta(days=1); H = timedelta(hours=1)


def load(src):
    f = tempfile.NamedTemporaryFile("w", suffix=".py", delete=False, encoding="utf-8")
    f.write(src); f.close()
    spec = importlib.util.spec_from_file_location("sw_" + str(abs(hash(src))), f.name)
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    return m


def iso(t):
    return t.strftime("%Y-%m-%dT%H:%MZ")


def ev(away, home, when, state="pre", valid=True, odds="KC -3"):
    c = {"competitors": [{"homeAway": "away", "team": {"abbreviation": away}},
                         {"homeAway": "home", "team": {"abbreviation": home}}],
         "status": {"type": {"state": state}}, "odds": [{"details": odds}] if odds else []}
    if valid is not None:
        c["timeValid"] = valid
    return {"date": iso(when), "competitions": [c]}


class Resp:
    def __init__(self, data): self.data = data
    def raise_for_status(self): pass
    def json(self): return self.data


def world():
    db = FakeFirestore()
    g = lambda gid, kick, wk=12: db.seed(f"seasons/2026/games/2026_W{wk}_{gid}", {"wk": wk, "kickoff": kick,
        "away": gid.split("_")[0], "home": gid.split("_")[1], "spread": "OLD", "network": "NBC"})
    g("LATER_A", NOW + 3 * D)            # flexed to Sunday night
    g("EARLY_A", NOW + 3 * D + 7 * H)    # flexed earlier
    g("SAME_A", NOW + 4 * D)
    g("TINY_A", NOW + 4 * D + timedelta(seconds=30))
    g("TBD_A", NOW + 5 * D)
    g("GONE_A", NOW - 2 * H)             # already kicked off here
    g("LIVE_A", NOW + 2 * H)             # ESPN says it has started
    g("PAST_A", NOW + 2 * D)             # ESPN's time is in the past
    for pool in ("P1", "P2"):
        db.seed(f"pools/{pool}", {"season": "2026", "name": pool})
        for uid in ("u1", "u2"):
            for gid, kick in (("LATER_A", NOW + 3 * D), ("EARLY_A", NOW + 3 * D + 7 * H), ("SAME_A", NOW + 4 * D)):
                db.seed(f"pools/{pool}/picks/{uid}_2026_W12_{gid}", {"uid": uid, "gameId": f"2026_W12_{gid}", "wk": 12,
                        "winner": "A", "weight": 3, "revealAt": kick})
        db.seed(f"pools/{pool}/tiebreaks/u1_12", {"uid": "u1", "wk": 12, "gameId": "2026_W12_LATER_A", "total": 44,
                "revealAt": NOW + 3 * D})
    events = [ev("LATER", "A", NOW + 3 * D + 4 * H, odds=None), ev("EARLY", "A", NOW + 3 * D), ev("SAME", "A", NOW + 4 * D),
              ev("TINY", "A", NOW + 4 * D), ev("TBD", "A", NOW + 6 * D, valid=False),
              ev("GONE", "A", NOW + 1 * D), ev("LIVE", "A", NOW + 1 * D, state="in"), ev("PAST", "A", NOW - 1 * H),
              ev("NEW", "B", NOW + 3 * D)]
    return db, events


def run(sw):
    db, events = world()
    before = {k: dict(v) for k, v in db.docs.items()} if hasattr(db, "docs") else None
    sw.requests.get = lambda url, params=None, timeout=None: Resp({"events": events if params.get("week") == 12 else []})
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        sw.pull_lines(db, "2026", 12, now=NOW)
    return db, out.getvalue(), before


def suite(sw):
    res = {}
    def ok(name, cond, extra=""):
        res[name] = bool(cond)
        if not cond and extra: res[name + " ::"] = extra
    db, text, before = run(sw)
    get = lambda p: db.get(p) if hasattr(db, "get") else None
    G = lambda gid: (db.collection("seasons").document("2026").collection("games").document(f"2026_W12_{gid}").get().to_dict() or {})
    kick = lambda gid: G(gid).get("kickoff")
    ok("a game moved later takes ESPN's new time", kick("LATER_A") == NOW + 3 * D + 4 * H, kick("LATER_A"))
    ok("a game moved earlier takes ESPN's new time", kick("EARLY_A") == NOW + 3 * D, kick("EARLY_A"))
    g = G("LATER_A")
    ok("nothing else on a moved game changes", g.get("network") == "NBC" and g.get("away") == "LATER" and g.get("wk") == 12, g)
    ok("a game already started here is left alone", kick("GONE_A") == NOW - 2 * H)
    ok("a game ESPN says has started is left alone", kick("LIVE_A") == NOW + 2 * H)
    ok("a placeholder time (timeValid false) is left alone", kick("TBD_A") == NOW + 5 * D)
    ok("a new time already in the past is left alone", kick("PAST_A") == NOW + 2 * D)
    ok("a change under a minute is left alone", kick("TINY_A") == NOW + 4 * D + timedelta(seconds=30))
    ok("a game we do not have is never created", not db.collection("seasons").document("2026").collection("games").document("2026_W12_NEW_B").get().exists)
    P = lambda pool, uid, gid: (db.collection("pools").document(pool).collection("picks").document(f"{uid}_2026_W12_{gid}").get().to_dict() or {})
    ok("every pick for a moved game, in every league, is sealed until the new time",
       all(P(p, u, "LATER_A").get("revealAt") == NOW + 3 * D + 4 * H and P(p, u, "EARLY_A").get("revealAt") == NOW + 3 * D
           for p in ("P1", "P2") for u in ("u1", "u2")), [P("P1", "u1", "LATER_A"), P("P2", "u2", "EARLY_A")])
    ok("a pick keeps its team and stake", P("P1", "u1", "LATER_A").get("winner") == "A" and P("P1", "u1", "LATER_A").get("weight") == 3)
    ok("picks for a game that did not move are untouched", all(P(p, u, "SAME_A").get("revealAt") == NOW + 4 * D for p in ("P1", "P2") for u in ("u1", "u2")))
    tb = db.collection("pools").document("P2").collection("tiebreaks").document("u1_12").get().to_dict() or {}
    ok("a tiebreak guess on a moved game is sealed until the new time too", tb.get("revealAt") == NOW + 3 * D + 4 * H and tb.get("total") == 44, tb)
    ok("spreads still refresh as before, and a game with no line keeps its old one", G("SAME_A").get("spread") == "KC -3" and G("LATER_A").get("spread") == "OLD")
    ok("it says which games moved", "2 kickoff(s) moved" in text and "LATER_A" in text and "EARLY_A" in text, text[-400:])
    ok("no em dash in anything printed", "—" not in text)
    return res


BREAKS = [
    ("K1", "a placeholder time is followed", '    if c.get("timeValid") is False:\n        return False\n', "", ["a placeholder time (timeValid false) is left alone"]),
    ("K2", "a started game is moved", "    if state != \"pre\":\n        return False\n", "", ["a game ESPN says has started is left alone"]),
    ("K3", "our own kickoff is not checked", "old <= now or new <= now", "new <= now", ["a game already started here is left alone"]),
    ("K4", "a time in the past is taken", "old <= now or new <= now", "old <= now", ["a new time already in the past is left alone"]),
    ("K5", "every tiny change is written", "    if abs((new - old).total_seconds()) < 60:\n        return False\n", "", ["a change under a minute is left alone"]),
    ("K6", "picks are not re-sealed", "        report(repin(db, sid, only=moved, now=now), True)", "        pass", ["every pick for a moved game, in every league, is sealed until the new time", "a tiebreak guess on a moved game is sealed until the new time too"]),
    ("K7", "the whole game is replaced", 'col.document(gid).set({"kickoff": new}, merge=True)', 'col.document(gid).set({"kickoff": new})', ["nothing else on a moved game changes"]),
    ("K8", "the kickoff is never followed", "            follow_kickoff(col, gid, docs[gid], ev, c, moved, now)\n", "", ["a game moved later takes ESPN's new time", "a game moved earlier takes ESPN's new time"]),
    ("K9", "games without odds are skipped before the kickoff check", "            follow_kickoff(col, gid, docs[gid], ev, c, moved, now)\n            if not odds:\n                continue",
     "            if not odds:\n                continue\n            follow_kickoff(col, gid, docs[gid], ev, c, moved, now)", ["a game moved later takes ESPN's new time"]),
]

P_ = F_ = 0
def say(good, name, extra=""):
    global P_, F_
    if good: P_ += 1; print("  ok   " + name)
    else: F_ += 1; print("  FAIL " + name + (("  -> " + str(extra)) if extra else ""))

print("1. Following moved kickoffs as it is")
base = suite(load(SRC))
for k, v in base.items():
    if k.endswith(" ::"): continue
    say(v, k, base.get(k + " ::", ""))
if not os.environ.get("NOMUT"):
    print("\n2. Broken on purpose: the named checks must fail")
    for bid, what, find, rep, expect in BREAKS:
        if not expect: continue
        hits = SRC.count(find)
        if hits != 1:
            say(False, f"{bid} {what}", f"find matched {hits} times, needs exactly 1"); continue
        try:
            r = suite(load(SRC.replace(find, rep)))
        except Exception as e:
            say(False, f"{bid} {what}", f"crashed instead of failing its checks: {e}"); continue
        missed = [x for x in expect if r.get(x) is not False]
        say(not missed, f"{bid} {what}: caught by {len(expect)} named check(s)", "NOT caught by: " + " | ".join(missed))
print(f"\n{P_} passed, {F_} failed")
sys.exit(1 if F_ else 0)
