// Artwork: the gradient stand-ins, cover extraction, and the accent
// sampled from a cover.

import { dbGet } from './db.js';
import { albumKey } from './library.js';
import { rgbToHsl, accentLightness, accentTextLightness } from './colour.js';

const coverCache = new Map();

const GRADIENTS = [
  '#2d1b69,#b44593', '#1a3a2a,#4ecdc4', '#6b2d3e,#e8927c',
  '#20344d,#415a77', '#3d1c02,#c97b2a', '#2e2e5e,#6c63ff',
  '#2a0a0a,#c0392b', '#17472f,#27ae60', '#4a1942,#e84393',
  '#2c3e50,#3498db', '#2c2c4a,#e94560', '#1d4d5e,#34e89e',
  '#3c1053,#ad5389', '#25344d,#3d5a80', '#611818,#d4a373',
  '#243845,#3a6073', '#2b1055,#d53369', '#232046,#4834d4',
  '#3a1c01,#e67e22', '#2a4a6e,#a8dadc', '#2d132c,#ee6352',
  '#333333,#6d6d6d', '#1e5a6b,#71b280', '#4b134f,#c94b4b',
];

export function gradientFor(key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return GRADIENTS[Math.abs(h) % GRADIENTS.length];
}

export async function coverUrlForAlbum(album) {
  const key = albumKey(album);
  if (coverCache.has(key)) return coverCache.get(key);

  // Need a live FileSystemFileHandle — only available when permission is active.
  // The library from IndexedDB stores plain records (no handles). We need to
  // walk the directory to find the file. For now, if the track has no handle
  // stored, we skip.
  const firstTrack = album.tracks[0];
  if (!firstTrack || !firstTrack.path) {
    coverCache.set(key, null);
    return null;
  }

  // A bare catch here used to swallow every failure and cache null, which made
  // a thrown error indistinguishable from an album that genuinely has no art.
  // Name the stage so a failure says which step broke.
  let stage = 'start';
  try {
    // Re-walk to find the file handle for this track
    stage = 'dbGet(musicDir)';
    const dirHandle = await dbGet('musicDir');
    if (!dirHandle) {
      console.warn('[cover-diag] no musicDir handle in IndexedDB for:', album.album);
      coverCache.set(key, null);
      return null;
    }

    stage = 'queryPermission';
    if (dirHandle.queryPermission) {
      const perm = await dirHandle.queryPermission({ mode: 'read' });
      if (perm !== 'granted') {
        console.warn('[cover-diag] permission is "' + perm + '" (not granted) for:', album.album);
        return null; // not cached: permission can still be granted later
      }
    }

    // Navigate the path segments to reach the file
    const parts = firstTrack.path.split('/');
    let current = dirHandle;
    for (let i = 0; i < parts.length - 1; i++) {
      stage = 'getDirectoryHandle("' + parts[i] + '")';
      current = await current.getDirectoryHandle(parts[i]);
    }
    stage = 'getFileHandle("' + parts[parts.length - 1] + '")';
    const fileHandle = await current.getFileHandle(parts[parts.length - 1]);
    stage = 'getFile';
    const file = await fileHandle.getFile();

    stage = 'import(music-metadata)';
    const { parseBlob } = await import('./vendor/music-metadata.mjs');
    stage = 'parseBlob (' + file.size + ' bytes, type "' + file.type + '")';
    // duration:true is load-bearing, not a typo. With it off, the parser takes
    // an early-exit path that stops reading partway through a Vorbis comment
    // spanning many Ogg pages, so a 2455172-char METADATA_BLOCK_PICTURE
    // arrives truncated to 844741 and atob rejects it. Costs ~250ms a file
    // instead of ~18ms, but the result is cached and loaded lazily.
    const metadata = await parseBlob(file, { duration: true });
    const pics = metadata.common.picture;
    if (!pics || pics.length === 0) {
      console.warn('[cover-diag] parsed fine but no embedded picture:', album.album,
        '| container:', metadata.format && metadata.format.container,
        '| tag types:', (metadata.native && Object.keys(metadata.native).join(',')) || 'none');
      coverCache.set(key, null);
      return null;
    }
    const pic = pics[0];
    const blob = new Blob([pic.data], { type: pic.format });
    const url = URL.createObjectURL(blob);
    coverCache.set(key, url);
    return url;
  } catch (err) {
    console.warn('[cover-diag] threw at stage "' + stage + '" for:', album.album,
      '| path:', firstTrack.path, '|', err && err.name, '-', err && err.message);
    coverCache.set(key, null);
    return null;
  }
}

export function getCoverAccent(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 32;
      canvas.height = 32;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, 32, 32);
      try {
        const data = ctx.getImageData(0, 0, 32, 32).data;
        let r = 0, g = 0, b = 0, count = 0;
        for (let i = 0; i < data.length; i += 4) {
          r += data[i];
          g += data[i+1];
          b += data[i+2];
          count++;
        }
        if (count === 0) return resolve(null);
        r = Math.round(r / count);
        g = Math.round(g / count);
        b = Math.round(b / count);
        
        // Keep only the HUE of the artwork and rebuild the colour at a fixed
        // saturation and lightness, which is what the reference does — measured
        // off its album pages as hsl(H 82% 46%).
        //
        // Averaging pixels and using the result directly is what produced a pale
        // peach that white text vanished against. Clamping S and L cannot: every
        // album gets a colour of its own hue that is always readable.
        const [h] = rgbToHsl(r, g, b);
        resolve(`hsl(${Math.round(h)} 82% ${accentLightness(h)}%)`);
      } catch (e) {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * Drop every cached cover and release its object URL.
 *
 * The cache is private to this module, so the settings screen cannot empty it
 * by reaching in — it was trying to, and throwing a ReferenceError on every
 * click without revoking anything.
 */
export function clearCoverCache() {
  let revoked = 0;
  for (const url of coverCache.values()) {
    if (url) { URL.revokeObjectURL(url); revoked++; }
  }
  coverCache.clear();
  return revoked;
}

/**
 * The four colours the reference themes now-playing from.
 *
 * Its stylesheet declares --np-c1 through --np-c4, plus --np-bg and two glows,
 * where we were deriving a single hue. One colour makes every record's
 * backdrop the same shape; four let a cover's own palette come through.
 *
 * Averaging the whole image gives mud, so this buckets pixels by hue and takes
 * the strongest buckets, skipping near-black and near-white — those are
 * backgrounds and text, not the record's colour.
 */
export function getCoverPalette(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      const size = 48;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, size, size);
      try {
        const data = ctx.getImageData(0, 0, size, size).data;
        // 24 hue buckets, each keeping its weight and average lightness.
        const buckets = Array.from({ length: 24 }, () => ({ w: 0, l: 0, s: 0 }));
        let darkest = 1;
        for (let i = 0; i < data.length; i += 4) {
          const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
          if (l < darkest) darkest = l;
          // Ignore what carries no colour: near-black, near-white, and greys.
          if (l < 0.12 || l > 0.92 || s < 0.16) continue;
          const b = buckets[Math.floor(h / 15) % 24];
          // Saturated mid-tones say more about a cover than pale edges do.
          const weight = s * (1 - Math.abs(l - 0.5));
          b.w += weight;
          b.l += l * weight;
          b.s += s * weight;
        }
        const ranked = buckets
          .map((b, i) => ({ hue: i * 15 + 7.5, ...b }))
          .filter((b) => b.w > 0)
          .sort((x, y) => y.w - x.w);

        if (!ranked.length) return resolve(null);

        // Four colours, spread across hues rather than four shades of one.
        const picked = [];
        for (const cand of ranked) {
          const clash = picked.some((p) => {
            const d = Math.abs(p.hue - cand.hue);
            return Math.min(d, 360 - d) < 25;
          });
          if (!clash) picked.push(cand);
          if (picked.length === 4) break;
        }
        // A cover with one strong colour should not produce four identical
        // washes; shift the hue a little for each repeat so the layers still
        // read as separate.
        let spin = 0;
        while (picked.length < 4) {
          const base = ranked[picked.length % ranked.length];
          spin += 18;
          picked.push({ ...base, hue: (base.hue + spin) % 360 });
        }

        const toColour = (b, satFloor) => {
          const l = Math.min(0.68, Math.max(0.42, b.l / b.w));
          const s = Math.min(0.9, Math.max(satFloor, b.s / b.w));
          return `hsl(${Math.round(b.hue)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
        };

        const lead = picked[0];
        // Capped low deliberately: a bright cover has no dark pixels to
        // sample, and following it would put light text on a light field.
        const bgL = Math.round(Math.min(9, Math.max(4, darkest * 60)));
        resolve({
          c1: toColour(picked[0], 0.55),
          c2: toColour(picked[1], 0.5),
          c3: toColour(picked[2], 0.45),
          c4: toColour(picked[3], 0.45),
          // A near-black tinted toward the cover, the way --np-bg reads.
          bg: `hsl(${Math.round(lead.hue)} 42% ${bgL}%)`,
          // The sheet spends this one as text on the scrim above, not as a
          // fill, so it wants the lightness raised rather than lowered.
          accent: `hsl(${Math.round(lead.hue)} 82% ${accentTextLightness(lead.hue)}%)`,
        });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
