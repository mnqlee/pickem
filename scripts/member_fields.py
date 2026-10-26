"""
Read-only. Lists the field names on every membership document and flags
any document the app is not allowed to update.

Why it exists: firestore.rules only lets a player edit their own
membership record if it holds no fields beyond
name, photo, joinedAt, code and rivals. A record carrying anything else
(left by an older version or a script) refuses EVERY edit, so picking a
rival fails with "That rival did not save." This finds those records.

    python scripts/member_fields.py --season 2026

Prints names and field NAMES only, never values.
"""
import argparse

import firebase_admin
from firebase_admin import credentials, firestore

ALLOWED = {"name", "photo", "joinedAt", "code", "rivals"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", required=True)
    ap.add_argument("--pool")
    a = ap.parse_args()

    firebase_admin.initialize_app(credentials.Certificate("serviceAccount.json"))
    db = firestore.client()
    pools = ([db.collection("pools").document(a.pool).get()] if a.pool
             else list(db.collection("pools").where("season", "==", str(a.season)).stream()))

    blocked = 0
    for pool in pools:
        if not pool.exists:
            continue
        print(f"\n{(pool.to_dict() or {}).get('name')}  ({pool.id})\n")
        for m in db.collection("pools").document(pool.id).collection("members").stream():
            d = m.to_dict() or {}
            extra = sorted(set(d) - ALLOWED)
            name = d.get("name")
            problems = []
            if extra:
                problems.append("extra fields: " + ", ".join(extra))
            if not isinstance(name, str) or not name:
                problems.append("no name")
            elif len(name) > 40:
                problems.append(f"name is {len(name)} characters (limit 40)")
            r = d.get("rivals")
            if r is not None and (not isinstance(r, list) or len(r) > 2 or m.id in r):
                problems.append("bad rivals list")
            flag = "BLOCKED  " if problems else "ok       "
            if problems:
                blocked += 1
            print(f"  {flag}{str(name)[:28]:<30}{m.id:<28}{', '.join(sorted(d))}")
            for p in problems:
                print(f"           -> {p}")

    print(f"\n{blocked} record(s) cannot be updated by their owner.\n")


if __name__ == "__main__":
    main()
