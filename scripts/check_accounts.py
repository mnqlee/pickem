#!/usr/bin/env python3
"""
Is anybody in this pool signed in as two different people?

WHY THIS EXISTS. A player entered their Monday night tiebreaker, saw
"Saved", closed the app, reopened it, and the box was blank. It looked
like a failed write or a failed read; the pool's own Standings screen
showed the real answer, which was TWO ROWS WITH THE SAME NAME.

A membership is keyed by uid, and every pick, rank and tiebreaker is
filed under the uid that wrote it. So one human with two uids is two
players as far as this app is concerned: they write the guess as one and
read it back as the other, and it is legitimately not there. The same
split quietly divides their picks, gives them two rows in the standings,
and scores neither of them correctly.

WHAT PRODUCES A SECOND UID. The sign-in Worker mints a token per verified
email address, so a second address is a second person by design — a
gmail vs a yahoo, a typo, a work address on one device. That is worth
knowing about whether or not anything looks broken.

    python scripts/check_accounts.py --season 2026
    python scripts/check_accounts.py --season 2026 --week 1

READ-ONLY. It writes nothing, changes nothing, and deletes nothing. Where
it finds a duplicate it says what it would take to merge them and stops —
choosing which account is the real one is a decision for a person.
"""

import argparse, hashlib, sys
from collections import defaultdict

import firebase_admin
from firebase_admin import credentials, firestore


def canonical(raw):
    """The address a player IS, not the one they typed.

    A LINE-FOR-LINE PORT of canonical() in worker/auth.js. If the two ever
    disagree this script reports the wrong uid, which on a question about
    identity is worse than reporting nothing — so keep them in step, and
    check worker/auth.js before changing anything here.
    """
    e = str(raw or "").strip().lower()
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


def uid_for(email):
    """uid = 'u_' + sha256(canonical(email))[:24] — worker/auth.js line 520.

    The uid is STABLE PER ADDRESS by design, which is the whole reason a
    duplicate account means a duplicate ADDRESS and never a glitch."""
    return "u_" + hashlib.sha256(canonical(email).encode()).hexdigest()[:24]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", required=True)
    ap.add_argument("--week", type=int, default=1)
    ap.add_argument("--pool")
    ap.add_argument("--email", action="append", default=[],
                    help="an address to resolve to its uid; repeatable")
    a = ap.parse_args()

    # Answer the address questions first — they need no database at all.
    if a.email:
        print("\n  address -> uid\n")
        for e in a.email:
            print(f"  {e:<38}{uid_for(e)}")
        print()

    firebase_admin.initialize_app(credentials.Certificate("serviceAccount.json"))
    db = firestore.client()

    pools = ([db.collection("pools").document(a.pool).get()] if a.pool
             else list(db.collection("pools").where("season", "==", str(a.season)).stream()))

    trouble = 0
    for pool in pools:
        if not pool.exists:
            continue
        pd, pid = pool.to_dict(), pool.id
        print(f"\n{pd.get('name')}  ({pid})")

        members = {m.id: (m.to_dict() or {}) for m in
                   db.collection("pools").document(pid).collection("members").stream()}

        # The roster carries the email; the member doc carries the name.
        roster = (db.collection("pools").document(pid)
                    .collection("private").document("roster").get().to_dict()) or {}

        # ---- what each uid actually owns -------------------------------
        picks = defaultdict(int)
        for p in (db.collection("pools").document(pid).collection("picks")
                    .where("wk", "==", a.week).stream()):
            d = p.to_dict() or {}
            if d.get("winner") is not None:
                picks[d.get("uid")] += 1

        tbs = {}
        for t in (db.collection("pools").document(pid).collection("tiebreaks")
                    .where("wk", "==", a.week).stream()):
            d = t.to_dict() or {}
            tbs[d.get("uid")] = {"total": d.get("total"), "doc": t.id}

        print(f"\n  {len(members)} member records, week {a.week}\n")
        print(f"  {'name':<22}{'picks':<8}{'tiebreak':<11}uid")
        print("  " + "-" * 80)
        for uid, m in sorted(members.items(), key=lambda kv: (kv[1].get("name") or "").lower()):
            name = m.get("name") or "(no name)"
            tb = tbs.get(uid)
            print(f"  {name[:21]:<22}{picks.get(uid,0):<8}"
                  f"{(str(tb['total']) if tb else '-'):<11}{uid}")
        print("\n  No email column, and that is not an oversight: nothing in")
        print("  Firestore stores one. members/{uid} is pinned by the security")
        print("  rules to name, photo, joinedAt and code, and the roster holds")
        print("  name, timezone and push tokens. The address lives only in the")
        print("  sign-in Worker. Resolve one with --email; the uid it prints is")
        print("  computed the same way the Worker computes it.")

        # ---- the thing this script is for ------------------------------
        by_name = defaultdict(list)
        for uid, m in members.items():
            by_name[(m.get("name") or "").strip().lower()].append(uid)
        dupe_names = {n: u for n, u in by_name.items() if n and len(u) > 1}

        # A uid that owns nothing at all is the other half of a split
        # person even when the two typed different display names.
        empty = [uid for uid in members
                 if not picks.get(uid) and uid not in tbs]

        print()
        if not dupe_names and not empty:
            print("  No duplicate accounts, and every member has entered something.")
            continue

        trouble += 1
        if empty and not dupe_names:
            print(f"  {len(empty)} member(s) have no picks and no tiebreaker this week.")
            print("  That is normal early in a week. It is only suspicious if one of")
            print("  them is somebody who tells you they HAVE entered — that is the")
            print("  signature of a second account.\n")
            for uid in empty:
                print(f"       {members[uid].get('name') or '(no name)':<22}{uid}")
        for name, uids in dupe_names.items():
            print(f"  !! {len(uids)} accounts share the name '{name}':")
            for uid in uids:
                tb = tbs.get(uid)
                tz = (roster.get(uid) or {}).get("tz") or "?"
                print(f"       {uid}")
                print(f"         picks this week: {picks.get(uid,0):<4}"
                      f"tiebreak: {tb['total'] if tb else 'none':<6}timezone: {tz}")
            print()
            print("     The uid is derived from the email address and nothing else,")
            print("     so two uids means two ADDRESSES. This is one person who has")
            print("     signed in with a different address on a different device, or")
            print("     mistyped one once. The app cannot tell they are the same")
            print("     human, and everything they enter goes to whichever account")
            print("     they happen to be signed in as.")
            print()
            print("     To find out which is which, ask them for both addresses and")
            print("     run:  python scripts/check_accounts.py --season "
                  f"{a.season} --email first@x.com --email second@y.com")

        if dupe_names:
            print("""
  WHAT TO DO, and nothing here does it for you.

  Decide which uid is the real one — normally the one with picks this
  week, or the email the person actually reads. Then either:

    a) Ask them to sign out and back in with the RIGHT address, and
       re-enter this week's picks under it. Simplest, and it is honest:
       nothing is moved behind anyone's back.

    b) Leave both until the week is scored, then remove the empty one.
       Deleting a membership mid-week changes a live pool, so it is not
       something to do in a hurry or from a script.

  Do not merge the pick documents by hand. Ranks must stay a clean set
  within one uid, and stitching two half-sheets together is exactly how a
  duplicate rank gets created — which costs that player confidence
  scoring for the whole week (see score_week.py).""")

    print()
    return 1 if trouble else 0


if __name__ == "__main__":
    sys.exit(main())
