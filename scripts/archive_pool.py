#!/usr/bin/env python3
"""
Flatten a finished pool into a single document so it survives deletion.

Run this BEFORE reset_pool.py. It reads the final standings and weekly
winners and writes them into the pool you are keeping, as one document.
Then the preseason pool can be wiped and the record still exists.

    python scripts/archive_pool.py --from PREPOOLID --to REALPOOLID \\
        --label "Preseason 2026"

    # hide it from everyone but the owner when the season starts
    python scripts/archive_pool.py --to REALPOOLID --id preseason-2026 --hide

Writes:  pools/{to}/archive/{id}
"""

import argparse, re, sys
import firebase_admin
from firebase_admin import credentials, firestore


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="src", help="pool to archive")
    ap.add_argument("--to", required=True, help="pool that will hold the record")
    ap.add_argument("--label", default="")
    ap.add_argument("--note", default="")
    ap.add_argument("--id", help="archive doc id (defaults from the label)")
    ap.add_argument("--show", action="store_true",
                    help="state=public: everyone sees the tab")
    ap.add_argument("--hide", action="store_true",
                    help="state=owner: only you see it, marked hidden")
    ap.add_argument("--off", action="store_true",
                    help="state=off: tab disappears completely, for you too. "
                         "Data kept for the scripts.")
    ap.add_argument("--remove", action="store_true",
                    help="delete the archive document permanently")
    a = ap.parse_args()

    firebase_admin.initialize_app(credentials.Certificate("serviceAccount.json"))
    db = firestore.client()
    dest = db.collection("pools").document(a.to).collection("archive")

    # state-change / delete mode
    if (a.hide or a.show or a.off or a.remove) and not a.src:
        if not a.id:
            print("--id is required when changing state")
            return 1
        doc = dest.document(a.id)
        if a.remove:
            if not doc.get().exists:
                print(f"No archive {a.id}")
                return 1
            doc.delete()
            print(f"{a.id} deleted permanently. The tab is gone and so is the record.")
            return 0
        st = "public" if a.show else "owner" if a.hide else "off"
        doc.set({"state": st}, merge=True)
        msg = {"public": "visible to everyone",
               "owner":  "visible to you only, marked hidden",
               "off":    "gone completely, including for you. Data kept."}[st]
        print(f"{a.id} is now {msg}")
        return 0

    if not a.src:
        print("--from is required unless you are only toggling --hide/--show")
        return 1

    src = db.collection("pools").document(a.src)
    pool = src.get().to_dict() or {}
    label = a.label or pool.get("name", "Archived pool")
    aid = a.id or re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-")

    rows = []
    for d in src.collection("standings").stream():
        if d.id.startswith("_"):
            continue
        v = d.to_dict()
        weeks = v.get("weeks", {}) or {}
        rows.append({
            "name": v.get("name", "Player"),
            "pts": v.get("pts", 0),
            "hits": v.get("hits", 0),
            "of": sum(w.get("games", 0) for w in weeks.values()) or None,
            "wins": v.get("weekWins", 0),
            "seconds": v.get("weekSeconds", 0),
            "perfect": v.get("perfectWeeks", 0),
        })
    rows.sort(key=lambda r: -r["pts"])

    weeks = []
    wdoc = src.collection("standings").document("_weeks").get().to_dict() or {}
    for wk, w in sorted(wdoc.items(), key=lambda kv: -int(kv[0])):
        names = ", ".join(x["name"] for x in w.get("winners", []))
        weeks.append({"wk": int(wk), "winner": names, "pts": w.get("pts", 0)})

    dest.document(aid).set({
        "id": aid, "label": label, "note": a.note,
        "state": "off" if a.off else "owner" if a.hide else "public",
        "season": pool.get("season"),
        "standings": rows, "weeks": weeks,
        "archivedAt": firestore.SERVER_TIMESTAMP,
    })

    print(f"""
Archived to pools/{a.to}/archive/{aid}

  {len(rows)} players, {len(weeks)} weeks
  state: {"off" if a.off else "owner" if a.hide else "public"}

Safe to run reset_pool.py on {a.src} now — this record does not live there.
Later:
  --hide    only you see it
  --off     tab disappears for everyone, data kept
  --remove  delete it for good

  python scripts/archive_pool.py --to {a.to} --id {aid} --off
""")
    return 0


if __name__ == "__main__":
    sys.exit(main())
