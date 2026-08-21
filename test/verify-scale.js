// A library the size of a real one.
//
// Everything else here is measured against 60 albums, which hides the class of
// mistake that only shows up at scale: rendering thirteen thousand rows into
// the DOM at once, or searching them synchronously on every keystroke. Nothing
// is wrong today — this suite exists so that stays true.
//
// The timing bars are deliberately loose. They are here to catch a change of
// approach, not to grade the machine: a list that stops being built lazily
// misses by an order of magnitude, and a slow CI runner does not.
const { PLAYER_URL, seed, launch } = require('./lib/harness');

const ALBUMS = 1200, PER_ALBUM = 11;

function bigLibrary() {
  const albums = [], tracks = [], artistMap = new Map();
  for (let i = 0; i < ALBUMS; i++) {
    const artist = 'Artist ' + (i % 400);
    const title = 'Album ' + i;
    const t = [];
    for (let j = 0; j < PER_ALBUM; j++) {
      const rec = { path: `${artist}/${title}/${j + 1}.opus`, title: `Track ${j + 1}`,
        artist, albumArtist: artist, album: title, track: j + 1, disc: 1,
        year: 1990 + (i % 35), duration: 120 + (i * j) % 240, hasCover: false };
      t.push(rec); tracks.push(rec);
    }
    const a = { album: title, albumArtist: artist, year: 1990 + (i % 35), tracks: t };
    albums.push(a);
    if (!artistMap.has(artist)) artistMap.set(artist, { name: artist, albums: [] });
    artistMap.get(artist).albums.push(a);
  }
  return { tracks, albums, artists: [...artistMap.values()] };
}

(async () => {
  const br = await launch();
  const p = await br.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));

  let bad = 0;
  const check = (label, ok, detail = '') => {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
    if (!ok) bad++;
  };

  const lib = bigLibrary();
  await p.goto(PLAYER_URL, { waitUntil: 'networkidle' });
  await seed(p, lib);

  const t1 = Date.now();
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForFunction(() => document.querySelectorAll('[data-album]').length > 0, { timeout: 40000 });
  const boot = Date.now() - t1;
  check(`home is usable with ${lib.tracks.length} tracks`, boot < 8000, `${boot}ms`);

  for (const [name, hash] of [['library', '#library'], ['search', '#search']]) {
    const t = Date.now();
    await p.evaluate((h) => { location.hash = h; }, hash);
    await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const ms = Date.now() - t;
    check(`the ${name} route paints without a stall`, ms < 2500, `${ms}ms`);
  }

  // The virtualisation guard, and the only bar here that does not care what
  // machine it runs on. Thirteen thousand rows built eagerly is roughly forty
  // thousand nodes; built as they are reached it is under two thousand.
  await p.evaluate(() => { localStorage.setItem('aubade_lib_view', 'songs'); location.hash = '#library'; });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(2500);
  const dom = await p.evaluate(() => ({
    total: document.querySelectorAll('*').length,
    rows: document.querySelectorAll('#lib-content > * > *').length,
    line: (document.getElementById('lib-count-line') || {}).textContent || '',
  }));
  check('the songs view knows how many there are', dom.line.includes(String(lib.tracks.length)), dom.line);
  check('and builds rows as they are reached rather than all at once',
    dom.total < 6000 && dom.rows < 600, `${dom.total} nodes, ${dom.rows} rows`);

  // Frame times while scrolling the long list, which is also when new rows are
  // being appended. 34ms is 30fps — half the budget, and still nowhere near
  // what an eagerly built list costs.
  const frames = await p.evaluate(() => new Promise((resolve) => {
    const el = document.querySelector('.content-frame') || document.scrollingElement;
    const times = []; let last = performance.now(); let n = 0;
    const step = () => {
      const now = performance.now();
      times.push(now - last); last = now;
      el.scrollTop += 220;
      if (++n < 70) requestAnimationFrame(step);
      else resolve(times.slice(5).sort((a, b) => a - b));
    };
    requestAnimationFrame(step);
  }));
  const median = frames[Math.floor(frames.length / 2)];
  check('scrolling stays smooth while more rows arrive', median < 34, `median frame ${median.toFixed(1)}ms`);

  const grew = await p.evaluate(() => document.querySelectorAll('#lib-content > * > *').length);
  check('and more rows really do arrive', grew > dom.rows, `${dom.rows} -> ${grew}`);

  // Every keystroke searches the whole library on the main thread. The first
  // one pays for the index; the rest must not.
  await p.evaluate(() => { location.hash = '#search'; });
  await p.waitForTimeout(600);
  const settled = () => p.waitForFunction(() => {
    const r = document.getElementById('search-results');
    const e = document.getElementById('search-empty');
    return (r && r.style.display !== 'none') || (e && e.style.display !== 'none');
  }, { timeout: 10000 }).catch(() => {});
  const keys = [];
  for (const ch of 'track 7'.split('')) {
    const t = Date.now();
    await p.type('#search-input', ch, { delay: 0 });
    await settled();
    keys.push(Date.now() - t);
  }
  const rest = keys.slice(1);
  const worst = Math.max(...rest);
  check('typing keeps up after the index is built', worst < 400,
    `first ${keys[0]}ms, then ${rest.join('/')}ms`);

  console.log(`\nerrors: ${errs.length ? errs.slice(0, 3).join(' | ') : 'none'}`);
  if (errs.length) bad++;
  await br.close();
  console.log(bad === 0 ? 'a real-sized library stays quick' : `${bad} check(s) failed`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('FAILED: ' + e.message); process.exit(1); });
