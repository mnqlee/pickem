#!/usr/bin/env python3
"""
One-time migration: publish the code -> pool lookup for pools that already
exist, and backfill `code` on existing member documents.

WHY THIS EXISTS
Pool documents used to be readable by anyone signed in. That is what made
`joinPool()` work — it queried the whole pools collection for a matching
joinCode — but the same permission let any signed-in stranger LIST every
pool, read its join code and ownerUid, and then write their own membership
document, which the members rule allowed with no proof of invitation. They
became a full member: everyone's revealed picks, a row in the standings,
and their picks folded into the pool's scoring.

Pools are now members-only, and codes resolve through `joinCodes/{code}`,
a one-field document holding just the pool id. A code still gets you in;
it can no longer be discovered.

Run this ONCE, after deploying the new firestore.rules, for every season
whose pool was created before the change:

    python scripts/migrate_join_codes.py --season 2026
    python scripts/migrate_join_codes.py --season 2026 --dry-run

Safe to re-run: every write is idempotent.
"""

import argparse
import sys

import firebase_admin
from firebase_admin import credentials, firestore


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", required=True,
                    help='Season id: 2026, or 2026PRE for a preseason pool')
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    firebase_admin.initialize_app(credentials.Certificate("serviceAccount.json"))
    db = firestore.client()

    pools = list(db.collection("pools").where("season", "==", str(a.season)).stream())
    if not pools:
        print(f"No pools found for season {a.season}.")
        return 1

    for p in pools:
        d = p.to_dict() or {}
        code = (d.get("joinCode") or "").upper()
        name = d.get("name", "pool")
        if not code:
            print(f"  !! {name} ({p.id}) has no joinCode — skipped. "
                  f"Nobody can join it until one is set.")
            continue

        print(f"\n{name}  ({p.id})   code {code}")

        if a.dry_run:
            print(f"  would write joinCodes/{code} -> {p.id}")
        else:
            db.collection("joinCodes").document(code).set({
                "poolId": p.id,
                "season": str(a.season),
            })
            print(f"  wrote joinCodes/{code} -> {p.id}")

        # Backfill `code` on existing members. The rule only requires it to
        # CREATE a membership, so existing members are already fine — but a
        # member whose record is rewritten by a future client would other-
        # wise be writing a document shaped differently from a new one.
        members = list(p.reference.collection("members").stream())
        missing = [m for m in members if not (m.to_dict() or {}).get("code")]
        if not missing:
            print(f"  {len(members)} member(s), all already carry the code")
            continue
        if a.dry_run:
            print(f"  would backfill code on {len(missing)} of {len(members)} member(s)")
        else:
            batch = db.batch()
            for m in missing:
                batch.set(m.reference, {"code": code}, merge=True)
            batch.commit()
            print(f"  backfilled code on {len(missing)} of {len(members)} member(s)")

    print("\nDry run — nothing was written." if a.dry_run else
          "\nDone. Existing members keep working; new joins now resolve through joinCodes.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
