// Prove the visualiser reacts to real sound: play a sweep from low to high
// through the app's own audio element and watch which bars move.
const { chromium } = require('playwright');
const { BASE_URL } = require('./lib/harness');

(async () => {
  const br = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await br.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)); });

  await p.goto(BASE_URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);

  console.log('bars in DOM: ' + await p.evaluate(() => document.querySelectorAll('#np-eq i').length));
  console.log('audio element reachable: ' + await p.evaluate(() => !!document.getElementById('player-audio')));

  const out = await p.evaluate(async () => {
    const rate = 44100, secs = 4, n = rate * secs;
    const buf = new ArrayBuffer(44 + n * 2);
    const v = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVEfmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, n * 2, true);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const f = 80 + (i / n) * 5000;      // sweep low -> high
      ph += (2 * Math.PI * f) / rate;
      v.setInt16(44 + i * 2, Math.sin(ph) * 22000, true);
    }
    const el = document.getElementById('player-audio');
    el.src = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
    el.volume = 1; // headless has no audio device; volume 0 would zero what the analyser taps
    document.querySelector('.now-playing').classList.add('is-open');
    await el.play();

    const read = () => [...document.querySelectorAll('#np-eq i')]
      .map((b) => +(b.style.transform.match(/scaleY\(([\d.]+)\)/) || [0, 0])[1]);
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    await wait(600);
    const early = read();                   // sweep is still low
    await wait(2200);
    const late = read();                    // sweep has climbed
    const live = document.getElementById('np-eq').classList.contains('is-live');
    el.pause();
    await wait(300);
    const afterPause = document.getElementById('np-eq').classList.contains('is-live');
    return { early, late, live, afterPause };
  });

  const moved = out.early.some((x) => x > 0.35) || out.late.some((x) => x > 0.35);
  console.log('is-live while playing: ' + out.live);
  console.log('bar heights early (low sweep): ' + JSON.stringify(out.early));
  console.log('bar heights late  (high sweep): ' + JSON.stringify(out.late));
  console.log('bars responded to audio: ' + moved);
  console.log('lowest bar early vs late: ' + out.early[0] + ' -> ' + out.late[0]);
  console.log('highest bar early vs late: ' + out.early[6] + ' -> ' + out.late[6]);
  console.log('is-live after pause: ' + out.afterPause + '  (should be false)');
  console.log('errors: ' + (errs.length ? errs.slice(0, 4).join(' | ') : 'none'));
  await br.close();
})().catch((e) => { console.error('FAILED: ' + e.message); process.exit(1); });
