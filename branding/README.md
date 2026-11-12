# CouchParty brand assets

Everything here is a copy for handing out (stores, socials, press, a slide). The site itself serves its own files from `apps/product-web/public`; change those, then copy them back here.

## Files

| Folder | What | Use it for |
| --- | --- | --- |
| `mark/` | The two-card mark, SVG plus 256/512/1024 px PNGs, transparent | avatars, stickers, anywhere square |
| `lockup/` | Mark plus "CouchParty", SVG plus 540/1080/2160 px wide PNGs, transparent | headers, decks, docs |
| `icons/` | Exactly what the site ships: favicon (svg, ico), apple-touch-icon, PWA icons | app stores, bookmarks |
| `social/` | `og-image.png`, 1200×630 link preview | posts, link cards |

Each mark and lockup comes in two versions:

- `on-light`: the white card has a dark outline, so it doesn't vanish on a light background. Text is ink.
- `on-dark`: no outline, light text.

The lockup's text is outlined (paths, not a font), so the SVG looks the same everywhere without Space Grotesk installed.

## Colours

| Name | Hex | Where |
| --- | --- | --- |
| Lime | `#c6f432` | the back card, accents, highlights on dark |
| Ink | `#0e0e0c` | text on light, dark backgrounds, the heart |
| Paper | `#fffdf8` | light background, the front card |
| Bone | `#f3f1ea` | text on dark |
| Muted | `#5c594f` / `#9c9888` | secondary text on light / on dark |
| Lime text | `#4a6600` | lime-ish small text on light (Lime itself is too pale to read there) |

Flat colours only, no gradients. Anything on a lime fill uses `#141a00`, not Ink.

## Type

[Space Grotesk](https://fonts.google.com/specimen/Space+Grotesk), weights 400, 500 and 700. The wordmark is 700 with -0.01em tracking.

## Rules of thumb

- Leave at least half the mark's width clear around it.
- Don't recolour, rotate or stretch the mark. The tilt is already in it.
- Smallest sizes: mark 16 px, lockup 96 px wide.
