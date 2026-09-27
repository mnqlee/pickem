/* MUTATION TESTING FOR v1.34.0.

   A test that passes with the change reverted is a green tick that means
   nothing, and this project has shipped two of those. So: put each bug
   back, one batch at a time, and demand that the named assertions which
   are supposed to catch it actually go red — and that NOTHING ELSE does,
   which is what catches a test that is really asserting something else.

   RUN mutate-dryrun.mjs FIRST. A mutation whose find string has drifted
   reports "matched 0 times" and is silently NOT APPLIED, so the batch
   runs against unmutated code, every expected assertion stays green,
   and this harness then reports that the tests failed to catch their
   bug — the right complaint for the wrong reason, at the cost of a full
   suite run per batch. The dry run checks all of them in a second.

   Usage: node mutate-dryrun.mjs      (check every find string first)
          node mutate.mjs             (all batches, ~4 hours)
          node mutate.mjs 2           (just batch 2)
*/
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const APP = new URL('../../index.html', import.meta.url).pathname;
const ORIGINAL = fs.readFileSync(APP, 'utf8');
/* A BACKUP ON DISK, not just in memory.
   Holding the pristine copy only in ORIGINAL is fine until the process
   is killed mid-run — a shell timeout did exactly that, and left a
   mutated index.html sitting in the working tree pretending to be the
   real thing. Nothing errored; the app simply had a feature quietly
   switched off. The file below is written before the first mutation and
   removed only on a clean exit, so its presence means "the tree may be
   dirty, restore from me". */
const BACKUP = APP + '.premutation';
if (fs.existsSync(BACKUP)) {
  console.log('A previous run left a backup — restoring it first.');
  fs.copyFileSync(BACKUP, APP);
}
fs.writeFileSync(BACKUP, ORIGINAL);
const restore = () => { try { fs.writeFileSync(APP, ORIGINAL); } catch (_) {} };
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'])
  process.on(sig, () => { restore(); process.exit(130); });
process.on('uncaughtException', e => { restore(); throw e; });

/* Each mutation is [label, find, replace, [assertions that must fail]].
   The assertion strings are matched against the runner's FAILURES list. */
const MUTATIONS = [
  // ---- batch 1: the header clock ----
  [1, 'header clock: put the season-wide "all locked" fallback back',
   `  }else if(playing){
    cCls='live';
    cTxt=\`\${playing} game\${playing===1?'':'s'} live\`;
  }else if(unfin.length){
    cCls='done';
    cTxt=\`Week \${state.week} · pending\`;
  }else if(wkGames.length){
    cCls='done';
    cTxt=\`Week \${state.week} · Final\`;`,
   `  }else if(wkGames.length){
    cTxt=\`Week \${state.week} · all locked\`;`,
   ['a finished week says Final, not "all locked"', 'and drops the gold']],

  [1, 'header clock: let the dot keep pulsing on a finished week',
   `.clock.done .dot{display:none}`,
   `.clock.done .dot{display:inline-block}`,
   ['and stops pulsing: no dot at all']],

  [1, 'points label: hardcode the plural again',
   "const ptsLbl=n=>`${n} ${Math.abs(n)===1?'pt':'pts'}`;",
   "const ptsLbl=n=>`${n} pts`;",
   ['nothing on the Picks tab says "1 pts"',
    'the rank that pays one point says "1 pt"', 'and never "1 pts"']],

  [1, 'leader row: make its pinned cells translucent again',
   `tbody tr.lead td.pl,tbody tr.lead td.tot{background:#211D16}`,
   `tbody tr.lead td.pl,tbody tr.lead td.tot{background:rgba(232,184,75,.09)}`,
   ['its sticky name cell is fully opaque', 'and so is its sticky points cell']],

  // ---- batch 2: the tiebreaker column ----
  [2, 'tiebreaker: pick ONE closest player with reduce, as before',
   `    const bd=Math.min(...pool.map(r=>Math.abs(r.guess-actual)));
    best=pool.filter(r=>Math.abs(r.guess-actual)===bd).map(r=>r.p);`,
   `    best=[pool.reduce((a,b)=>Math.abs(b.guess-actual)<Math.abs(a.guess-actual)?b:a).p];`,
   ['every guess at the closest distance is green, not just the first',
    'and the count is right even when two players tie on it']],

  /* THE WRONG IDEA, PUT BACK. There is no tbDecided any more — the
     whole WINNER concept was removed, because apply_tiebreak sorts on
     the SEASON total and the weekly award is shared. This mutation
     resurrects it in the simplest form somebody would reach for, and
     the new assertions have to go red: a test that only said "no cell
     says WINNER" against code that no longer can say it would be
     asserting nothing. */
  [2, 'tiebreaker: label the closest guess WINNER again',
   `  const lab=!best?'' : \`<i>\${r.guess===T.actual?'Exact':'Closest'}</i>\`;`,
   `  const lab=!best?'' : \`<i>\${r.guess===T.actual?'Exact':'Winner'}</i>\`;`,
   ['and even so, no cell claims to have won the week',
    'every green cell says CLOSEST or EXACT and nothing else',
    'so nothing in the column claims to be the WINNER',
    'and the closest guess says CLOSEST']],

  [2, 'tiebreaker: make its header a game column again',
   `  head+=\`<th class="tbcol"><div class="aw">Tie</div>`,
   `  head+=\`<th class="gm tbcol"><div class="aw">Tie</div>`,
   ['but it is NOT counted as a game column',
    'every Grid total matches an independently computed score',
    'Grid and weekly Standings agree, and both match the oracle']],

  [2, 'tiebreaker: oversize the header total, lifting the divider',
   `th.tbcol .hm{color:var(--lock)}`,
   `th.tbcol .hm{color:var(--lock);font-size:12px;font-weight:800}`,
   ['and sits on the same line']],

  // ---- batch 3: the Grid layout and the cards ----
  [3, 'grid: bring the 28-row tiebreaker panel back',
   `.tbstrip{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;`,
   `.tbstrip{display:block;min-height:940px;`,
   ['and the table is no longer pinned at its 200px floor',
    'so more than four player rows fit on screen',
    'replaced by one strip, not a wall']],

  [3, 'cards: desaturate a locked card again',
   `.card.locked .side{pointer-events:none;cursor:default}`,
   `.card.locked .side{pointer-events:none;cursor:default}
.card.locked .match{filter:saturate(.45) brightness(.94)}`,
   ['a locked card is no longer desaturated wholesale']],

  [3, 'cards: greyscale the losing badge again',
   `.side.lost .mark{width:34px;height:34px;border-radius:9px;font-size:11px}`,
   `.side.lost .mark{filter:grayscale(1) contrast(.62);opacity:.66;width:34px;height:34px;border-radius:9px;font-size:11px}`,
   ['but the losing badge keeps its team colour']],

  [3, 'cards: let colour follow the pick rather than the winner',
   `    const litA=isFinal(g)?(R?R===g.a:null):(p?p.winner===g.a:null);
    const litH=isFinal(g)?(R?R===g.h:null):(p?p.winner===g.h:null);`,
   `    const litA=p?p.winner===g.a:null;
    const litH=p?p.winner===g.h:null;`,
   ['the lit side is the team that WON, whoever you took']],

  [3, 'cards: show the pool sub-line only on lopsided games again',
   `      if(!small)return \`<div class="cons-sub mono">\${cnt}</div>\`;`,
   `      if(!small)return '';`,
   ['every card with a pool bar has a sub-line under it']],

  [3, "cards: stop capturing ESPN's clock string",
   `        const det=c.status&&c.status.type&&c.status.type.shortDetail;
        if(det&&ESPN_CLOCK[k]!==det){ESPN_CLOCK[k]=det;changed=true;}`,
   ``,
   ["the live card shows ESPN's own clock, top left"]],

  /* ---- batches 4, 5 and 6: the week honours, ONE PER BATCH ----
     These three were in a single batch and two of them came back
     "uncaught". They were not: dropping the seals entirely also
     satisfies "so no seals yet", and never banding row two also
     satisfies "no runner-up banner either", so each mutation was
     masking the evidence for the next. Mutations that can substitute
     for one another have to be run alone. */
  [4, 'standings: award the week seals before the last whistle',
   `  const weekDone=wkGs.length>0&&wkGs.every(isFinal);`,
   `  const weekDone=wkGs.length>0&&wkGs.some(isFinal);`,
   ['so no seals yet', 'no runner-up banner either',
    'and the banner says "leader", not "winner"']],

  [5, 'standings: drop the week seals entirely',
   `    const wSeal=won?badgeSVG([{kind:'1st',n:1}])
      : snd?badgeSVG([{kind:'2nd',n:1}]) : '';`,
   `    const wSeal='';`,
   /* Only the seal count. The banners are driven by `won`/`snd`
      directly, not by wSeal, so they survive this — which is the point
      of running these one per batch. */
   ['carries one week seal per honour and not one more']],

  [7, 'tiebreaker: strike the winner through when everybody overshot',
   `  const over=r.guess>T.actual&&!best;`,
   `  const over=r.guess>T.actual;`,
   ['and is NOT struck through as busted']],

  [8, 'tiebreaker: drop the "everybody went over" note',
   `\${allOver?' &mdash; everybody went over':''}`,
   ``,
   ['and the line says everybody went over, so the number makes sense']],

  /* The word FINAL moved from the `.cd.done` chip to the <b> in the
     centred head, so the mutation follows it. --chalk is a dark-shell
     token at 1.09:1 over this card's paper; the whole point of the case
     is that a colour this wrong can look merely "a bit faint". */
  [9, 'cards: put the invisible FINAL label back',
   `.meta .fin b{font-weight:800;letter-spacing:.09em;text-transform:uppercase;
  color:var(--ink-mute)}`,
   `.meta .fin b{font-weight:800;letter-spacing:.09em;text-transform:uppercase;
  color:var(--chalk)}`,
   ['and its FINAL label clears 4.5:1 against the card']],

  /* ---- batches 10 to 13: the FINAL CARD, one variant per batch ----
     Q2 — the whole bottom strip filled in --hit or --stamp with every
     letter white — is superseded by the W3 pill, so the four batches
     that used to put Q2's own faults back now put the WRONG VARIANT OF
     W back instead. Same discipline, same reason: I built N3 in place
     of Q2 once, and a test asking "is there something green here"
     passed on it. Each of these is a real option from the W sheet that
     was rendered, looked at, and not chosen. */

  // W1: the single letter in the rank circle, instead of the word.
  [10, 'cards: build W1 instead — a single letter, not the word',
   `          <span class="sb-word \${k}">\${word}</span></span></div>\``,
   `          <span class="sb-word \${k}">\${word[0]}</span></span></div>\``,
   ['a card you called right says WIN', 'and one you called wrong says LOSS',
    'the pill is a word, not a letter']],

  // W2: the pill filled rather than outlined — Q2's idea moved inwards.
  [11, 'cards: fill the pill instead of outlining it',
   `.sb-word.w{border-color:var(--hit);color:var(--hit)}`,
   `.sb-word.w{border-color:var(--hit);background:var(--hit);color:#fff}`,
   ['it is an outline, not a filled pill', 'a win is green all through']],

  // W4: the unslanted pill. It reads as a button rather than a stamp,
  // and it stops matching the rank circle it is meant to echo.
  [12, 'cards: unslant the pill (W4, ruled out)',
   `  white-space:nowrap;transform:rotate(-7deg)}`,
   `  white-space:nowrap}`,
   ['it is slanted, like the rank circle']],

  /* THE RED. --stamp is 4.32:1 on the card's own paper, under the floor
     for text, which is the entire reason the paper-side red exists. A
     mutation that swaps it back has to be caught by the measurement,
     not by somebody noticing it looks fine. */
  [13, 'cards: use --stamp for the losing line, as on the dark strip',
   `.resbar{--sink:#BE2F26}`,
   `.resbar{--sink:#C8342A}`,
   /* THE LOSS-SPECIFIC ASSERTIONS ONLY. The first version of this list
      also named "the line about your pick clears 4.5:1 too", which
      measures whichever final card happens to be first — and in this
      fixture that is a WIN, so it is green and unaffected. An
      expectation that depends on card order is exactly the kind that
      reports a mutation as uncaught for a reason unrelated to the
      mutation. */
   ['and that red is NOT --stamp, which fails on this paper',
    "a loss's points clear 4.5:1 on the card paper",
    'a loss is the paper-side red all through',
    'in the paper-side red']],

  /* ---- batches 28 to 31: the rest of the final card ---------------- */

  // The head: put the pre-game row back on a finished game.
  [28, 'cards: leave kickoff time, network and spread on a final card',
   `      \${isFinal(g)?finHead:\`<div class="meta">\${`,
   `      \${false?finHead:\`<div class="meta">\${`,
   ['a final card is on screen', 'a finished card has no countdown chip to mis-class',
    'the week has finished games to check']],

  // The head, left-aligned: it centred by accident before .fmeta said so.
  [29, 'cards: let the final head centre by accident again',
   `.meta.fmeta{justify-content:center}
.meta.fmeta>:first-child{margin-right:0}`,
   ``,
   ['and every one is centred on its card']],

  /* THE UNSTAKED PICK. pay(0,n) is 1, so an unstaked pick that comes in
     scores one point — and the line has to say why, or the card reports
     a number with no explanation. Printing "Rank undefined" is what
     happens if the word is dropped. */
  [30, 'cards: print a rank even when there is not one',
   `      const took=p?\`You took \${p.winner} &middot; \${w?\`Rank \${w}\`:'Unstaked'}\`:'No pick';`,
   `      const took=p?\`You took \${p.winner} &middot; Rank \${w}\`:'No pick';`,
   /* THE ASSERTIONS THAT CAN ACTUALLY SEE THIS, arrived at in two steps.

      The first version named only "no card ever prints a rank it does
      not have", from the main collection — true of every fixture that
      stakes every pick, and all of them did, so the mutation had
      nothing to show. P.unstaked exists because of that. It is still
      NOT in this list: the main fixture stakes every pick, so there the
      mutation prints the rank the card already has and changes nothing.

      The second version named the unstaked case's content assertions,
      and they did not catch it either — because that case built its
      list with /Unstaked/.test(left), so deleting the word emptied the
      list and every .every() passed on nothing (only the population
      assertion went red). The case now selects its cards by POSITION,
      which is what lets a content assertion read a card that should say
      Unstaked and does not. */
   ['an unstaked pick says Unstaked, not a rank',
    'and never prints a rank it does not have']],

  /* W1's whole point: the narrow side's figure goes under its own
     sliver. Pinning it to the left always is the behaviour that shipped
     before, and on an 8%-on-the-right split it puts the figure as far
     from the segment it describes as the card allows. */
  [31, 'cards: put the narrow-side figure at the left, whichever side it is',
   `        small[0]===g.a ? note+cnt : cnt+note}</div>\`;`,
   `        note+cnt}</div>\`;`,
   ["the narrow side's figure sits on its own side of the split"]],

  [14, 'cards: put the invented word "Live" back in front of the clock',
   '          ? \u0060<span class="cd live lefted">${esc(lc)}</span>\u0060',
   '          ? \u0060<span class="cd live lefted">Live ${esc(lc||\'\')}</span>\u0060',
   ['and does not invent a word in front of it']],

  [15, 'cards: give the left slot its own class again, so the two halves drift',
   `.meta .cd.lefted{margin-left:0}`,
   `.meta .cd.lefted{margin-left:0;font-size:11px;color:var(--lock)}`,
   ['both halves share the same green, size and weight']],

  [16, 'cards: leave the dot on both halves (P2, ruled out)',
   `.meta .cd.nodot::before{display:none}`,
   ``,
   ['exactly one dot on the row, and it is on the clock']],

  [17, 'cards: drop the dot from .cd.live entirely',
   `.meta .cd.live::before{content:'';display:inline-block;width:5px;height:5px;`,
   `.meta .cd.live::before{content:none;display:none;width:5px;height:5px;`,
   ['exactly one dot on the row, and it is on the clock']],

  /* THE LIVE CARD MUST NOT REPORT A RESULT. This used to be a mutation
     that coloured the lock band on a live game; the band can no longer
     be coloured at all, so the equivalent mistake now is giving a live
     card the result bar — which would say WIN or LOSS about a game
     still being played. */
  [32, 'cards: give a live card the final result bar too',
   `    const resbar=isFinal(g)?(()=>{`,
   `    const resbar=L?(()=>{`,
   /* ONE ASSERTION, and it has to be this one. "it says the game is in
      progress, not final" reads the LOCK BAND's text, and the band is
      untouched by this mutation — a live card with a result bar bolted
      underneath still says "In progress · locked" above it. Naming it
      here reported a miss for a bug it structurally cannot see. */
   ['and a live card has no result bar, no pill and no final head']],

  [6, 'standings: never band the runner-up row',
   `    const second=snd;`,
   `    const second=false;`,
   /* NOT the banner count. The silver tag is emitted from `snd`
      directly, so the right number of tags still render — they just
      anchor to the board instead of their row, because .row.lead is
      the only row with position:relative and `second hastag` is what
      supplies it elsewhere. Counting them cannot see that; the
      bounding-box check can, and is what this batch is really for. */
   ['every row at the runner-up score is banded, and only those',
    'every banner is anchored to its own row, not floating on the board']],

  /* ================= v1.34.0 ==================================
     The sixteen findings from the adversarial review, and the three
     features built after it. Each of these is the bug as it actually
     was, not an invented one. */

  // ---- batch 18: week honours go by ROW, as they used to ----
  /* THE BIGGEST ONE. Seals and banners were handed to rows 0 and 1, and
     score_week.py shares them by SCORE ("Ties share a place"). On a
     two-way tie for the week that crowned one co-winner and handed the
     other the runner-up seal — a claim the Tuesday scoring run then
     contradicted on the same screen. The fixture's generator puts the
     whole top of the table on the same total, so this is not a corner
     case there; it was the normal case, passing. */
  [18, 'standings: hand the honours to rows 0 and 1 again',
   `  const isWin=p=>!!honours&&honours.win.has(p);
  const isSnd=p=>!!honours&&honours.snd.has(p);`,
   `  const rowOf=p=>rows.findIndex(r=>r.p===p);
  const isWin=p=>view==='week'&&weekDone&&rowOf(p)===0;
  const isSnd=p=>view==='week'&&weekDone&&rowOf(p)===1;`,
   /* WHICH ASSERTIONS CAN CATCH THIS, AND WHICH CANNOT — the fixture
      decides, and pretending otherwise is how a mutation "fails to be
      caught" for a reason that has nothing to do with the test.
      The generator puts MANY players on the best week score and, as it
      happens, exactly ONE on the next score down. So `isSnd = row 1`
      produces the right runner-up COUNT by luck, and the two
      runner-up-count assertions cannot distinguish the bug here. The
      winner side is where it bites: many co-winners collapse to one. */
   ['carries one week seal per honour and not one more',
    'and every co-winner gets the gold banner, not just the first row',
    'there are banners to place']],

  // ---- batch 19: the runner-up is the next ROW, not the next score ----
  [19, 'standings: make the runner-up the next row down',
   `    const lower=rows.filter(r=>r.pts<best).map(r=>r.pts);
    const sndPts=lower.length?Math.max(...lower):0;`,
   `    const sndPts=rows.length>1?rows[1].pts:0;`,
   ['every row at the runner-up score is banded, and only those',
    'with a silver banner on each runner-up',
    'carries one week seal per honour and not one more']],

  // ---- batch 20: crown somebody in a week nobody scored ----
  /* score_week.py gates the whole award block on `if best > 0:`. Without
     it, a finished week in which nobody scored still crowns whoever
     sorted first. */
  /* CASE 59, NOT CASE 56. Case 56's week is part-played, so `weekDone`
     is false and the honours are never computed — removing this line
     changes nothing there, and the first version of this batch expected
     case 56's assertions and was correctly reported as uncaught. The
     only fixture that reaches this line is a FINISHED week with every
     score on zero. */
  [20, 'standings: award the week even when the best score is zero',
   `    if(!(best>0))return null;`,
   ``,
   ['nobody is sealed', 'nobody is crowned',
    'and no row wears the gold treatment',
    'the word "winner" appears nowhere on the board']],

  // ---- batch 21: liveClock takes ESPN's word "Final" ----
  /* pullEspn only skips state==='pre', so a game in 'post' passes
     through with shortDetail "Final" — and our own isFinal() is a SERVER
     write that lands minutes later. In between, the card printed the
     word "Final" styled as a running clock: green, pulsing dot, beside
     "In progress" on the right. */
  [21, "cards: let ESPN's own \"Final\" through as a live clock",
   `  if(/\\b(final|postponed|canceled|cancelled|suspended|delayed|forfeit)\\b/i.test(s))
    return null;`,
   ``,
   ["ESPN's \"Final\" never renders as a running clock",
    'and the left slot falls back to the kickoff time instead']],

  // ---- batch 22: P4's fallback styled as a live clock ----
  /* `liveClock(g)||fT(g.show)` inside the live-clock span meant the
     kickoff time inherited `cd live lefted` — a static time in live
     green with a pulsing dot in front of it. */
  [22, 'cards: style the kickoff-time fallback as a running clock again',
   `        lc
          ? \`<span class="cd live lefted">\${esc(lc)}</span>\`
          : \`<span class="mono">\${fT(g.show)}</span>\``,
   `        (L&&!isFinal(g))
          ? \`<span class="cd live lefted">\${esc(liveClock(g)||fT(g.show))}</span>\`
          : \`<span class="mono">\${fT(g.show)}</span>\``,
   ['and the left slot falls back to the kickoff time instead',
    'with the dot moved to the right-hand chip, so the row still pulses']],

  // ---- batch 23: "N games live" with no ceiling ----
  /* isLive() is a clock and nothing else, and `final` is a server write.
     A postponed game keeping its original kickoff, or one failed scoring
     run, left the header pulsing green on "1 game live" for the rest of
     the week — the app's one signal that something is happening now. */
  [23, 'header clock: drop the six-hour ceiling on "live"',
   `  const playing=unfin.filter(g=>Date.now()-g.kick<LIVE_MAX).length;`,
   `  const playing=unfin.length;`,
   ['a stale unfinished game is not still "live" hours later',
    'and the header says the week is pending instead']],

  // ---- batch 24: the Tie column's dead third state ----
  [24, 'grid: make the Tie header a two-way switch again',
   `    \${(()=>{const s=TB.final?['final','Total']
        :TB.sealed?['open','Open']:['live','Live'];
      return \`<div class="st \${s[0]}">\${s[1]}</div>\`;})()}</th>\``,
   `    <div class="st \${TB.final?'final':'live'}">\${TB.final?'Total':'Open'}</div></th>\``,
   ['a sealed tiebreaker is not painted as live']],

  // ---- batch 25: your own runner-up row loses the "me" tint ----
  [25, "standings: let .row.second's gradient wipe out the me tint",
   `.row.me.second{background:linear-gradient(90deg,rgba(185,193,203,.13),rgba(200,52,42,.08))}`,
   ``,
   ['your own row keeps its highlight when you come runner-up']],

  // ---- batch 26: the archive as a sixth tab again ----
  [26, 'settings: put the archive back in its own tab',
   `  const box=$('#archOpt'); if(box)box.classList.toggle('hide',!on);
  if(!on)return;`,
   `  const box=$('#archOpt'); if(box)box.classList.add('hide');
  if(!on)return;`,
   /* JUST THE VISIBILITY PAIR. renderArchive() writes the content into
      #archBody whether or not the section is shown, and both
      textContent and getComputedStyle read straight through
      display:none — so every content assertion in case 57 passes on a
      section nobody can see, which is why the first version of this
      batch listed six of them and was correctly reported as uncaught.
      The measured-height check is the one that means "a player can see
      this". */
   ['shown when the pool says public',
    'and it takes up real space on the screen']],

  // ---- batch 27: the archive renderer stops escaping names ----
  /* archive_pool.py copies members/{uid}.name verbatim and any member
     can write their own name from a console call, so this renderer
     prints attacker-controlled text on the origin holding everybody's
     sign-in cookie. */
  [27, 'settings: print archived member names unescaped',
   `        <div class="who"><div class="nrow"><b>\${esc(r.name)}</b>\${b}</div>`,
   `        <div class="who"><div class="nrow"><b>\${r.name}</b>\${b}</div>`,
   ['a member name is escaped, not executed', 'and it created no element']],

  /* ================= THE VERSION CARD (case 60) ====================
     Every batch here mutates index.html, which is the only file this
     runner touches. That rules out testing the stub's own announce
     path from in here, so batch 37 goes after the app's half of the
     banner instead: showUpdate, which is what actually unhides it. */

  /* THE OBVIOUS SHORTCUT, and the reason the card exists in the shape
     it does: print a constant from index.html instead of asking the
     worker. It looks identical the day it is written and lies the first
     time somebody bumps sw.js without bumping this. */
  [36, 'settings: print a hardcoded version instead of asking the worker',
   `  const v=(window.PS&&PS.swVersion)?await PS.swVersion().catch(()=>null):null;`,
   `  const v='v1.0.0';`,
   ['it prints the version sw.js declares, not one of its own',
    'and the version did not change under it',
    'with no worker it says so rather than inventing a number',
    'and tells you how to get one',
    'offline, the version it already has is still printed']],

  /* THE BANNER THAT NEVER APPEARS. An update can be found, parked and
     ready, and the one place Lee asked for it to show up is the top of
     the Picks tab. showUpdate is the half of that which lives in this
     file. */
  [37, 'cards: find an update and leave the banner hidden',
   `  bar.classList.remove('hide');`,
   ``,
   ['an update parked from a previous visit raises the banner at once',
    'the banner says a new version is ready',
    'and it sits above the games, not below them']],

  /* THE GREEN BUTTON THAT DOES NOTHING. Tapping "Update now" has to
     reach the waiting worker. A card that only changed its own label
     would look right and leave the phone on the old version, which is
     the whole problem this card was built to end. */
  [38, 'settings: make Update now a label change and nothing more',
   `    const ok=(window.PS&&PS.swActivate)?await PS.swActivate().catch(()=>false):false;`,
   `    const ok=true;`,
   ['tapping it applies the waiting worker']],

  /* A FAILED CHECK THAT CLAIMS SUCCESS. 'unknown' means the check could
     not happen: no registration, or the network refused. Folding it in
     with 'current' tells somebody on bad wifi that they are up to date,
     which is a lie the app cannot detect afterwards. */
  [39, 'settings: treat a failed check as being up to date',
   `  if(st==='waiting')
    verSet(null,'A newer version is ready. This reloads once and you are on it.',
      'Update now',{now:true});`,
   `  if(st==='unknown'||st==='waiting')
    verSet(null,'A newer version is ready. This reloads once and you are on it.',
      'Update now',{now:true});`,
   ['checking cannot succeed, and says that too',
    'the button is not green and not stuck on Checking',
    'and a failed check says so instead of claiming to be up to date']],

  /* ================= WHITE ON EVERY CLUB (case 61) ================= */

  /* THE BLACK WRITING, PUT BACK, by the exact route it arrived: an
     inline colour on the lit side, which beats any stylesheet rule. */
  [40, 'cards: let the lit side choose its own ink again',
   `    const aBg=litA?\`style="background:\${TEAM(g.a)[2]}"\`:'';
    const hBg=litH?\`style="background:\${TEAM(g.h)[2]}"\`:'';`,
   `    const aBg=litA?\`style="background:\${TEAM(g.a)[2]};color:#15171B"\`:'';
    const hBg=litH?\`style="background:\${TEAM(g.h)[2]};color:#15171B"\`:'';`,
   /* NOT "so it reads at least as well as the team name below it". That
      one compares the city line against the name beside it, and this
      mutation darkens BOTH by the same amount, so the comparison holds
      and the assertion cannot see the bug. It is batch 43's catcher,
      where only the city changes. Reported as a miss on the first run
      of this batch. */
   ['every lit side writes in white, on all 32 clubs',
    'and the inline style sets a background only, never a colour',
    'and nothing on a lit side is under 3:1 any more',
    'the score line is large text, and passes its own 3:1 floor',
    'the only clubs under 4.5:1 are the four light ones, by decision',
    'and they are between 3.3 and 4.3, which is where the sheet said']],

  /* THE RING, REMOVED. Everything else still looks right, which is why
     it needs a test of its own: it is the only thing separating a badge
     from a light panel. */
  [41, 'cards: drop the white ring from the lit badge',
   `.side.won .mark{box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.92)}`,
   ``,
   ['every lit badge carries the white ring',
    'and it is a hairline, not a border']],

  /* THE RING ON BOTH SIDES, which makes it decoration rather than the
     mark of the side you took. */
  [42, 'cards: ring the losing badge too',
   `.side.won .mark{box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.92)}`,
   `.side .mark{box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.92)}`,
   ['a losing badge has no white ring']],

  /* THE CITY LINE BACK TO 62%, where it measured 2.08:1 on Cincinnati
     and 2.48 on Kansas City: the worst text on any card, on a club that
     never had black writing and so was never questioned. */
  [43, 'cards: put the city line back to 62% opacity',
   `.side.won .city{opacity:.92}`,
   `.side.won .city{opacity:.62}`,
   /* .62 is the old value and it is the one that has to stay out: white
      at 62% over Cincinnati orange is 2.08:1. The window assertion is
      what sees it; "sits back from the team name" cannot, because .62
      sits back too. */
   ['the lit city line is faded, but only slightly',
    'and nothing on a lit side is under 3:1 any more']],

  /* THE OTHER DIRECTION: no fade at all, which makes the city line as
     loud as the name and is what Lee looked at and rejected. */
  [45, 'cards: stop fading the city line',
   `.side.won .city{opacity:.92}`,
   `.side.won .city{opacity:1}`,
   /* Both ends of the window are real bugs, so the window assertion
      belongs in this list as well as batch 43's: it fails at 1 for the
      same reason it fails at .62. The comparison against the team name
      is the one only this direction can trip. It went red on the first
      run of this batch and was reported as unlisted, which is the
      report doing its job. */
   ['the lit city line is faded, but only slightly',
    'so it sits back from the team name rather than matching it']],

  /* THE STRIP, TAKEN AWAY AGAIN. I removed it once, reading "no black
     writing anywhere" as covering the club's second colour, and Lee put
     it back: it is not writing, and it is what tells one badge from
     another at 42px. This batch is the mistake, so it has to be caught.
     Only a test that reads the pseudo-element can see it. */
  [44, 'cards: hide the second-colour strip on a selected badge',
   `.mark::after{content:'';position:absolute;left:0;right:0;bottom:0;height:6px;background:var(--sec)}`,
   `.mark::after{content:'';position:absolute;left:0;right:0;bottom:0;height:6px;background:var(--sec)}
.side.won .mark::after{display:none}`,
   ['a selected badge keeps its second-colour strip']],

  /* THE PASS THAT "FINISHES THE JOB", which is the one I would make
     next if nothing stopped me. Lee asked twice for no dark writing
     anywhere, saw the four options on the paper-ink sheets, and chose:
     "The black is fine on the card, before you select it, once a side
     is selected it goes white writing." So white ink IS the selection,
     and whitening the unselected side deletes the signal rather than
     completing it. It also renders as almost nothing: white on the
     card's paper is about 1.2:1. */
  [46, 'cards: whiten the unselected side too',
   `.side.lost{flex-grow:.94;background:var(--paper-2);color:var(--ink-mute)}`,
   `.side.lost{flex-grow:.94;background:var(--paper-2);color:#fff}`,
   ['an unselected side writes in DARK ink, which is the decision',
    'so white ink is what selecting a side looks like, and only that']],

  /* AND THE SAME PASS ON THE PAPER BANDS. One rule is enough to prove
     the guard: if the pool label can go white without a test noticing,
     so can the head, the count and the result line. */
  [47, 'cards: whiten the pool label on the cream paper',
   `.cons-head span{font-size:9px;font-weight:700;letter-spacing:.11em;text-transform:uppercase;
  color:var(--ink-soft)}`,
   `.cons-head span{font-size:9px;font-weight:700;letter-spacing:.11em;text-transform:uppercase;
  color:#fff}`,
   ['and the card’s paper bands keep their dark ink too']],

  /* ---- WHO HAS THE BALL, and the four ways it goes wrong ---- */

  /* THE MIRROR, UNDONE. Both panels keep the same source order, so the
     ball sits on the gutter side of the home panel and the BADGE side
     of the away one: the two ends of the card. It is one line, it looks
     like a tidy-up in a diff, and only an assertion that knows which
     side of the gutter the ball landed on can see it. */
  [54, 'possession: drop the mirror, so the away ball sits on the badge side',
   `.side.l .scr{flex-direction:row-reverse;justify-content:flex-end}`,
   ``,
   /* BOTH GO RED, and both should: the mirror decides which side of the
      score the ball sits on, so the gap measurement flips sign with it.
      Listing only the first one reported the second as unexplained
      collateral, which is the report doing its job. */
   ['and it is on the gutter side of whichever panel holds it',
    'and the selected side 4, which is not the same number']],

  /* ONE GAP FOR BOTH SIDES, which is what Lee looked at and rejected.
     The panels are not the same width, so a single number lands the
     ball 12.2px further from the gutter on one side than the other. */
  [55, 'possession: use the same gap on both sides',
   `.side.lost .scr{gap:36px}
.side.won  .scr{gap:48px}`,
   `.side.lost .scr{gap:48px}
.side.won  .scr{gap:48px}`,
   ['the unselected side sits 3 characters out']],

  /* ABSENT POSSESSION IGNORED RATHER THAN CLEARED. This is the bug that
     would look like a feature: the last team to hold the ball keeps the
     football through halftime and past the final whistle, because the
     guard treats "ESPN said nothing" as "nothing changed". */
  [56, 'possession: keep the last holder when ESPN sends no situation',
   `        if(ESPN_BALL[k]!==own){ESPN_BALL[k]=own;changed=true;}`,
   `        if(own&&ESPN_BALL[k]!==own){ESPN_BALL[k]=own;changed=true;}`,
   /* NOT the "no situation at all" case: that fixture never had a ball
      to keep, so it looks identical either way. The sequence case is
      the only one that can see this. */
   ['and it clears when ESPN stops sending one, rather than sticking']],

  /* THE FOOTBALL ON A FINISHED GAME. ballOf() drops it once the server
     writes final; without that the card keeps its score forever and the
     football with it. */
  [57, 'possession: let the football outlive the final whistle',
   `const ballOf=g=>(!isLive(g)||isFinal(g))?null:(ESPN_BALL[\`\${g.a}_\${g.h}\`]||null);`,
   `const ballOf=g=>(!isLive(g))?null:(ESPN_BALL[\`\${g.a}_\${g.h}\`]||null);`,
   ['and a finished game drops it, however stale ESPN is']],

  /* THE ONE THAT ACTUALLY SHIPPED BROKEN, v1.39.0, found by diffing the
     build against v1.38.3 rather than by any test.

     A reversed flex row packs to its main START, which in row-reverse is
     the RIGHT. With a football present that is invisible: ball plus gap
     plus digits already fill the box, so every possession assertion in
     case 62 stayed green. With NO football the box is wider than the
     digits alone and the away score slid 27.6px right of the team name
     above it, on every live card the away side was not holding and on
     every final card in the season.

     The lesson is in the shape of the mutation, not the property: a
     feature has to be graded on what it does to the cards it did NOT
     add anything to. */
  [58, 'possession: let a reversed row pack the away score to the gutter',
   `.side.l .scr{flex-direction:row-reverse;justify-content:flex-end}`,
   `.side.l .scr{flex-direction:row-reverse}`,
   ['with no football, the away score still starts where the team name does']],
];

function runSuite() {
  try {
    const out = execFileSync('node', ['regress.ui.test.mjs'],
      { cwd: new URL('.', import.meta.url).pathname, encoding: 'utf8',
        timeout: 900000, maxBuffer: 1 << 26 });
    return { out, failures: [] };
  } catch (e) {
    const out = String(e.stdout || '') + String(e.stderr || '');
    const i = out.indexOf('FAILURES:');
    const failures = i < 0 ? [] : out.slice(i + 9).split('\n')
      .map(l => l.trim()).filter(l => l.startsWith('- '))
      .map(l => l.slice(2).split(' -> ')[0].trim());
    return { out, failures };
  }
}

const only = process.argv[2] ? Number(process.argv[2]) : null;
const batches = [...new Set(MUTATIONS.map(m => m[0]))].filter(b => !only || b === only);
let bad = 0;

for (const batch of batches) {
  const ms = MUTATIONS.filter(m => m[0] === batch);
  let src = ORIGINAL;
  console.log(`\n=== BATCH ${batch}: applying ${ms.length} mutations ===`);
  for (const [, label, find, repl] of ms) {
    const n = src.split(find).length - 1;
    if (n !== 1) {
      console.log(`  !! "${label}" matched ${n} times — mutation not applied`);
      bad++; continue;
    }
    src = src.replace(find, repl);
    console.log(`  applied: ${label}`);
  }
  fs.writeFileSync(APP, src);
  const { failures } = runSuite();
  fs.writeFileSync(APP, ORIGINAL);

  const expected = new Set(ms.flatMap(m => m[4]));
  const got = new Set(failures);
  const missed = [...expected].filter(e => !got.has(e));
  const extra  = [...got].filter(g => !expected.has(g));

  console.log(`  ${failures.length} assertions went red`);
  if (missed.length) {
    bad++;
    console.log('  !! THESE TESTS DID NOT CATCH THEIR BUG:');
    missed.forEach(m => console.log('     - ' + m));
  }
  if (extra.length) {
    console.log('  (also red, not listed as expected — check these are collateral:');
    extra.forEach(m => console.log('     - ' + m));
    console.log('  )');
  }
  if (!missed.length) console.log('  OK: every expected assertion caught its mutation');
}

restore();
fs.unlinkSync(BACKUP);
console.log(`\n${bad ? 'PROBLEMS: ' + bad : 'All batches behaved'}`);
process.exit(bad ? 1 : 0);
