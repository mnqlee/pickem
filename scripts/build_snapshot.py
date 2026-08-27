#!/usr/bin/env python3
"""
Build the read-optimised snapshots the app serves from.

Clients never query raw picks. This job reads them, computes what is
revealed and what everything scores, and writes a handful of documents
that the app reads directly. Two reads to render the Grid instead of
several thousand.

    python scripts/build_snapshot.py --season 2026

Runs every 5 minutes during game windows. Cheap, because it only reads
picks that changed since the last run.

WHAT IT WRITES
  pools/{p}/private/agg_w{n}      every pick, admin only, the working set
  pools/{p}/private/progress_w{n} who is missing what, for remind.py
  pools/{p}/snapshots/w{n}_board  standings + the top rows, members read this
  pools/{p}/snapshots/w{n}_s{k}   full pick rows, 100 players per shard
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
    """`n` is that week's game count. Bye weeks are not sixteen games."""
    if not rank:
        return 1
    return (n + 1 - rank) if RANK_ONE_IS_BEST else rank


def get_db():
    key = os.environ.get("FIREBASE_SERVICE_ACCOUNT_FILE", "serviceAccount.json")
    if not firebase_admin._apps:
        firebase_admin.initialize_app(credentials.Certificate(key))
    return firestore.client()


def scoring_mode(pool, week):
    mode = "straight"
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
    ap.add_argument("--season", type=int, required=True)
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
