## 2026-08-15T19:06:00-04:00 — Antigravity

CONFIRMED
- "Collapse sidebar" button is inert. Repro: `document.querySelector('button[aria-label="Collapse sidebar"]').click()`. Expected sidebar to collapse, got nothing.
- "Add pinned item" button is inert. Repro: `document.querySelector('button[aria-label="Add pinned item"]').click()`. Expected a pin dialog/action, got nothing.
- "Notifications" button is inert. Repro: `document.querySelector('button[aria-label="Notifications"]').click()`. Expected a notifications panel, got nothing.
- "Library" segment pill on Home is inert. Repro: `document.getElementById('seg-library').click()`. Expected to switch to the library view, got nothing.
- "Share" button on hero card is inert. Repro: `document.querySelector('.hero-card__share').click()`. Expected a share action/clipboard copy, got nothing.
- "More options" buttons on album/artist pages are inert. Repro: `document.querySelector('.album-btn--more').click()`. Expected a popover menu, got nothing.

Checked and clean: keyboard shortcuts, visual EQ sync, liked songs view, media session registration, now-playing popover menu.

## 2026-08-16T07:43:00-04:00 — Antigravity (aa06723)

CONFIRMED
- "Notifications" button is inert. Repro: `document.querySelector('button[aria-label="Notifications"]').click()`. Expected a notifications panel, got nothing.
- "Add pinned item" button is inert. Repro: `document.querySelector('button[aria-label="Add pinned item"]').click()`. Expected a pin dialog/action, got nothing.
- "See all" links on Home shelves are inert. Repro: click any `.shelf__see-all` or evaluate `document.querySelector('.shelf__see-all').click()`. Expected to navigate to a full list, instead URL hash changes to `#` which reloads Home.
- "More options" button on Artist page is inert. Repro: visit an artist page, evaluate `document.getElementById('artist-more-btn').click()`. Expected menu to open, got nothing (listener is only bound to the album page's button).

UNVERIFIED

Checked and clean: Routing for all views, keyboard shortcuts, media session registration, hero-card share, segment library pill, sidebar expand.

## 2026-08-16T08:03:34 — Antigravity (8f19d61)

CONFIRMED
- "Notifications" button is inert. Repro: `document.querySelector('button[aria-label="Notifications"]').click()`. Expected a notifications panel, got nothing.
- "Add pinned item" button is inert. Repro: `document.querySelector('button[aria-label="Add pinned item"]').click()`. Expected a pin dialog/action, got nothing.

UNVERIFIED

Checked and clean: Routing for all views, keyboard shortcuts, media session registration, hero-card share, segment library pill, sidebar expand, "See all" shelf links, "More options" on Artist page.
