# Installing v1.40.1

**One CSS property. App only, one `git push`. No rules deploy, no
wrangler.**

## What it fixes

Your own Web Analytics found this, three days in, and it is the first
defect in this app that arrived as a measurement from other people's
phones rather than from you noticing something or a test going red.

**CLS 0.122 against `#v-picks` on 29 of 33 loads.** Not a sample. Very
nearly every launch.

Reproduced frame by frame against the real build:

| | `#weeks` | `#v-picks` |
|---|---|---|
| **40ms** | height 9px, empty | y = 140 |
| **171ms** | height 53px, filled | y = **184** |

The week strip is an empty sliver until the season loads, then it appears
at full height and **pushes the entire picks view down 44 pixels**.
Anybody reaching for a team in that moment watches the card move out from
under their thumb. On a slow connection that window is seconds rather
than milliseconds, which is why a third of your loads are also slow ones.

**The fix reserves the space**, and the number is arithmetic rather than
taste: a week button is 44px and the strip carries 9px of padding, so a
filled strip is always exactly 53px.

**Measured before and after: CLS 0.1108 to 0.0038.** The browser's own
"good" boundary is 0.1, so this moves it from the middle of the bad band
to comfortably inside the good one.

---

# Install

```
cd C:\Users\ancon\Downloads\poolsheet
```

```
git add -A
```

```
git commit -m "v1.40.1: reserve the week strip height, removing the layout shift on every launch"
```

```
git push
```

```
curl -s https://nflweeklypickem.com/sw.js | findstr VERSION
```

Must read `const VERSION = 'v1.40.1';`

**No `firebase-tools` this time.** The rules are unchanged. **No
wrangler.** The worker is unchanged.

---

# What to look for afterwards

**On your phone**, two cold starts as usual, then Settings reads
`v1.40.1`. On launch, the week strip row should be there from the first
frame, empty, rather than appearing a moment later and pushing the cards
down.

**In Web Analytics**, give it a few days. CLS should move from 88% needs
improvement toward mostly good. That is the number to watch, and it is
the first time you will have measured a fix on your own users rather than
on my word for it.

---

# Can this disturb anything

| file | existing lines changed |
|---|---|
| `index.html` | **1** (one CSS rule, one property added) |
| everything else | **0** |

It is a minimum height on a container that always ends up exactly that
tall. Nothing else in the release touches behaviour.

---

# Verified before shipping

**1488 checks across twenty-one suites, 0 failed.** Audit 43 of 43. 68
mutations all still apply.

**The new check grades the browser's own number**, not a pixel
comparison, so this test and your Cloudflare dashboard cannot disagree
about what improved. It observes real layout-shift entries during load
and asserts two things: total CLS stays in the good band, and `#v-picks`
specifically never moves.

**Mutation 66 removes the reserved height** and both assertions go red,
reporting the exact 0.1108 and the 140 to 184 jump.

---

# Rolling back

```
cd C:\Users\ancon\Downloads\poolsheet
```

```
git revert --no-edit HEAD
```

```
git push
```

Back on v1.40.0, layout shift and all. Nothing else differs.
