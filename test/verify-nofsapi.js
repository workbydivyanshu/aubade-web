// Firefox and Safari have no File System Access API. Simulate that by deleting
// showDirectoryPicker before any script runs, and check the app is usable
// rather than dead — which is what it was: init() returned early, so routing
// never ran and the settings panel painted over the home view.
//
// Chromium with the API removed is not Firefox, so this proves the code path,
// not the browser. Real Firefox still needs a look.
const ENGINE = process.argv[2] || 'chromium';
const pw = require('playwright');
const browserType = pw[ENGINE];
const { PLAYER_URL, seedLibrary, seed } = require('./lib/harness');

(async () => {
  const br = await browserType.launch();
  const p = await br.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
  p.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('[cover-diag]')) errs.push(m.text().slice(0, 120));
  });
  // Real Firefox and WebKit have no such API; only Chromium needs it removed.
  if (ENGINE === 'chromium') await p.addInitScript(() => { delete window.showDirectoryPicker; });

  await p.goto(PLAYER_URL, { waitUntil: 'networkidle' });
  await seed(p);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);

  let bad = 0;
  const check = (label, ok, detail = '') => {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
    if (!ok) bad++;
  };

  // 1. The app renders its library rather than dead-ending.
  const home = await p.evaluate(() => ({
    cards: document.querySelectorAll('#view-home [data-album]').length,
    homeShown: getComputedStyle(document.getElementById('view-home')).display !== 'none',
    settingsShown: (() => {
      const r = document.getElementById('view-settings').getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    })(),
    status: (document.getElementById('status')?.textContent || '').trim().slice(0, 60),
  }));
  check('home renders with the cached library', home.cards > 0, `${home.cards} albums`);
  check('home view is displayed', home.homeShown);
  check('settings is not painted over it', !home.settingsShown);
  check('status is not the old dead-end message',
    !/does not support/i.test(home.status), `status: "${home.status}"`);

  // 2. Routing works — it used to never run at all here.
  for (const [hash, id] of [['#library', 'view-library'], ['#search', 'view-search'],
                            ['#browse', 'view-browse'], ['#settings', 'view-settings']]) {
    await p.evaluate((h) => { location.hash = h; }, hash);
    await p.waitForTimeout(400);
    const shown = await p.evaluate((i) => {
      const el = document.getElementById(i);
      return getComputedStyle(el).display !== 'none';
    }, id);
    check(`route ${hash} shows ${id}`, shown);
  }

  // 3. The reconnect affordance is offered, since playback needs the folder.
  await p.evaluate(() => { location.hash = '#home'; });
  await p.waitForTimeout(400);
  const reconnect = await p.evaluate(() => {
    const b = document.querySelector('.reconnect-btn');
    return b ? b.textContent.trim() : null;
  });
  check('a reconnect prompt is offered', !!reconnect, reconnect || 'none found');

  // 4. Pressing play with no folder connected says so, rather than skipping
  //    two tracks and then blaming the files for having moved. resolveTrackFile
  //    throws a distinct error for exactly this case and nobody was reading it.
  // Each failed track logs one warning, so counting them counts how far the
  // queue was walked. Without this the check passed with the bug in place:
  // three failures still end in clearPlayerUI, so the end state looks the
  // same however many tracks were burned getting there.
  const attempts = [];
  p.on('console', (m) => {
    if (m.text().startsWith('Could not play ')) attempts.push(m.text().slice(15, 60));
  });

  const k = await p.evaluate(() => document.querySelector('[data-album]')?.dataset.album);
  await p.evaluate((x) => { location.hash = '#album/' + x; }, k);
  await p.waitForTimeout(700);
  const played = await p.evaluate(async () => {
    const row = document.querySelector('.track-row');
    const first = row.querySelector('.track-row__title').textContent.trim();
    row.click();
    await new Promise((r) => setTimeout(r, 900));
    const toast = document.getElementById('toast');
    return {
      toast: toast ? toast.textContent.trim() : '',
      open: !!toast && toast.classList.contains('is-open'),
      // Nothing should have been queued past the track that was asked for.
      nowPlaying: (document.querySelector('.player__title')?.textContent || '').trim(),
      first,
      reconnect: !!document.querySelector('.reconnect-btn'),
    };
  });
  check('play without a folder explains itself', played.open &&
    /folder/i.test(played.toast) && !/moved|renamed/i.test(played.toast),
    `"${played.toast}"`);
  check('and stops at the track that was asked for', attempts.length === 1,
    `${attempts.length} track(s) attempted`);
  check('and leaves the player idle rather than half-loaded', played.nowPlaying === '',
    played.nowPlaying ? `player shows "${played.nowPlaying}"` : 'player left idle');

  // 5. The fallback picker is wired to a real directory input.
  const wired = await p.evaluate(() => typeof pickFolderFallback === 'function' ||
    typeof window.pickFolderFallback === 'function');
  console.log(`  ---   fallback picker reachable from page scope: ${wired}` +
              ' (module scope, so false is expected)');

  // The stored index is rebuilt from its own records rather than trusted, so
  // a library written before a naming rule existed heals on the next boot
  // without a rescan. Three boot paths read that index and only one of them
  // went through the rebuild, so the heal never reached this one — the branch
  // taken by every browser without the File System Access API.
  const stale = seedLibrary();
  stale.tracks[0] = { ...stale.tracks[0], albumArtist: '', album: '', title: '' };
  stale.albums = [{ album: '', albumArtist: '', tracks: [stale.tracks[0]] }];
  stale.artists = [{ name: '', albums: stale.albums }];
  await p.goto(PLAYER_URL, { waitUntil: 'networkidle' });
  await seed(p, stale);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  await p.evaluate(() => { location.hash = '#library'; });
  await p.waitForTimeout(800);
  const healed = await p.evaluate(() =>
    (document.getElementById('view-library')?.innerText || '').replace(/\s+/g, ' '));
  check('an index with blank names heals on this boot path too, without a rescan',
    /Unknown Artist|Unknown Album/.test(healed), `"${healed.slice(0, 70)}"`);

  console.log(`\nerrors: ${errs.length ? errs.slice(0, 3).join(' | ') : 'none'}`);
  if (errs.length) bad++;
  await br.close();
  console.log(`[${ENGINE}] ` + (bad === 0 ? 'usable without File System Access' : `${bad} check(s) failed`));
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('FAILED: ' + e.message); process.exit(1); });
