# Bug watch — kilo

## 2026-08-15T19:18:11-04:00 — kilo

CONFIRMED
- 8 literals in app.css duplicate token values defined in tokens.css (all currently
  match, so no live visual gap yet, but this is the Batch-1 drift pattern). Repro:
  `grep -nE 'border-radius: (14|20|24|9999px)|background: #1c1c20' app.css`
  then `grep -nE 'radius-art-sm|radius-pill|radius-tile|radius-art-lg|surface-3' tokens.css`.
  Expected var(--radius-*)/var(--surface-3), got literals:
  app.css:76 `14px` (== --radius-art-sm), :416/:438/:445/:579 `9999px` (==
  --radius-pill), :817 `20px` (== --radius-tile), :1124 `24px` (== --radius-art-lg),
  :131 `#1c1c20` (== --surface-3).

UNVERIFIED
- Per-element contrast could not be computed for text rendered over translucent
  gradient/tinted cards: the harness records only bodyBackground (rgb(0,0,0)).
  Verified the only flat-colour text below 4.5 is --text-dim #6b6b76 @3.99, which
  the reference uses identically, so no aubade-only contrast regression was established.

Checked and clean: horizontal overflow on home (shelf-card__ boxes sit inside
.shelf__row {overflow-x:auto}; scroll content, not layout overflow), album/artist
header bg (scale(1.4) inside .album-header/.artist-header {overflow:hidden}, clipped,
not visible), text clipping/wrapping (remaining truncation is intentional
text-overflow:ellipsis; no unintended wrap at 1100–1600px), contrast (matches
reference; oklab/rgba(0,0,0,0) 1.00 readings were parser artifacts on tinted
surfaces), responsive breakpoints 1100/1280/1440/1600px (quick-grid 4-col and
scroll shelves stable, no breakage). The reference settings captured via extended
navigation timeout (harness default 30s networkidle timed out on the live site).

## 2026-08-16T08:02:46-04:00 — kilo  ·  commit 2c1ce5c

CONFIRMED
- 2 literals in app.css duplicate tokens.css at this commit (app.css is
  committed-clean; WIP edits are to app.js/index.html/etc., not app.css). Repro:
  `grep -nE 'border-radius: (20|24)px' app.css` then `grep -nE 'radius-tile|radius-art-lg' tokens.css`.
  Expected var(--radius-tile)/var(--radius-art-lg); got literals:
  app.css:817 `.player__cover` 20px (== --radius-tile, tokens.css:83) and
  app.css:1124 `.album-btn--play` 24px (== --radius-art-lg, tokens.css:81). Both
  currently match their token (no live divergence), but e2e7be7 left them as
  literals; the other six reported duplicates were already converted to var().

UNVERIFIED
- Per-element contrast on translucent/gradient/ambient surfaces was not computable
  (harness records only bodyBackground). The only flat-colour text below 4.5 on
  black is --text-dim #6b6b76 @3.99, which the reference renders identically, so no
  aubade-only contrast regression was established.
- Working tree was dirty at capture time (uncommitted WIP in app.js, art.js,
  index.html, mediasession.js, state.js over HEAD 2c1ce5c; app.css/tokens.css
  clean). Captures reflect WIP that nonetheless renders without errors.
- The reference /settings needed an extended navigation timeout (harness 30s networkidle
  times out on the live settings page).
- Near-miss investigated: six parallel aubade captures all reported identical
  57 text/29 box counts plus a MutationObserver TypeError. A single sequential
  capture is clean (navigation works, #settings -> viewSettings=flex, 0 errors),
  so the symptom was overload of the single-threaded dev server, not a real
  defect; 2c1ce5c's own message records the module-load observer bug it fixed.

## 2026-08-16T08:26:54-04:00 — kilo  ·  commit 2c6db44

CONFIRMED
- none new. The two duplicates reported under 2c1ce5c (.player__cover 20px -> --radius-tile; .album-btn--play 24px -> --radius-art-lg) are resolved: commit 2c6db44 "Last two hardcoded radii now reference their tokens" and both now use var(). Repro proving zero remain:
  `grep -nE 'border-radius:' app.css | grep -vEv 'var\(|50%|2px'` -> only 25.6px / 16px / 17px;
  `grep -nE 'radius-(art|tile|row|pill)' tokens.css` -> 36/24/14/20/28/9999.
  25.6px/16px/17px match no token; `grep -n '#1c1c20' app.css | grep -v var(` -> no output.

UNVERIFIED
- Now-playing artwork-colour theming (8c372c1) is inert headless: no covers load (FSA permission), so the four-colour pipeline has no input to verify; not reported as a bug.
- The reference /settings still exceeds the harness 30s networkidle limit; captured this run via an extended domcontentloaded capture (no divergence seen, but not via the stock harness line).

Checked and clean:
- contrast <4.5: 0 aubade-only — every low-contrast text node is --text-dim #6b6b76 @3.99, identical to the reference.
- overflow @1440: only .shelf__row scroll cards and .album/.artist-header__bg (clipped by overflow:hidden); no other overflow on any route.
- responsive 1100-1600px: same surfaces only (scroll shelves + ambient washes); no layout break.
- text clipping/wrapping: text-overflow ellipsis + "scroll long titles" marquee (15f8ab9); no bad wrap.
- routing/navigation: each route renders distinct content (home 88/60, album 74/22, artist 88/44, library 69/57, search 21/15, settings 43/22 @1440) with 0 page errors.

## 2026-08-16T08:43:53-04:00 — kilo  ·  commit 2c6db44
No new commits since 2c6db44. Skipped.

## 2026-08-16T09:22:21-04:00 — kilo  ·  commit f22e507

CONFIRMED
- none. f22e507 "Split app.css six ways, without moving a single rule" is a pure
  refactor: committed CSS has 0 hardcoded token-duplicate literals. Repro:
  `git grep -nE 'border-radius:' -- '*.css' | grep -vEv 'var\(|50%|2px'` ->
  only nowplaying.css:195 25.6px, nowplaying.css:595 16px, views.css:418 17px
  (radius tokens are 36/24/14/20/28/9999 — no match); `git grep -nE '#1c1c20|#fb2c5a' -- '*.css' | grep -v var(`
  -> only in tokens.css. The split is wired (committed index.html loads tokens/shell/player/album/nowplaying/views/later.css)
  and renders cleanly: aubade home 86 text/60 boxes, 0 page errors.

UNVERIFIED
- A playlists feature is mid-edit in the working tree (app.js +175, untracked
  playlists.js, later.css +18, index.html +49) over this commit; per the new
  "avoid mid-edit" rule, full visual evaluation of those changes is deferred to a
  clean tree. The committed CSS refactor itself is rule-preserving, so existing
  layout is unchanged from 2c6db44.
- Per-element contrast over tinted/gradient surfaces not computable (harness
  records only bodyBackground).
- The reference /settings needs extended-timeout capture (harness 30s networkidle limit).

Checked and clean: hardcoded-token duplicates (0); CSS split renders (home 86/60, 0 errors).
The pure-refactor split means contrast/overflow/responsive from 2c6db44 still hold.
