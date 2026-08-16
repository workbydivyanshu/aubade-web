// Shared mutable state.
//
// `library` is replaced wholesale whenever the folder is re-indexed or read
// back from IndexedDB, and an imported binding cannot be reassigned by the
// importer — so it lives on a holder that every module can read through.
//
// `player` is only ever mutated, never replaced, so modules may alias it
// directly.

export const state = {
  library: { tracks: [], albums: [], artists: [] },
  player: {
    queue: [],
    index: -1,
    shuffle: false,
    repeat: false,
    originalQueue: [],
  },
};

/**
 * How far the seek controls move, in seconds.
 *
 * Shared: the keyboard's arrow keys and the OS media keys both use it, and
 * they lived in different modules long enough for one copy to go missing.
 */
export const SEEK_STEP_SECONDS = 10;
