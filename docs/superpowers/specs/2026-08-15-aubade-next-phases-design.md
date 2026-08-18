# Aubade: next three phases

Agreed 2026-08-15. Goal, in the owner's words: a real music player that is
identical to the reference. Both halves bind — new work has to be genuinely usable
*and* measured against the reference.

## Where this starts

The visual clone is largely done. Home, album, artist, library, search,
settings and now-playing all exist; the album and artist pages match the reference's
measured positions exactly. Playback, synced lyrics, search over ~5,600 tracks
and artwork extraction all work.

What is not done falls into three groups, in priority order below.

## Method, unchanged

Differences are measured, never eyeballed. `~/aubade-capture/audit.js` extracts
the same computed-style spec sheet from both the live site and localhost:5199,
and changes are verified by re-measuring. Three findings in the last audit were
measurement errors caught this way, each of which would have caused damage if
acted on. A screenshot is evidence of *what to look at*, not of a number.

Corner radii, type scale and spacing live in `tokens.css`. Anything hardcoded
in `app.css` is a future drift.

---

## Phase 1 — now-playing fidelity

The owner's stated priority: "every minute stuff there".

### The measurement problem, and its solution

The reference's expanded now-playing cannot be reached headlessly. Probed and
confirmed: no matching elements exist in the DOM without a session, there is no
fixed bottom bar, and `/now-playing`, `/player` and `/queue` all return 404. The
only other reference is a 2880x1800 desktop screenshot including browser chrome,
where reading positions means converting pixel coordinates — the guessing this
project has repeatedly been burned by.

Solution: `~/aubade-capture/DUMP-NOWPLAYING.js` is a console snippet the owner
runs in their own logged-in browser. It emits the same spec sheet the harness
produces (~22KB), turning the one unreachable screen into measured data. Run
twice, with the overflow menu closed and open.

**Phase 1 proper is blocked on that dump.** Work that does not depend on it is
listed as unblocked below.

### Gaps already identified from the screenshot (unblocked)

- **Overflow menu.** The reference shows 17 items in two groups; ours has 4. Group one:
  View song, Add to Liked Songs, Play next, Add to queue, Add to playlist, Song
  radio. Group two: Go to album, Go to artist, View lyrics, View credits, Music
  video, Download, Select songs, Share image, Share link, Copy link, Suggest
  less. The streaming-only entries (Song radio, Music video, Download, Suggest
  less, Add to playlist until playlists exist) have no local meaning and drop
  out, as Download and Save-to-library did on the album page.
- **Inactive lyric lines are blurred**, not merely dimmed. We reproduce none of
  this and it is one of the view's most distinctive qualities.
- **Quality/speed row is centred** under the scrubber; ours is left-aligned.
- **Missing:** "This device" output picker (bottom left), explicit badge beside
  the title, PiP and karaoke icons, a visualiser over the bottom of the cover.
- **Inert buttons:** `np-share-btn` and `np-queue-btn` have no handlers.

### Success

Every element in the dump has a counterpart at the same position, and the menu
offers every action that means something for local files.

---

## Phase 2 — stop the UI lying

Three of six sidebar rows are affected. This is not missing features; it is the
interface asserting things that are false.

- **`#browse` is a dead link.** No view exists. Becomes: decades, genres and
  years derived from tags (owner's choice over a plain genre grid), in the reference's
  tile grid — 263x132 cells, 36px radius.
- **`#liked-songs` is a dead link.** Both the sidebar pinned item and the home
  quick-card point at it.
- **"Most played" is alphabetical by artist.** `app.js` says so outright: "no
  play counts yet". Needs real counts. A play registers past 30 seconds or 50%,
  whichever comes first, so skipping does not inflate it.
- **Storage nothing reads:** `aubade_liked`, `aubade_liked_albums`,
  `aubade_followed_artists` all write and are never surfaced. Two were added
  during the now-playing and album work.
- **Queue view.** The reference has one; we have a queue in `playerState` with no way
  to see it. Prerequisite for the inert queue buttons.

### Success

No link goes nowhere, no shelf is labelled something it is not, and everything
written to storage has a screen that shows it.

---

## Phase 3 — a real player

- **MediaSession.** Media keys, lock screen and notification controls currently
  do nothing. This is the largest gap between "a web page that plays audio" and
  a music player, and it is small to close.
- **Keyboard shortcuts.** One `keydown` handler exists, for Escape. Space,
  arrows, and the transport basics.
- **Split `app.js`.** 2,245 lines today; phases 1 and 2 push it past 3,000. It
  is already an ES module, so splitting is mechanical. Deferred to here
  deliberately: by then it is load-bearing rather than tidying.

### Success

The player is usable without the window focused, and no single file holds
everything.

---

## Out of scope

Furniture from the reference with no local meaning, recorded so it is not rediscovered:
its library stats panel (Playlists, Podcasts, Downloaded), Radio and Podcasts
nav, follower counts, "Concerts near you". Playlists are deliberately deferred —
they are a feature, not a gap, and would expand every phase above.

## Open question

The reference's search field is a collapsed 34x38 pill in the sticky top bar, not our
560x44 centred field. It does not expand under automation even when focused and
typed into, so its open width is unmeasurable by the usual method. The same
console-dump trick would settle it.
