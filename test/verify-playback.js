// Playing music, which is the point of the whole thing.
//
// Nothing here was ever testable: no folder can be picked headlessly, so no
// file opened, so every path after playback starts — the scrubber, the end of
// a track, repeat, shuffle, prev's rewind rule — went unexercised for the
// entire life of the project. The harness now stands in for the filesystem and
// hands back real decodable audio, so all of it is reachable.
const { chromium } = require('playwright');
const { PLAYER_URL, seed, seedLibrary, fakeFilesystem } = require('./lib/harness');

(async () => {
  // The tone is real but there is no output device, so autoplay has to be
  // allowed or play() rejects before any of this begins.
  const br = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await br.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)); });

  let bad = 0;
  const check = (label, ok, detail = '') => {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
    if (!ok) bad++;
  };

  const patched = await fakeFilesystem(p);
  await p.goto(PLAYER_URL, { waitUntil: 'networkidle' });
  await seed(p, seedLibrary());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  check('the filesystem stand-in still fits the code it stands in for', patched.db);

  const state = () => p.evaluate(() => {
    const a = document.querySelector('audio');
    const fill = document.querySelector('.player__track-fill');
    return {
      paused: a.paused, err: a.error && a.error.code,
      at: a.currentTime, dur: a.duration, src: !!a.src,
      title: (document.querySelector('.player__title') || {}).textContent.trim(),
      idle: document.getElementById('app').classList.contains('is-idle'),
      scrub: fill ? parseFloat(fill.style.width) || 0 : -1,
    };
  });
  const click = (sel) => p.evaluate((s) => document.querySelector(s)?.click(), sel);

  await p.evaluate(() => { location.hash = '#home'; });
  await p.waitForTimeout(600);
  const key = await p.evaluate(() => document.querySelector('[data-album]')?.dataset.album);
  await p.evaluate((k) => { location.hash = '#album/' + k; }, key);
  await p.waitForTimeout(900);
  await p.evaluate(() => document.querySelector('.track-row')?.click());
  await p.waitForTimeout(1200);

  // Duration is NaN until metadata arrives, and setting currentTime against it
  // throws rather than waiting.
  const ready = () => p.evaluate(() => new Promise((r) => {
    const a = document.querySelector('audio');
    if (Number.isFinite(a.duration) && a.duration > 0) return r();
    a.addEventListener('loadedmetadata', r, { once: true });
    setTimeout(r, 4000);
  }));
  const nearTheEnd = async () => {
    await ready();
    await p.evaluate(() => { const a = document.querySelector('audio'); a.currentTime = a.duration - 0.15; });
  };

  await ready();
  const first = await state();
  check('clicking a track actually plays it',
    first.src && !first.paused && first.err === null,
    `src=${first.src} paused=${first.paused} error=${first.err}`);
  check('and the player bar comes out of idle with the track named',
    !first.idle && first.title.length > 0, `"${first.title}"`);
  check('and the duration is known', first.dur > 0, `${first.dur}s`);

  // The scrubber is painted from timeupdate. If that listener is ever lost the
  // bar simply never moves, which nothing else here would notice. The markup
  // ships with a 62% placeholder, so the first real paint moves it down —
  // wait for playback to pass that mark before asking whether it climbs.
  await p.evaluate(() => { document.querySelector('audio').currentTime = 20; });
  await p.waitForTimeout(500);
  const before = await state();
  await p.waitForTimeout(900);
  const later = await state();
  check('the scrubber follows the track', later.scrub > before.scrub,
    `${before.scrub.toFixed(1)}% -> ${later.scrub.toFixed(1)}% at ${later.at.toFixed(1)}s`);
  await p.evaluate(() => { document.querySelector('audio').currentTime = 0; });
  await p.waitForTimeout(300);

  await click('.player__play-btn');
  await p.waitForTimeout(400);
  const held = await state();
  check('the play button pauses', held.paused === true);
  await click('.player__play-btn');
  await p.waitForTimeout(400);
  check('and starts it again', (await state()).paused === false);

  await click('.player__icon-btn[aria-label="Next"]');
  await p.waitForTimeout(1000);
  const second = await state();
  check('Next moves to the following track',
    second.title !== first.title && !second.paused && second.err === null,
    `"${first.title}" -> "${second.title}"`);

  // Prev restarts the track before it goes back, the way every player does —
  // press it once well into a song and you expect the song again, not the last
  // one. The line is three seconds, which is why the fixture is thirty.
  await p.evaluate(() => { document.querySelector('audio').currentTime = 6; });
  await p.waitForTimeout(300);
  await click('.player__icon-btn[aria-label="Previous"]');
  await p.waitForTimeout(700);
  const rewound = await state();
  check('Previous restarts the track when you are into it',
    rewound.title === second.title && rewound.at < 1.0,
    `"${rewound.title}" at ${rewound.at.toFixed(2)}s`);

  await click('.player__icon-btn[aria-label="Previous"]');
  await p.waitForTimeout(900);
  const back = await state();
  check('and goes back when you are at the start',
    back.title === first.title, `"${back.title}"`);

  // Running a track to its end is the one path a user hits every few minutes
  // and no test has ever taken.
  await nearTheEnd();
  await p.waitForTimeout(1600);
  const advanced = await state();
  check('a track that ends moves on by itself',
    advanced.title !== back.title && !advanced.paused,
    `"${back.title}" -> "${advanced.title}", paused=${advanced.paused}`);

  // Repeat here is repeat-all, not repeat-one: it decides what happens at the
  // end of the queue, not the end of a track. Off, the last track is the end
  // of the session; on, it wraps.
  const toLast = async () => {
    await p.evaluate(() => {
      const rows = document.querySelectorAll('#view-album .track-row');
      rows[rows.length - 1]?.click();
    });
    await p.waitForTimeout(1200);
  };
  await toLast();
  const last = await state();
  await nearTheEnd();
  await p.waitForTimeout(1800);
  const stopped = await state();
  check('with repeat off, the end of the queue is the end',
    stopped.title === last.title, `"${last.title}" -> "${stopped.title}"`);

  await p.evaluate(() => document.getElementById('player-repeat-btn').click());
  await p.waitForTimeout(300);
  check('and the repeat button says it is on',
    await p.evaluate(() => document.getElementById('player-repeat-btn').getAttribute('aria-pressed') === 'true'));
  await toLast();
  const lastAgain = await state();
  await nearTheEnd();
  await p.waitForTimeout(1800);
  const wrapped = await state();
  check('with repeat on, the queue comes round again',
    wrapped.title !== lastAgain.title && !wrapped.paused,
    `"${lastAgain.title}" -> "${wrapped.title}"`);
  await p.evaluate(() => document.getElementById('player-repeat-btn').click());
  await p.waitForTimeout(300);

  // Shuffle has to change the order without losing where you are.
  const order = () => p.evaluate(() => (window.__order || []));
  await p.evaluate(() => {
    const a = document.querySelector('audio');
    window.__before = document.querySelector('.player__title').textContent.trim();
  });
  await p.evaluate(() => document.getElementById('player-shuffle-btn').click());
  await p.waitForTimeout(600);
  const shuffled = await state();
  check('turning shuffle on keeps playing what was playing',
    shuffled.title === await p.evaluate(() => window.__before) && !shuffled.paused,
    `"${shuffled.title}"`);

  check('nothing threw through any of that', errs.length === 0, errs.slice(0, 2).join(' | '));
  await br.close();
  console.log(bad === 0 ? 'it plays music' : `${bad} check(s) failed`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('FAILED: ' + e.message); process.exit(1); });
