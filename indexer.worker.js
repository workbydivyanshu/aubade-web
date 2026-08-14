import { parseBlob } from './vendor/music-metadata.mjs';

self.onmessage = async (e) => {
  const { file, path, index } = e.data;
  try {
    const metadata = await parseBlob(file, { duration: true });
    const c = metadata.common;
    const f = metadata.format;

    // Derive the containing folder name for album fallback
    const parts = path.split('/');
    const folder = parts.length > 1 ? parts[parts.length - 2] : '';
    const stem = file.name.replace(/\.[^.]+$/, '');

    const artist = c.artist || c.albumartist || 'Unknown Artist';
    const albumArtist = c.albumartist || c.artist || 'Unknown Artist';

    self.postMessage({
      ok: true,
      index,
      record: {
        path,
        title:       c.title || stem,
        artist,
        albumArtist,
        album:       c.album || folder || 'Unknown Album',
        track:       c.track?.no ?? null,
        disc:        c.disk?.no ?? 1,
        year:        c.year ?? null,
        genre:       c.genre?.[0] ?? null,
        duration:    typeof f.duration === 'number' ? f.duration : 0,
        hasCover:    Array.isArray(c.picture) && c.picture.length > 0,
      },
    });
  } catch (err) {
    self.postMessage({ ok: false, index, path, error: err.message });
  }
};
