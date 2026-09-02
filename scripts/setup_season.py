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


def canonical(email: str) -> str:
    """Must stay identical to canonical() in worker/auth.js.

    Gmail ignores dots in the local part and treats anything after a "+" as
    a tag, so every spelling of one inbox has to resolve to one uid or the
    same person turns up as two players. Applied to gmail only: plenty of
    other hosts treat "+" as an ordinary character, and merging there would
    let whoever holds name+tag@host inherit name@host's account.
    """
    e = email.strip().lower()
    at = e.rfind("@")
    if at < 1:
        return e
    local, domain = e[:at], e[at + 1:]
    if domain in ("gmail.com", "googlemail.com"):
        local = local.split("+")[0].replace(".", "")
        if not local:
            return e
        return local + "@gmail.com"
    return e


def owner_uid(email: str) -> str:
    h = hashlib.sha256(canonical(email).encode()).hexdigest()
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

    # The code -> pool lookup the app joins through.
    #
    # Pool documents are no longer world-readable (they used to be, which
    # let any signed-in stranger list every pool, read its join code and
    # add themselves as a member). joinPool() reads exactly this one
    # document, by exact code, so a code still gets you in but can no
    # longer be discovered. Written here because the rules deny every
    # client write to it. See the JOIN CODES block in firestore.rules.
    db.collection("joinCodes").document(code).set({
        "poolId": ref.id,
        "season": str(a.season),
    })

    # The owner has to be a MEMBER, not just the ownerUid on the pool doc.
    # firestore.rules gates the roster, standings, picks and tiebreaks on
    # isMember(), which checks for pools/{id}/members/{uid}. Without this
    # the pool's own creator can read the pool document and nothing else,
    # and because the app finds a pool it never offers the join screen
    # that would fix it. Learned the hard way on the 2026 pool.
    ref.collection("members").document(uid).set({
        "name": a.owner_email.split("@")[0],
        "photo": None,
        "joinedAt": firestore.SERVER_TIMESTAMP,
    })

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
  5. Share the bare domain: https://YOURDOMAIN

     Step 4 is what makes step 5 work — with DEFAULT_JOIN set, a visitor
     who arrives at the plain domain is put in this pool without any code
     in the link. https://YOURDOMAIN/?join={code} still works and is what
     you would send if a second pool ever exists, but there is no reason
     to put it in front of people while this is the only one.
""")


if __name__ == "__main__":
    sys.exit(main())
