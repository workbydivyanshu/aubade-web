# Watcher findings, and what happened to each

Every CONFIRMED item across `audit/watch/*.md`, with its disposition. A finding
is closed either because it was fixed and a check now guards it, or because it
was examined and deliberately kept — never because nobody got to it.

## Fixed, with a check that would catch it again

| Finding | Reported by | Where it is guarded now |
|---|---|---|
| Six player-bar buttons wired to nothing (Like, Share, Cast, Queue, Mini player, Fullscreen) | opencode, Antigravity | `verify-controls` — each of the four keepers was unbound in turn and watched to fail |
| `renderArtistView` threw `undefined.trim()` on an artist with no albums | kiro | `verify-hostile` — removing the fix reproduces the exact TypeError |
| Untagged files rendered blank cards | kiro (unverified at the time) | `verify-hostile` — no tags, whitespace tags, absent fields |
| `playTrack` catch showed "files may have moved" for a lost folder handle | opencode | fixed before this pass; `verify-nofsapi` |
| Volume buttons were markup only | found by hand | `verify-controls` |
| Greeting was the literal "Good evening" | found by hand | `verify-greeting`, seven hours of the clock |
| Hardcoded radii and colours duplicating tokens | kilo | resolved by kilo's own later pass; no literals remain |

## Found by the suites once they could fail

These are not in any watcher report. Eight suites logged their measurements and
concluded nothing, so they passed whatever the app did; converting them to
verdicts is what surfaced these.

- The now-playing accent was derived by the routine that **darkens** a colour so
  white text can sit on it, and then used only as text. Measured on the rendered
  sheet, a red cover gave the device label 3.25:1. Now 5.1:1 or better across six
  hues (`verify-palette`, sampling real pixels).
- Going idle left the previous record's colours on the sheet.
- The visualiser froze mid-height on mute — the analyser taps the graph, which
  muting the element does not silence (`verify-eq`).
- Folders, half of the home segment pill, had no handler at all, under a comment
  claiming it was the half that worked.
- Rescan with no folder connected fell out of its `if` and did nothing, silently.
- Reset volume repainted one of the two volume bars and said nothing.
- Shuffle and repeat announced state by colour alone — no `aria-pressed`, no
  label change — and set that colour inline from three places, two of which
  found the button by an `aria-label` the fix makes state-dependent.
- The selected sidebar row's background beat its own hover rule; the active
  segment pill's hover set the colour it already had.
- The album buttons answered the pointer with 12 pixels where every other family
  gives hundreds (`verify-focus` grades hover in pixels).
- The focus ring was one declaration written eight times, and absent entirely
  from the now-playing sheet and every album and artist button.
- Four views rendered an empty box with no sentence (`verify-empty`).
- The ask dialog's styles went into a stylesheet nothing links, so it behaved
  perfectly and looked like a browser default.

## Examined and kept as they are

- **`.now-playing__bg` overflows its container.** Intentional: the ambient blobs
  are drawn wider than the screen behind `overflow: hidden`. Decorative overflow
  nobody can scroll to is not a bug, and a check that flagged it once has been
  narrowed to `auto`/`scroll` containers.
- **`content-frame` scrollHeight exceeds clientHeight.** It is the scrolling
  content area. Working as intended.
- **`--text-dim` #6b6b76 at 3.99:1.** Below 4.5, and identical in the reference.
  Used for de-emphasised metadata, never for anything you have to read. Kept so
  the two match; revisit if the reference ever moves.
- **Two artists differing only by case merge into one.** `buildLibrary` folds
  case deliberately — the same artist tagged twice is the common case, and two
  genuinely different artists differing only by capitalisation is not.
- **Go forward does nothing with nothing to go forward to.** Correct behaviour;
  the browser exposes no way to ask whether a forward entry exists, so dimming it
  would mean tracking a parallel history. Recorded rather than guessed at.

## Stale by the time they were read

Antigravity's Notifications and "Add pinned item" buttons no longer exist — the
`player.html` rewrite replaced that region, and the pinned "+" is now
`#new-playlist-btn`, which works. Collapse sidebar, See all, hero-card Share,
the Library pill and the artist More button were all confirmed inert in one pass
and clean in a later one.

## Still open

- **Safari.** Nothing here has been run on it. `backdrop-filter`, the File System
  Access API and `color-mix()` are the places to look first.
- **A real device.** Touch targets are measured at 390px in a desktop browser,
  which is not the same as a thumb.
- **`app.js` is over 3000 lines.** Not a defect, but every one of the bugs above
  that involved two places disagreeing lived in it.
