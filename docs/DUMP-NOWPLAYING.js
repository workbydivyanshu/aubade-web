/* Paste into DevTools console on music.octavestreaming.com with the expanded
   now-playing view open. Copies a spec sheet to the clipboard and prints it.
   Reads only layout and style — no account data, no network calls. */
(() => {
  const root = document.body;
  const out = { viewport: [innerWidth, innerHeight], dpr: devicePixelRatio, text: [], boxes: [], icons: [] };
  const seen = new Set();
  for (const e of root.querySelectorAll('*')) {
    const b = e.getBoundingClientRect();
    if (b.width < 4 || b.height < 4) continue;
    if (b.bottom < 0 || b.top > innerHeight) continue;
    const s = getComputedStyle(e);
    if (s.visibility === 'hidden' || s.display === 'none' || +s.opacity === 0) continue;
    const own = [...e.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim())
      .map(n => n.textContent.trim()).join(' ');
    if (own && own.length < 80) {
      const k = own + Math.round(b.top);
      if (!seen.has(k)) {
        seen.add(k);
        out.text.push({ t: own.slice(0, 40), x: Math.round(b.left), y: Math.round(b.top),
          w: Math.round(b.width), h: Math.round(b.height), size: s.fontSize, weight: s.fontWeight,
          tr: s.letterSpacing, lh: s.lineHeight, c: s.color, tt: s.textTransform,
          op: s.opacity, filter: s.filter === 'none' ? null : s.filter });
      }
    }
    const surface = (s.backgroundColor && s.backgroundColor !== 'rgba(0, 0, 0, 0)')
      || (s.backgroundImage && s.backgroundImage !== 'none')
      || (s.backdropFilter && s.backdropFilter !== 'none')
      || (s.boxShadow && s.boxShadow !== 'none');
    if (surface && b.width > 16 && b.height > 16) {
      out.boxes.push({ cls: (e.className || '').toString().slice(0, 40),
        x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height),
        bg: s.backgroundColor, img: s.backgroundImage === 'none' ? null : s.backgroundImage.slice(0, 44),
        r: s.borderRadius, blur: s.backdropFilter === 'none' ? null : s.backdropFilter,
        filter: s.filter === 'none' ? null : s.filter, shadow: s.boxShadow.slice(0, 60),
        border: s.borderWidth === '0px' ? null : s.borderWidth + ' ' + s.borderColor });
    }
    if (e.tagName === 'BUTTON' || e.getAttribute('role') === 'button'
        || e.tagName === 'INPUT') {
      out.icons.push({ tag: e.tagName.toLowerCase(), label: (e.getAttribute('aria-label') || '').slice(0, 24),
        x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height),
        r: s.borderRadius, bg: s.backgroundColor, blur: s.backdropFilter === 'none' ? null : s.backdropFilter });
    }
  }
  out.text.sort((a, b) => a.y - b.y || a.x - b.x);
  out.boxes.sort((a, b) => a.y - b.y || a.x - b.x);
  out.icons.sort((a, b) => a.y - b.y || a.x - b.x);
  const json = JSON.stringify(out);
  // copy() only exists in the DevTools console; fall back to printing.
  try { copy(json); console.log('COPIED TO CLIPBOARD — just paste it to Claude.'); }
  catch (e) { console.log('clipboard unavailable, copy the line below:'); console.log(json); }
  console.log(out.text.length + ' text, ' + out.boxes.length + ' boxes, '
    + out.icons.length + ' icons, ' + json.length + ' chars');
  return json.length;
})();
