// The bars over the cover. Reads real frequency data rather than animating on
// a timer, because the reference's own description — bass hanging like a kick
// while hi-hats jitter — is not something a keyframe can do.
//
// Takes its audio element and the overlay whose open state gates it, so it has
// no opinion about the rest of the app.

let audio;
let npOverlay;
// Called when the view opens, for work that cannot be done while it is
// hidden — measuring text, for one.
let onOverlayOpen = null;

// The reference notes for v1.8 describe bars where "bass slams and hangs like a real kick,
// hi-hats jitter fast, mids stay smooth — each column reacts on its own
// instead of moving in lockstep", so this reads real frequency data rather
// than animating on a timer. v2.4 then records the cost of leaving it on:
// analysing for a whole track with nothing on screen is what was heating
// phones. It runs only while the view is open, audio is playing and the tab
// is visible.

const EQ_BARS = [];

// Where each bar reads from, low to high, as fractions of the spectrum. The
// useful musical range sits well below Nyquist, so this stops around a third.
const EQ_BANDS = [
  [0.00, 0.02], [0.02, 0.05], [0.05, 0.09], [0.09, 0.15],
  [0.15, 0.22], [0.22, 0.30], [0.30, 0.42],
];
// Bass holds and falls slowly; the top end is allowed to flicker.
const EQ_FALL = [0.055, 0.07, 0.09, 0.12, 0.16, 0.2, 0.26];

let audioCtx = null;
let analyser = null;
let freqData = null;
let eqRaf = null;
const eqLevel = EQ_BANDS.map(() => 0);

function ensureAnalyser() {
  if (analyser || !window.AudioContext) return;
  try {
    audioCtx = new AudioContext();
    // Build the analyser before taking the element's output. Once
    // createMediaElementSource runs, the element no longer reaches the
    // speakers on its own and there is no undo — so anything that might
    // throw happens first, and the connection is made immediately after.
    const node = audioCtx.createAnalyser();
    node.fftSize = 1024;
    node.smoothingTimeConstant = 0.75;
    const buffer = new Uint8Array(node.frequencyBinCount);
    const source = audioCtx.createMediaElementSource(audio);
    source.connect(node);
    node.connect(audioCtx.destination);
    analyser = node;
    freqData = buffer;
  } catch {
    analyser = null; // not fatal; the bars simply never move
  }
}

function eqShouldRun() {
  return npOverlay.classList.contains('is-open')
    && !audio.paused
    && document.visibilityState === 'visible';
}

function eqFrame() {
  if (!eqShouldRun()) { stopVisualiser(); return; }
  analyser.getByteFrequencyData(freqData);
  const bins = freqData.length;
  for (let i = 0; i < EQ_BANDS.length; i++) {
    const [from, to] = EQ_BANDS[i];
    let peak = 0;
    const a = Math.floor(from * bins);
    const b = Math.max(a + 1, Math.floor(to * bins));
    for (let j = a; j < b; j++) if (freqData[j] > peak) peak = freqData[j];
    const target = peak / 255;
    // Rise immediately, fall at the band's own rate — that is what makes a
    // kick hang while a hi-hat snaps back.
    eqLevel[i] = target > eqLevel[i]
      ? target
      : Math.max(target, eqLevel[i] - EQ_FALL[i]);
    EQ_BARS[i].style.transform = `scaleY(${(0.35 + eqLevel[i] * 0.65).toFixed(3)})`;
  }
  eqRaf = requestAnimationFrame(eqFrame);
}

function startVisualiser() {
  if (eqRaf || !EQ_BARS.length) return;
  ensureAnalyser();
  if (!analyser) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  document.getElementById('np-eq').classList.add('is-live');
  eqRaf = requestAnimationFrame(eqFrame);
}

function stopVisualiser() {
  if (eqRaf) cancelAnimationFrame(eqRaf);
  eqRaf = null;
  const el = document.getElementById('np-eq');
  if (el) el.classList.remove('is-live');
  for (const bar of EQ_BARS) bar.style.transform = '';
}


/** Wire the visualiser to an audio element and the view that gates it. */
export function initVisualiser(audioEl, overlayEl, whenOpened) {
  audio = audioEl;
  npOverlay = overlayEl;
  onOverlayOpen = whenOpened || null;
  EQ_BARS.push(...document.querySelectorAll('#np-eq i'));

  audio.addEventListener('play', startVisualiser);
  audio.addEventListener('pause', stopVisualiser);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !audio.paused) startVisualiser();
    else stopVisualiser();
  });

  // The overlay is opened and closed from six places; watching the class
  // catches all of them without threading a call through each.
  new MutationObserver(() => {
    if (eqShouldRun()) startVisualiser(); else stopVisualiser();
    if (onOverlayOpen && npOverlay.classList.contains('is-open')) onOverlayOpen();
  }).observe(npOverlay, { attributes: true, attributeFilter: ['class'] });
}

export { startVisualiser, stopVisualiser, eqShouldRun };
