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
  Octave uses identically, so no aubade-only contrast regression was established.

Checked and clean: horizontal overflow on home (shelf-card__ boxes sit inside
.shelf__row {overflow-x:auto}; scroll content, not layout overflow), album/artist
header bg (scale(1.4) inside .album-header/.artist-header {overflow:hidden}, clipped,
not visible), text clipping/wrapping (remaining truncation is intentional
text-overflow:ellipsis; no unintended wrap at 1100–1600px), contrast (matches
reference; oklab/rgba(0,0,0,0) 1.00 readings were parser artifacts on tinted
surfaces), responsive breakpoints 1100/1280/1440/1600px (quick-grid 4-col and
scroll shelves stable, no breakage). Octave settings captured via extended
navigation timeout (harness default 30s networkidle timed out on the live site).
