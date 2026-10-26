# Removing a player

Run these from your poolsheet folder, one at a time. Do it when no game is
being played.

## 1. See who has stopped playing

```
cd C:\Users\ancon\Downloads\poolsheet
```

```
python scripts/remove_member.py --season 2026 --list
```

Players are listed least recent first, with the date of their last saved
pick, the weeks they picked, and their uid (the long `u_...` code).

## 2. Check one player (changes nothing)

```
python scripts/remove_member.py --season 2026 --uid u_PASTE_THEIR_UID
```

It prints everything it would remove: member record, picks, tiebreakers,
standings row and reminder entry.

## 3. Remove them

```
python scripts/remove_member.py --season 2026 --uid u_PASTE_THEIR_UID --delete
```

Type `DELETE` when asked. For several at once, repeat `--uid` for each one.

- A backup is saved in the `backups` folder first, and nothing is deleted
  if it cannot be saved. That folder is never pushed to GitHub.
- It will not remove you (the pool owner).
- It will not run while a game is being played.
- Their row leaves the Season table. Past week winners are not changed.

## 4. Undo, if you need to

The removal prints the exact command, for example:

```
python scripts/remove_member.py --season 2026 --restore "backups\removed-u_....json"
```

## Good to know

If a removed player opens the app again on a phone that is still signed
in, they come back as a new, empty player. Their old picks and points stay
gone unless you restore them.

No `git push` is needed for any of this. It changes the database directly.
