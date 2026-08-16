// Media keys, the lock screen, and the desktop's own now-playing widget.
//
// The transport functions are passed in rather than imported, so this module
// does not reach back into playback and playback does not have to know it
// exists.

import { state, SEEK_STEP_SECONDS } from './state.js';
import { albumKey } from './library.js';
import { coverUrlForAlbum } from './art.js';

let audio;
let transport = {};

// Without this the media keys, the lock screen and the desktop's own
// now-playing widget all do nothing, which is most of what separates a tab
// that plays audio from a music player.


function setupMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const handlers = {
    play: () => audio.play(),
    pause: () => audio.pause(),
    previoustrack: () => transport.prev(),
    nexttrack: () => transport.next(),
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



/** Wire MediaSession to an audio element and the transport it should drive. */
export function initMediaSession(audioEl, handlers) {
  audio = audioEl;
  transport = handlers;
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
}

export { updateMediaSession, updateMediaPositionState };

/** Stop advertising a track once playback has been cleared. */
export function clearMediaSession() {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = null;
  navigator.mediaSession.playbackState = 'none';
}
