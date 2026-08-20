// Keyboard bindings and MediaSession. The critical negative case is that
// typing in the search field must not trigger any of them.
const { chromium } = require('playwright');
const { PLAYER_URL, seedLibrary, seed } = require('./lib/harness');

(async () => {
  const br = await chromium.launch();
  const p = await br.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)); });

  await p.goto(PLAYER_URL, { waitUntil: 'networkidle' });
  await seed(p);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1400);

  let bad = 0;
  const check = (label, ok, detail = '') => {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
    if (!ok) bad++;
  };

  console.log('mediaSession available: ' + await p.evaluate(() => 'mediaSession' in navigator));
  check('handlers registered without throwing', errs.length === 0);

  // Volume via arrows. Each press nudges by 5%, so two ArrowDown presses
  // from a full bar land on 90% — not just "some decrease".
  const before = await p.evaluate(() => document.getElementById('np-vol-fill').style.width);
  await p.keyboard.press('ArrowDown');
  await p.keyboard.press('ArrowDown');
  await p.waitForTimeout(200);
  const after = await p.evaluate(() => document.getElementById('np-vol-fill').style.width);
  check(`ArrowDown x2 drops volume by 10%`, before === '100%' && after === '90%',
    `${before} -> ${after}`);

  // ? opens the list, Escape closes it.
  await p.keyboard.press('?');
  await p.waitForTimeout(300);
  const help = await p.evaluate(() => {
    const el = document.getElementById('shortcuts');
    return el ? el.querySelectorAll('.shortcuts__row').length + ' rows' : 'MISSING';
  });
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  const closed = await p.evaluate(() => !document.getElementById('shortcuts'));
  check('? opens the shortcuts list', help !== 'MISSING', help);
  check('Escape closes it', closed);

  // f toggles now playing.
  await p.keyboard.press('f');
  await p.waitForTimeout(300);
  const opened = await p.evaluate(() =>
    document.querySelector('.now-playing').classList.contains('is-open'));
  await p.keyboard.press('f');
  await p.waitForTimeout(300);
  const reclosed = await p.evaluate(() =>
    !document.querySelector('.now-playing').classList.contains('is-open'));
  check('f opens now playing', opened);
  check('f again closes it', reclosed);

  // The important negative: typing must not fire shortcuts.
  await p.evaluate(() => { location.hash = '#search'; });
  await p.waitForTimeout(700);
  const volBefore = await p.evaluate(() => document.getElementById('np-vol-fill').style.width);
  await p.evaluate(() => document.getElementById('search-input').focus());
  await p.keyboard.type('quiet flm space');
  await p.waitForTimeout(400);
  const state = await p.evaluate(() => ({
    typed: document.getElementById('search-input').value,
    vol: document.getElementById('np-vol-fill').style.width,
    helpOpen: !!document.getElementById('shortcuts'),
    npOpen: document.querySelector('.now-playing').classList.contains('is-open'),
  }));
  console.log('typing in search: ' + JSON.stringify(state));
  check('typed text lands in the field, not eaten by shortcuts',
    state.typed === 'quiet flm space', `"${state.typed}"`);
  check('volume unchanged while typing (m/f/? did not fire)', state.vol === volBefore,
    `${volBefore} -> ${state.vol}`);
  check('? did not open the help panel while typing', state.helpOpen === false);
  check('f did not open now playing while typing', state.npOpen === false);

  console.log(`\nerrors: ${errs.length ? errs.slice(0, 3).join(' | ') : 'none'}`);
  if (errs.length) bad++;
  await br.close();
  console.log(bad === 0 ? 'keyboard shortcuts behave and stay out of text input' : `${bad} check(s) failed`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('FAILED: ' + e.message); process.exit(1); });
