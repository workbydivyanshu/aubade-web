// Browse: the facets a local library can actually offer — genre, decade
// and year, all read from the files' own tags.

import { state } from './state.js';
import { gradientFor } from './art.js';
import { makeShelfCard } from './cards.js';

export function browseFacets() {
  const genres = new Map();
  const decades = new Map();
  const years = new Map();
  for (const a of state.library.albums || []) {
    const g = (a.tracks.find((t) => t.genre) || {}).genre;
    if (g) genres.set(g, (genres.get(g) || 0) + 1);
    if (a.year) {
      const d = Math.floor(a.year / 10) * 10;
      decades.set(d, (decades.get(d) || 0) + 1);
      years.set(a.year, (years.get(a.year) || 0) + 1);
    }
  }
  const sortByCount = (m) => [...m.entries()].sort((x, y) => y[1] - x[1] || String(x[0]).localeCompare(String(y[0])));
  return {
    genres: sortByCount(genres),
    decades: [...decades.entries()].sort((x, y) => y[0] - x[0]),
    years: [...years.entries()].sort((x, y) => y[0] - x[0]),
  };
}

export function albumsMatching(kind, value) {
  return (state.library.albums || []).filter((a) => {
    if (kind === 'genre') return a.tracks.some((t) => t.genre === value);
    if (kind === 'decade') return a.year && Math.floor(a.year / 10) * 10 === +value;
    if (kind === 'year') return a.year === +value;
    return false;
  });
}

export function makeBrowseTile(kind, value, label, count) {
  const a = document.createElement('a');
  a.className = 'browse-tile';
  a.href = `#browse/${kind}/${encodeURIComponent(value)}`;
  a.style.backgroundImage = `linear-gradient(135deg,${gradientFor(kind + value)})`;
  const name = document.createElement('span');
  name.className = 'browse-tile__label';
  name.textContent = label;
  const n = document.createElement('span');
  n.className = 'browse-tile__count';
  n.textContent = `${count} album${count === 1 ? '' : 's'}`;
  a.append(name, n);
  return a;
}

export function renderBrowseView(kind, value) {
  const body = document.getElementById('browse-body');
  const title = document.getElementById('browse-title');
  body.innerHTML = '';

  if (kind) {
    const albums = albumsMatching(kind, value);
    title.textContent = kind === 'decade' ? `${value}s` : value;
    const count = document.createElement('p');
    count.className = 'browse-count';
    count.textContent = `${albums.length} album${albums.length === 1 ? '' : 's'}`;
    const grid = document.createElement('div');
    grid.className = 'lib-grid--albums';
    for (const a of albums) grid.appendChild(makeShelfCard(a));
    body.append(count, grid);
    return;
  }

  title.textContent = 'Browse';
  const facets = browseFacets();
  const sections = [
    ['Genres', 'genre', facets.genres, (k) => k],
    ['Decades', 'decade', facets.decades, (k) => `${k}s`],
    ['Years', 'year', facets.years, (k) => String(k)],
  ];
  for (const [heading, kindName, entries, fmt] of sections) {
    if (!entries.length) continue;
    const section = document.createElement('section');
    section.className = 'browse-section';
    const h = document.createElement('h2');
    h.className = 'shelf__title';
    h.textContent = heading;
    const grid = document.createElement('div');
    grid.className = 'browse-grid';
    for (const [key, n] of entries) {
      grid.appendChild(makeBrowseTile(kindName, key, fmt(key), n));
    }
    section.append(h, grid);
    body.appendChild(section);
  }
  if (!body.children.length) {
    const p = document.createElement('p');
    p.className = 'browse-count';
    p.textContent = 'Nothing to browse by yet — your files carry no genre or year tags.';
    body.appendChild(p);
  }
}
