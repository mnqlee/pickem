#!/usr/bin/env python3
"""
Remove a player from the pool, with a backup, and put them back if needed.

A PLAYER LIVES IN FIVE PLACES, and every leftover fails differently:

  pools/{p}/members/{uid}          their row in the app, Grid and Standings
  pools/{p}/picks/{uid}_{gameId}   one document per game they ever picked
  pools/{p}/tiebreaks/{uid}_{wk}   one per week they entered a total
  pools/{p}/standings/{uid}        their season points and seals
  pools/{p}/private/roster  {uid}  a KEY inside one shared document: the
                                   one a Firebase console click misses,
                                   and the one that keeps reminders going
                                   to someone who has left

Picks and tiebreaks are matched by DOCUMENT ID ("uid_..."), never by the
uid field inside them, so a document with a wrong or missing field can
neither be missed nor cause someone else's pick to be deleted.

    python scripts/remove_member.py --season 2026 --list
    python scripts/remove_member.py --season 2026 --uid u_abc123
    python scripts/remove_member.py --season 2026 --uid u_abc123 --delete
    python scripts/remove_member.py --season 2026 --restore backups/removed-....json

Without --delete it only PRINTS what it would remove. With --delete it:
  - refuses to remove the pool owner;
  - refuses while a game is in progress, unless --anytime;
  - writes a JSON backup of everything first, and stops if it cannot;
  - asks you to type DELETE before it touches anything.

If a removed player ever opens the app again on a phone still signed in,
the app re-joins them as a NEW, EMPTY player. Their old picks and points
stay gone unless you --restore them.

Run it from the folder that holds serviceAccount.json.
"""

import argparse, json, os, sys
from datetime import datetime, timezone

SIX_H = 6 * 3600


def _ts(v):
    """Seconds since epoch from a Firestore timestamp, a datetime or millis."""
    if v is None:
        return None
    if hasattr(v, "timestamp"):
        return v.timestamp()
    try:
        return float(v) / 1000.0
    except (TypeError, ValueError):
        return None


def _jsonable(v):
    """Backups must survive a round trip, timestamps included."""
    if hasattr(v, "timestamp") and hasattr(v, "isoformat"):
        return {"__ts__": v.timestamp()}
    if isinstance(v, dict):
        return {k: _jsonable(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_jsonable(x) for x in v]
    return v


def _unjson(v):
    if isinstance(v, dict):
        if set(v) == {"__ts__"}:
            return datetime.fromtimestamp(v["__ts__"], tz=timezone.utc)
        return {k: _unjson(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_unjson(x) for x in v]
    return v


def pools_for(db, season, pool=None):
    if pool:
        snap = db.collection("pools").document(pool).get()
        return [snap] if snap.exists else []
    return [p for p in db.collection("pools").where("season", "==", str(season)).stream()]


def game_in_progress(db, season, now):
    """A game that has kicked off, is not final, and kicked off under six
    hours ago (the same clamp the app uses, so a stuck game cannot block
    this forever)."""
    for g in db.collection("seasons").document(str(season)).collection("games").stream():
        d = g.to_dict() or {}
        k = _ts(d.get("kickoff"))
        if k is None or d.get("status") == "final":
            continue
        if k <= now and now < k + SIX_H:
            return f"{d.get('away', '?')} @ {d.get('home', '?')}"
    return None


def collect(db, pid, uid):
    """Everything this uid owns in this pool, as {place: {doc_id: data}}."""
    p = db.collection("pools").document(pid)
    out = {"members": {}, "picks": {}, "tiebreaks": {}, "standings": {}, "roster": None}
    m = p.collection("members").document(uid).get()
    if m.exists:
        out["members"][uid] = m.to_dict()
    pre = uid + "_"
    for name in ("picks", "tiebreaks"):
        for d in p.collection(name).stream():
            if d.id.startswith(pre):
                out[name][d.id] = d.to_dict()
    s = p.collection("standings").document(uid).get()
    if s.exists:
        out["standings"][uid] = s.to_dict()
    roster = p.collection("private").document("roster").get().to_dict() or {}
    if uid in roster:
        out["roster"] = roster[uid]
    return out


def summarize(found):
    picks = [d for d in found["picks"].values() if (d or {}).get("winner") is not None]
    weeks = sorted({d.get("wk") for d in picks if d.get("wk") is not None})
    last = max((_ts(d.get("updatedAt")) or 0 for d in picks), default=0)
    st = next(iter(found["standings"].values()), None) or {}
    scored = sorted(int(w) for w in (st.get("weeks") or {}).keys() if str(w).isdigit())
    return {"picks": len(picks), "pickDocs": len(found["picks"]), "weeks": weeks,
            "last": last, "tiebreaks": len(found["tiebreaks"]),
            "scored": scored, "pts": st.get("pts", 0), "roster": found["roster"] is not None}


def when(ts):
    if not ts:
        return "never"
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%b %d")


def list_members(db, pid, pd):
    p = db.collection("pools").document(pid)
    members = {m.id: (m.to_dict() or {}) for m in p.collection("members").stream()}
    picks = {}
    for d in p.collection("picks").stream():
        x = d.to_dict() or {}
        if x.get("winner") is None:
            continue
        uid = next((u for u in members if d.id.startswith(u + "_")), None)
        if uid is None:
            continue
        r = picks.setdefault(uid, {"weeks": set(), "last": 0})
        if x.get("wk") is not None:
            r["weeks"].add(x.get("wk"))
        r["last"] = max(r["last"], _ts(x.get("updatedAt")) or 0)
    rows = []
    for uid, m in members.items():
        r = picks.get(uid, {"weeks": set(), "last": 0})
        rows.append((r["last"], m.get("name") or "(no name)", uid, sorted(r["weeks"])))
    rows.sort()
    print(f"\n{pd.get('name')}  ({pid})   {len(rows)} players, least recent first\n")
    print(f"  {'name':<22}{'last pick':<11}{'weeks picked':<22}uid")
    print("  " + "-" * 84)
    for last, name, uid, weeks in rows:
        wk = ",".join(str(w) for w in weeks) or "none"
        own = "   (owner)" if uid == pd.get("ownerUid") else ""
        print(f"  {name[:21]:<22}{when(last):<11}{wk[:21]:<22}{uid}{own}")
    print()
    return rows


def remove(db, pid, uid, found):
    """Delete everything in `found`. Roster key last: it is the one shared doc."""
    p = db.collection("pools").document(pid)
    for doc_id in found["picks"]:
        p.collection("picks").document(doc_id).delete()
    for doc_id in found["tiebreaks"]:
        p.collection("tiebreaks").document(doc_id).delete()
    if found["standings"]:
        p.collection("standings").document(uid).delete()
    if found["members"]:
        p.collection("members").document(uid).delete()
    if found["roster"] is not None:
        rref = p.collection("private").document("roster")
        roster = rref.get().to_dict() or {}
        if uid in roster:
            roster.pop(uid)
            rref.set(roster)          # whole document, minus this one key


def restore(db, backup):
    pid, uid, found = backup["pool"], backup["uid"], _unjson(backup["data"])
    p = db.collection("pools").document(pid)
    for doc_id, d in found["members"].items():
        p.collection("members").document(doc_id).set(d)
    for doc_id, d in found["picks"].items():
        p.collection("picks").document(doc_id).set(d)
    for doc_id, d in found["tiebreaks"].items():
        p.collection("tiebreaks").document(doc_id).set(d)
    for doc_id, d in found["standings"].items():
        p.collection("standings").document(doc_id).set(d)
    if found.get("roster") is not None:
        p.collection("private").document("roster").set({uid: found["roster"]}, merge=True)
    return pid, uid


def write_backup(folder, pid, uid, found, name):
    os.makedirs(folder, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    path = os.path.join(folder, f"removed-{uid}-{stamp}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"pool": pid, "uid": uid, "name": name, "at": stamp,
                   "data": _jsonable(found)}, f, indent=1)
    with open(path, encoding="utf-8") as f:          # prove it reads back
        json.load(f)
    return path


def run(db, a, now=None, confirm=input, out=print):
    now = now if now is not None else datetime.now(timezone.utc).timestamp()

    if a.restore:
        with open(a.restore, encoding="utf-8") as f:
            backup = json.load(f)
        pid, uid = restore(db, backup)
        out(f"\n  Restored {backup.get('name') or uid} into pool {pid}.\n")
        return 0

    pools = pools_for(db, a.season, a.pool)
    if not pools:
        out(f"No pool found for season {a.season}.")
        return 1

    if a.list or not a.uid:
        for pool in pools:
            list_members(db, pool.id, pool.to_dict() or {})
        if not a.uid:
            out("  Pick the uid(s) to remove from the list above, then run:")
            out(f"    python scripts/remove_member.py --season {a.season} --uid <uid>\n")
        return 0

    plan = []
    for pool in pools:
        pd, pid = pool.to_dict() or {}, pool.id
        for uid in a.uid:
            found = collect(db, pid, uid)
            s = summarize(found)
            nothing = not (found["members"] or found["picks"] or found["tiebreaks"]
                           or found["standings"] or found["roster"] is not None)
            if nothing:
                continue
            name = (found["members"].get(uid) or {}).get("name") or "(no name)"
            plan.append((pid, pd, uid, name, found, s))

    missing = [u for u in a.uid if u not in {x[2] for x in plan}]
    for u in missing:
        out(f"\n  !! {u} is not in any pool for season {a.season}. Check the uid.")

    for pid, pd, uid, name, found, s in plan:
        out(f"\n  {name}  ({uid})  in {pd.get('name')}")
        out(f"    member record           {'yes' if found['members'] else 'no'}")
        out(f"    pick documents          {s['pickDocs']}  (weeks {','.join(map(str, s['weeks'])) or 'none'}, last {when(s['last'])})")
        out(f"    tiebreakers             {s['tiebreaks']}")
        out(f"    standings row           {'yes, ' + str(s['pts']) + ' pts' if found['standings'] else 'no'}")
        out(f"    reminder roster entry   {'yes' if s['roster'] else 'no'}")
        if s["scored"]:
            out(f"    NOTE: scored in week(s) {','.join(map(str, s['scored']))}. Removing them takes")
            out("    their row off the Season table. Past week winners are not changed.")

    if not a.delete:
        out("\n  Nothing was changed. Add --delete to remove the player(s) above.\n")
        return 1 if missing else 0

    if not plan:
        return 1

    for pid, pd, uid, name, found, s in plan:
        if uid == pd.get("ownerUid"):
            out(f"\n  STOP: {name} is the pool owner. The owner cannot be removed.\n")
            return 2

    if not a.anytime:
        live = game_in_progress(db, a.season, now)
        if live:
            out(f"\n  STOP: {live} is being played right now. Run this when no game is")
            out("  on, or add --anytime if you are sure.\n")
            return 2

    backups = []
    for pid, pd, uid, name, found, s in plan:
        try:
            backups.append(write_backup(a.backup_dir, pid, uid, found, name))
        except Exception as e:
            out(f"\n  STOP: could not write the backup ({e}). Nothing was deleted.\n")
            return 2

    names = ", ".join(x[3] for x in plan)
    answer = confirm(f"\n  Remove {names} for good? Backups are saved. Type DELETE to go ahead: ")
    if (answer or "").strip() != "DELETE":
        out("\n  Cancelled. Nothing was deleted.\n")
        return 1

    for (pid, pd, uid, name, found, s), path in zip(plan, backups):
        remove(db, pid, uid, found)
        out(f"\n  Removed {name}. Backup: {path}")
        out(f"  To undo:  python scripts/remove_member.py --season {a.season} --restore \"{path}\"")
    out("")
    return 0


def parse(argv=None):
    ap = argparse.ArgumentParser(description="Remove a player from the pool, with a backup.")
    ap.add_argument("--season", required=True)
    ap.add_argument("--pool")
    ap.add_argument("--list", action="store_true", help="show every player and their last pick")
    ap.add_argument("--uid", action="append", default=[], help="a player to remove; repeatable")
    ap.add_argument("--delete", action="store_true", help="actually remove them (backup first)")
    ap.add_argument("--anytime", action="store_true", help="allow while a game is in progress")
    ap.add_argument("--restore", help="a backup file to put back")
    # backups/ is in .gitignore: these files hold player names and picks,
    # and the repository is public.
    ap.add_argument("--backup-dir", default="backups")
    return ap.parse_args(argv)


def main():
    a = parse()
    import firebase_admin
    from firebase_admin import credentials, firestore
    firebase_admin.initialize_app(credentials.Certificate("serviceAccount.json"))
    return run(firestore.client(), a)


if __name__ == "__main__":
    sys.exit(main())
