// The Liked Songs route was dead. Seed some likes, visit it, and check it
// renders, counts, unlikes, and reaches the empty state.
const { chromium } = require('playwright');
const { PLAYER_URL, seedLibrary, seed } = require('./lib/harness');

(async () => {
  const br = await chromium.launch();
  const p = await br.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)); });

  const lib = seedLibrary();
  await p.goto(PLAYER_URL, { waitUntil: 'networkidle' });
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

  let bad = 0;
  const check = (label, ok, detail = '') => {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
    if (!ok) bad++;
  };

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
  check('the liked view is shown', state.visible === 'block');
  check('no other view is painted underneath it', state.otherViewsShown.length === 0,
    state.otherViewsShown.join(', '));
  check('all 5 liked tracks are rendered', state.rows === 5, `${state.rows} rows`);
  check('the stats line counts them', state.stats === '5 songs · 11 min', state.stats);
  check('the empty state is hidden', state.emptyHidden === true);
  check('the title reads Liked Songs', state.title === 'Liked Songs', state.title);

  // The sidebar link should reach it.
  await p.evaluate(() => { location.hash = '#home'; });
  await p.waitForTimeout(400);
  await p.evaluate(() => {
    const a = document.querySelector('a[href="#liked-songs"]');
    if (a) a.click();
  });
  await p.waitForTimeout(700);
  check('sidebar link lands on liked view', await p.evaluate(() =>
    document.getElementById('view-liked').style.display === 'block'));

  // Unlike one.
  await p.evaluate(() => {
    const b = document.querySelector('#liked-tracks .track-row__unlike');
    if (b) b.click();
  });
  await p.waitForTimeout(600);
  const afterUnlike = await p.evaluate(() => ({
    rows: document.querySelectorAll('#liked-tracks .track-row').length,
    stats: document.getElementById('liked-stats').textContent,
  }));
  console.log(`after one unlike: ${afterUnlike.rows} rows, stats "${afterUnlike.stats}"`);
  check('unliking removes exactly one row', afterUnlike.rows === 4, `${afterUnlike.rows} rows`);
  check('the stats line updates with it', afterUnlike.stats === '4 songs · 9 min', afterUnlike.stats);

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
  check('no rows remain', empty.rows === 0, `${empty.rows} rows`);
  check('the empty state is shown', empty.emptyShown === true);
  check('the stats line reads the empty message', empty.stats === 'No songs yet', empty.stats);
  check('play is disabled with nothing to play', empty.playDisabled === true);

  await p.screenshot({ path: process.argv[2] || '/tmp/liked.png' });
  console.log(`\nerrors: ${errs.length ? errs.slice(0, 3).join(' | ') : 'none'}`);
  if (errs.length) bad++;
  await br.close();
  console.log(bad === 0 ? 'liked songs renders, counts, unlikes, and empties out correctly' : `${bad} check(s) failed`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('FAILED: ' + e.message); process.exit(1); });
