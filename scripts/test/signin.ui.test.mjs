/* Drives the real sign-in screens in a real browser.
   Each case is a way these flows break for actual users. */
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:8099';
let pass = 0, fail = 0; const fails = [];
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n); }
  else { fail++; fails.push(n + (x ? ' -> ' + x : '')); console.log('  FAIL ' + n + (x ? '  -> ' + x : '')); } };

const browser = await chromium.launch();

/* Boots a fresh page with /api scripted. Returns helpers. */
async function open(plan = {}, opts = {}) {
  const ctx = await browser.newContext({
    viewport: opts.viewport || { width: 390, height: 844 },   // iPhone-ish
    userAgent: opts.ua,
  });
  const page = await ctx.newPage();
  // This sandbox has no egress; block anything off-origin (fonts, CDNs) so
  // the page settles instead of hanging on requests that can never resolve.
  await page.route('**/*', r => r.request().url().startsWith(BASE)
    ? r.continue() : r.abort());
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error'
    && !/ERR_FAILED|Failed to load resource/.test(m.text()))
    errors.push('console: ' + m.text()); });
  await page.request.post(BASE + '/__plan', {
    data: { session: { status: 401, body: { error: 'no_session' } }, ...plan } });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#obNameIn', { timeout: 10000 }).catch(() => {});
  const calls = async () => (await page.request.get(BASE + '/__calls')).json();
  return { ctx, page, errors, calls };
}

const fillSignin = async (page, name = 'Lee', email = 'lee@example.com') => {
  await page.fill('#obNameIn', name);
  await page.fill('#obMailIn', email);
};
const typeCode = async (page, code) => {
  for (let i = 0; i < 6; i++) await page.fill('#pin' + i, code[i]);
};

/* ------------------------------------------------------------------ */
console.log('\n1. The screen the whole app is judged on');
{
  const { ctx, page, errors } = await open();
  ok('onboarding appears for a signed-out visitor', await page.isVisible('#obNameIn'));
  ok('no javascript errors on load', errors.length === 0, errors[0]);
  ok('the continue button starts disabled', await page.isDisabled('#obGo'));
  await page.fill('#obNameIn', 'Lee');
  ok('still disabled with a name but no email', await page.isDisabled('#obGo'));
  await page.fill('#obMailIn', 'not-an-email');
  ok('still disabled on a malformed email', await page.isDisabled('#obGo'));
  await page.fill('#obMailIn', 'lee@example.com');
  ok('enabled once both are valid', await page.isEnabled('#obGo'));
  await ctx.close();
}

console.log('\n2. Double submit  (the bug that made a good code look expired)');
{
  const { ctx, page, calls } = await open({ 'verify-code': { delay: 300, body: { token: 't', uid: 'u' } } });
  await fillSignin(page);
  await page.click('#obGo');
  await page.waitForSelector('#pin0');
  await page.request.post(BASE + '/__plan', {
    data: { session: { status: 401, body: {} }, 'verify-code': { delay: 300, body: { token: 't', uid: 'u' } } } });
  // Fill all six: the sixth triggers the auto-submit. Then hammer the button.
  await typeCode(page, '123456');
  // Bypass both the disabled attribute and Playwright's actionability checks
  // so this exercises the obBusy guard itself, not the button state.
  await page.evaluate(() => { const b = document.getElementById('obGo');
    b.click(); b.onclick(); b.onclick(); });
  await page.waitForTimeout(1200);
  const c = (await calls()).filter(x => x.name === 'verify-code');
  ok('one code produces exactly ONE verify request', c.length === 1, c.length + ' requests');
  await ctx.close();
}

console.log('\n3. Double-tapping the first button does not send two codes');
{
  const { ctx, page, calls } = await open({ 'request-code': { delay: 300 } });
  await fillSignin(page);
  await page.evaluate(() => { const b = document.getElementById('obGo');
    b.click(); b.onclick(); b.onclick(); });
  await page.waitForTimeout(1000);
  const c = (await calls()).filter(x => x.name === 'request-code');
  ok('three taps send exactly one code', c.length === 1, c.length + ' requests');
  await ctx.close();
}

console.log('\n4. A failed send must not pretend it worked');
{
  const { ctx, page } = await open({ 'request-code': { status: 502, body: { error: 'send_failed' } } });
  await fillSignin(page);
  await page.click('#obGo');
  await page.waitForTimeout(400);
  ok('the user stays on the sign-in screen', await page.isVisible('#obMailIn'));
  ok('an error is shown', await page.isVisible('#obSignErr'));
  const t = await page.textContent('#obSignErr');
  ok('the error says the send failed, not "check your inbox"', /couldn't send/i.test(t), t);
  ok('and the button is usable again', await page.isEnabled('#obGo'));
  await ctx.close();
}
{
  const { ctx, page } = await open({ 'request-code': { status: 400, body: { error: 'bad_email' } } });
  await fillSignin(page, 'Lee', 'lee@exmaple.com');
  await page.click('#obGo');
  await page.waitForTimeout(400);
  const t = await page.textContent('#obSignErr');
  ok('a rejected address says so plainly', /address/i.test(t), t);
  await ctx.close();
}

console.log('\n5. Loading state  (Resend can take a second or two)');
{
  const { ctx, page } = await open({ 'request-code': { delay: 700 } });
  await fillSignin(page);
  await page.click('#obGo');
  await page.waitForTimeout(200);
  const label = await page.textContent('#obGo');
  ok('the button says what it is doing', /sending/i.test(label), label);
  ok('and is disabled while it does it', await page.isDisabled('#obGo'));
  ok('it looks busy rather than dead', await page.evaluate(
    () => document.getElementById('obGo').classList.contains('busy')));
  await page.waitForTimeout(900);
  ok('and hands control back afterwards', await page.isVisible('#pin0'));
  await ctx.close();
}

console.log('\n6. Wrong code');
{
  const { ctx, page } = await open({ 'verify-code': { status: 400, body: { error: 'wrong_code', left: 4 } } });
  await fillSignin(page); await page.click('#obGo'); await page.waitForSelector('#pin0');
  await typeCode(page, '111111');
  await page.waitForTimeout(600);
  const t = await page.textContent('#obPinErr');
  ok('says the code is wrong and how many tries are left', /isn't right/i.test(t) && /4 tries/.test(t), t);
  ok('stays on the code screen', await page.isVisible('#pin0'));
  ok('clears the boxes so they can retype', (await page.inputValue('#pin0')) === '');
  ok('and puts the cursor back in the first box',
     await page.evaluate(() => document.activeElement?.id === 'pin0'));
  await ctx.close();
}

console.log('\n7. Locked out');
{
  const { ctx, page } = await open({ 'verify-code': { status: 429, body: { error: 'locked' } } });
  await fillSignin(page); await page.click('#obGo'); await page.waitForSelector('#pin0');
  await typeCode(page, '111111');
  await page.waitForTimeout(600);
  const t = await page.textContent('#obPinErr');
  ok('explains the lockout instead of saying "expired"', /too many tries/i.test(t), t);
  await ctx.close();
}

console.log('\n8. Signed in, but the pool failed to open');
console.log('   (old code sent them back to the keypad with a spent code)');
{
  const { ctx, page } = await open({ 'verify-code': { body: { token: 't', uid: 'u' } } });
  await fillSignin(page); await page.click('#obGo'); await page.waitForSelector('#pin0');
  await page.evaluate(() => { window.__ps.fail.joinPool = true; });
  await typeCode(page, '123456');
  await page.waitForTimeout(700);
  const t = await page.textContent('#obPinErr');
  ok('does NOT blame the connection', !/reach the server/i.test(t), t);
  ok('tells them they are signed in', /signed in/i.test(t), t);
  ok('keeps their digits rather than wiping them',
     (await page.inputValue('#pin0')) === '1');
  await ctx.close();
}

console.log('\n9. Genuinely offline');
{
  const { ctx, page } = await open();
  await fillSignin(page);
  await ctx.setOffline(true);
  await page.click('#obGo');
  await page.waitForTimeout(600);
  const t = await page.textContent('#obSignErr');
  ok('offline is the one case that blames the connection', /connection/i.test(t), t);
  ok('and the app has not crashed', await page.isEnabled('#obGo'));
  await ctx.setOffline(false);
  await ctx.close();
}

console.log('\n10. Resend countdown');
{
  const { ctx, page, calls } = await open({ 'verify-code': { status: 400, body: { error: 'wrong_code', left: 3 } } });
  await fillSignin(page); await page.click('#obGo'); await page.waitForSelector('#pin0');
  ok('resend starts locked', await page.isDisabled('#obResend'));
  const first = await page.evaluate(() => window.obTick ?? null);
  // Three failures used to stack three countdown timers on the same counter.
  for (let i = 0; i < 3; i++) { await typeCode(page, '111111'); await page.waitForTimeout(500); }
  const before = await page.textContent('#obCd');
  await page.waitForTimeout(3000);
  const after = await page.textContent('#obCd');
  const b = +(before.match(/\d+/) || [0])[0], a = +(after.match(/\d+/) || [0])[0];
  const drop = b - a;
  ok('the clock still runs at one second per second after 3 errors',
     drop >= 2 && drop <= 4, `${b}s -> ${a}s in 3s (drop ${drop})`);
  const c = (await calls()).filter(x => x.name === 'request-code');
  ok('and no extra codes were sent', c.length === 1, String(c.length));
  await ctx.close();
}

console.log('\n11. Entering the code the way people actually do');
{
  const { ctx, page, calls } = await open({ 'verify-code': { hang: true } });
  await fillSignin(page); await page.click('#obGo'); await page.waitForSelector('#pin0');

  // Paste, including the spaced form people copy out of an email.
  await page.evaluate(() => {
    const dt = new DataTransfer(); dt.setData('text', '458 219');
    document.getElementById('pin0').dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(400);
  const vals = await page.evaluate(() =>
    [...Array(6)].map((_, i) => document.getElementById('pin' + i).value).join(''));
  ok('a pasted code with a space in it lands correctly', vals === '458219', vals);
  await ctx.close();
}
{
  // iOS/Android autofill drops the WHOLE code into the first box.
  const { ctx, page } = await open({ 'verify-code': { hang: true } });
  await fillSignin(page); await page.click('#obGo'); await page.waitForSelector('#pin0');
  await page.evaluate(() => {
    const b = document.getElementById('pin0');
    b.value = '731904';                       // what SMS/email autofill does
    b.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(400);
  const vals = await page.evaluate(() =>
    [...Array(6)].map((_, i) => document.getElementById('pin' + i).value).join(''));
  ok('autofilling all six digits into the first box fills the row', vals === '731904', vals);
  await ctx.close();
}
{
  const { ctx, page } = await open();
  await fillSignin(page); await page.click('#obGo'); await page.waitForSelector('#pin0');
  await page.fill('#pin0', '1'); await page.fill('#pin1', '2');
  await page.focus('#pin1'); await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  ok('backspace walks back through the boxes',
     await page.evaluate(() => document.activeElement?.id === 'pin0'));
  await ctx.close();
}

{
  // Autofill can also land on a box other than the first.
  const { ctx, page } = await open({ 'verify-code': { hang: true } });
  await fillSignin(page); await page.click('#obGo'); await page.waitForSelector('#pin0');
  await page.evaluate(() => {
    const b = document.getElementById('pin2');
    b.focus(); b.value = '246813';
    b.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(400);
  const vals = await page.evaluate(() =>
    [...Array(6)].map((_, i) => document.getElementById('pin' + i).value).join(''));
  ok('a full code autofilled into a middle box still starts at box one', vals === '246813', vals);
  await ctx.close();
}
{
  // Typing one digit at a time must still behave.
  const { ctx, page } = await open({ 'verify-code': { hang: true } });
  await fillSignin(page); await page.click('#obGo'); await page.waitForSelector('#pin0');
  await page.click('#pin0');
  for (const d of '904312') await page.keyboard.type(d);
  await page.waitForTimeout(300);
  const vals = await page.evaluate(() =>
    [...Array(6)].map((_, i) => document.getElementById('pin' + i).value).join(''));
  ok('typing six digits one by one fills the row in order', vals === '904312', vals);
  await ctx.close();
}
{
  // Partial paste, e.g. someone copies only part of the code.
  const { ctx, page } = await open({ 'verify-code': { hang: true } });
  await fillSignin(page); await page.click('#obGo'); await page.waitForSelector('#pin0');
  await page.evaluate(() => {
    const dt = new DataTransfer(); dt.setData('text', '12');
    document.getElementById('pin0').dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(300);
  const st = await page.evaluate(() => ({
    vals: [...Array(6)].map((_, i) => document.getElementById('pin' + i).value).join(''),
    go: document.getElementById('obGo').disabled }));
  ok('a partial paste fills what it can and does not submit',
     st.vals === '12' && st.go === true, JSON.stringify(st));
  await ctx.close();
}

console.log('\n12. Changing a mistyped address');
{
  const { ctx, page } = await open();
  await fillSignin(page, 'Lee', 'lee@exmaple.com');
  await page.click('#obGo'); await page.waitForSelector('#obEdit');
  await page.click('#obEdit');
  await page.waitForTimeout(300);
  ok('goes back to the sign-in screen', await page.isVisible('#obMailIn'));
  ok('and keeps what they already typed',
     (await page.inputValue('#obMailIn')) === 'lee@exmaple.com'
     && (await page.inputValue('#obNameIn')) === 'Lee');
  await ctx.close();
}

console.log('\n13. Enter key');
{
  const { ctx, page, calls } = await open();
  await fillSignin(page);
  await page.focus('#obMailIn');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  ok('Enter in the email field submits', await page.isVisible('#pin0'));
  ok('and sends exactly one code',
     (await calls()).filter(x => x.name === 'request-code').length === 1);
  await ctx.close();
}

console.log('\n14. A server that never answers');
{
  const { ctx, page } = await open({ 'request-code': { hang: true } });
  await fillSignin(page);
  await page.click('#obGo');
  await page.waitForTimeout(1500);
  ok('the button stays in its busy state rather than looking broken',
     await page.evaluate(() => document.getElementById('obGo').classList.contains('busy')));
  ok('and the user is not falsely advanced', await page.isVisible('#obMailIn'));
  await ctx.close();
}

console.log('\n15. Presentation');
{
  const { ctx, page } = await open({}, { viewport: { width: 320, height: 568 } });  // iPhone SE
  const scroll = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok('no sideways scrolling on a 320px phone', scroll <= 0, scroll + 'px overflow');
  const small = await page.evaluate(() => {
    const bad = [];
    for (const el of document.querySelectorAll('#ob button, #ob input')) {
      const r = el.getBoundingClientRect();
      if (r.height > 0 && r.height < 40) bad.push((el.id || el.tagName) + ':' + Math.round(r.height));
    }
    return bad;
  });
  ok('every control meets a 40px minimum tap height', small.length === 0, small.join(', '));
  const inputFont = await page.evaluate(() =>
    parseFloat(getComputedStyle(document.getElementById('obMailIn')).fontSize));
  ok('inputs are >=16px so iOS does not zoom on focus', inputFont >= 16, inputFont + 'px');
  await ctx.close();
}
{
  const { ctx, page } = await open();
  await fillSignin(page); await page.click('#obGo'); await page.waitForSelector('#pin0');
  const attrs = await page.evaluate(() => {
    const b = document.getElementById('pin0');
    return { mode: b.getAttribute('inputmode'), otc: b.getAttribute('autocomplete') };
  });
  ok('the code boxes ask for a numeric keypad', attrs.mode === 'numeric', attrs.mode);
  ok('and opt into one-time-code autofill', attrs.otc === 'one-time-code', attrs.otc);
  const emailAttrs = await open().then(async ({ ctx: c2, page: p2 }) => {
    const a = await p2.evaluate(() => {
      const m = document.getElementById('obMailIn');
      return { type: m.type, cap: m.getAttribute('autocapitalize'), ac: m.getAttribute('autocomplete') };
    });
    await c2.close(); return a;
  });
  ok('the email field is type=email with autocapitalize off',
     emailAttrs.type === 'email' && emailAttrs.cap === 'off', JSON.stringify(emailAttrs));
  await ctx.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fails.length) { console.log('\nFAILURES:'); fails.forEach(f => console.log('  - ' + f)); }
await browser.close();
process.exit(fail ? 1 : 0);
