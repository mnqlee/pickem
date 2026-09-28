/* AUDIT: every design choice Lee made, checked against the built file.

   This exists because I shipped the wrong variant of the final strip —
   N3 instead of Q2 — from a summary that had lost the label. The
   mockups in docs/mockups/ are the record of WHAT was chosen; this is
   the check that the build still matches them.

   Each row names the mockup sheet, the chosen option, and a test that
   is specific enough to fail if a different option from the same sheet
   were built instead. "Is there green on the card" is not such a test.

   Run: node picks-audit.mjs
*/
import fs from 'node:fs';

const APP = fs.readFileSync(new URL('../../index.html', import.meta.url).pathname, 'utf8');

/* COMMENTS ARE NOT CODE, and a whole-file substring search cannot tell
   the difference. Two checks first reported MISS against my own prose:
   one on the phrase "all locked" inside a comment explaining why that
   phrase is gone, and one on a letter-spacing value belonging to the
   boot splash. Strip the comments, and scope each check to the rule or
   the function it is really about. */
const CODE = APP
  .replace(/\/\*[\s\S]*?\*\//g, ' ')      // block comments, CSS and JS
  .replace(/^\s*\/\/.*$/gm, ' ')          // line comments
  .replace(/<!--[\s\S]*?-->/g, ' ');       // HTML comments

const has = (...xs) => xs.every(x => CODE.includes(x));
const lacks = (...xs) => xs.every(x => !CODE.includes(x));
/* The body of one CSS rule, so "does .wklab use 9px" cannot be answered
   by a 9px belonging to something else. */
const rule = sel => {
  const i = CODE.indexOf(sel + '{');
  if (i < 0) return '';
  return CODE.slice(i, CODE.indexOf('}', i) + 1);
};
const inRule = (sel, ...xs) => { const r = rule(sel); return !!r && xs.every(x => r.includes(x)); };
const notInRule = (sel, ...xs) => { const r = rule(sel); return !!r && xs.every(x => !r.includes(x)); };

const CHECKS = [
  ['C1', 'header: brand left, clock right — unchanged',
   () => has('<div class="brandrow">', '<span class="b1">Weekly NFL</span>') &&
         // C2/C3 would have centred it
         lacks('.brand{text-align:center')],

  ['G4', 'tabs above the week row, label centred between them',
   () => {
     const tabs = APP.indexOf('<div class="tabs"');
     const lab  = APP.indexOf('<div class="wklab">');
     const wks  = APP.indexOf('<div class="weeks" id="weeks">');
     // G1/G2/G3 keep weeks first; G4 is tabs -> label -> weeks
     return tabs > 0 && lab > tabs && wks > lab;
   }],

  ['U3', 'week label 9px / 800 / .2em, padding 4px 0 5px, centred, singular',
   () => inRule('.wklab', 'font-size:9px', 'font-weight:800',
                'letter-spacing:.2em', 'padding:4px 0 5px', 'text-align:center') &&
         has('>NFL Week<') &&
         // U1 8.5px, U2 8.75px, U4 .22em, T1 9.5px, T2 8.5px; G7 was plural
         notInRule('.wklab', '8.5px', '8.75px', '.22em', '9.5px') &&
         lacks('>NFL Weeks<')],

  ['P1', 'live row: dot + ESPN clock left, IN PROGRESS right, both .cd.live',
   () => has('class="cd live lefted"', '.meta .cd.lefted{margin-left:0}',
             '.meta .cd.nodot::before{display:none}',
             ".meta .cd.live::before{content:''") &&
         // the word LIVE was dropped between M/L and P1
         lacks('lefted">Live ', 'class="lv"')],

  /* P4 IS A BRANCH, NOT A FALLBACK STRING. It was `liveClock(g)||fT(...)`
     inside the live-clock span, so the kickoff time inherited `cd live
     lefted` — green, pulsing dot — and read as a running clock. And
     because the right-hand chip carries `nodot` precisely when the
     clock owns the dot, the decision has to be made once and read
     twice. Hence `lc`. */
  ['P4', 'no ESPN string yet: the slot falls back to the kickoff time',
   () => has('const lc=(L&&!isFinal(g))?liveClock(g):null;',
             '? `<span class="cd live lefted">${esc(lc)}</span>`',
             '`<span class="mono">${fT(g.show)}</span>`',
             "lc?' nodot':''") &&
         lacks('liveClock(g)||fT(g.show)')],

  ['P4 dot', 'a live game keeps exactly one pulsing dot, clock or not',
   () => {
     // the left slot has the dot only when it is a clock; otherwise the
     // right chip keeps it, because cdClass() returns 'live' there.
     const src = CODE.slice(CODE.indexOf('const lc=(L&&!isFinal(g))'));
     return /cdClass\(g\.kick-Date\.now\(\),isFinal\(g\)\)\}\$\{\s*lc\?' nodot':''\}/.test(src);
   }],

  ['ESPN final', 'liveClock refuses ESPN\'s own "Final" before our server writes it',
   () => has("if(/\\b(final|postponed|canceled|cancelled|suspended|delayed|forfeit)\\b/i.test(s))")],

  ['live ceiling', '"N games live" is clamped to the ESPN poll window',
   () => has('const unfin=wkGames.filter(g=>isLive(g)&&!isFinal(g))',
             'const playing=unfin.filter(g=>Date.now()-g.kick<LIVE_MAX).length',
             'cTxt=`Week ${state.week} · pending`') &&
         lacks('const playing=wkGames.filter(g=>isLive(g)&&!isFinal(g)).length')],

  ['tie header', 'the Tie column has the same three states as a game column',
   () => has("const s=TB.final?['final','Total']",
             ":TB.sealed?['open','Open']:['live','Live']") &&
         lacks("<div class=\"st ${TB.final?'final':'live'}\">")],

  ['me second', 'your own row keeps the me tint when you come runner-up',
   () => has('.row.me.second{background:linear-gradient(90deg,rgba(185,193,203,.13),rgba(200,52,42,.08))}')],

  ['P5', "ESPN's own wording passes through, only quarter+clock gets a middot",
   () => has("(?:st|nd|rd|th)|OT", "'$1 · $2'")],

  ['S2', 'network and line centred between the two ends, via flex margins',
   () => has('.meta>:first-child{margin-right:auto}', '.meta .cd{margin-left:auto') &&
         // S3 was position:absolute centring, which overlapped the clock
         lacks('.meta .net{position:absolute')],

  ['R2', 'losing side greys out but its badge keeps the team colour',
   () => has('.side.lost{flex-grow:.94;background:var(--paper-2)') &&
         lacks('.side.lost .mark{filter:grayscale')],

  /* Q2 IS SUPERSEDED, NOT REVERTED, and this check is inverted to say
     so. Q2 filled the whole bottom strip with --hit or --stamp and
     turned every letter white. It was chosen from a rendered sheet and
     it worked; it is gone because the result it reported now has a
     better home — the W3 pill in the result bar. What must NOT come
     back is a coloured lock band, because the band is live-only now and
     a fill on it would be reporting a result on a game still being
     played. And N3, the inset perimeter that was shown beside Q2 and
     rejected, must not reappear either. */
  ['Q2 retired', 'the lock band is live-only and can no longer be coloured',
   () => lacks('.lockband.won', '.lockband.lost',
               'bandCls', 'won-pts') &&
         // the one rule on that strip that still has a job
         has('.lockband .miss{color:#E0645A}')],

  ['W3 pill', 'the final card says WIN / LOSS in a slanted pill',
   () => has(".sb-word{height:26px", 'transform:rotate(-7deg)}',
             '.sb-word.w{border-color:var(--hit);color:var(--hit)}',
             '.sb-word.l,.sb-word.none{border-color:var(--sink);color:var(--sink)}',
             '.sb-word.tie{border-color:var(--ink-faint)') &&
         // W4 was the unslanted pill; W1/W2 were the single letter
         lacks('.sb-word.flat', ">W</span></span></div>")],

  ['paper red', 'the losing line uses the measured paper-side red, not --stamp',
   () => has('.resbar{--sink:#BE2F26}',
             '.sb-l.res.l,.sb-l.res.none{color:var(--sink)}',
             '.sb-pts.l,.sb-pts.none{color:var(--sink)}')],

  ['Z1 head', 'a final card is headed FINAL and the score, centred',
   () => has('.meta.fmeta{justify-content:center}',
             '.meta.fmeta>:first-child{margin-right:0}',
             '<div class="meta fmeta"><span class="fin mono"><b>Final</b>') &&
         // Z2 was a tick, Z3 a dot, Z4 the winner's code in team colour
         lacks('.meta .ftick', '.meta .fdot', '.meta .fwin')],

  ['Unstaked', 'a pick with no rank says so, and scores its one point',
   () => has("${w?`Rank ${w}`:'Unstaked'}", '`+${ptsLbl(pay(w,N))}`') &&
         // the old form computed the same number by a longer road
         lacks('ptsLbl(w?pts:1)')],

  ['W1 sub-line', "the narrow side's figure sits under its own sliver",
   () => has('.cons-sub.subflex{display:flex', 'justify-content:space-between',
             'const note=`<span class="psmall"><i class="pchip"',
             'small[0]===g.a ? note+cnt : cnt+note') &&
         has('.pchip{width:9px;height:9px', 'box-shadow:inset 0 0 0 1px rgba(20,22,26,.30)') &&
         // W2 tinted the words, which measured 3.51:1 on the Chargers
         lacks('.psmall{color:', 'style="color:${TEAM(')],

  ['true colour', 'a locked card is not desaturated wholesale',
   () => lacks('.card.locked .match{filter:saturate')],

  ['winner', 'once final the colour follows the team that won',
   () => has('const litA=isFinal(g)?(R?R===g.a:null):(p?p.winner===g.a:null)')],

  /* The sub-line is on EVERY card, which is the decision here: it used
     to appear only on lopsided games, so the pool block grew a fourth
     line on some cards and not others and no two games looked alike.
     What it CARRIES changed with W1 — the narrow side's figure is now a
     chip pinned to that side rather than plain text at the left — so
     the check is that both shapes exist and that neither is conditional
     on the split. */
  ['pool sub-line', 'on every card, and it carries the narrow side either way',
   () => has('<div class="cons-sub mono">${cnt}</div>',
             '<div class="cons-sub mono subflex">',
             "const small=c.pa>0&&c.pa<22 ? [g.a,c.pa] : c.ph>0&&c.ph<22 ? [g.h,c.ph] : null") &&
         lacks("${(c.pa<22||c.ph<22)?`<div class=\"cons-sub")],

  ['1 PT', 'one point is singular, everywhere',
   () => has("const ptsLbl=n=>`${n} ${Math.abs(n)===1?'pt':'pts'}`") &&
         lacks('} pts</span></span></button>')],

  ['TB column', 'tiebreaker is a column, 50px, not a th.gm, colour-only .hm',
   () => has('<th class="tbcol">', 'th.gm,th.tbcol{min-width:50px;width:50px',
             'th.tbcol .hm{color:var(--lock)}') &&
         lacks('class="gm tbcol"', 'th.tbcol .hm{color:var(--lock);font-size')],

  ['TB cells', 'number only — no +/- deltas — and every tied-closest is green',
   () => has('const bd=Math.min(...pool.map(r=>Math.abs(r.guess-actual)))',
             "r.guess===T.actual?'Exact':'Closest'") &&
         lacks('<i>&minus;${T.actual-r.guess}</i>')],

  /* THIS CHECK IS INVERTED ON PURPOSE. An earlier build labelled a
     tiebreaker cell WINNER when the top two rows were level on points.
     That was built on a false reading of score_week.py: apply_tiebreak
     sorts (-r["total"], key) where `total` is the SEASON total, so the
     guess only ever reorders the season — and the weekly award is
     explicitly shared ("Ties share a place"). The cell may say Exact or
     Closest and nothing else. */
  ['TB no winner', 'no cell claims to have WON the week on a guess',
   () => lacks('tbDecided', 'tbWinner', "'Winner'", 'pl===winner')],

  ['week honours', 'shared by points value, gated on best > 0, never by row',
   () => has('const best=Math.max(...rows.map(r=>r.pts))',
             'if(!(best>0))return null',
             'const lower=rows.filter(r=>r.pts<best).map(r=>r.pts)',
             'sndPts>0?new Set(rows.filter(r=>r.pts===sndPts).map(r=>r.p)):new Set()') &&
         // the row-position version, which crowned one of two co-winners
         lacks("view==='week'&&weekDone&&i<2", "weekDone&&i===1")],

  ['TB overshoot', 'the closest overshoot wins and is not struck through',
   () => has('const over=r.guess>T.actual&&!best')],

  ['TB strip', 'the 28-row panel is gone, replaced by one line',
   () => has('class="tbstrip"') && lacks('class="tbpanel"', 'class="tbrow ')],

  ['S3 banners', 'gold WEEK n WINNER, silver RUNNER UP, silver row, gated on done',
   () => has('<span class="leadtag">Week ${wk} winner</span>',
             '<span class="leadtag silver">Runner up</span>',
             '.leadtag.silver{background:#B9C1CB', '.row.second{background:linear-gradient',
             'const weekDone=wkGs.length>0&&wkGs.every(isFinal)')],

  ['week seals', 'This Week carries the two week seals, with no count',
   () => has("const won=isWin(r.p), snd=isSnd(r.p)",
             "const wSeal=won?badgeSVG([{kind:'1st',n:1}])",
             "snd?badgeSVG([{kind:'2nd',n:1}])") &&
         lacks("badgeSVG([{kind:i===0?'1st':'2nd',n:1}])")],

  ['H3 clock', 'three states: gold countdown, green N games live, grey tick Final',
   () => has("cTxt=`${playing} game${playing===1?'':'s'} live`",
             'cTxt=`Week ${state.week} · Final`',
             '.clock.done .dot{display:none}', '.clock.done .tick{display:block') &&
         // the phrase itself, but only where it could still be rendered
         !/cTxt\s*=\s*`[^`]*all locked/.test(CODE)],

  ['leader cells', "the leader's sticky cells are opaque",
   () => has('tbody tr.lead td.pl,tbody tr.lead td.tot{background:#211D16}')],

  /* THE WORD MOVED. It was the `.cd.done` chip at the right of the meta
     row; it is the <b> in the centred head now. The token is the same
     --ink-mute and for the same measured reason (--chalk over
     --paper-2 is 1.09:1), and the `.meta` half of the old selector is
     deleted because nothing on a card can match it any more. */
  ['FINAL label', 'readable on the light card, not the dark-shell token',
   () => has('.meta .fin b{font-weight:800', 'color:var(--ink-mute)}',
             '.tbmeta .cd.done{color:var(--ink-mute)}') &&
         lacks('.meta .cd.done')],

  ['live no-pick', 'the no-pick line stays red on the dark strip, at 4.91:1',
   () => has('.lockband .miss{color:#E0645A}')],

  /* THE VERSION CARD, and the one thing that must never come back: a
     version constant in this file. sw.js holds the only one, the page
     asks the worker for it, and `lacks` is what keeps a well-meaning
     shortcut from reintroducing a second number that can disagree with
     the first. Measured end to end in regress case 60. */
  ['version card', 'last in Settings, number read from the worker, not from here',
   () => has('<div class="opt" id="verOpt">', 'id="verNum"', 'id="verBtn"',
             'PS.swVersion()', 'PS.swCheck()', 'PS.swActivate()',
             '.vbtn.now{background:var(--live)') &&
         // no second version constant, in any of the shapes somebody would reach for
         !/const\s+(APP_)?VERSION\s*=/.test(CODE) &&
         !/APP_VERSION/.test(CODE)],

  /* WHERE THE PLATFORM CALLS LIVE. The first version of this check
     claimed "exactly one SKIP_WAITING" and was simply wrong: there are
     two call sites and both are right, the banner's and the card's.
     What actually matters is that neither of them is in index.html.
     Every navigator.serviceWorker call belongs in firebase-init.js with
     the rest of the worker plumbing, which is also what lets the test
     stub drive the card through all four of its states. */
  /* WHITE ON EVERY CLUB, and the device that pays for it. onColor() is
     deleted, not merely unused: while it existed, one line reinstating
     the call would have brought the black writing back with no test
     failing anywhere near the place it was reintroduced. */
  ['white ink', 'white on all 32: the ring, the slightly faded city, the strip',
   () => has('.side.won{flex-grow:1.12;color:#fff}',
             '.side.won .mark{box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.92)}',
             '.side.won .city{opacity:.92}',
             'const aBg=litA?`style="background:${TEAM(g.a)[2]}"`') &&
         lacks('function onColor', 'onColor(TEAM',
               // the badge keeps its second colour: removing it was my
               // misreading of "no black writing", and Lee reversed it
               '.side.won .mark::after{display:none}')],

  /* WHO HAS THE BALL. Four decisions, each chosen from a rendered
     sheet and each a separate way to get it wrong: the football at all,
     the mirror onto the gutter side, the two different gaps, and the
     fact that it can only appear on a game being played. */
  ['possession', 'the football, mirrored, 3 unselected and 4 selected',
   () => has('const ESPN_BALL=Object.create(null)',
             'const ballOf=g=>(!isLive(g)||isFinal(g))?null:',
             /* justify-content is part of the rule, not decoration: without
                it a reversed row packs to the gutter and the away score
                slides right of its own panel whenever there is no ball. */
             '.side.l .scr{flex-direction:row-reverse;justify-content:flex-end}',
             '.side.lost .scr{gap:36px}',
             '.side.won  .scr{gap:48px}',
             '<svg class="ball"',
             'stroke="currentColor"') &&
         /* NOT A FILL, which is what made the laces vanish on white,
            and NOT an emoji, which cannot take the panel's colour. */
         lacks('fill="currentColor"', '\u{1F3C8}')],

  /* HOW OFTEN A WATCHED GAME IS REFRESHED. One request carries the
     score, the clock and possession, so this single number is the whole
     live-update rate. */
  ['live rate', 'a watched game refreshes every 30 seconds',
   () => has('const ESPN_EVERY=30000', '},ESPN_EVERY);') &&
         /* AND IT MUST STAY ABOVE THE FLOOR. Below ESPN_FLOOR the floor
            swallows every other tick, so the real rate is the floor,
            arriving irregularly, while the constant claims otherwise. A
            literal 60000 back in the setInterval is the other way this
            silently reverts. */
         lacks('},60000);')],

  /* UNSEAL ON THE DATA, NOT ON THE CLOCK. `isLive(g)` alone flips at
     kickoff, before the reveal query can return a pick, and the cell's
     answer to "no pick" is the DID NOT PICK dash. That told a whole
     pool they had all missed a game. */
  ['reveal honesty', 'a live cell waits for the bound before it unseals',
   () => has('const shown=r.p===ME||(isLive(g)&&g.kick<=revealBound)') &&
         /* The margin the app schedules on has to be the one queries
            actually use, not the widened fallback. */
         has('P.REVEAL_SKEW_MS')],

  ['version routes', 'the page makes no worker calls of its own',
   () => lacks("postMessage('SKIP_WAITING')", 'navigator.serviceWorker.register',
               'caches.keys()', 'new MessageChannel') &&
         (() => {
           const FB = fs.readFileSync(
             new URL('../../firebase-init.js', import.meta.url).pathname, 'utf8');
           const posts = (FB.match(/postMessage\('SKIP_WAITING'\)/g) || []).length;
           // one for the banner (swAnnounce), one for the card (swActivate)
           return posts === 2 && /function swVersion/.test(FB)
             && /function swCheck/.test(FB) && /function swActivate/.test(FB)
             && /swVersion, swCheck, swActivate/.test(FB);
         })()],
];

let bad = 0;
for (const [tag, what, fn] of CHECKS) {
  let ok = false;
  try { ok = fn(); } catch (_) { ok = false; }
  if (!ok) bad++;
  console.log(`${ok ? '  ok  ' : ' MISS '} ${tag.padEnd(14)} ${what}`);
}
console.log(`\n${CHECKS.length - bad} of ${CHECKS.length} design choices present`);
process.exit(bad ? 1 : 0);
