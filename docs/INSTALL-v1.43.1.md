# Installing v1.43.1

**Updates reach every phone. App only, one `git push`. No rules deploy, no
wrangler.**

## What was wrong

A player's iPhone kept opening an old copy of the app (about v1.41) through
several full closes, while Settings said v1.43.0. Two things:

1. iPhones can leave a downloaded update parked and never switch to it.
2. Settings showed the version the phone had downloaded, not the one on
   screen.

## What changes

- A new version takes over as soon as it downloads. If you are using the
  app at that moment, the "new version is ready" banner shows and it
  switches the next time you leave the app or reopen it, so nobody is
  reloaded mid-pick.
- New versions install fresh files from the server, never an old copy the
  phone kept.
- The page knows its own version. If it finds a newer one is ready, it
  reloads once by itself (never in a loop).
- Settings shows the version actually on screen, and "Update now" when a
  newer one is ready.

**Phones already stuck on an old copy pick this up on their own**: the next
time they open the app, the new update file takes over and reloads them.

## What does NOT change

Scoring, picks, the bar, the Grid, Standings, sign-in, the worker, the
database.

# Install

```
cd C:\Users\ancon\Downloads\poolsheet
```

```
git add -A
```

```
git commit -m "v1.43.1: updates reach every phone, self-heal stale pages"
```

```
git push
```

```
curl -s https://nflweeklypickem.com/sw.js | findstr VERSION
```

It must read `const VERSION = 'v1.43.1';`

# Check your friend's phone afterwards

1. Open the app, then close it fully, then open it again.
2. The cards should show records under the team boxes and the rank in a
   circle in the middle.
3. Settings reads `v1.43.1`.

If it is still old after two opens: delete the Home Screen icon, open
nflweeklypickem.com in Safari, Share, Add to Home Screen, and sign in again
with the emailed code. Picks are saved on the server and will all be there.

# Rolling back

```
git revert --no-edit HEAD
```

```
git push
```

# Verified

1987 checks, 0 failed, on 10 Oct 2026. New: the worker takes over on
install, installs fresh, refreshes pages against the server, and its
version equals the page's; a page older than its worker reloads itself
exactly once; an up-to-date page never reloads; Settings shows the version
on screen. Six mutations, every one caught (three in sw.js run by hand,
three in index.html through the runner, 106 to 108).
