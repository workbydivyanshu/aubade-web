// Prove the visualiser reacts to real sound: play a sweep from low to high
// through the app's own audio element and watch which bars move.
//
// This suite used to only print what it found, which meant it passed whether
// the bars danced or sat dead — the same blind spot that let a dead volume
// button ship. Every number it measures is now an assertion.
const { PLAYER_URL, launch } = require('./lib/harness');

// scaleY(0.35) is a bar at rest: the visualiser draws 0.35 + level * 0.65, so
// anything at 0.35 is reading silence in its band, and 0 is no inline
// transform at all — what stopVisualiser leaves behind.
const REST = 0.35;

// Weighted mean bar index of everything above rest. One number for "where the
// energy is sitting", so the sweep's climb can be asserted as a climb rather
// than as a pile of per-bar comparisons.
const centre = (bars) => {
  const above = bars.map((x) => Math.max(0, x - REST));
  const total = above.reduce((a, b) => a + b, 0);
  return total ? above.reduce((acc, x, i) => acc + x * i, 0) / total : -1;
};

(async () => {
  const br = await launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await br.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)); });

  let bad = 0;
  const check = (label, ok, detail = '') => {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
    if (!ok) bad++;
  };

  await p.goto(PLAYER_URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);

  const barCount = await p.evaluate(() => document.querySelectorAll('#np-eq i').length);
  check('the visualiser has the seven bars the markup promises', barCount === 7,
    `${barCount} bars`);
  check('the app\'s own audio element is there to be driven',
    await p.evaluate(() => !!document.getElementById('player-audio')));

  const out = await p.evaluate(async () => {
    // Six seconds at the same 1250 Hz/s climb the 4-second version used, so
    // every reading below lands on the frequency it always did — the extra
    // room is only so the mute and pause probes finish before the file ends.
    // Playback ending sets paused, which stops the visualiser for its own
    // reasons and would make a settle check pass without meaning anything.
    const rate = 44100, secs = 6, n = rate * secs;
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
      const f = 80 + (i / n) * 7500;      // sweep low -> high
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
    const live = () => document.getElementById('np-eq').classList.contains('is-live');
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    await wait(600);
    const early = read();                   // sweep is still low
    // A run of samples, not two snapshots: a visualiser frozen at a plausible
    // height looks identical to a working one if you only ever look twice.
    const series = [];
    for (let i = 0; i < 10; i++) { series.push(read()); await wait(150); }
    await wait(700);
    const late = read();                    // sweep has climbed
    const isLive = live();

    // Muting is upstream of nothing — the analyser taps the element before the
    // mute — so the bars are expected to keep tracking. What must not happen
    // is them stopping dead at whatever height they held.
    el.muted = true;
    await wait(300);
    const mutedEarly = read();
    await wait(300);
    const mutedLate = read();
    el.muted = false;

    el.pause();
    await wait(300);
    const settled = read();
    await wait(400);
    const stillSettled = read();
    return { early, series, late, live: isLive, mutedEarly, mutedLate,
             settled, stillSettled, afterPause: live() };
  });

  const fmt = (a) => '[' + a.map((x) => x.toFixed(2)).join(' ') + ']';

  check('the visualiser marks itself live while sound is playing', out.live === true);

  // How far each bar travelled over the sampled run. The two bars the sweep
  // passes through never travelled less than 0.51 across six runs, so 0.3 is
  // most of a halving and still nowhere near reachable by a bar that is not
  // moving. The two bars the sweep has already left do move, but by anything
  // from 0.07 to 0.24 depending on where the samples land in their decay —
  // counting those towards the threshold is how this check would go flaky,
  // so they are reported and not relied on.
  const spans = out.series[0].map((_, i) => {
    const col = out.series.map((s) => s[i]);
    return Math.max(...col) - Math.min(...col);
  });
  const movers = spans.filter((s) => s >= 0.3).length;
  const stirred = spans.filter((s) => s >= 0.05).length;
  check('the bars move while the sweep plays', movers >= 2,
    `${movers} bars moved by 0.3+, ${stirred} of ${spans.length} stirred at all, ` +
    `spans ${fmt(spans)}`);

  // Height, not just motion: a bar can jitter around rest and still be reading
  // nothing. Two bars stand near full height in every sample of every run.
  const tallEarly = out.early.filter((x) => x > 0.5).length;
  const tallLate = out.late.filter((x) => x > 0.5).length;
  check('bars stand up out of the resting height for real sound',
    tallEarly >= 2 && tallLate >= 2,
    `${tallEarly} tall early ${fmt(out.early)}, ${tallLate} tall late ${fmt(out.late)}`);

  // The sweep climbs, so the energy must climb with it. Measured rises were
  // 1.04, 1.60 and 1.23 bar-widths; 0.6 sits under half the smallest and is
  // still far outside anything a static or lockstep visualiser could produce.
  const rise = centre(out.late) - centre(out.early);
  check('the movement follows the sweep upward', rise >= 0.6,
    `energy centre ${centre(out.early).toFixed(2)} -> ${centre(out.late).toFixed(2)}`);

  // Named separately because the failure the suite exists to catch is the low
  // bars twitching alone while everything above them stays dead. Bars 2 and 3
  // are the ones the sweep is inside by the late sample; they rose by at
  // least 0.44 and 0.63 across runs, so 0.2 is a comfortable floor.
  const midRise = out.late[2] - out.early[2];
  const upperRise = out.late[3] - out.early[3];
  check('the bars the sweep has climbed into are the ones that grow',
    midRise >= 0.2 && upperRise >= 0.2,
    `bar 2 ${out.early[2].toFixed(2)} -> ${out.late[2].toFixed(2)}, ` +
    `bar 3 ${out.early[3].toFixed(2)} -> ${out.late[3].toFixed(2)}`);

  // The other half of tracking the sweep: the top band reads 6.6-9.2 kHz and
  // the sweep is only at 3.6 kHz by the late sample, so it must stay down
  // while the bars below it stand up. Bars that all move together are a timer
  // animation wearing the costume of a spectrum, and this is what catches it.
  // It reads exactly rest in every run so far, but the clipped chirp does put
  // a little harmonic energy up there — a muted sample once came back at
  // 0.39 — so this asks for a gap rather than for the resting value itself.
  const topGap = out.late[3] - out.late[6];
  check('bands the sweep never reaches stay down while the rest rise',
    out.late[6] <= REST + 0.25 && topGap >= 0.3,
    `top bar ${out.early[6].toFixed(2)} -> ${out.late[6].toFixed(2)}, ` +
    `${topGap.toFixed(2)} below the bar the sweep is inside`);

  // Frozen means every bar identical across 300ms while some are still held
  // up. Falling to rest is fine; stopping mid-air is the bug.
  const mutedDelta = Math.max(...out.mutedEarly.map((x, i) => Math.abs(x - out.mutedLate[i])));
  const heldUp = out.mutedLate.some((x) => x > REST + 0.02);
  check('muting does not freeze the bars mid-height', !(heldUp && mutedDelta === 0),
    `${fmt(out.mutedEarly)} -> ${fmt(out.mutedLate)}, largest change ${mutedDelta.toFixed(3)}`);

  check('the visualiser stops marking itself live once playback stops',
    out.afterPause === false);

  // stopVisualiser clears the inline transform, so a settled bar reads 0 here.
  // Anything between rest and full height is a bar abandoned mid-fall.
  const atRest = out.settled.filter((x) => x <= REST).length;
  check('the bars settle back to rest when the sound stops', atRest === out.settled.length,
    `${atRest} of ${out.settled.length} at rest ${fmt(out.settled)}`);
  check('and stay settled rather than drifting afterwards',
    out.stillSettled.every((x, i) => x === out.settled[i]), fmt(out.stillSettled));

  console.log(`\nerrors: ${errs.length ? errs.slice(0, 3).join(' | ') : 'none'}`);
  if (errs.length) bad++;
  await br.close();
  console.log(bad === 0 ? 'the bars follow real sound up the spectrum and settle when it stops' : `${bad} check(s) failed`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('FAILED: ' + e.message); process.exit(1); });
