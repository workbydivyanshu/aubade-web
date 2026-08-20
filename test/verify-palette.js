// Feed the palette extractor covers whose colours are known, and check what it
// returns. Averaging pixels produces mud; the question is whether bucketing by
// hue actually recovers the colours that are in the image.
//
// This suite used to only print what it found, which meant it passed whatever
// the extractor did — including returning one fixed colour for every cover, or
// computing a palette and never putting it on the page. Both are silent: the
// scrim still renders, just wrong. Every measurement below is now an assertion.
const { chromium } = require('playwright');
const { PLAYER_URL, seed } = require('./lib/harness');

// The hues actually in the test covers, so a failure can name what was missed.
// Read off the same rgb→hsl the extractor uses, then quantised into its 15°
// buckets; a recovered hue further than one bucket away is a different colour.
const HUE_TOLERANCE = 15;
const HUES = {
  red: 350, blue: 226, green: 140, yellow: 51, pink: 339, teal: 174,
};

// The scrim's own layer stack, alphas and all, read off nowplaying.css: four
// radial washes of the extracted colours over a tinted near-black, and the
// page's black under everything.
//
// Text crosses the whole sheet, so it has to hold up at both ends of that
// stack: the plain backdrop where no wash reaches, and the corner where the
// washes pile up. Both are measured, and the weaker one is what counts.
const SCRIM_PLAIN = [['bg', 0.88]];
const SCRIM_WASHED = [['bg', 0.88], ['c4', 0.20], ['c3', 0.24], ['c2', 0.26], ['c1', 0.34]];

// WCAG AA for body text. The now-playing labels that take --np-accent are
// 14px at weight 500, which is not large text by any reading of the spec.
const MIN_CONTRAST = 4.5;

// Run inside the page: CSS parses `hsl(...)` far more reliably than a regex,
// and the contrast arithmetic is the same as verify-landing's.
const CONTRAST = ({ pal, layers }) => {
  const rgbOf = (css) => {
    const d = document.createElement('div');
    d.style.color = css;
    document.body.appendChild(d);
    const m = getComputedStyle(d).color.match(/-?[\d.]+/g).map(Number);
    d.remove();
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
  const ratio = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return +((hi + 0.05) / (lo + 0.05)).toFixed(2);
  };
  let scrim = { r: 0, g: 0, b: 0, a: 1 };
  for (const [token, alpha] of layers) scrim = over({ ...rgbOf(pal[token]), a: alpha }, scrim);
  return {
    white: ratio({ r: 255, g: 255, b: 255 }, scrim),
    accent: ratio(rgbOf(pal.accent), scrim),
  };
};

// Distance round the colour wheel, which is not |a-b| once you cross red.
const hueGap = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
const hueOf = (css) => Number(String(css).match(/-?[\d.]+/)[0]);
const lightOf = (css) => Number(String(css).match(/-?[\d.]+/g)[2]);

// Paint the sheet with what the given hue actually produces, hide the accent
// label's glyphs, screenshot, and read the pixel the label sits on. This is
// the only way to grade a colour drawn over four overlapping radial washes:
// the composite is the browser's arithmetic, not something to re-derive.
async function measureAccent(p, hue) {
  await p.evaluate(async (h) => {
    const { accentTextLightness } = await import('./colour.js');
    document.getElementById('app').classList.remove('is-idle');
    const np = document.getElementById('now-playing');
    np.classList.add('is-open');
    np.style.setProperty('--np-accent', `hsl(${h} 82% ${accentTextLightness(h)}%)`);
    np.style.setProperty('--np-c1', `hsl(${h} 78% 49%)`);
    np.style.setProperty('--np-c2', `hsl(${(h + 18) % 360} 78% 49%)`);
    np.style.setProperty('--np-c3', `hsl(${(h + 36) % 360} 78% 49%)`);
    np.style.setProperty('--np-c4', `hsl(${(h + 54) % 360} 78% 49%)`);
    np.style.setProperty('--np-bg', `hsl(${h} 42% 9%)`);
  }, hue);
  await p.waitForTimeout(500);

  const box = await p.evaluate(() => {
    const el = document.querySelector('.np-device');
    if (!el) return null;
    const b = el.getBoundingClientRect();
    el.style.visibility = 'hidden';
    return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2),
             fg: getComputedStyle(el).color };
  });
  if (!box) return { ratio: 0, fg: 'no .np-device', bg: [0, 0, 0] };
  await p.waitForTimeout(150);
  const b64 = (await p.screenshot()).toString('base64');
  await p.evaluate(() => { document.querySelector('.np-device').style.visibility = ''; });

  const bg = await p.evaluate(async ({ b64, box }) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const d = g.getImageData(box.x, box.y, 1, 1).data;
    return [d[0], d[1], d[2]];
  }, { b64, box });

  const fg = box.fg.match(/-?[\d.]+/g).map(Number);
  const lum = ([r, g, b]) => { const f = (c) => { c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
  return { ratio: +((hi + 0.05) / (lo + 0.05)).toFixed(2), fg: box.fg, bg };
}

(async () => {
  const br = await chromium.launch();
  const p = await br.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 140)));
  p.on('console', (m) => {
    // The cover walker narrates its own failures at warn level; anything that
    // reaches console.error here is a real fault.
    if (m.type() === 'error' && !m.text().includes('[cover-diag]')) errs.push(m.text().slice(0, 140));
  });

  let bad = 0;
  const check = (label, ok, detail = '') => {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
    if (!ok) bad++;
  };

  // ── Part 1: what the extractor recovers ─────────────────────────────
  // Straight calls into art.js with covers painted here, so the colours going
  // in are known exactly and the answer can be graded rather than admired.
  await p.goto(PLAYER_URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);

  const out = await p.evaluate(async () => {
    const { getCoverPalette } = await import('./art.js');

    // Paint a cover from given colours and hand back a data URL.
    const make = (bands) => {
      const c = document.createElement('canvas');
      c.width = c.height = 200;
      const x = c.getContext('2d');
      bands.forEach((col, i) => {
        x.fillStyle = col;
        x.fillRect(0, (200 / bands.length) * i, 200, 200 / bands.length);
      });
      return c.toDataURL();
    };

    const cases = {
      'red/blue/green/yellow': ['#e01b3c', '#1b4ae0', '#1ba84a', '#e0c21b'],
      'pink + yellow (Chuck Timely)': ['#ff2d78', '#ffd400', '#ff2d78', '#111111'],
      'mostly black with one teal': ['#080808', '#080808', '#0f9b8e', '#080808'],
      'greyscale only': ['#111111', '#555555', '#999999', '#dddddd'],
    };
    const res = {};
    for (const [name, bands] of Object.entries(cases)) {
      res[name] = await getCoverPalette(make(bands));
    }
    return res;
  });

  for (const [name, pal] of Object.entries(out)) {
    console.log(`\n${name}`);
    if (!pal) { console.log('  -> null (no colour found)'); continue; }
    console.log(`  c1 ${pal.c1}   c2 ${pal.c2}`);
    console.log(`  c3 ${pal.c3}   c4 ${pal.c4}`);
    console.log(`  bg ${pal.bg}   accent ${pal.accent}`);
  }
  console.log('');

  const four = out['red/blue/green/yellow'];
  const pinkYellow = out['pink + yellow (Chuck Timely)'];
  const teal = out['mostly black with one teal'];
  const grey = out['greyscale only'];

  // The check the whole feature hangs on. A palette that has quietly stopped
  // reading the image still returns something — one fixed set of colours for
  // every record — and nothing else here would notice.
  check('a cover of four colours gives back all four of them', !!four && (() => {
    const got = [four.c1, four.c2, four.c3, four.c4].map(hueOf);
    return ['red', 'blue', 'green', 'yellow']
      .every((k) => got.some((h) => hueGap(h, HUES[k]) <= HUE_TOLERANCE));
  })(), four ? [four.c1, four.c2, four.c3, four.c4].map(hueOf).join('°, ') + '°' +
    ` vs wanted ${HUES.red}° ${HUES.blue}° ${HUES.green}° ${HUES.yellow}°` : 'null');

  check('and does not return four shades of the same one', !!four && (() => {
    const got = [four.c1, four.c2, four.c3, four.c4].map(hueOf);
    return got.every((h, i) => got.every((g, j) => i === j || hueGap(h, g) >= 25));
  })(), four ? [four.c1, four.c2, four.c3, four.c4].map(hueOf).join('°, ') + '°' : 'null');

  check('a two-colour cover keeps both of its colours', !!pinkYellow && (() => {
    const got = [pinkYellow.c1, pinkYellow.c2, pinkYellow.c3, pinkYellow.c4].map(hueOf);
    return ['pink', 'yellow'].every((k) => got.some((h) => hueGap(h, HUES[k]) <= HUE_TOLERANCE));
  })(), pinkYellow ? [pinkYellow.c1, pinkYellow.c2].map(hueOf).join('°, ') + '°' +
    ` vs wanted ${HUES.pink}° ${HUES.yellow}°` : 'null');

  // A single band of colour on black is the case that most looks like nothing
  // was found. It is also what a lot of real sleeves are.
  check('one band of teal on black is still found', !!teal &&
    hueGap(hueOf(teal.c1), HUES.teal) <= HUE_TOLERANCE,
    teal ? `c1 ${hueOf(teal.c1)}° vs wanted ${HUES.teal}°` : 'null');

  check('and the accent follows that same colour', !!teal &&
    hueGap(hueOf(teal.accent), HUES.teal) <= HUE_TOLERANCE,
    teal ? `accent ${teal.accent}` : 'null');

  check('a one-colour cover still gives four separable layers', !!teal && (() => {
    const got = [teal.c1, teal.c2, teal.c3, teal.c4].map(hueOf);
    return new Set(got).size === 4;
  })(), teal ? [teal.c1, teal.c2, teal.c3, teal.c4].map(hueOf).join('°, ') + '°' : 'null');

  // Nothing in a greyscale sleeve says what colour the record is, and guessing
  // one is worse than saying so: the app clears its tokens on a null.
  check('a greyscale cover reports no colour rather than inventing one',
    grey === null, grey ? JSON.stringify(grey) : 'null');

  // Two different sleeves must not land on the same colour. This is the shape
  // a silent fallback takes — every album themed identically.
  check('two unlike covers do not come back the same colour',
    !!four && !!teal && hueGap(hueOf(four.accent), hueOf(teal.accent)) > 25,
    four && teal ? `${four.accent} vs ${teal.accent}` : 'null');

  // The backdrop is deliberately near-black: a bright sleeve has no dark pixels
  // to sample, and following it would put white text on a white field.
  for (const [name, pal] of Object.entries(out)) {
    if (!pal) continue;
    const l = lightOf(pal.bg);
    check(`the backdrop for ${name} stays near-black`, l >= 4 && l <= 9, `${pal.bg}`);
  }

  // Readability, measured the way verify-landing measures it: the foreground
  // against the colour actually behind it, composited down onto the page black.
  // A palette that recovers the right hue and then hides the text is still a
  // broken palette, so the colours are graded on that too.
  for (const [name, pal] of Object.entries(out)) {
    if (!pal) continue;
    const plain = await p.evaluate(CONTRAST, { pal, layers: SCRIM_PLAIN });
    const washed = await p.evaluate(CONTRAST, { pal, layers: SCRIM_WASHED });
    const both = (k) => `${plain[k]}:1 on the plain backdrop, ${washed[k]}:1 under the washes`;
    check(`white now-playing text stays readable over ${name}`,
      Math.min(plain.white, washed.white) >= MIN_CONTRAST, both('white'));
  }

  // The accent is not graded against the synthetic stack above. Stacking all
  // four washes at full alpha describes a corner of the sheet that does not
  // exist once the radials are placed, and it condemned every hue at around
  // 1.2:1 while the pixels actually rendered behind that label sit between
  // 0.0066 and 0.0173 relative luminance. So the accent is measured where it
  // is drawn: hide the glyphs, screenshot, read the ground underneath.
  for (const hue of [353, 233, 47, 173, 120, 287]) {
    const measured = await measureAccent(p, hue);
    check(`accent text on the sheet is readable at hue ${hue}`,
      measured.ratio >= MIN_CONTRAST,
      `${measured.ratio}:1 — ${measured.fg} on rgb(${measured.bg.join(',')})`);
  }

  // ── Part 2: does any of it reach the page ───────────────────────────
  // Extracting a colour and dropping it looks identical to extracting nothing.
  //
  // The two stubs below stand in for the filesystem, which is the one thing a
  // headless page cannot have: no folder can be picked, so no track resolves
  // and no cover is ever read, and updatePlayerUI — the only code that paints
  // these tokens — never runs. Both stubs sit at the file boundary; the palette
  // extractor and every line of app.js that applies it are the real ones.
  const q = await br.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  const qErrs = [];
  q.on('pageerror', (e) => qErrs.push(String(e).slice(0, 140)));

  await q.addInitScript(() => {
    window.__aubadeFakeDir = {
      name: 'Test Music',
      queryPermission: async () => 'granted',
      requestPermission: async () => 'granted',
      async getDirectoryHandle() { return window.__aubadeFakeDir; },
      getFileHandle: async (name) => ({
        name,
        getFile: async () => new File([new Uint8Array(4096)], name, { type: 'audio/ogg' }),
      }),
    };
  });

  const patched = { db: false, art: false };
  await q.route('**/db.js', async (route) => {
    const res = await route.fetch();
    const src = await res.text();
    const marker = "export async function dbGet(key, storeName = 'handles') {";
    patched.db = src.includes(marker);
    route.fulfill({
      headers: { 'content-type': 'text/javascript; charset=utf-8' },
      body: src.replace(marker, marker +
        "\n  if (key === 'musicDir' && window.__aubadeFakeDir) return window.__aubadeFakeDir;"),
    });
  });
  await q.route('**/art.js', async (route) => {
    const res = await route.fetch();
    const src = await res.text();
    const marker = 'export async function coverUrlForAlbum(album) {';
    patched.art = src.includes(marker);
    route.fulfill({
      headers: { 'content-type': 'text/javascript; charset=utf-8' },
      body: src.replace(marker, marker +
        '\n  if (window.__aubadeTestCover) return window.__aubadeTestCover;'),
    });
  });

  await q.goto(PLAYER_URL, { waitUntil: 'networkidle' });
  await seed(q);
  await q.reload({ waitUntil: 'networkidle' });
  await q.waitForTimeout(1400);

  // If either seam moved, the rest of this section would test nothing and say
  // so with a pass. Fail loudly instead.
  check('the filesystem stand-ins still fit the code they stand in for',
    patched.db && patched.art, JSON.stringify(patched));

  // Paint a cover in the page and hand it to the app as the album's artwork.
  const setCover = (page, colour) => page.evaluate((col) => {
    const c = document.createElement('canvas');
    c.width = c.height = 200;
    const x = c.getContext('2d');
    x.fillStyle = col;
    x.fillRect(0, 0, 200, 200);
    window.__aubadeTestCover = c.toDataURL();
  }, colour);

  const tokens = () => q.evaluate(() => {
    const np = document.getElementById('now-playing');
    const read = (k) => np.style.getPropertyValue(k).trim();
    return {
      accent: read('--np-accent'), c1: read('--np-c1'), c2: read('--np-c2'),
      c3: read('--np-c3'), c4: read('--np-c4'), bg: read('--np-bg'),
      // What the browser will actually paint, not just what was set on the
      // element — a token nothing consumes is the same as no token.
      scrim: getComputedStyle(document.querySelector('.now-playing__scrim')).backgroundImage,
      idle: document.getElementById('app').classList.contains('is-idle'),
    };
  });

  const albums = await q.evaluate(() => {
    location.hash = '#home';
    return [...document.querySelectorAll('[data-album]')].slice(0, 2).map((e) => e.dataset.album);
  });

  const playFrom = async (albumKey) => {
    await q.evaluate((k) => { location.hash = '#album/' + k; }, albumKey);
    await q.waitForTimeout(900);
    await q.evaluate(() => document.querySelector('.track-row')?.click());
    await q.waitForTimeout(1200);
  };

  await setCover(q, '#e01b3c');
  await playFrom(albums[0]);
  const red = await tokens();
  console.log(`\nafter a red cover: ${JSON.stringify({ ...red, scrim: undefined })}`);

  check('a track with a cover leaves the sheet out of its idle state',
    red.idle === false, `is-idle=${red.idle}`);
  check('playing it paints every scrim token onto the sheet',
    ['accent', 'c1', 'c2', 'c3', 'c4', 'bg'].every((k) => red[k] !== ''),
    ['accent', 'c1', 'c2', 'c3', 'c4', 'bg'].filter((k) => red[k] === '').join(', ') || 'all six set');
  check('and the colour painted is the one the cover holds',
    red.c1 !== '' && hueGap(hueOf(red.c1), HUES.red) <= HUE_TOLERANCE,
    red.c1 ? `${red.c1} vs wanted ${HUES.red}°` : 'nothing set');

  // A custom property nobody reads paints nothing. The scrim's computed
  // background is where the token stops being a variable and becomes a colour.
  //
  // Matching on the resolved layer rather than on rgb(): the browser mixes
  // these in oklab and serialises them that way, so the number that lands in
  // the gradient is not the rgb the token was written as. Asking the same
  // engine to resolve the same mix is the only comparison that holds.
  //
  // The transparent guard is not defensive padding. With the token unset the
  // mix resolves to a fully transparent colour, which the scrim does contain —
  // so a plain substring match reported success on a sheet painting nothing.
  const paintedRed = await q.evaluate((c1) => {
    const scrim = getComputedStyle(document.querySelector('.now-playing__scrim')).backgroundImage;
    if (!c1) return { layer: 'nothing — the token was never set', hit: false, scrim: scrim.slice(0, 80) };
    const d = document.createElement('div');
    d.style.backgroundColor = `color-mix(in oklab, ${c1} 34%, transparent)`;
    document.body.appendChild(d);
    const layer = getComputedStyle(d).backgroundColor;
    d.remove();
    const opaque = !/[/,]\s*0\)$/.test(layer);
    return { layer, hit: opaque && scrim.includes(layer), scrim: scrim.slice(0, 80) };
  }, red.c1);
  check('the scrim really renders that colour rather than holding a spare token',
    paintedRed.hit, `looking for ${paintedRed.layer} in "${paintedRed.scrim}…"`);

  await setCover(q, '#1b4ae0');
  await playFrom(albums[1]);
  const blue = await tokens();
  console.log(`after a blue cover: ${JSON.stringify({ ...blue, scrim: undefined })}`);

  check('a different cover repaints the tokens instead of keeping the last ones',
    blue.c1 !== '' && blue.c1 !== red.c1, `${red.c1} -> ${blue.c1}`);
  check('and the new colour is the new cover\'s',
    blue.c1 !== '' && hueGap(hueOf(blue.c1), HUES.blue) <= HUE_TOLERANCE,
    blue.c1 ? `${blue.c1} vs wanted ${HUES.blue}°` : 'nothing set');

  // Going idle has to take the colours with it. A stale palette is the same
  // bug the null-cover branch already guards against, one step further along.
  await q.evaluate(() => { window.__aubadeFakeDir = null; });
  await playFrom(albums[0]);
  const idle = await tokens();
  console.log(`after going idle: ${JSON.stringify({ ...idle, scrim: undefined })}`);

  check('losing the folder drops playback back to idle', idle.idle === true,
    `is-idle=${idle.idle}`);
  check('and idle clears the previous record\'s colours off the sheet',
    ['accent', 'c1', 'c2', 'c3', 'c4', 'bg'].every((k) => idle[k] === ''),
    ['accent', 'c1', 'c2', 'c3', 'c4', 'bg'].filter((k) => idle[k] !== '')
      .map((k) => `${k}=${idle[k]}`).join(', ') || 'all six cleared');

  for (const e of qErrs) errs.push(e);
  console.log(`\nerrors: ${errs.length ? errs.slice(0, 3).join(' | ') : 'none'}`);
  if (errs.length) bad++;
  await br.close();
  console.log(bad === 0
    ? 'the palette is read from the cover, painted on the sheet, readable, and cleared on idle'
    : `${bad} check(s) failed`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('FAILED: ' + e.message); process.exit(1); });
