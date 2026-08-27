#!/usr/bin/env bash
# Checks every placeholder is filled in before you deploy.
#   bash scripts/check.sh
set -u
cd "$(dirname "$0")/.."
fail=0
ok(){ printf '  \033[32m✓\033[0m %s\n' "$1"; }
no(){ printf '  \033[31m✗\033[0m %s\n' "$1"; fail=1; }

echo
echo "Firebase config"
grep -q 'PASTE_ME' firebase-init.js \
  && no "firebase-init.js still has PASTE_ME — BUILD.md Part 2.4" \
  || ok "firebaseConfig filled in"
grep -q 'VAPID_KEY = "PASTE_ME"' firebase-init.js \
  && no "VAPID_KEY not set — BUILD.md Part 9.2" \
  || ok "VAPID key set"

echo
echo "Worker"
grep -q 'REPLACE_ME' worker/wrangler.toml \
  && no "wrangler.toml has REPLACE_ME KV ids — BUILD.md Part 6.2" \
  || ok "KV namespace ids set"
grep -q 'yourdomain.com' worker/wrangler.toml \
  && no "wrangler.toml still says yourdomain.com — BUILD.md Part 6.1" \
  || ok "domain set in wrangler.toml"

echo
echo "App"
grep -q 'const DEMO = true' index.html \
  && no "index.html is still in DEMO mode — BUILD.md Part 10" \
  || ok "DEMO is off"

echo
echo "Season id must match in three places"
A=$(grep -o "const SEASON = '[^']*'" index.html | head -1 | cut -d"'" -f2)
B=$(grep -o 'const SEASON = "[^"]*"' firebase-init.js | head -1 | cut -d'"' -f2)
C=$(grep -o 'SEASON = "[^"]*"' worker/wrangler-live.toml | head -1 | cut -d'"' -f2)
if [ "$A" = "$B" ] && [ "$B" = "$C" ]; then ok "SEASON = $A everywhere"
else no "SEASON mismatch: app=$A init=$B worker=$C — the worker will poll the wrong feed"; fi

echo
echo "PWA"
[ -f icons/icon-192.png ] && ok "icon-192.png" || no "icons/icon-192.png missing — Part 4.3"
[ -f icons/icon-512.png ] && ok "icon-512.png" || no "icons/icon-512.png missing — Part 4.3"
[ -f icons/icon-maskable-512.png ] && ok "maskable icon" || no "icons/icon-maskable-512.png missing"
grep -q 'yourdomain' manifest.json 2>/dev/null && no "manifest.json still has a placeholder" || ok "manifest clean"
grep -q 'rel="manifest"' index.html && ok "manifest linked from index.html" \
  || no "index.html has no <link rel=manifest> — it will not install"
grep -q 'apple-touch-icon' index.html && ok "apple-touch-icon set" \
  || no "no apple-touch-icon — iOS will use a screenshot"
grep -q 'apple-mobile-web-app-capable' index.html && ok "iOS standalone mode" \
  || no "missing apple-mobile-web-app-capable — opens in Safari chrome"

echo
echo "Safety"
grep -q 'serviceAccount.json' .gitignore && ok "serviceAccount.json is gitignored" \
  || no "serviceAccount.json NOT in .gitignore — never commit it"
git ls-files --error-unmatch serviceAccount.json >/dev/null 2>&1 \
  && no "serviceAccount.json IS TRACKED BY GIT. Remove it now." \
  || ok "service account not in git"

echo
[ $fail -eq 0 ] && echo "Ready to deploy." || echo "Fix the above first."
exit $fail
