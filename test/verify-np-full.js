// Check the whole now-playing view against the reference, not just the parts
// last edited. The targets are from two console dumps off the running site,
// taken at 839px and 1394px wide — they were identical at both, so these are
// viewport-independent and can be compared at any width.
const { chromium } = require('playwright');
const { PLAYER_URL, seedLibrary, seed } = require('./lib/harness');

// selector -> what the reference measures
const TYPE = [
  ['.now-playing__eyebrow', { fontSize: '11px', fontWeight: '500', lineHeight: '16.5px' }],
  ['.now-playing__title', { fontSize: '25.6px', fontWeight: '700', lineHeight: '32px', letterSpacing: '-0.64px' }],
  ['.now-playing__subtitle', { fontSize: '16.8px', fontWeight: '400', lineHeight: '23.1px' }],
  ['.now-playing__time', { fontSize: '11px', fontWeight: '400', lineHeight: '16.5px' }],
  ['.np-quality-row__format', { fontSize: '11px', fontWeight: '600', lineHeight: '16.5px' }],
  ['.np-quality-row__speed', { fontSize: '12px', fontWeight: '600', lineHeight: '16px' }],
  ['.np-lyric-line', { fontSize: '36px', fontWeight: '700', lineHeight: '45px' }],
  ['.np-sync-pill', { fontSize: '12px', fontWeight: '600', lineHeight: '16px' }],
  ['.np-device', { fontSize: '14px', fontWeight: '500', lineHeight: '20px' }],
];

const SIZE = [
  ['.now-playing__cover', 279, 279],
  ['.np-btn--play', 72, 72],
  ['.np-sync-group', 116, 36],
  ['.np-lyric-action', 36, 36],
];

(async () => {
  const br = await chromium.launch();
  const p = await br.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));

  await p.goto(PLAYER_URL, { waitUntil: 'networkidle' });
  await seed(p);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1400);
  await p.evaluate(() => {
    document.querySelector('.now-playing').classList.add('is-open');
    // No track can load headlessly, so lyrics never render. Put one line in
    // so its style can be measured like everything else.
    const pane = document.querySelector('.now-playing__lyrics');
    if (pane && !pane.querySelector('.np-lyric-line')) {
      const l = document.createElement('div');
      l.className = 'np-lyric-line';
      l.textContent = 'measurement line';
      pane.appendChild(l);
    }
  });
  await p.waitForTimeout(500);

  const got = await p.evaluate(({ type, size }) => {
    const out = { type: {}, size: {} };
    for (const [sel, want] of type) {
      const el = document.querySelector(sel);
      if (!el) { out.type[sel] = 'MISSING'; continue; }
      const s = getComputedStyle(el);
      const row = {};
      for (const k of Object.keys(want)) row[k] = s[k];
      out.type[sel] = row;
    }
    for (const [sel] of size) {
      const el = document.querySelector(sel);
      if (!el) { out.size[sel] = 'MISSING'; continue; }
      const r = el.getBoundingClientRect();
      out.size[sel] = [Math.round(r.width), Math.round(r.height)];
    }
    return out;
  }, { type: TYPE, size: SIZE });

  let bad = 0;
  const check = (label, ok, detail = '') => {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
    if (!ok) bad++;
  };

  console.log('── type ──');
  for (const [sel, want] of TYPE) {
    const mine = got.type[sel];
    // a missing element is a failure, not a skipped line — the reference has it.
    check(sel, mine !== 'MISSING' && Object.keys(want).every((k) => mine[k] === want[k]),
      mine === 'MISSING' ? 'MISSING'
        : Object.entries(want).filter(([k, v]) => mine[k] !== v)
            .map(([k, v]) => `${k} want ${v} got ${mine[k]}`).join(', '));
  }
  console.log('── size ──');
  for (const [sel, w, h] of SIZE) {
    const mine = got.size[sel];
    const off = mine === 'MISSING' ? Infinity : Math.abs(mine[0] - w) + Math.abs(mine[1] - h);
    check(sel, off <= 2,
      mine === 'MISSING' ? 'MISSING' : `want ${w}x${h} got ${mine[0]}x${mine[1]}`);
  }

  console.log(`\nerrors: ${errs.length ? errs.slice(0, 3).join(' | ') : 'none'}`);
  if (errs.length) bad++;
  await br.close();
  console.log(bad === 0 ? 'now playing matches the reference' : `${bad} check(s) failed`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('FAILED: ' + e.message); process.exit(1); });
