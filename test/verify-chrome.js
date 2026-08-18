// The six controls that were markup-only. Each should now either do something
// observable or not exist.
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
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)); });

  await p.goto(PLAYER_URL, { waitUntil: 'networkidle' });
  await seed(p);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);

  const x0 = await p.evaluate(() => Math.round(document.querySelector('.sidebar').getBoundingClientRect().x));
  await p.evaluate(() => document.querySelector('button[aria-label="Collapse sidebar"]').click());
  await p.waitForTimeout(500);
  const x1 = await p.evaluate(() => Math.round(document.querySelector('.sidebar').getBoundingClientRect().x));
  console.log(`collapse sidebar: x ${x0} -> ${x1}  ${x1 < x0 ? 'OK' : 'NO EFFECT'}`);
  await p.evaluate(() => document.querySelector('button[aria-label="Collapse sidebar"]').click());
  await p.waitForTimeout(400);

  await p.evaluate(() => document.getElementById('seg-library').click());
  await p.waitForTimeout(600);
  console.log('seg-library -> hash: ' + await p.evaluate(() => location.hash));

  await p.evaluate(() => { location.hash = '#home'; });
  await p.waitForTimeout(600);
  const k = await p.evaluate(() => document.querySelector('[data-album]').dataset.album);
  await p.evaluate((h) => { location.hash = '#album/' + h; }, k);
  await p.waitForTimeout(1200);
  await p.evaluate(() => document.querySelector('.album-btn--more').click());
  await p.waitForTimeout(500);
  const menu = await p.evaluate(() => {
    const m = document.getElementById('album-menu');
    return m ? [...m.querySelectorAll('.np-menu__item')].map((b) => b.textContent) : 'NO MENU';
  });
  console.log('album more menu: ' + JSON.stringify(menu));

  // Outside click should dismiss it.
  await p.mouse.click(700, 300);
  await p.waitForTimeout(400);
  console.log('menu closes on outside click: ' + await p.evaluate(() => !document.getElementById('album-menu')));

  const gone = await p.evaluate(() => ({
    notifications: document.querySelectorAll('[aria-label="Notifications"]').length,
    addPin: document.querySelectorAll('[aria-label="Add pinned item"]').length,
  }));
  console.log('removed controls still present: ' + JSON.stringify(gone) + '  (both should be 0)');

  console.log('errors: ' + (errs.length ? errs.slice(0, 4).join(' | ') : 'none'));
  await br.close();
})().catch((e) => { console.error('FAILED: ' + e.message); process.exit(1); });
