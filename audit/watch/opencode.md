# opencode — big-pickle — Sisyphus
2026-08-17T12:15:00-04:00 — HEAD d1270b0

Delta since my last pass (584cd6b): app.js (+40), index.html (+41/-1), playlists.js (-5),
nowplaying.css (+5), responsive.css (new, +303). Both confirmed findings from pass 8 are
fixed, and both unverified items from pass 8 are fixed. Nothing new appeared.

### Previous confirmed: Escape does not close #album-menu — FIXED
app.js:2721 now has `document.getElementById('album-menu')?.remove()` in the global
keydown Escape handler. Verified at this hash.

### Previous confirmed: playlistCount dead export — FIXED
Removed from playlists.js entirely. No call sites exist in any file:
`grep -a -rn 'playlistCount' --include='*.js' --include='*.html' .` → (empty).

### Previous unverified: palette-stale when cover yields no palette — FIXED
app.js:732 now clears all NP_PALETTE_PROPS via `removeProperty` when `getCoverPalette`
returns null, instead of silently returning. Verified at this hash.

### Previous unverified: view-settings duplicate inline display — FIXED
index.html:565 had `style="display: none; ...; display: flex; ..."` — the second
declaration silently overwrote the first. Now reads `style="display: none; ...;
flex-direction: column; align-items: center;"` — no duplicate. Verified at this hash.

## Unverified

- `--tab-bar-h` CSS variable declared in responsive.css:38 (`70px`) but never referenced
  anywhere in the codebase (`grep -ra 'tab-bar-h' *.css *.js *.html` → only the declaration).
  Cosmetic dead code, not a runtime issue. The tab bar's actual size is driven by
  `block-size: 65px` on `.tab-bar`.

## Checked and clean

- All six views load with zero diagnostics via the harness:
  `node ~/octave-capture/audit.js aubade <home|album|artist|library|search|settings>`
  all exit 0 with no error/exception/failed/timeout lines.
- `verify-keys.js` — keyboard shortcuts, typing does not fire shortcuts: all pass.
- `verify-menu.js` — 9 menu items, box 248×373, all actions verified: pass.
- `verify-liked.js` — 5→4→0 rows, stats update, empty state with "No songs yet": pass.
- `verify-eq.js` — 7 bars respond to frequency sweep, is-live flag correct: pass.
- `verify-np-full.js` — all 13 now-playing elements present and sized: pass.
- `verify-chrome.js` — sidebar collapse, album menu outside-click, removed controls absent: pass.
- `verify-playlists.js` — create, add album, duplicate guard, remove, missing-file skip: pass.
- All import/export graphs match: `NP_PALETTE_PROPS` (new const, app.js:561), `syncTabBar`
  (new function, app.js:974) both declared locally and not exported. `playlistCount` removed
  from playlists.js with no remaining references.
- No new identifiers used but undeclared. No imports referencing removed exports.
