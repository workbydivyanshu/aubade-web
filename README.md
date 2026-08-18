# Aubade

[![tests](https://github.com/workbydivyanshu/aubade-web/actions/workflows/tests.yml/badge.svg)](https://github.com/workbydivyanshu/aubade-web/actions/workflows/tests.yml)

A web music player for a local library, built to match a reference design
screen for screen.

Point it at a folder of music. It reads the tags, builds albums and artists,
and plays them — with synced lyrics, playlists, a visualiser and per-cover
colour theming. Your library never leaves your machine: there is no server, no
account, and nothing is uploaded. The app reads files directly from disk
through the browser and keeps its index in local storage.

Plain HTML, CSS and JavaScript. No framework, no build step, no dependencies.

![Aubade on a desktop: a sidebar of albums and artists beside a home page of
shelves, with a hero card for the largest album.](shots/desktop.webp)

## Running it

From this directory:

```sh
python3 -m http.server 5199
```

Then open <http://localhost:5199> for the page that introduces it, or
<http://localhost:5199/player.html> to go straight to the player.

Any static file server works — `npx serve`, `caddy file-server`, whatever you
have. There is nothing to compile.

## Browser support

Reading a folder from disk needs a browser API that is not evenly implemented.

| | Picking a folder | Remembered next session |
| --- | --- | --- |
| **Chrome, Edge, Brave, Opera** | yes | yes |
| **Firefox** | yes | no — pick it again each session |
| **Safari** | expected to work, untested | no |

Chromium browsers have the File System Access API, which hands out a *handle*
that can be stored and re-permissioned later. Firefox and Safari only have
`<input webkitdirectory>`, which yields files with nothing behind them: once
the page reloads, the files are gone.

That affects playback only. The library, its artwork and your playlists all
persist either way, so the app is fully browsable on a fresh load — it just
asks you to reconnect the folder before it can play anything. Storing the audio
itself would mean copying an entire music library into browser storage, which
is not a trade worth making.

**Safari is untested rather than known-good.** It takes the same code path as
Firefox, which is verified, so it is expected to work. It could not be checked
here: Playwright's WebKit build links against Ubuntu library versions
(`libicuuc.so.74`, `libjpeg.so.8`, `libjxl.so.0.8`) that Fedora does not ship,
and `playwright install-deps` only knows `apt-get`. Testing it needs either a
Debian-family machine or the official Playwright container.

## Hosting it

It is live at
<https://workbydivyanshu.github.io/aubade-web/>, served from this repository
by GitHub Pages.

Every path is relative, so it works from a domain root or a subpath alike.
`index.html` is the opening page and `player.html` is the app, so a visitor
lands on the introduction rather than an empty library. Copy the `.html`,
`.js`, `.css` files and `vendor/` and serve them.

One requirement: **the page must be a secure context**. File System Access is
unavailable over plain `http://` except on `localhost`, so a hosted copy needs
HTTPS. Every static host worth using provides it.

## Layout

| | |
| --- | --- |
| `index.html` `landing.css` | the opening page, and its own styles |
| `player.html` | all markup for every view of the app |
| `app.js` | routing, playback, queue, views |
| `state.js` `db.js` `library.js` | state, IndexedDB, album keys |
| `art.js` `colour.js` | cover art, palette extraction |
| `lrc.js` | synced lyric parsing |
| `cards.js` `browse.js` `playlists.js` | view components |
| `visualiser.js` `mediasession.js` | Web Audio bars, media keys |
| `indexer.worker.js` | tag reading, off the main thread |
| `tokens.css` | design values, read from the reference |
| `responsive.css` | the phone layout, loaded last |
| `shots/` | screenshots of the app, used by the opening page |

Stylesheets load in the order listed in `index.html`; `responsive.css` is last
so its media queries win without needing extra specificity.

## Checking changes

The suites live in `test/` and drive a real browser through the app.

```sh
cd test && npm install   # once — Playwright, the only dependency anywhere here
```

Then from the repository root:

```sh
node test/run.js                    # all thirteen suites, about 90 seconds
node test/run.js responsive phone   # only suites whose name matches
node test/run.js --verbose chrome   # with the suite's own output
```

The runner serves the repository itself on a spare port, so nothing needs to
be running first and a run cannot disturb a dev server you already have open.
A suite that fails prints what it measured and the run exits non-zero.

To have them run before every commit:

```sh
git config core.hooksPath test/hooks
```

`SKIP_TESTS=1 git commit` skips a run; `git config --unset core.hooksPath`
stops them running at all.

| | |
| --- | --- |
| `verify-landing` | the opening page |
| `verify-chrome` | sidebar, navigation, menus |
| `verify-keys` | keyboard shortcuts |
| `verify-menu` | track and album overflow menus |
| `verify-liked` | liked songs |
| `verify-playlists` | create, add, remove, missing files |
| `verify-escape-palette` | Escape dismissal and palette reset |
| `verify-palette` | colours recovered from cover art |
| `verify-np-full` | now playing against the reference |
| `verify-eq` | the visualiser reacts to real sound |
| `verify-responsive` | both sides of the 768px breakpoint |
| `phone-views` | every route at 390px |
| `verify-nofsapi` | the no-File-System-Access path |

They seed a fixture library straight into IndexedDB rather than indexing a
folder, because the folder picker cannot be driven headlessly — and the tag
reader is not what these are testing.

`node test/shots.js` regenerates the two screenshots on the opening page. They
are the real app photographed at 1440 and 390 against that same fixture
library, so they go stale when the app changes. It needs ImageMagick for the
WebP conversion; nothing else here does.

Design values are taken from the reference's own stylesheet and from
`getComputedStyle` on the running site — never estimated from screenshots.
That rule exists because estimating from a screenshot got the type size wrong
twice before measurement settled it.

`audit/BUG-RULES.md` is the brief for automated review passes, and lists the
false positives this project has already paid for.

## Licence

MIT — see [LICENSE](LICENSE).

`vendor/music-metadata.mjs` is third-party and carries its own MIT licence.
The design is a study of an existing streaming player's layout: the
measurements are taken from the running site, and none of its code, artwork or
copy is included here.
