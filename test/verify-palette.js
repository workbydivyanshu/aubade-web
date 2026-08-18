// Feed the palette extractor covers whose colours are known, and check what it
// returns. Averaging pixels produces mud; the question is whether bucketing by
// hue actually recovers the colours that are in the image.
const { chromium } = require('playwright');
const { BASE_URL } = require('./lib/harness');

(async () => {
  const br = await chromium.launch();
  const p = await br.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 140)));

  await p.goto(BASE_URL, { waitUntil: 'networkidle' });
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
    if (!pal) { console.log(`${name}\n  -> null (no colour found)`); continue; }
    console.log(`${name}`);
    console.log(`  c1 ${pal.c1}`);
    console.log(`  c2 ${pal.c2}`);
    console.log(`  c3 ${pal.c3}`);
    console.log(`  c4 ${pal.c4}`);
    console.log(`  bg ${pal.bg}   accent ${pal.accent}`);
  }
  console.log('errors: ' + (errs.length ? errs.slice(0, 3).join(' | ') : 'none'));
  await br.close();
})().catch((e) => { console.error('FAILED: ' + e.message); process.exit(1); });
