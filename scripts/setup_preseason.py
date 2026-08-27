#!/usr/bin/env python3
"""
Stand up an isolated preseason pool.

The whole point: preseason lives under its own season id, so the regular
season shares nothing with it. No stats to unwind, no standings to
reset, no half-deleted picks lurking in a collection. When you are done
you throw the whole thing away with reset_pool.py, and the real season
was never touched.

    python scripts/setup_preseason.py --season 2026

Creates:
    seasons/2026PRE/games/*      preseason schedule
    pools/{new id}               season = "2026PRE"

Then set SEASON = '2026PRE' in index.html and firebase-init.js, deploy,
and send the join link.
"""

import argparse, secrets, sys
import firebase_admin
from firebase_admin import credentials, firestore

# No I, O, 0 or 1 — they get misread when a code is read out loud.
ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, required=True)
    ap.add_argument("--name", default="Preseason Shakedown")
    ap.add_argument("--mode", choices=["confidence", "straight"], default="confidence")
    a = ap.parse_args()

    pre = f"{a.season}PRE"
    firebase_admin.initialize_app(credentials.Certificate("serviceAccount.json"))
    db = firestore.client()

    ref = db.collection("pools").document()
    code = "".join(secrets.choice(ALPHA) for _ in range(6))
    ref.set({
        "name": a.name,
        "season": pre,                       # <- the isolation
        "joinCode": code,
        "ownerUid": "SET_ME",
        "scoringHistory": [{"week": 1, "mode": a.mode}],
        "disposable": True,                  # reset_pool.py refuses without this
    })
    ref.collection("private").document("roster").set({})

    print(f"""
Preseason pool created.

  POOL ID    {ref.id}
  JOIN CODE  {code}
  SEASON     {pre}

Next:
  1. python scripts/import_schedule.py --season {a.season} --preseason
     (writes into seasons/{pre}/games — see the --preseason flag)
  2. Set SEASON = '{pre}' in index.html and firebase-init.js, deploy
  3. Share  https://YOURDOMAIN/?join={code}

When the preseason is done:
  python scripts/reset_pool.py --pool {ref.id} --season {pre} --yes
""")


if __name__ == "__main__":
    sys.exit(main())
