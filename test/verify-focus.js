// Every control shows where the keyboard is.
//
// The ring was written out eight times across four files and missing entirely
// from two, so tabbing through the now-playing sheet or an album page left no
// trace of where you were. A property check would not have caught it either:
// this repo has been bitten before by styles that measured correctly and did
// nothing, so what is asserted here is the pixels that change when a control
// takes focus, not the value of outline-width.
const { chromium } = require('playwright');
const { PLAYER_URL, seed } = require('./lib/harness');

// The ring is 2px at an offset of 2, so it lives in a band just outside the
// control. Screenshotting a slightly grown box catches it without dragging in
// half the page — and without the control's own hover or active paint.
const PAD = 8;

(async () => {
  const br = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
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
  await p.evaluate(() => document.getElementById('app').classList.remove('is-idle'));

  // How many pixels change in the band around a control when it takes focus.
  // Focus is given with page.focus() and then keyboard-flagged: :focus-visible
  // needs the browser to believe the focus came from the keyboard, which a
  // programmatic focus alone does not establish.
  const ringOf = async (sel) => {
    const box = await p.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      if (b.width < 1 || b.height < 1) return null;
      el.blur();
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    }, sel);
    if (!box) return null;
    const clip = {
      x: Math.max(0, Math.round(box.x - PAD)), y: Math.max(0, Math.round(box.y - PAD)),
      width: Math.round(box.w + PAD * 2), height: Math.round(box.h + PAD * 2),
    };
    if (clip.x + clip.width > 1440 || clip.y + clip.height > 900) return null;
    const before = await p.screenshot({ clip });
    await p.evaluate((s) => {
      const el = document.querySelector(s);
      // The flag Chromium reads for :focus-visible comes from the last input
      // being a key, so a real Tab is pressed at the element before focusing.
      el.focus({ focusVisible: true });
    }, sel);
    await p.keyboard.press('Shift+Tab');
    await p.keyboard.press('Tab');
    await p.waitForTimeout(120);
    const after = await p.screenshot({ clip });
    const changed = await p.evaluate(async ({ a, b, clip }) => {
      const load = async (d) => { const i = new Image(); i.src = 'data:image/png;base64,' + d;
        await i.decode(); const c = document.createElement('canvas');
        c.width = i.width; c.height = i.height; c.getContext('2d').drawImage(i, 0, 0);
        return c.getContext('2d').getImageData(0, 0, i.width, i.height).data; };
      const [A, B] = [await load(a), await load(b)];
      let n = 0;
      for (let i = 0; i < A.length; i += 4) {
        if (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]) > 24) n++;
      }
      return n;
    }, { a: before.toString('base64'), b: after.toString('base64'), clip });
    return changed;
  };

  // A ring around a control of this size draws a few hundred pixels at least.
  // Twenty is well under anything real and well over antialiasing noise.
  const MIN_PIXELS = 20;

  const family = async (name, sels) => {
    for (const sel of sels) {
      const n = await ringOf(sel);
      if (n === null) { check(`${name}: ${sel} is reachable to focus`, false, 'absent or off screen'); continue; }
      check(`${name} shows the ring: ${sel}`, n >= MIN_PIXELS, `${n} pixels changed`);
    }
  };

  await family('the sidebar', ['.sidebar__nav-item', '#new-playlist-btn', '.pinned-item']);
  // Go back and Go forward, by label: .top-bar__btn also matches the Show
  // sidebar button, which is hidden while the sidebar is open and would make
  // this read as a missing ring rather than a mis-aimed selector.
  await family('the top bar', ['.top-bar__btn[aria-label="Go back"]',
    '.top-bar__btn[aria-label="Go forward"]', '.top-bar__avatar']);

  // Show sidebar only exists once the sidebar is put away.
  await p.click('button[aria-label="Collapse sidebar"]');
  await p.waitForTimeout(500);
  await family('the collapsed top bar', ['#expand-sidebar']);
  await p.click('#expand-sidebar');
  await p.waitForTimeout(500);
  await family('the home pills', ['#seg-library', '#seg-folders']);
  await family('the player bar',
    ['#player-shuffle-btn', '#player-repeat-btn', '#player-like-btn',
     '#player-share-btn', '#player-queue-btn', '#player-vol-btn', '.player__play-btn']);

  // The album page's own buttons were among the two files with no ring at all.
  const albumKey = await p.evaluate(() => document.querySelector('[data-album]')?.dataset.album);
  await p.evaluate((k) => { location.hash = '#album/' + k; }, albumKey);
  await p.waitForTimeout(900);
  // Scoped to the album view: home's empty state carries an .album-btn--play
  // of its own, and it is first in the document.
  await family('the album page',
    ['#view-album .album-btn--play', '#view-album .album-btn--shuffle',
     '#view-album .album-btn--share', '#view-album .album-btn--more']);

  // The now-playing sheet was the other. It has to be opened first: it hides
  // with a transform, so its controls report a box while unreachable.
  await p.evaluate(() => document.querySelector('.now-playing').classList.add('is-open'));
  await p.waitForTimeout(600);
  await family('the now-playing sheet',
    ['#np-close', '#np-heart-btn', '#np-shuffle', '#np-repeat', '#np-queue-btn', '#np-vol-btn']);

  // Reduced motion has to reach everything that moves, or the setting is a
  // promise the app only half keeps.
  const rm = await br.newContext({ viewport: { width: 1440, height: 900 },
    colorScheme: 'dark', reducedMotion: 'reduce' });
  const q = await rm.newPage();
  await q.goto(PLAYER_URL, { waitUntil: 'networkidle' });
  await q.waitForTimeout(900);
  const moving = await q.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('*')) {
      const s = getComputedStyle(el);
      const dur = parseFloat(s.animationDuration) || 0;
      const inf = s.animationIterationCount === 'infinite';
      if (inf && dur > 0) out.push((el.id || el.className || el.tagName).toString().split(' ')[0]);
    }
    return [...new Set(out)];
  });
  check('nothing loops forever when motion is asked to stop',
    moving.length === 0, moving.join(', ') || 'nothing animating');

  console.log(`\nerrors: ${errs.length ? errs.slice(0, 3).join(' | ') : 'none'}`);
  if (errs.length) bad++;
  await br.close();
  console.log(bad === 0 ? 'every control shows where the keyboard is' : `${bad} check(s) failed`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('FAILED: ' + e.message); process.exit(1); });
