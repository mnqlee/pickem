#!/usr/bin/env python3
"""
Build the read-optimised snapshots this job WAS meant to have the app
serve from. It does not, currently — read this before relying on it.

STATUS: not wired to the live app. This was written so clients would
never query raw picks directly; instead they'd read the handful of
documents below. That migration never happened on the client — index.html
calls getRevealed()/watchRevealed(), which query the picks collection
directly, and nothing in the app calls the getBoard()/watchBoard()/
getShard() functions in firebase-init.js that read these snapshot docs.
The Grid was instead fixed by widening the picks read rule in
firestore.rules (see the comment there). worker/live.js writes score
updates straight to the game documents and says so explicitly ("No
snapshot job in between") — it does not call this either. The
.github/workflows/live.yml schedule that used to run this every 5
minutes is disabled for the same reason (see that file's header); it is
left as a manual workflow_dispatch fallback only.

So right now this script computes real, correct output that nothing
reads. Either wire the client to it (swap getRevealed()/watchRevealed()
for getBoard()/watchBoard()/getShard()) or stop running it — as-is it is
pure wasted Firestore writes every time it's invoked.

    python scripts/build_snapshot.py --season 2026

WHAT IT WRITES (if you decide to use it)
  pools/{p}/private/agg_w{n}      every pick, admin only, the working set
  pools/{p}/private/progress_w{n} who is missing what. scripts/remind.py
                                   (the Python fallback, workflow_dispatch
                                   only) reads this — but worker/live.js,
                                   the reminder path that actually runs on
                                   a schedule, computes "missing" itself
                                   straight from picks and never reads it.
  pools/{p}/snapshots/w{n}_board  standings + the top rows — currently unread
  pools/{p}/snapshots/w{n}_s{k}   full pick rows, 100/shard — currently unread
"""

import argparse, os, sys
from collections import defaultdict
from datetime import datetime, timezone

import firebase_admin
from firebase_admin import credentials, firestore

RANK_ONE_IS_BEST = True
SHARD = 100          # players per shard doc
TOP_ROWS = 25        # full pick rows carried inside the board doc


def pay(rank, n):
    """`n` is that week's game count. Bye weeks are not sixteen games.

    Floored at zero, exactly as in score_week.py: a rank made against a
    16-game slate that is later scored as 14 games would otherwise pay
    minus one for a CORRECT pick. Keep the two in step."""
    if not rank:
        return 1
    return max(0, (n + 1 - rank)) if RANK_ONE_IS_BEST else max(0, rank)


def get_db():
    key = os.environ.get("FIREBASE_SERVICE_ACCOUNT_FILE", "serviceAccount.json")
    if not firebase_admin._apps:
        firebase_admin.initialize_app(credentials.Certificate(key))
    return firestore.client()


def scoring_mode(pool, week):
    # "confidence", to match score_week.py and firebase-init.js. This
    # said "straight" and was a third opinion on the same question.
    mode = "confidence"
    for h in sorted(pool.get("scoringHistory") or [], key=lambda x: x["week"]):
        if h["week"] <= week:
            mode = h["mode"]
    return mode


def build_week(db, season, pool_ref, pool, week, now):
    pid = pool_ref.id
    games = {d.id: d.to_dict() for d in
             db.collection("seasons").document(str(season)).collection("games")
               .where("wk", "==", week).stream()}
    if not games:
        return
    order = sorted(games, key=lambda g: (games[g]["kickoff"], g))

    # ---- 1. incremental pick load -------------------------------------
    # The private aggregate holds every pick we have already seen. We only
    # fetch picks written since then. On a quiet run that is zero reads.
    agg_ref = pool_ref.collection("private").document(f"agg_w{week}")
    agg = agg_ref.get().to_dict() or {}
    since = agg.get("syncedAt")
    picks = defaultdict(dict, {u: dict(v) for u, v in (agg.get("picks") or {}).items()})

    q = pool_ref.collection("picks").where("wk", "==", week)
    if since:
        q = q.where("updatedAt", ">", since)
    fetched = 0
    for d in q.stream():
        v = d.to_dict()
        # A cleared pick is a tombstone (winner: null), because picks can
        # never be deleted. Storing it as [None, None] made it a truthy
        # entry that survived the `if not p: continue` guard below and was
        # published as a pick that LOST — and, worse, made progress_w{n}
        # report the player as complete, so remind.py sent them nothing.
        # pop(), not skip: the tombstone must also evict a pick already
        # cached in agg_w{n} from an earlier run.
        if v.get("winner") is None:
            picks[v["uid"]].pop(v["gameId"], None)
            fetched += 1
            continue
        picks[v["uid"]][v["gameId"]] = [v["winner"], v.get("weight")]
        fetched += 1

    tb = dict(agg.get("tb") or {})
    tq = pool_ref.collection("tiebreaks").where("wk", "==", week)
    if since:
        tq = tq.where("updatedAt", ">", since)
    for d in tq.stream():
        v = d.to_dict()
        tb[v["uid"]] = v["total"]
        fetched += 1

    # ---- 2. roster ----------------------------------------------------
    # One document, maintained by clients writing only their own key.
    roster = (pool_ref.collection("private").document("roster").get().to_dict() or {})

    # ---- 3. reveal and score ------------------------------------------
    mode = scoring_mode(pool, week)
    revealed = {g for g in order if games[g]["kickoff"] <= now}
    finals = {g for g in revealed if games[g].get("status") == "final"}

    rows = []
    for uid, ps in picks.items():
        info = roster.get(uid) or {}
        pts = hits = 0
        pub = {}
        for gid in revealed:                      # only kicked-off games go public
            p = ps.get(gid)
            if not p:
                continue
            win, rank = p[0], p[1]
            hit = None
            if gid in finals:
                w = games[gid].get("winner")
                hit = (w is not None and win == w)
                if hit:
                    hits += 1
                    pts += pay(rank, len(order)) if mode == "confidence" else 1
            pub[gid] = [win, rank, 1 if hit else (0 if hit is False else None)]
        rows.append({"uid": uid, "name": info.get("name", "Player"),
                     "picks": pub, "pts": pts, "hits": hits,
                     "tb": tb.get(uid) if revealed else None})

    rows.sort(key=lambda r: (-r["pts"], -r["hits"], r["name"].lower()))
    for i, r in enumerate(rows):
        r["rank"] = i + 1

    # ---- 4. write ------------------------------------------------------
    batch = db.batch()
    snaps = pool_ref.collection("snapshots")

    meta = {"wk": week, "mode": mode, "updatedAt": now,
            "games": [{"id": g, "away": games[g]["away"], "home": games[g]["home"],
                       "kickoff": games[g]["kickoff"],
                       "status": games[g].get("status", "scheduled"),
                       "winner": games[g].get("winner"),
                       "awayScore": games[g].get("awayScore"),
                       "homeScore": games[g].get("homeScore"),
                       "spread": games[g].get("spread", "")} for g in order],
            "players": len(rows), "shardSize": SHARD,
            "shards": max(1, (len(rows) + SHARD - 1) // SHARD)}

    batch.set(snaps.document(f"w{week}_board"), {
        **meta,
        # Everyone's totals — small, and it is what the leaderboard needs.
        "standings": [{"uid": r["uid"], "name": r["name"], "pts": r["pts"],
                       "hits": r["hits"], "rank": r["rank"]} for r in rows],
        # Full pick rows for the leaders, so the default Grid view is one read.
        "top": [{"uid": r["uid"], "name": r["name"], "picks": r["picks"],
                 "pts": r["pts"], "rank": r["rank"], "tb": r["tb"]}
                for r in rows[:TOP_ROWS]],
    })

    for k in range(meta["shards"]):
        chunk = rows[k * SHARD:(k + 1) * SHARD]
        batch.set(snaps.document(f"w{week}_s{k}"), {
            "wk": week, "shard": k, "updatedAt": now,
            "rows": {r["uid"]: {"name": r["name"], "picks": r["picks"],
                                "pts": r["pts"], "rank": r["rank"], "tb": r["tb"]}
                     for r in chunk}})

    # Index so a client can find its own shard without scanning.
    batch.set(snaps.document(f"w{week}_index"),
              {"wk": week, "updatedAt": now, "shardSize": SHARD,
               "of": {r["uid"]: r["rank"] // SHARD for r in rows}})

    # Who still owes picks, for the reminder job. Admin only.
    open_games = [g for g in order if games[g]["kickoff"] > now]
    batch.set(pool_ref.collection("private").document(f"progress_w{week}"),
              {"wk": week, "updatedAt": now,
               "missing": {uid: [g for g in open_games if g not in picks.get(uid, {})]
                           for uid in roster.keys()},
               "tbMissing": [uid for uid in roster.keys() if uid not in tb]})

    batch.set(agg_ref, {"wk": week, "syncedAt": now,
                        "picks": {u: v for u, v in picks.items()},
                        "tb": tb})
    batch.commit()
    print(f"  {pool.get('name','pool')} wk{week}: {len(rows)} players, "
          f"{fetched} new picks, {len(revealed)}/{len(order)} revealed, "
          f"{meta['shards']} shard(s)")


def active_weeks(db, season, now):
    """Weeks worth rebuilding: anything with a kickoff in the last 5 days
    or the next 10. Everything else is settled or not yet relevant."""
    from datetime import timedelta
    ws = set()
    for d in (db.collection("seasons").document(str(season)).collection("games")
                .where("kickoff", ">", now - timedelta(days=5))
                .where("kickoff", "<", now + timedelta(days=10)).stream()):
        ws.add(d.to_dict()["wk"])
    return sorted(ws)


def main():
    ap = argparse.ArgumentParser()
    # NOT type=int — see remind.py. A preseason id is "2026PRE".
    ap.add_argument("--season", required=True,
                    help="Season id: 2026, or 2026PRE for the preseason pool")
    ap.add_argument("--week", type=int)
    a = ap.parse_args()

    db = get_db()
    now = datetime.now(timezone.utc)
    weeks = [a.week] if a.week else active_weeks(db, a.season, now)
    if not weeks:
        print("No active weeks.")
        return
    print(f"Building weeks {weeks}")

    for pool in db.collection("pools").where("season", "==", str(a.season)).stream():
        for w in weeks:
            build_week(db, a.season, pool.reference, pool.to_dict(), w, now)
    print("Done.")


if __name__ == "__main__":
    sys.exit(main())
