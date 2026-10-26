# v1.44.0 install: Red zone, Games box tiles, Rivals, Weekly Wrap

Two deploys, in this order. No wrangler this time.

## What changed

- **Red zone** on live Picks cards: solid red ring, a still "Red zone" tag
  centred on the top line, and the football flashing beside the score of
  the team with the ball (white on your own red panel).
- **No spread** on a card once its game has kicked off.
- **Live pulls every 15 seconds** (was 30) while a game is on screen.
- **Games box** (bottom right): live and final games as tiles, three
  across. Tap one to jump to its pick card, outlined in gold.
- **Every tab opens at the top.**
- **Rivals**: a small + Rival button beside Season, Rival and Hunting you
  tags in Standings, a rival card with the season record, and a line on
  Picks saying if you are ahead of your rivals right now.
- **Weekly Wrap**: the newspaper page, once per week on the first open
  after Monday night, then any time from the Week box. Share sends it
  as a picture.

## Files

    index.html
    firebase-init.js
    firestore.rules
    sw.js
    DESIGN-DECISIONS.md
    docs/INSTALL-v1.44.0.md
    scripts/test/v44.ui.test.mjs        (new, 118 checks)
    scripts/test/app-serve.mjs
    scripts/test/picks-audit.mjs
    scripts/test/mutate.mjs
    scripts/test/sw.push.test.mjs
    scripts/test/README.md

## Step 1: the database rules (FIRST)

Open PowerShell in `C:\Users\ancon\Downloads\poolsheet` and run:

    npx firebase-tools deploy --only firestore:rules --project pickem-c0d06

Wait for `Deploy complete!`

Why first: the new rule only *allows* one extra field (`rivals`) on your
own membership record. It changes nothing for the app that is live now.
If the app went first, every Rival tap would be refused until the rules
caught up (the app would undo the tap and say it did not save).

## Step 2: the app

    git add -A
    git status

Check the list. It should show the files above and nothing called
`serviceAccount.json`, `.dev.vars`, `.env` or anything in `backups/`.
If one of those appears, stop and tell Claude.

    git commit -m "v1.44.0 Red zone, Games box tiles, Rivals, Weekly Wrap"
    git push

Cloudflare Pages picks it up in about a minute.

## Step 3: check it is live

1. Open the app. Within a launch or two the green "update" banner
   appears, or the app reloads itself. Settings should read **v1.44.0**.
2. Standings: a small **+ RIVAL** button sits to the right of Season.
3. Tap it. "How rivals work" opens with **Pick my rival** at the bottom.
4. Bottom-right **Games** box: live and final games show as tiles.

The Weekly Wrap first appears on the first open after this week's Monday
night game is final.

## If something is wrong

Undo the app only (the rules can stay, they are harmless on their own):

    git revert HEAD
    git push

## Notes

- The "Dex is hunting you" heads up is shown inside the app the next time
  that player opens it. It is not a push notification.
- A rival's record is the whole season, every finished week, whenever
  you picked them.
- Removing a player with `remove_member.py` needs nothing extra: anyone
  who had them as a rival simply stops seeing them.
