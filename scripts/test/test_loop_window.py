#!/usr/bin/env python3
"""The Live-scores window's own shell logic, run for real.

WHAT THIS GRADES. scores-loop.yml's `run:` block is extracted from the
YAML and executed by bash with a stubbed `python` and a stubbed `sleep`,
so the two decisions added to the window are tested as the shell actually
runs them rather than by reading them:

  1. THE WEEK CLOSER. When the status file says every game in the week is
     final, run the full scorer once. Monday Night Football goes final
     around 23:30 ET and the next scheduled run is the Tuesday cron, so
     the pool had about four hours of a finished week with no winner, no
     seals and no result notification. "Once" is the part with teeth:
     score_week.py sends a results push to every phone in the pool, so a
     closer that fires on every pull for five hours is fifty people's
     phones buzzing seventy times.
  2. THE EARLY EXIT. Stop when nothing is live AND no kickoff lands
     before the window closes. Both halves are required: the Thursday
     window opens at 23:00 UTC for a 00:15 kickoff, so for 75 minutes
     nothing is live — and a window that exited on that would mean
     nothing at all covered Thursday night football.

WHY THE STUBS ARE SHAPED THIS WAY. `sleep` is a no-op so a 350-minute
window runs in milliseconds, which means the loop can only ever end by
one of its own exit conditions — exactly what is being tested. `python`
is a shim that serves a SCRIPT of status files, one per pull, and records
every command line it was given; the real status_env.py is still used, so
the parsing under test is the parsing that ships.

Nothing here touches Firebase, ESPN or the network.

Run: python scripts/test/test_loop_window.py
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
WF = os.path.join(REPO, ".github", "workflows", "scores-loop.yml")

P = F = 0


def ok(name, cond, extra=""):
    global P, F
    if cond:
        P += 1
        print("  ok   " + name)
    else:
        F += 1
        print("  FAIL " + name + (("  -> " + str(extra)) if extra else ""))


def loop_script():
    """The `run:` body of the step that owns the loop.

    Found by the step name rather than by index so reordering the steps
    does not silently test the wrong one — and asserted to be the right
    step, because a fixture that quietly matches nothing is how a suite
    goes green against no code at all."""
    d = yaml.safe_load(open(WF))
    for s in d["jobs"]["loop"]["steps"]:
        if "Pull scores" in str(s.get("name", "")):
            return s["run"]
    raise SystemExit("could not find the pull step in " + WF)


SCRIPT = loop_script()

# A shim standing in for `python`. It has to answer three call shapes:
#   scripts/status_env.py FILE          -> delegate to the real one
#   ... score_week.py ... --scores-only -> serve the next scripted status
#   ... score_week.py --season S --week W (no --scores-only) -> the closer
SHIM = r'''#!/usr/bin/env python3
import json, os, subprocess, sys

ARGS = sys.argv[1:]
BOX  = os.environ["LOOPTEST_BOX"]
REAL = os.environ["LOOPTEST_REAL_PY"]

def note(line):
    with open(os.path.join(BOX, "calls.log"), "a") as f:
        f.write(line + "\n")

# The real status_env.py, so the code under test is the shipped parser.
if any(a.endswith("status_env.py") for a in ARGS):
    os.execv(REAL, [REAL] + [os.path.join(os.environ["LOOPTEST_REPO"], a)
                             if a.endswith("status_env.py") else a for a in ARGS])

if any(a.endswith("score_week.py") for a in ARGS):
    if "--scores-only" in ARGS:
        note("pull " + " ".join(ARGS))
        # Serve the scripted status for this pull, then hold the last one.
        plan = json.load(open(os.path.join(BOX, "plan.json")))
        seq = plan["statuses"]
        i = 0
        cnt = os.path.join(BOX, "pulls")
        if os.path.exists(cnt):
            i = int(open(cnt).read().strip() or "0")
        with open(cnt, "w") as f:
            f.write(str(i + 1))
        st = seq[min(i, len(seq) - 1)]
        out = None
        for j, a in enumerate(ARGS):
            if a == "--status-file" and j + 1 < len(ARGS):
                out = ARGS[j + 1]
        if out and st is not None:
            with open(out, "w") as f:
                if isinstance(st, str):
                    f.write(st)
                else:
                    json.dump(st, f)
        sys.exit(1 if plan.get("pull_fails") else 0)
    note("close " + " ".join(ARGS))
    plan = json.load(open(os.path.join(BOX, "plan.json")))
    sys.exit(1 if plan.get("close_fails") else 0)

note("other " + " ".join(ARGS))
sys.exit(0)
'''

SLEEP = "#!/bin/sh\nexit 0\n"


def run(statuses, minutes=350, every=60, no_close=None, no_early_exit=None,
        week=None, pull_fails=False, close_fails=False, timeout=60):
    """Run the real loop with a scripted sequence of status files."""
    box = tempfile.mkdtemp(prefix="loopwin-")
    bin_ = os.path.join(box, "bin")
    os.makedirs(bin_)
    for name, body in (("python", SHIM), ("sleep", SLEEP)):
        p = os.path.join(bin_, name)
        with open(p, "w") as f:
            f.write(body)
        os.chmod(p, 0o755)
    with open(os.path.join(box, "plan.json"), "w") as f:
        json.dump({"statuses": statuses, "pull_fails": pull_fails,
                   "close_fails": close_fails}, f)

    env = dict(os.environ)
    env.update({
        "PATH": bin_ + os.pathsep + env["PATH"],
        "LOOPTEST_BOX": box,
        "LOOPTEST_REPO": REPO,
        "LOOPTEST_REAL_PY": sys.executable,
        "FIREBASE_SERVICE_ACCOUNT_FILE": "/dev/null",
        "SEASON": "2026",
        "IN_WEEK": str(week or ""),
        "IN_MINUTES": str(minutes),
        "IN_EVERY": str(every),
        "IN_NO_CLOSE": str(no_close or ""),
        "IN_NO_EARLY_EXIT": str(no_early_exit or ""),
    })
    try:
        r = subprocess.run(["bash", "-c", SCRIPT], cwd=REPO, env=env,
                           capture_output=True, text=True, timeout=timeout)
        log = os.path.join(box, "calls.log")
        calls = open(log).read().strip().split("\n") if os.path.exists(log) else []
        return {"rc": r.returncode, "out": r.stdout + r.stderr,
                "calls": [c for c in calls if c],
                "pulls": len([c for c in calls if c.startswith("pull ")]),
                "closes": [c for c in calls if c.startswith("close ")]}
    finally:
        shutil.rmtree(box, ignore_errors=True)


def st(week=4, games=16, final=16, live=0, complete=True, next_in_s=None):
    """A status file as week_status() would write it.

    next_in_s is seconds from now, or None for "no kickoff left in the
    season" — expressed relative to now because the loop compares it with
    its own END, which is also relative to now."""
    import time
    now = int(time.time() * 1000)
    return {"season": "2026", "week": week, "games": games, "final": final,
            "live": live, "complete": complete, "now_ms": now,
            "next_kick_ms": None if next_in_s is None else now + next_in_s * 1000}


FAR = None          # nothing left in the season
SOON = 30 * 60      # a kickoff half an hour out, inside every window here

print("\n1. A finished week is scored immediately, and the window stops")
r = run([st(week=4, final=16, live=0, complete=True, next_in_s=FAR)])
ok("the week was closed", len(r["closes"]) == 1, r["calls"])
ok("with the week the status named, not the auto-detected one",
   "--week 4" in (r["closes"][0] if r["closes"] else ""), r["closes"])
ok("and NOT with --scores-only",
   r["closes"] and "--scores-only" not in r["closes"][0], r["closes"])
ok("it said so in the log", "Week 4 scored" in r["out"], r["out"][-400:])
ok("then stopped instead of running for five more hours",
   "Nothing live and no kickoff" in r["out"], r["out"][-400:])
ok("one pull was enough", r["pulls"] == 1, r["pulls"])
ok("and the run is green", r["rc"] == 0, r["out"][-400:])

print("\n2. The closer fires ONCE, however many pulls see a finished week")
# Every phone in the pool gets a results push from score_week.py, so a
# closer that re-fires is fifty people's phones buzzing on a loop. Three
# pulls report the same finished week with a kickoff still to come (so
# the early exit holds off), and the fourth has nothing left.
r = run([st(next_in_s=SOON), st(next_in_s=SOON), st(next_in_s=SOON), st(next_in_s=FAR)])
ok("four pulls happened", r["pulls"] == 4, r["pulls"])
ok("and exactly one of them closed the week",
   len(r["closes"]) == 1, r["closes"])
ok("the window then exited on the last one",
   "Nothing live and no kickoff" in r["out"], r["out"][-300:])

print("\n3. Nothing live is NOT enough to stop — a kickoff may be coming")
# This is Thursday night: the window opens at 23:00 UTC for a 00:15
# kickoff. Exiting on "nothing live" would leave TNF uncovered entirely.
r = run([st(week=5, games=16, final=0, live=0, complete=False, next_in_s=SOON),
         st(week=5, games=16, final=0, live=0, complete=False, next_in_s=SOON),
         st(week=5, games=16, final=1, live=2, complete=False, next_in_s=SOON),
         st(week=5, games=16, final=16, live=0, complete=True, next_in_s=FAR)])
ok("it kept pulling through the quiet hour before kickoff",
   r["pulls"] == 4, r["pulls"])
ok("nothing was closed while the week was unfinished",
   len(r["closes"]) == 1, r["closes"])
ok("and the one close is the finished week at the end",
   r["closes"] and "--week 5" in r["closes"][0], r["closes"])

print("\n4. An unfinished week is never closed")
r = run([st(week=6, games=16, final=15, live=1, complete=False, next_in_s=SOON),
         st(week=6, games=16, final=15, live=0, complete=False, next_in_s=FAR)])
ok("no close at all", r["closes"] == [], r["closes"])
ok("and the window still exits when nothing can happen",
   "Nothing live and no kickoff" in r["out"], r["out"][-300:])

print("\n5. A status file that says nothing changes nothing")
# Missing, empty, half-written, or JSON that is not an object: the window
# has to behave exactly as it did before any of this existed — keep
# pulling, close nothing — because that behaviour works and the Tuesday
# cron is still there. `minutes=1` gives it a natural end.
for label, seq in [
    ("no status file written", [None]),
    ("an empty file", [""]),
    ("a half-written file", ['{"week": 4, "compl']),
    ("a JSON array", ["[1,2,3]"]),
    ("junk", ["week=4 complete=yes"]),
]:
    r = run(seq, minutes=1)
    ok(label + ": nothing is closed", r["closes"] == [], r["closes"])
    ok(label + ": and it does not exit early",
       "Nothing live and no kickoff" not in r["out"], r["out"][-200:])
    ok(label + ": the run is green", r["rc"] == 0, r["out"][-200:])

print("\n6. A status file lying about being complete is refused")
# complete:true with counts that disagree. Believing it scores a live
# week and notifies the pool about it.
r = run([{"season": "2026", "week": 4, "games": 16, "final": 9, "live": 7,
          "complete": True, "next_kick_ms": None, "now_ms": 0}], minutes=1)
ok("the week is not closed", r["closes"] == [], r["closes"])
ok("and the run is green", r["rc"] == 0, r["out"][-300:])

print("\n7. A failing closer does not fail the window, and does not retry")
r = run([st(next_in_s=SOON), st(next_in_s=SOON), st(next_in_s=FAR)],
        close_fails=True)
ok("it tried once", len(r["closes"]) == 1, r["closes"])
ok("and did not keep retrying", len(r["closes"]) == 1, r["closes"])
ok("it warned rather than failing", "the Tuesday run will do it" in r["out"],
   r["out"][-400:])
ok("the window is still green", r["rc"] == 0, r["out"][-300:])
ok("and it still pulled the rest of its window", r["pulls"] == 3, r["pulls"])

print("\n8. Every pull failing is still a red run")
# Unchanged behaviour, asserted here because the new code sits between
# the pull and this check and could have swallowed it.
r = run([None], minutes=1, pull_fails=True)
ok("red", r["rc"] != 0, r["rc"])
ok("and says why", "every pull in this window failed" in r["out"],
   r["out"][-300:])

print("\n9. Both new behaviours can be switched off from the Actions page")
r = run([st(next_in_s=FAR)], minutes=1, no_close="1")
ok("no_close=1 closes nothing", r["closes"] == [], r["closes"])
r = run([st(next_in_s=FAR)], minutes=1, no_early_exit="1")
ok("no_early_exit=1 runs the window out",
   "Nothing live and no kickoff" not in r["out"], r["out"][-300:])
ok("and still closes the week", len(r["closes"]) == 1, r["closes"])
# Anything other than exactly "1" leaves them on, so a stray value
# cannot quietly disable the feature.
r = run([st(next_in_s=FAR)], minutes=1, no_close="true", no_early_exit="yes")
ok("a value other than 1 does not disable the closer",
   len(r["closes"]) == 1, r["closes"])
ok("or the early exit", "Nothing live and no kickoff" in r["out"],
   r["out"][-300:])

print("\n10. The step still validates and clamps its inputs")
r = run([st(next_in_s=FAR)], minutes="0; echo pwned", every="-5")
ok("a shell injection in minutes is not executed",
   "pwned" not in r["out"], r["out"][-300:])
# Not digits-only, so it is not clamped — it is DISCARDED and the
# default applies. That distinction is the whole point of the `case`:
# clamping "0; echo pwned" would mean parsing it.
ok("and a non-numeric window falls back to the default 350",
   "Window: 350 min" in r["out"], r["out"][:200])
ok("as does a non-numeric interval",
   "a pull every 300s" in r["out"], r["out"][:200])
# A numeric value out of range IS clamped, which is the other branch.
r = run([st(next_in_s=FAR)], minutes=9999, every=5)
ok("a numeric window over the ceiling is clamped to 350",
   "Window: 350 min" in r["out"], r["out"][:200])
ok("and a numeric interval under the floor is clamped to 60s",
   "a pull every 60s" in r["out"], r["out"][:200])

print("\n%d passed, %d failed" % (P, F))
sys.exit(1 if F else 0)
