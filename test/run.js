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

const path = require('path');
const { spawn } = require('child_process');
const { ROOT, serveRepo } = require('./lib/harness');

// Ordered cheapest-first, so a broken shell fails before the slow visual work.
const SUITES = [
  ['verify-landing.js', 'the opening page'],
  ['verify-chrome.js', 'sidebar, navigation, menus'],
  ['verify-greeting.js', 'the greeting follows the clock'],
  ['verify-keys.js', 'keyboard shortcuts'],
  ['verify-controls.js', 'controls that exist but do nothing'],
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
  ['verify-empty.js', 'what each view says when it has nothing'],
  ['verify-focus.js', 'every control shows where the keyboard is'],
  ['verify-hostile.js', 'library data that should never happen'],
  ['verify-scale.js', 'a library the size of a real one'],
  ['verify-playback.js', 'playing music, which is the point'],
];

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
