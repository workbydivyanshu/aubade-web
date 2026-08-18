// The greeting was a literal in the markup, so the home page said "Good
// evening" at breakfast — visible in a screenshot taken at 07:46.
//
// The reference's own greeting does not follow the client clock: faking the
// time and reloading it returned the same words at 00:30 and 22:30, so there
// were no boundaries to copy and these are the conventional ones.
const { chromium } = require('playwright');
const { PLAYER_URL, seed } = require('./lib/harness');

const CASES = [
  [8, 'Good morning'],
  [11, 'Good morning'],
  [12, 'Good afternoon'],
  [16, 'Good afternoon'],
  [17, 'Good evening'],
  [23, 'Good evening'],
  [2, 'Good evening'],
];

(async () => {
  const br = await chromium.launch();
  let bad = 0;
  for (const [hour, expected] of CASES) {
    const ctx = await br.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
    await ctx.clock.setFixedTime(new Date(2026, 7, 18, hour, 30, 0));
    const p = await ctx.newPage();
    await p.goto(PLAYER_URL, { waitUntil: 'networkidle' });
    await seed(p);
    await p.reload({ waitUntil: 'networkidle' });
    await p.waitForTimeout(800);
    const said = await p.evaluate(() => document.getElementById('greeting').textContent.trim());
    const ok = said === expected;
    if (!ok) bad++;
    console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${String(hour).padStart(2, '0')}:30 → "${said}"` +
                (ok ? '' : `  (expected "${expected}")`));
    await ctx.close();
  }
  await br.close();
  console.log(bad === 0 ? 'the greeting follows the clock' : `${bad} hour(s) wrong`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('FAILED: ' + e.message); process.exit(1); });
