import fs from 'fs';
import path from 'path';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const LIVE = path.join(HERE, '../../worker/live.js');
let src = fs.readFileSync(LIVE,'utf8');
src += '\nexport { compose, when };\n';
fs.writeFileSync('/tmp/live.copy.mjs', src);
const { compose } = await import('/tmp/live.copy.mjs');

let pass=0, fail=0;
const ok=(n,c,x='')=>{ c?(pass++,console.log('  ok   '+n)):(fail++,console.log('  FAIL '+n+(x?'  -> '+x:''))); };
const show = (t,wk,n,wl,w,m) => { const r=compose(t,wk,n,wl,w,m);
  console.log(`     ${r.title}\n     ${r.body}`); return r; };

console.log('\n1. THE MESSAGE THAT MISLED THE OWNER');
console.log('   Sunday night football, 1 pick in that slot, 14 unpicked in the week.');
{ const r = show('open',1,1,14,'Mon 9:20 AM',2000);
  ok('the title no longer claims the week just opened', !/is open/.test(r.title), r.title);
  ok('the title names this deadline', /1 pick due Mon 9:20 AM/.test(r.title), r.title);
  ok('and the body surfaces the real week total', /14 Week 1 games still need a pick/.test(r.body), r.body);
  ok('title fits a lock screen (<= 40 chars)', r.title.length <= 40, String(r.title.length)); }

console.log('\n2. When the slot IS the whole job, it says so instead of a second number');
{ const r = show('open',1,4,4,'Mon 5:25 AM',1800);
  ok('no misleading remainder', !/still need a pick/.test(r.body), r.body);
  ok('says it is everything', /Nothing else in Week 1/.test(r.body), r.body); }

console.log('\n3. Singular and plural');
{ const a=compose('open',2,1,1,'Sun 1:00 PM',1500), b=compose('open',2,8,8,'Sun 1:00 PM',1500);
  ok('1 pick', /^1 pick due/.test(a.title), a.title);
  ok('8 picks', /^8 picks due/.test(b.title), b.title); }

console.log('\n4. The day tier');
{ const r = show('day',1,8,14,'Mon 2:00 AM',900);
  ok('names the deadline, not the week', /8 picks due Mon 2:00 AM/.test(r.title), r.title);
  ok('conveys urgency', /Less than a day/.test(r.body), r.body); }

console.log('\n5. The hours tier');
{ const r = show('hours',1,8,14,'Mon 2:00 AM',185);
  ok('hours are floored, not rounded up', /due in 3 hours/.test(r.title), r.title);
  ok('one hour is singular', /due in 1 hour$/.test(compose('hours',1,2,2,'x',95).title),
     compose('hours',1,2,2,'x',95).title);
  ok('warns about the zero', /score zero/.test(r.body), r.body); }

console.log('\n6. Last call stays about the next 75 minutes and nothing else');
{ const r = show('final',1,8,14,'Mon 2:00 AM',45);
  ok('no week-level noise at the deadline', !/still need a pick|Nothing else/.test(r.body), r.body);
  ok('minutes, and the consequence', /45 minutes/.test(r.body) && /score zero/.test(r.body), r.body);
  ok('title is short', r.title.length <= 32, `${r.title} (${r.title.length})`); }

console.log('\n7. No message repeats its own number pointlessly');
for (const t of ['open','day','hours','final']) {
  const r = compose(t,1,8,14,'Mon 2:00 AM',45);
  const inTitle = (r.title.match(/\b8\b/g)||[]).length;
  const inBody  = (r.body.match(/\b8\b/g)||[]).length;
  ok(`${t}: the slot count appears once`, inTitle + inBody === 1, `${r.title} / ${r.body}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
