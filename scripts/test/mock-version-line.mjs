/* MOCKUP SHEET: where the version number goes.

   Lee asked for a version somewhere in the app and suggested the
   Settings tab. Settings is right, and the sheet shows four placements
   so the choice is on screen: a quiet footer line at the very bottom, a
   proper About card, the header beside the brand, and the Help tab.

   THE PART WORTH MORE THAN THE LABEL. The reason to want a version on
   screen at all is the question "is this phone running the new one",
   which comes up on every single deploy and is currently answered by
   telling twenty eight people to swipe the app away and reopen it. A
   plain label only half answers it: it says what this phone has, not
   whether something newer exists.

   So the About card reads its number from the SERVICE WORKER that is
   actually running, not from a constant in the page, and it can ask the
   browser to look for a new one. Four states, all rendered here:
   resting, checking, up to date, and update ready with the button that
   activates it. That last state is what removes the cold start
   instruction from every release.

   ONE SOURCE OF TRUTH, and this is the trap to avoid. sw.js already
   holds `const VERSION = 'v1.35.0'`, and it is the file whose change is
   what makes a phone fetch anything at all. A second constant in
   index.html would be a second thing to remember to bump, and the day
   somebody forgets, the app confidently displays the wrong version,
   which is worse than displaying none. The page asks the worker.

   Rendered in the app's own typeface with the app's own stylesheet,
   because this one IS app UI.

   Run: node mock-version-line.mjs
   Out: docs/mockups/version-line-390.png
*/
import { chromium } from 'playwright';
import fs from 'node:fs';

const APP = fs.readFileSync(new URL('../../index.html', import.meta.url).pathname, 'utf8');
const STYLE = APP.slice(APP.indexOf('<style>') + 7, APP.indexOf('</style>'));
const VER = (APP.match(/const VERSION = '([^']+)'/) || [])[1] || 'v1.35.0';
/* sw.js is the source of truth, so the sheet reads it rather than
   printing a number I typed. If these two disagree the sheet is wrong
   and says so out loud. */
const SW = fs.readFileSync(new URL('../../sw.js', import.meta.url).pathname, 'utf8');
const SWVER = (SW.match(/const VERSION = '([^']+)'/) || [])[1];

/* ---- V1: a quiet footer line, the last thing in Settings ---------- */
const V1 = `<div class="vfoot">Weekly NFL Pick’em &middot; ${SWVER}</div>`;

/* ---- V2: an About card, the last .opt in Settings ----------------- */
const v2 = (state, note) => `<div class="opt">
  <h4>Version</h4>
  <div class="vrow">
    <div class="vleft">
      <div class="vnum mono">${SWVER}</div>
      <div class="vsub">${note}</div>
    </div>
    ${state === 'ready'
      ? `<button class="mbtn vbtn now">Update now</button>`
      : `<button class="mbtn vbtn${state === 'checking' ? ' busy' : ''}">${
          state === 'checking' ? 'Checking…' : 'Check for update'}</button>`}
  </div>
</div>`;

/* ---- V3: the header, beside the brand ----------------------------- */
const V3 = `<div class="topbar mockbar">
  <div class="brandrow">
    <div class="brand">
      <span class="b1">Weekly NFL</span>
      <span class="b2">Pick’em <em>CONF</em><em class="vtag">${SWVER}</em></span>
    </div>
    <div class="clock"><span class="dot"></span><span>DET @ BUF &middot; 23H 58M</span></div>
  </div>
</div>`;

/* ---- V4: the Help tab, at the foot of the page -------------------- */
const V4 = `<div class="opt">
  <h4>Tiebreaker</h4>
  <p>The combined score of the last game of the week breaks a tie on
    points. That is Monday night most weeks, but it follows the
    schedule.</p>
</div>
<div class="vfoot help">Weekly NFL Pick’em &middot; ${SWVER} &middot; built for 28 friends</div>`;

const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800;900&family=Roboto+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>
${STYLE}
/* ---- mockup chrome only ---- */
.mocksheet{margin:0 auto;padding:0 0 30px}
.lab{padding:20px 14px 4px}
.lab h3{margin:0;font-size:13px;font-weight:900;color:var(--paper)}
.lab p{margin:5px 0 10px;font-size:10.5px;line-height:1.5;color:var(--chalk)}
.lab code{font-family:'Roboto Mono',monospace;font-size:9.5px}
.rule{height:1px;background:rgba(250,247,241,.09);margin:16px 14px}
.cap{padding:2px 14px 6px;font-size:8.5px;font-weight:800;letter-spacing:.14em;
  text-transform:uppercase;color:var(--chalk-faint)}
.mockbar{position:static;margin-bottom:6px}
.settings{padding-bottom:4px}

/* ---- WHAT WOULD BE ADDED TO THE APP, and nothing else ------------ */
/* V1: the footer line. Not an .opt, because it is not a setting and a
   card around it would give it the same weight as Alerts. */
.vfoot{padding:16px var(--pad) 22px;text-align:center;font-family:'Roboto Mono',monospace;
  font-size:9.5px;font-weight:600;letter-spacing:.06em;color:var(--chalk-faint)}
/* The Help tab sits on the same dark shell as Settings, so --ink-faint
   is invisible there: the first render of this sheet showed an empty
   space where V4's line should have been. Same token as V1. */
.vfoot.help{color:var(--chalk-faint)}

/* V2: the About card. */
.vrow{display:flex;align-items:center;justify-content:space-between;gap:12px}
.vleft{min-width:0}
.vnum{font-size:15px;font-weight:700;letter-spacing:.02em;color:var(--paper)}
.vsub{margin-top:3px;font-size:10px;line-height:1.4;color:var(--chalk)}
.vbtn{width:auto;flex:0 0 auto;padding:10px 14px;font-size:11px}
.vbtn.busy{opacity:.6}
.vbtn.now{background:var(--live);border-color:var(--live);color:#10210C}

/* V3: the header tag, built on the existing CONF pill. */
.b2 .vtag{margin-left:5px;font-family:'Roboto Mono',monospace;font-size:8.5px;
  font-weight:700;letter-spacing:.04em;color:var(--chalk-faint);
  border:1px solid rgba(250,247,241,.18);border-radius:4px;padding:2px 4px;
  font-style:normal;vertical-align:middle}
</style></head><body><div class="mocksheet">

<div class="lab"><h3>Where the version goes</h3>
  <p>Settings is the right tab, and the question is really which of two
    things you want: a <b>label</b> that says what this phone has, or a
    <b>control</b> that can also tell you whether something newer is
    waiting and switch to it. The second one is what would retire
    &ldquo;swipe the app away and reopen&rdquo; from every release.</p>
  <p>Every number below is read from <code>sw.js</code> at render time,
    not typed in. That file already holds the version and is the file
    whose change makes a phone fetch anything, so it stays the only
    place a version is written.</p></div>

<div class="rule"></div>
<div class="lab"><h3>V1 &nbsp;A quiet line at the foot of Settings</h3>
  <p>The last thing on the tab, under First run. No card, because it is
    not a setting. Cheapest thing that answers &ldquo;what am I
    on&rdquo;, and it answers nothing else.</p></div>
<div class="cap">bottom of the Settings tab</div>
<div class="settings">
  <div class="opt"><h4>First run</h4>
    <p>The walkthrough you saw the first time you opened the app.</p>
    <button class="mbtn" style="margin-top:12px;width:auto;padding:11px 16px">Show me again</button></div>
  ${V1}
</div>

<div class="rule"></div>
<div class="lab"><h3>V2 &nbsp;An About card that can also check</h3>
  <p>Same place, one card instead of a line, and the button asks the
    browser to look for a newer version. Four states.</p></div>
<div class="cap">resting</div>
<div class="settings">${v2('idle', 'Up to date as of your last check.')}</div>
<div class="cap">while it looks</div>
<div class="settings">${v2('checking', 'Asking the server for a newer version.')}</div>
<div class="cap">nothing new</div>
<div class="settings">${v2('idle', 'Checked just now. This is the newest version.')}</div>
<div class="cap">there is a new one waiting</div>
<div class="settings">${v2('ready', 'A newer version is ready. This reloads once and you are on it.')}</div>

<div class="rule"></div>
<div class="lab"><h3>V3 &nbsp;In the header, beside CONF</h3>
  <p>Always visible, no tapping, and <b>it does fit</b>: measured at
    320px the tag leaves 10px between the brand and the clock, so the
    objection I expected is not real. The objection that stands is
    different. This is the one line of the app everybody looks at every
    Sunday, and it would be spending it on something nobody needs to
    know on a Sunday.</p></div>
<div class="cap">top of every tab</div>
${V3}

<div class="rule"></div>
<div class="lab"><h3>V4 &nbsp;At the foot of the Help tab</h3>
  <p>Where an About line traditionally lives. The Help tab is read once
    and then never again, which is the problem: when you ask somebody
    what version they are on, they will look in Settings.</p></div>
<div class="cap">bottom of the Help tab</div>
<div class="settings">${V4}</div>

<div class="rule"></div>
<div class="lab"><h3>What I would build</h3>
  <p><b>V2 in Settings, at the bottom, under First run.</b> It answers
    the support question and the deploy question with one card, and it
    is the only option that can end the cold start instruction. If you
    want the label and nothing more, V1 is three lines of CSS and one
    line of markup.</p>
  <p>Not V3, though not for the reason I assumed. It fits at 320px.
    It is just that the header is the busiest line in the app and a
    version number is not a thing you need while picking games.</p></div>

</div></body></html>`;

fs.writeFileSync('/tmp/claude-0/mock-version.html', html);

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto('file:///tmp/claude-0/mock-version.html', { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(700);
const out = new URL('../../docs/mockups/version-line-390.png', import.meta.url).pathname;
await page.screenshot({ path: out, fullPage: true });

/* MEASURED. Three things that would only show up on a phone:
   the footer line has to clear 4.5:1 on the dark shell, the header tag
   must not push the clock off the row at 320px, and the About card's
   button must not wrap its label. */
const m = await page.evaluate(() => {
  const lin = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
  const rgb = s => (s.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
  const lum = c => .2126 * lin(c[0]) + .7152 * lin(c[1]) + .0722 * lin(c[2]);
  const cr = (a, b) => { const x = lum(rgb(a)), y = lum(rgb(b));
    return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  const foots = [...document.querySelectorAll('.vfoot')];
  const foot = foots[0];
  const shell = getComputedStyle(document.body).backgroundColor;
  const btns = [...document.querySelectorAll('.vbtn')];
  return {
    footRatio: +cr(getComputedStyle(foot).color, shell).toFixed(2),
    footColor: getComputedStyle(foot).color,
    /* EVERY footer line, not just the first. V4's was invisible on the
       first render because it used the light-paper ink token on the
       dark shell, and one measurement of one line would not have
       caught it. */
    allFoots: foots.map(f => +cr(getComputedStyle(f).color, shell).toFixed(2)),
    btnLines: btns.map(x => Math.round(x.getBoundingClientRect().height)),
    tagText: (document.querySelector('.vtag') || {}).textContent,
  };
});
console.log('sw.js VERSION read as', SWVER, SWVER === VER ? '(matches index.html read)' : '(DISAGREES)');
console.log('footer line contrast on the shell, every one:', m.allFoots.join(', '),
  m.allFoots.every(r => r >= 4.5) ? 'all pass 4.5:1' : '!! ONE IS UNDER 4.5:1');
console.log('button heights (a wrapped label would be taller):', m.btnLines.join(', '));
console.log('header tag renders as', JSON.stringify(m.tagText));

/* 320px, where the header variant either fits or does not. */
const ctx2 = await b.newContext({ viewport: { width: 320, height: 900 }, deviceScaleFactor: 2 });
const p2 = await ctx2.newPage();
await p2.goto('file:///tmp/claude-0/mock-version.html', { waitUntil: 'load' });
await p2.evaluate(() => document.fonts.ready);
await p2.waitForTimeout(500);
const narrow = await p2.evaluate(() => {
  const brand = document.querySelector('.mockbar .brand').getBoundingClientRect();
  const clock = document.querySelector('.mockbar .clock').getBoundingClientRect();
  return { overlap: +(brand.right - clock.left).toFixed(1),
           clockWidth: Math.round(clock.width) };
});
console.log('at 320px, brand right minus clock left:', narrow.overlap,
  narrow.overlap > 0 ? '!! the header tag pushes into the clock' : 'no collision');
await p2.screenshot({ path: new URL('../../docs/mockups/version-line-320.png',
  import.meta.url).pathname, fullPage: true });
await ctx2.close();
await ctx.close();
await b.close();
console.log('wrote version-line-390.png and version-line-320.png');
