## 2026-08-16T09:17:00-04:00 — kiro (f22e507)

Hostile-data pass. Commit f22e507 is a CSS split with no logic changes; the
renderArtistView crash found against 143f949 is still present.

CONFIRMED
- `renderArtistView` throws `TypeError: Cannot read properties of undefined (reading 'trim')` when an artist entry has an empty `albums` array. The crash is on line 2004 of app.js: `albumKey(artist.albums[0] || {})` — when `artist.albums[0]` is `undefined` the fallback `{}` has no `albumArtist` property, so `albumKey` blows up on `.trim()`. Repro: seed IDB with a library whose `artists` array contains `{ name: 'empty-artist', albums: [] }`, then navigate to `#artist/empty-artist`. Page throws. `buildLibrary` cannot produce this state through the normal code path (it always pushes at least one album per artist), but injected or corrupt IDB data can, and the error propagates silently — the artist view is displayed but blank. Verified with Playwright: `node ~/octave-capture/hostile-data.js` (scenario `case-diff-artists` injected `albums:[]` artists and confirmed the throw in a standalone script). Expected: graceful fallback to gradient by artist name. Got: uncaught TypeError.
  ```
  grep -an 'albumKey(artist.albums\[0\]' app.js
  # 2004:  const aKey = albumKey(artist.albums[0] || {});
  ```

UNVERIFIED
- Empty-string `albumArtist` / `album`: cards render with blank title and artist text, and a card with key `\0` is navigable. No crash observed, but the user-facing blank card is silent data loss if the real track title was simply missing from tags. Cannot confirm whether this is intentional fallback or silent drop without knowing what the indexer emits for tagless files.

Checked and clean:
- Empty library → #home-empty shown, no phantom album cards.
- Single album, one track → renders on home and library views.
- 300-char track title → clipped correctly in album track list (overflow hidden on .track-row__title).
- Emoji-only titles and RTL/CJK text → visible and correctly present in library view; no encoding loss.
- 5000 albums → home renders (32 cards), library renders all 5000, status line shows correct counts. Shelf rows overflow horizontally as intended (overflow-x: auto).
- Duplicate album keys (two albums with same case-folded key) → both entries visible in library.
- Two artists differing only by case → `buildLibrary` correctly merges them into one entry (first-encountered name wins, all albums attached). Not a bug.
- `now-playing__bg` scrollWidth > clientWidth: intentional — ambient circles are positioned with negative insets outside the clipped container. Not a bug.
- `content-frame` scrollHeight > clientHeight: it is the main scrollable content area (overflow-y: auto). Not a bug.
