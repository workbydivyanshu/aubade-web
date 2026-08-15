// Card builders, and the observer that fills their artwork in as they
// scroll into view.

import { albumKey } from './library.js';
import { gradientFor, coverUrlForAlbum } from './art.js';

let coverObserver;

export function setupCoverObserver() {
  if (coverObserver) return;
  coverObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const el = entry.target;
      coverObserver.unobserve(el);
      const albumData = el._albumData;
      if (!albumData) continue;
      coverUrlForAlbum(albumData).then((url) => {
        if (url) {
          el.style.backgroundImage = `url(${url})`;
          el.style.backgroundSize = 'cover';
          el.style.backgroundPosition = 'center';
        } else {
          console.warn('[cover-diag] coverUrlForAlbum returned null for:', albumData.album, '| first track path:', albumData.tracks?.[0]?.path ?? '(no tracks)');
        }
      });
    }
  }, { rootMargin: '200px' });
}

export function makeShelfCard(album) {
  const key = albumKey(album);
  const grad = gradientFor(key);
  const a = document.createElement('a');
  a.className = 'shelf-card';
  a.href = '#';
  a.dataset.album = key;

  const cover = document.createElement('div');
  cover.className = 'shelf-card__cover';
  cover.style.background = `linear-gradient(135deg,${grad})`;
  cover._albumData = album;
  setupCoverObserver();
  coverObserver.observe(cover);

  const title = document.createElement('span');
  title.className = 'shelf-card__title';
  title.textContent = album.album;

  const artist = document.createElement('span');
  artist.className = 'shelf-card__artist';
  artist.textContent = album.albumArtist;

  a.append(cover, title, artist);
  return a;
}

export function makeQuickCard(album) {
  const key = albumKey(album);
  const grad = gradientFor(key);
  const a = document.createElement('a');
  a.className = 'quick-card';
  a.href = '#';
  a.dataset.album = key;

  const cover = document.createElement('div');
  cover.className = 'quick-card__cover';
  cover.style.background = `linear-gradient(135deg,${grad})`;
  cover._albumData = album;
  setupCoverObserver();
  coverObserver.observe(cover);

  const label = document.createElement('span');
  label.className = 'quick-card__label';
  label.textContent = album.album;

  a.append(cover, label);
  return a;
}

export function renderHero(heroEl, album) {
  if (!album) return;
  const key = albumKey(album);
  const grad = gradientFor(key);
  heroEl.dataset.album = key;

  const coverEl = heroEl.querySelector('.hero-card__cover');
  if (coverEl) {
    // If it was already observed, unobserve first to reset its state
    setupCoverObserver();
    coverObserver.unobserve(coverEl);
    
    // Instead of using 'background' shorthand which resets background-size/position,
    // we set background-image to the gradient. That way, the observer's backgroundImage
    // URL won't be broken by a shorthand reset if it happens async.
    coverEl.style.backgroundImage = `linear-gradient(135deg,${grad})`;
    coverEl._albumData = album;
    coverObserver.observe(coverEl);
  }

  const eyebrow = heroEl.querySelector('.hero-card__eyebrow');
  if (eyebrow) eyebrow.textContent = 'BIGGEST ALBUM';

  const titleEl = heroEl.querySelector('.hero-card__title');
  if (titleEl) titleEl.textContent = album.album;

  const artistEl = heroEl.querySelector('.hero-card__artist');
  if (artistEl) artistEl.textContent = album.albumArtist;
}
