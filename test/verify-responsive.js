// Narrow-screen layout, checked against what the reference actually does:
// rail down to 768px, docked bar of four below it, nothing in between.
//
// The important check is the last one — nothing may spill sideways. A phone
// layout that "works" but scrolls horizontally is the failure people notice
// first, and it is invisible at desktop width.
const { PLAYER_URL, seedLibrary, seed, launch } = require('./lib/harness');

const shell = () => {
  // Checking the element's own computed style is not enough: the now-playing
  // overlay is closed with opacity on the container, so its buttons each report
  // themselves fully visible while nothing is on screen. checkVisibility walks
  // the ancestors, which is the question actually being asked.
  const vis = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 4 || r.height <= 4) return false;
    if (typeof el.checkVisibility === 'function') {
      return el.checkVisibility({
        opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true,
      });
    }
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity !== 0;
  };
  const rail = document.querySelector('.sidebar');
  const bar = document.querySelector('.tab-bar');
  const player = document.querySelector('.player');
  // An element extending past the viewport is only a bug if nothing between it
  // and the root clips or scrolls that overflow. Shelves scroll inside
  // themselves and the ambient blur layers are deliberately oversized behind an
  // overflow:hidden parent — neither makes the page scroll, and flagging them
  // would mean weakening the real check to get a pass.
  const contained = (el) => {
    for (let n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
      const ox = getComputedStyle(n).overflowX;
      if (ox === 'hidden' || ox === 'auto' || ox === 'scroll') return true;
    }
    return false;
  };
  const spill = [];
  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 24 || !vis(el)) continue;
    if ((r.left < -2 || r.right > innerWidth + 2) && !contained(el)) {
      spill.push(((el.className || '').toString().trim().split(/\s+/)[0] || el.tagName) + '@w' + Math.round(r.width));
    }
  }
  // Spill only catches what makes the page scroll. A control row that is wider
  // than the screen inside an overflow:hidden parent does not scroll — it just
  // gets cut off, which is worse and harder to see. So check the thing that
  // actually matters: can every control be reached?
  // Off-screen is not the same as unreachable. A card further along a shelf
  // sits outside the viewport but scrolls into view; a button outside an
  // overflow:hidden header is cut off for good. Walk up and see which kind of
  // ancestor clips it — the first scrollable one means reachable.
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

  const clipped = [];
  for (const el of document.querySelectorAll('button, a, [role="button"], input')) {
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8 || !vis(el)) continue;
    if (unreachable(el)) {
      clipped.push(((el.className || '').toString().trim().split(/\s+/)[0] || el.tagName) +
                   '@x' + Math.round(r.left) + '-' + Math.round(r.right));
    }
  }

  return {
    clipped: [...new Set(clipped)].slice(0, 5),
    railShown: vis(rail),
    railW: rail ? Math.round(rail.getBoundingClientRect().width) : 0,
    barShown: vis(bar),
    barH: bar && vis(bar) ? Math.round(bar.getBoundingClientRect().height) : 0,
    barItems: bar ? bar.querySelectorAll('.tab-bar__item').length : 0,
    selected: bar ? [...bar.querySelectorAll('.tab-bar__item--selected')]
      .map((a) => a.getAttribute('href')) : [],
    playerBottom: player ? Math.round(innerHeight - player.getBoundingClientRect().bottom) : null,
    docScrollW: document.documentElement.scrollWidth,
    spill: [...new Set(spill)].slice(0, 5),
  };
};

(async () => {
  const br = await launch();
  let bad = 0;
  const errs = [];

  for (const [label, w, h, wantRail] of [
    ['phone   ', 390, 844, false],
    ['phone-lg', 430, 932, false],
    ['just-under', 767, 900, false],
    ['at-break', 768, 900, true],
    ['tablet  ', 820, 1180, true],
    ['desktop ', 1440, 900, true],
  ]) {
    const p = await br.newPage({ viewport: { width: w, height: h }, colorScheme: 'dark' });
    p.on('pageerror', (e) => errs.push(`${label}: ${String(e).slice(0, 90)}`));
    p.on('console', (m) => {
      if (m.type() === 'error' && !m.text().includes('[cover-diag]')) errs.push(`${label}: ${m.text().slice(0, 90)}`);
    });
    await p.goto(PLAYER_URL, { waitUntil: 'networkidle' });
    await seed(p);
    await p.reload({ waitUntil: 'networkidle' });
    await p.waitForTimeout(1200);

    const d = await p.evaluate(shell);
    const railOk = d.railShown === wantRail;
    const barOk = d.barShown === !wantRail;
    const fits = d.docScrollW <= w + 1 && d.spill.length === 0;
    const reachable = d.clipped.length === 0;
    const ok = railOk && barOk && fits && reachable;
    if (!ok) bad++;

    console.log(`${label} ${String(w).padStart(4)}px  rail=${d.railShown ? d.railW + 'px' : 'none'}` +
                `  bar=${d.barShown ? d.barH + 'px/' + d.barItems : 'none'}` +
                `  scrollW=${d.docScrollW}  ${ok ? 'OK' : 'FAIL'}`);
    if (!railOk) console.log(`     rail: wanted ${wantRail ? 'shown' : 'hidden'}, got ${d.railShown ? 'shown' : 'hidden'}`);
    if (!barOk) console.log(`     bar : wanted ${!wantRail ? 'shown' : 'hidden'}, got ${d.barShown ? 'shown' : 'hidden'}`);
    if (!fits) console.log(`     spills sideways: ${d.spill.join(', ') || '(doc wider than viewport)'}`);
    if (!reachable) console.log(`     controls cut off: ${d.clipped.join(', ')}`);

    // The player bar hides while idle, so nothing ever laid it out — its three
    // columns resolved to 0/78/280 at 390 with two transport buttons off the
    // left edge, and no test could have seen it. Drop is-idle and look.
    const pl = await p.evaluate(() => {
      document.getElementById('app').classList.remove('is-idle');
      const cut = [];
      for (const el of document.querySelectorAll('.player button, .player a, .player input')) {
        const r = el.getBoundingClientRect();
        if (r.width < 6 || r.height < 6) continue;
        if (r.left < -2 || r.right > innerWidth + 2) {
          cut.push(((el.className || '').toString().trim().split(/\s+/)[0] || el.tagName) +
                   '@' + Math.round(r.left) + '-' + Math.round(r.right));
        }
      }
      const cols = getComputedStyle(document.querySelector('.player')).gridTemplateColumns;
      // A column squeezed to nothing hides its contents without clipping any
      // control, so the check above cannot see it. The left zone carries the
      // cover, title and artist — if it is 0 wide, you cannot tell what is
      // playing, which is the one thing this bar exists to say.
      const left = document.querySelector('.player__left');
      const leftW = left ? Math.round(left.getBoundingClientRect().width) : 0;
      const infoShown = leftW > 40;
      document.getElementById('app').classList.add('is-idle');
      return { cut: [...new Set(cut)].slice(0, 5), cols, leftW, infoShown };
    });
    const playerOk = pl.cut.length === 0 && pl.infoShown;
    console.log(`     player columns ${pl.cols}  ${playerOk ? 'OK' : 'FAIL'}`);
    if (pl.cut.length) console.log(`       controls cut off: ${pl.cut.join(', ')}`);
    if (!pl.infoShown) console.log(`       track info collapsed to ${pl.leftW}px — nothing shows what is playing`);
    if (!playerOk) bad++;

    // On phone widths the bar must track the route, not sit dead.
    if (!wantRail) {
      const routes = [['#browse', '#browse'], ['#search', '#search'], ['#library', '#library'], ['#home', '#home']];
      for (const [go, want] of routes) {
        await p.evaluate((r) => { location.hash = r; }, go);
        await p.waitForTimeout(350);
        const sel = await p.evaluate(() => [...document.querySelectorAll('.tab-bar__item--selected')]
          .map((a) => a.getAttribute('href')));
        if (sel.length !== 1 || sel[0] !== want) {
          console.log(`     ${go} -> selected ${JSON.stringify(sel)}, wanted ["${want}"]  FAIL`);
          bad++;
        }
      }
      // An album is reached from the library, so the bar should stay on Library.
      await p.evaluate(() => { location.hash = '#home'; });
      await p.waitForTimeout(300);
      const k = await p.evaluate(() => document.querySelector('[data-album]')?.dataset.album);
      if (k) {
        await p.evaluate((x) => { location.hash = '#album/' + x; }, k);
        await p.waitForTimeout(500);
        const sel = await p.evaluate(() => [...document.querySelectorAll('.tab-bar__item--selected')]
          .map((a) => a.getAttribute('href')));
        const albumOk = sel.length === 1 && sel[0] === '#library';
        console.log(`     album page keeps Library lit: ${albumOk ? 'OK' : 'FAIL ' + JSON.stringify(sel)}`);
        if (!albumOk) bad++;

        // The album header clips its own overflow, so its action row can be cut
        // off without the page ever scrolling. Check it where it actually lives.
        const ad = await p.evaluate(shell);
        console.log(`     album controls all on screen: ` +
                    `${ad.clipped.length === 0 ? 'OK' : 'FAIL ' + ad.clipped.join(', ')}`);
        if (ad.clipped.length) bad++;
      }
    }
    await p.close();
  }

  console.log(`\nerrors: ${errs.length ? errs.slice(0, 4).join(' | ') : 'none'}`);
  if (errs.length) bad++;
  await br.close();
  console.log(bad === 0 ? 'responsive shell verified' : `${bad} check(s) failed`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('FAILED: ' + e.message); process.exit(1); });
