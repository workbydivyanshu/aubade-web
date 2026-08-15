# Rules for the bug watch

Read this before reporting anything. Every false positive this project has
seen came from one of the causes below, and each one cost real time.

## The bar

**A finding is a reproduction, not an observation.** Report only what you can
make happen again with a command someone else can run. If you cannot write the
steps, you do not have a bug — you have a suspicion, and suspicions go in the
"unverified" section or nowhere.

Before reporting, ask: *have I actually seen this fail, or have I only seen
something absent from a tool's output?*

## Known false positives — do not report these again

| Reported | Why it was wrong |
| --- | --- |
| "Back/forward buttons are missing" | They exist. `audit.js` only records elements with a visible surface, and transparent icon buttons have none. Absence from the JSON is not absence from the app. |
| "Search should be in the top bar" | Octave keeps Search in the sidebar too. Ours matches. |
| "Album control row is left-aligned" | It is centred on x=848. It *starts* at x=608 because it is centred. |
| "The overflow menu does not open" | Two elements share `aria-label="More options"` — one on the album page, one in now-playing. Match by id. |
| "Like / sync / lyrics toggle do nothing" | They bail on `if (!record) return`. Nothing can play headlessly, so they are correctly inert. Not a bug. |
| "The now-playing title is the wrong size" | Measured from a screenshot crop that was actually over the scrubber times. Never derive type sizes from an image. |
| "Blank cards" / "a stray See all" | Artefacts of reading a downscaled screenshot. Query the DOM. |

## What headless cannot do — never report these as bugs

- **No audio plays.** File System Access permission cannot be granted, so every
  track fails to load. Anything downstream of playback will look dead.
- **No cover art loads**, for the same reason. `[cover-diag]` warnings are
  expected against a seeded library.
- **Media keys cannot be pressed.** MediaSession registration can be checked;
  the keys themselves cannot.
- **`element.hidden` being true does not mean it is invisible**, and vice versa.
  Check `getComputedStyle(el).display`. This one *was* a real bug once.

## Traps specific to this repo

- **`app.js` contains literal NUL bytes** (the album-key separator). `grep`
  treats it as binary and prints nothing. Always use `grep -a`. This has
  wasted time twice.
- Some warnings are deliberate instrumentation, not faults — `[cover-diag]` is
  a diagnostic we added on purpose.

## Before you scan: has anything changed?

This project is being committed to every ten or twenty minutes, so a fixed
interval will often re-scan code you already cleared, and report things that
were fixed between your runs.

So start every run with:

```
git rev-parse --short HEAD
```

Compare it to the hash at the top of your own last entry in `audit/watch/`. If
it is the same, write one line and stop:

```
## <timestamp> — <tool>
No new commits since <hash>. Skipped.
```

Scanning the committed state also avoids catching the repo mid-edit, which is
the other way to get a finding that was never real.

Put the hash in every entry you write, so the next run can compare against it
and so a finding can be traced to the code it was found in.

## How to look

Use the harness rather than inventing one:

```
node ~/octave-capture/audit.js aubade <home|album|artist|library|search|settings> /tmp/x.json
node ~/octave-capture/verify-menu.js /tmp/m.png
node ~/octave-capture/verify-liked.js /tmp/l.png
node ~/octave-capture/verify-keys.js
node ~/octave-capture/verify-eq.js
```

The dev server runs on http://localhost:5199. If it is not up, start it with
`python3 -m http.server 5199` from the repo root — do not report "the site is
down" as a bug.

Reading the code counts. A handler with no listener, a selector matching
nothing, a variable used but never declared — those are all real, and two of
them shipped here undetected for weeks.

## Output

Append one block per run to your own file in `audit/watch/`. Never edit another
agent's file, and never edit anything outside `audit/watch/`.

```
## <ISO 8601 timestamp, e.g. 2026-08-15T19:30:00+05:30> — <your tool name>

CONFIRMED
- <one line>. Repro: <exact command or steps>. Expected X, got Y.

UNVERIFIED
- <one line>, and what you could not establish.

Checked and clean: <areas>
```

If you found nothing, say so in one line. **A run that reports nothing is a
good run.** Padding a report with maybes is worse than an empty one, because
every false positive costs more to disprove than it did to write.
