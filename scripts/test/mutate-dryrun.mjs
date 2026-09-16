/* Does every mutation's `find` string still match the app exactly once?

   A mutation whose find string has drifted reports "matched 0 times"
   and is silently NOT APPLIED — so the batch runs against unmutated
   code, every expected assertion stays green, and the harness reports
   that the tests failed to catch their bug. That is the right complaint
   for the wrong reason, and it takes a full suite run per batch to
   discover. This checks all of them in a second.

   Run: node mutate-dryrun.mjs
*/
import fs from 'node:fs';

const APP = fs.readFileSync(new URL('../../index.html', import.meta.url).pathname, 'utf8');
const SRC = fs.readFileSync(new URL('./mutate.mjs', import.meta.url).pathname, 'utf8');

/* Import the table without running the harness: strip everything after
   the MUTATIONS array and eval just that. Crude, and better than
   duplicating the table. */
const start = SRC.indexOf('const MUTATIONS = [');
const end = SRC.indexOf('\n];', start) + 3;
const MUTATIONS = (new Function(SRC.slice(start, end) + '\nreturn MUTATIONS;'))();

let bad = 0;
for (const [batch, label, find] of MUTATIONS) {
  const n = APP.split(find).length - 1;
  if (n === 1) { console.log(`  ok   [${batch}] ${label}`); continue; }
  bad++;
  console.log(` MATCH ${n} [${batch}] ${label}`);
  console.log(`       find began: ${JSON.stringify(find.slice(0, 90))}`);
}
console.log(`\n${MUTATIONS.length - bad} of ${MUTATIONS.length} mutations still apply`);
process.exit(bad ? 1 : 0);
