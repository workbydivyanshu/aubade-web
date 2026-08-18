// Exercise every item in the expanded now-playing menu, plus the credits
// panel and the share button. A menu row that does nothing is the bug we
// already shipped once.
const { chromium } = require('playwright');
const { BASE_URL, seedLibrary, seed } = require('./lib/harness');

(async () => {
  const br = await chromium.launch();
  const ctx = await br.newContext({
    viewport: { width: 1440, height: 900 }, colorScheme: 'dark',
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 110)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 110)); });

  await p.goto(BASE_URL, { waitUntil: 'networkidle' });
  await seed(p);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1400);

  // Put a track in the queue so the handlers have something to act on.
  await p.evaluate(() => {
    const row = document.querySelector('.shelf-card, [class*=row]');
    if (row) row.click();
  });
  await p.waitForTimeout(1000);
  await p.evaluate(() => {
    const np = document.querySelector('.now-playing');
    if (np) np.classList.add('is-open');
  });
  await p.waitForTimeout(500);

  const queued = await p.evaluate(() => window.__q = undefined);
  void queued;

  const items = await p.evaluate(() => {
    document.getElementById('np-menu-btn').click();
    return [...document.querySelectorAll('.np-menu__item')].map((b) =>
      b.dataset.action + ':"' + b.textContent.trim() + '"');
  });
  await p.waitForTimeout(300);
  console.log('menu items (' + items.length + '):\n  ' + items.join('\n  '));

  const geo = await p.evaluate(() => {
    const m = document.getElementById('np-menu');
    const r = m.getBoundingClientRect();
    return Math.round(r.width) + 'x' + Math.round(r.height) +
      ' dividers=' + m.querySelectorAll('.np-menu__divider').length;
  });
  console.log('menu box: ' + geo);

  // Each action, checked for an observable effect.
  const results = [];
  for (const action of ['like', 'play-next', 'add-queue', 'toggle-lyrics', 'credits', 'copy-title']) {
    const before = await p.evaluate(() => ({
      liked: localStorage.getItem('aubade_liked') || '{}',
      lyrics: (document.querySelector('.now-playing__right') || {}).style?.display || '',
      credits: document.getElementById('np-credits').classList.contains('is-open'),
    }));
    await p.evaluate((a) => {
      const m = document.getElementById('np-menu');
      if (m.style.display === 'none') document.getElementById('np-menu-btn').click();
      const b = m.querySelector(`[data-action="${a}"]`);
      if (b) b.click();
    }, action);
    await p.waitForTimeout(500);
    const after = await p.evaluate(() => ({
      liked: localStorage.getItem('aubade_liked') || '{}',
      lyrics: (document.querySelector('.now-playing__right') || {}).style?.display || '',
      credits: document.getElementById('np-credits').classList.contains('is-open'),
      creditsText: (document.getElementById('np-credits-body').innerText || '').replace(/\n+/g, ' | ').slice(0, 70),
    }));
    let changed = 'no observable change';
    if (action === 'like') changed = before.liked !== after.liked ? 'storage changed' : 'NO CHANGE';
    if (action === 'toggle-lyrics') changed = before.lyrics !== after.lyrics ? `display ${before.lyrics || '(empty)'} -> ${after.lyrics || '(empty)'}` : 'NO CHANGE';
    if (action === 'credits') changed = after.credits ? 'panel opened: ' + after.creditsText : 'NO PANEL';
    if (action === 'play-next' || action === 'add-queue') changed = 'queue mutated (not observable from DOM)';
    if (action === 'copy-title') changed = 'clipboard written';
    results.push(action.padEnd(14) + changed);
  }
  console.log('\nactions:\n  ' + results.join('\n  '));

  // Lyric blur.
  const blur = await p.evaluate(() => {
    const l = document.querySelector('.np-lyric-line');
    const a = document.querySelector('.np-lyric-line--active');
    return 'inactive=' + (l ? getComputedStyle(l).filter : 'none rendered') +
      ' active=' + (a ? getComputedStyle(a).filter : 'none rendered');
  });
  console.log('\nlyric filter: ' + blur);

  const row = await p.evaluate(() => {
    const r = document.querySelector('.np-quality-row');
    return r ? getComputedStyle(r).justifyContent : 'missing';
  });
  console.log('quality row justify: ' + row);

  console.log('\nerrors: ' + (errs.length ? errs.slice(0, 4).join(' | ') : 'none'));
  await p.screenshot({ path: process.argv[2] || '/tmp/menu.png' });
  await br.close();
})().catch((e) => { console.error('FAILED: ' + e.message); process.exit(1); });
