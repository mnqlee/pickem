# Installing v1.42.2

**One fix: "Tap to stake points" is the right size again. App only, one
`git push`. No rules deploy, no wrangler.**

When a team was picked but not ranked yet, its bar came out too tall, set
in from the left, and ran past the card's right edge. It now matches the
ranked bar exactly: 44px, full width, with its dashed red line. Nothing
about picks, ranks, scoring or saving changes.

The cause: the bar's class name, "empty", is also the app's style for its
blank-page messages, and that style leaked onto the bar. This was already
there before v1.41.

# Install

```
cd C:\Users\ancon\Downloads\poolsheet
```

```
git add -A
```

```
git commit -m "v1.42.2: unranked stake bar is the right size"
```

```
git push
```

```
curl -s https://nflweeklypickem.com/sw.js | findstr VERSION
```

It must read `const VERSION = 'v1.42.2';`

# Rolling back

```
git revert --no-edit HEAD
```

```
git push
```

# Verified

New check in week5.ui.test.mjs measures the unranked bar: 44px, edge to
edge, square corners. With the old style put back it fails reporting
62px, inset 14px, 14px past the edge, 12px corners. Mutation 96.
