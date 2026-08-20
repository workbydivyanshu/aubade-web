# Codex — gpt-5.6 — Hephaestus

Date: 2026-08-18T08:49:00-04:00  
Commit: `ca3e0a0`

### Cast control is present but has no effect
severity: breaks-a-feature  
proof:     `grep -an 'aria-label="Cast"' player.html`
           `player.html:743:          <button class="player__icon-btn" type="button" aria-label="Cast">`
           Browser probe: `node --input-type=module <<'EOF' ... click button[aria-label="Cast"] ... EOF`
           `{"label":"Cast","before":{"hash":"#home","open":"now-playing","queue":true},"after":{"hash":"#home","open":"now-playing","queue":true},"changed":false}`
repro:     1. Open `http://localhost:5199/player.html#home`.
           2. Make the player visible by starting playback, or use the existing browser probe after removing the idle class.
           3. Click the Cast button.
           4. Observe that the hash, now-playing state, and queue state do not change.
why:       The button exists at `player.html:743`, but `rg -n -a 'aria-label="Cast"' app.js *.js` returns no binding. The click probe confirms there is no observable action.

### Docked Queue control is present but does not open the queue
severity: breaks-a-feature  
proof:     `grep -an 'aria-label="Queue"' player.html`
           `player.html:751:          <button class="player__icon-btn" type="button" aria-label="Queue">`
           Browser probe: `node --input-type=module <<'EOF' ... click button[aria-label="Queue"] ... EOF`
           `{"label":"Queue","before":{"hash":"#home","open":"now-playing","queue":true},"after":{"hash":"#home","open":"now-playing","queue":true},"changed":false}`
repro:     1. Open the player with a track loaded.
           2. Click the Queue icon in the docked player bar.
           3. Observe that now playing does not open and the queue remains hidden.
why:       `player.html:751` has no id, and `app.js:2750` binds only `#np-queue-btn` in the expanded now-playing view. The docked Queue button has no matching listener or delegated selector.

### Mini player control is present but has no effect
severity: breaks-a-feature  
proof:     `grep -an 'aria-label="Mini player"' player.html`
           `player.html:773:          <button class="player__icon-btn" type="button" aria-label="Mini player">`
           Browser probe: `node --input-type=module <<'EOF' ... click button[aria-label="Mini player"] ... EOF`
           `{"label":"Mini player","before":{"hash":"#home","open":"now-playing","queue":true},"after":{"hash":"#home","open":"now-playing","queue":true},"changed":false}`
repro:     1. Open the player with a track loaded.
           2. Click Mini player.
           3. Observe no layout, route, or overlay change.
why:       The button exists at `player.html:773`; `rg -n -a 'aria-label="Mini player"' app.js *.js` returns no binding. The click probe reports no state change.

### Fullscreen control is present but has no effect
severity: breaks-a-feature  
proof:     `grep -an 'aria-label="Fullscreen"' player.html`
           `player.html:779:          <button class="player__icon-btn" type="button" aria-label="Fullscreen">`
           Browser probe: `node --input-type=module <<'EOF' ... click button[aria-label="Fullscreen"] ... EOF`
           `{"label":"Fullscreen","before":{"hash":"#home","open":"now-playing","queue":true},"after":{"hash":"#home","open":"now-playing","queue":true},"changed":false}`
repro:     1. Open the player with a track loaded.
           2. Click Fullscreen.
           3. Observe that the document does not enter fullscreen and no UI state changes.
why:       The button exists at `player.html:779`; `rg -n -a 'aria-label="Fullscreen"' app.js *.js` returns no binding. The click probe reports no state change.

## Unverified

- No additional measured form delta was reported. The stock comparison harness targets `index.html` for Aubade (the landing page) while the reference capture targets the streaming app, so those captures do not provide an equivalent player-view selector pairing for a defensible pixel/type delta.
- The full `node test/run.js` pass could not be completed: it stopped after the first three suites and concurrent/shared-worktree edits appeared in four test files plus `test/debug-menu-tmp.js`. Those files were preserved and not modified by this report pass.

Checked and clean: `grep -a` control inventory and binding scan; module loading and six empty-library routes; browser page errors (none); top-level project JavaScript syntax (`node --check`); historical volume-button issue (both buttons are now wired at `app.js:979-992`); known headless audio/FSA limitations were excluded per `BUG-RULES.md`.
