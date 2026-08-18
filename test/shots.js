#!/usr/bin/env node
// Regenerates the two screenshots the landing page uses.
//
//   node test/shots.js
//
// They are the real app driven by the same fixture library the suites seed,
// photographed at the two widths the layout is designed around. Nothing on
// that page is a mock-up, which also means the shots go stale when the app
// changes — this is how they are refreshed.
//
// Playwright writes PNG; ImageMagick converts to WebP, which is about a fifth
// of the size for a screenshot of flat UI. Only needed to regenerate.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const { ROOT, seed, serveRepo } = require('./lib/harness');

const OUT = path.join(ROOT, 'shots');
const SHOTS = [
  ['desktop', 1440, 900],
  ['phone', 390, 844],
];

(async () => {
  try {
    execFileSync('magick', ['-version'], { stdio: 'ignore' });
  } catch {
    console.error('needs ImageMagick (the `magick` command) to write WebP');
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });

  const server = await serveRepo();
  const br = await chromium.launch();
  for (const [name, width, height] of SHOTS) {
    const p = await br.newPage({ viewport: { width, height }, colorScheme: 'dark' });
    await p.goto(server.url + '/player.html', { waitUntil: 'networkidle' });
    await seed(p);
    await p.reload({ waitUntil: 'networkidle' });
    // The shelves animate in; shooting early catches them mid-rise.
    await p.waitForTimeout(2000);
    const png = path.join(OUT, name + '.png');
    await p.screenshot({ path: png });
    await p.close();

    const webp = path.join(OUT, name + '.webp');
    execFileSync('magick', [png, '-quality', '82', '-define', 'webp:method=6', webp]);
    fs.unlinkSync(png);
    console.log(`${name.padEnd(8)} ${width}x${height}  ${(fs.statSync(webp).size / 1024).toFixed(0)}kb`);
  }
  await br.close();
  server.close();
})().catch((e) => { console.error('FAILED: ' + e.message); process.exit(1); });
