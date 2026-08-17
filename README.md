# Aubade

A web music player for a local library, built to match
[Octave](https://music.octavestreaming.com) screen for screen.

Point it at a folder of music. It reads the tags, builds albums and artists,
and plays them — with synced lyrics, playlists, a visualiser and per-cover
colour theming. Your library never leaves your machine: there is no server, no
account, and nothing is uploaded. The app reads files directly from disk
through the browser and keeps its index in local storage.

Plain HTML, CSS and JavaScript. No framework, no build step, no dependencies.

## Running it

From this directory:

```sh
python3 -m http.server 5199
```

Then open <http://localhost:5199>.

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

Every path in the app is relative, so it can be served from a domain root or
from a subpath — a GitHub Pages project page works unmodified. Copy the `.html`,
`.js`, `.css` files and `vendor/` and serve them.

One requirement: **the page must be a secure context**. File System Access is
unavailable over plain `http://` except on `localhost`, so a hosted copy needs
HTTPS. Every static host worth using provides it.

## Layout

| | |
| --- | --- |
| `index.html` | all markup for every view |
| `app.js` | routing, playback, queue, views |
| `state.js` `db.js` `library.js` | state, IndexedDB, album keys |
| `art.js` `colour.js` | cover art, palette extraction |
| `lrc.js` | synced lyric parsing |
| `cards.js` `browse.js` `playlists.js` | view components |
| `visualiser.js` `mediasession.js` | Web Audio bars, media keys |
| `indexer.worker.js` | tag reading, off the main thread |
| `tokens.css` | design values, read from the reference |
| `responsive.css` | the phone layout, loaded last |

Stylesheets load in the order listed in `index.html`; `responsive.css` is last
so its media queries win without needing extra specificity.

## Checking changes

The verification harness lives outside this repository, in `~/octave-capture`.
Run it from there with the dev server up:

```sh
cd ~/octave-capture
node verify-responsive.js      # both sides of the 768px breakpoint
node verify-nofsapi.js firefox # the no-File-System-Access path
node verify-chrome.js          # sidebar, menus, navigation
node verify-playlists.js       # create, add, remove, missing files
node phone-views.js            # every route at 390px
```

Design values are taken from the reference's own stylesheet and from
`getComputedStyle` on the running site — never estimated from screenshots.
That rule exists because estimating from a screenshot got the type size wrong
twice before measurement settled it.

`audit/BUG-RULES.md` is the brief for automated review passes, and lists the
false positives this project has already paid for.
