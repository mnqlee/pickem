#!/usr/bin/env python3
"""
Delete a pool and everything under it.

Firestore does NOT cascade. Deleting a pool document leaves every
subcollection behind as orphaned data that still counts against your
quota and still shows up in queries. This walks them properly.

    python scripts/reset_pool.py --pool POOLID --dry-run
    python scripts/reset_pool.py --pool POOLID --season 2026PRE --yes

SAFETY
  - Refuses any pool without disposable = true, so you cannot point this
    at the real season by pasting the wrong id.
  - Refuses a season id that does not end in PRE unless you add --force.
  - --dry-run prints the counts and deletes nothing. Run it first.
"""

import argparse, sys
import firebase_admin
from firebase_admin import credentials, firestore

# Every subcollection anything writes under a pool. If you add one,
# add it here or reset_pool will leave orphans behind.
SUBS = ["picks", "tiebreaks", "standings", "members",
        "private", "reminders", "snapshots", "config", "archive"]


def wipe(col, dry, label):
    n = 0
    while True:
        batch_docs = list(col.limit(400).stream())
        if not batch_docs:
            break
        if dry:
            n += len(batch_docs)
            if len(batch_docs) < 400:
                break
            # dry run cannot page past the first batch without deleting
            print(f"    {label}: 400+ (dry run stops counting)")
            return n
        b = col._client.batch()
        for d in batch_docs:
            b.delete(d.reference)
        b.commit()
        n += len(batch_docs)
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pool", required=True)
    ap.add_argument("--season", help="also delete seasons/<id>/games")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--yes", action="store_true")
    ap.add_argument("--force", action="store_true",
                    help="override the disposable and PRE guards")
    a = ap.parse_args()

    firebase_admin.initialize_app(credentials.Certificate("serviceAccount.json"))
    db = firestore.client()

    ref = db.collection("pools").document(a.pool)
    snap = ref.get()
    if not snap.exists:
        print(f"No pool {a.pool}")
        return 1
    data = snap.to_dict()
    print(f"\nPool : {data.get('name')}  ({a.pool})")
    print(f"Season: {data.get('season')}\n")

    if not data.get("disposable") and not a.force:
        print("REFUSED: this pool is not marked disposable.")
        print("Only pools made by setup_preseason.py can be wiped.")
        print("If you really mean it, add --force.")
        return 1

    if a.season and not a.season.endswith("PRE") and not a.force:
        print(f"REFUSED: season '{a.season}' does not end in PRE.")
        print("That looks like a real season. Add --force if you mean it.")
        return 1

    # CONFIRM BEFORE DESTROYING ANYTHING, not after.
    #
    # The wipe below ran unconditionally; only deletion of the POOL
    # DOCUMENT was gated on --yes. So `reset_pool.py --pool REALPOOL
    # --force` irreversibly destroyed every pick, standing, member and
    # tiebreak of a live season and then printed "Pool document itself
    # left in place. Add --yes to remove it too." — which reads like not
    # much happened. There was no interactive confirmation anywhere in
    # this file, and nothing made the operator name the pool first.
    if not a.dry_run and not a.yes:
        print("About to DELETE every pick, standing, member and tiebreak in:")
        print(f"    pool   {a.pool}   \"{data.get('name')}\"")
        if a.season:
            print(f"    season {a.season}   (its games too)")
        print("\nThis cannot be undone. Type the pool id to confirm.")
        try:
            typed = input("pool id: ").strip()
        except EOFError:
            print("REFUSED: nothing to read from. Re-run with --yes if you mean it.")
            return 1
        if typed != a.pool:
            print("REFUSED: that did not match. Nothing was deleted.")
            return 1

    total = 0
    for name in SUBS:
        c = wipe(ref.collection(name), a.dry_run, name)
        if c:
            print(f"  {'would delete' if a.dry_run else 'deleted'} {c:>5}  {name}")
            total += c

    if a.season:
        gc = wipe(db.collection("seasons").document(a.season).collection("games"),
                  a.dry_run, "games")
        if gc:
            print(f"  {'would delete' if a.dry_run else 'deleted'} {gc:>5}  "
                  f"seasons/{a.season}/games")
            total += gc

    if a.dry_run:
        print(f"\nDRY RUN. {total} documents would go. Nothing was deleted.")
        return 0

    if not a.yes:
        print(f"\n{total} documents deleted from subcollections.")
        print("Pool document itself left in place. Add --yes to remove it too.")
        return 0

    ref.delete()
    if a.season:
        db.collection("seasons").document(a.season).delete()
    print(f"\nGone. {total} documents plus the pool document.")
    print("The regular season was never touched.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
