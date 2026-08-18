// Walk every route at phone width and report what is cut off or spilling.
// The shell swapping correctly says nothing about the views inside it — now
// playing and the album header both looked fine by the shell check and were
// badly broken when measured.
const { chromium } = require('playwright');
const { BASE_URL, seedLibrary, seed } = require('./lib/harness');

const audit = () => {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 4 || r.height <= 4) return false;
    return typeof el.checkVisibility === 'function'
      ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })
      : getComputedStyle(el).display !== 'none';
  };
  // First clipping ancestor decides: a scroller means reachable, hidden means cut off.
  const unreachable = (el) => {
    const r = el.getBoundingClientRect();
    for (let n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
      const ox = getComputedStyle(n).overflowX;
      if (ox === 'auto' || ox === 'scroll') return false;
      if (ox === 'hidden') {
        const b = n.getBoundingClientRect();
        if (r.right > b.right + 2 || r.left < b.left - 2) return true;
      }
    }
    return r.left < -2 || r.right > innerWidth + 2;
  };
  const name = (el) => ((el.className || '').toString().trim().split(/\s+/)[0] || el.tagName) +
    (el.id ? '#' + el.id : '');

  const cut = [];
  for (const el of document.querySelectorAll('button, a, [role="button"], input, select')) {
    if (!vis(el)) continue;
    if (unreachable(el)) cut.push(name(el) + '@' + Math.round(el.getBoundingClientRect().left) +
      '-' + Math.round(el.getBoundingClientRect().right));
  }

  // Text that runs under its own container edge is the other phone failure.
  const squeezed = [];
  for (const el of document.querySelectorAll('h1, h2, h3, .track-row, .card__title, .shelf__title')) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.right > innerWidth + 2 || r.left < -2) squeezed.push(name(el) + '@w' + Math.round(r.width));
  }

  // A container as wide as the viewport should never need to scroll sideways.
  // The greeting row's pill sat 122px past the right edge and every check
  // above cleared it: .content-frame is overflow-x:auto, so the reachability
  // rule called it reachable, and body's overflow-x:hidden kept the document's
  // own scrollWidth at 390. Nothing was visibly wrong to a measurement — the
  // pill was simply off screen. Narrower scrollers are the shelves, which are
  // meant to scroll, so the width test is what separates the two.
  //
  // Only auto/scroll containers count. A first pass on every element flagged
  // .now-playing__bg, whose blurred blobs are drawn wider than the screen on
  // purpose behind overflow:hidden — decorative overflow that nobody can
  // scroll to is not a bug, and this project has paid for that lesson once.
  const spilling = [];
  for (const el of document.querySelectorAll('*')) {
    if (el.clientWidth < innerWidth - 2) continue;
    const ox = getComputedStyle(el).overflowX;
    if (ox !== 'auto' && ox !== 'scroll') continue;
    if (el.scrollWidth > el.clientWidth + 2) spilling.push(name(el) + '@' + el.scrollWidth);
  }

  // Text clipped to a fraction of itself reads as broken even though nothing
  // overflows: at four columns the quick-pick labels came out as one letter
  // and a full stop. An ellipsis on a long title is fine; showing under half
  // of a short one is not.
  const truncated = [];
  for (const el of document.querySelectorAll('.quick-card__label, .card__title, .card__sub, .shelf__title')) {
    if (!vis(el)) continue;
    if (el.clientWidth < 120 && el.scrollWidth > el.clientWidth * 2) {
      truncated.push(name(el) + '@' + el.clientWidth + 'of' + el.scrollWidth);
    }
  }

  return {
    cut: [...new Set(cut)].slice(0, 6),
    squeezed: [...new Set(squeezed)].slice(0, 4),
    spilling: [...new Set(spilling)].slice(0, 4),
    truncated: [...new Set(truncated)].slice(0, 4),
    scrollW: document.documentElement.scrollWidth,
  };
};

const clean = (d) => !d.cut.length && !d.squeezed.length && !d.spilling.length && !d.truncated.length;

const report = (d) => {
  if (d.cut.length) console.log(`    cut off  : ${d.cut.join(', ')}`);
  if (d.squeezed.length) console.log(`    past edge: ${d.squeezed.join(', ')}`);
  if (d.spilling.length) console.log(`    spilling : ${d.spilling.join(', ')}`);
  if (d.truncated.length) console.log(`    clipped  : ${d.truncated.join(', ')}`);
};

(async () => {
  const br = await chromium.launch();
  const p = await br.newPage({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 100)));
  p.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('[cover-diag]')) errs.push(m.text().slice(0, 100));
  });

  await p.goto(BASE_URL, { waitUntil: 'networkidle' });
  await seed(p);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);

  const routes = [
    ['home', '#home'],
    ['search', '#search'],
    ['browse', '#browse'],
    ['browse/decade', '#browse/decade/2020s'],
    ['library albums', '#library?view=albums'],
    ['library artists', '#library?view=artists'],
    ['liked', '#liked-songs'],
    ['settings', '#settings'],
  ];

  let bad = 0;
  for (const [label, hash] of routes) {
    await p.evaluate((h) => { location.hash = h; }, hash);
    await p.waitForTimeout(700);
    const d = await p.evaluate(audit);
    const ok = clean(d) && d.scrollW <= 391;
    if (!ok) bad++;
    console.log(`${label.padEnd(16)} scrollW=${String(d.scrollW).padEnd(5)} ${ok ? 'OK' : 'FAIL'}`);
    report(d);
  }

  // Artist and album are reached through the library.
  await p.evaluate(() => { location.hash = '#home'; });
  await p.waitForTimeout(500);
  const k = await p.evaluate(() => document.querySelector('[data-album]')?.dataset.album);
  if (k) {
    await p.evaluate((x) => { location.hash = '#album/' + x; }, k);
    await p.waitForTimeout(800);
    const d = await p.evaluate(audit);
    const ok = clean(d);
    if (!ok) bad++;
    console.log(`${'album'.padEnd(16)} scrollW=${String(d.scrollW).padEnd(5)} ${ok ? 'OK' : 'FAIL'}`);
    report(d);
  }

  console.log(`\nerrors: ${errs.length ? errs.slice(0, 3).join(' | ') : 'none'}`);
  if (errs.length) bad++;
  await br.close();
  console.log(bad === 0 ? 'every view clean at 390' : `${bad} view(s) need work`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('FAILED: ' + e.message); process.exit(1); });
