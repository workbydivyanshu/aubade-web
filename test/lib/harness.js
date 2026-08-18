// Shared ground for the suites: where the app is being served, and the
// fixture library they all start from.
'use strict';

// run.js serves the repo on an ephemeral port and passes it in. Set it by
// hand to point a single suite at a server you already have running.
const BASE_URL = process.env.AUBADE_URL || 'http://localhost:5199';

// 60 albums across 12 artists, 12 tracks each, no cover data. Deliberately
// larger than one screen, so shelves have to scroll and the library has to
// paginate rather than fitting whole.
function seedLibrary() {
  const ARTISTS = ['Olivia Rodrigo', 'Noah Kahan', 'Billie Eilish', 'Portishead', 'Radiohead',
    'Spice Girls', 'JAY-Z', 'Britney Spears', 'Amerie', 'Tinashe', 'Kylie Minogue', 'Logic'];
  const TITLES = ['SOUR', 'GUTS', 'Stick Season', 'Happier Than Ever', 'Dummy', 'In Rainbows',
    'Spice', 'The Blueprint', 'Blackout', 'Touch', 'Aquarius', 'Fever'];
  const albums = [], tracks = [];
  for (let i = 0; i < 60; i++) {
    const artist = ARTISTS[i % ARTISTS.length];
    const title = TITLES[i % TITLES.length] + (i >= TITLES.length ? ' ' + (1 + Math.floor(i / TITLES.length)) : '');
    const key = artist.toLowerCase() + '\0' + title.toLowerCase();
    const t = [];
    for (let j = 0; j < 12; j++) {
      const rec = {
        path: artist + '/' + title + '/' + (j + 1) + ' track.opus',
        title: ['brutal', 'traitor', 'drivers license', 'deja vu', 'good 4 u', 'happier',
          'jealousy', 'favorite crime', 'hope ur ok', 'enough for you', 'baby', 'roads'][j],
        artist, albumArtist: artist, album: title,
        track: j + 1, disc: 1, year: 2000 + (i % 25),
        duration: 130 + ((i * j) % 200), hasCover: false,
      };
      t.push(rec); tracks.push(rec);
    }
    albums.push({ key, album: title, albumArtist: artist, year: 2000 + (i % 25), tracks: t });
  }
  const artists = [...new Set(ARTISTS)].map((name) => ({
    name, albums: albums.filter((a) => a.albumArtist === name),
  }));
  return { tracks, albums, artists };
}

// Write a library straight into the store the app reads on boot. The folder
// picker cannot be driven headlessly, and the tag reader is not what these
// suites are testing. Callers reload the page afterwards.
function seed(page, library) {
  return page.evaluate((lib) => new Promise((resolve, reject) => {
    const open = indexedDB.open('aubade', 2);
    open.onerror = () => reject(open.error);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('handles')) db.createObjectStore('handles');
      if (!db.objectStoreNames.contains('library')) db.createObjectStore('library');
    };
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('library', 'readwrite');
      tx.objectStore('library').put(lib, 'index');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
  }), library || seedLibrary());
}

module.exports = { BASE_URL, seedLibrary, seed };
