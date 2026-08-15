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

  // A bare catch here used to swallow every failure and cache null, which made
  // a thrown error indistinguishable from an album that genuinely has no art.
  // Name the stage so a failure says which step broke.
  let stage = 'start';
  try {
    // Re-walk to find the file handle for this track
    stage = 'dbGet(musicDir)';
    const dirHandle = await dbGet('musicDir');
    if (!dirHandle) {
      console.warn('[cover-diag] no musicDir handle in IndexedDB for:', album.album);
      coverCache.set(key, null);
      return null;
    }

    stage = 'queryPermission';
    if (dirHandle.queryPermission) {
      const perm = await dirHandle.queryPermission({ mode: 'read' });
      if (perm !== 'granted') {
        console.warn('[cover-diag] permission is "' + perm + '" (not granted) for:', album.album);
        return null; // not cached: permission can still be granted later
      }
    }

    // Navigate the path segments to reach the file
    const parts = firstTrack.path.split('/');
    let current = dirHandle;
    for (let i = 0; i < parts.length - 1; i++) {
      stage = 'getDirectoryHandle("' + parts[i] + '")';
      current = await current.getDirectoryHandle(parts[i]);
    }
    stage = 'getFileHandle("' + parts[parts.length - 1] + '")';
    const fileHandle = await current.getFileHandle(parts[parts.length - 1]);
    stage = 'getFile';
    const file = await fileHandle.getFile();

    stage = 'import(music-metadata)';
    const { parseBlob } = await import('./vendor/music-metadata.mjs');
    stage = 'parseBlob (' + file.size + ' bytes, type "' + file.type + '")';
    // duration:true is load-bearing, not a typo. With it off, the parser takes
    // an early-exit path that stops reading partway through a Vorbis comment
    // spanning many Ogg pages, so a 2455172-char METADATA_BLOCK_PICTURE
    // arrives truncated to 844741 and atob rejects it. Costs ~250ms a file
    // instead of ~18ms, but the result is cached and loaded lazily.
    const metadata = await parseBlob(file, { duration: true });
    const pics = metadata.common.picture;
    if (!pics || pics.length === 0) {
      console.warn('[cover-diag] parsed fine but no embedded picture:', album.album,
        '| container:', metadata.format && metadata.format.container,
        '| tag types:', (metadata.native && Object.keys(metadata.native).join(',')) || 'none');
      coverCache.set(key, null);
      return null;
    }
    const pic = pics[0];
    const blob = new Blob([pic.data], { type: pic.format });
    const url = URL.createObjectURL(blob);
    coverCache.set(key, url);
    return url;
  } catch (err) {
    console.warn('[cover-diag] threw at stage "' + stage + '" for:', album.album,
      '| path:', firstTrack.path, '|', err && err.name, '-', err && err.message);
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

  uiTitle.textContent = '';
  uiArtist.textContent = '';
  uiCover.style.backgroundImage = 'none';
  npTitle.textContent = '';
  npSubtitle.textContent = '';
  npAlbum.textContent = '';
  npCover.style.backgroundImage = 'none';
  npBg.style.backgroundImage = 'none';
  document.querySelector('.player__time:first-of-type').textContent = '0:00';
  document.querySelector('.player__time:last-of-type').textContent = '0:00';
  uiTrackFill.style.width = '0%';
  uiTrackKnob.style.left = '0%';
  npTrackFill.style.width = '0%';
  npTrackKnob.style.left = '0%';
  uiPlayBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  uiPlayBtn.disabled = true;
  // Clear format
  const fmtEl = document.getElementById('np-format');
  if (fmtEl) fmtEl.textContent = '';
}

function updatePlayerUI(record) {
  document.getElementById('app').classList.remove('is-idle');
  uiPlayBtn.disabled = false;
  uiTitle.textContent = record.title || record.name;
  uiArtist.textContent = record.artist || record.albumArtist || 'Unknown Artist';
  
  npTitle.textContent = record.title || record.name;
  const artist = record.artist || record.albumArtist || 'Unknown Artist';
  const albumName = record.album || 'Unknown Album';
  npSubtitle.textContent = `${albumName} · ${artist}`;
  npAlbum.textContent = albumName;

  // Format label from file extension
  const fmtEl = document.getElementById('np-format');
  if (fmtEl && record.path) {
    const ext = record.path.split('.').pop().toUpperCase();
    fmtEl.textContent = ext;
  }

  // Heart state
  const heartBtn = document.getElementById('np-heart-btn');
  if (heartBtn) {
    const likedPaths = JSON.parse(localStorage.getItem('aubade_liked') || '{}');
    const isLiked = !!likedPaths[record.path];
    heartBtn.classList.toggle('np-icon-btn--active', isLiked);
    const svg = heartBtn.querySelector('svg');
    if (svg) svg.setAttribute('fill', isLiked ? 'currentColor' : 'none');
  }
  
  const album = library.albums.find(a => albumKey(a) === `${record.albumArtist.trim().toLowerCase()}\0${record.album.trim().toLowerCase()}`);
  if (album) {
    coverUrlForAlbum(album).then(url => {
      if (url) {
        uiCover.style.backgroundImage = `url(${url})`;
        uiCover.style.backgroundSize = 'cover';
        uiCover.style.backgroundPosition = 'center';
        
        npBg.style.backgroundImage = `url(${url})`;
        npCover.style.backgroundImage = `url(${url})`;
        npCover.style.backgroundSize = 'cover';
        npCover.style.backgroundPosition = 'center';
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
  const viewLibrary = document.getElementById('view-library');
  const viewArtist = document.getElementById('view-artist');
  const viewSettings = document.getElementById('view-settings');
  
  viewHome.style.display = 'none';
  viewAlbum.style.display = 'none';
  viewSearch.style.display = 'none';
  viewLibrary.style.display = 'none';
  viewArtist.style.display = 'none';
  viewSettings.style.display = 'none';
  
  document.querySelectorAll('.sidebar__nav-item').forEach(el => el.classList.remove('sidebar__nav-item--selected'));

  if (hash.startsWith('#album/')) {
    const key = decodeURIComponent(hash.substring(7));
    if (library.albums && library.albums.length > 0) {
      renderAlbumView(key);
    }
    viewAlbum.style.display = 'block';
  } else if (hash === '#settings') {
    renderSettingsView();
    viewSettings.style.display = 'flex';
  } else if (hash.startsWith('#artist/')) {
    const name = decodeURIComponent(hash.substring(8));
    if (library.artists && library.artists.length > 0) {
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

/** Hue in degrees, saturation and lightness as fractions. */
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, sat, l];
}

/**
 * Lightness for an artwork-derived accent, as a percentage.
 *
 * The reference fixes this at 46%, which reads well for the reds and pinks its
 * catalogue tends to produce. It does not hold for every hue: at 46% an orange
 * gives white text only 3.7:1, under the 4.5:1 needed to stay legible. So 46%
 * is the starting point and the colour is darkened only for the hues that fall
 * short — yellows need to go a good deal darker — which leaves most albums
 * matching the reference exactly.
 */
function accentLightness(hue) {
  const white = 1.05;
  for (let l = 46; l >= 20; l -= 2) {
    const [r, g, b] = hslToRgb(hue, 0.82, l / 100);
    const channel = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    const lum = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    if (white / (lum + 0.05) >= 4.5) return l;
  }
  return 20;
}

function hslToRgb(h, s, l) {
  h /= 360;
  const hue = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)].map((x) => Math.round(x * 255));
}

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
        
        // Keep only the HUE of the artwork and rebuild the colour at a fixed
        // saturation and lightness, which is what the reference does — measured
        // off its album pages as hsl(H 82% 46%).
        //
        // Averaging pixels and using the result directly is what produced a pale
        // peach that white text vanished against. Clamping S and L cannot: every
        // album gets a colour of its own hue that is always readable.
        const [h] = rgbToHsl(r, g, b);
        resolve(`hsl(${Math.round(h)} 82% ${accentLightness(h)}%)`);
      } catch (e) {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// Queueing and copying produce no visible result on their own, so the button
// acknowledges the press rather than leaving you wondering if it registered.
function flashButton(btn) {
  btn.classList.add('is-flashed');
  setTimeout(() => btn.classList.remove('is-flashed'), 450);
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
  if (!library.tracks || library.tracks.length === 0) return;
  
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
    const albums = hideSingles ? library.albums.filter(a => a.tracks.length > 1) : [...library.albums];
    
    // Sort
    albums.sort((a, b) => {
      if (currentLibSort === 'Name') return a.album.localeCompare(b.album);
      if (currentLibSort === 'Artist') return a.albumArtist.localeCompare(b.albumArtist) || a.album.localeCompare(b.album);
      if (currentLibSort === 'Year') return (b.year || 0) - (a.year || 0);
      return 0; // Recently added might just be order in DB/library
    });
    
    libCountLine.textContent = `${albums.length} album${albums.length !== 1 ? 's' : ''}`;
    
    const grid = document.createElement('div');
    grid.className = 'lib-grid--albums';
    for (const a of albums) {
      grid.appendChild(makeShelfCard(a));
    }
    libContent.appendChild(grid);
    
  } else if (currentLibView === 'artists') {
    const artists = [...library.artists];
    
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
    songsToRender = [...library.tracks];
    
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
          // Play from this library context
          playerState.originalQueue = songsToRender;
          playerState.queue = playerState.shuffle ? seededShuffle([...playerState.originalQueue]) : [...playerState.originalQueue];
          const newIdx = playerState.queue.indexOf(r);
          playTrack(newIdx);
        });
        frag.appendChild(row);
        
        // cover
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

window.__DEBUG_LIBRARY = function() { return library; };

// ── Artist View ──────────────────────────────────────────────

async function renderArtistView(name) {
  const artist = library.artists.find(a => a.name.toLowerCase() === name.toLowerCase());
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

  if (artist.albums.length > 0) {
    const url = await coverUrlForAlbum(artist.albums[0]);
    if (url) {
      bg.style.backgroundImage = `url(${url})`;
      const accent = await getCoverAccent(url);
      if (accent) {
        viewArtist.style.setProperty('--album-accent', accent);
      }
    }
  }

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
    const album = library.albums.find(a => albumKey(a) === rAKey);
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
  const numSongs = library.tracks ? library.tracks.length : 0;
  const numAlbums = library.albums ? library.albums.length : 0;
  const numArtists = library.artists ? library.artists.length : 0;
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
          library = { tracks: [], albums: [], artists: [] };
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

// Lyrics toggle
const npLyricsToggle = document.getElementById('np-lyrics-toggle');
const npRight = document.querySelector('.now-playing__right');
npLyricsToggle.addEventListener('click', () => {
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
  lyricsOffset -= 250;
  setLyricsOffset(record.path, lyricsOffset);
  updateSyncLabel();
});

document.getElementById('np-sync-plus').addEventListener('click', () => {
  const record = playerState.queue[playerState.index];
  if (!record) return;
  lyricsOffset += 250;
  setLyricsOffset(record.path, lyricsOffset);
  updateSyncLabel();
});




// 6. Menu popover
const npMenuBtn = document.getElementById('np-menu-btn');
const npMenu = document.getElementById('np-menu');

npMenuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  npMenu.style.display = npMenu.style.display === 'none' ? 'block' : 'none';
});

function closeNpMenu() {
  npMenu.style.display = 'none';
}

document.addEventListener('click', (e) => {
  if (!npMenu.contains(e.target) && e.target !== npMenuBtn) {
    closeNpMenu();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeNpMenu();
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
    case 'show-library': {
      npOverlay.classList.remove('is-open');
      closeNpMenu();
      window.location.hash = '#library';
      break;
    }
  }
});
