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
 * Launch the engine the run asked for, defaulting to Chromium.
 *
 * Every suite used to name chromium directly, so the app was only ever proven
 * in one engine — and the one browser family that cannot use the File System
 * Access API at all is the one it was never run in. Firefox is not Safari, but
 * it is a second rendering engine and a real absence of that API rather than a
 * Chromium pretending.
 *
 * Chromium-only launch arguments are dropped for other engines rather than
 * passed and ignored, because Firefox treats an unknown argument as a fatal
 * command line.
 */
function launch(options = {}) {
  const pw = require('playwright');
  const engine = process.env.AUBADE_ENGINE || 'chromium';
  const type = pw[engine];
  if (!type) throw new Error('no such engine: ' + engine);
  const opts = { ...options };
  if (engine === 'chromium') {
    // The suites that need sound play a real tone. Headless Chromium has no
    // output device on CI but does on a desktop, and a test run has no
    // business coming out of the speakers.
    opts.args = [...(options.args || []), '--mute-audio'];
  } else {
    // Firefox treats an unknown command line argument as fatal, so Chromium's
    // are dropped rather than passed and ignored.
    delete opts.args;
    opts.firefoxUserPrefs = {
      ...(options.firefoxUserPrefs || {}),
      // Silence the output stage. The analyser taps the graph ahead of it, so
      // the visualiser still sees the signal it is being tested on — muting
      // the element itself would zero that too.
      'media.volume_scale': '0.0',
    };
    if ((options.args || []).some((a) => a.includes('autoplay'))) {
      opts.firefoxUserPrefs['media.autoplay.default'] = 0;
      opts.firefoxUserPrefs['media.autoplay.blocking_policy'] = 0;
    }
  }
  return type.launch(opts);
}

/** The engine this run is using, for suites that must say so in their output. */
const ENGINE = process.env.AUBADE_ENGINE || 'chromium';

/**
 * Permissions this engine will accept. Firefox rejects the whole context with
 * "Unknown permission" rather than ignoring one it does not implement, so a
 * suite asking for clipboard access cannot even open a page there. Dropping
 * them means the clipboard checks in that suite fail on their own terms, which
 * is the right way to find out an engine cannot do something.
 */
function permissions(wanted) {
  if (ENGINE === 'chromium') return wanted;
  return wanted.filter((p) => !p.startsWith('clipboard'));
}

/**
 * Stand in for the filesystem, which is the one thing a headless page cannot
 * have: no folder can be picked, so no track resolves, and every code path
 * that runs after a file opens — the player UI, the palette, the announcer —
 * is unreachable without this.
 *
 * The stub sits at the file boundary. dbGet is taught to hand back a fake
 * directory handle; everything above it is the real code.
 *
 * Returns a `patched` object the caller can assert on, so a rename in db.js
 * shows up as a failed check rather than as a suite that quietly tests
 * nothing.
 */
async function fakeFilesystem(page) {
  const patched = { db: false };
  await page.addInitScript(() => {
    // Thirty seconds of a quiet tone, built here so no fixture has to be
    // shipped. Long enough that a track does not run out while a suite is
    // between two checks, which made everything after the first one race.
    window.__aubadeWav = (secs = 30, freq = 440) => {
      const rate = 8000, n = rate * secs;
      const buf = new ArrayBuffer(44 + n * 2);
      const v = new DataView(buf);
      const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
      str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVEfmt ');
      v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
      v.setUint16(32, 2, true); v.setUint16(34, 16, true);
      str(36, 'data'); v.setUint32(40, n * 2, true);
      for (let i = 0; i < n; i++) {
        v.setInt16(44 + i * 2, Math.sin((2 * Math.PI * freq * i) / rate) * 8000, true);
      }
      return buf;
    };
    window.__aubadeFakeDir = {
      name: 'Test Music',
      queryPermission: async () => 'granted',
      requestPermission: async () => 'granted',
      async getDirectoryHandle() { return window.__aubadeFakeDir; },
      getFileHandle: async (name) => {
        // A real directory does not contain every file you ask it for. An
        // earlier version of this stub answered any name with audio, so the
        // app read the WAV as its .lrc sidecar and rendered the bytes as
        // lyrics — a fake world, and a bug that only existed inside it.
        // Lyrics only exist where a suite has asked for them, by setting
        // window.__aubadeLrc. Everything else with an .lrc name is absent,
        // the way a folder without sidecars is.
        if (/\.lrc$/i.test(name) && window.__aubadeLrc) {
          const text = window.__aubadeLrc;
          return { name, getFile: async () => new File([text], name, { type: 'text/plain' }) };
        }
        if (!/\.(opus|mp3|m4a|flac|ogg|wav|aac)$/i.test(name)) {
          throw Object.assign(new Error('not found: ' + name), { name: 'NotFoundError' });
        }
        // Files a suite has declared gone, and the error a folder whose
        // permission has lapsed throws instead. Both are ordinary and neither
        // could be reached before.
        //
        // Exact names, not substrings: getFileHandle is passed a bare file
        // name, so "1 track.opus" as a substring also takes out "11 track.opus"
        // and a check meant to lose one file quietly loses two. Use
        // __aubadeMissingAll for the every-file case.
        if (window.__aubadeMissingAll || (window.__aubadeMissing || []).includes(name)) {
          throw Object.assign(new Error('gone: ' + name), { name: 'NotFoundError' });
        }
        if (window.__aubadeDenied) {
          throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
        }
        return {
          name,
          // Real, decodable audio rather than a block of zeroes: with zeroes
          // the element sets MEDIA_ERR_SRC_NOT_SUPPORTED and every path that
          // runs after playback starts stays out of reach.
          getFile: async () => new File([window.__aubadeWav()], name, { type: 'audio/wav' }),
        };
      },
    };
  });
  await page.route('**/db.js', async (route) => {
    // route.fetch rejects if the page navigates while it is in flight, which
    // took down a whole run once. Falling through serves the unpatched module,
    // so the "stand-in still fits" check goes red instead — a named failure
    // rather than a stack trace, and never a suite that quietly tests nothing.
    let src;
    try {
      src = await (await route.fetch()).text();
    } catch {
      await route.continue().catch(() => {});
      return;
    }
    const marker = "export async function dbGet(key, storeName = 'handles') {";
    patched.db = src.includes(marker);
    await route.fulfill({
      headers: { 'content-type': 'text/javascript; charset=utf-8' },
      body: src.replace(marker, marker +
        "\n  if (key === 'musicDir' && window.__aubadeFakeDir) return window.__aubadeFakeDir;"),
    }).catch(() => {});
  });
  return patched;
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

module.exports = { BASE_URL, PLAYER_URL, ROOT, seedLibrary, seed, serveRepo, answer, fakeFilesystem, launch, ENGINE, permissions };
