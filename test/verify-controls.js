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
  const p = await br.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
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

  console.log(`\nerrors: ${errs.length ? errs.slice(0, 3).join(' | ') : 'none'}`);
  if (errs.length) bad++;
  await br.close();
  console.log(bad === 0 ? 'every control checked here does something' : `${bad} check(s) failed`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('FAILED: ' + e.message); process.exit(1); });
