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
   `    <div class="cons-sub mono">\${
      [c.pa<22?\`\${g.a} \${c.pa}%\`:'', c.ph<22?\`\${g.h} \${c.ph}%\`:'',
       \`\${c.n} pick\${c.n===1?'':'s'}\`].filter(Boolean).join(' · ')}</div>`,
   `    \${(c.pa<22||c.ph<22)?\`<div class="cons-sub mono">\${g.a} \${c.pa}% · \${g.h} \${c.ph}% · \${c.n} picks</div>\`:''}`,
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

  [9, 'cards: put the invisible FINAL label back',
   `.meta .cd.done,.tbmeta .cd.done{color:var(--ink-mute)}`,
   `.meta .cd.done,.tbmeta .cd.done{color:var(--chalk)}`,
   ['and its FINAL label clears 4.5:1 against the card']],

  [10, 'cards: drop the Q2 fill entirely',
   `.lockband.won{background:var(--hit)}
.lockband.lost{background:var(--stamp)}`,
   ``,
   /* "the strip is still the neutral dark one" is about a LIVE game and
      is unaffected by removing the fill — it was wrong of me to expect
      it here. "it is a FILL" is the one that catches the dark strip
      surviving on a finished card. */
   ['a card you called right fills with the palette green',
    'and one you called wrong fills with the palette red',
    'it is a FILL, not a ring round a dark strip']],

  /* The variant I built by mistake. It has to FAIL, or the test is only
     asserting "something green is here" and would have passed on the
     wrong design — which is exactly how this shipped wrong once. */
  [11, 'cards: build N3 instead — a ring round the dark strip',
   `.lockband.won{background:var(--hit)}
.lockband.lost{background:var(--stamp)}`,
   `.lockband.won{box-shadow:inset 0 0 0 1.5px var(--live)}
.lockband.lost{box-shadow:inset 0 0 0 1.5px var(--stamp)}`,
   ['a card you called right fills with the palette green',
    'and one you called wrong fills with the palette red',
    'it is a FILL, not a ring round a dark strip']],

  [12, 'cards: leave the losing line its own red on the red fill',
   `.lockband.won,.lockband.won span,
.lockband.lost,.lockband.lost span{color:#fff}`,
   `.lockband.won,.lockband.lost{color:#fff}`,
   ['and EVERY letter on the strip is white, including the losing line']],

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

  [13, 'cards: colour the strip on a live game too',
   `    const bandCls=!isFinal(g)||!R ? '' : (p&&p.winner===R ? 'won' : 'lost');`,
   `    const bandCls=p&&R&&p.winner===R ? 'won' : 'lost';`,
   ['but it is not coloured while the game is still being played',
    'and the strip is still the neutral dark one']],

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
