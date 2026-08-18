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

## One watcher was removed for making things up

A previous watcher reported the same two controls as broken three times running,
after both had been deleted — including once after this file already required
proof they existed. It was dropped.

That is the standard: a watcher that invents findings is worse than no watcher,
because every false report costs someone a full investigation to disprove while
the real ones wait. If you are not certain, UNVERIFIED is always available and
costs nothing.

## Prove the thing exists before you say it is broken

A report claiming a control does nothing has twice named a control that had
already been deleted. Reporting a bug in something that is not there is worse
than missing one, because it costs someone a full investigation to disprove.

So before writing any finding about a specific element, run a command that
shows it in the current tree, and put that line in the report:

```
grep -n 'aria-label="Notifications"' index.html
```

No output means no finding. If your evidence is a page you loaded earlier,
reload it — the repo changes every few minutes.

## Known false positives — do not report these again

| Reported | Why it was wrong |
| --- | --- |
| "Back/forward buttons are missing" | They exist. `audit.js` only records elements with a visible surface, and transparent icon buttons have none. Absence from the JSON is not absence from the app. |
| "Search should be in the top bar" | The reference keeps Search in the sidebar too. Ours matches. |
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

## One pass per prompt

You are run on demand, not on a timer. Do one pass, write your report, and
stop. Do not sleep and re-run, and do not ask to continue — you will be
prompted again when another pass is wanted.

## Before you scan: has anything changed?

This project is being committed to every ten or twenty minutes, so a fixed
interval will often re-scan code you already cleared, and report things that
were fixed between your runs.

So start every run with:

```
git rev-parse --short HEAD
```

Compare it to the hash at the top of your own last entry in `audit/watch/`. If
it is the same, nothing has changed since you last looked — say so in one line
and stop rather than re-reporting what was already cleared:

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
node ~/aubade-capture/audit.js aubade <home|album|artist|library|search|settings> /tmp/x.json
node ~/aubade-capture/verify-menu.js /tmp/m.png
node ~/aubade-capture/verify-liked.js /tmp/l.png
node ~/aubade-capture/verify-keys.js
node ~/aubade-capture/verify-eq.js
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
