// The six controls that were markup-only. Each should now either do something
// observable or not exist.
//
// This suite used to only print what it found, so it passed whatever the app
// did — the sidebar "collapsed" by one pixel and the log called it OK. Every
// probe below now asserts the behaviour the source promises, and the measured
// value rides along in the detail so a failure names the number.
const { chromium } = require('playwright');
const { PLAYER_URL, seedLibrary, seed } = require('./lib/harness');

(async () => {
  const br = await chromium.launch();
  const ctx = await br.newContext({
    viewport: { width: 1440, height: 900 }, colorScheme: 'dark',
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)); });

  let bad = 0;
  const check = (label, ok, detail = '') => {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
    if (!ok) bad++;
  };

  await p.goto(PLAYER_URL, { waitUntil: 'networkidle' });
  await seed(p);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);

  // ── The sidebar collapse pair ──────────────────────────────────
  // Collapsing is a single class that zeroes the --sidebar-w token and slides
  // the sidebar out; the main column is laid out off that token, so the proof
  // that it worked is main reclaiming the space, not the sidebar's own x.
  // The old "x moved left at all" reading passed on a one-pixel shift.
  const sidebar = () => p.evaluate(() => {
    const r = document.querySelector('.sidebar').getBoundingClientRect();
    const app = document.getElementById('app');
    return {
      x: Math.round(r.x), right: Math.round(r.right), w: Math.round(r.width),
      mainX: Math.round(document.querySelector('.main').getBoundingClientRect().x),
      token: parseInt(getComputedStyle(app).getPropertyValue('--sidebar-w'), 10),
      collapsed: app.classList.contains('is-sidebar-collapsed'),
      stored: localStorage.getItem('aubade_sidebar_collapsed'),
      expandShown: getComputedStyle(document.getElementById('expand-sidebar')).display !== 'none',
    };
  });

  const open0 = await sidebar();
  check('the sidebar starts open at the width its token asks for',
    open0.collapsed === false && open0.x === 0 && open0.w === open0.token && open0.w > 0,
    `x ${open0.x}, ${open0.w}px wide, token ${open0.token}px`);
  check('and the Show sidebar button stays out of the way while it is open',
    open0.expandShown === false);

  await p.evaluate(() => document.querySelector('button[aria-label="Collapse sidebar"]').click());
  await p.waitForTimeout(500);
  const shut = await sidebar();
  check('the Collapse sidebar button takes the whole sidebar off screen',
    shut.collapsed === true && shut.right <= 0,
    `right edge ${open0.right} -> ${shut.right}, class ${shut.collapsed}`);
  check('and the main column reclaims the space it left',
    shut.mainX === 0, `main x ${open0.mainX} -> ${shut.mainX}`);
  check('and the Show sidebar button appears, since the collapse control went with it',
    shut.expandShown === true);
  check('and the collapsed state is written down for the next boot',
    shut.stored === 'true', `aubade_sidebar_collapsed="${shut.stored}"`);

  // Pressing collapse a second time is not the way back — that button now sits
  // inside the hidden sidebar, which is exactly why #expand-sidebar exists.
  await p.evaluate(() => document.querySelector('button[aria-label="Collapse sidebar"]').click());
  await p.waitForTimeout(400);
  const again = await sidebar();
  check('pressing Collapse a second time does not undo it',
    again.collapsed === true && again.mainX === 0,
    `still collapsed=${again.collapsed}, main x ${again.mainX}`);

  await p.evaluate(() => document.getElementById('expand-sidebar').click());
  await p.waitForTimeout(500);
  const back = await sidebar();
  check('Show sidebar brings it back to full width',
    back.collapsed === false && back.x === 0 && back.w === open0.w && back.mainX === open0.mainX,
    `x ${back.x}, ${back.w}px wide, main x ${back.mainX}`);
  check('and that is written down too',
    back.stored === 'false', `aubade_sidebar_collapsed="${back.stored}"`);

  // ── The Library / Folders segmented pill ───────────────────────
  // Only Folders was wired, so pressing Library did nothing at all and looked
  // broken. It routes and it moves the active segment.
  await p.evaluate(() => document.getElementById('seg-library').click());
  await p.waitForTimeout(600);
  const seg = await p.evaluate(() => ({
    hash: location.hash,
    libActive: document.getElementById('seg-library').classList.contains('seg-pill__seg--active'),
    foldersActive: document.getElementById('seg-folders').classList.contains('seg-pill__seg--active'),
    libShown: document.getElementById('view-library').style.display,
    othersShown: ['home', 'album', 'search', 'artist', 'settings', 'liked']
      .filter((id) => {
        const e = document.getElementById('view-' + id);
        return e && e.style.display !== 'none';
      }),
  }));
  check('the Library segment routes to the library', seg.hash === '#library', seg.hash);
  check('and the library view is the one painted',
    seg.libShown === 'block' && seg.othersShown.length === 0,
    `view-library display "${seg.libShown}"${seg.othersShown.length ? ', also showing ' + seg.othersShown.join(', ') : ''}`);
  check('and the active segment moves onto Library',
    seg.libActive === true && seg.foldersActive === false,
    `library=${seg.libActive} folders=${seg.foldersActive}`);

  // ── The album page's overflow menu ─────────────────────────────
  await p.evaluate(() => { location.hash = '#home'; });
  await p.waitForTimeout(600);
  const k = await p.evaluate(() => document.querySelector('[data-album]').dataset.album);
  await p.evaluate((h) => { location.hash = '#album/' + h; }, k);
  await p.waitForTimeout(1200);

  // The menu is built from the album that is open, so if the route did not
  // render there is nothing for the checks below to be about.
  const rows = await p.evaluate(() =>
    document.querySelectorAll('.album-tracks .track-row').length);
  check('the album route renders the fixture album in full', rows === 12, `${rows} rows`);

  await p.evaluate(() => document.querySelector('.album-btn--more').click());
  await p.waitForTimeout(500);
  const menu = await p.evaluate(() => {
    const m = document.getElementById('album-menu');
    return m ? [...m.querySelectorAll('.np-menu__item')].map((b) => b.textContent) : null;
  });
  check('More options opens a menu', menu !== null, menu === null ? 'no #album-menu' : '');
  // Nothing has been saved as a playlist, so the playlist half of the menu is
  // only its "new playlist" row.
  const wanted = ['Play next', 'Go to artist', 'Copy album name', 'Show in library', '+ New playlist…'];
  check('and it offers exactly the actions a local record has',
    JSON.stringify(menu) === JSON.stringify(wanted), JSON.stringify(menu));

  // Outside click should dismiss it.
  await p.mouse.click(700, 300);
  await p.waitForTimeout(400);
  check('a click anywhere else dismisses the menu',
    await p.evaluate(() => !document.getElementById('album-menu')));

  // Notifications and Add pinned item had nothing they could ever do, so they
  // were deleted rather than left as decoration.
  const gone = await p.evaluate(() => ({
    notifications: document.querySelectorAll('[aria-label="Notifications"]').length,
    addPin: document.querySelectorAll('[aria-label="Add pinned item"]').length,
  }));
  check('Notifications and Add pinned item are gone rather than dead',
    gone.notifications === 0 && gone.addPin === 0, JSON.stringify(gone));

  console.log(`\nerrors: ${errs.length ? errs.slice(0, 3).join(' | ') : 'none'}`);
  if (errs.length) bad++;
  await br.close();
  console.log(bad === 0 ? 'every piece of chrome checked here does what it looks like it does' : `${bad} check(s) failed`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('FAILED: ' + e.message); process.exit(1); });
