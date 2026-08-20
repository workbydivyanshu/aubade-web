// Shared ground for the suites: where the app is being served, and the
// fixture library they all start from.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

// run.js serves the repo on an ephemeral port and passes it in. Set it by
// hand to point a single suite at a server you already have running.
const BASE_URL = process.env.AUBADE_URL || 'http://localhost:5199';

// The root is the page that introduces the app; the app itself is one
// file along from it. Suites that drive the player want this one.
const PLAYER_URL = BASE_URL + '/player.html';

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

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

// Serve the repository on an ephemeral port. Nothing needs to be running
// first, and a run cannot collide with a dev server already on 5199.
const ROOT = path.join(__dirname, '..', '..');

function serveRepo() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    let file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
    // Anything resolving outside the repo is a bad request, not a 404 —
    // saying "not found" would be a lie about a file that exists.
    if (!path.resolve(file).startsWith(ROOT + path.sep)) {
      res.writeHead(403).end('outside the repo');
      return;
    }
    fs.stat(file, (err, st) => {
      if (!err && st.isDirectory()) file = path.join(file, 'index.html');
      fs.readFile(file, (err2, body) => {
        if (err2) { res.writeHead(404).end('not found'); return; }
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
          'Cache-Control': 'no-store',
        });
        res.end(body);
      });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => server.close(),
      });
    });
  });
}

/**
 * Answer the app's own ask() dialog, which replaced window.prompt and
 * window.confirm. Suites used to hook page.on('dialog'); that hook is silent
 * against an in-page dialog, so every one of them passed a click through to
 * nothing and reported the feature broken.
 *
 * Pass text for a question that wants a name, nothing for a yes/no.
 */
async function answer(page, text) {
  await page.waitForSelector('.ask-scrim', { timeout: 4000 });
  if (text !== undefined) await page.fill('.ask__input', text);
  await page.click('[data-ask="ok"]');
  await page.waitForSelector('.ask-scrim', { state: 'detached', timeout: 4000 });
}

module.exports = { BASE_URL, PLAYER_URL, ROOT, seedLibrary, seed, serveRepo, answer };
