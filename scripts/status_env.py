#!/usr/bin/env python3
"""Turn score_week.py's --status-file into shell variable assignments.

    eval "$(python scripts/status_env.py /tmp/week-status.json)"
    -> ST_WEEK=4 ST_COMPLETE=1 ST_LIVE=0 ST_NEXT=1789000000

WHY THIS IS A FILE AND NOT FOUR LINES OF SHELL IN THE WORKFLOW.

It started as a python heredoc inside scores-loop.yml's `run:` block,
which does not work and fails in a way worth writing down: a `run:` body
is a YAML block scalar, so every line has to keep the block's
indentation — but a `<<'PY'` heredoc terminator has to sit at column
zero, and `<<-` strips tabs, not spaces. The file parsed as YAML right up
until the heredoc, then reported a missing ':' ninety lines from the real
problem. Any future "just inline it" runs into the same wall.

It is also the part of this arrangement that most deserves a test. The
loop's two behaviours — close a finished week, stop a window with nothing
left to watch — are both decided by what this prints, and the failure
mode that matters is not a crash. It is printing ST_COMPLETE=1 for a
week that is not complete, which would score a live week and notify
fifty people about it.

THE DEFAULTS ARE THE SAFETY, and they are chosen so that no information
produces no new behaviour:

    ST_WEEK      empty   -> there is no week to close
    ST_COMPLETE  0       -> nothing is closed
    ST_LIVE      1       -> something is live, so the window does not exit
    ST_NEXT      empty   -> unknown next kickoff

A missing file, an empty file, half a file, a file holding a JSON array,
a null week, a string where a number belongs: every one of those prints
the defaults and exits 0. The loop carries on exactly as it did before
any of this existed, which is a working window and a Tuesday cron.

`complete` is believed only when the counts agree with it. The scorer and
this file could otherwise disagree about the one field that scores a
week, and a week is closed on this output, not on the boolean's word.
"""
import json
import sys

DEFAULTS = {"ST_WEEK": "", "ST_COMPLETE": "0", "ST_LIVE": "1", "ST_NEXT": ""}


def _int(v):
    """An int, or None. Deliberately refuses bools and numeric strings.

    `isinstance(True, int)` is True in Python, so a status file carrying
    "week": true would otherwise print ST_WEEK=1 and close week 1."""
    if isinstance(v, bool) or not isinstance(v, int):
        return None
    return v


def env(path):
    out = dict(DEFAULTS)
    try:
        with open(path) as f:
            d = json.load(f)
    except Exception:
        return out
    if not isinstance(d, dict):
        return out

    week = _int(d.get("week"))
    games = _int(d.get("games"))
    final = _int(d.get("final"))
    live = _int(d.get("live"))
    nxt = _int(d.get("next_kick_ms"))

    if week is not None and week > 0:
        out["ST_WEEK"] = str(week)

    # CROSS-CHECKED, NOT TRUSTED. `complete` has to mean what
    # score_week.py's weekly awards mean by it — games > 0 and every one
    # of them final — and a week is scored off the back of this line, so
    # it is recomputed here from the counts rather than taken on trust.
    # If the counts are missing there is nothing to check it against and
    # the answer is no.
    counted = (games is not None and final is not None
               and games > 0 and final == games)
    if bool(d.get("complete")) and counted and out["ST_WEEK"]:
        out["ST_COMPLETE"] = "1"

    # Only a real zero turns the early exit on. Absent stays 1, which
    # keeps the window running for its full length.
    if live is not None and live >= 0:
        out["ST_LIVE"] = str(live)

    # Seconds, because the loop compares it with `date +%s`.
    if nxt is not None and nxt > 0:
        out["ST_NEXT"] = str(nxt // 1000)

    return out


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else ""
    for k, v in env(path).items():
        # Values are digits or empty by construction above, so there is
        # nothing here to quote-escape — but print them quoted anyway,
        # because this output is eval'd by a shell and "it cannot contain
        # a space" is the kind of assumption that stops being true.
        print('%s="%s"' % (k, v))
    return 0


if __name__ == "__main__":
    sys.exit(main())
