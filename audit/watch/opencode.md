# opencode — deepseek-v4-flash-free — bug-watch agent
2026-08-17T07:53:44-04:00 — HEAD 584cd6b ("Tell agents to leave the dev server alone")

Delta since my last pass (77fa821): only AGENTS.md (+7/-1). No scope file changed —
`git diff --stat 77fa821..584cd6b` lists AGENTS.md alone, and `app.js` is byte-identical
(sha256 e94bb604... for both `git show 77fa821:app.js` and `git show 584cd6b:app.js`).
The live server serves the committed code (same sha256). Per BUG-HUNT.md I still ran the
checklist at this hash; everything previously reported stands, nothing new appeared.

### Escape does not close the #album-menu popover (re-confirmed at this hash)
severity:  wrong-behaviour
proof:     `node /tmp/opencode/repro-escape-menu.js` (seeds library, opens album page,
           clicks .album-btn--more, presses Escape), actual output:
           after click, #album-menu: {"exists":true,"display":"block"}
           after Escape, #album-menu: {"exists":true,"display":"block","visible":true}
           Element existence in tree: `grep -an 'album-menu' app.js` → lines 2377, 2380
           (both inside openAlbumMenu; no other reference).
repro:     1. Load http://localhost:5199 with a seeded library.
           2. Open any album page, click the "more" button (.album-btn--more).
           3. Press Escape.
           4. Expected: menu closes — Escape closes npMenu, np-credits and the shortcuts
              panel in the same handler. Got: `#album-menu` still present, display:block,
              offsetWidth/Height > 0.
why:       The keydown handler at app.js:2687-2693 (`if (e.key !== 'Escape') return;
           closeNpMenu(); np-credits close; shortcuts remove`) never references
           #album-menu. The menu only closes on outside click (app.js:2681-2685) or
           item click. Affects all four openAlbumMenu call sites (album page, playlist,
           artist, np-menu add-playlist). Unchanged since my pass 8 report; app.js is
           byte-identical to the hash that finding was verified against.

### playlistCount is exported but never called (dead export, carried from pass 7)
severity:  cosmetic
proof:     `grep -a -rn 'playlistCount' --include='*.js' --include='*.html' .` →
           ./playlists.js:97:export function playlistCount(id) {   (only hit)
repro:     The grep above; there is no call site in any file.
why:       playlists.js:97 defines playlistCount with a doc comment claiming it exists
           "for the sidebar's subtitle", but renderPlaylistSidebar (app.js:1140)
           computes `playlistTracks(p.id).length` inline. Same class as the
           getLyricsOffset dead code fixed in pass 1. Harmless at runtime (no caller),
           but the function and its comment describe something that does not happen.

## Unverified

- Palette-stale when a cover has no detectable palette (carried from passes 4-8,
  code unchanged): `if (!pal) return;` at app.js:724 leaves the previous track's
  --np-accent/--np-c1..c4/--np-bg on the now-playing scrim when getCoverPalette
  resolves null (greyscale / near-black / near-white covers, art.js:196,209, or
  image-load failures, art.js:254). The removal loop at app.js:733-735 runs only when
  `url` itself is null. Verified the code is exactly as reported at this hash; still
  cannot be demonstrated headlessly (no covers load under File System Access denial).

- view-settings duplicate inline display at index.html:526:
  `style="display: none; ...; display: flex; ..."` — the later declaration wins, so
  the effective inline display is flex from page load. Introduced in 35b0c72 and
  never removed (`git log -S 'display: flex; flex-direction: column; align-items:
  center' -- index.html` shows only 35b0c72). Inert on Chromium in the normal path
  because handleRoute always sets display:none first (app.js:890-893); live only on
  the no-showDirectoryPicker early return (app.js:352-355) and as a pre-init paint
  flash. Could not establish a visible failure headlessly.

## Checked and clean

- All six views load with zero diagnostics via the harness:
  `node ~/octave-capture/audit.js aubade <home|album|artist|library|search|settings>`
  all exit 0 with no error/exception/failed/timeout lines.
- No new identifiers/imports/export mismatches possible: no scope file changed since
  my pass 8 scan, which cleared every module's import graph, the `[hidden]`
  display guard (shell.css:911), walkDir recursion bounds, the consecutiveFailures
  skip guard, and the worker's string albumArtist/album fallbacks.
