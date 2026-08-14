// ── IndexedDB (aubade / handles + library) ──────────────────
// FileSystemDirectoryHandle is structured-cloneable, so it stores
// directly — never JSON-serialise it.

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('aubade', 2);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (e.oldVersion < 1) db.createObjectStore('handles');
      if (e.oldVersion < 2) db.createObjectStore('library');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGet(key, storeName = 'handles') {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbSet(key, value, storeName = 'handles') {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

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

let library = { tracks: [], albums: [], artists: [] };
export function getLibrary() { return library; }

// Kept for backward compat but now just returns library.tracks
export function getTracks() { return library.tracks; }

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

  library = { tracks: records, albums, artists };
  return library;
}

function formatStatus(lib, failed) {
  let s = `${lib.tracks.length} songs · ${lib.albums.length} albums · ${lib.artists.length} artists`;
  if (failed > 0) s += ` · ${failed} failed`;
  return s;
}

// ── Cover art (on demand) ───────────────────────────────────

const coverCache = new Map();

function albumKey(a) {
  return `${a.albumArtist.trim().toLowerCase()}\0${a.album.trim().toLowerCase()}`;
}

// Stable gradient placeholders, chosen by a hash of the album key.
//
// Every dark end is kept clear of black on purpose. Most albums in a real
// library have no embedded artwork, so these are what the shelves are mostly
// made of, and the near-black starts an earlier set used disappeared against
// the page — a card that reads as a hole rather than as a record.
const GRADIENTS = [
  '#2d1b69,#b44593', '#1a3a2a,#4ecdc4', '#6b2d3e,#e8927c',
  '#20344d,#415a77', '#3d1c02,#c97b2a', '#2e2e5e,#6c63ff',
  '#2a0a0a,#c0392b', '#17472f,#27ae60', '#4a1942,#e84393',
  '#2c3e50,#3498db', '#2c2c4a,#e94560', '#1d4d5e,#34e89e',
  '#3c1053,#ad5389', '#25344d,#3d5a80', '#611818,#d4a373',
  '#243845,#3a6073', '#2b1055,#d53369', '#232046,#4834d4',
  '#3a1c01,#e67e22', '#2a4a6e,#a8dadc', '#2d132c,#ee6352',
  '#333333,#6d6d6d', '#1e5a6b,#71b280', '#4b134f,#c94b4b',
];

function gradientFor(key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return GRADIENTS[Math.abs(h) % GRADIENTS.length];
}

async function coverUrlForAlbum(album) {
  const key = albumKey(album);
  if (coverCache.has(key)) return coverCache.get(key);

  // Need a live FileSystemFileHandle — only available when permission is active.
  // The library from IndexedDB stores plain records (no handles). We need to
  // walk the directory to find the file. For now, if the track has no handle
  // stored, we skip.
  const firstTrack = album.tracks[0];
  if (!firstTrack || !firstTrack.path) {
    coverCache.set(key, null);
    return null;
  }

  try {
    // Re-walk to find the file handle for this track
    const dirHandle = await dbGet('musicDir');
    if (!dirHandle) { coverCache.set(key, null); return null; }

    // Navigate the path segments to reach the file
    const parts = firstTrack.path.split('/');
    let current = dirHandle;
    for (let i = 0; i < parts.length - 1; i++) {
      current = await current.getDirectoryHandle(parts[i]);
    }
    const fileHandle = await current.getFileHandle(parts[parts.length - 1]);
    const file = await fileHandle.getFile();

    const { parseBlob } = await import('./vendor/music-metadata.mjs');
    const metadata = await parseBlob(file, { duration: false });
    const pics = metadata.common.picture;
    if (!pics || pics.length === 0) {
      coverCache.set(key, null);
      return null;
    }
    const pic = pics[0];
    const blob = new Blob([pic.data], { type: pic.format });
    const url = URL.createObjectURL(blob);
    coverCache.set(key, url);
    return url;
  } catch {
    coverCache.set(key, null);
    return null;
  }
}

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
    coverEl.style.background = `linear-gradient(135deg,${grad})`;
    coverEl._albumData = album;
    setupCoverObserver();
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
  if (!lib || !lib.albums || lib.albums.length === 0) return;

  const albums = lib.albums;

  // Recently added: last 12 albums by array order (order of discovery)
  const recent = albums.slice(-12).reverse();

  // Most played: no play counts yet, so alphabetical by artist
  const byArtist = [...albums].sort((a, b) =>
    a.albumArtist.localeCompare(b.albumArtist)
  );
  const played = byArtist.slice(0, 12);

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

  // Update shelf 2 subtitle since there are no play counts
  const shelfPlayed = document.getElementById('shelf-played');
  if (shelfPlayed) {
    const sub = shelfPlayed.querySelector('.shelf__subtitle');
    if (sub) sub.textContent = 'Your library, A to Z';
    renderShelfRow(shelfPlayed, played);
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

  // Phase 3: build library and persist
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
        library = cached;
        statusEl.textContent = formatStatus(library, 0);
        renderHome(library);
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

  // Check for a cached library index first — works even without
  // folder handle (e.g. if handle was cleared but index persists)
  const cached = await dbGet('index', 'library');
  if (cached) {
    library = cached;
    statusEl.textContent = formatStatus(library, 0);
    renderHome(library);
  }

  const handle = await dbGet('musicDir');
  if (!handle) return;

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
}

init();

// ── Playback ────────────────────────────────────────────────

const audio = new Audio();
const playerState = {
  queue: [],
  index: -1,
  shuffle: false,
  repeat: false,
  originalQueue: []
};

let currentObjectUrl = null;

async function playTrack(index) {
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
  } catch (err) {
    console.warn(`Could not play ${record.path}:`, err);
    nextTrack();
  }
}

function playAlbum(key, startIndex = 0) {
  const album = library.albums.find(a => key === albumKey(a));
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

function updatePlayerUI(record) {
  uiTitle.textContent = record.title || record.name;
  uiArtist.textContent = record.artist || record.albumArtist || 'Unknown Artist';
  
  const album = library.albums.find(a => albumKey(a) === `${record.albumArtist.trim().toLowerCase()}\0${record.album.trim().toLowerCase()}`);
  if (album) {
    coverUrlForAlbum(album).then(url => {
      if (url) {
        uiCover.style.backgroundImage = `url(${url})`;
        uiCover.style.backgroundSize = 'cover';
        uiCover.style.backgroundPosition = 'center';
      } else {
        const grad = gradientFor(albumKey(album));
        uiCover.style.background = `linear-gradient(135deg,${grad})`;
        uiCover.style.backgroundImage = 'none';
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
    }
  }
  scrubRaf = requestAnimationFrame(updateScrubber);
}

audio.addEventListener('play', () => {
  uiPlayIcon.innerHTML = `<path d="M6 5h3v10H6zm5 0h3v10h-3z" fill="currentColor" stroke="none" />`;
  if (!scrubRaf) scrubRaf = requestAnimationFrame(updateScrubber);
});

audio.addEventListener('pause', () => {
  uiPlayIcon.innerHTML = `<path d="M7.5 4.5v11l8-5.5Z" fill="currentColor" stroke="none" />`;
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

uiShuffleBtn.addEventListener('click', () => {
  playerState.shuffle = !playerState.shuffle;
  uiShuffleBtn.style.color = playerState.shuffle ? 'var(--accent)' : '';
  
  if (playerState.queue.length > 0) {
    const currentTrack = playerState.queue[playerState.index];
    if (playerState.shuffle) {
      playerState.queue = seededShuffle([...playerState.originalQueue]);
    } else {
      playerState.queue = [...playerState.originalQueue];
    }
    playerState.index = playerState.queue.indexOf(currentTrack);
  }
});

uiRepeatBtn.addEventListener('click', () => {
  playerState.repeat = !playerState.repeat;
  uiRepeatBtn.style.color = playerState.repeat ? 'var(--accent)' : '';
});

// Scrubber interaction
uiScrubber.addEventListener('click', (e) => {
  if (!audio.duration) return;
  const rect = uiScrubber.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  audio.currentTime = pct * audio.duration;
  
  uiScrubFill.style.width = `${pct * 100}%`;
  uiScrubKnob.style.left = `${pct * 100}%`;
  uiTimeCurrent.textContent = formatTime(audio.currentTime);
});

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
  const card = e.target.closest('.shelf-card, .quick-card, .hero-card');
  if (card && card.dataset.album) {
    e.preventDefault();
    playAlbum(card.dataset.album);
  }
});
