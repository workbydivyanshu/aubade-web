// Identity for an album. Case-folded artist and title joined by a NUL, which
// cannot occur in either, so the pair can never collide with a title that
// happens to contain the separator.

export function albumKey(a) {
  return `${a.albumArtist.trim().toLowerCase()}\0${a.album.trim().toLowerCase()}`;
}
