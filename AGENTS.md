# Notes for agents working in this repo

## The suites live in `test/`, and serve themselves

    node test/run.js                 every suite
    node test/run.js responsive np   only suites whose name matches
    node test/run.js --verbose       each suite's own output as it goes
    node test/run.js --engine=firefox   the engine-agnostic subset

`run.js` serves the repo on an ephemeral port of its own, so it needs no dev
server and cannot collide with one. A single suite run directly reads
`AUBADE_URL`, falling back to port 5199.

`~/aubade-capture/` is the older measurement kit — `shot.js`, `audit.js`, and
the reference captures. It also holds **stale copies of fourteen verify
scripts** that `test/` has since replaced and gone well past; running those
measures nothing about this tree. They expect the dev server on 5199.

**Never kill anything on that port.** A background job started from an agent
shell dies as soon as the command returns, so an agent that kills the running
server cannot replace it — one spent half an hour discovering that.

## Two traps that have cost real time

`app.js` contains literal NUL bytes — the album-key separator. `grep` treats it
as binary and prints **nothing** without `-a`. This has been mistaken for
"the code is missing" twice.

The worst bug this project shipped lived in the empty-library first run: it
showed a page of albums that did not exist. `verify-empty` now seeds nothing
and asserts that every view says so in words — but it is the one path where a
suite that quietly seeds a library would stop testing anything, so check what
a new suite starts from before trusting it there.

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
