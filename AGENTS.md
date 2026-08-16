# Notes for agents working in this repo

## There are no test files here

Verification lives in `~/octave-capture/` as Playwright scripts, not as
`*.test.js` in the tree. Searching for test files by convention finds nothing
and means nothing.

    cd ~/octave-capture
    node audit.js aubade <home|album|artist|library|search|settings> /tmp/x.json
    node verify-np-full.js     # 13-point now-playing fidelity check
    node verify-eq.js          # visualiser reacts to a real frequency sweep
    node verify-keys.js        # keyboard, and that typing does not fire shortcuts
    node verify-liked.js /tmp/l.png
    node verify-menu.js /tmp/m.png
    node verify-chrome.js
    node verify-playlists.js /tmp/p.png

They need the dev server: `python3 -m http.server 5199` from this directory.

## Two traps that have cost real time

`app.js` contains literal NUL bytes — the album-key separator. `grep` treats it
as binary and prints **nothing** without `-a`. This has been mistaken for
"the code is missing" twice.

Every test seeds a library, so the empty-library first run is unexercised. The
worst bug this project shipped lived exactly there: a first run showed a page of
albums that did not exist.

## Things that look broken and are not

- No audio loads headlessly (File System Access permission cannot be granted),
  so anything downstream of playback is inert by design.
- `[cover-diag]` console warnings are deliberate instrumentation.
- `element.hidden` being true says nothing about visibility on its own — though
  `[hidden] { display: none !important }` now enforces it globally.

## Style

Commits are authored `workbydivyanshu <lifeofdivyu@proton.me>` and nothing else.
Design values come from the reference's own stylesheet or a computed-style dump,
never from measuring a screenshot — that has been wrong every time it was tried.
