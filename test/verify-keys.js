// Keyboard bindings and MediaSession. The critical negative case is that
// typing in the search field must not trigger any of them.
const { chromium } = require('playwright');
const { BASE_URL, seedLibrary, seed } = require('./lib/harness');

(async () => {
  const br = await chromium.launch();
  const p = await br.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)); });

  await p.goto(BASE_URL, { waitUntil: 'networkidle' });
  await seed(p);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1400);

  console.log('mediaSession available: ' + await p.evaluate(() => 'mediaSession' in navigator));
  console.log('handlers registered without throwing: ' + (errs.length === 0));

  // Volume via arrows.
  const vol = await p.evaluate(() => document.querySelector('audio') ? 'dom' : 'detached');
  void vol;
  const before = await p.evaluate(() => document.getElementById('np-vol-fill').style.width);
  await p.keyboard.press('ArrowDown');
  await p.keyboard.press('ArrowDown');
  await p.waitForTimeout(200);
  const after = await p.evaluate(() => document.getElementById('np-vol-fill').style.width);
  console.log(`ArrowDown x2 volume: ${before} -> ${after}`);

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
  console.log(`? opens help: ${help} | Escape closes it: ${closed}`);

  // f toggles now playing.
  await p.keyboard.press('f');
  await p.waitForTimeout(300);
  const opened = await p.evaluate(() =>
    document.querySelector('.now-playing').classList.contains('is-open'));
  await p.keyboard.press('f');
  await p.waitForTimeout(300);
  console.log('f toggles now playing: opened=' + opened + ' closed=' + await p.evaluate(() =>
    !document.querySelector('.now-playing').classList.contains('is-open')));

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
  console.log('  volume unchanged while typing: ' + (state.vol === volBefore));

  console.log('errors: ' + (errs.length ? errs.slice(0, 4).join(' | ') : 'none'));
  await br.close();
})().catch((e) => { console.error('FAILED: ' + e.message); process.exit(1); });
