# Polish worklist

## Status

Batches 1-6 are done and verified by re-measuring against the live site.
Card typography was added as a seventh pass after the counts showed Octave
running 14px/600 titles and 12px/400 secondary text where we had 500 and 13px.

Two items were found to be measurement errors during the work itself and are
recorded in the discarded table below: the album control row is centred on
Octave, not left-aligned, and back/forward were never missing from our top bar.

**Still open — the search field.** Octave's `/search` presents a collapsed
34x38 pill in the sticky top bar (radius full, bg rgb(20,20,23), 1px border),
not the 560x44 centred field we show. It does not expand under automation even
when focused and typed into, so the expanded width cannot be measured. Matching
it would mean guessing that number, so ours is unchanged pending a real look.


Merged from the three parallel audits, de-duplicated, with false findings removed.
Every item below was re-verified against the captured JSON before being listed.

## Discarded — measured wrong, no work needed

| Reported | Why it is not real |
| --- | --- |
| Hero card radius 0px vs 16px | The Octave "0px" boxes matched are the 1440×900 page containers, not a hero. Octave's home has no hero card; ours is our own element with no counterpart. |
| Play button radius "full vs 24px" | The button is 48px tall, so 24px *is* fully round. Identical. |
| Filter pill radius 33554432px vs 9999px | Both are "effectively infinite". Identical. |
| Player bar not captured on either side | Nothing was playing in either capture, and we now hide the bar when idle. Expected. |
| Greeting line-height 40 vs 39.6px | Real but 0.4px; symptom of batch 4, not its own task. |

## Out of scope — content, not form

Octave is a streaming service; these have no local-library meaning. Revisit as features, not polish.

- Library "Liked Songs" hero card and the 8-row stats panel (Playlists, Podcasts, Downloaded…)
- Search page "Browse Categories" tile grid and "Concerts near you"
- Artist follower counts ("62.7K fans")

## Batch 1 — Corner radius  ·  highest impact, lowest risk

Three agents found this independently and it is confirmed: Octave's dominant radius is
**36px across 66 elements**; ours is **8px across 38**. It changes the entire feel of the UI.

Root cause: `tokens.css` defines **no radius tokens at all**, so every corner is hardcoded
in `app.css` and they drifted apart.

| Element | Octave | Aubade |
| --- | --- | --- |
| All covers and cards (176², 224²) | 36px | 8px |
| Quick-link tiles (273×60) | 20px | 10px |
| Pills, avatars, round buttons | full | full ✅ |

## Batch 2 — Top bar  ·  structural

Measured at y<70, x>260:

| Element | Octave | Aubade |
| --- | --- | --- |
| Back / forward | 32×32 at x=280 and x=318, y=12 | absent |
| Search field | 36×36 at x=812, y=23 (in the top bar) | only in the sidebar, at y=119 |
| Avatar | 40×40 at x=1376, y=8 | 36×36 at x=1384, y=10 |

## Batch 3 — Sidebar metrics

| Element | Octave | Aubade | Delta |
| --- | --- | --- | --- |
| Nav row pitch | 44.6px (y=76,121,165,210,254,299) | 47px (y=72,119,166,213,260,307) | +2.4px, compounding down the list |
| Brand position | x=58, y=16 | x=53, y=23 | −5px, +7px |

## Batch 4 — Line-height  ·  systemic

Octave sets explicit px line-heights; we use unitless multipliers, so every text block
drifts. Same root cause across all of these:

| Element | Octave | Aubade |
| --- | --- | --- |
| Shelf title | 32px | 28.8px |
| Shelf subtitle | 20px | 18.2px |
| Hero eyebrow | 16px | 12px |
| Album/artist title | 48px | 52.8px |
| Album eyebrow, artist, metadata | 16px / 24px / 20px | `normal` |

Also: artist section-header tracking is −0.6px in Octave, −0.176px in ours.

## Batch 5 — Album page controls

| Element | Octave | Aubade |
| --- | --- | --- |
| Control buttons | 7 (Play 119×48, six 48×48) | 3 (Play 99×48, two 48×48) |
| Alignment | left, from x=608 | centred |

## Batch 6 — Artist page

| Element | Octave | Aubade |
| --- | --- | --- |
| Artist photo | 208×208 circle at (288,307) | absent — flat gradient scrim only |
| Round action buttons | 3 × 48×48, backdrop blur 8px | 1 (shuffle), no blur |
| Follow button | 87×46, full radius, 1px white/0.2 border | absent |
| "See all" links | 14px/600 rgb(163,163,173) beside section titles | absent |

## Open question — two shelf card sizes

Octave uses **176×176 (75 instances) and 224×224 (40)**; we only use 176. Worth checking
whether the larger size belongs to a particular shelf type before copying it.
