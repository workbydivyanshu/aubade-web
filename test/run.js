#!/usr/bin/env node
// Runs every suite against a fresh copy of the app.
//
// It serves the repo itself on an ephemeral port rather than expecting a dev
// server to be up. That keeps a test run from depending on — or interfering
// with — whatever is already running on 5199, and means the suites can be run
// on a machine that has never had the app open.
//
//   node test/run.js                 every suite
//   node test/run.js responsive np   only suites whose name contains these
//   node test/run.js --verbose       show each suite's own output as it goes
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');

// Ordered cheapest-first, so a broken shell fails before the slow visual work.
const SUITES = [
  ['verify-chrome.js', 'sidebar, navigation, menus'],
  ['verify-keys.js', 'keyboard shortcuts'],
  ['verify-menu.js', 'track and album overflow menus'],
  ['verify-liked.js', 'liked songs'],
  ['verify-playlists.js', 'create, add, remove, missing files'],
  ['verify-escape-palette.js', 'Escape dismissal and palette reset'],
  ['verify-palette.js', 'colours recovered from cover art'],
  ['verify-np-full.js', 'now playing against the reference'],
  ['verify-eq.js', 'the visualiser reacts to real sound'],
  ['verify-responsive.js', 'both sides of the 768px breakpoint'],
  ['phone-views.js', 'every route at 390px'],
  ['verify-nofsapi.js', 'the no-File-System-Access path'],
];

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
      resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() });
    });
  });
}

function runSuite(file, url, verbose) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [path.join(__dirname, file)], {
      env: { ...process.env, AUBADE_URL: url },
      stdio: verbose ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    if (!verbose) {
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { out += d; });
    }
    child.on('close', (code) => resolve({ code, out, ms: Date.now() - started }));
  });
}

(async () => {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose');
  const filters = args.filter((a) => !a.startsWith('-'));
  const suites = filters.length
    ? SUITES.filter(([f]) => filters.some((q) => f.includes(q)))
    : SUITES;

  if (!suites.length) {
    console.error(`nothing matches ${filters.join(', ')}`);
    process.exit(1);
  }

  // One clear message beats twelve identical stack traces.
  try {
    require.resolve('playwright');
  } catch {
    console.error('playwright is not installed. From this directory:\n\n  npm install\n');
    process.exit(1);
  }

  const server = await serveRepo();
  console.log(`serving ${ROOT} at ${server.url}\n`);

  const failed = [];
  for (const [file, what] of suites) {
    const name = file.replace(/\.js$/, '');
    if (verbose) console.log(`── ${name} — ${what}`);
    const { code, out, ms } = await runSuite(file, server.url, verbose);
    const secs = (ms / 1000).toFixed(1) + 's';
    if (!verbose) {
      console.log(`  ${code === 0 ? 'ok  ' : 'FAIL'}  ${name.padEnd(24)} ${what.padEnd(42)} ${secs}`);
    }
    if (code !== 0) failed.push([name, out]);
  }

  server.close();

  for (const [name, out] of failed) {
    if (out) console.log(`\n── ${name} ${'─'.repeat(Math.max(0, 60 - name.length))}\n${out.trim()}`);
  }

  const passed = suites.length - failed.length;
  console.log(`\n${passed}/${suites.length} suites passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
