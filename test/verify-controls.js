// Controls that exist but do nothing.
//
// Both Volume buttons shipped as markup: the icon was drawn, the keyboard
// binding worked, and clicking either one did nothing. Nothing failed, no
// error was logged, and every other suite passed — a dead control is
// invisible to a test that only asks whether things are present.
const { chromium } = require('playwright');
const { PLAYER_URL, seed } = require('./lib/harness');

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
  await p.waitForTimeout(1200);

  // The player bar only exists once something is playing, and nothing can
  // play headlessly — the folder picker cannot be driven. Lifting is-idle is
  // a concession to that: what is under test here is whether the buttons are
  // wired, which has nothing to do with audio actually being decoded.
  await p.evaluate(() => document.getElementById('app').classList.remove('is-idle'));
  await p.waitForTimeout(300);

  const state = () => p.evaluate(() => ({
    muted: document.querySelector('audio').muted,
    barIcon: document.getElementById('player-vol-btn').classList.contains('is-muted'),
    npIcon: document.getElementById('np-vol-btn').classList.contains('is-muted'),
    pressed: document.getElementById('player-vol-btn').getAttribute('aria-pressed'),
    label: document.getElementById('player-vol-btn').getAttribute('aria-label'),
  }));

  const before = await state();
  check('starts unmuted', before.muted === false && before.barIcon === false);

  await p.click('#player-vol-btn');
  await p.waitForTimeout(200);
  const on = await state();
  check('the player bar button mutes', on.muted === true, `muted=${on.muted}`);
  check('and the icon says so', on.barIcon === true && on.pressed === 'true',
    `is-muted=${on.barIcon} aria-pressed=${on.pressed} label="${on.label}"`);
  check('and the now-playing icon agrees', on.npIcon === true);

  await p.click('#player-vol-btn');
  await p.waitForTimeout(200);
  const off = await state();
  check('clicking again unmutes', off.muted === false && off.barIcon === false);

  // The now-playing sheet's own button drives the same audio element. It has
  // to be opened first — the sheet hides with translateY, so the button is
  // laid out but genuinely not clickable while it is closed.
  await p.click('.player__icon-btn[aria-label="Expand now playing"]');
  await p.waitForTimeout(500);
  check('the now-playing sheet opens', await p.evaluate(() =>
    document.querySelector('.now-playing').classList.contains('is-open')));
  await p.click('#np-vol-btn');
  await p.waitForTimeout(200);
  const np = await state();
  check('the now-playing button mutes too', np.muted === true && np.barIcon === true);

  // The keyboard route must move the icon as well, or the two disagree.
  await p.keyboard.press('m');
  await p.waitForTimeout(200);
  const key = await state();
  check('the m key keeps the icon in step', key.muted === false && key.barIcon === false,
    `muted=${key.muted} icon=${key.barIcon}`);

  // Closing it again is the other half of the pair, and the checks below
  // need it shut: the open sheet covers the whole player bar, so a click on
  // any bar button lands on .now-playing__body instead.
  await p.click('#np-close');
  await p.waitForTimeout(500);
  check('the sheet closes again', await p.evaluate(() =>
    !document.querySelector('.now-playing').classList.contains('is-open')));

  // ── The player bar's own controls ──────────────────────────────
  // Six of these were markup with no handler at all. Like and Share were the
  // worst of it: they carry hover and focus states, so they looked alive.
  // Playback cannot start headlessly, but clicking a track still fills the
  // queue, which is what these handlers act on.
  await p.evaluate(() => { location.hash = '#home'; });
  await p.waitForTimeout(400);
  const albumKey = await p.evaluate(() => document.querySelector('[data-album]')?.dataset.album);
  await p.evaluate((k) => { location.hash = '#album/' + k; }, albumKey);
  await p.waitForTimeout(800);
  await p.evaluate(() => document.querySelector('.track-row')?.click());
  await p.waitForTimeout(900);
  await p.evaluate(() => document.getElementById('app').classList.remove('is-idle'));

  check('a track is queued for the bar controls to act on', await p.evaluate(() =>
    document.querySelectorAll('.track-row').length > 0));

  // Cast and Mini player were removed: a control that cannot ever work is
  // worse than one that is absent.
  const absent = await p.evaluate(() => ({
    cast: document.querySelectorAll('[aria-label="Cast"]').length,
    mini: document.querySelectorAll('[aria-label="Mini player"]').length,
  }));
  check('Cast and Mini player are gone rather than dead',
    absent.cast === 0 && absent.mini === 0, JSON.stringify(absent));

  const likeState = () => p.evaluate(() => {
    const btn = document.getElementById('player-like-btn');
    return { pressed: btn.getAttribute('aria-pressed'), label: btn.getAttribute('aria-label'),
             stored: Object.keys(JSON.parse(localStorage.getItem('aubade_liked') || '{}')).length,
             npPressed: document.getElementById('np-heart-btn').getAttribute('aria-pressed') };
  });
  const likeBefore = await likeState();
  await p.click('#player-like-btn');
  await p.waitForTimeout(250);
  const likeAfter = await likeState();
  check('the bar Like button likes the track',
    likeAfter.stored === likeBefore.stored + 1 && likeAfter.pressed === 'true',
    `stored ${likeBefore.stored} to ${likeAfter.stored}, aria-pressed ${likeAfter.pressed}`);
  check('and the now-playing heart agrees', likeAfter.npPressed === 'true');
  check('and its label says what pressing it will do now',
    likeAfter.label === 'Remove from liked songs', `"${likeAfter.label}"`);
  await p.click('#player-like-btn');
  await p.waitForTimeout(250);
  const likeUndone = await likeState();
  check('clicking again unlikes it', likeUndone.stored === likeBefore.stored);

  await p.click('#player-share-btn');
  await p.waitForTimeout(400);
  const shared = await p.evaluate(() => ({
    toast: (document.getElementById('toast')?.textContent || '').trim(),
    clip: navigator.clipboard.readText ? null : undefined,
  }));
  check('the bar Share button copies the track', /copied/i.test(shared.toast),
    `toast "${shared.toast}"`);

  await p.click('#player-queue-btn');
  await p.waitForTimeout(400);
  check('the bar Queue button opens the queue', await p.evaluate(() =>
    document.querySelector('.now-playing').classList.contains('is-open') &&
    !document.getElementById('np-queue').hidden));

  // Fullscreen cannot be granted to a headless page, so the check is the
  // handler's own observable step rather than the API's outcome: it opens the
  // sheet before asking, and toasts if the browser refuses. Both are absent
  // when the button is unbound, which is the thing being tested.
  await p.click('#np-close');
  await p.waitForTimeout(400);
  await p.click('#player-fullscreen-btn');
  await p.waitForTimeout(500);
  const fs = await p.evaluate(() => ({
    open: document.querySelector('.now-playing').classList.contains('is-open'),
    real: !!document.fullscreenElement,
    toast: (document.getElementById('toast')?.textContent || '').trim(),
  }));
  check('the bar Fullscreen button acts', fs.open && (fs.real || /fullscreen/i.test(fs.toast)),
    `open=${fs.open} fullscreen=${fs.real} toast="${fs.toast}"`);

  // Every toggle in one sweep. Shuffle and repeat announced themselves by
  // turning accent-coloured and nothing else — no aria-pressed, no change of
  // label — so the only cue a screen reader had was a colour it cannot see.
  // Asserting the whole family means the next toggle cannot ship stale.
  // The fullscreen check above left the sheet as the fullscreen element, which
  // covers the bar whether or not it still calls itself open.
  await p.evaluate(async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    document.querySelector('.now-playing').classList.remove('is-open');
  });
  await p.waitForTimeout(500);
  for (const id of ['player-shuffle-btn', 'player-repeat-btn', 'player-vol-btn', 'player-like-btn']) {
    const before = await p.evaluate((i) => {
      const b = document.getElementById(i);
      return b && { pressed: b.getAttribute('aria-pressed'), label: b.getAttribute('aria-label') };
    }, id);
    if (!before) { check(`${id} is there to toggle`, false, 'no such button'); continue; }
    await p.click('#' + id);
    await p.waitForTimeout(250);
    const after = await p.evaluate((i) => {
      const b = document.getElementById(i);
      return { pressed: b.getAttribute('aria-pressed'), label: b.getAttribute('aria-label') };
    }, id);
    check(`${id} says out loud that it flipped`,
      before.pressed !== after.pressed && before.label !== after.label,
      `aria-pressed ${before.pressed}->${after.pressed}, "${before.label}" -> "${after.label}"`);
    await p.click('#' + id);
    await p.waitForTimeout(250);
  }

  // Settings' Reset swaps itself for a confirm/cancel pair. Cancel used to put
  // the panel back by re-binding all of it, while every other control on it
  // was the same node as before — so each cancel left one more listener on
  // Rescan, Change folder, Reset volume and Clear cache.
  //
  // Reset volume is the one that says which happened out loud: run once from
  // half volume it reports the reset, run twice it finds the volume already
  // full the second time and that is the message left on screen.
  await p.evaluate(() => { location.hash = '#settings'; });
  await p.waitForTimeout(700);
  for (let i = 0; i < 3; i++) {
    await p.click('#settings-btn-reset');
    await p.waitForTimeout(250);
    await p.click('#settings-btn-cancel-reset');
    await p.waitForTimeout(400);
  }
  await p.evaluate(() => { document.querySelector('audio').volume = 0.5; });
  await p.waitForTimeout(200);
  await p.click('#settings-btn-reset-vol');
  await p.waitForTimeout(500);
  const resetSaid = await p.evaluate(() =>
    ((document.getElementById('toast') || {}).textContent || '').trim());
  check('cancelling Reset three times does not leave three listeners behind',
    /reset to 100%/i.test(resetSaid), `toast "${resetSaid}"`);
  check('and Reset still offers to confirm afterwards', await p.evaluate(() => {
    document.getElementById('settings-btn-reset')?.click();
    return !!document.getElementById('settings-btn-confirm-reset');
  }));

  console.log(`\nerrors: ${errs.length ? errs.slice(0, 3).join(' | ') : 'none'}`);
  if (errs.length) bad++;
  await br.close();
  console.log(bad === 0 ? 'every control checked here does something' : `${bad} check(s) failed`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('FAILED: ' + e.message); process.exit(1); });
