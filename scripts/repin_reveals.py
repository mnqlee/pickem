"""Keep every pick sealed until ITS GAME'S kickoff, when a kickoff moves.

WHY (security review, Nov 12 2026)
A pick is readable by the rest of its league once `revealAt <= now`
(firestore.rules), and the rules pin `revealAt` to the game's kickoff AT
THE MOMENT THE PICK IS SAVED. When the league then moves that game LATER
(flex scheduling, a postponement) and the schedule is re-imported, every
pick already saved for it still carries the OLD, earlier time. From that
old time until the real kickoff those picks could be read by the league,
and would show on the Grid, while everyone could still change their own.
This puts the time back where it belongs, in every league.

A game moved EARLIER needs no help with secrecy (its picks only stay
sealed a little longer than they need to) but is fixed the same way so
the Grid opens on time.

    python scripts/repin_reveals.py --season 2026            look, change nothing
    python scripts/repin_reveals.py --season 2026 --fix      put them right

scripts/import_schedule.py calls repin() itself after every import, for
the games whose kickoff it just changed. Running this by hand is only for
checking, or after a kickoff was changed some other way.

Tiebreak guesses carry the same field and get the same treatment.
A game that has ALREADY kicked off is left alone: its picks are meant to
be showing.
"""
import argparse
import os
import sys
from datetime import datetime, timezone


def _utc(v):
    if not isinstance(v, datetime):
        return None
    return v if v.tzinfo else v.replace(tzinfo=timezone.utc)


def repin(db, season_id, only=None, now=None, fix=True, log=print):
    """Returns one row per pick or tiebreak that was (or would be) changed:
    {pool, kind, id, game, was, now, exposed}. `exposed` is True when the
    old time had already passed, i.e. the league could have seen it.

    only: a set of game ids to look at (what an import just moved). None
          looks at every game of the season that has not kicked off."""
    now = now or datetime.now(timezone.utc)
    season_id = str(season_id)
    games = {}
    for d in db.collection("seasons").document(season_id).collection("games").stream():
        g = d.to_dict() or {}
        k = _utc(g.get("kickoff"))
        if k is None or (only is not None and d.id not in only):
            continue
        if k <= now:
            continue          # kicked off: showing is correct
        games[d.id] = (k, g.get("wk"))
    if not games:
        return []

    out = []
    for pool in db.collection("pools").where("season", "==", season_id).stream():
        pref = db.collection("pools").document(pool.id)
        strip = {}            # wk -> game ids to take out of the weekly reveal document
        for kind in ("picks", "tiebreaks"):
            for gid, (kick, wk) in games.items():
                for d in pref.collection(kind).where("gameId", "==", gid).stream():
                    was = _utc((d.to_dict() or {}).get("revealAt"))
                    if was == kick:
                        continue
                    exposed = was is not None and was <= now
                    out.append({"pool": pool.id, "kind": kind, "id": d.id, "game": gid,
                                "was": was, "now": kick, "exposed": exposed})
                    if fix:
                        d.reference.set({"revealAt": kick}, merge=True)
                    if exposed and kind == "picks" and wk is not None:
                        strip.setdefault(wk, set()).add(gid)
        # A pick the league could already see may have been copied into the
        # week's one-document reveal (scripts/reveal_doc.py). Take it back
        # out; it is copied in again when the game really kicks off.
        for wk, gids in strip.items():
            rref = pref.collection("reveals").document(str(wk))
            rd = rref.get().to_dict()
            if not rd or not isinstance(rd.get("picks"), dict):
                continue
            picks, took = rd["picks"], 0
            for uid in list(picks.keys()):
                row = picks.get(uid)
                if not isinstance(row, dict):
                    continue
                for gid in gids:
                    if gid in row:
                        del row[gid]
                        took += 1
                if not row:
                    del picks[uid]
            if took and fix:
                # Replace, not merge: a merge cannot remove a key from a map.
                rd["picks"] = picks
                rd["count"] = sum(len(v) for v in picks.values() if isinstance(v, dict))
                rref.set(rd)
                log(f"  pool {pool.id}: took {took} pick(s) back out of reveals/{wk}")
    return out


def report(rows, fix, log=print):
    if not rows:
        log("Every saved pick is sealed until its own game's kickoff. Nothing to do.")
        return
    seen = sum(1 for r in rows if r["exposed"])
    by_game = {}
    for r in rows:
        by_game.setdefault(r["game"], []).append(r)
    for gid, rs in sorted(by_game.items()):
        log(f"  {gid}: {len(rs)} saved pick(s) or guess(es) carried the old time "
            f"({rs[0]['was']}), now {rs[0]['now']}" + ("" if fix else "  [not changed]"))
    if seen:
        log(f"  !! {seen} of them could ALREADY be seen by their league before the fix. "
            f"They are sealed again now." if fix else
            f"  !! {seen} of them can be seen by their league RIGHT NOW. Run again with --fix.")
    if not fix:
        log("Nothing was changed. Run again with --fix to put them right.")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--season", type=int, required=True)
    ap.add_argument("--fix", action="store_true", help="change them (default: only look)")
    args = ap.parse_args()
    import firebase_admin
    from firebase_admin import credentials, firestore
    key = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS") or "serviceAccount.json"
    firebase_admin.initialize_app(credentials.Certificate(key))
    db = firestore.client()
    rows = repin(db, args.season, fix=args.fix)
    report(rows, args.fix)
    return 0


if __name__ == "__main__":
    sys.exit(main())
