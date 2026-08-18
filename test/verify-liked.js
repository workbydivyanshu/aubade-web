// The Liked Songs route was dead. Seed some likes, visit it, and check it
// renders, counts, unlikes, and reaches the empty state.
const { chromium } = require('playwright');
const { BASE_URL, seedLibrary, seed } = require('./lib/harness');

(async () => {
  const br = await chromium.launch();
  const p = await br.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)); });

  const lib = seedLibrary();
  await p.goto(BASE_URL, { waitUntil: 'networkidle' });
  await seed(p, lib);

  // Like five tracks before load.
  const paths = lib.tracks.slice(0, 5).map((t) => t.path);
  await p.evaluate((ps) => {
    const liked = {};
    for (const path of ps) liked[path] = true;
    localStorage.setItem('aubade_liked', JSON.stringify(liked));
  }, paths);

  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1400);

  await p.evaluate(() => { location.hash = '#liked-songs'; });
  await p.waitForTimeout(900);

  const state = await p.evaluate(() => ({
    visible: document.getElementById('view-liked').style.display,
    otherViewsShown: ['home', 'album', 'search', 'library', 'artist', 'settings']
      .filter((id) => {
        const e = document.getElementById('view-' + id);
        return e && e.style.display !== 'none';
      }),
    rows: document.querySelectorAll('#liked-tracks .track-row').length,
    stats: (document.getElementById('liked-stats') || {}).textContent,
    emptyHidden: document.getElementById('liked-empty').hidden,
    title: (document.getElementById('liked-title') || {}).textContent,
  }));
  console.log('with 5 liked:', JSON.stringify(state));

  // The sidebar link should reach it.
  await p.evaluate(() => { location.hash = '#home'; });
  await p.waitForTimeout(400);
  await p.evaluate(() => {
    const a = document.querySelector('a[href="#liked-songs"]');
    if (a) a.click();
  });
  await p.waitForTimeout(700);
  console.log('sidebar link lands on liked view: ' + await p.evaluate(() =>
    document.getElementById('view-liked').style.display === 'block'));

  // Unlike one.
  await p.evaluate(() => {
    const b = document.querySelector('#liked-tracks .track-row__unlike');
    if (b) b.click();
  });
  await p.waitForTimeout(600);
  console.log('after one unlike: ' + await p.evaluate(() =>
    document.querySelectorAll('#liked-tracks .track-row').length + ' rows, stats "' +
    document.getElementById('liked-stats').textContent + '"'));

  // Empty state.
  await p.evaluate(() => {
    localStorage.setItem('aubade_liked', '{}');
    location.hash = '#home';
  });
  await p.waitForTimeout(300);
  await p.evaluate(() => { location.hash = '#liked-songs'; });
  await p.waitForTimeout(700);
  const empty = await p.evaluate(() => ({
    rows: document.querySelectorAll('#liked-tracks .track-row').length,
    emptyShown: !document.getElementById('liked-empty').hidden,
    stats: document.getElementById('liked-stats').textContent,
    playDisabled: document.getElementById('liked-play').disabled,
  }));
  console.log('empty state:', JSON.stringify(empty));

  await p.screenshot({ path: process.argv[2] || '/tmp/liked.png' });
  console.log('errors: ' + (errs.length ? errs.slice(0, 4).join(' | ') : 'none'));
  await br.close();
})().catch((e) => { console.error('FAILED: ' + e.message); process.exit(1); });
