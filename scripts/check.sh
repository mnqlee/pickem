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
grep -q 'firebase-adminsdk' .gitignore && ok "the console's own key filename is ignored too" \
  || no "*firebase-adminsdk*.json NOT ignored — that is the name Firebase gives you"
grep -q 'dev.vars' .gitignore && ok ".dev.vars is ignored (SA_JSON, RESEND_KEY, ADMIN_KEY)" \
  || no ".dev.vars NOT ignored — one 'git add -A' publishes every Worker secret"

# Ask git, don't guess a filename. This used to check one tidy name and
# would print "service account not in git" while the real key — which
# Firebase names pickem-c0d06-firebase-adminsdk-XXXXX-YYYY.json — sat
# staged beside it.
leaked=$(git ls-files | grep -Ei 'serviceaccount|adminsdk|\.pem$|dev\.vars|(^|/)\.env' || true)
[ -z "$leaked" ] && ok "no credential-shaped file is tracked by git" \
  || no "TRACKED BY GIT: $(echo "$leaked" | tr '\n' ' ')— remove before pushing"

echo
echo "Deploy hygiene"
# sw.js calls this "the difference between updates working and not
# working" and nothing checked it. Compare against the last COMMITTED
# version, which is what is actually live.
cur=$(grep -o "VERSION *= *'[^']*'" sw.js | head -1)
prev=$(git show HEAD:sw.js 2>/dev/null | grep -o "VERSION *= *'[^']*'" | head -1)
if [ -z "$prev" ]; then
  ok "sw.js $cur (no previous commit to compare against)"
elif [ "$cur" != "$prev" ]; then
  ok "sw.js VERSION bumped: $prev -> $cur"
elif git diff --quiet HEAD -- sw.js index.html firebase-init.js 2>/dev/null; then
  ok "sw.js VERSION unchanged, and neither is the app"
else
  no "app files changed but sw.js VERSION is still $cur — bump it"
fi

echo
[ $fail -eq 0 ] && echo "Ready to deploy." || echo "Fix the above first."
exit $fail
