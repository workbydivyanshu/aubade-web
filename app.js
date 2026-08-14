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
  enrichSearchIndex(lib);
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
  
  handleRoute();
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
    loadLyrics(record).catch(e => console.warn('Lyrics failed:', e));
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

// Now Playing Elements
const npOverlay = document.getElementById('now-playing');
const npCloseBtn = document.getElementById('np-close');
const npOpenBtn = document.querySelector('.player__icon-btn[aria-label="Expand now playing"]');
const npBg = document.querySelector('.now-playing__bg');
const npCover = document.getElementById('np-cover');
const npTitle = document.getElementById('np-title');
const npArtist = document.getElementById('np-artist');
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

function updatePlayerUI(record) {
  uiTitle.textContent = record.title || record.name;
  uiArtist.textContent = record.artist || record.albumArtist || 'Unknown Artist';
  
  npTitle.textContent = record.title || record.name;
  npArtist.textContent = record.artist || record.albumArtist || 'Unknown Artist';
  npAlbum.textContent = record.album || 'Unknown Album';
  
  const album = library.albums.find(a => albumKey(a) === `${record.albumArtist.trim().toLowerCase()}\0${record.album.trim().toLowerCase()}`);
  if (album) {
    coverUrlForAlbum(album).then(url => {
      if (url) {
        uiCover.style.backgroundImage = `url(${url})`;
        uiCover.style.backgroundSize = 'cover';
        uiCover.style.backgroundPosition = 'center';
        
        npBg.style.backgroundImage = `url(${url})`;
        npCover.style.backgroundImage = `url(${url})`;
      } else {
        const grad = gradientFor(albumKey(album));
        uiCover.style.background = `linear-gradient(135deg,${grad})`;
        uiCover.style.backgroundImage = 'none';
        
        npBg.style.background = `linear-gradient(135deg,${grad})`;
        npBg.style.backgroundImage = 'none';
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

function handleRoute() {
  const hash = window.location.hash || '#home';
  const viewHome = document.getElementById('view-home');
  const viewAlbum = document.getElementById('view-album');
  const viewSearch = document.getElementById('view-search');
  
  viewHome.style.display = 'none';
  viewAlbum.style.display = 'none';
  viewSearch.style.display = 'none';
  
  document.querySelectorAll('.sidebar__nav-item').forEach(el => el.classList.remove('sidebar__nav-item--selected'));

  if (hash.startsWith('#album/')) {
    const key = decodeURIComponent(hash.substring(7));
    if (library.albums && library.albums.length > 0) {
      renderAlbumView(key);
    }
    viewAlbum.style.display = 'block';
  } else if (hash.startsWith('#search')) {
    viewSearch.style.display = 'block';
    const searchNav = document.querySelector('a[href="#search"]');
    if (searchNav) searchNav.classList.add('sidebar__nav-item--selected');
    setTimeout(() => {
      const input = document.getElementById('search-input');
      if (input) input.focus();
    }, 50);
  } else {
    viewHome.style.display = 'block';
    const homeNav = document.querySelector('a[href="#home"]');
    if (homeNav) homeNav.classList.add('sidebar__nav-item--selected');
  }
}

document.querySelector('.top-bar__btn[aria-label="Go back"]')?.addEventListener('click', () => history.back());
document.querySelector('.top-bar__btn[aria-label="Go forward"]')?.addEventListener('click', () => history.forward());

function getCoverAccent(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 32;
      canvas.height = 32;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, 32, 32);
      try {
        const data = ctx.getImageData(0, 0, 32, 32).data;
        let r = 0, g = 0, b = 0, count = 0;
        for (let i = 0; i < data.length; i += 4) {
          r += data[i];
          g += data[i+1];
          b += data[i+2];
          count++;
        }
        if (count === 0) return resolve(null);
        r = Math.round(r / count);
        g = Math.round(g / count);
        b = Math.round(b / count);
        
        // Boost saturation/lightness slightly
        const max = Math.max(r, g, b);
        if (max > 0) {
          const factor = Math.min(255 / max, 1.5);
          r = Math.min(255, Math.round(r * factor));
          g = Math.min(255, Math.round(g * factor));
          b = Math.min(255, Math.round(b * factor));
        }
        resolve(`rgb(${r}, ${g}, ${b})`);
      } catch (e) {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

async function renderAlbumView(key) {
  const album = library.albums.find(a => key === albumKey(a));
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
  
  if (!library.tracks || library.tracks.length === 0) return;
  enrichSearchIndex(library);

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
  for (const t of library.tracks) {
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
  
  const albums = library.albums.filter(a => matchedAlbumKeys.has(albumKey(a)));
  const artists = library.artists.filter(a => matchedArtistKeys.has(a.name.toLowerCase()));
  
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
      // Find index in main library queue
      const idx = library.tracks.indexOf(r);
      if (idx !== -1) {
        playerState.originalQueue = library.tracks;
        playerState.queue = playerState.shuffle ? seededShuffle([...playerState.originalQueue]) : [...playerState.originalQueue];
        const newIdx = playerState.queue.indexOf(r);
        playTrack(newIdx);
      }
    });
    searchSongsList.appendChild(row);
    
    // Async cover
    const aKey = r.albumArtist && r.album ? `${r.albumArtist.trim().toLowerCase()} ${r.album.trim().toLowerCase()}` : null;
    if (aKey) {
      const album = library.albums.find(a => albumKey(a) === aKey);
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
    const row = document.createElement('div');
    row.className = 'search-row';
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

function parseLrc(content) {
  const lines = content.split('\n');
  let offset = 0;
  const parsedLines = [];
  let hasTimestamps = false;

  const timeRegex = /\[(\d{2,}):(\d{2})(?:\.(\d{2,3}))?\]/g;

  for (const line of lines) {
    const offsetMatch = line.match(/\[offset:\s*([\+\-]?\d+)\]/i);
    if (offsetMatch) {
      offset = parseInt(offsetMatch[1], 10) / 1000;
      break;
    }
  }

  for (const line of lines) {
    const rawText = line.replace(timeRegex, '').replace(/\[\w+:[^\]]*\]/g, '').trim();
    
    const timeMatches = [...line.matchAll(timeRegex)];
    if (timeMatches.length > 0) {
      hasTimestamps = true;
      for (const match of timeMatches) {
        const mins = parseInt(match[1], 10);
        const secs = parseInt(match[2], 10);
        let msStr = match[3] || '00';
        if (msStr.length === 2) msStr += '0';
        const ms = parseInt(msStr, 10);
        
        let time = mins * 60 + secs + ms / 1000;
        time += offset;
        
        parsedLines.push({ time, text: rawText });
      }
    } else {
      if (rawText && !line.match(/^\[\w+:/)) {
         parsedLines.push({ time: -1, text: rawText });
      }
    }
  }

  if (hasTimestamps) {
    const timed = parsedLines.filter(l => l.time >= 0);
    timed.sort((a, b) => a.time - b.time);
    return { synced: true, lines: timed };
  } else {
    return { synced: false, lines: parsedLines.filter(l => l.text) };
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

audio.addEventListener('timeupdate', () => {
  if (!currentLyrics || !currentLyrics.synced) return;
  
  const ct = audio.currentTime;
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
