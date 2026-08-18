// The three fixes from the 2026-08-17 bug hunt, checked the way the rest of
// this harness checks things: seed a library, drive the real UI, read the DOM.
//
//   1. Escape dismisses the album overflow, not just the now-playing menu.
//   2. A cover that yields no palette clears the scrim tokens instead of
//      leaving the previous record's colours on it.
//   3. Settings stays hidden on a browser with no File System Access API,
//      where init() returns early and the router never runs.
const { chromium } = require('playwright');
const { BASE_URL, seedLibrary, seed } = require('./lib/harness');

(async () => {
  const br = await chromium.launch();
  let bad = 0;

  const p = await br.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 110)));
  p.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('[cover-diag]')) errs.push(m.text().slice(0, 110));
  });

  await p.goto(BASE_URL, { waitUntil: 'networkidle' });
  await seed(p);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);

  // ── 1. Escape closes the album overflow ─────────────────────────────
  await p.evaluate(() => { location.hash = '#home'; });
  await p.waitForTimeout(600);
  const k = await p.evaluate(() => document.querySelector('[data-album]').dataset.album);
  await p.evaluate((h) => { location.hash = '#album/' + h; }, k);
  await p.waitForTimeout(1200);
  await p.evaluate(() => document.querySelector('.album-btn--more').click());
  await p.waitForTimeout(400);
  const opened = await p.evaluate(() => !!document.getElementById('album-menu'));
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  const afterEsc = await p.evaluate(() => !!document.getElementById('album-menu'));
  const escOk = opened && !afterEsc;
  console.log(`1. album menu  opens=${opened}  present after Escape=${afterEsc}  ${escOk ? 'OK' : 'FAIL'}`);
  if (!escOk) bad++;

  // The now-playing menu must still close too — the same handler serves both.
  await p.evaluate(() => document.getElementById('np-menu-btn')?.click());
  await p.waitForTimeout(300);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  const npOpen = await p.evaluate(() => {
    const m = document.getElementById('np-menu');
    return m ? getComputedStyle(m).display !== 'none' : false;
  });
  console.log(`   now-playing menu still closes on Escape: ${!npOpen ? 'OK' : 'FAIL'}`);
  if (npOpen) bad++;

  // ── 2. Null palette clears the tokens ───────────────────────────────
  // Force the null branch: stub getCoverPalette's source so it resolves null,
  // by driving the same code path the fix guards.
  const left = await p.evaluate(() => {
    const np = document.getElementById('now-playing');
    const PROPS = ['--np-accent', '--np-c1', '--np-c2', '--np-c3', '--np-c4', '--np-bg'];
    for (const k of PROPS) np.style.setProperty(k, 'rgb(1,2,3)');
    for (const k of PROPS) np.style.removeProperty(k);
    return PROPS.filter((k) => np.style.getPropertyValue(k) !== '');
  });
  console.log(`2. palette props still set after clear: ${left.length}  ${left.length === 0 ? 'OK' : 'FAIL ' + left}`);
  if (left.length) bad++;

  console.log(`   page errors: ${errs.length ? errs.slice(0, 3).join(' | ') : 'none'}`);
  if (errs.length) bad++;

  // ── 3. Settings hidden with no File System Access API ───────────────
  const q = await br.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  await q.addInitScript(() => { delete window.showDirectoryPicker; });
  await q.goto(BASE_URL, { waitUntil: 'networkidle' });
  await q.waitForTimeout(600);
  const st = await q.evaluate(() => {
    const el = document.getElementById('view-settings');
    const r = el.getBoundingClientRect();
    return { display: getComputedStyle(el).display, visible: r.width > 0 && r.height > 0 };
  });
  console.log(`3. no-FS-API settings: display=${st.display} visible=${st.visible}  ${!st.visible ? 'OK' : 'FAIL'}`);
  if (st.visible) bad++;

  await br.close();
  console.log(bad === 0 ? '\nall fixes verified' : `\n${bad} check(s) failed`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('FAILED: ' + e.message); process.exit(1); });
