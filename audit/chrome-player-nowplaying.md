# Chrome & Player Bar Audit

Comparing Aubade (localhost:5199) against Octave (music.octavestreaming.com).
Measurements extracted with `~/octave-capture/audit.js`. Now-playing visual rows marked (visual) because Octave screenshots cannot be inspected by this model.

| Area | Element | Octave | Aubade | Delta | Severity |
|------|---------|--------|--------|-------|----------|
| Sidebar | Brand y-position | y=16 | y=23 | +7px | low |
| Sidebar | Brand x-position | x=58 | x=53 | -5px | low |
| Sidebar | Nav row height | 23px | 15px | -8px | medium |
| Sidebar | Active-state y | y=66 | y=58 | -8px | medium |
| Sidebar | "Your Library" y | y=299 | y=307 | +8px | low |
| Sidebar | Footer | none | "Aubade" at y=856 | — | medium |
| Top bar | Back/forward controls | 2× chrome-icon buttons at y=12, x=280/318, 32×32px | absent | — | high |
| Top bar | Search field location | glass-floating at x=812, y=23, 36×36px (top bar) | at y=119 in sidebar | — | high |
| Top bar | Avatar size | 40×40px | 36×36px | -4px | low |
| Bottom player bar | Persistent bar | not captured in JSON | not captured in JSON | — | — |
| Now-playing (visual) | Cover size | — (visual) | 400×400px at x=48, y=146 | — | — |
| Now-playing (visual) | Eyebrow label | — (visual) | "NOW PLAYING" at x=671, y=43 | — | — |
| Now-playing (visual) | Sync controls | — (visual) | −/+ buttons at x=1221/1316, y=116, 28×28px | — | — |
| Now-playing (visual) | Play button | — (visual) | 76×76px at x=176, y=1587 | — | — |

## Counts

| Severity | Count |
|----------|-------|
| high | 2 |
| medium | 3 |
| low | 4 |
| visual (now-playing) | 4 |
| not present | 1 |

## Notes

- **Bottom player bar:** Neither Octave nor Aubade home JSON contains a persistent bottom player bar. The screenshot darkness profile shows a dark region at viewport y≈870–900 in Octave, but no corresponding elements were extracted by the audit harness. This may indicate the bar lives in a layer the harness does not capture (shadow DOM, overlay, or native element).
- **Now-playing view:** The two Octave screenshots (`20260814063145`, `20260814063443`) are 2880×1800 retina captures. This model cannot render or inspect images, so all now-playing rows are reported as (visual) and unmeasured on the Octave side. Measured data from `/tmp/ac-np.json` is provided for reference only.
- **Content differences** (Octave has Radio/Podcasts, Aubade has Albums/Artists) are ignored per instructions; only form differences are registered.
