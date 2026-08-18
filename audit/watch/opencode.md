# opencode — big-pickle — Sisyphus
2026-08-18T06:42:40-04:00 — HEAD 503a879

Delta since my last pass (d1270b0): app.js (+148), landing.html (+210), landing.css (+528),
responsive.css (+31), test/ (+12 files, +6300), README.md (+149), shots/ (+2 images),
test/hooks/pre-commit (+17).

Major changes: Firefox/Safari fallback path (`pickFolderFallback`, `sessionFiles`,
`resolveTrackFile`, `showReconnectPrompt`), `landing.html`/`landing.css` opening page,
entire `test/` suite ported from `~/octave-capture` into the repo behind `test/run.js`,
responsive.css phone home page changes (greeting-row wrap, quick-grid 2-col).

### Previous unverified: --tab-bar-h dead CSS variable — FIXED
responsive.css now defines `--tab-bar-h: 70px` (line 41) and `--tab-bar-gap: 28px` (line 42),
both consumed at lines 62 and 154 in `calc()` expressions. The magic number 98 that was
previously hardcoded has been decomposed into `var(--tab-bar-h) + var(--tab-bar-gap)`.
Verified: `grep -rn 'tab-bar-h' *.css` → declaration + 2 usages.

### Test suite ported from ~/octave-capture: parity confirmed
Compared 12 ported suites against their originals. The only differences are:
1. Import mechanism: `eval(fs.readFileSync(...))` → `require('./lib/harness')`
2. `seedLibrary` and `seed` functions moved to `test/lib/harness.js`
3. `phone-views.js` has additional overflow/spilling/truncated checks (new features)
Test logic (what each suite asserts) is preserved. `node test/run.js` → 13/13 pass.

### landing.html / landing.css: clean
Pure HTML, no JavaScript. References `tokens.css`, `landing.css`, `index.html`,
`shots/desktop.webp`, `shots/phone.webp` — all exist. Scoped under `.lp` class.
No script tags, no event listeners, no DOM manipulation. No bugs found.

### responsive.css phone home page: clean
Greeting row now wraps (`flex-wrap: wrap`), `greeting-row__text` drops to 30/36,
quick-grid drops to 2 columns at `max-width: 767.98px`. Both selectors exist in
index.html. Measurements match the reference. No layout regressions found.

### New code: Firefox/Safari fallback path — clean
- `sessionFiles` Map (line 350): declared, populated in `pickFolderFallback`, checked in `resolveTrackFile`.
- `resolveTrackFile` (line 327): checks sessionFiles first, then directory handle. Throws with
  `needsFolder: true` when neither is available.
- `pickFolderFallback` (line 372): uses `<input webkitdirectory>`, populates sessionFiles and entries.
- `showReconnectPrompt` (line 433): creates reconnect button, calls `pickFolder()` on click.
- `init()` (line 445): no-FS-API path loads library from IndexedDB, shows reconnect prompt, routes.
- `HAS_FS_ACCESS` (line 321): `'showDirectoryPicker' in window`. Used in pickFolder and resolveTrackFile.
- All identifiers declared, all imports/exports aligned, no ReferenceError risk.

## Unverified

- `playTrack` catch block (line 558) does not check `err.needsFolder`. When a no-FS-API user
  has not reconnected the folder and tries to play, the error "Folder not connected" is caught
  and after 3 failures shows "Could not play these files. They may have moved or been renamed"
  — a misleading message for this case. Not a crash; the reconnect prompt is visible. Cosmetic UX.

## Checked and clean

- All six views load with zero diagnostics: audit.js for home|album|artist|library|search|settings
  all exit 0.
- `verify-keys.js` — keyboard shortcuts, typing does not fire shortcuts: pass.
- `verify-menu.js` — 9 menu items, box 248×373, all actions verified: pass.
- `verify-liked.js` — 5→4→0 rows, stats update, empty state with "No songs yet": pass.
- `verify-eq.js` — 7 bars respond to frequency sweep, is-live flag correct: pass.
- `verify-np-full.js` — all 13 now-playing elements present and sized: pass.
- `verify-chrome.js` — sidebar collapse, album menu outside-click, removed controls absent: pass.
- `verify-playlists.js` — create, add album, duplicate guard, remove, missing-file skip: pass.
- `verify-nofsapi.js` — app renders, routes, reconnect prompt offered: pass.
- `verify-escape-palette.js` — Escape dismissal and palette reset: pass.
- `verify-palette.js` — colours recovered from cover art: pass.
- `verify-responsive.js` — both sides of the 768px breakpoint: pass.
- `phone-views.js` — every route at 390px: pass.
- `verify-landing.js` — the opening page: pass.
- All import/export graphs match. No new identifiers used but undeclared.
- No listeners bound to nonexistent elements. `home-empty-pick` exists at index.html:220.
- No actual NUL bytes in new code (the `M-bM-^@M-^T` in comments are UTF-8 em dashes).
