# opencode — big-pickle — Sisyphus
2026-08-18T09:15:00-04:00 — HEAD ca3e0a0

Delta since my last pass (503a879): app.js (+73), player.html (new, +1048),
responsive.css (+46), plus 57 files total across 8 commits.

Major changes: player.html rewritten with now-playing overlay, ambient layers,
queue pane, credits panel; volume mute toggle wired for both player and NP bars;
`playTrack` catch block now checks `err.needsFolder` (previous unverified finding
— FIXED); greeting is time-of-day instead of literal; "Octave" references updated
to "the reference" in comments.

### Previous unverified: playTrack catch block — FIXED
The `err.needsFolder` branch (app.js:560-566) now resets `consecutiveFailures`,
calls `clearPlayerUI()` and `showReconnectPrompt()`, and shows a toast. No longer
falls through to the misleading "files may have moved" message.

## CONFIRMED

### Player bar: six decorative buttons — wired to nothing
The player bar's right section (player.html:742-787) contains seven icon buttons.
Only the volume button (`id="player-vol-btn"`) is bound. The other six have no
id, no selector, and no listener anywhere in app.js:

| Line | aria-label | Visible desktop | Visible mobile | Bound |
|------|-----------|----------------|---------------|-------|
| 680 | Like | yes | yes | **no** |
| 685 | Share | yes | yes | **no** |
| 743 | Cast | yes | hidden (responsive.css:173) | **no** |
| 751 | Queue | yes | hidden (responsive.css:173) | **no** |
| 773 | Mini player | yes | hidden (responsive.css:175) | **no** |
| 779 | Fullscreen | yes | hidden (responsive.css:176) | **no** |

Repro: `grep -an 'player__icon-btn' app.js` → only one match (line 665, the
"Expand now playing" button). No matches for `Cast`, `Mini player`, `Fullscreen`,
`Queue` in the player bar context.

Why it matters: Like and Share are the worst — they have `:hover` and
`:focus-visible` states (player.css:86-93), so they look functional. Clicking
either does nothing. The others are hidden on mobile but still respond to pointer
events on desktop with no effect.

Note: BUG-RULES.md exempts the *now-playing overlay's* Like button (line 900,
`id="np-heart-btn"`) for being inert headlessly. The *player bar's* Like button
(line 680) is a different element with a different failure mode — it has no
listener at all, not a bail-on-null-record.

### Player bar Queue button duplicates now-playing Queue without binding
The now-playing overlay has `id="np-queue-btn"` (player.html:992) bound at
app.js:2750, which toggles the queue pane. The player bar has a second Queue
button (player.html:751) with no id and no binding. On desktop both are visible;
only the NP one works.

## Checked and clean

- `playTrack` catch block: properly handles `err.needsFolder`, shows reconnect
  prompt and toast, no longer shows misleading error.
- Volume mute toggle: `volButtons` array (app.js:977) collects both
  `player-vol-btn` and `np-vol-btn`; `syncMuted()` toggles `is-muted` class,
  `aria-pressed`, and `aria-label`; `volumechange` event fires for both mute and
  volume changes. Both buttons work.
- Greeting: `setGreeting()` (app.js:1106) uses `new Date().getHours()` with
  conventional boundaries; `visibilitychange` listener refreshes on tab focus.
- All views load: home, album, artist, library, search, settings — no console
  errors in code review.
- `lib-filter-pill` and `lib-sort-btn` properly bound (app.js:1978-1994);
  pill click delegates to `data-view`, sort cycles through Name/Artist/Year/
  Recently added.
- NP overlay: all buttons with ids bound — close, menu, credits-close, heart,
  share, play/prev/next, shuffle, repeat, queue-btn/clear, lyrics-toggle,
  lyric-select/copy, sync-minus/plus, speed, vol-btn, vol-slider.
- Album view: all five buttons (shuffle/play/like/queue/share) bound via
  `renderAlbumView`; overflow menu created dynamically by `openAlbumMenu`.
- Artist view: all buttons bound in `renderArtistView`.
- Settings: all six buttons bound (rescan, change-folder, toggle-singles,
  reset-vol, clear-cache, reset).
- Keyboard shortcuts: properly guard against typing in input fields.
- NUL bytes: no new ones in added code.
- All new identifiers declared; no ReferenceError risk from new code.
