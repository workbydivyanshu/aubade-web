// ── IndexedDB (aubade / handles) ────────────────────────────
// FileSystemDirectoryHandle is structured-cloneable, so it stores
// directly — never JSON-serialise it.

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('aubade', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('handles');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('handles', 'readonly');
    const req = tx.objectStore('handles').get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbSet(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').put(value, key);
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

// ── Track store ─────────────────────────────────────────────

let tracks = [];
export function getTracks() { return tracks; }

async function scanDir(dirHandle, statusEl) {
  tracks = [];
  let count = 0;
  let lastUpdate = 0;

  for await (const entry of walkDir(dirHandle)) {
    tracks.push(entry);
    count++;
    const now = Date.now();
    if (now - lastUpdate > 200) {
      statusEl.textContent = `Scanning… ${count} files`;
      lastUpdate = now;
    }
  }

  statusEl.textContent = `${count} songs`;
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
  await scanDir(dirHandle, statusEl);
}

function showReconnect(handle) {
  const btn = document.createElement('button');
  btn.className = 'reconnect-btn';
  btn.textContent = 'Reconnect music folder';
  btn.addEventListener('click', async () => {
    const perm = await handle.requestPermission({ mode: 'read' });
    if (perm === 'granted') {
      btn.remove();
      await scanDir(handle, statusEl);
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

  const handle = await dbGet('musicDir');
  if (!handle) return;  // no folder yet — page looks exactly as before

  const perm = await handle.queryPermission({ mode: 'read' });
  if (perm === 'granted') {
    await scanDir(handle, statusEl);
  } else {
    // perm === 'prompt'. Do NOT auto-request — browsers reject
    // permission requests without a user gesture.
    showReconnect(handle);
  }
}

init();
