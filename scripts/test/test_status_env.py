#!/usr/bin/env python3
"""The four variables that decide what the Live-scores window does.

scores-loop.yml runs for up to 350 minutes and now makes two decisions
inside that window that it never used to make:

  1. WHEN THE WEEK IS OVER, SCORE IT. Monday Night Football goes final
     around 23:30 ET and the next scheduled scoring run is the Tuesday
     cron, so the pool spent about four hours looking at a finished week
     with no winner, no seals and no notification. The window is awake at
     that moment; it just needed to be told.
  2. WHEN THERE IS NOTHING LEFT TO WATCH, STOP. A window whose last
     whistle went twenty minutes in spent five hours asking ESPN about a
     week that could not change.

Both are decided entirely by what scripts/status_env.py prints, so this
is where the dangerous case lives. It is not a crash — a crash leaves the
old behaviour, which works. It is printing ST_COMPLETE=1 for a week that
is not complete: that scores a live week, publishes weekly awards on it
and pushes a results notification to every phone in the pool.

So the shape of this file is: every malformed, partial and hostile input
must produce the DEFAULTS, and ST_COMPLETE=1 must require agreement
between the boolean and the counts.

Run: python scripts/test/test_status_env.py
"""
import importlib.util
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SE = os.path.join(HERE, "..", "status_env.py")
spec = importlib.util.spec_from_file_location("status_env", SE)
se = importlib.util.module_from_spec(spec)
spec.loader.exec_module(se)

P = F = 0


def ok(name, cond, extra=""):
    global P, F
    if cond:
        P += 1
        print("  ok   " + name)
    else:
        F += 1
        print("  FAIL " + name + (("  -> " + str(extra)) if extra else ""))


def env_of(payload, raw=None):
    """Write a status file and read back the four variables."""
    fd, path = tempfile.mkstemp(suffix=".json")
    try:
        with os.fdopen(fd, "w") as f:
            if raw is not None:
                f.write(raw)
            else:
                json.dump(payload, f)
        return se.env(path)
    finally:
        os.unlink(path)


GOOD = {"season": "2026", "week": 4, "games": 16, "final": 16, "live": 0,
        "complete": True, "next_kick_ms": 1789000000000, "now_ms": 1788000000000}

print("\n1. A finished week is reported as finished")
e = env_of(GOOD)
ok("the week is named", e["ST_WEEK"] == "4", e)
ok("complete is 1", e["ST_COMPLETE"] == "1", e)
ok("nothing live", e["ST_LIVE"] == "0", e)
ok("the next kickoff comes back in SECONDS, for date +%s",
   e["ST_NEXT"] == "1789000000", e)

print("\n2. A part-played week closes nothing")
e = env_of(dict(GOOD, final=15, live=1, complete=False))
ok("complete is 0", e["ST_COMPLETE"] == "0", e)
ok("but the week is still named", e["ST_WEEK"] == "4", e)
ok("and the live count is passed through", e["ST_LIVE"] == "1", e)

print("\n3. complete is cross-checked against the counts, never trusted")
# THE CASE THAT MATTERS. A status file claiming complete on counts that
# disagree is either a bug in week_status or a stale file, and either way
# the consequence of believing it is a scored live week and fifty push
# notifications. The counts win.
ok("a lying complete flag is refused",
   env_of(dict(GOOD, final=9, games=16, complete=True))["ST_COMPLETE"] == "0")
ok("a week with no games is never complete",
   env_of(dict(GOOD, games=0, final=0, complete=True))["ST_COMPLETE"] == "0")
ok("missing counts are not enough to close a week",
   env_of({"week": 4, "complete": True})["ST_COMPLETE"] == "0")
ok("and neither is a complete flag with no week",
   env_of(dict(GOOD, week=None))["ST_COMPLETE"] == "0")
# The honest positive still has to work, or the feature does nothing.
ok("but the honest case still closes",
   env_of(dict(GOOD, games=13, final=13))["ST_COMPLETE"] == "1")

print("\n4. No information produces no new behaviour")
# Each of these must give back the defaults: no week to close, not
# complete, and ST_LIVE=1 so the window runs its full length.
CASES = [
    ("a file that does not exist", None, None),
    ("an empty file", None, ""),
    ("a half-written file", None, '{"week": 4, "comp'),
    ("a JSON array", None, "[1,2,3]"),
    ("a JSON string", None, '"nope"'),
    ("null", None, "null"),
    ("an empty object", {}, None),
    ("junk that is not JSON at all", None, "week=4 complete=yes"),
]
for label, payload, raw in CASES:
    if label == "a file that does not exist":
        e = se.env("/tmp/definitely-not-here-" + str(os.getpid()) + ".json")
    else:
        e = env_of(payload, raw)
    ok(label + " -> the defaults", e == se.DEFAULTS, e)

print("\n5. Wrong types never become numbers")
ok("a string week is not a week",
   env_of(dict(GOOD, week="4"))["ST_WEEK"] == "", "string week accepted")
# isinstance(True, int) is True in Python, which is exactly how a
# boolean becomes week 1.
ok("a boolean week is not week 1",
   env_of(dict(GOOD, week=True))["ST_WEEK"] == "", "bool week accepted")
ok("a boolean live count does not become 1 live game",
   env_of(dict(GOOD, live=True))["ST_LIVE"] == "1", "bool live accepted")
ok("a float next-kickoff is ignored rather than truncated",
   env_of(dict(GOOD, next_kick_ms=1.789e12))["ST_NEXT"] == "")
ok("a negative week is refused", env_of(dict(GOOD, week=-4))["ST_WEEK"] == "")
ok("a zero week is refused", env_of(dict(GOOD, week=0))["ST_WEEK"] == "")

print("\n6. The output is safe to eval in a shell")
# The loop does `eval "$(python scripts/status_env.py ...)"`. Values are
# digits or empty by construction, and they are quoted on the way out,
# but assert the shape rather than assuming it: this is the one place
# where a surprise becomes arbitrary shell in a job holding the Firebase
# admin key.
fd, path = tempfile.mkstemp(suffix=".json")
with os.fdopen(fd, "w") as f:
    json.dump(dict(GOOD, season="2026; rm -rf /"), f)
out = subprocess.run([sys.executable, SE, path], capture_output=True, text=True)
os.unlink(path)
lines = [l for l in out.stdout.strip().split("\n") if l]
ok("exactly four assignments", len(lines) == 4, out.stdout)
ok("every line is NAME=\"digits or empty\"",
   all(__import__("re").fullmatch(r'ST_[A-Z_]+="\d*"', l) for l in lines),
   out.stdout)
ok("nothing from an unused field reaches the output",
   "rm -rf" not in out.stdout, out.stdout)
ok("and it exits 0", out.returncode == 0, out.returncode)

print("\n7. It exits 0 even with no argument at all")
out = subprocess.run([sys.executable, SE], capture_output=True, text=True)
ok("no argument is not an error", out.returncode == 0, out.stderr[:200])
ok("and it still prints the defaults",
   'ST_COMPLETE="0"' in out.stdout and 'ST_LIVE="1"' in out.stdout, out.stdout)

print("\n%d passed, %d failed" % (P, F))
sys.exit(1 if F else 0)
