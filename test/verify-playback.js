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
      title: ((document.querySelector('.player__title') || {}).textContent || '').trim(),
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

  // ── What the rest of the machine is told ────────────────────────
  // The OS media controls and the play counts that drive the home shelves are
  // both written from the playback path, so neither could be reached either.
  const m = await br.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  m.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
  await fakeFilesystem(m);
  // Chromium's own mediaSession accepts everything and reports nothing back,
  // so it is replaced with one that records what the app asked for.
  await m.addInitScript(() => {
    window.__ms = { meta: null, handlers: [], state: null, pos: null };
    Object.defineProperty(navigator, 'mediaSession', {
      configurable: true,
      value: {
        set metadata(v) {
          window.__ms.meta = v && { title: v.title, artist: v.artist, album: v.album };
        },
        get metadata() { return window.__ms.meta; },
        set playbackState(v) { window.__ms.state = v; },
        get playbackState() { return window.__ms.state; },
        setActionHandler: (a, h) => { if (h) window.__ms.handlers.push(a); },
        setPositionState: (s) => { window.__ms.pos = s && Math.round(s.duration); },
      },
    });
  });
  await m.goto(PLAYER_URL, { waitUntil: 'networkidle' });
  await seed(m, seedLibrary());
  await m.reload({ waitUntil: 'networkidle' });
  await m.waitForTimeout(1400);
  const mk = await m.evaluate(() => document.querySelector('[data-album]')?.dataset.album);
  await m.evaluate((k) => { location.hash = '#album/' + k; }, mk);
  await m.waitForTimeout(900);
  await m.evaluate(() => document.querySelector('.track-row')?.click());
  // Metadata can take a couple of seconds to arrive, and everything the OS is
  // told about position waits on it. Reading before then measures the clock,
  // not the app.
  await m.evaluate(() => new Promise((r) => {
    const a = document.querySelector('audio');
    if (Number.isFinite(a.duration) && a.duration > 0) return r();
    a.addEventListener('loadedmetadata', r, { once: true });
    setTimeout(r, 6000);
  }));
  await m.waitForTimeout(1500);

  const ms = await m.evaluate(() => window.__ms);
  check('the OS is told what is playing',
    !!ms.meta && ms.meta.title && ms.meta.artist && ms.meta.album,
    JSON.stringify(ms.meta));
  check('and that it is playing', ms.state === 'playing', String(ms.state));
  check('and given somewhere to send the hardware keys',
    ['play', 'pause', 'previoustrack', 'nexttrack'].every((a) => ms.handlers.includes(a)),
    ms.handlers.join(', '));
  check('and where in the track we are, so its scrubber can move',
    ms.pos > 0, `duration reported as ${ms.pos}`);

  // Most played is a home shelf, and it is built from this.
  await m.evaluate(() => new Promise((r) => {
    const a = document.querySelector('audio');
    if (Number.isFinite(a.duration) && a.duration > 0) return r();
    a.addEventListener('loadedmetadata', r, { once: true }); setTimeout(r, 4000);
  }));
  await m.evaluate(() => { const a = document.querySelector('audio'); a.currentTime = a.duration - 0.2; });
  await m.waitForTimeout(1500);
  const counts = await m.evaluate(() => JSON.parse(localStorage.getItem('aubade_play_counts') || '{}'));
  const played = Object.values(counts);
  check('a finished track is counted, so Most played has something to say',
    played.length > 0 && played[0].n > 0, JSON.stringify(counts).slice(0, 80));

  // ── The now-playing sheet, with something in it ─────────────────
  // Synced lyrics are a signature feature and have never been exercised: they
  // need a real .lrc beside a real file, and neither existed headlessly.
  const l = await br.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  l.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
  await fakeFilesystem(l);
  await l.addInitScript(() => {
    window.__aubadeLrc = [
      '[ti:Test]', '[offset:0]',
      '[00:01.00]first line',
      '[00:05.00]second line',
      '[00:10.00]',                 // an instrumental gap, which must be kept
      '[00:15.00]third line',
    ].join('\n');
  });
  await l.goto(PLAYER_URL, { waitUntil: 'networkidle' });
  await seed(l, seedLibrary());
  await l.reload({ waitUntil: 'networkidle' });
  await l.waitForTimeout(1400);
  const lk = await l.evaluate(() => document.querySelector('[data-album]')?.dataset.album);
  await l.evaluate((k) => { location.hash = '#album/' + k; }, lk);
  await l.waitForTimeout(900);
  await l.evaluate(() => document.querySelector('.track-row')?.click());
  await l.waitForTimeout(2000);
  await l.evaluate(() =>
    document.querySelector('.player__icon-btn[aria-label="Expand now playing"]')?.click());
  await l.waitForTimeout(900);

  const queue = await l.evaluate(() => {
    document.getElementById('np-queue-btn')?.click();
    return null;
  });
  await l.waitForTimeout(700);
  const q = await l.evaluate(() => ({
    rows: document.querySelectorAll('#np-queue-list .np-queue__row').length,
    current: document.querySelectorAll('#np-queue-list .is-current').length,
  }));
  check('the queue lists the album and marks where you are',
    q.rows > 1 && q.current === 1, `${q.rows} rows, ${q.current} marked current`);

  const lyricLines = () => l.evaluate(() => {
    const els = [...document.querySelectorAll('.np-lyric-line')];
    return {
      count: els.length,
      active: els.findIndex((e) => e.classList.contains('np-lyric-line--active')),
      text: els.map((e) => e.textContent.trim()).join('|'),
    };
  });
  const ly = await lyricLines();
  check('a sidecar .lrc is found and parsed', ly.count >= 4,
    `${ly.count} lines: "${ly.text.slice(0, 60)}"`);

  // The line that is lit has to follow the clock, which is the whole point of
  // a synced lyric and the thing a static render cannot show.
  await l.evaluate(() => { document.querySelector('audio').currentTime = 6; });
  await l.waitForTimeout(700);
  const atSix = await lyricLines();
  await l.evaluate(() => { document.querySelector('audio').currentTime = 16; });
  await l.waitForTimeout(700);
  const atSixteen = await lyricLines();
  check('the lit line follows the clock',
    atSix.active >= 0 && atSixteen.active > atSix.active,
    `line ${atSix.active} at 6s -> line ${atSixteen.active} at 16s`);

  // A sidecar that is not lyrics must not be shown as lyrics.
  const b = await br.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  await fakeFilesystem(b);
  await b.addInitScript(() => { window.__aubadeLrc = 'RIFF\u0000\u0000WAVEfmt \u0000binary'; });
  await b.goto(PLAYER_URL, { waitUntil: 'networkidle' });
  await seed(b, seedLibrary());
  await b.reload({ waitUntil: 'networkidle' });
  await b.waitForTimeout(1400);
  const bk = await b.evaluate(() => document.querySelector('[data-album]')?.dataset.album);
  await b.evaluate((k) => { location.hash = '#album/' + k; }, bk);
  await b.waitForTimeout(900);
  await b.evaluate(() => document.querySelector('.track-row')?.click());
  await b.waitForTimeout(2000);
  const junk = await b.evaluate(() => {
    const c = document.querySelector('.now-playing__lyrics');
    return { found: !!c, text: (c ? c.textContent : '').trim().slice(0, 60) };
  });
  check('a sidecar that is not lyrics is not shown as lyrics',
    junk.found && junk.text.length > 0 && !/RIFF|WAVE/.test(junk.text),
    junk.found ? `"${junk.text}"` : 'no lyrics container found');

  // ── When the files are not where the index says ─────────────────
  // Every one of these is ordinary — files get moved, folders lose permission
  // between sessions — and none of it could be reached before.
  const gone = async (missing, denied, all = false) => {
    const g = await br.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
    g.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
    await fakeFilesystem(g);
    await g.addInitScript(([m, d, a]) => {
      window.__aubadeMissing = m;
      window.__aubadeDenied = d;
      window.__aubadeMissingAll = a;
    }, [missing, denied, all]);
    await g.goto(PLAYER_URL, { waitUntil: 'networkidle' });
    await seed(g, seedLibrary());
    await g.reload({ waitUntil: 'networkidle' });
    await g.waitForTimeout(1400);
    const gk = await g.evaluate(() => document.querySelector('[data-album]')?.dataset.album);
    await g.evaluate((k) => { location.hash = '#album/' + k; }, gk);
    await g.waitForTimeout(900);
    await g.evaluate(() => document.querySelector('.track-row')?.click());
    await g.waitForTimeout(3000);
    const out = await g.evaluate(() => ({
      title: ((document.querySelector('.player__title') || {}).textContent || '').trim(),
      toast: ((document.getElementById('toast') || {}).textContent || '').trim(),
      idle: document.getElementById('app').classList.contains('is-idle'),
      playing: !document.querySelector('audio').paused,
    }));
    await g.close();
    return out;
  };

  // One bad file is skipped, and the next one plays. Saying nothing here is
  // right: the person asked for the album, and they are getting the album.
  const oneBad = await gone(['1 track.opus'], false);
  check('one missing file is stepped over and the album keeps playing',
    oneBad.playing && !oneBad.idle && oneBad.title.length > 0 && oneBad.title !== 'brutal',
    `"${oneBad.title}" playing=${oneBad.playing} toast="${oneBad.toast}"`);

  // A run of them stops and says so. An unbounded skip walks the whole queue
  // in silence and lands on idle looking like a dead button.
  const allBad = await gone([], false, true);
  check('a run of missing files stops rather than walking the queue',
    allBad.idle && /moved or been renamed/i.test(allBad.toast),
    `idle=${allBad.idle} toast="${allBad.toast}"`);

  // Lapsed permission is a different problem with a different answer, and
  // blaming the files for it is both wrong and unactionable.
  const denied = await gone([], true);
  check('lost folder permission says so, rather than blaming the files',
    denied.idle && /reconnect/i.test(denied.toast), `toast="${denied.toast}"`);

  check('nothing threw through any of that', errs.length === 0, errs.slice(0, 2).join(' | '));
  await br.close();
  console.log(bad === 0 ? 'it plays music' : `${bad} check(s) failed`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('FAILED: ' + e.message); process.exit(1); });
