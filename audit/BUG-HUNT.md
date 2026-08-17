# Bug hunt — one pass

## How to invoke this

The two tools have different vocabularies, and the right skill differs by job.

| | agent | skill |
| --- | --- | --- |
| **opencode** | `@sisyphus` (TUI) / `--agent sisyphus` | keyword in the prompt: `ulw` |
| **codex** | — | `$analyze`, `$ultrawork`, `$code-review` |

**For this file — a read-only hunt — use `$analyze` in codex and plain
`@sisyphus` in opencode.** Do not use `ulw` or `$ultraqa` here. Ultrawork is a
parallel execution engine with self-correcting loops and `$ultraqa` is
explicitly "test, verify, **fix**, report": both edit files and both keep
going. This pass must do neither. `$analyze` is read-only by contract.

`ulw` is the right call for the *fix* pass that follows a report, not for the
report itself.

Read `audit/BUG-RULES.md` first and obey it. It lists every false positive this
project has already paid for. Anything on that list is not a finding.

## Ground rules

- The dev server is already running on **port 5199**. Do not start it, and
  **never kill anything on that port** — it is detached on purpose. Just use it.
- **Do not edit any file** outside your own report. This is a read-and-report
  pass, not a fix pass.
- **Do not commit anything.**
- One pass. When you have finished the checklist below, write your report and
  stop. Do not loop.

## Where the real bugs have actually been

Every genuine bug found so far came from one of these five. Work them in order
and you will be searching where the bodies are buried, rather than guessing.

1. **Identifiers used but never declared.** The codebase was split from one file
   into ES modules, and this broke three times — `coverCache`,
   `SEEK_STEP_SECONDS`, and four names inside `clearPlayerUI`. Each threw
   `ReferenceError` at runtime while looking completely fine on the page.
   Check every module: for each identifier used, is it declared locally,
   imported, or a browser global? Note that `app.js` contains literal NUL bytes,
   so **`grep` needs `-a`** or it silently reports nothing.

2. **Imports and exports that do not line up.** A name imported from a module
   that does not export it, or a function that moved during the split and left
   its callers behind.

3. **Console errors on each view.** Load all six views and record what the
   console says. Ignore `[cover-diag]` warnings and any failure downstream of
   audio or File System Access — those are expected headless and are listed in
   BUG-RULES.md.

4. **Empty states.** Every test seeds a library, so the no-library path is
   barely exercised — that is exactly how the "24 fake albums on first run" bug
   survived so long. Check what each view renders with an empty library.

5. **Listeners bound to elements that no longer exist.** A `querySelector` that
   now returns `null`, or a handler attached to markup that was deleted.

## Before you report anything

For every finding about a specific element, run a command proving it exists in
the tree **right now**, and paste that command and its output into the report:

```
grep -an 'aria-label="Notifications"' index.html
```

No output means no finding. Delete it.

## Report format

Write to `audit/watch/<yourtool>.md` — `codex.md` or `opencode.md`. Overwrite it.

Start with a header line naming the tool, the model, and the agent you ran as,
then the date. Then, per finding:

```
### <one-line claim>
severity:  breaks-a-feature | wrong-behaviour | cosmetic
proof:     <command you ran>
           <its actual output, pasted>
repro:     <numbered steps someone else can follow>
why:       <the mechanism — which line, which identifier, which selector>
```

Put anything you suspect but could not prove under a final `## Unverified`
heading. That section costs nothing and is always the right home for a hunch.

**If you find nothing, say so.** A clean pass is a real and useful result. An
invented finding gets a watcher dropped — that has already happened once here.
