// Library data that should never happen, and does.
//
// Two crashes have come out of this corner already: albumKey threw on a record
// with no albumArtist, blanking the artist page with the error swallowed, and
// buildLibrary threw on the same record before any view got a chance. The
// indexer does not produce these, but a file with no tags, a corrupt store or
// a half-finished scan can, and "the page is blank and the console is clean"
// is the worst way to find out.
const { PLAYER_URL, seed, launch } = require('./lib/harness');

const track = (over) => ({
  path: 'x/y/1.opus', title: 'a title', artist: 'an artist',
  albumArtist: 'an artist', album: 'an album',
  track: 1, disc: 1, year: 2020, duration: 180, hasCover: false, ...over,
});

// Each case is a library that should not exist, and the view most likely to
// fall over on it.
const CASES = [
  ['a track with no tags at all',
   { tracks: [track({ title: '', artist: '', albumArtist: '', album: '' })] }, '#library'],
  ['a track whose tags are only whitespace',
   { tracks: [track({ title: '   ', albumArtist: '  ', album: '\t' })] }, '#library'],
  ['a track missing the fields entirely',
   { tracks: [{ path: 'z/1.opus', duration: 100 }] }, '#library'],
  ['an artist entry carrying no albums',
   { tracks: [track()], artists: [{ name: 'ghost', albums: [] }] }, '#artist/ghost'],
  ['a title long enough to be a paragraph',
   { tracks: [track({ title: 'x'.repeat(400) })] }, '#library'],
  ['tags that are entirely emoji',
   { tracks: [track({ title: '🎧🎵', album: '🌙', albumArtist: '✨' })] }, '#library'],
  ['tags carrying markup',
   { tracks: [track({ title: '<img src=x onerror=alert(1)>', album: '<b>bold</b>' })] }, '#library'],
];

(async () => {
  const br = await launch();
  const ctx = await br.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  const p = await ctx.newPage();

  let bad = 0;
  const check = (label, ok, detail = '') => {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
    if (!ok) bad++;
  };

  for (const [name, partial, hash] of CASES) {
    const errs = [];
    p.on('pageerror', (e) => errs.push(String(e).slice(0, 100)));
    const lib = { tracks: [], albums: [], artists: [], ...partial };

    await p.goto(PLAYER_URL, { waitUntil: 'networkidle' });
    await seed(p, lib);
    await p.reload({ waitUntil: 'networkidle' });
    await p.waitForTimeout(900);
    await p.evaluate((h) => { location.hash = h; }, hash);
    await p.waitForTimeout(900);

    const state = await p.evaluate(() => {
      const view = [...document.querySelectorAll('#view-library, #view-artist, #view-home')]
        .find((v) => getComputedStyle(v).display !== 'none');
      return {
        view: view ? view.id : 'none',
        // Words on the page, not markup: a card with an empty title renders a
        // box with nothing in it and reads as a song the indexer dropped.
        words: (view ? view.innerText : '').replace(/\s+/g, ' ').trim(),
        alerted: !!window.__hostileAlert,
      };
    });

    check(`${name}: nothing throws`, errs.length === 0, errs.slice(0, 2).join(' | '));
    check(`${name}: the view still says something`, state.words.length > 0,
      `"${state.words.slice(0, 60)}"`);
    // A header with a Play button and no name is a page, not an answer. The
    // artist route reached exactly that when the link had gone stale.
    if (hash.startsWith('#artist/')) {
      const named = await p.evaluate(() =>
        (document.querySelector('.artist-header__name')?.textContent || '').trim());
      check(`${name}: the artist page names who it is about`, named.length > 0, `"${named}"`);
      // Clearing the words was not enough. The buttons keep whatever onclick
      // the last artist gave them, so Play on a page saying there is nothing
      // to play would play whoever you looked at before.
      const wired = await p.evaluate(() => {
        const out = [];
        for (const id of ['artist-play-btn', 'artist-shuffle-btn', 'artist-follow-btn',
                          'artist-share-btn', 'artist-more-btn']) {
          const b = document.getElementById(id);
          if (b && (b.onclick || !b.disabled)) out.push(id);
        }
        return out;
      });
      check(`${name}: and its buttons are not still wired to the last one`,
        wired.length === 0, wired.join(', ') || 'all five inert');
    }
    p.removeAllListeners('pageerror');
  }

  // Markup in a tag has to arrive as text. It is the user's own file, so this
  // is not a hostile third party — but a filename can still close a tag.
  await p.goto(PLAYER_URL, { waitUntil: 'networkidle' });
  await seed(p, { tracks: [track({ title: '<img src=x onerror="window.__x=1">' })],
                  albums: [], artists: [] });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  await p.evaluate(() => { location.hash = '#library'; });
  await p.waitForTimeout(900);
  check('markup in a tag is shown, not run',
    await p.evaluate(() => window.__x === undefined && !document.querySelector('#view-library img[src="x"]')));

  await br.close();
  console.log(bad === 0 ? 'the library survives data it should never see' : `${bad} check(s) failed`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('FAILED: ' + e.message); process.exit(1); });
