// Playlists.
//
// Stored as track paths rather than track objects: the library is rebuilt on
// every re-index and objects from an old build would go stale, while a path
// still resolves. A path that no longer resolves is dropped at read time, so a
// deleted file leaves no ghost row.

import { state } from './state.js';

const KEY = 'aubade_playlists';

/** @returns {{id:string,name:string,created:number,paths:string[]}[]} */
export function allPlaylists() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function save(list) {
  localStorage.setItem(KEY, JSON.stringify(list));
}

export function getPlaylist(id) {
  return allPlaylists().find((p) => p.id === id) || null;
}

export function createPlaylist(name) {
  const list = allPlaylists();
  const playlist = {
    // Date plus a random tail: two playlists made in the same millisecond
    // would otherwise share an id and the second would overwrite the first.
    id: 'pl' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: (name || '').trim() || 'New Playlist',
    created: Date.now(),
    paths: [],
  };
  list.push(playlist);
  save(list);
  return playlist;
}

export function renamePlaylist(id, name) {
  const list = allPlaylists();
  const p = list.find((x) => x.id === id);
  if (!p) return false;
  p.name = (name || '').trim() || p.name;
  save(list);
  return true;
}

export function deletePlaylist(id) {
  save(allPlaylists().filter((p) => p.id !== id));
}

/**
 * Add tracks, skipping ones already there.
 * @returns the number actually added, so the caller can say something true.
 */
export function addToPlaylist(id, paths) {
  const list = allPlaylists();
  const p = list.find((x) => x.id === id);
  if (!p) return 0;
  const have = new Set(p.paths);
  const fresh = paths.filter((path) => !have.has(path));
  p.paths.push(...fresh);
  save(list);
  return fresh.length;
}

export function removeFromPlaylist(id, path) {
  const list = allPlaylists();
  const p = list.find((x) => x.id === id);
  if (!p) return false;
  const before = p.paths.length;
  p.paths = p.paths.filter((x) => x !== path);
  save(list);
  return p.paths.length !== before;
}

/**
 * The playlist's tracks, in the order they were added.
 *
 * Paths that no longer resolve are skipped rather than returned as holes — the
 * library may have been re-indexed since, or the file deleted.
 */
export function playlistTracks(id) {
  const p = getPlaylist(id);
  if (!p) return [];
  const byPath = new Map((state.library.tracks || []).map((t) => [t.path, t]));
  return p.paths.map((path) => byPath.get(path)).filter(Boolean);
}

/** How many of a playlist's paths still resolve, for the sidebar's subtitle. */
export function playlistCount(id) {
  return playlistTracks(id).length;
}
