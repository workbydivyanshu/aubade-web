// Every row in the now-playing overflow menu, driven for an effect.
//
// The menu's click handler opens with `if (!record) return`, so with nothing
// queued every row is silently inert. This suite used to measure exactly that
// — like, toggle-lyrics and credits all reported NO CHANGE — and then print
// the words and exit 0, because clicking a shelf card never filled the queue.
// A menu is the easiest place in the app to ship a dead control: it opens, it
// renders, every row lights up under the cursor, and half of them can do
// nothing. So a track is queued first, and each row now has to move something
// the page can see — storage, the queue list, a panel, the route, the
// clipboard — and to close the menu behind it.
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
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 110)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 110)); });
  // '+ New playlist…' asks for a name. Nothing here means to reach it, but an
  // unanswered prompt would hang the whole run rather than fail a check.
  p.on('dialog', (d) => d.accept('From the menu'));

  let bad = 0;
  const check = (label, ok, detail = '') => {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
    if (!ok) bad++;
  };

  // Driving a known album means every row's effect has an exact expected
  // value rather than whatever happened to be first on the home shelf.
  const lib = seedLibrary();
  const album = lib.albums[0];

  await p.goto(PLAYER_URL, { waitUntil: 'networkidle' });
  await seed(p, lib);
  // One playlist exists up front, so 'Add to playlist' has a real destination
  // to offer and not just the "make a new one" fallback.
  await p.evaluate(() => localStorage.setItem('aubade_playlists', JSON.stringify(
    [{ id: 'plfixture', name: 'Test Bin', created: 1, paths: [] }])));
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1400);

  // Nothing can actually play headlessly — the folder picker cannot be driven
  // — but clicking a track row still fills the queue, and the queue is what
  // every one of these rows acts on.
  await p.evaluate((k) => { location.hash = '#album/' + encodeURIComponent(k); }, album.key);
  await p.waitForTimeout(900);
  // Scoped to the album's own list: a bare .track-row picks up the home
  // view's rows, which are still in the document behind the album page and
  // put a different track in the queue than the one being asserted about.
  await p.evaluate(() => document.querySelector('.album-tracks .track-row')?.click());
  await p.waitForTimeout(1000);
  await p.evaluate(() => document.getElementById('app').classList.remove('is-idle'));
  await p.click('.player__icon-btn[aria-label="Expand now playing"]');
  await p.waitForTimeout(600);

  check('the now-playing sheet opens', await p.evaluate(() =>
    document.querySelector('.now-playing').classList.contains('is-open')));

  const menuOpen = () => p.evaluate(() =>
    document.getElementById('np-menu').style.display === 'block');
  const openMenu = async () => {
    await p.evaluate(() => {
      const m = document.getElementById('np-menu');
      if (m.style.display !== 'block') document.getElementById('np-menu-btn').click();
    });
    await p.waitForTimeout(200);
  };
  // Each row is meant to close the menu on its way out; anything that does
  // not is collected and reported once at the end.
  const leftOpen = [];
  const clickItem = async (action) => {
    await openMenu();
    await p.evaluate((a) => document.querySelector(`#np-menu [data-action="${a}"]`)?.click(), action);
    await p.waitForTimeout(450);
    if (await menuOpen()) leftOpen.push(action);
  };

  // The queue list is only built when the panel opens, so it has to be shut
  // and reopened to see a mutation that happened while it was already up.
  const queueTitles = async () => {
    await p.evaluate(() => {
      const btn = document.getElementById('np-queue-btn');
      if (!document.getElementById('np-queue').hidden) btn.click();
      btn.click();
    });
    await p.waitForTimeout(300);
    return p.evaluate(() => {
      const rows = [...document.querySelectorAll('#np-queue-list .np-queue__row')];
      return {
        titles: rows.map((r) => r.querySelector('.np-queue__track').textContent),
        current: rows.findIndex((r) => r.classList.contains('is-current')),
      };
    });
  };
  const closeQueue = async () => {
    await p.evaluate(() => {
      if (!document.getElementById('np-queue').hidden) document.getElementById('np-queue-btn').click();
    });
    await p.waitForTimeout(250);
  };

  // Which track ends up current is the app's decision, not the test's: no
  // file can be decoded headlessly, so playTrack skips two and gives up on
  // the third, leaving the queue pointing there. Read it back and hold the
  // rest of the suite to the record the queue actually names.
  const q0 = await queueTitles();
  console.log(`queue after clicking the album: ${q0.titles.length} rows, current at ${q0.current}`);
  check('the queue holds the album the row came from',
    q0.titles.length === album.tracks.length,
    `${q0.titles.length} rows, expected ${album.tracks.length}`);
  check('a track is current for the menu rows to act on', q0.current >= 0,
    q0.current < 0 ? 'no row is marked current' : `row ${q0.current}`);
  const track = album.tracks[q0.current] || album.tracks[0];
  check('and the queue lists the album in its own order',
    q0.titles.join('|') === album.tracks.map((t) => t.title).join('|'),
    `current row "${q0.titles[q0.current]}", fixture "${track.title}"`);
  await closeQueue();

  // ── What the menu is made of ───────────────────────────────────
  const items = await p.evaluate(() => {
    document.getElementById('np-menu-btn').click();
    return [...document.querySelectorAll('#np-menu .np-menu__item')].map((b) =>
      b.dataset.action + ':"' + b.textContent.trim() + '"');
  });
  await p.waitForTimeout(300);
  console.log('menu items (' + items.length + '):\n  ' + items.join('\n  '));
  check('the More options button opens the menu', await menuOpen());
  const EXPECTED = [
    'like:"Add to Liked Songs"', 'play-next:"Play next"', 'add-playlist:"Add to playlist"',
    'add-queue:"Add to queue"', 'go-album:"Go to album"', 'go-artist:"Go to artist"',
    'toggle-lyrics:"Hide lyrics"', 'credits:"View credits"', 'copy-title:"Copy title"',
  ];
  check('it lists the nine rows the markup declares, in order',
    items.join('|') === EXPECTED.join('|'), `${items.length} rows: ${items.join(', ')}`);

  const geo = await p.evaluate(() => {
    const m = document.getElementById('np-menu');
    const r = m.getBoundingClientRect();
    const rows = [...m.querySelectorAll('.np-menu__item')].map((b) => b.getBoundingClientRect());
    return {
      w: Math.round(r.width), h: Math.round(r.height),
      dividers: m.querySelectorAll('.np-menu__divider').length,
      // A popover shorter than its contents hides rows below the fold, which
      // looks exactly like a menu that is simply missing them.
      clipped: rows.filter((b) => b.top < r.top - 1 || b.bottom > r.bottom + 1).length,
      afterDivider: [...m.children].findIndex((c) => c.classList.contains('np-menu__divider')),
    };
  });
  console.log(`menu box: ${geo.w}x${geo.h} dividers=${geo.dividers}`);
  check('the popover is the 248px the stylesheet sets', geo.w === 248, `${geo.w}px`);
  check('no row is clipped out of the popover', geo.clipped === 0, `${geo.clipped} row(s) outside the box`);
  check('the reference\'s one divider is drawn', geo.dividers === 1, String(geo.dividers));
  check('and it splits the list after Add to queue', geo.afterDivider === 4,
    `divider sits at child index ${geo.afterDivider}`);

  // ── Add to Liked Songs ─────────────────────────────────────────
  const liked = () => p.evaluate(() =>
    Object.keys(JSON.parse(localStorage.getItem('aubade_liked') || '{}')));
  const likedBefore = await liked();
  await clickItem('like');
  const likedAfter = await liked();
  check('Add to Liked Songs writes the track to storage',
    likedAfter.length === likedBefore.length + 1,
    `${likedBefore.length} liked -> ${likedAfter.length}`);
  check('and stores it under the queued track\'s own path',
    likedAfter.includes(track.path), likedAfter.join(', ') || '(nothing stored)');
  await openMenu();
  const likeLabel = await p.evaluate(() =>
    document.querySelector('#np-menu [data-action="like"] [data-label]').textContent);
  check('and the row then offers to undo it', likeLabel === 'Remove from Liked Songs', `"${likeLabel}"`);
  await clickItem('like');
  const likedUndone = await liked();
  check('clicking it a second time unlikes the track',
    likedUndone.length === likedBefore.length, `${likedUndone.length} liked`);

  // ── Play next and Add to queue ─────────────────────────────────
  // These two mutate playerState, which nothing exposes; the queue panel is
  // where the mutation becomes something a person could actually see.
  const qBefore = await queueTitles();
  await closeQueue();

  await clickItem('play-next');
  const qNext = await queueTitles();
  check('Play next inserts the track right after the current one',
    qNext.titles.length === qBefore.titles.length + 1 &&
    qNext.titles[qNext.current + 1] === track.title,
    `${qBefore.titles.length} -> ${qNext.titles.length} rows, next up "${qNext.titles[qNext.current + 1]}"`);
  await closeQueue();

  await clickItem('add-queue');
  const qEnd = await queueTitles();
  check('Add to queue appends it to the end instead',
    qEnd.titles.length === qNext.titles.length + 1 &&
    qEnd.titles[qEnd.titles.length - 1] === track.title,
    `${qNext.titles.length} -> ${qEnd.titles.length} rows, last row "${qEnd.titles[qEnd.titles.length - 1]}"`);
  await closeQueue();

  // ── Add to playlist ────────────────────────────────────────────
  await clickItem('add-playlist');
  const picker = await p.evaluate(() => {
    const m = document.getElementById('album-menu');
    return m ? [...m.querySelectorAll('.np-menu__item')].map((b) => b.textContent) : null;
  });
  check('Add to playlist opens the playlist picker',
    !!picker && picker.includes('Test Bin') && picker.includes('+ New playlist…'),
    picker ? picker.join(', ') : 'no #album-menu appeared');
  await p.evaluate(() => [...document.querySelectorAll('#album-menu .np-menu__item')]
    .find((b) => b.textContent === 'Test Bin')?.click());
  await p.waitForTimeout(450);
  const inPlaylist = await p.evaluate(() =>
    (JSON.parse(localStorage.getItem('aubade_playlists') || '[]')[0] || {}).paths || []);
  const addToast = await p.evaluate(() => (document.getElementById('toast') || {}).textContent || '');
  check('and picking a playlist really adds the track to it',
    inPlaylist.includes(track.path), `stored paths ${JSON.stringify(inPlaylist)}`);
  check('and says which playlist it went to', /added 1 to test bin/i.test(addToast),
    `toast "${addToast}"`);

  // ── Hide / Show lyrics ─────────────────────────────────────────
  // The toggle refuses to hide a pane the queue is currently borrowing — it
  // hands the pane back instead — so the queue has to be shut first or this
  // row looks dead for a reason that has nothing to do with the row.
  await closeQueue();
  const lyricsDisplay = () => p.evaluate(() =>
    document.querySelector('.now-playing__right').style.display);
  const dBefore = await lyricsDisplay();
  await clickItem('toggle-lyrics');
  const dAfter = await lyricsDisplay();
  check('Hide lyrics hides the lyrics pane',
    dBefore !== 'none' && dAfter === 'none',
    `display "${dBefore || '(empty)'}" -> "${dAfter || '(empty)'}"`);
  await openMenu();
  const lyricsLabel = await p.evaluate(() =>
    document.querySelector('#np-menu [data-action="toggle-lyrics"] [data-label]').textContent);
  check('and the row then offers to bring them back', lyricsLabel === 'Show lyrics', `"${lyricsLabel}"`);
  await clickItem('toggle-lyrics');
  const dBack = await lyricsDisplay();
  check('and clicking it again shows them', dBack !== 'none', `display "${dBack || '(empty)'}"`);

  // ── View credits ───────────────────────────────────────────────
  await clickItem('credits');
  await p.waitForTimeout(700);
  const credits = await p.evaluate(() => {
    const body = document.getElementById('np-credits-body');
    return {
      open: document.getElementById('np-credits').classList.contains('is-open'),
      keys: [...body.querySelectorAll('.np-credits__key')].map((e) => e.textContent),
      values: [...body.querySelectorAll('.np-credits__value')].map((e) => e.textContent),
      text: (body.innerText || '').replace(/\n+/g, ' | ').slice(0, 70),
    };
  });
  check('View credits opens the credits panel', credits.open, credits.text || '(empty panel)');
  // The tag reader needs the folder handle, which headless cannot grant, so
  // composer and label are legitimately absent. What the record already knows
  // is not, and an empty panel would mean the row opened nothing worth seeing.
  check('and fills it from the queued track',
    credits.values.includes(track.title) && credits.values.includes(track.album) &&
    credits.values.includes(track.artist),
    `${credits.keys.join(', ')} = ${credits.values.join(', ')}`);
  await p.click('#np-credits-close');
  await p.waitForTimeout(300);
  check('and the credits close button shuts it again', await p.evaluate(() =>
    !document.getElementById('np-credits').classList.contains('is-open')));

  // ── Copy title ─────────────────────────────────────────────────
  await clickItem('copy-title');
  const clip = await p.evaluate(() =>
    navigator.clipboard.readText().catch(() => 'CLIPBOARD UNREADABLE'));
  check('Copy title puts "title - artist" on the clipboard',
    clip === `${track.title} - ${track.artist}`, `"${clip}"`);

  // ── Dismissal ──────────────────────────────────────────────────
  await openMenu();
  await p.keyboard.press('Escape');
  await p.waitForTimeout(250);
  check('Escape closes the menu', !(await menuOpen()));
  await openMenu();
  await p.evaluate(() => document.getElementById('np-title').click());
  await p.waitForTimeout(250);
  check('and so does a click anywhere outside it', !(await menuOpen()));

  // ── The two rows that navigate ─────────────────────────────────
  // Both close the sheet on their way out, so they go last.
  await clickItem('go-album');
  await p.waitForTimeout(700);
  const atAlbum = await p.evaluate(() => ({
    hash: decodeURIComponent(location.hash),
    open: document.querySelector('.now-playing').classList.contains('is-open'),
    view: document.getElementById('view-album').style.display,
  }));
  const show = (h) => h.replace('\0', '\\0');
  check('Go to album routes to the track\'s own album',
    atAlbum.hash === '#album/' + album.key, show(atAlbum.hash));
  check('and closes the sheet so the album is visible', !atAlbum.open && atAlbum.view === 'block',
    `sheet open=${atAlbum.open} album view display "${atAlbum.view}"`);

  await p.click('.player__icon-btn[aria-label="Expand now playing"]');
  await p.waitForTimeout(600);
  await clickItem('go-artist');
  await p.waitForTimeout(700);
  const atArtist = await p.evaluate(() => ({
    hash: decodeURIComponent(location.hash),
    open: document.querySelector('.now-playing').classList.contains('is-open'),
    view: document.getElementById('view-artist').style.display,
  }));
  check('Go to artist routes to the track\'s artist',
    atArtist.hash === '#artist/' + track.artist, atArtist.hash);
  check('and closes the sheet so the artist is visible', !atArtist.open && atArtist.view === 'block',
    `sheet open=${atArtist.open} artist view display "${atArtist.view}"`);

  check('every row closed the menu behind it', leftOpen.length === 0,
    leftOpen.length ? `still open after ${leftOpen.join(', ')}` : 'all nine closed');

  // ── The pane the lyrics row governs ────────────────────────────
  // No .lrc can be read headlessly, so the app renders no lyric lines and the
  // old probe reported "none rendered" as though that were an answer. Build
  // the two lines renderLyrics builds and measure the rule on them: the blur
  // on everything but the current line is what makes the current one legible.
  const blur = await p.evaluate(() => {
    const pane = document.querySelector('.now-playing__lyrics');
    const make = (cls) => {
      const d = document.createElement('div');
      d.className = cls;
      d.textContent = 'line';
      pane.appendChild(d);
      return getComputedStyle(d).filter;
    };
    const out = { inactive: make('np-lyric-line'), active: make('np-lyric-line np-lyric-line--active') };
    for (const d of pane.querySelectorAll('.np-lyric-line')) d.remove();
    return out;
  });
  console.log(`lyric filter: inactive=${blur.inactive} active=${blur.active}`);
  check('an inactive lyric line is blurred', blur.inactive === 'blur(2.5px)', blur.inactive);
  check('and the active line is not', blur.active === 'none', blur.active);

  const row = await p.evaluate(() => {
    const r = document.querySelector('.np-quality-row');
    return r ? getComputedStyle(r).justifyContent : 'missing';
  });
  check('the quality row centres its format and speed', row === 'center', row);

  console.log(`\nerrors: ${errs.length ? errs.slice(0, 3).join(' | ') : 'none'}`);
  if (errs.length) bad++;
  await p.screenshot({ path: process.argv[2] || '/tmp/menu.png' });
  await br.close();
  console.log(bad === 0 ? 'every row in the overflow menu does the thing it names' : `${bad} check(s) failed`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('FAILED: ' + e.message); process.exit(1); });
