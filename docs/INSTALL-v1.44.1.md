# v1.44.1 install: the "rival did not save" fix, and the rival card

One deploy: git push. No rules, no wrangler.

## What it fixes

After v1.44.0 a phone could show the new screens while still running the
old copy of the file that saves to the database, so + Rival said "That
rival did not save". The page now always loads the save file from its
own release, so the two can never be out of step. If one ever were, the
app quietly reloads once instead of showing an error.

Also, from Lee's screenshots of the live rival card:

- The two season totals sit level, each box labelled on two lines, in
  the red CONF style.
- Weeks you won sit on your side in green, weeks they won on their side
  in red, ties on a line underneath.
- Long names no longer push the big record numbers out of line.
- With two rivals: the Picks bar still opens the first, and a sideways
  swipe on the card (or a tap on its dots) shows the second.

## Files

    index.html
    sw.js
    DESIGN-DECISIONS.md
    docs/INSTALL-v1.44.1.md
    scripts/test/v44.ui.test.mjs
    scripts/test/app-serve.mjs
    scripts/test/picks-audit.mjs
    scripts/test/mutate.mjs
    scripts/test/regress.ui.test.mjs
    scripts/test/README.md
    scripts/member_fields.py   (read-only checker, added earlier today)

## Steps

In your poolsheet folder:

    git add -A
    git status

Check nothing called serviceAccount.json, .env, .dev.vars or backups/ is
listed. Then:

    git commit -m "v1.44.1 page and data file always match"
    git push

## Check

1. Open the app. It reloads itself into the new version.
2. Settings reads v1.44.1.
3. Standings, + Rival, Pick my rival, tap + Rival on a player: it turns
   blue with a check.
