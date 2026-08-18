// The page's motion, kept in one place.
//
// Everything here is additive: the stylesheet only hides things once this
// file has set `js` on the document, so with JavaScript off — or if this
// fails to load — the page renders complete and static rather than blank.
'use strict';

const reduced = matchMedia('(prefers-reduced-motion: reduce)');

// The header is transparent over the hero's wash and gains its surface once
// the page has moved, so the two never fight for the same few pixels.
const header = document.querySelector('.lp-header');
const onScroll = () => header.classList.toggle('is-scrolled', scrollY > 40);
addEventListener('scroll', onScroll, { passive: true });
onScroll();

if (!reduced.matches) {
  // Sections arrive once, on the way in. Cards inside a grid inherit a
  // stagger from their index so a row assembles rather than blinking on.
  const seen = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('is-in');
      seen.unobserve(e.target);
    }
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0.12 });

  for (const el of document.querySelectorAll('.reveal')) seen.observe(el);

  document.querySelectorAll('.lp-cards .lp-card').forEach((card, i) => {
    card.style.setProperty('--stagger', `${i * 70}ms`);
  });
  document.querySelectorAll('.lp-stat').forEach((stat, i) => {
    stat.style.setProperty('--stagger', `${i * 70}ms`);
  });
}
