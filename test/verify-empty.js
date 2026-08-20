// What each view says when it has nothing.
//
// Every one of these states used to render an empty box. A blank page does
// not read as "there is nothing here" — it reads as a page that failed to
// load, and the difference decides whether you go and connect a folder or
// reload and try again.
const { chromium } = require('playwright');
const { PLAYER_URL, seed, seedLibrary, answer } = require('./lib/harness');

const EMPTY = { tracks: [], albums: [], artists: [] };

(async () => {
  const br = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)); });

  let bad = 0;
  const check = (label, ok, detail = '') => {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
    if (!ok) bad++;
  };

  // A sentence nobody can see is the same as no sentence. Every check goes
  // through this: present, not hidden, laid out, and actually saying words.
  const said = (sel) => p.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return { found: false };
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      found: true,
      text: (el.textContent || '').trim(),
      visible: b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none',
    };
  }, sel);

  const reads = (label, sel, wanted) => said(sel).then((s) => {
    const ok = s.found && s.visible && s.text.length > 12 && (!wanted || wanted.test(s.text));
    check(label, ok, !s.found ? 'no such element'
      : !s.visible ? `present but not visible: "${s.text.slice(0, 40)}"`
      : `"${s.text.slice(0, 70)}"`);
  });

  // Reload, then set the hash. Navigating straight to PLAYER_URL + hash after
  // seeding races the fresh page's read of IndexedDB and it comes up with an
  // empty library — which looks exactly like the bug these checks hunt for.
  const load = async (library, hash) => {
    await p.goto(PLAYER_URL, { waitUntil: 'networkidle' });
    await p.evaluate(() => { localStorage.clear(); });
    await seed(p, library);
    await p.reload({ waitUntil: 'networkidle' });
    await p.waitForTimeout(1000);
    await p.evaluate((h) => { location.hash = h; }, hash);
    await p.waitForTimeout(700);
  };

  // ── With no folder connected ────────────────────────────────────
  await load(EMPTY, '#home');
  await reads('home says why it is bare', '#home-empty', /nothing here/i);
  check('and offers the way out of it', await p.evaluate(() =>
    !!document.getElementById('home-empty-pick')?.offsetParent));

  await p.evaluate(() => { location.hash = '#library'; });
  await p.waitForTimeout(600);
  await reads('the library says it is empty rather than showing a blank page',
    '#lib-empty', /connect a music folder/i);

  await p.evaluate(() => { location.hash = '#search'; });
  await p.waitForTimeout(600);
  await reads('search with an empty library says there is nothing to search',
    '#search-idle', /nothing to search/i);

  // ── With a library, but nothing to show ─────────────────────────
  await load(seedLibrary(), '#search');
  await reads('search before you type tells you what it will search',
    '#search-idle', /song, album or artist/i);

  await p.fill('#search-input', 'zzzzzzznotathing');
  await p.waitForTimeout(900);
  await reads('a search with no matches names what was searched for',
    '#search-empty', /zzzzzzznotathing/i);
  check('and the waiting prompt gets out of the way', await p.evaluate(() =>
    document.getElementById('search-idle').hidden));

  // Hide singles can empty the album grid of a library that is not empty.
  // "0 albums" over a blank grid explains nothing on its own.
  const singles = seedLibrary();
  singles.albums = singles.albums.map((a) => ({ ...a, tracks: a.tracks.slice(0, 1) }));
  singles.tracks = singles.albums.flatMap((a) => a.tracks);
  await load(singles, '#library');
  await p.evaluate(() => {
    localStorage.setItem('aubade_hide_singles', 'true');
    localStorage.setItem('aubade_lib_view', 'albums');
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  await reads('a filter that hides everything says so, and says which filter',
    '#lib-empty', /hide singles/i);

  // ── Liked and playlists ─────────────────────────────────────────
  await load(seedLibrary(), '#liked-songs');
  await reads('liked songs explains how songs get there', '#liked-empty', /heart/i);

  await p.click('#new-playlist-btn');
  // The first version of this dialog was styled into a stylesheet the page
  // does not load, so it worked perfectly and looked like a browser default.
  // Behaviour checks alone cannot see that.
  await p.waitForSelector('.ask-scrim');
  const dressed = await p.evaluate(() => {
    const s = getComputedStyle(document.querySelector('.ask'));
    return { radius: parseFloat(s.borderRadius), pad: parseFloat(s.padding),
             scrim: getComputedStyle(document.querySelector('.ask-scrim')).backgroundColor };
  });
  check('the dialog is wearing the app\'s own clothes, not the browser\'s',
    dressed.radius >= 12 && dressed.pad >= 16 && /rgba?\(0, 0, 0/.test(dressed.scrim),
    `radius ${dressed.radius}, padding ${dressed.pad}, scrim ${dressed.scrim}`);
  await p.screenshot({ path: 'audit/shots/ask-dialog.png' });
  // Reachable from the sheet's own overflow menu, where the dialog used to be
  // drawn behind it: invisible, unclickable, and escapable only with Escape.
  const layered = await p.evaluate(() => {
    const scrim = document.querySelector('.ask-scrim');
    const np = document.querySelector('.now-playing');
    const z = (el) => parseInt(getComputedStyle(el).zIndex, 10) || 0;
    return { ask: z(scrim), sheet: z(np) };
  });
  check('and sits above the now-playing sheet, which can open it',
    layered.ask > layered.sheet, `ask ${layered.ask} vs sheet ${layered.sheet}`);
  await answer(p, 'Empty on purpose');
  await p.waitForTimeout(900);
  await reads('a playlist with nothing in it says how to fill it',
    '#playlist-empty', /add to a playlist/i);

  // ── The queue ───────────────────────────────────────────────────
  await load(seedLibrary(), '#home');
  await p.evaluate(() => {
    document.getElementById('app').classList.remove('is-idle');
    document.querySelector('.now-playing').classList.add('is-open');
    document.getElementById('np-queue-btn')?.click();
  });
  await p.waitForTimeout(600);
  const queue = await p.evaluate(() => (document.getElementById('np-queue-list')?.textContent || '').trim());
  check('an empty queue says it is empty', queue.length > 8, `"${queue.slice(0, 60)}"`);

  console.log(`\nerrors: ${errs.length ? errs.slice(0, 3).join(' | ') : 'none'}`);
  if (errs.length) bad++;
  await br.close();
  console.log(bad === 0 ? 'every empty view says what it is' : `${bad} check(s) failed`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('FAILED: ' + e.message); process.exit(1); });
