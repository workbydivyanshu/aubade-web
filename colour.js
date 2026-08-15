// Colour maths for the artwork-derived accent.

/** Hue in degrees, saturation and lightness as fractions. */
export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, sat, l];
}
export function hslToRgb(h, s, l) {
  h /= 360;
  const hue = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)].map((x) => Math.round(x * 255));
}
/**
 * Lightness for an artwork-derived accent, as a percentage.
 *
 * The reference fixes this at 46%, which reads well for the reds and pinks its
 * catalogue tends to produce. It does not hold for every hue: at 46% an orange
 * gives white text only 3.7:1, under the 4.5:1 needed to stay legible. So 46%
 * is the starting point and the colour is darkened only for the hues that fall
 * short — yellows need to go a good deal darker — which leaves most albums
 * matching the reference exactly.
 */
export function accentLightness(hue) {
  const white = 1.05;
  for (let l = 46; l >= 20; l -= 2) {
    const [r, g, b] = hslToRgb(hue, 0.82, l / 100);
    const channel = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    const lum = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    if (white / (lum + 0.05) >= 4.5) return l;
  }
  return 20;
}
