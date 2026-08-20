// Identity for an album. Case-folded artist and title joined by a NUL, which
// cannot occur in either, so the pair can never collide with a title that
// happens to contain the separator.

// A file with no tags at all still has to be given an identity rather than
// throwing one view down. An artist entry carrying an empty albums array used
// to crash the artist page on `undefined.trim()` and leave it blank with the
// error swallowed, which is the worst of both outcomes.
export function albumKey(a) {
  const at = String((a && a.albumArtist) || '').trim().toLowerCase();
  const al = String((a && a.album) || '').trim().toLowerCase();
  return `${at}\0${al}`;
}
