## 2026-08-15T19:07:08-0400 — opencode

CONFIRMED
- `getLyricsOffset(trackPath)` is defined but never called (dead code, app.js:2682). Its sibling `setLyricsOffset` is called at app.js:2706 and app.js:2714, and `loadLyrics` re-implements the same lookup inline at app.js:1643 instead of calling it. Repro: `grep -a -n 'getLyricsOffset' app.js` returns only the definition line (must use `grep -a` — NUL bytes). Expected: at least one call site; got: zero.

UNVERIFIED
- index.html (outside the seven-file scope): home shelves/hero/quick-grid ship hardcoded seed albums ("Midnight Sun — Ayla Park", "Petal — Ariana Grande", …) with no `data-album` attribute, and `#view-settings` carries duplicate inline `display: none; … display: flex;` (flex wins). On a fresh profile with an empty library, `renderHome` returns early (app.js:234) without clearing the shelves, so the fake content stays visible and inert; could not establish the runtime effect headlessly because `handleRoute` masks both issues in the normal path.

Checked and clean: `walkDir` recursion is bounded by directory depth (app.js:17-30); the playTrack→nextTrack skip loop is bounded by `consecutiveFailures >= 3 || >= queue.length` (app.js:480, app.js:544) — the earlier unbounded-skip bug is fixed; `clearPlayerUI` is declared (app.js:774) and its fix is commented — no undeclared-variable use found anywhere in the seven files; no function sets `style.display` on an element toggled by the `hidden` attribute (liked-empty, shelf-played and np-queue are all toggled via `.hidden` only; `.np-queue[hidden]{display:none}` guards it at app.css:2710); art.js, colour.js, db.js, lrc.js, library.js, indexer.worker.js all read clean — every export exists and is consumed, and the worker always emits string `albumArtist`/`album`, so the unguarded `.trim()` at the go-album menu item is unreachable in practice.

Note: the working tree was being modified during this run (uncommitted marquee work; app.js grew 2846 → 2885 lines mid-audit). Line numbers are as of this timestamp.
