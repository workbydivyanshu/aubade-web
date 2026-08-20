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

## Found once playback itself became testable

No folder can be picked headlessly, so no file ever opened, so everything past
that point went unexercised for the life of the project — nineteen suites and
none of them had heard a note. The filesystem stand-in now hands back real
decodable audio, and with it:

- **The now-playing sheet leaked seventeen tab stops.** It slides off screen
  rather than being removed, so every control in it stayed in the tab order
  while invisible. Open, it covers the screen, and the page behind it had the
  same problem in the other direction: twenty-four of forty stops landed on
  controls nobody could see.
- **The toast was drawn behind the sheet that raises it** — z-index 300 against
  1000. Measured: zero pixels of it reached the screen. Share and Like both
  raise a toast from inside the sheet, so the confirmation for what you had
  just done was the one you could not see.
- **Nothing announced a track change.** The titles are set with textContent on
  elements that are not live, so a screen reader read the page on arrival and
  then went quiet for the rest of the album.
- **A sidecar that is not lyrics was shown as lyrics.** loadLyrics handed
  whatever it read to parseLrc, which treats unparseable bytes as untimed lines
  and puts them on screen as the words to the song.
- **Three album keys were built by hand with a literal NUL typed into the
  source**, which is why grep needed `-a` on app.js. They all duplicated
  albumKey.

Verified working and now guarded rather than assumed: play, pause, next, the
three-second rule on Previous, auto-advance at the end of a track, repeat-all
wrapping the queue, shuffle keeping what is playing, the scrubber tracking,
synced lyrics following the clock with instrumental gaps kept, the OS media
controls, play counts, one missing file being stepped over, a run of them
stopping with a message, and lapsed permission saying to reconnect.

**Scale.** Measured against 1200 albums and 13,200 tracks: home usable in
640ms, routes under 130ms, the songs view holding 1391 nodes rather than 13,200
rows, 60fps scrolling while new rows arrive, and keystrokes landing in about
20ms after the search index is built. Nothing needed fixing; verify-scale holds
the line. The node count is the bar that matters — rendering the list eagerly
takes it to 79,991 while the frame times barely move.

## Regressions this session introduced, caught by review

Worth recording as a pattern rather than a list: three of the four were the
same mistake. Putting something above the shell — the inert sweep, a z-index —
without checking what else already lives up there.

- The inert sweep exempted the toast **by id** and took `#np-announce` with
  everything else, so track changes announced nothing exactly while the sheet
  was open. Exempting live regions by what they are, not by name, is the shape
  that would not have had this bug.
- The ask dialog at z-index 300 against the sheet's 1000 — invisible and
  unclickable when opened from the sheet's own overflow menu. The identical
  bug to the toast, made two commits after fixing the toast.
- The phone rule hiding the volume button matched `[aria-label="Volume"]`,
  which `syncMuted` rewrites to "Mute" at module load. Third selector this
  session broken by labels that now carry state.
- **The avatar was never dead.** The behavioural sweep called it inert because
  it was clicked from `#settings`, where routing to `#settings` changes nothing
  observable. A second handler was added beside one that had existed since
  "Add settings". A sweep that watches for *any* observable change cannot tell
  "does nothing" from "does what was already done".

## Two suites that passed while testing nothing

Worth recording because both looked green:

- The missing-file check matched by substring against a name that arrives bare,
  so it never fired — and "1 track.opus" as a substring would also have taken
  out "11 track.opus".
- The binary-lyrics check read a selector that matched no element, so it was
  comparing an empty string against a pattern.

Both were found by breaking the thing they guard and watching them stay green.
That is the only way to find this class of check.

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
