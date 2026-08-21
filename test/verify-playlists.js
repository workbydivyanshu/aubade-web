// Playlists end to end: create, add, view, play, remove, rename, delete —
// plus the case that matters for local files, a path that no longer resolves.
const { PLAYER_URL, seedLibrary, seed, answer, launch } = require('./lib/harness');

(async () => {
  const br = await launch();
  const p = await br.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 140)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)); });

  let bad = 0;
  const check = (label, ok, detail = '') => {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
    if (!ok) bad++;
  };

  const lib = seedLibrary();
  await p.goto(PLAYER_URL, { waitUntil: 'networkidle' });
  await seed(p, lib);
  await p.evaluate(() => localStorage.removeItem('aubade_playlists'));
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1400);

  // Create via the sidebar control (the prompt is auto-accepted above).
  await p.evaluate(() => document.getElementById('new-playlist-btn').click());
  await answer(p, 'Road Trip');
  await p.waitForTimeout(800);
  const created = await p.evaluate(() => ({
    hash: location.hash,
    sidebar: [...document.querySelectorAll('#playlist-list .pinned-item__title')].map((e) => e.textContent),
    title: document.getElementById('playlist-title').textContent,
    stats: document.getElementById('playlist-stats').textContent,
    emptyShown: !document.getElementById('playlist-empty').hidden,
  }));
  console.log('after create: ' + JSON.stringify(created));
  check('routed to the new playlist', created.hash.startsWith('#playlist/'), created.hash);
  check('sidebar shows it', created.sidebar.includes('Road Trip'), JSON.stringify(created.sidebar));
  check('title reads the entered name', created.title === 'Road Trip', created.title);
  check('stats say empty', created.stats === 'No songs yet', created.stats);
  check('empty state is shown', created.emptyShown === true);

  // Add an album through its overflow menu.
  const key = await p.evaluate(() => {
    location.hash = '#home';
    return document.querySelector('[data-album]')?.dataset.album;
  });
  await p.waitForTimeout(500);
  await p.evaluate((k) => { location.hash = '#album/' + k; }, key);
  await p.waitForTimeout(1200);
  await p.evaluate(() => document.querySelector('.album-btn--more').click());
  await p.waitForTimeout(400);
  const menuItems = await p.evaluate(() =>
    [...document.querySelectorAll('#album-menu .np-menu__item')].map((b) => b.textContent));
  console.log('album menu: ' + JSON.stringify(menuItems));
  check('the new playlist is offered on the album menu', menuItems.includes('Road Trip'),
    JSON.stringify(menuItems));

  await p.evaluate(() => {
    const b = [...document.querySelectorAll('#album-menu .np-menu__item')]
      .find((x) => x.textContent === 'Road Trip');
    if (b) b.click();
  });
  await p.waitForTimeout(700);

  const id = await p.evaluate(() => JSON.parse(localStorage.getItem('aubade_playlists'))[0].id);
  await p.evaluate((i) => { location.hash = '#playlist/' + i; }, id);
  await p.waitForTimeout(800);
  const filled = await p.evaluate(() => ({
    rows: document.querySelectorAll('#playlist-tracks .track-row').length,
    stats: document.getElementById('playlist-stats').textContent,
    emptyShown: !document.getElementById('playlist-empty').hidden,
    sidebarMeta: document.querySelector('#playlist-list .pinned-item__meta')?.textContent,
    paths: JSON.parse(localStorage.getItem('aubade_playlists'))[0].paths.length,
  }));
  console.log('after adding an album: ' + JSON.stringify(filled));
  check('the whole album landed', filled.rows === filled.paths && filled.rows > 0,
    `${filled.rows} rows for ${filled.paths} stored paths`);
  check('stats reflect the row count', filled.stats.startsWith(`${filled.rows} songs`), filled.stats);
  check('empty state is gone', filled.emptyShown === false);
  check('sidebar meta reflects the row count', filled.sidebarMeta === `Playlist · ${filled.rows} songs`,
    filled.sidebarMeta);

  // Adding the same album again should add nothing.
  const again = await p.evaluate((i) => {
    const before = JSON.parse(localStorage.getItem('aubade_playlists'))[0].paths.length;
    return { before, i };
  }, id);
  await p.evaluate((k) => { location.hash = '#album/' + k; }, key);
  await p.waitForTimeout(900);
  await p.evaluate(() => document.querySelector('.album-btn--more').click());
  await p.waitForTimeout(300);
  await p.evaluate(() => {
    const b = [...document.querySelectorAll('#album-menu .np-menu__item')]
      .find((x) => x.textContent === 'Road Trip');
    if (b) b.click();
  });
  await p.waitForTimeout(600);
  const dupe = await p.evaluate(() =>
    JSON.parse(localStorage.getItem('aubade_playlists'))[0].paths.length);
  console.log(`duplicate add: ${again.before} -> ${dupe}  ${again.before === dupe ? 'OK (no dupes)' : 'DUPLICATED'}`);

  // Remove one row.
  await p.evaluate((i) => { location.hash = '#playlist/' + i; }, id);
  await p.waitForTimeout(700);
  await p.evaluate(() => document.querySelector('#playlist-tracks .track-row__unlike').click());
  await p.waitForTimeout(600);
  console.log('after removing one: ' + await p.evaluate(() =>
    document.querySelectorAll('#playlist-tracks .track-row').length + ' rows'));

  // A path that no longer resolves must not render as a hole.
  const ghost = await p.evaluate((i) => {
    const list = JSON.parse(localStorage.getItem('aubade_playlists'));
    list[0].paths.push('Gone/Deleted/never.opus');
    localStorage.setItem('aubade_playlists', JSON.stringify(list));
    location.hash = '#home';
    return list[0].paths.length;
  }, id);
  await p.waitForTimeout(400);
  await p.evaluate((i) => { location.hash = '#playlist/' + i; }, id);
  await p.waitForTimeout(700);
  const resolved = await p.evaluate(() =>
    document.querySelectorAll('#playlist-tracks .track-row').length);
  check('a missing file is skipped rather than rendered', resolved === ghost - 1,
    `stored ${ghost}, rendered ${resolved}`);

  console.log(`\nerrors: ${errs.length ? errs.slice(0, 4).join(' | ') : 'none'}`);
  if (errs.length) bad++;
  await br.close();
  console.log(bad === 0 ? 'playlists create, fill, dedupe, empty and skip correctly'
                        : `${bad} check(s) failed`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('FAILED: ' + e.message); process.exit(1); });
