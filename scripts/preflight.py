#!/usr/bin/env python3
"""
Pre-flight check. Run this on the day you invite people, and again after
any deploy. READ-ONLY — it changes nothing, anywhere.

    python scripts/preflight.py --season 2026

It checks the things that cannot be checked from a development sandbox and
that fail SILENTLY in production:

  1. Sign-in email authentication (SPF / DKIM / DMARC). Without these the
     PIN lands in spam and an invited player simply never gets in, with
     nothing on screen to explain why. This is the single most likely
     reason a real invitation fails.
  2. The live site is serving the version you think it is.
  3. The pool exists, has members, and will score in confidence.
  4. The schedule is sane: right number of games, no game already final
     with a kickoff in the future, no duplicate matchups in a week.

Exit code 0 = clear to invite. 1 = something needs attention.

Firestore checks need serviceAccount.json (or FIREBASE_SERVICE_ACCOUNT_FILE)
and firebase_admin. If those are missing the script still runs the DNS and
site checks and tells you what it skipped.
"""

import argparse, os, re, ssl, subprocess, sys, urllib.request
from collections import Counter

DOMAIN = "nflweeklypickem.com"
OK, WARN, BAD = "  ok  ", " WARN ", " FAIL "
problems, warnings = [], []


def say(tag, msg):
    print(f"[{tag}] {msg}")
    if tag is BAD:
        problems.append(msg)
    elif tag is WARN:
        warnings.append(msg)


def dns_txt(name):
    """nslookup rather than a DNS library, so this needs nothing installed."""
    try:
        out = subprocess.run(["nslookup", "-type=TXT", name],
                             capture_output=True, text=True, timeout=20).stdout
    except Exception as e:
        return None, str(e)
    return re.findall(r'"([^"]+)"', out), None


def dns_any(name, rtype):
    try:
        out = subprocess.run(["nslookup", f"-type={rtype}", name],
                             capture_output=True, text=True, timeout=20).stdout
        return out, None
    except Exception as e:
        return "", str(e)


# ---------- 1. email authentication ----------------------------------
def check_email():
    print("\n--- Sign-in email authentication ---")

    spf, err = dns_txt(DOMAIN)
    if err:
        say(WARN, f"could not run nslookup ({err}); check DNS by hand")
        return
    if any("v=spf1" in r for r in (spf or [])):
        say(OK, "SPF record present on the root domain")
    else:
        say(BAD, "NO SPF record. Resend mail will not authenticate as your domain.")

    dmarc, _ = dns_txt("_dmarc." + DOMAIN)
    if any("v=DMARC1" in r for r in (dmarc or [])):
        say(OK, "DMARC record present")
    else:
        say(BAD, "NO DMARC record at _dmarc." + DOMAIN
                 + ". Gmail and Yahoo send unauthenticated bulk mail to spam.")

    # Resend's DKIM selector; the key itself is generated per domain.
    dk, _ = dns_txt("resend._domainkey." + DOMAIN)
    if any("p=" in r for r in (dk or [])):
        say(OK, "DKIM key published at resend._domainkey")
    else:
        say(BAD, "NO DKIM key at resend._domainkey." + DOMAIN
                 + ". See EMAIL-DNS.md — this is step one.")

    if problems:
        print("\n  >> Until these exist, expect invited players to report that the")
        print("     code never arrived. They will not think to check spam, and the")
        print("     app cannot tell them. Fix before inviting anyone. EMAIL-DNS.md")
        print("     has the exact records.")


# ---------- 2. the live site ------------------------------------------
def check_site(expect_version):
    print("\n--- The live site ---")
    ctx = ssl.create_default_context()
    for path, what in (("/", "index"), ("/sw.js", "service worker")):
        url = f"https://{DOMAIN}{path}"
        try:
            with urllib.request.urlopen(url, timeout=20, context=ctx) as r:
                body = r.read().decode("utf-8", "replace")
            say(OK, f"{what} responds {r.status} ({len(body):,} bytes)")
            if path == "/sw.js":
                m = re.search(r"const VERSION\s*=\s*'([^']+)'", body)
                live = m.group(1) if m else "?"
                if expect_version and live != expect_version:
                    say(WARN, f"service worker live is {live}, local is "
                              f"{expect_version} — deploy may still be propagating")
                else:
                    say(OK, f"service worker version {live}")
        except Exception as e:
            say(BAD, f"{what} unreachable: {e}")


def local_sw_version():
    try:
        here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        with open(os.path.join(here, "sw.js")) as f:
            m = re.search(r"const VERSION\s*=\s*'([^']+)'", f.read())
        return m.group(1) if m else None
    except Exception:
        return None


# ---------- 3 & 4. the pool and the schedule --------------------------
def check_firestore(season):
    print("\n--- Pool and schedule ---")
    try:
        import firebase_admin
        from firebase_admin import credentials, firestore
    except ImportError:
        say(WARN, "firebase_admin not installed — skipped the pool and "
                  "schedule checks (pip install firebase-admin)")
        return
    key = os.environ.get("FIREBASE_SERVICE_ACCOUNT_FILE", "serviceAccount.json")
    if not os.path.exists(key):
        say(WARN, f"{key} not found — skipped the pool and schedule checks")
        return
    try:
        firebase_admin.initialize_app(credentials.Certificate(key))
        db = firestore.client()
    except Exception as e:
        say(BAD, f"could not reach Firestore: {e}")
        return

    pools = [d for d in db.collection("pools").stream()
             if (d.to_dict() or {}).get("season") == str(season)]
    if not pools:
        say(BAD, f"no pool found for season {season}")
        return
    for p in pools:
        d = p.to_dict() or {}
        members = list(db.collection("pools").document(p.id)
                         .collection("members").stream())
        say(OK, f"pool {p.id} ({d.get('name','unnamed')}) — {len(members)} members, "
                f"join code {d.get('code') or d.get('joinCode') or '?'}")
        if not members:
            say(BAD, "the pool has NO members — even the owner needs a member doc")

        hist = d.get("scoringHistory") or []
        mode = "confidence"
        for h in sorted(hist, key=lambda h: h.get("week", 0)):
            if h.get("week", 0) <= 18:
                mode = h.get("mode", mode)
        if hist and mode != "confidence":
            say(BAD, f"scoringHistory would score {mode}, not confidence — "
                     f"there is no longer a button in the app to change it. "
                     f"See scripts/check_scoring.py")
        else:
            say(OK, "scores in confidence for the whole season")

    games = list(db.collection("seasons").document(str(season))
                   .collection("games").stream())
    if not games:
        say(BAD, f"seasons/{season}/games is EMPTY — the app cannot load")
        return
    say(OK, f"{len(games)} games imported")

    by_week, odd = {}, 0
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    dupes = Counter()
    for g in games:
        v = g.to_dict() or {}
        wk = v.get("wk")
        by_week.setdefault(wk, []).append(v)
        dupes[(wk, v.get("away"), v.get("home"))] += 1
        k = v.get("kickoff")
        if v.get("status") == "final" and hasattr(k, "timestamp"):
            kk = k if k.tzinfo else k.replace(tzinfo=timezone.utc)
            if kk > now:
                odd += 1
    bad_weeks = [w for w, gs in sorted(by_week.items()) if not (13 <= len(gs) <= 17)]
    if bad_weeks:
        say(WARN, "weeks with an unusual game count: "
                  + ", ".join(f"wk{w}={len(by_week[w])}" for w in bad_weeks))
    else:
        say(OK, "every week has a plausible number of games")

    rep = [k for k, n in dupes.items() if n > 1]
    if rep:
        say(BAD, f"{len(rep)} duplicated matchup(s), e.g. {rep[0]} — "
                 f"run scripts/find_stale_games.py")
    else:
        say(OK, "no duplicated matchups")

    if odd:
        say(WARN, f"{odd} game(s) marked final with a kickoff still in the future "
                  f"(a re-import can do this; harmless to the score, and the Grid "
                  f"header no longer miscounts it)")
    else:
        say(OK, "no game is final ahead of its own kickoff")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, default=2026)
    ap.add_argument("--skip-firestore", action="store_true")
    a = ap.parse_args()

    print("Pre-flight for " + DOMAIN)
    check_email()
    check_site(local_sw_version())
    if not a.skip_firestore:
        check_firestore(a.season)

    print("\n" + "=" * 58)
    if problems:
        print(f"{len(problems)} thing(s) to fix before inviting anyone:")
        for p in problems:
            print("  - " + p)
    if warnings:
        print(f"{len(warnings)} thing(s) worth a look:")
        for w in warnings:
            print("  - " + w)
    if not problems:
        print("No blockers found. Clear to invite.")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
