import { state } from './state.js';
import { openDB, dbGet, dbSet } from './db.js';
import { albumKey } from './library.js';
import { gradientFor, coverUrlForAlbum, getCoverAccent } from './art.js';
import { parseLrc } from './lrc.js';

// Only ever mutated, so an alias is safe and keeps the call sites short.
const playerState = state.player;

// ── IndexedDB (aubade / handles + library) ──────────────────
// FileSystemDirectoryHandle is structured-cloneable, so it stores
// directly — never JSON-serialise it.




// ── File walker ─────────────────────────────────────────────

const AUDIO_EXT = /\.(mp3|flac|m4a|ogg|opus|wav|aac)$/i;

async function* walkDir(dirHandle, prefix = '') {
  try {
    for await (const entry of dirHandle.values()) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.kind === 'directory') {
        yield* walkDir(entry, path);
      } else if (AUDIO_EXT.test(entry.name)) {
        yield { name: entry.name, path, handle: entry };
      }
    }
  } catch {
    // Skip directories that throw (e.g. permission denied)
  }
}

// ── Library ─────────────────────────────────────────────────

export function getLibrary() { return state.library; }

// Kept for backward compat but now just returns state.library.tracks
export function getTracks() { return state.library.tracks; }

function buildLibrary(records) {
  // Group albums by case-insensitive (albumArtist + album)
  const albumMap = new Map();
  for (const r of records) {
    const key = `${r.albumArtist.trim().toLowerCase()}\0${r.album.trim().toLowerCase()}`;
    if (!albumMap.has(key)) {
      albumMap.set(key, {
        album: r.album.trim(),
        albumArtist: r.albumArtist.trim(),
        year: r.year,
        genre: r.genre,
        tracks: [],
      });
    }
    albumMap.get(key).tracks.push(r);
  }

  // Sort each album's tracks by disc → track → title
  for (const a of albumMap.values()) {
    a.tracks.sort((x, y) =>
      (x.disc ?? 0) - (y.disc ?? 0) ||
      (x.track ?? 0) - (y.track ?? 0) ||
      x.title.localeCompare(y.title)
    );
  }

  const albums = [...albumMap.values()];

  // Group artists by case-insensitive albumArtist
  const artistMap = new Map();
  for (const a of albums) {
    const key = a.albumArtist.toLowerCase();
    if (!artistMap.has(key)) {
      artistMap.set(key, { name: a.albumArtist, albums: [] });
    }
    artistMap.get(key).albums.push(a);
  }

  const artists = [...artistMap.values()];

  state.library = { tracks: records, albums, artists };
  return state.library;
}

function formatStatus(lib, failed) {
  let s = `${lib.tracks.length} songs · ${lib.albums.length} albums · ${lib.artists.length} artists`;
  if (failed > 0) s += ` · ${failed} failed`;
  return s;
}

// ── Cover art (on demand) ───────────────────────────────────



// Stable gradient placeholders, chosen by a hash of the album key.
//
// Every dark end is kept clear of black on purpose. Most albums in a real
// Many files have no embedded artwork, so these are what the shelves are mostly
// made of, and the near-black starts an earlier set used disappeared against
// the page — a card that reads as a hole rather than as a record.



// ── Lazy cover loading ──────────────────────────────────────

let coverObserver;

function setupCoverObserver() {
  if (coverObserver) return;
  coverObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const el = entry.target;
      coverObserver.unobserve(el);
      const albumData = el._albumData;
      if (!albumData) continue;
      coverUrlForAlbum(albumData).then((url) => {
        if (url) {
          el.style.backgroundImage = `url(${url})`;
          el.style.backgroundSize = 'cover';
          el.style.backgroundPosition = 'center';
        } else {
          console.warn('[cover-diag] coverUrlForAlbum returned null for:', albumData.album, '| first track path:', albumData.tracks?.[0]?.path ?? '(no tracks)');
        }
      });
    }
  }, { rootMargin: '200px' });
}

// ── Rendering ───────────────────────────────────────────────

function makeShelfCard(album) {
  const key = albumKey(album);
  const grad = gradientFor(key);
  const a = document.createElement('a');
  a.className = 'shelf-card';
  a.href = '#';
  a.dataset.album = key;

  const cover = document.createElement('div');
  cover.className = 'shelf-card__cover';
  cover.style.background = `linear-gradient(135deg,${grad})`;
  cover._albumData = album;
  setupCoverObserver();
  coverObserver.observe(cover);

  const title = document.createElement('span');
  title.className = 'shelf-card__title';
  title.textContent = album.album;

  const artist = document.createElement('span');
  artist.className = 'shelf-card__artist';
  artist.textContent = album.albumArtist;

  a.append(cover, title, artist);
  return a;
}

function renderShelfRow(shelfEl, albums) {
  const row = shelfEl.querySelector('.shelf__row');
  if (!row) return;
  row.innerHTML = '';
  for (const album of albums) {
    row.appendChild(makeShelfCard(album));
  }
}

function makeQuickCard(album) {
  const key = albumKey(album);
  const grad = gradientFor(key);
  const a = document.createElement('a');
  a.className = 'quick-card';
  a.href = '#';
  a.dataset.album = key;

  const cover = document.createElement('div');
  cover.className = 'quick-card__cover';
  cover.style.background = `linear-gradient(135deg,${grad})`;
  cover._albumData = album;
  setupCoverObserver();
  coverObserver.observe(cover);

  const label = document.createElement('span');
  label.className = 'quick-card__label';
  label.textContent = album.album;

  a.append(cover, label);
  return a;
}

function renderHero(heroEl, album) {
  if (!album) return;
  const key = albumKey(album);
  const grad = gradientFor(key);
  heroEl.dataset.album = key;

  const coverEl = heroEl.querySelector('.hero-card__cover');
  if (coverEl) {
    // If it was already observed, unobserve first to reset its state
    setupCoverObserver();
    coverObserver.unobserve(coverEl);
    
    // Instead of using 'background' shorthand which resets background-size/position,
    // we set background-image to the gradient. That way, the observer's backgroundImage
    // URL won't be broken by a shorthand reset if it happens async.
    coverEl.style.backgroundImage = `linear-gradient(135deg,${grad})`;
    coverEl._albumData = album;
    coverObserver.observe(coverEl);
  }

  const eyebrow = heroEl.querySelector('.hero-card__eyebrow');
  if (eyebrow) eyebrow.textContent = 'BIGGEST ALBUM';

  const titleEl = heroEl.querySelector('.hero-card__title');
  if (titleEl) titleEl.textContent = album.album;

  const artistEl = heroEl.querySelector('.hero-card__artist');
  if (artistEl) artistEl.textContent = album.albumArtist;
}

// Session-stable shuffle: seeded by Date.now() floored to the hour
function seededShuffle(arr) {
  const out = [...arr];
  let seed = Math.floor(Date.now() / 3600000);
  for (let i = out.length - 1; i > 0; i--) {
    seed = (seed * 1664525 + 1013904223) | 0;
    const j = Math.abs(seed) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function renderHome(lib) {
  enrichSearchIndex(lib);
  if (!lib || !lib.albums || lib.albums.length === 0) return;

  const hideSingles = localStorage.getItem('aubade_hide_singles') === 'true';
  const albums = hideSingles ? lib.albums.filter(a => a.tracks.length > 1) : lib.albums;

  // Recently added: last 12 albums by array order (order of discovery)
  const recent = albums.slice(-12).reverse();

  const byArtist = [...albums].sort((a, b) =>
    a.albumArtist.localeCompare(b.albumArtist)
  );

  // Rediscover: 12 random albums, session-stable
  const shuffled = seededShuffle(albums);
  const rediscover = shuffled.slice(0, 12);

  // Hero: album with most tracks
  const hero = [...albums].sort((a, b) => b.tracks.length - a.tracks.length)[0];

  // Quick-grid: first 8 by artist name
  const quick = byArtist.slice(0, 8);

  // Render
  const quickGrid = document.getElementById('quick-grid');
  if (quickGrid) {
    quickGrid.innerHTML = '';
    for (const a of quick) quickGrid.appendChild(makeQuickCard(a));
  }

  const heroCard = document.getElementById('hero-card');
  if (heroCard) renderHero(heroCard, hero);

  const shelfRecent = document.getElementById('shelf-recent');
  if (shelfRecent) renderShelfRow(shelfRecent, recent);

  // Most played is real now. Until something has actually been played there is
  // nothing honest to put here, so the shelf stays away rather than showing an
  // alphabetical list under a heading that claims otherwise.
  const shelfPlayed = document.getElementById('shelf-played');
  if (shelfPlayed) {
    const ranked = albumsByPlays(albums).slice(0, 12);
    if (ranked.length === 0) {
      shelfPlayed.hidden = true;
    } else {
      shelfPlayed.hidden = false;
      const sub = shelfPlayed.querySelector('.shelf__subtitle');
      if (sub) sub.textContent = 'The records you keep coming back to';
      renderShelfRow(shelfPlayed, ranked);
    }
  }

  const shelfRediscover = document.getElementById('shelf-rediscover');
  if (shelfRediscover) renderShelfRow(shelfRediscover, rediscover);
}

// ── Indexing ────────────────────────────────────────────────

async function indexDir(dirHandle, statusEl) {
  // Phase 1: walk the directory to discover files (fast)
  const entries = [];
  let walkCount = 0;
  let lastWalkUpdate = 0;
  for await (const entry of walkDir(dirHandle)) {
    entries.push(entry);
    walkCount++;
    const now = Date.now();
    if (now - lastWalkUpdate > 200) {
      statusEl.textContent = `Scanning… ${walkCount} files`;
      lastWalkUpdate = now;
    }
  }

  const total = entries.length;
  if (total === 0) {
    statusEl.textContent = '0 songs';
    return;
  }

  // Phase 2: parse tags via worker
  const worker = new Worker('./indexer.worker.js', { type: 'module' });
  const records = [];
  let done = 0;
  let failed = 0;
  let lastIndexUpdate = 0;

  const BATCH = 8;

  for (let i = 0; i < total; i += BATCH) {
    const batch = entries.slice(i, i + BATCH);
    const promises = batch.map((entry, j) => {
      const idx = i + j;
      return new Promise(async (resolve) => {
        let file;
        try {
          file = await entry.handle.getFile();
        } catch (err) {
          console.warn(`Could not read file: ${entry.path}: ${err.message}`);
          failed++;
          done++;
          resolve();
          return;
        }

        const handler = (e) => {
          if (e.data.index === idx) {
            worker.removeEventListener('message', handler);
            if (e.data.ok) {
              records.push(e.data.record);
            } else {
              console.warn(`Parse failed: ${e.data.path}: ${e.data.error}`);
              failed++;
            }
            done++;
            resolve();
          }
        };
        worker.addEventListener('message', handler);
        worker.postMessage({ file, path: entry.path, index: idx });
      });
    });

    await Promise.all(promises);

    // Throttled progress update
    const now = Date.now();
    if (now - lastIndexUpdate > 200) {
      statusEl.textContent = `Indexing… ${done} of ${total}`;
      lastIndexUpdate = now;
    }

    // Yield to let UI paint
    await new Promise(r => setTimeout(r, 0));
  }

  worker.terminate();

  // Phase 3: build the library and persist it
  const lib = buildLibrary(records);
  await dbSet('index', lib, 'library');

  statusEl.textContent = formatStatus(lib, failed);
  renderHome(lib);
}

// ── DOM wiring ──────────────────────────────────────────────

const statusEl  = document.getElementById('folder-status');
const foldersBtn = document.getElementById('seg-folders');

async function pickFolder() {
  let dirHandle;
  try {
    dirHandle = await window.showDirectoryPicker({
      id: 'aubade-music',
      mode: 'read',
    });
  } catch (err) {
    if (err.name === 'AbortError') return; // user cancelled
    throw err;
  }
  await dbSet('musicDir', dirHandle);
  await indexDir(dirHandle, statusEl);
}

function showReconnect(handle) {
  const btn = document.createElement('button');
  btn.className = 'reconnect-btn';
  btn.textContent = 'Reconnect music folder';
  btn.addEventListener('click', async () => {
    const perm = await handle.requestPermission({ mode: 'read' });
    if (perm === 'granted') {
      btn.remove();
      // Check for cached index first
      const cached = await dbGet('index', 'library');
      if (cached) {
        state.library = cached;
        statusEl.textContent = formatStatus(state.library, 0);
        renderHome(state.library);
      } else {
        await indexDir(handle, statusEl);
      }
    }
  });
  statusEl.textContent = '';
  statusEl.appendChild(btn);
}

async function init() {
  if (!('showDirectoryPicker' in window)) {
    statusEl.textContent = 'Browser does not support folder access';
    return;
  }

  foldersBtn.addEventListener('click', pickFolder);

  // Check for a cached state.library index first — works even without
  // folder handle (e.g. if handle was cleared but index persists)
  const cached = await dbGet('index', 'library');
  if (cached) {
    state.library = cached;
    statusEl.textContent = formatStatus(state.library, 0);
    renderHome(state.library);
  }

  const handle = await dbGet('musicDir');
  if (!handle) {
    handleRoute();
    return;
  }

  const perm = await handle.queryPermission({ mode: 'read' });
  if (perm === 'granted') {
    // If we already loaded from cache, skip re-parse
    if (!cached) {
      await indexDir(handle, statusEl);
    }
  } else {
    // perm === 'prompt'. Do NOT auto-request — browsers reject
    // permission requests without a user gesture.
    showReconnect(handle);
  }
  
  handleRoute();
}

init();

// ── Playback ────────────────────────────────────────────────

// In the document rather than detached: an <audio> without controls renders
// nothing, but this way it shows up in the browser's media panel and can be
// inspected, which a floating element cannot.
const audio = new Audio();
audio.id = 'player-audio';
document.body.append(audio);

let currentObjectUrl = null;

// A run of unplayable files should stop and say so rather than skip forever.
let consecutiveFailures = 0;
let toastTimer = null;

function showToast(message) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast glass-strong';
    el.setAttribute('role', 'status');
    document.getElementById('app').append(el);
  }
  el.textContent = message;
  el.classList.add('is-open');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-open'), 5000);
}

async function playTrack(index) {
  if (playerState.queue.length === 0) {
    playerState.index = -1;
    clearPlayerUI();
    return;
  }
  if (index < 0 || index >= playerState.queue.length) return;
  playerState.index = index;
  const record = playerState.queue[index];

  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }

  try {
    const dirHandle = await dbGet('musicDir');
    if (!dirHandle) throw new Error('No music directory handle');

    const parts = record.path.split('/');
    let current = dirHandle;
    for (let i = 0; i < parts.length - 1; i++) {
      current = await current.getDirectoryHandle(parts[i]);
    }
    const fileHandle = await current.getFileHandle(parts[parts.length - 1]);
    const file = await fileHandle.getFile();
    
    currentObjectUrl = URL.createObjectURL(file);
    audio.src = currentObjectUrl;
    audio.play().catch(e => console.warn('Play blocked or failed:', e));
    
    updatePlayerUI(record);
    loadLyrics(record).catch(e => console.warn('Lyrics failed:', e));
    consecutiveFailures = 0;
  } catch (err) {
    console.warn(`Could not play ${record.path}:`, err);
    // Skipping a bad file is right; skipping the whole queue in silence is
    // not. Lapsed folder permission fails every track, so an unbounded skip
    // walks thousands of them and lands on idle looking like a dead button.
    consecutiveFailures++;
    if (err && err.name === 'NotAllowedError') {
      consecutiveFailures = 0;
      clearPlayerUI();
      showToast('Lost access to your music folder. Open Settings to reconnect it.');
      return;
    }
    if (consecutiveFailures >= 3 || consecutiveFailures >= playerState.queue.length) {
      consecutiveFailures = 0;
      clearPlayerUI();
      showToast('Could not play these files. They may have moved or been renamed.');
      return;
    }
    nextTrack();
  }
}

function playAlbum(key, startIndex = 0) {
  const album = state.library.albums.find(a => key === albumKey(a));
  if (!album) return;
  
  playerState.originalQueue = [...album.tracks];
  if (playerState.shuffle) {
    const startRecord = album.tracks[startIndex];
    playerState.queue = seededShuffle([...album.tracks]);
    let newIndex = playerState.queue.indexOf(startRecord);
    if (newIndex === -1) newIndex = 0;
    playTrack(newIndex);
  } else {
    playerState.queue = [...album.tracks];
    playTrack(startIndex);
  }
}

function togglePlay() {
  if (audio.paused) {
    if (playerState.queue.length > 0) audio.play();
  } else {
    audio.pause();
  }
}

function nextTrack() {
  if (playerState.index < playerState.queue.length - 1) {
    playTrack(playerState.index + 1);
  } else if (playerState.repeat && playerState.queue.length > 0) {
    playTrack(0);
  }
}

function prevTrack() {
  if (audio.currentTime > 3) {
    audio.currentTime = 0;
  } else if (playerState.index > 0) {
    playTrack(playerState.index - 1);
  } else if (playerState.index === 0) {
    audio.currentTime = 0;
  }
}

// ── MediaSession ─────────────────────────────────────────────
// Without this the media keys, the lock screen and the desktop's own
// now-playing widget all do nothing, which is most of what separates a tab
// that plays audio from a music player.

const SEEK_STEP_SECONDS = 10;

function setupMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const handlers = {
    play: () => audio.play(),
    pause: () => audio.pause(),
    previoustrack: prevTrack,
    nexttrack: nextTrack,
    seekbackward: (d) => {
      audio.currentTime = Math.max(0, audio.currentTime - (d.seekOffset || SEEK_STEP_SECONDS));
    },
    seekforward: (d) => {
      audio.currentTime = Math.min(audio.duration || 0,
        audio.currentTime + (d.seekOffset || SEEK_STEP_SECONDS));
    },
    seekto: (d) => {
      if (d.fastSeek && 'fastSeek' in audio) audio.fastSeek(d.seekTime);
      else audio.currentTime = d.seekTime;
    },
    stop: () => { audio.pause(); audio.currentTime = 0; },
  };
  for (const [action, handler] of Object.entries(handlers)) {
    // Not every browser implements every action; an unsupported one throws.
    try { navigator.mediaSession.setActionHandler(action, handler); }
    catch { /* this browser does not offer it */ }
  }
}

/** Artwork for the OS widget. Object URLs work; a missing cover is fine. */
async function mediaSessionArtwork(record) {
  const album = (state.library.albums || []).find((a) => albumKey(a) ===
    `${record.albumArtist.trim().toLowerCase()}\0${record.album.trim().toLowerCase()}`);
  if (!album) return [];
  const url = await coverUrlForAlbum(album);
  return url ? [{ src: url, sizes: '512x512', type: 'image/jpeg' }] : [];
}

async function updateMediaSession(record) {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: record.title || record.name || '',
    artist: record.artist || record.albumArtist || '',
    album: record.album || '',
    artwork: await mediaSessionArtwork(record),
  });
}

function updateMediaPositionState() {
  if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
  if (!audio.duration || !isFinite(audio.duration)) return;
  try {
    navigator.mediaSession.setPositionState({
      duration: audio.duration,
      playbackRate: audio.playbackRate,
      position: Math.min(audio.currentTime, audio.duration),
    });
  } catch { /* position state rejects odd values while loading */ }
}

setupMediaSession();

audio.addEventListener('play', () => {
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
  updateMediaPositionState();
});
audio.addEventListener('pause', () => {
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
});
audio.addEventListener('loadedmetadata', updateMediaPositionState);
audio.addEventListener('ratechange', updateMediaPositionState);
audio.addEventListener('seeked', updateMediaPositionState);

function formatTime(secs) {
  if (isNaN(secs)) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// UI Elements
const uiPlayBtn = document.querySelector('.player__play-btn');
const uiPlayIcon = uiPlayBtn.querySelector('svg');
const uiPrevBtn = document.querySelector('button[aria-label="Previous"]');
const uiNextBtn = document.querySelector('button[aria-label="Next"]');
const uiShuffleBtn = document.querySelector('button[aria-label="Shuffle"]');
const uiRepeatBtn = document.querySelector('button[aria-label="Repeat"]');
const uiCover = document.querySelector('.player__cover');
const uiTitle = document.querySelector('.player__title');
const uiArtist = document.querySelector('.player__artist');
const uiScrubber = document.querySelector('.player__track-bar');
const uiScrubFill = document.querySelector('.player__track-fill');
const uiScrubKnob = document.querySelector('.player__track-knob');
const uiTimeCurrent = document.querySelector('.player__scrubber .player__time:first-child');
const uiTimeTotal = document.querySelector('.player__scrubber .player__time:last-child');
const uiVolBar = document.querySelector('.player__vol-bar');
const uiVolFill = document.querySelector('.player__vol-fill');
const uiVolKnob = document.querySelector('.player__vol-knob');

// Now Playing Elements
const npOverlay = document.getElementById('now-playing');
const npCloseBtn = document.getElementById('np-close');
const npOpenBtn = document.querySelector('.player__icon-btn[aria-label="Expand now playing"]');
const npBg = document.querySelector('.now-playing__bg');
const npAmbient = [...document.querySelectorAll('.ambient-layer')];

// Long titles were simply cut with an ellipsis. Octave scrolls them, holding
// still at each end — its keyframe rests for the first 12% and the last 12%
// and travels between, offset by the container's own width.
//
// The text has to move inside something that clips it, so it goes in an inner
// span and the element keeps the overflow.

function setScrollingText(el, text) {
  let inner = el.firstElementChild;
  if (!inner || !inner.classList.contains('marquee__inner')) {
    el.textContent = '';
    inner = document.createElement('span');
    inner.className = 'marquee__inner';
    el.appendChild(inner);
  }
  if (inner.textContent === text) return;
  inner.textContent = text;
  // Measure after layout, or scrollWidth reads the previous text.
  requestAnimationFrame(() => measureMarquee(el));
}

/**
 * Decide whether an element's text overflows enough to scroll.
 *
 * A hidden element measures zero, so this is worth re-running when something
 * becomes visible — the now-playing overlay is usually closed at the moment a
 * track loads, and its title would otherwise never be measured at all.
 */
function measureMarquee(el) {
  const inner = el.firstElementChild;
  if (!inner || !inner.classList.contains('marquee__inner')) return;
  el.classList.remove('is-scrolling');
  if (!el.clientWidth) return;               // not visible; nothing to measure
  const overflow = inner.scrollWidth - el.clientWidth;
  if (overflow <= 4) return;
  el.style.setProperty('--marquee-w', el.clientWidth + 'px');
  // Long titles should not travel faster than short ones.
  el.style.setProperty('--marquee-time', Math.round(6 + overflow / 22) + 's');
  el.classList.add('is-scrolling');
}

/** Paint the ambient circles, or clear them back to the gradient. */
function setAmbient(value) {
  for (const layer of npAmbient) layer.style.backgroundImage = value;
}
const npCover = document.getElementById('np-cover');
const npTitle = document.getElementById('np-title');
const npSubtitle = document.getElementById('np-subtitle');
const npAlbum = document.getElementById('np-album');

const npScrubber = document.querySelector('#np-scrubber .now-playing__track-bar');
const npScrubFill = document.getElementById('np-track-fill');
const npScrubKnob = document.getElementById('np-track-knob');
const npTimeCurr = document.getElementById('np-time-curr');
const npTimeRem = document.getElementById('np-time-rem');

const npPlayBtn = document.getElementById('np-play');
const npPlayIcon = npPlayBtn.querySelector('svg');
const npPrevBtn = document.getElementById('np-prev');
const npNextBtn = document.getElementById('np-next');
const npShuffleBtn = document.getElementById('np-shuffle');
const npRepeatBtn = document.getElementById('np-repeat');

npOpenBtn.addEventListener('click', () => npOverlay.classList.add('is-open'));
npCloseBtn.addEventListener('click', () => npOverlay.classList.remove('is-open'));

function clearPlayerUI() {
  document.getElementById('app').classList.add('is-idle');

  setScrollingText(uiTitle, '');
  setScrollingText(uiArtist, '');
  uiCover.style.backgroundImage = 'none';
  setScrollingText(npTitle, '');
  setScrollingText(npSubtitle, '');
  npAlbum.textContent = '';
  npCover.style.backgroundImage = 'none';
  npBg.style.backgroundImage = 'none';
  setAmbient('none');
  document.querySelector('.player__time:first-of-type').textContent = '0:00';
  document.querySelector('.player__time:last-of-type').textContent = '0:00';
  // These four were written against names that were never declared, so this
  // function threw a ReferenceError every time it ran — meaning the UI was
  // never actually cleared when playback stopped or a file failed to load.
  uiScrubFill.style.width = '0%';
  uiScrubKnob.style.left = '0%';
  npScrubFill.style.width = '0%';
  npScrubKnob.style.left = '0%';
  uiPlayBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  uiPlayBtn.disabled = true;
  // Clear format
  const fmtEl = document.getElementById('np-format');
  if (fmtEl) fmtEl.textContent = '';

  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = 'none';
  }
}

function updatePlayerUI(record) {
  document.getElementById('app').classList.remove('is-idle');
  uiPlayBtn.disabled = false;
  setScrollingText(uiTitle, record.title || record.name);
  setScrollingText(uiArtist, record.artist || record.albumArtist || 'Unknown Artist');
  
  setScrollingText(npTitle, record.title || record.name);
  const artist = record.artist || record.albumArtist || 'Unknown Artist';
  const albumName = record.album || 'Unknown Album';
  setScrollingText(npSubtitle, `${albumName} · ${artist}`);
  npAlbum.textContent = albumName;

  // Format label from file extension
  const fmtEl = document.getElementById('np-format');
  if (fmtEl && record.path) {
    const ext = record.path.split('.').pop().toUpperCase();
    fmtEl.textContent = ext;
  }

  if (!document.getElementById('np-queue').hidden) renderQueue();
  updateMediaSession(record);

  // Heart state
  const heartBtn = document.getElementById('np-heart-btn');
  if (heartBtn) {
    const likedPaths = JSON.parse(localStorage.getItem('aubade_liked') || '{}');
    const isLiked = !!likedPaths[record.path];
    heartBtn.classList.toggle('np-icon-btn--active', isLiked);
    const svg = heartBtn.querySelector('svg');
    if (svg) svg.setAttribute('fill', isLiked ? 'currentColor' : 'none');
  }
  
  const album = state.library.albums.find(a => albumKey(a) === `${record.albumArtist.trim().toLowerCase()}\0${record.album.trim().toLowerCase()}`);
  if (album) {
    coverUrlForAlbum(album).then(url => {
      if (url) {
        uiCover.style.backgroundImage = `url(${url})`;
        uiCover.style.backgroundSize = 'cover';
        uiCover.style.backgroundPosition = 'center';
        
        npBg.style.backgroundImage = 'none';
        setAmbient(`url(${url})`);
        npCover.style.backgroundImage = `url(${url})`;
        npCover.style.backgroundSize = 'cover';
        npCover.style.backgroundPosition = 'center';

        // Octave tints this view from the artwork — its output picker and
        // active lyrics toggle went amber for a pink-and-yellow cover. Ours
        // had no accent of its own and stayed the static pink.
        getCoverAccent(url).then((accent) => {
          if (accent) npOverlay.style.setProperty('--np-accent', accent);
        });
      } else {
        npOverlay.style.removeProperty('--np-accent');
        const grad = gradientFor(albumKey(album));
        uiCover.style.background = `linear-gradient(135deg,${grad})`;
        uiCover.style.backgroundImage = 'none';
        
        npBg.style.background = `linear-gradient(135deg,${grad})`;
        npBg.style.backgroundImage = 'none';
        setAmbient('none');
        npCover.style.background = `linear-gradient(135deg,${grad})`;
        npCover.style.backgroundImage = 'none';
      }
    });
  }
}

// Scrubber update (RAF throttled)
let scrubRaf;
let lastUpdate = 0;
function updateScrubber() {
  const now = performance.now();
  if (now - lastUpdate > 250) {
    lastUpdate = now;
    if (audio.duration) {
      const pct = (audio.currentTime / audio.duration) * 100;
      uiScrubFill.style.width = `${pct}%`;
      uiScrubKnob.style.left = `${pct}%`;
      uiTimeCurrent.textContent = formatTime(audio.currentTime);
      uiTimeTotal.textContent = formatTime(audio.duration);
      
      npScrubFill.style.width = `${pct}%`;
      npScrubKnob.style.left = `${pct}%`;
      npTimeCurr.textContent = formatTime(audio.currentTime);
      npTimeRem.textContent = '-' + formatTime(audio.duration - audio.currentTime);
    }
  }
  scrubRaf = requestAnimationFrame(updateScrubber);
}

audio.addEventListener('play', () => {
  const pauseIcon = `<path d="M6 5h3v10H6zm5 0h3v10h-3z" fill="currentColor" stroke="none" />`;
  uiPlayIcon.innerHTML = pauseIcon;
  npPlayIcon.innerHTML = pauseIcon;
  if (!scrubRaf) scrubRaf = requestAnimationFrame(updateScrubber);
});

audio.addEventListener('pause', () => {
  const playIcon = `<path d="M7.5 4.5v11l8-5.5Z" fill="currentColor" stroke="none" />`;
  uiPlayIcon.innerHTML = playIcon;
  npPlayIcon.innerHTML = playIcon;
  if (scrubRaf) {
    cancelAnimationFrame(scrubRaf);
    scrubRaf = null;
  }
});

audio.addEventListener('ended', () => {
  nextTrack();
});

// Controls wiring
uiPlayBtn.addEventListener('click', togglePlay);
uiPrevBtn.addEventListener('click', prevTrack);
uiNextBtn.addEventListener('click', nextTrack);

npPlayBtn.addEventListener('click', togglePlay);
npPrevBtn.addEventListener('click', prevTrack);
npNextBtn.addEventListener('click', nextTrack);

const handleShuffle = () => {
  playerState.shuffle = !playerState.shuffle;
  uiShuffleBtn.style.color = playerState.shuffle ? 'var(--accent)' : '';
  npShuffleBtn.style.color = playerState.shuffle ? 'var(--accent)' : '';
  
  if (playerState.queue.length > 0) {
    const currentTrack = playerState.queue[playerState.index];
    if (playerState.shuffle) {
      playerState.queue = seededShuffle([...playerState.originalQueue]);
    } else {
      playerState.queue = [...playerState.originalQueue];
    }
    playerState.index = playerState.queue.indexOf(currentTrack);
  }
};
uiShuffleBtn.addEventListener('click', handleShuffle);
npShuffleBtn.addEventListener('click', handleShuffle);

const handleRepeat = () => {
  playerState.repeat = !playerState.repeat;
  uiRepeatBtn.style.color = playerState.repeat ? 'var(--accent)' : '';
  npRepeatBtn.style.color = playerState.repeat ? 'var(--accent)' : '';
};
uiRepeatBtn.addEventListener('click', handleRepeat);
npRepeatBtn.addEventListener('click', handleRepeat);

// Scrubber interaction
const handleScrub = (bar, e) => {
  if (!audio.duration) return;
  const rect = bar.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  audio.currentTime = pct * audio.duration;
  
  const w = `${pct * 100}%`;
  uiScrubFill.style.width = w;
  uiScrubKnob.style.left = w;
  uiTimeCurrent.textContent = formatTime(audio.currentTime);
  
  npScrubFill.style.width = w;
  npScrubKnob.style.left = w;
  npTimeCurr.textContent = formatTime(audio.currentTime);
  npTimeRem.textContent = '-' + formatTime(audio.duration - audio.currentTime);
};

uiScrubber.addEventListener('click', (e) => handleScrub(uiScrubber, e));
npScrubber.addEventListener('click', (e) => handleScrub(npScrubber, e));

// Volume interaction
uiVolBar.addEventListener('click', (e) => {
  const rect = uiVolBar.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  audio.volume = pct;
  uiVolFill.style.width = `${pct * 100}%`;
  uiVolKnob.style.left = `${pct * 100}%`;
});
// Init volume
uiVolFill.style.width = `${audio.volume * 100}%`;
uiVolKnob.style.left = `${audio.volume * 100}%`;

// Card wiring
document.addEventListener('click', (e) => {
  const playBtn = e.target.closest('.hero-card__play');
  if (playBtn) {
    const card = playBtn.closest('.hero-card');
    if (card && card.dataset.album) {
      playAlbum(card.dataset.album);
    }
    return;
  }

  const card = e.target.closest('.shelf-card, .quick-card, .hero-card');
  if (card && card.dataset.album) {
    e.preventDefault();
    window.location.hash = '#album/' + encodeURIComponent(card.dataset.album);
  }
});

// ── Routing & Album View ────────────────────────────────────

window.addEventListener('hashchange', handleRoute);

// Every view id, so hiding them is one loop rather than a line per view that
// has to be remembered each time one is added.
const VIEW_IDS = ['home', 'album', 'search', 'library', 'artist', 'settings', 'liked', 'browse'];

function handleRoute() {
  const hash = window.location.hash || '#home';
  for (const id of VIEW_IDS) {
    const el = document.getElementById('view-' + id);
    if (el) el.style.display = 'none';
  }
  const viewAlbum = document.getElementById('view-album');
  const viewSearch = document.getElementById('view-search');
  const viewLibrary = document.getElementById('view-library');
  const viewArtist = document.getElementById('view-artist');
  const viewSettings = document.getElementById('view-settings');
  const viewHome = document.getElementById('view-home');

  document.querySelectorAll('.sidebar__nav-item').forEach(el => el.classList.remove('sidebar__nav-item--selected'));

  if (hash === '#liked-songs') {
    renderLikedView();
    document.getElementById('view-liked').style.display = 'block';
  } else if (hash.startsWith('#browse')) {
    const rest = hash.slice('#browse'.length).replace(/^\//, '');
    const [kind, ...v] = rest.split('/');
    renderBrowseView(kind || null, decodeURIComponent(v.join('/') || ''));
    document.getElementById('view-browse').style.display = 'block';
    const nav = document.querySelector('a[href="#browse"]');
    if (nav) nav.classList.add('sidebar__nav-item--selected');
  } else if (hash.startsWith('#album/')) {
    const key = decodeURIComponent(hash.substring(7));
    if (state.library.albums && state.library.albums.length > 0) {
      renderAlbumView(key);
    }
    viewAlbum.style.display = 'block';
  } else if (hash === '#settings') {
    renderSettingsView();
    viewSettings.style.display = 'flex';
  } else if (hash.startsWith('#artist/')) {
    const name = decodeURIComponent(hash.substring(8));
    if (state.library.artists && state.library.artists.length > 0) {
      renderArtistView(name);
    }
    viewArtist.style.display = 'block';
  } else if (hash.startsWith('#search')) {
    viewSearch.style.display = 'block';
    const searchNav = document.querySelector('a[href="#search"]');
    if (searchNav) searchNav.classList.add('sidebar__nav-item--selected');
    setTimeout(() => {
      const input = document.getElementById('search-input');
      if (input) input.focus();
    }, 50);
  } else if (hash.startsWith('#library')) {
    viewLibrary.style.display = 'block';
    const libNav = document.querySelector('a[href="#library"]');
    if (libNav) libNav.classList.add('sidebar__nav-item--selected');
    
    // Check if ?view= is present
    const qIndex = hash.indexOf('?');
    if (qIndex !== -1) {
      const params = new URLSearchParams(hash.substring(qIndex));
      const v = params.get('view');
      if (v) {
        localStorage.setItem('aubade_lib_view', v);
      }
    }
    renderLibraryView();
  } else {
    viewHome.style.display = 'block';
    const homeNav = document.querySelector('a[href="#home"]');
    if (homeNav) homeNav.classList.add('sidebar__nav-item--selected');
  }
}

document.querySelector('.top-bar__btn[aria-label="Go back"]')?.addEventListener('click', () => history.back());
document.querySelector('.top-bar__btn[aria-label="Go forward"]')?.addEventListener('click', () => history.forward());





// Queueing and copying produce no visible result on their own, so the button
// acknowledges the press rather than leaving you wondering if it registered.
function flashButton(btn) {
  btn.classList.add('is-flashed');
  setTimeout(() => btn.classList.remove('is-flashed'), 450);
}

async function renderAlbumView(key) {
  const album = state.library.albums.find(a => key === albumKey(a));
  if (!album) return;

  const bg = document.querySelector('.album-header__bg');
  const coverEl = document.querySelector('.album-header__cover');
  const title = document.querySelector('.album-header__title');
  const artist = document.querySelector('.album-header__artist');
  const stats = document.querySelector('.album-header__stats');
  const viewAlbum = document.getElementById('view-album');
  const trackList = document.querySelector('.album-tracks');
  const playBtn = document.querySelector('.album-btn--play');
  const shuffleBtn = document.querySelector('.album-btn--shuffle');

  title.textContent = album.album;
  artist.textContent = album.albumArtist;
  artist.href = `#artist/${encodeURIComponent(album.albumArtist)}`;

  const year = album.year ? album.year + ' · ' : '';
  const numSongs = album.tracks.length;
  const songText = numSongs === 1 ? '1 song' : numSongs + ' songs';
  
  let totalSecs = 0;
  for (const t of album.tracks) {
    if (t.duration) totalSecs += t.duration;
  }
  const mins = Math.floor(totalSecs / 60);
  stats.textContent = `${year}${songText} · ${mins} min`;

  const grad = gradientFor(key);
  bg.style.backgroundImage = 'none';
  coverEl.style.backgroundImage = 'none';
  coverEl.style.background = `linear-gradient(135deg,${grad})`;
  bg.style.background = `linear-gradient(135deg,${grad})`;
  viewAlbum.style.setProperty('--album-accent', 'var(--accent)');
  
  playBtn.onclick = () => playAlbum(key);
  shuffleBtn.onclick = () => {
    playerState.shuffle = true;
    document.querySelector('button[aria-label="Shuffle"]').style.color = 'var(--accent)';
    playAlbum(key);
  };

  // Octave shows seven controls here. Download and Save-to-library have no
  // meaning for files already on disk, so this is the five that do.
  const likeBtn = document.querySelector('.album-btn--like');
  const queueBtn = document.querySelector('.album-btn--queue');
  const shareBtn = document.querySelector('.album-btn--share');

  const likedAlbums = () => JSON.parse(localStorage.getItem('aubade_liked_albums') || '{}');
  const paintLike = () => {
    const on = !!likedAlbums()[key];
    likeBtn.classList.toggle('is-liked', on);
    likeBtn.querySelector('svg').setAttribute('fill', on ? 'currentColor' : 'none');
    likeBtn.setAttribute('aria-pressed', String(on));
  };
  paintLike();
  likeBtn.onclick = () => {
    const liked = likedAlbums();
    if (liked[key]) delete liked[key]; else liked[key] = true;
    localStorage.setItem('aubade_liked_albums', JSON.stringify(liked));
    paintLike();
  };

  queueBtn.onclick = () => {
    playerState.queue.push(...album.tracks);
    playerState.originalQueue.push(...album.tracks);
    flashButton(queueBtn);
  };

  shareBtn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(`${album.album} — ${album.albumArtist}`);
      flashButton(shareBtn);
    } catch { /* clipboard blocked; nothing useful to say */ }
  };

  const url = await coverUrlForAlbum(album);
  if (url) {
    bg.style.backgroundImage = `url(${url})`;
    coverEl.style.backgroundImage = `url(${url})`;
    const accent = await getCoverAccent(url);
    if (accent) {
      viewAlbum.style.setProperty('--album-accent', accent);
    }
  }

  trackList.innerHTML = '';
  album.tracks.forEach((t, i) => {
    const row = document.createElement('div');
    row.className = 'track-row';
    
    const num = document.createElement('div');
    num.className = 'track-row__num';
    num.textContent = i + 1;
    
    const info = document.createElement('div');
    info.className = 'track-row__info';
    
    const tTitle = document.createElement('span');
    tTitle.className = 'track-row__title';
    tTitle.textContent = t.title || t.name;
    
    const tArtist = document.createElement('span');
    tArtist.className = 'track-row__artist';
    tArtist.textContent = t.artist || album.albumArtist;
    
    info.append(tTitle, tArtist);
    
    const dur = document.createElement('div');
    dur.className = 'track-row__duration';
    dur.textContent = t.duration ? formatTime(t.duration) : '';
    
    row.append(num, info, dur);
    
    row.onclick = () => playAlbum(key, i);
    
    trackList.appendChild(row);
  });
}

// ── Browse ───────────────────────────────────────────────────
// Octave browses by mood, genre, decade and region — streaming editorial we
// have no equivalent of. What the files themselves carry is genre and year,
// so this browses by genre, decade and year, in its tile grid.

function browseFacets() {
  const genres = new Map();
  const decades = new Map();
  const years = new Map();
  for (const a of state.library.albums || []) {
    const g = (a.tracks.find((t) => t.genre) || {}).genre;
    if (g) genres.set(g, (genres.get(g) || 0) + 1);
    if (a.year) {
      const d = Math.floor(a.year / 10) * 10;
      decades.set(d, (decades.get(d) || 0) + 1);
      years.set(a.year, (years.get(a.year) || 0) + 1);
    }
  }
  const sortByCount = (m) => [...m.entries()].sort((x, y) => y[1] - x[1] || String(x[0]).localeCompare(String(y[0])));
  return {
    genres: sortByCount(genres),
    decades: [...decades.entries()].sort((x, y) => y[0] - x[0]),
    years: [...years.entries()].sort((x, y) => y[0] - x[0]),
  };
}

function albumsMatching(kind, value) {
  return (state.library.albums || []).filter((a) => {
    if (kind === 'genre') return a.tracks.some((t) => t.genre === value);
    if (kind === 'decade') return a.year && Math.floor(a.year / 10) * 10 === +value;
    if (kind === 'year') return a.year === +value;
    return false;
  });
}

function makeBrowseTile(kind, value, label, count) {
  const a = document.createElement('a');
  a.className = 'browse-tile';
  a.href = `#browse/${kind}/${encodeURIComponent(value)}`;
  a.style.backgroundImage = `linear-gradient(135deg,${gradientFor(kind + value)})`;
  const name = document.createElement('span');
  name.className = 'browse-tile__label';
  name.textContent = label;
  const n = document.createElement('span');
  n.className = 'browse-tile__count';
  n.textContent = `${count} album${count === 1 ? '' : 's'}`;
  a.append(name, n);
  return a;
}

function renderBrowseView(kind, value) {
  const body = document.getElementById('browse-body');
  const title = document.getElementById('browse-title');
  body.innerHTML = '';

  if (kind) {
    const albums = albumsMatching(kind, value);
    title.textContent = kind === 'decade' ? `${value}s` : value;
    const count = document.createElement('p');
    count.className = 'browse-count';
    count.textContent = `${albums.length} album${albums.length === 1 ? '' : 's'}`;
    const grid = document.createElement('div');
    grid.className = 'lib-grid--albums';
    for (const a of albums) grid.appendChild(makeShelfCard(a));
    body.append(count, grid);
    return;
  }

  title.textContent = 'Browse';
  const facets = browseFacets();
  const sections = [
    ['Genres', 'genre', facets.genres, (k) => k],
    ['Decades', 'decade', facets.decades, (k) => `${k}s`],
    ['Years', 'year', facets.years, (k) => String(k)],
  ];
  for (const [heading, kindName, entries, fmt] of sections) {
    if (!entries.length) continue;
    const section = document.createElement('section');
    section.className = 'browse-section';
    const h = document.createElement('h2');
    h.className = 'shelf__title';
    h.textContent = heading;
    const grid = document.createElement('div');
    grid.className = 'browse-grid';
    for (const [key, n] of entries) {
      grid.appendChild(makeBrowseTile(kindName, key, fmt(key), n));
    }
    section.append(h, grid);
    body.appendChild(section);
  }
  if (!body.children.length) {
    const p = document.createElement('p');
    p.className = 'browse-count';
    p.textContent = 'Nothing to browse by yet — your files carry no genre or year tags.';
    body.appendChild(p);
  }
}

// ── Liked Songs ──────────────────────────────────────────────
// The heart has been writing to aubade_liked since the now-playing work, and
// two links in the sidebar pointed at a route that did not exist. This is the
// screen they meant.

function likedTracks() {
  const liked = JSON.parse(localStorage.getItem('aubade_liked') || '{}');
  if (!state.library.tracks) return [];
  // Keep the library's own order rather than the order things were liked in;
  // storage is an object and its key order is not meaningful.
  return state.library.tracks.filter((t) => liked[t.path]);
}

function playTrackList(tracks, startIndex = 0, shuffle = false) {
  if (!tracks.length) return;
  playerState.originalQueue = [...tracks];
  playerState.queue = shuffle ? seededShuffle([...tracks]) : [...tracks];
  playerState.shuffle = shuffle;
  const start = shuffle ? 0 : startIndex;
  playTrack(start);
}

function renderLikedView() {
  const tracks = likedTracks();
  const list = document.getElementById('liked-tracks');
  const empty = document.getElementById('liked-empty');
  const stats = document.getElementById('liked-stats');
  const playBtn = document.getElementById('liked-play');
  const shuffleBtn = document.getElementById('liked-shuffle');

  const total = tracks.reduce((n, t) => n + (t.duration || 0), 0);
  stats.textContent = tracks.length
    ? `${tracks.length} song${tracks.length === 1 ? '' : 's'} · ${Math.round(total / 60)} min`
    : 'No songs yet';

  empty.hidden = tracks.length > 0;
  playBtn.disabled = shuffleBtn.disabled = tracks.length === 0;
  playBtn.onclick = () => playTrackList(tracks, 0, false);
  shuffleBtn.onclick = () => playTrackList(tracks, 0, true);

  list.innerHTML = '';
  tracks.forEach((t, i) => {
    const row = document.createElement('div');
    row.className = 'track-row';

    const num = document.createElement('div');
    num.className = 'track-row__num';
    num.textContent = i + 1;

    const info = document.createElement('div');
    info.className = 'track-row__info';
    const tTitle = document.createElement('span');
    tTitle.className = 'track-row__title';
    tTitle.textContent = t.title || t.name;
    const tArtist = document.createElement('span');
    tArtist.className = 'track-row__artist';
    tArtist.textContent = [t.artist || t.albumArtist, t.album].filter(Boolean).join(' · ');
    info.append(tTitle, tArtist);

    const unlike = document.createElement('button');
    unlike.className = 'track-row__unlike';
    unlike.type = 'button';
    unlike.setAttribute('aria-label', 'Remove from Liked Songs');
    unlike.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none">' +
      '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1L12 21l7.7-7.6 1.1-1a5.5 5.5 0 0 0 0-7.8Z"/></svg>';
    unlike.onclick = (e) => {
      e.stopPropagation();
      const liked = JSON.parse(localStorage.getItem('aubade_liked') || '{}');
      delete liked[t.path];
      localStorage.setItem('aubade_liked', JSON.stringify(liked));
      renderLikedView();
    };

    const dur = document.createElement('div');
    dur.className = 'track-row__duration';
    dur.textContent = t.duration ? formatTime(t.duration) : '';

    row.append(num, info, unlike, dur);
    row.onclick = () => playTrackList(tracks, i, false);
    list.appendChild(row);
  });
}

// ── Search ───────────────────────────────────────────────────

const searchInput = document.getElementById('search-input');
const viewSearch = document.getElementById('view-search');
const searchEmpty = document.getElementById('search-empty');
const searchQueryDisplay = document.getElementById('search-query-display');
const searchResults = document.getElementById('search-results');

const searchSongs = document.getElementById('search-songs');
const searchAlbums = document.getElementById('search-albums');
const searchArtists = document.getElementById('search-artists');

const searchSongsList = document.querySelector('.search-list--songs');
const searchAlbumsList = document.querySelector('.search-grid--albums');
const searchArtistsList = document.querySelector('.search-list--artists');

const searchSongsCap = document.getElementById('search-songs-cap');
const searchAlbumsCap = document.getElementById('search-albums-cap');
const searchArtistsCap = document.getElementById('search-artists-cap');

function enrichSearchIndex(lib) {
  if (!lib.tracks) return;
  for (const t of lib.tracks) {
    if (!t._searchStr) {
      t._searchStr = `${t.title || ''} ${t.artist || ''} ${t.albumArtist || ''} ${t.album || ''}`.toLowerCase();
    }
  }
}

function escapeHTML(s) {
  if (typeof s !== 'string') return s;
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function doSearch() {
  const q = searchInput.value.trim().toLowerCase();
  if (!q) {
    searchEmpty.style.display = 'none';
    searchResults.style.display = 'none';
    return;
  }
  
  if (!state.library.tracks || state.library.tracks.length === 0) return;
  enrichSearchIndex(state.library);

  // Match logic
  // Score: 2 for prefix match in title/album/artist, 1 for middle match, 0 for no match
  const matchTrack = (t) => {
    let score = 0;
    if (t.title && t.title.toLowerCase().startsWith(q)) score = Math.max(score, 2);
    else if (t.title && t.title.toLowerCase().includes(q)) score = Math.max(score, 1);
    
    if (t.artist && t.artist.toLowerCase().startsWith(q)) score = Math.max(score, 2);
    else if (t.artist && t.artist.toLowerCase().includes(q)) score = Math.max(score, 1);
    
    if (t.album && t.album.toLowerCase().startsWith(q)) score = Math.max(score, 2);
    else if (t.album && t.album.toLowerCase().includes(q)) score = Math.max(score, 1);
    
    if (t.albumArtist && t.albumArtist.toLowerCase().startsWith(q)) score = Math.max(score, 2);
    else if (t.albumArtist && t.albumArtist.toLowerCase().includes(q)) score = Math.max(score, 1);
    
    // Fallback to precomputed string
    if (score === 0 && t._searchStr.includes(q)) score = 1;
    
    return score;
  };
  
  const matchedTracks = [];
  for (const t of state.library.tracks) {
    const score = matchTrack(t);
    if (score > 0) {
      matchedTracks.push({ track: t, score });
    }
  }
  
  if (matchedTracks.length === 0) {
    searchQueryDisplay.textContent = searchInput.value;
    searchEmpty.style.display = 'flex';
    searchResults.style.display = 'none';
    return;
  }
  
  searchEmpty.style.display = 'none';
  searchResults.style.display = 'flex';
  
  matchedTracks.sort((a, b) => b.score - a.score);
  
  // Extract unique albums and artists from matched tracks
  const matchedAlbumKeys = new Set();
  const matchedArtistKeys = new Set();
  
  for (const m of matchedTracks) {
    if (m.track.albumArtist && m.track.album) {
      matchedAlbumKeys.add(`${m.track.albumArtist.trim().toLowerCase()} ${m.track.album.trim().toLowerCase()}`);
    }
    if (m.track.albumArtist) {
      matchedArtistKeys.add(m.track.albumArtist.toLowerCase());
    }
  }
  
  const albums = state.library.albums.filter(a => matchedAlbumKeys.has(albumKey(a)));
  const artists = state.library.artists.filter(a => matchedArtistKeys.has(a.name.toLowerCase()));
  
  // Render Songs
  searchSongsList.innerHTML = '';
  const songsToShow = matchedTracks.slice(0, 20);
  for (const m of songsToShow) {
    const r = m.track;
    const row = document.createElement('div');
    row.className = 'search-row';
    row.innerHTML = `
      <div class="search-row-cover"></div>
      <div class="search-row-info">
        <span class="search-row-title">${escapeHTML(r.title || r.name)}</span>
        <span class="search-row-artist">${escapeHTML(r.artist || r.albumArtist || 'Unknown Artist')}</span>
      </div>
      <div class="search-row-duration">${formatTime(r.duration)}</div>
    `;
    row.addEventListener('click', () => {
      // Find index in main state.library queue
      const idx = state.library.tracks.indexOf(r);
      if (idx !== -1) {
        playerState.originalQueue = state.library.tracks;
        playerState.queue = playerState.shuffle ? seededShuffle([...playerState.originalQueue]) : [...playerState.originalQueue];
        const newIdx = playerState.queue.indexOf(r);
        playTrack(newIdx);
      }
    });
    searchSongsList.appendChild(row);
    
    // Async cover
    const aKey = r.albumArtist && r.album ? `${r.albumArtist.trim().toLowerCase()} ${r.album.trim().toLowerCase()}` : null;
    if (aKey) {
      const album = state.library.albums.find(a => albumKey(a) === aKey);
      if (album) {
        coverUrlForAlbum(album).then(url => {
          const coverEl = row.querySelector('.search-row-cover');
          if (url) {
            coverEl.style.backgroundImage = `url(${url})`;
          } else {
            coverEl.style.background = `linear-gradient(135deg,${gradientFor(aKey)})`;
          }
        });
      }
    }
  }
  
  if (matchedTracks.length > 20) {
    searchSongsCap.style.display = 'block';
  } else {
    searchSongsCap.style.display = 'none';
  }
  searchSongs.style.display = songsToShow.length > 0 ? 'block' : 'none';
  
  // Render Albums
  searchAlbumsList.innerHTML = '';
  const albumsToShow = albums.slice(0, 20);
  for (const a of albumsToShow) {
    const card = document.createElement('a');
    card.className = 'shelf-card';
    card.href = '#album/' + encodeURIComponent(albumKey(a));
    card.innerHTML = `
      <div class="shelf-card__cover"></div>
      <span class="shelf-card__title">${escapeHTML(a.album)}</span>
      <span class="shelf-card__artist">${escapeHTML(a.albumArtist)}</span>
    `;
    searchAlbumsList.appendChild(card);
    
    coverUrlForAlbum(a).then(url => {
      const coverEl = card.querySelector('.shelf-card__cover');
      if (url) {
        coverEl.style.backgroundImage = `url(${url})`;
      } else {
        coverEl.style.background = `linear-gradient(135deg,${gradientFor(albumKey(a))})`;
      }
    });
  }
  
  if (albums.length > 20) {
    searchAlbumsCap.style.display = 'block';
  } else {
    searchAlbumsCap.style.display = 'none';
  }
  searchAlbums.style.display = albumsToShow.length > 0 ? 'block' : 'none';
  
  // Render Artists
  searchArtistsList.innerHTML = '';
  const artistsToShow = artists.slice(0, 20);
  for (const a of artistsToShow) {
    const row = document.createElement('a');
    row.className = 'search-row';
    row.href = '#artist/' + encodeURIComponent(a.name);
    const numAlbums = a.albums.length;
    row.innerHTML = `
      <div class="search-artist-cover"></div>
      <div class="search-row-info">
        <span class="search-row-title">${escapeHTML(a.name)}</span>
        <span class="search-row-artist">${numAlbums} album${numAlbums !== 1 ? 's' : ''}</span>
      </div>
    `;
    searchArtistsList.appendChild(row);
    
    // Assign random gradient for artist for now, or use first album cover
    if (a.albums.length > 0) {
      coverUrlForAlbum(a.albums[0]).then(url => {
        const coverEl = row.querySelector('.search-artist-cover');
        if (url) {
          coverEl.style.backgroundImage = `url(${url})`;
        } else {
          coverEl.style.background = `linear-gradient(135deg,${gradientFor(a.name)})`;
        }
      });
    }
  }
  
  if (artists.length > 20) {
    searchArtistsCap.style.display = 'block';
  } else {
    searchArtistsCap.style.display = 'none';
  }
  searchArtists.style.display = artistsToShow.length > 0 ? 'block' : 'none';
}

let searchTimeout;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(doSearch, 120);
});


// ── Lyrics Parsing & Syncing ───────────────────────────────

const lyricsCache = new Map();
let currentLyrics = null;
let currentLyricsActiveIndex = -1;
const lyricsContainer = document.querySelector('.now-playing__lyrics');

async function loadLyrics(record) {
  lyricsContainer.innerHTML = '<span class="np-lyric-placeholder">Loading...</span>';
  currentLyrics = null;
  currentLyricsActiveIndex = -1;
  // Load per-track sync offset
  if (typeof lyricsOffset !== 'undefined') {
    const offsets = JSON.parse(localStorage.getItem('aubade_lyric_offsets') || '{}');
    lyricsOffset = offsets[record.path] || 0;
    const pill = document.getElementById('np-sync-pill');
    if (pill) pill.textContent = lyricsOffset === 0 ? 'Sync' : `${lyricsOffset > 0 ? '+' : ''}${lyricsOffset}ms`;
  }
  
  if (lyricsCache.has(record.path)) {
    applyLyrics(lyricsCache.get(record.path));
    return;
  }
  
  try {
    const dirHandle = await dbGet('musicDir');
    if (!dirHandle) throw new Error('No directory handle');

    const parts = record.path.split('/');
    let current = dirHandle;
    for (let i = 0; i < parts.length - 1; i++) {
      current = await current.getDirectoryHandle(parts[i]);
    }
    
    const audioName = parts[parts.length - 1];
    const lrcName = audioName.replace(/\.[^/.]+$/, '.lrc');
    
    let lrcHandle;
    try {
      lrcHandle = await current.getFileHandle(lrcName);
    } catch (e) {
      applyLyrics(null);
      return;
    }
    
    const file = await lrcHandle.getFile();
    const content = await file.text();
    const parsed = parseLrc(content);
    
    lyricsCache.set(record.path, parsed);
    applyLyrics(parsed);
  } catch (err) {
    applyLyrics(null);
  }
}


function applyLyrics(parsed) {
  lyricsContainer.innerHTML = '';
  if (!parsed || parsed.lines.length === 0) {
    lyricsContainer.innerHTML = '<span class="np-lyric-placeholder">No lyrics found</span>';
    currentLyrics = null;
    return;
  }
  
  currentLyrics = parsed;
  currentLyricsActiveIndex = -1;
  
  for (let i = 0; i < parsed.lines.length; i++) {
    const l = parsed.lines[i];
    const div = document.createElement('div');
    div.className = 'np-lyric-line';
    div.textContent = l.text || ' '; // Allow blank lines to take up space
    div.dataset.index = i;
    
    if (parsed.synced) {
      div.style.cursor = 'pointer';
      div.addEventListener('click', () => {
        if (!isNaN(audio.duration) && isFinite(audio.duration)) {
          audio.currentTime = l.time;
        }
      });
    }
    
    lyricsContainer.appendChild(div);
  }
}

// ── Play counts ──────────────────────────────────────────────
// The home page has been calling a shelf "Most played" while sorting it
// alphabetically by artist. Nothing counted plays, so nothing could.
//
// A play registers once past 30 seconds or the halfway mark, whichever comes
// first, so skipping through a record does not inflate it.

const PLAY_THRESHOLD_SECONDS = 30;
let countedThisTrack = null;

function playCounts() {
  return JSON.parse(localStorage.getItem('aubade_play_counts') || '{}');
}

function recordPlay(record) {
  const counts = playCounts();
  const prev = counts[record.path] || { n: 0, last: 0 };
  counts[record.path] = { n: prev.n + 1, last: Date.now() };
  localStorage.setItem('aubade_play_counts', JSON.stringify(counts));
}

audio.addEventListener('timeupdate', () => {
  const record = playerState.queue[playerState.index];
  if (record && countedThisTrack !== record.path) {
    const half = audio.duration ? audio.duration / 2 : Infinity;
    if (audio.currentTime >= Math.min(PLAY_THRESHOLD_SECONDS, half)) {
      countedThisTrack = record.path;
      recordPlay(record);
    }
  }
});

audio.addEventListener('loadstart', () => { countedThisTrack = null; });

/** Albums ranked by how much of them has actually been played. */
function albumsByPlays(albums) {
  const counts = playCounts();
  const scored = albums.map((a) => {
    let plays = 0;
    let last = 0;
    for (const t of a.tracks) {
      const c = counts[t.path];
      if (!c) continue;
      plays += c.n;
      if (c.last > last) last = c.last;
    }
    return { album: a, plays, last };
  }).filter((s) => s.plays > 0);
  scored.sort((x, y) => y.plays - x.plays || y.last - x.last);
  return scored.map((s) => s.album);
}

audio.addEventListener('timeupdate', () => {
  if (!currentLyrics || !currentLyrics.synced) return;
  
  const ct = audio.currentTime + (typeof lyricsOffset !== 'undefined' ? lyricsOffset / 1000 : 0);
  let newIdx = -1;
  
  // Find the last line whose time is <= currentTime
  // Optimization: check forward from current index, or backward.
  // Actually, since there are rarely >100 lines, binary search or linear is fine.
  // Linear search backward is fast:
  for (let i = currentLyrics.lines.length - 1; i >= 0; i--) {
    if (currentLyrics.lines[i].time <= ct) {
      newIdx = i;
      break;
    }
  }
  
  if (newIdx !== currentLyricsActiveIndex) {
    currentLyricsActiveIndex = newIdx;
    
    const domLines = lyricsContainer.querySelectorAll('.np-lyric-line');
    domLines.forEach((el, i) => {
      if (i === newIdx) {
        el.classList.add('np-lyric-line--active');
        el.style.opacity = '1';
        
        // smooth center scroll
        const containerRect = lyricsContainer.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        const scrollTarget = el.offsetTop - (lyricsContainer.clientHeight / 2) + (el.clientHeight / 2);
        lyricsContainer.scrollTo({ top: scrollTarget, behavior: 'smooth' });
      } else {
        el.classList.remove('np-lyric-line--active');
        // Fade lines further away
        const dist = Math.abs(i - newIdx);
        let op = 0.3 - (dist * 0.01);
        if (op < 0.25) op = 0.25;
        if (newIdx === -1) op = 0.3; // If before first line
        el.style.opacity = op.toString();
      }
    });
  }
});

// ── Library Grid ─────────────────────────────────────────────

const libFilterPill = document.getElementById('lib-filter-pill');
const libSortBtn = document.getElementById('lib-sort-btn');
const libCountLine = document.getElementById('lib-count-line');
const libContent = document.getElementById('lib-content');

let currentLibView = localStorage.getItem('aubade_lib_view') || 'albums';
let currentLibSort = localStorage.getItem('aubade_lib_sort') || 'Name'; // Name, Artist, Year, Recently added

const SORTS = ['Name', 'Artist', 'Year', 'Recently added'];

if (libFilterPill) {
  libFilterPill.addEventListener('click', (e) => {
    if (e.target.tagName !== 'BUTTON') return;
    currentLibView = e.target.dataset.view;
    localStorage.setItem('aubade_lib_view', currentLibView);
    renderLibraryView();
  });
}

if (libSortBtn) {
  libSortBtn.addEventListener('click', () => {
    let idx = SORTS.indexOf(currentLibSort);
    idx = (idx + 1) % SORTS.length;
    currentLibSort = SORTS[idx];
    localStorage.setItem('aubade_lib_sort', currentLibSort);
    renderLibraryView();
  });
}

let libObserver = null;
let songsToRender = [];
let songsRenderedCount = 0;
const SONGS_BATCH_SIZE = 100;

function renderLibraryView() {
  currentLibView = localStorage.getItem('aubade_lib_view') || 'albums';
  if (!state.library.tracks || state.library.tracks.length === 0) return;
  
  // Update UI state
  Array.from(libFilterPill.children).forEach(btn => {
    if (btn.dataset.view === currentLibView) btn.classList.add('seg-pill__seg--active');
    else btn.classList.remove('seg-pill__seg--active');
  });
  libSortBtn.textContent = 'Sort: ' + currentLibSort;
  
  libContent.innerHTML = '';
  if (libObserver) {
    libObserver.disconnect();
    libObserver = null;
  }
  
  if (currentLibView === 'albums') {
    const hideSingles = localStorage.getItem('aubade_hide_singles') === 'true';
    const albums = hideSingles ? state.library.albums.filter(a => a.tracks.length > 1) : [...state.library.albums];
    
    // Sort
    albums.sort((a, b) => {
      if (currentLibSort === 'Name') return a.album.localeCompare(b.album);
      if (currentLibSort === 'Artist') return a.albumArtist.localeCompare(b.albumArtist) || a.album.localeCompare(b.album);
      if (currentLibSort === 'Year') return (b.year || 0) - (a.year || 0);
      return 0; // Recently added might just be order in DB/state.library
    });
    
    libCountLine.textContent = `${albums.length} album${albums.length !== 1 ? 's' : ''}`;
    
    const grid = document.createElement('div');
    grid.className = 'lib-grid--albums';
    for (const a of albums) {
      grid.appendChild(makeShelfCard(a));
    }
    libContent.appendChild(grid);
    
  } else if (currentLibView === 'artists') {
    const artists = [...state.library.artists];
    
    artists.sort((a, b) => {
      if (currentLibSort === 'Name' || currentLibSort === 'Artist') return a.name.localeCompare(b.name);
      if (currentLibSort === 'Year') return b.albums.length - a.albums.length; // fallback
      return 0;
    });
    
    libCountLine.textContent = `${artists.length} artist${artists.length !== 1 ? 's' : ''}`;
    
    const grid = document.createElement('div');
    grid.className = 'lib-grid--artists';
    for (const a of artists) {
      const card = document.createElement('a');
      card.className = 'artist-card';
      card.href = `#artist/${encodeURIComponent(a.name)}`;
      const numAlbums = a.albums.length;
      card.innerHTML = `
        <div class="artist-card__cover"></div>
        <span class="artist-card__name">${escapeHTML(a.name)}</span>
        <span class="artist-card__count">${numAlbums} album${numAlbums !== 1 ? 's' : ''}</span>
      `;
      
      if (a.albums.length > 0) {
        coverUrlForAlbum(a.albums[0]).then(url => {
          const coverEl = card.querySelector('.artist-card__cover');
          if (url) {
            coverEl.style.backgroundImage = `url(${url})`;
          } else {
            coverEl.style.background = `linear-gradient(135deg,${gradientFor(a.name)})`;
          }
        });
      }
      grid.appendChild(card);
    }
    libContent.appendChild(grid);
    
  } else if (currentLibView === 'songs') {
    songsToRender = [...state.library.tracks];
    
    songsToRender.sort((a, b) => {
      if (currentLibSort === 'Name') return (a.title || a.name).localeCompare(b.title || b.name);
      if (currentLibSort === 'Artist') return (a.artist || '').localeCompare(b.artist || '');
      if (currentLibSort === 'Year') return (b.year || 0) - (a.year || 0);
      return 0;
    });
    
    libCountLine.textContent = `${songsToRender.length} song${songsToRender.length !== 1 ? 's' : ''}`;
    
    const list = document.createElement('div');
    list.className = 'lib-list--songs search-list--songs'; // reuse styling from search
    libContent.appendChild(list);
    
    const sentinel = document.createElement('div');
    sentinel.style.height = '1px';
    libContent.appendChild(sentinel);
    
    songsRenderedCount = 0;
    
    const renderBatch = () => {
      const frag = document.createDocumentFragment();
      const end = Math.min(songsRenderedCount + SONGS_BATCH_SIZE, songsToRender.length);
      
      for (let i = songsRenderedCount; i < end; i++) {
        const r = songsToRender[i];
        const row = document.createElement('div');
        row.className = 'search-row'; // Reuse row style
        row.innerHTML = `
          <div class="search-row-cover"></div>
          <div class="search-row-info">
            <span class="search-row-title">${escapeHTML(r.title || r.name)}</span>
            <span class="search-row-artist">${escapeHTML(r.artist || r.albumArtist || 'Unknown Artist')}</span>
          </div>
          <div class="search-row-duration">${formatTime(r.duration)}</div>
        `;
        row.addEventListener('click', () => {
          // Play from this state.library context
          playerState.originalQueue = songsToRender;
          playerState.queue = playerState.shuffle ? seededShuffle([...playerState.originalQueue]) : [...playerState.originalQueue];
          const newIdx = playerState.queue.indexOf(r);
          playTrack(newIdx);
        });
        frag.appendChild(row);
        
        // cover
        const aKey = r.albumArtist && r.album ? `${r.albumArtist.trim().toLowerCase()} ${r.album.trim().toLowerCase()}` : null;
        if (aKey) {
          const album = state.library.albums.find(a => albumKey(a) === aKey);
          if (album) {
            coverUrlForAlbum(album).then(url => {
              const coverEl = row.querySelector('.search-row-cover');
              if (url) {
                coverEl.style.backgroundImage = `url(${url})`;
              } else {
                coverEl.style.background = `linear-gradient(135deg,${gradientFor(aKey)})`;
              }
            });
          }
        }
      }
      list.appendChild(frag);
      songsRenderedCount = end;
      
      if (songsRenderedCount >= songsToRender.length && libObserver) {
        libObserver.disconnect();
      }
    };
    
    // Initial batch
    renderBatch();
    
    if (songsRenderedCount < songsToRender.length) {
      libObserver = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
          renderBatch();
        }
      });
      libObserver.observe(sentinel);
    }
  }
}

window.__DEBUG_LIBRARY = function() { return state.library; };

// ── Artist View ──────────────────────────────────────────────

async function renderArtistView(name) {
  const artist = state.library.artists.find(a => a.name.toLowerCase() === name.toLowerCase());
  if (!artist) return;

  const bg = document.querySelector('.artist-header__bg');
  const nameEl = document.querySelector('.artist-header__name');
  const meta = document.querySelector('.artist-header__meta');
  const viewArtist = document.getElementById('view-artist');
  const playBtn = document.getElementById('artist-play-btn');
  const shuffleBtn = document.getElementById('artist-shuffle-btn');
  const albumsGrid = document.querySelector('.artist-grid--albums');
  const songsList = document.querySelector('.artist-list--songs');

  nameEl.textContent = artist.name;
  
  const allTracks = [];
  artist.albums.forEach(a => allTracks.push(...a.tracks));
  meta.textContent = `${artist.albums.length} album${artist.albums.length !== 1 ? 's' : ''} - ${allTracks.length} song${allTracks.length !== 1 ? 's' : ''}`;

  bg.style.backgroundImage = 'none';
  const aKey = albumKey(artist.albums[0] || {});
  const grad = gradientFor(aKey || artist.name);
  bg.style.background = `linear-gradient(135deg,${grad})`;
  viewArtist.style.setProperty('--album-accent', 'var(--accent)');

  // Octave shows a circular artist photo. We have no artist images, so the
  // newest album's cover stands in — the same source the backdrop uses.
  const photo = document.getElementById('artist-photo');
  photo.style.backgroundImage = 'none';
  photo.style.background = `linear-gradient(135deg,${grad})`;

  if (artist.albums.length > 0) {
    const url = await coverUrlForAlbum(artist.albums[0]);
    if (url) {
      bg.style.backgroundImage = `url(${url})`;
      photo.style.backgroundImage = `url(${url})`;
      const accent = await getCoverAccent(url);
      if (accent) {
        viewArtist.style.setProperty('--album-accent', accent);
      }
    }
  }

  // Follow has no server to talk to, so it is a local pin that persists.
  const followBtn = document.getElementById('artist-follow-btn');
  const followed = () => JSON.parse(localStorage.getItem('aubade_followed_artists') || '{}');
  const paintFollow = () => {
    const on = !!followed()[artist.name];
    followBtn.setAttribute('aria-pressed', String(on));
    followBtn.textContent = on ? 'Following' : 'Follow';
  };
  paintFollow();
  followBtn.onclick = () => {
    const f = followed();
    if (f[artist.name]) delete f[artist.name]; else f[artist.name] = true;
    localStorage.setItem('aubade_followed_artists', JSON.stringify(f));
    paintFollow();
  };

  const shareBtn = document.getElementById('artist-share-btn');
  shareBtn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(artist.name);
      flashButton(shareBtn);
    } catch { /* clipboard blocked */ }
  };

  // Play controls
  // Sort tracks by album year desc, then track index (since they are in albums)
  const sortedAlbums = [...artist.albums].sort((a, b) => (b.year || 0) - (a.year || 0));
  const sortedTracks = [];
  for (const a of sortedAlbums) {
    sortedTracks.push(...a.tracks);
  }

  const doPlay = (shuffle) => {
    playerState.originalQueue = sortedTracks;
    playerState.queue = shuffle ? seededShuffle([...playerState.originalQueue]) : [...playerState.originalQueue];
    if (shuffle) {
      document.querySelector('button[aria-label="Shuffle"]').style.color = 'var(--accent)';
      playerState.shuffle = true;
    }
    playTrack(0);
  };

  playBtn.onclick = () => doPlay(false);
  shuffleBtn.onclick = () => doPlay(true);

  // Albums shelf
  albumsGrid.innerHTML = '';
  for (const a of sortedAlbums) {
    albumsGrid.appendChild(makeShelfCard(a));
  }

  // Songs list
  songsList.innerHTML = '';
  const tracksToShow = sortedTracks.slice(0, 30);
  for (const r of tracksToShow) {
    const row = document.createElement('div');
    row.className = 'search-row'; // reuse 52px style
    row.innerHTML = `
      <div class="search-row-cover"></div>
      <div class="search-row-info">
        <span class="search-row-title">${escapeHTML(r.title || r.name)}</span>
        <span class="search-row-artist">${escapeHTML(r.album || 'Unknown Album')}</span>
      </div>
      <div class="search-row-duration">${formatTime(r.duration)}</div>
    `;
    row.addEventListener('click', () => {
      playerState.originalQueue = sortedTracks;
      playerState.queue = playerState.shuffle ? seededShuffle([...playerState.originalQueue]) : [...playerState.originalQueue];
      const newIdx = playerState.queue.indexOf(r);
      playTrack(newIdx);
    });
    songsList.appendChild(row);

    const rAKey = albumKey({ albumArtist: r.albumArtist, album: r.album });
    const album = state.library.albums.find(a => albumKey(a) === rAKey);
    if (album) {
      coverUrlForAlbum(album).then(url => {
        const coverEl = row.querySelector('.search-row-cover');
        if (url) {
          coverEl.style.backgroundImage = `url(${url})`;
        } else {
          coverEl.style.background = `linear-gradient(135deg,${gradientFor(rAKey)})`;
        }
      });
    }
  }
}

// ── Settings View ────────────────────────────────────────────

const viewSettings = document.getElementById('view-settings');
document.querySelector('.top-bar__avatar').addEventListener('click', () => {
  window.location.hash = '#settings';
});

function renderSettingsView() {
  // Folder name
  const folderNameEl = document.getElementById('settings-folder-name');
  dbGet('musicDir').then(handle => {
    if (handle && handle.name) {
      folderNameEl.textContent = handle.name;
    } else {
      folderNameEl.textContent = 'No folder selected';
    }
  });

  // Library stats
  const statsEl = document.getElementById('settings-library-stats');
  const numSongs = state.library.tracks ? state.library.tracks.length : 0;
  const numAlbums = state.library.albums ? state.library.albums.length : 0;
  const numArtists = state.library.artists ? state.library.artists.length : 0;
  statsEl.textContent = `${numSongs} song${numSongs !== 1 ? 's' : ''}, ${numAlbums} album${numAlbums !== 1 ? 's' : ''}, ${numArtists} artist${numArtists !== 1 ? 's' : ''}`;

  // Toggles
  const singlesToggle = document.getElementById('settings-toggle-singles');
  singlesToggle.checked = localStorage.getItem('aubade_hide_singles') === 'true';

  // Volume
  const volLabel = document.getElementById('settings-volume-label');
  const updateVolLabel = () => {
    volLabel.textContent = `Volume: ${Math.round(audio.volume * 100)}%`;
  };
  updateVolLabel();
  audio.addEventListener('volumechange', updateVolLabel);

  // Bindings (only once)
  if (!viewSettings._bound) {
    viewSettings._bound = true;
    
    document.getElementById('settings-btn-rescan').addEventListener('click', async (e) => {
      const handle = await dbGet('musicDir');
      if (handle) {
        const btn = e.target;
        btn.textContent = 'Scanning...';
        btn.disabled = true;
        // reuse statusEl for inline update? We'll just update btn text
        await indexDir(handle, { set textContent(v) { btn.textContent = v; } });
        btn.textContent = 'Rescan';
        btn.disabled = false;
        renderSettingsView(); // Update stats
      }
    });

    document.getElementById('settings-btn-change-folder').addEventListener('click', () => {
      pickFolder().then(() => renderSettingsView());
    });

    singlesToggle.addEventListener('change', (e) => {
      localStorage.setItem('aubade_hide_singles', e.target.checked);
      // It takes effect on next render of library/home
    });

    document.getElementById('settings-btn-reset-vol').addEventListener('click', () => {
      audio.volume = 1;
      const volBar = document.querySelector('.player__vol-fill');
      if (volBar) volBar.style.width = '100%';
    });

    document.getElementById('settings-btn-clear-cache').addEventListener('click', () => {
      // Clear memory cache and revoke URLs
      for (const [key, url] of coverCache.entries()) {
        if (url) URL.revokeObjectURL(url);
      }
      coverCache.clear();
      // It will reload automatically when needed
    });

    document.getElementById('settings-btn-reset').addEventListener('click', (e) => {
      const controls = document.getElementById('settings-reset-controls');
      controls.innerHTML = `
        <span style="font-size: 13px; color: var(--text);">Are you sure?</span>
        <button class="settings-btn" id="settings-btn-cancel-reset" type="button">Cancel</button>
        <button class="settings-btn settings-btn--danger" id="settings-btn-confirm-reset" type="button">Reset</button>
      `;
      
      document.getElementById('settings-btn-cancel-reset').addEventListener('click', () => {
        // Restore reset button
        controls.innerHTML = `<button class="settings-btn settings-btn--danger" id="settings-btn-reset" type="button">Reset</button>`;
        // Rebind reset (easiest is just trigger re-render of settings, which doesn't touch DOM, so we can't do that easily... Let's just re-attach the listener, or reload settings)
        viewSettings._bound = false;
        renderSettingsView();
      });

      document.getElementById('settings-btn-confirm-reset').addEventListener('click', async () => {
        const db = await openDB();
        const tx = db.transaction(['handles', 'library'], 'readwrite');
        tx.objectStore('handles').clear();
        tx.objectStore('library').clear();
        tx.oncomplete = () => {
          state.library = { tracks: [], albums: [], artists: [] };
          window.location.hash = '#home';
          window.location.reload();
        };
      });
    });
  }
}

// ── Now-Playing extras (Step 16 fixes) ───────────────────────

// 2. Heart (like) toggle
document.getElementById('np-heart-btn').addEventListener('click', () => {
  const record = playerState.queue[playerState.index];
  if (!record) return;
  const liked = JSON.parse(localStorage.getItem('aubade_liked') || '{}');
  if (liked[record.path]) {
    delete liked[record.path];
  } else {
    liked[record.path] = true;
  }
  localStorage.setItem('aubade_liked', JSON.stringify(liked));
  // Update icon
  const isLiked = !!liked[record.path];
  const btn = document.getElementById('np-heart-btn');
  btn.classList.toggle('np-icon-btn--active', isLiked);
  const svg = btn.querySelector('svg');
  if (svg) svg.setAttribute('fill', isLiked ? 'currentColor' : 'none');
});

// 3. Playback speed control
const speedSteps = [0.75, 1, 1.25, 1.5, 2];
let speedIdx = 1; // default 1x
document.getElementById('np-speed-btn').addEventListener('click', () => {
  speedIdx = (speedIdx + 1) % speedSteps.length;
  const rate = speedSteps[speedIdx];
  audio.playbackRate = rate;
  document.getElementById('np-speed-btn').textContent = rate + 'x';
});

// 4. Bottom utility row: NP volume slider
const npVolSlider = document.querySelector('.np-vol-slider');
const npVolFill = document.getElementById('np-vol-fill');
const npVolKnob = document.getElementById('np-vol-knob');

function updateNpVol() {
  const pct = `${Math.round(audio.volume * 100)}%`;
  npVolFill.style.width = pct;
  npVolKnob.style.left = pct;
}

npVolSlider.addEventListener('click', (e) => {
  const rect = npVolSlider.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  audio.volume = pct;
  updateNpVol();
  // Also sync main player vol bar
  if (uiVolFill) uiVolFill.style.width = `${Math.round(pct * 100)}%`;
  if (uiVolKnob) uiVolKnob.style.left = `${Math.round(pct * 100)}%`;
});

audio.addEventListener('volumechange', updateNpVol);
updateNpVol();

// Two of Octave's four lyric actions have a local meaning. Selecting lines
// toggles a mode where clicking lines marks them; copying takes either the
// selection or the whole lyric.
let lyricSelectMode = false;

document.getElementById('np-lyric-select').addEventListener('click', () => {
  lyricSelectMode = !lyricSelectMode;
  const pane = document.querySelector('.now-playing__lyrics');
  pane.classList.toggle('is-selecting', lyricSelectMode);
  document.getElementById('np-lyric-select').classList.toggle('is-active', lyricSelectMode);
  if (!lyricSelectMode) {
    for (const l of pane.querySelectorAll('.np-lyric-line--picked')) {
      l.classList.remove('np-lyric-line--picked');
    }
  }
});

document.querySelector('.now-playing__lyrics').addEventListener('click', (e) => {
  if (!lyricSelectMode) return;
  const line = e.target.closest('.np-lyric-line');
  if (line) line.classList.toggle('np-lyric-line--picked');
});

document.getElementById('np-lyric-copy').addEventListener('click', async () => {
  const pane = document.querySelector('.now-playing__lyrics');
  const picked = [...pane.querySelectorAll('.np-lyric-line--picked')];
  const lines = (picked.length ? picked : [...pane.querySelectorAll('.np-lyric-line')])
    .map((l) => l.textContent.trim()).filter(Boolean);
  if (!lines.length) return;
  try {
    await navigator.clipboard.writeText(lines.join('\n'));
    showToast(picked.length
      ? `Copied ${picked.length} line${picked.length === 1 ? '' : 's'}`
      : 'Copied lyrics');
  } catch { /* clipboard blocked */ }
});

// ── Visualiser ───────────────────────────────────────────────
// Octave v1.8 describes bars where "bass slams and hangs like a real kick,
// hi-hats jitter fast, mids stay smooth — each column reacts on its own
// instead of moving in lockstep", so this reads real frequency data rather
// than animating on a timer. v2.4 then records the cost of leaving it on:
// analysing for a whole track with nothing on screen is what was heating
// phones. It runs only while the view is open, audio is playing and the tab
// is visible.

const EQ_BARS = [...document.querySelectorAll('#np-eq i')];

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

audio.addEventListener('play', startVisualiser);
audio.addEventListener('pause', stopVisualiser);

// The overlay is opened and closed from six places; watching the class
// catches all of them without threading a call through each.
new MutationObserver(() => {
  if (eqShouldRun()) startVisualiser(); else stopVisualiser();
  if (npOverlay.classList.contains('is-open')) {
    // These measure zero while the overlay is closed, which is when a track
    // usually loads, so they get another look once it is on screen.
    requestAnimationFrame(() => {
      measureMarquee(npTitle);
      measureMarquee(npSubtitle);
    });
  }
}).observe(npOverlay, { attributes: true, attributeFilter: ['class'] });

// A resize changes what fits.
let marqueeResize;
window.addEventListener('resize', () => {
  clearTimeout(marqueeResize);
  marqueeResize = setTimeout(() => {
    for (const el of [uiTitle, uiArtist, npTitle, npSubtitle]) measureMarquee(el);
  }, 200);
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !audio.paused) startVisualiser();
  else stopVisualiser();
});

// ── Keyboard ─────────────────────────────────────────────────
// Only Escape was bound before. These are the bindings Octave lists, including
// its ±10s seek. Typing in a field must never trigger any of them.

function isTyping(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

const SHORTCUTS = [
  ['Space', 'Play or pause'],
  ['← / →', 'Seek 10 seconds'],
  ['Shift + ← / →', 'Previous or next track'],
  ['↑ / ↓', 'Volume'],
  ['M', 'Mute'],
  ['L', 'Like this track'],
  ['Q', 'Queue'],
  ['F', 'Open now playing'],
  ['/', 'Search'],
  ['?', 'This list'],
];

document.addEventListener('keydown', (e) => {
  if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;

  const step = (delta) => {
    if (!audio.duration) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + delta));
  };
  const nudgeVolume = (delta) => {
    audio.volume = Math.max(0, Math.min(1, audio.volume + delta));
    const pct = Math.round(audio.volume * 100);
    if (uiVolFill) uiVolFill.style.width = pct + '%';
    if (uiVolKnob) uiVolKnob.style.left = pct + '%';
  };

  switch (e.key) {
    case ' ':
      e.preventDefault();
      togglePlay();
      break;
    case 'ArrowLeft':
      e.preventDefault();
      if (e.shiftKey) prevTrack(); else step(-SEEK_STEP_SECONDS);
      break;
    case 'ArrowRight':
      e.preventDefault();
      if (e.shiftKey) nextTrack(); else step(SEEK_STEP_SECONDS);
      break;
    case 'ArrowUp': e.preventDefault(); nudgeVolume(0.05); break;
    case 'ArrowDown': e.preventDefault(); nudgeVolume(-0.05); break;
    case 'm': case 'M': audio.muted = !audio.muted; break;
    case 'l': case 'L': document.getElementById('np-heart-btn').click(); break;
    case 'q': case 'Q':
      if (!npOverlay.classList.contains('is-open')) npOverlay.classList.add('is-open');
      setQueueOpen(document.getElementById('np-queue').hidden);
      break;
    case 'f': case 'F': npOverlay.classList.toggle('is-open'); break;
    case '/':
      e.preventDefault();
      window.location.hash = '#search';
      break;
    case '?': toggleShortcutHelp(); break;
    default: break;
  }
});

function toggleShortcutHelp() {
  let panel = document.getElementById('shortcuts');
  if (panel) { panel.remove(); return; }
  panel = document.createElement('div');
  panel.id = 'shortcuts';
  panel.className = 'shortcuts glass-strong';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Keyboard shortcuts');
  const h = document.createElement('h2');
  h.className = 'shortcuts__title';
  h.textContent = 'Keyboard shortcuts';
  panel.appendChild(h);
  for (const [keys, what] of SHORTCUTS) {
    const row = document.createElement('div');
    row.className = 'shortcuts__row';
    const k = document.createElement('kbd');
    k.textContent = keys;
    const d = document.createElement('span');
    d.textContent = what;
    row.append(k, d);
    panel.appendChild(row);
  }
  document.getElementById('app').appendChild(panel);
}

// ── Queue ────────────────────────────────────────────────────
// The queue has existed in playerState from the start with no way to see it,
// which left the queue buttons pointing at nothing. It shares the right-hand
// pane with the lyrics, as Octave's does.

const npQueue = document.getElementById('np-queue');
const npQueueList = document.getElementById('np-queue-list');
const npLyricsPane = document.querySelector('.now-playing__lyrics');
const npSyncRow = document.getElementById('np-sync-row');

function renderQueue() {
  npQueueList.innerHTML = '';
  const { queue, index } = playerState;
  if (!queue.length) {
    const empty = document.createElement('p');
    empty.className = 'np-queue__empty';
    empty.textContent = 'Nothing queued.';
    npQueueList.appendChild(empty);
    return;
  }

  queue.forEach((t, i) => {
    if (i === index) {
      const label = document.createElement('p');
      label.className = 'np-queue__label';
      label.textContent = 'Now playing';
      npQueueList.appendChild(label);
    } else if (i === index + 1) {
      const label = document.createElement('p');
      label.className = 'np-queue__label';
      label.textContent = 'Next up';
      npQueueList.appendChild(label);
    }

    const row = document.createElement('div');
    row.className = 'np-queue__row' + (i === index ? ' is-current' : '');
    if (i === index) row.id = 'np-queue-current';

    const info = document.createElement('div');
    info.className = 'np-queue__info';
    const title = document.createElement('span');
    title.className = 'np-queue__track';
    title.textContent = t.title || t.name;
    const artist = document.createElement('span');
    artist.className = 'np-queue__artist';
    artist.textContent = t.artist || t.albumArtist || '';
    info.append(title, artist);

    const dur = document.createElement('span');
    dur.className = 'np-queue__duration';
    dur.textContent = t.duration ? formatTime(t.duration) : '';

    row.append(info, dur);
    row.onclick = () => { playTrack(i); renderQueue(); };
    npQueueList.appendChild(row);
  });

  // Octave v2.0: opening the queue snaps to the current track rather than
  // dumping you at the top of a long list.
  const current = document.getElementById('np-queue-current');
  if (current) current.scrollIntoView({ block: 'center' });
}

function setQueueOpen(open) {
  npQueue.hidden = !open;
  npLyricsPane.style.display = open ? 'none' : '';
  npSyncRow.style.display = open ? 'none' : '';
  document.getElementById('np-queue-btn').classList.toggle('np-icon-btn--active', open);
  if (open) renderQueue();
}

document.getElementById('np-queue-btn').addEventListener('click', () => {
  setQueueOpen(npQueue.hidden);
});

document.getElementById('np-queue-clear').addEventListener('click', () => {
  const { queue, index } = playerState;
  if (index < 0) return;
  playerState.queue = queue.slice(0, index + 1);
  playerState.originalQueue = playerState.originalQueue.filter(
    (t) => playerState.queue.includes(t));
  renderQueue();
  showToast('Cleared what was coming next');
});

// Octave v2.4: "Scroll over the volume bar to change it on desktop."
for (const bar of [npVolSlider, document.querySelector('.player__vol-bar')]) {
  if (!bar) continue;
  bar.addEventListener('wheel', (e) => {
    e.preventDefault();
    const step = e.deltaY < 0 ? 0.05 : -0.05;
    audio.volume = Math.max(0, Math.min(1, audio.volume + step));
    updateNpVol();
    const pct = Math.round(audio.volume * 100);
    if (uiVolFill) uiVolFill.style.width = pct + '%';
    if (uiVolKnob) uiVolKnob.style.left = pct + '%';
  }, { passive: false });
}

// Lyrics toggle
const npLyricsToggle = document.getElementById('np-lyrics-toggle');
const npRight = document.querySelector('.now-playing__right');
npLyricsToggle.addEventListener('click', () => {
  // If the queue has the pane, hand it back to the lyrics rather than
  // hiding a pane the user cannot see anyway.
  if (!document.getElementById('np-queue').hidden) {
    setQueueOpen(false);
    npRight.style.display = '';
    npLyricsToggle.classList.add('np-icon-btn--active');
    return;
  }
  const isHidden = npRight.style.display === 'none';
  npRight.style.display = isHidden ? '' : 'none';
  npLyricsToggle.classList.toggle('np-icon-btn--active', isHidden);
});

// 5. Lyrics sync offset
let lyricsOffset = 0;
const npSyncPill = document.getElementById('np-sync-pill');

function getLyricsOffset(trackPath) {
  const offsets = JSON.parse(localStorage.getItem('aubade_lyric_offsets') || '{}');
  return offsets[trackPath] || 0;
}

function setLyricsOffset(trackPath, ms) {
  const offsets = JSON.parse(localStorage.getItem('aubade_lyric_offsets') || '{}');
  offsets[trackPath] = ms;
  localStorage.setItem('aubade_lyric_offsets', JSON.stringify(offsets));
}

function updateSyncLabel() {
  if (lyricsOffset === 0) {
    npSyncPill.textContent = 'Sync';
  } else {
    const sign = lyricsOffset > 0 ? '+' : '';
    npSyncPill.textContent = `${sign}${lyricsOffset}ms`;
  }
}

document.getElementById('np-sync-minus').addEventListener('click', () => {
  const record = playerState.queue[playerState.index];
  if (!record) return;
  lyricsOffset -= 100;
  setLyricsOffset(record.path, lyricsOffset);
  updateSyncLabel();
});

document.getElementById('np-sync-plus').addEventListener('click', () => {
  const record = playerState.queue[playerState.index];
  if (!record) return;
  lyricsOffset += 100;
  setLyricsOffset(record.path, lyricsOffset);
  updateSyncLabel();
});




// 6. Menu popover
const npMenuBtn = document.getElementById('np-menu-btn');
const npMenu = document.getElementById('np-menu');

npMenuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const opening = npMenu.style.display === 'none';
  if (opening) syncNpMenuLabels();
  npMenu.style.display = opening ? 'block' : 'none';
});

function closeNpMenu() {
  npMenu.style.display = 'none';
}

document.getElementById('np-credits-close').addEventListener('click', () => {
  document.getElementById('np-credits').classList.remove('is-open');
});

// Share had markup but no handler. There is no link to share for a local
// file, so it copies what identifies the track.
document.getElementById('np-share-btn').addEventListener('click', async () => {
  const record = playerState.queue[playerState.index];
  if (!record) return;
  const text = `${record.title || record.name} — ${record.artist || record.albumArtist}`;
  try {
    await navigator.clipboard.writeText(text);
    flashButton(document.getElementById('np-share-btn'));
  } catch { /* clipboard blocked */ }
});

document.addEventListener('click', (e) => {
  if (!npMenu.contains(e.target) && e.target !== npMenuBtn) {
    closeNpMenu();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  closeNpMenu();
  document.getElementById('np-credits').classList.remove('is-open');
  const help = document.getElementById('shortcuts');
  if (help) help.remove();
});

npMenu.addEventListener('click', (e) => {
  const item = e.target.closest('.np-menu__item');
  if (!item) return;
  const action = item.dataset.action;
  const record = playerState.queue[playerState.index];
  if (!record) return;
  
  switch (action) {
    case 'go-album': {
      const key = `${record.albumArtist.trim().toLowerCase()}\0${record.album.trim().toLowerCase()}`;
      npOverlay.classList.remove('is-open');
      closeNpMenu();
      window.location.hash = '#album/' + encodeURIComponent(key);
      break;
    }
    case 'go-artist': {
      npOverlay.classList.remove('is-open');
      closeNpMenu();
      window.location.hash = '#artist/' + encodeURIComponent(record.artist || record.albumArtist);
      break;
    }
    case 'copy-title': {
      const text = `${record.title || record.name} - ${record.artist || record.albumArtist}`;
      navigator.clipboard.writeText(text).catch(() => {});
      closeNpMenu();
      break;
    }
    case 'like': {
      document.getElementById('np-heart-btn').click();
      closeNpMenu();
      break;
    }
    case 'play-next': {
      playerState.queue.splice(playerState.index + 1, 0, record);
      playerState.originalQueue.splice(playerState.index + 1, 0, record);
      closeNpMenu();
      break;
    }
    case 'add-queue': {
      playerState.queue.push(record);
      playerState.originalQueue.push(record);
      closeNpMenu();
      break;
    }
    case 'toggle-lyrics': {
      document.getElementById('np-lyrics-toggle').click();
      closeNpMenu();
      break;
    }
    case 'credits': {
      closeNpMenu();
      showCredits(record);
      break;
    }
  }
});

// The indexer keeps only what the state.library views need, but the files carry
// more — composer, lyricist, label, ISRC, copyright. Read those on demand for
// the one track being asked about, and cache so reopening is free.
const creditsCache = new Map();

async function readCredits(record) {
  if (creditsCache.has(record.path)) return creditsCache.get(record.path);
  let credits = null;
  try {
    const dirHandle = await dbGet('musicDir');
    if (dirHandle) {
      const parts = record.path.split('/');
      let cur = dirHandle;
      for (let i = 0; i < parts.length - 1; i++) cur = await cur.getDirectoryHandle(parts[i]);
      const file = await (await cur.getFileHandle(parts[parts.length - 1])).getFile();
      const { parseBlob } = await import('./vendor/music-metadata.mjs');
      // duration:true for the same reason cover extraction needs it — the
      // early-exit path truncates comments that span many Ogg pages.
      const md = await parseBlob(file, { duration: true });
      const c = md.common || {};
      const f = md.format || {};
      credits = {
        composer: (c.composer || []).join(', '),
        lyricist: (c.lyricist || []).join(', '),
        label: (c.label || []).join(', '),
        isrc: (c.isrc || []).join(', '),
        copyright: c.copyright || '',
        codec: f.codec || f.container || '',
        sampleRate: f.sampleRate ? Math.round(f.sampleRate / 1000) + ' kHz' : '',
        bitrate: f.bitrate ? Math.round(f.bitrate / 1000) + ' kbps' : '',
        channels: f.numberOfChannels === 1 ? 'Mono' : f.numberOfChannels === 2 ? 'Stereo' : '',
      };
    }
  } catch { credits = null; }
  creditsCache.set(record.path, credits);
  return credits;
}

async function showCredits(record) {
  const panel = document.getElementById('np-credits');
  const body = document.getElementById('np-credits-body');
  panel.classList.add('is-open');
  body.innerHTML = '<p class="np-credits__empty">Reading tags…</p>';

  const c = await readCredits(record);
  const rows = [
    ['Title', record.title || record.name],
    ['Artist', record.artist || record.albumArtist],
    ['Album', record.album],
    ['Year', record.year || ''],
    ['Composer', c && c.composer],
    ['Lyricist', c && c.lyricist],
    ['Label', c && c.label],
    ['Copyright', c && c.copyright],
    ['ISRC', c && c.isrc],
    ['Format', c && [c.codec, c.sampleRate, c.bitrate, c.channels].filter(Boolean).join(' · ')],
  ].filter(([, v]) => v);

  body.innerHTML = '';
  if (rows.length === 0) {
    body.innerHTML = '<p class="np-credits__empty">No credits in this file.</p>';
    return;
  }
  for (const [label, value] of rows) {
    const row = document.createElement('div');
    row.className = 'np-credits__row';
    const k = document.createElement('span');
    k.className = 'np-credits__key';
    k.textContent = label;
    const v = document.createElement('span');
    v.className = 'np-credits__value';
    v.textContent = value;
    row.append(k, v);
    body.append(row);
  }
}

// The menu's two toggling rows should say what pressing them will do.
function syncNpMenuLabels() {
  const record = playerState.queue[playerState.index];
  const likeItem = npMenu.querySelector('[data-action="like"] [data-label]');
  if (likeItem && record) {
    const liked = JSON.parse(localStorage.getItem('aubade_liked') || '{}');
    likeItem.textContent = liked[record.path] ? 'Remove from Liked Songs' : 'Add to Liked Songs';
  }
  const lyricsItem = npMenu.querySelector('[data-action="toggle-lyrics"] [data-label]');
  const right = document.querySelector('.now-playing__right');
  if (lyricsItem && right) {
    lyricsItem.textContent = right.style.display === 'none' ? 'Show lyrics' : 'Hide lyrics';
  }
}
