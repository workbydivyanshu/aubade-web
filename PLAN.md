# Building the clone

A web front end that reproduces the reference player, for a local music
library rather than a streaming catalogue.

## What is already settled

- **Design tokens**: `tokens.css` holds the reference's literal values, read off
  the running site via computed style rather than guessed from pixels. Nothing
  in it needs re-deriving.
- **Reference images**: 124 clean captures in `~/aubade-shots`, plus two
  full-resolution shots of screens the headless run could not reach:
  - `~/.cache/caelestia/screenshots/20260814063145` — expanded now playing
  - `~/.cache/caelestia/screenshots/20260814063443` — settings and player bar
- **Measurements**: the design notes in the sibling desktop project — sizes, weights, spacing.
- **Serving**: `python3 -m http.server 5199` from this directory.
- **Checking**: `node ~/aubade-capture/shot.js OUT.png` screenshots the local
  page at 1440x900 and reports console errors.

Plain HTML, CSS and JavaScript. No framework and no build step until the state
handling actually demands one; adding Vite later costs an afternoon, and paying
for it now buys nothing.

## Order

Chrome before content, content before data. Each step is meant to be small
enough to check against one reference image.

### Part 1 — the shell

1. **Sidebar.** 256px, fixed. Wordmark, six nav rows, rule, a pinned section,
   footer. Nav rows are 43px pills; the selected one fills and only its icon
   takes the accent.
2. **Top bar.** 56px. Back and forward at the left, notification and avatar at
   the right. No title.
3. **Content frame.** The region right of the sidebar and below the top bar,
   scrolling inside itself rather than with the window.
4. **Player bar.** Docked across the bottom. Cover, title and artist at the
   left; transport and scrubber centred; volume and expand at the right.

### Part 2 — pages

5. **Home**: greeting, quick-links grid, hero card, then shelves.
6. **Shelf component**: heading with icon and chevron, subtitle, `See all`, and
   a horizontally scrolling row of cards. Used by several pages.
7. **Album**: blurred artwork header, centred cover, centred metadata, action
   row, track list. The accent is sampled from the artwork per record.
8. **Artist**: header plus shelves.
9. **Search**: field, recent searches, results.
10. **Library**: grid with a filter row.
11. **Now playing**: the expanded view. Artwork and transport left, lyrics set
    large down the right, over a blurred wash of the cover.
12. **Settings**: stacked cards, label with description, control at the right.

### Part 3 — making it real

13. **Folder picking** via the File System Access API: the listener grants a
    directory once and it is remembered in IndexedDB.
14. **Indexing**: read tags in a worker, build albums and artists, persist.
15. **Playback**: an `<audio>` element behind a small state module, wired to
    the player bar and the now-playing view.
16. **Lyrics**: sidecar `.lrc` beside the file, parsed and synced.

## What is deliberately dropped

Radio, podcasts, the Global/Local switch, region, fan counts, `LOSSLESS`
badges, animated covers, `See all` links to server-backed lists. All of them
describe a streaming catalogue, and building them would leave the app looking
like a client for something that is not there.

Their local equivalents already have data behind them: the hero becomes the
most played record, the recent shelf becomes recently added, and quick links
become pinned albums.

## Rules for every step

- Match the reference image given for that step. Do not improvise layout.
- Use the tokens in `tokens.css`. Do not introduce new colours.
- Static markup with placeholder content is correct until Part 3; nothing
  should invent a data layer early.
- Keep `app.css` and `app.js` as the only files that grow, so steps do not
  collide.
