#!/usr/bin/env python3
"""
scripts/usage_report.py, graded on the arithmetic rather than the print.

WHY THIS FILE. The report is the only place these numbers are ever added
up, and a wrong average here does not look wrong: it looks like a fact
about how the pool uses the app, and it would be believed. Every check
below is a way to get an aggregate quietly wrong.

WHAT IT GRADES:
  a session with no on-screen time counts as a VISIT but not as a
    DURATION, or every average is dragged toward zero by launches that
    were backgrounded before anything could accrue
  a tab never opened in a session is not a zero in that tab's averages,
    or "average time on Help" becomes a measure of how rarely Help is
    opened rather than how long it is read
  shortest and longest are over the sessions that USED the tab
  the Home Screen and browser split adds up to the session count
  a tab name the script has never heard of is reported, not dropped
  days are counted in UTC, from `started`, whatever type it arrives as

THE SHAPE OF THE DATA IS THE POINT. These rows carry no uid by design
and the security rule allows only six keys, so there is nothing here to
tie a row to a person and nothing for this file to accidentally reveal.

Run: python test_usage_report.py
"""

import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import usage_report as U                                  # noqa: E402

PASS = FAIL = 0


def ok(name, cond, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  ok   " + name)
    else:
        FAIL += 1
        print("  FAIL " + name + ("  -> " + str(extra) if extra else ""))


def row(mode="browser", visible=0, tabs=None, started=None, wk=4):
    return {"mode": mode, "visibleMs": visible, "tabs": tabs or {},
            "started": started if started is not None
            else datetime(2026, 9, 27, 18, 0, tzinfo=timezone.utc),
            "wk": wk}


M = 60000        # one minute, for readability below


# ------------------------------------------------------------------
print("\n1. Sessions, and how the app was opened")
s = U.summarise([
    row(mode="standalone", visible=5*M, tabs={"picks": 5*M}),
    row(mode="standalone", visible=2*M, tabs={"grid": 2*M}),
    row(mode="browser",    visible=1*M, tabs={"picks": 1*M}),
])
ok("every session is counted", s["sessions"] == 3, s["sessions"])
ok("the Home Screen opens", s["standalone"] == 2, s["standalone"])
ok("the browser opens", s["browser"] == 1, s["browser"])
# THE TWO MUST ADD UP, or one mode is silently vanishing.
ok("and the two add up to the total",
   s["standalone"] + s["browser"] == s["sessions"])


print("\n2. A launch that was backgrounded instantly is a visit, not a duration")
# THE DEFECT THIS EXISTS FOR. Somebody opens the app, is interrupted, and
# it goes to the background before a second accrues. That IS a visit and
# must be counted as one. It is NOT a session of length zero: averaging
# it in would make "average time on the app" a measure of how often
# people get interrupted.
s = U.summarise([
    row(visible=10*M, tabs={"picks": 10*M}),
    row(visible=0,    tabs={}),
])
ok("both are counted as visits", s["sessions"] == 2, s["sessions"])
ok("only the real one is in the durations",
   s["session_ms"] == [10*M], s["session_ms"])
ok("so the average is the real session, not half of it",
   sum(s["session_ms"])/len(s["session_ms"]) == 10*M)
ok("and total on-screen time is unaffected",
   s["total_visible"] == 10*M, s["total_visible"])


print("\n3. A tab nobody opened is absent, not a zero")
# THE SAME TRAP, PER TAB, and this one would be the most misleading
# number in the report. If Help is opened once for four minutes and
# ignored in nine other sessions, "average time on Help" is FOUR MINUTES.
# Counting the nine as zeros gives 24 seconds, which describes how often
# Help is opened, not how long it is read. The report has a separate
# column for how many sessions touched it.
rows = [row(visible=1*M, tabs={"picks": 1*M}) for _ in range(9)]
rows.append(row(visible=4*M, tabs={"help": 4*M}))
s = U.summarise(rows)
ok("help was used in exactly one session", len(s["tabs"]["help"]) == 1,
   s["tabs"]["help"])
ok("its average is the time it was actually read",
   sum(s["tabs"]["help"])/len(s["tabs"]["help"]) == 4*M)
ok("picks was used in nine", len(s["tabs"]["picks"]) == 9)
ok("and a tab in nobody's session has nothing at all",
   s["tabs"]["settings"] == [], s["tabs"]["settings"])
# An explicit zero in the data means the same as absent: never opened.
s2 = U.summarise([row(visible=1*M, tabs={"picks": 1*M, "help": 0})])
ok("an explicit zero counts as not opened either",
   s2["tabs"]["help"] == [], s2["tabs"]["help"])


print("\n4. Shortest and longest are over the sessions that used the tab")
s = U.summarise([
    row(visible=3*M,  tabs={"picks": 3*M}),
    row(visible=90*M, tabs={"picks": 90*M}),
    row(visible=12*M, tabs={"picks": 12*M}),
    row(visible=1*M,  tabs={"grid": 1*M}),
])
p = s["tabs"]["picks"]
ok("three sessions used picks", len(p) == 3, p)
ok("shortest", min(p) == 3*M, min(p))
ok("longest", max(p) == 90*M, max(p))
ok("average", sum(p)/len(p) == 35*M, sum(p)/len(p))
# THE GRID SESSION MUST NOT TOUCH THE PICKS FIGURES.
ok("a session that never opened picks is not its shortest",
   min(p) != 1*M, min(p))


print("\n5. The long Sunday, which is the question this was built for")
# Lee's actual interest: how long players sit on Picks while games run.
sunday = [row(mode="standalone", visible=v, tabs={"picks": int(v*0.85),
                                                  "grid": int(v*0.15)})
          for v in (170*M, 95*M, 20*M, 6*M)]
s = U.summarise(sunday)
picks = s["tabs"]["picks"]
ok("every session showed up", len(picks) == 4, len(picks))
ok("the longest is nearly three hours", max(picks) > 140*M, ms := max(picks))
ok("picks dominates the share",
   sum(picks) > sum(s["tabs"]["grid"]) * 4, [sum(picks), sum(s["tabs"]["grid"])])
ok("and the total matches what the sessions carried",
   s["total_visible"] == sum(v for v in (170*M, 95*M, 20*M, 6*M)))


print("\n6. Days are counted in UTC, from `started`, whatever type it is")
# The client sends a Firestore timestamp; a CSV round trip or an older
# row could hand back epoch millis. Both must land on the same day.
s = U.summarise([
    row(visible=M, tabs={"picks": M},
        started=datetime(2026, 9, 27, 23, 30, tzinfo=timezone.utc)),
    row(visible=M, tabs={"picks": M},
        started=datetime(2026, 9, 28, 0, 30, tzinfo=timezone.utc)),
    row(visible=M, tabs={"picks": M},
        started=datetime(2026, 9, 28, 11, 0, tzinfo=timezone.utc)),
])
ok("two days, split at midnight UTC",
   s["by_day"] == {"2026-09-27": 1, "2026-09-28": 2}, s["by_day"])

class FakeTs:
    """What the Firestore SDK hands back: an object with .timestamp()."""
    def __init__(self, dt): self._dt = dt
    def timestamp(self): return self._dt.timestamp()

s = U.summarise([
    row(visible=M, tabs={"picks": M},
        started=FakeTs(datetime(2026, 9, 28, 11, 0, tzinfo=timezone.utc))),
    row(visible=M, tabs={"picks": M},
        started=datetime(2026, 9, 28, 12, 0, tzinfo=timezone.utc).timestamp()*1000),
])
ok("a timestamp object and epoch millis land on the same day",
   s["by_day"] == {"2026-09-28": 2}, s["by_day"])
ok("a row with no start time is still counted as a session",
   U.summarise([row(visible=M, started=None)])["sessions"] == 1)


print("\n7. An unknown tab is reported, never dropped")
# If a sixth tab is ever added and this script is not updated, the report
# must SAY so rather than quietly leave its time out and present a share
# breakdown that does not add up.
s = U.summarise([row(visible=5*M, tabs={"picks": 3*M, "archive": 2*M})])
ok("the known tab is where it belongs", s["tabs"]["picks"] == [3*M])
ok("and the unknown one is surfaced separately",
   s["other_tabs"] == {"archive": [2*M]}, s["other_tabs"])


print("\n8. Nothing in a row can identify anybody")
# NOT A STYLE CHECK. The whole promise made to the pool is that these
# rows are anonymous, and the way that promise breaks is somebody adding
# a field and nothing objecting. firestore.rules refuses any key outside
# the six; this asserts the reporting side agrees, so a row carrying a
# uid could not be summarised into a per-person anything even if one
# somehow existed.
s = U.summarise([row(visible=M, tabs={"picks": M})])
ok("the summary exposes no identity key at all",
   not any(k in s for k in ("uid", "uids", "name", "names", "email", "by_uid")),
   sorted(s.keys()))
# And a row that somehow arrived with a uid contributes its timings and
# nothing else: there is no path from summarise() to a per-person total.
bad = row(visible=M, tabs={"picks": M})
bad["uid"] = "u_should_never_be_here"
s = U.summarise([bad])
ok("a stray uid is ignored rather than aggregated",
   s["sessions"] == 1 and not any("u_" in str(v) for v in s.values()),
   sorted(s.keys()))


print("\n9. An empty window says so instead of dividing by zero")
s = U.summarise([])
ok("no sessions", s["sessions"] == 0)
ok("no durations to average", s["session_ms"] == [])
ok("every tab is empty", all(s["tabs"][t] == [] for t in U.TABS))
ok("and rendering it does not raise", U.report(s, "empty") is None)


print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
