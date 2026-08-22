// The opening page: does it load whole, stay inside the screen at the three
// widths that matter, and are its controls actually readable?
//
// That last one is not padding. The header's call to action shipped as a
// white pill with white text — .lp-nav a is the more specific selector, so
// the button inherited the nav's colour and rendered with no visible label.
// Nothing overflowed, no error was logged, and every other check passed.
const { BASE_URL, launch } = require('./lib/harness');

// Contrast, composited over the page's black, which is what every
// translucent fill on this page sits on.
const CONTRAST = () => {
  const parse = (c) => {
    const m = c.match(/-?[\d.]+/g).map(Number);
    return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 };
  };
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  const lum = ({ r, g, b }) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const black = { r: 0, g: 0, b: 0, a: 1 };
  const out = [];
  for (const el of document.querySelectorAll('.lp-btn, .lp-nav a, .lp-card__title, .lp-stat__value')) {
    const s = getComputedStyle(el);
    const bg = over(parse(s.backgroundColor), black);
    const fg = over(parse(s.color), bg);
    const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
    const ratio = (hi + 0.05) / (lo + 0.05);
    out.push({ text: (el.textContent || '').trim().slice(0, 20), ratio: +ratio.toFixed(2) });
  }
  return out;
};

(async () => {
  const br = await launch();
  const errs = [];
  const failedReqs = [];
  let bad = 0;
  const check = (label, ok, detail = '') => {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
    if (!ok) bad++;
  };

  const p = await br.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)); });
  p.on('requestfailed', (r) => failedReqs.push(r.url().slice(-50)));
  p.on('response', (r) => { if (r.status() >= 400) failedReqs.push(r.status() + ' ' + r.url().slice(-50)); });

  await p.goto(BASE_URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(500);

  check('every request served', failedReqs.length === 0, failedReqs.slice(0, 3).join(', '));

  // The screenshots are the page's whole middle section; a broken path there
  // leaves two empty boxes and no error.
  const shots = await p.evaluate(() => [...document.querySelectorAll('.lp-shot img')]
    .map((i) => ({ src: i.getAttribute('src'), w: i.naturalWidth })));
  check('both screenshots decoded', shots.length === 2 && shots.every((s) => s.w > 0),
    shots.map((s) => `${s.src}:${s.w}`).join(' '));

  // Links either go to a file the server has or to an anchor on this page.
  const links = await p.evaluate(() => [...document.querySelectorAll('a[href]')]
    .map((a) => a.getAttribute('href')));
  const broken = [];
  for (const href of [...new Set(links)]) {
    if (href.startsWith('#')) {
      const found = await p.evaluate((h) => !!document.querySelector(h), href);
      if (!found) broken.push(href);
    } else {
      const res = await p.request.get(BASE_URL + '/' + href.split('#')[0]);
      if (!res.ok()) broken.push(href + ' (' + res.status() + ')');
    }
  }
  check('every link resolves', broken.length === 0, broken.join(', '));

  const contrast = await p.evaluate(CONTRAST);
  const dim = contrast.filter((c) => c.ratio < 4.5);
  check('text is readable against its own fill', dim.length === 0,
    dim.slice(0, 3).map((c) => `"${c.text}" ${c.ratio}:1`).join(', '));

  // The type scale is the part read off the reference; hold it in place.
  const type = await p.evaluate(() => {
    const g = (sel, prop) => getComputedStyle(document.querySelector(sel))[prop];
    return {
      headerH: Math.round(document.querySelector('.lp-header').getBoundingClientRect().height),
      h1: g('.lp-h1', 'fontSize'), h2: g('.lp-h2', 'fontSize'),
      eyebrow: g('.lp-eyebrow', 'textTransform'), eyebrowColour: g('.lp-eyebrow', 'color'),
      cardRadius: g('.lp-card', 'borderRadius'), sectionPad: g('.lp-section', 'paddingTop'),
      cols: g('.lp-cards', 'gridTemplateColumns').split(' ').length,
    };
  });
  check('header is 65px', type.headerH === 65, type.headerH + 'px');
  check('h1 is 72px', type.h1 === '72px', type.h1);
  check('h2 is 48px', type.h2 === '48px', type.h2);
  check('eyebrows are uppercase accent', type.eyebrow === 'uppercase' &&
    type.eyebrowColour === 'rgb(251, 44, 90)', `${type.eyebrow} ${type.eyebrowColour}`);
  check('cards are 24px and three across', type.cardRadius === '24px' && type.cols === 3,
    `${type.cardRadius} / ${type.cols} columns`);
  check('sections sit on the 96px rhythm', type.sectionPad === '96px', type.sectionPad);

  // Nothing may run off the side at any of the three widths.
  for (const w of [1440, 768, 390]) {
    await p.setViewportSize({ width: w, height: 900 });
    await p.waitForTimeout(300);
    const d = await p.evaluate(() => {
      const past = [];
      for (const el of document.querySelectorAll('.lp-header, .lp-hero, .lp-section, .lp-card, .lp-stat, .lp-footer, .lp-btn, .lp-h1, .lp-h2')) {
        const r = el.getBoundingClientRect();
        if (r.right > innerWidth + 2 || r.left < -2) {
          past.push(((el.className || '').toString().split(/\s+/)[0]) + '@' + Math.round(r.right));
        }
      }
      return { scrollW: document.documentElement.scrollWidth, past: [...new Set(past)].slice(0, 4),
        h1: getComputedStyle(document.querySelector('.lp-h1')).fontSize,
        cols: getComputedStyle(document.querySelector('.lp-cards')).gridTemplateColumns.split(' ').length };
    });
    check(`${w}px stays inside the screen`, d.scrollW <= w + 1 && d.past.length === 0,
      `scrollW ${d.scrollW}, h1 ${d.h1}, ${d.cols} card column(s)` +
      (d.past.length ? ' — past edge: ' + d.past.join(', ') : ''));
  }

  // At phone width the nav collapses to the one control worth keeping.
  const phoneNav = await p.evaluate(() => ({
    links: [...document.querySelectorAll('.lp-nav a:not(.lp-btn)')]
      .filter((a) => getComputedStyle(a).display !== 'none').length,
    cta: (() => { const b = document.querySelector('.lp-nav .lp-btn');
      const r = b.getBoundingClientRect();
      return { visible: r.width > 40 && r.right <= innerWidth + 1, text: b.textContent.trim() }; })(),
  }));
  check('phone header keeps only the call to action', phoneNav.links === 0 && phoneNav.cta.visible,
    `${phoneNav.links} section link(s), cta "${phoneNav.cta.text}"`);

  // Motion must never be able to leave the page blank. Everything measured
  // above still measures correctly on a page whose sections never fade in,
  // so check the three states that matter: revealed on scroll, shown at once
  // when motion is unwanted, and shown at once when the script never runs.
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.goto(BASE_URL + '/', { waitUntil: 'networkidle' });
  await p.waitForTimeout(400);
  // Wheel down the page, rather than scripting a jump to the bottom. Two
  // separate reasons, both found by running this in WebKit:
  //
  // `scrollTo(0, y)` scrolled nothing there at all — the page asks for
  // `scroll-behavior: smooth` and headless WebKit runs no scroll animation, so
  // the check was measuring whether a scroll animation ran. And even an
  // instant scrollTo, which does move the page, never makes WebKit re-evaluate
  // its observers; a wheel does, in every engine, because it is what a reader
  // actually does. Scrolling through also matters more than arriving: one jump
  // to the bottom leaves the sections in between unintersected, and correctly
  // still hidden.
  for (let i = 0; i < 6; i++) {
    await p.mouse.wheel(0, 700);
    await p.waitForTimeout(250);
  }
  await p.waitForTimeout(600);
  const revealed = await p.evaluate(() => [...document.querySelectorAll('.reveal')]
    .every((el) => +getComputedStyle(el).opacity === 1));
  check('sections arrive when scrolled to', revealed);
  check('the header takes its surface after scrolling', await p.evaluate(() =>
    document.querySelector('.lp-header').classList.contains('is-scrolled')));

  for (const [label, opts] of [['motion is unwanted', { reducedMotion: 'reduce' }],
                               ['the script never runs', { javaScriptEnabled: false }]]) {
    const ctx = await br.newContext({ viewport: { width: 1440, height: 900 },
                                      colorScheme: 'dark', ...opts });
    const q = await ctx.newPage();
    await q.goto(BASE_URL + '/', { waitUntil: 'networkidle' });
    await q.waitForTimeout(400);
    const shown = await q.evaluate(() => [...document.querySelectorAll('.reveal')]
      .every((el) => +getComputedStyle(el).opacity === 1));
    check(`nothing is hidden when ${label}`, shown);
    await ctx.close();
  }

  console.log(`\nerrors: ${errs.length ? errs.slice(0, 3).join(' | ') : 'none'}`);
  if (errs.length) bad++;
  await br.close();
  console.log(bad === 0 ? 'the opening page is sound' : `${bad} check(s) failed`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('FAILED: ' + e.message); process.exit(1); });
