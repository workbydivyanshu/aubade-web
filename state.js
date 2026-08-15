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
