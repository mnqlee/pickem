#!/usr/bin/env python3
"""
Stand up the real regular-season pool.

Unlike setup_preseason.py (disposable, meant to be thrown away), this
creates the PERMANENT pool: season is a bare year ("2026"), not marked
disposable, and — unlike setup_preseason.py's ownerUid, which was left
as the literal placeholder "SET_ME" and never actually filled in — the
owner uid is computed here the exact same way the auth Worker computes
it at sign-in time (sha256 of the lowercased, trimmed email, prefixed
"u_", first 24 hex chars), so ownership is correct from the moment the
pool is created instead of needing a manual follow-up edit that's easy
to forget.

    python scripts/setup_season.py --season 2026 --owner-email you@example.com

Creates:
    pools/{new id}     season = "2026", ownerUid = derived from your email

Verify the printed uid matches window.PS.user.uid in your browser
console before relying on owner-only actions (pool settings, etc.).
"""

import argparse, hashlib, secrets, sys
import firebase_admin
from firebase_admin import credentials, firestore

# No I, O, 0 or 1 — they get misread when a code is read out loud.
ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def owner_uid(email: str) -> str:
    norm = email.strip().lower()
    h = hashlib.sha256(norm.encode()).hexdigest()
    return "u_" + h[:24]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, required=True)
    ap.add_argument("--owner-email", required=True,
                     help="Email the pool owner signs in with — used to derive ownerUid.")
    ap.add_argument("--name", default="Weekly NFL Pick'em")
    ap.add_argument("--mode", choices=["confidence", "straight"], default="confidence")
    ap.add_argument("--join-code",
                     help="Fixed join code instead of a random one — lets the code/deploy "
                          "steps that reference it be prepared before this script runs.")
    a = ap.parse_args()

    uid = owner_uid(a.owner_email)
    firebase_admin.initialize_app(credentials.Certificate("serviceAccount.json"))
    db = firestore.client()

    ref = db.collection("pools").document()
    code = (a.join_code or "".join(secrets.choice(ALPHA) for _ in range(6))).upper()
    ref.set({
        "name": a.name,
        "season": str(a.season),
        "joinCode": code,
        "ownerUid": uid,
        "scoringHistory": [{"week": 1, "mode": a.mode}],
    })
    ref.collection("private").document("roster").set({})

    print(f"""
Regular-season pool created.

  POOL ID    {ref.id}
  JOIN CODE  {code}
  SEASON     {a.season}
  OWNER UID  {uid}
             (derived from {a.owner_email} — verify this matches
             window.PS.user.uid in your browser console)

Next:
  1. python scripts/import_schedule.py --season {a.season}
     (writes the full 18-week regular season into seasons/{a.season}/games)
  2. Set SEASON = '{a.season}' in index.html and firebase-init.js, deploy
  3. Set SEASON = '{a.season}' in worker/wrangler-live.toml, redeploy the
     pickem-live Worker
  4. Update DEFAULT_JOIN in index.html to {code}
  5. Share  https://YOURDOMAIN/?join={code}
""")


if __name__ == "__main__":
    sys.exit(main())
