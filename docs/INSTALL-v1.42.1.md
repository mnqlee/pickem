# Installing v1.42.1

**One fix: the rank circle in the middle of the card is round again.
App only, one `git push`. No rules deploy, no wrangler.**

## What was wrong

Before kickoff, the rank circle leaned to the right like an oval, and the
number inside leaned with it. The strip in the middle of the card is
slanted on purpose, and everything inside it gets straightened back. The
circle was being straightened twice, so it ended up leaning the other way.
Live and final circles were already right.

## What changes

- One line of style. The circle is round, with the same slight stamp tilt
  every rank stamp in the app has.
- Nothing about picks, ranks, scoring, locking, the Grid, Standings or
  the seals.

---

# Install

```
cd C:\Users\ancon\Downloads\poolsheet
```

```
git add -A
```

```
git commit -m "v1.42.1: rank circle is round again before kickoff"
```

```
git push
```

```
curl -s https://nflweeklypickem.com/sw.js | findstr VERSION
```

It must read `const VERSION = 'v1.42.1';`

---

# Rolling back

```
git revert --no-edit HEAD
```

```
git push
```

That puts you back on v1.42.0.

---

# Verified before shipping

**1873 checks, 0 failed**, on 6 Oct 2026. The new check multiplies every
slant and tilt from the card down to the circle and requires a pure tilt
with no lean, before kickoff, live and final. With the old line put back
it fails on every pre-kickoff circle, reporting a 9 degree lean, which is
what your screenshot showed. It is mutation 95.
