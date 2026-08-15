# UI Audit: Library, Artist & Search Screens

| Screen | Element | Octave | Aubade | Delta | Severity |
| --- | --- | --- | --- | --- | --- |
| Library | "Liked Songs" hero card | 192×192 cover, radius 36px, bg gradient (pink/cyan/white) at (288,141); "Liked Songs" 14px/600 + "Playlist" 12px/400 below | Absent — content starts at "60 albums" count (14px/400, y=152) | Element missing entirely | High |
| Library | Stats panel | 1120×521 rounded box (radius 36px) at (288,419); 8 rows (Playlists, Artists, Albums, Podcasts, Songs, Downloaded, Local files, Recently played); row icon 36×36 radius 28px; row label 15px/600; row count 14px/400 at x=1350; row pitch ~65px | Absent — no stats panel | Element missing entirely | High |
| Artist | Artist photo circle | 208×208 circle (radius full) bg rgb(20,20,23) at (288,307) | Absent — header is a flat gradient scrim (1120×320); no photo | Element missing entirely | High |
| Artist | Play button | 119×48, radius full, bg rgb(182,195,195) (sage grey) | 99×48, radius 24px, bg rgb(251,44,90) (pink) | Colour sage vs pink; radius full vs 24px; width 119 vs 99px | High |
| Artist | Album card cover radius | 176×176, radius 36px | 176×176, radius 8px | 36px vs 8px radius | High |
| Search | Browse categories grid | "Browse Categories" h2 18px/700 lh 28px (y=141); tiles 263×132, radius 36px, aspect 2:1 at x=304/579/854/1129 (pitch ~275), rows y=181/325/468/612/755/899/1042/1186 (pitch ~143); tile label 18px/600, tracking -0.45px, lh 22.5px; "Concerts near you" h2 18px/700 (y=2067) | Absent — page renders only the search input; no headings, no tiles | Entire browse grid missing | High |
| Artist | Follow button | 87×46, radius full, border 1px white/0.2 at (711,468) | Absent | Element missing entirely | Medium |
| Library | Top-right controls | 3 separate pills (Import 104×38, Party 96×38, New 91×38) at (1100,82)/(1212,82)/(1317,82); radius full, bg rgb(20,20,23), border 1px white/0.08, label 14px/600 | Segmented pill 209×34 (radius 9999px, bg rgba(16,18,25,0.48), blur 46px) with Albums/Artists/Songs 12px/600, plus Sort button 102×32 (13px/500) | Control type differs; label 14 vs 12px; pill height 38 vs 34/32px | Medium |
| Artist | Action buttons (round) | Three 48×48 buttons (radius full, blur 8px) at (520,467)/(810,467)/(870,467) — shuffle, share, more | One 48×48 shuffle button (radius 50%, bg white/0.1, no blur) | 3 vs 1 (two missing); blur 8px vs none | Medium |
| Artist | Track list structure | Index numbers (14px/400 at x=316), track title (14px/500), artist subtitle (12px/400), duration (12px/400) | Cover thumbnails (40×40 radius 6px at x=352), track title (14px/400), album name (13px/400), duration (13px/400) | Index replaced by cover thumbnail; title 500 vs 400; subtitle/duration 12 vs 13px | Medium |
| Artist | Section order | Popular (track list) → Top Songs (grid) → Albums (grid) | Albums (grid) → Songs (track list) | Different sections and ordering | Medium |
| Search | Search input | 1086×50, radius 36px, bg rgb(28,28,32), border 1px white/0.08, left-aligned at (305,70) | 560×44, radius 22px, bg white/0.06, border 1px white/0.14, centred at (568,88) | Width 1086 vs 560px; radius 36 vs 22px; bg/border differ; full-width vs centred | Medium |
| Library | Album grid (Albums tab) | No equivalent grid on Octave /library (nearest: artist-page cards 176×176 radius 36px) | Covers 192×192 radius 8px; cell pitch 208×263; title 14px/500 lh 18.2px; artist 13px/400 lh 16.9px | Cover radius 8px vs Octave 36px (on artist page) | Medium |
| Artist | "See all" links | 14px/600 rgb(163,163,173) beside section titles (y=580) | Absent | Element missing entirely | Medium |
| Artist | Section headers | 24px/700, tracking -0.6px, lh 32px | 24px/700, tracking -0.176px, lh normal | Tracking -0.6 vs -0.176px; lh 32px vs normal | Low |
| Artist | Eyebrow "ARTIST" | 12px/600, tracking 1.2px, lh 16px, white@0.7 | 11px/700, tracking 1px, lh normal, rgb(163,163,173) | 12 vs 11px; 600 vs 700; 1.2 vs 1px tracking | Low |
| Library | Hero title "Your Library" | 36px/700, tracking -0.9px, lh 40px, y=81 | 36px/700, tracking -0.9px, lh 39.6px, y=80 | Line-height 40 vs 39.6px | Low |
| Artist | Artist name line-height | 48px/700, tracking -1.2px, lh 48px | 48px/700, tracking -1.2px, lh 52.8px | Line-height 48 vs 52.8px | Low |
| Artist | Meta line | 14px/400, white@0.6 ("62.7K fans") | 14px/400, rgb(163,163,173) ("5 albums - 60 songs") | Colour white@0.6 vs rgb(163,163,173) | Low |
| Artist | Album card title | 14px/600 | 14px/500 | Weight 600 vs 500 | Low |
| Artist | Album card artist | 12px/400 | 13px/400 | 12 vs 13px | Low |
| Artist | Track subtitle (artist/album) | 12px/400 | 13px/400 | 12 vs 13px | Low |
| Artist | Track duration | 12px/400 | 13px/400 | 12 vs 13px | Low |

## Could not measure

- **Screenshots**: Visual inspection confirmed all findings above, but hover states, transitions, animations, and scroll behavior are not present in a static capture.
- **Library tabs vs Octave**: Octave's `/library` has no Albums/Artists/Songs tabs, album grid, artist circles, or song rows. Our Artists-tab circles (176×176, radius 50%, cell pitch 208×261) and Songs-tab rows (row pitch 52px, title 14px/400, duration 13px/400) were measured but have no direct Octave counterpart on that screen. Nearest references are the artist-page photo (208×208 circle) and the artist-page track list (52px pitch).
- **Octave artist page**: The artist page for "Die drei !!!" shows a large banner image (scribble art), a circular artist photo (208×208), and a "Popular" track list with index numbers. Our artist page for "Olivia Rodrigo" shows a gradient scrim, no photo, and "Albums" then "Songs" sections. Content differences (artist names, album names) were ignored per instruction; only form was compared.
- **Album artwork**: Both sides use gradient placeholders for album covers, so image content was not compared.

## Summary

- High Severity: 6
- Medium Severity: 8
- Low Severity: 9