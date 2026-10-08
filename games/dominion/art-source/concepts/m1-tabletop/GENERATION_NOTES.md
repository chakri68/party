# Dominion M1 concept generation notes

Date: 2026-10-08

Context: `assets-spec.md`. Four separate built-in calls, one per asset; no CLI fallback. Original generated PNGs copied unchanged from `/home/chakradharreddy/.codex/generated_images/01a11aa8-865d-7881-8c92-23e5a03616fb/`. These are concept art, not normalized production sprites or ownership masks.

Transparency was checked using python3 + PIL (Pillow), inspecting image mode, alpha extrema and fully transparent pixel counts. All four have real alpha channels with transparent pixels; this does not certify that all pixels outside the intended footprint are clear.

Visual review: the village includes a broad colored glow beyond the footprint, contrary to the requested small contact shadow. The terrain has more grass texture than the requested restrained treatment; the crest has painted shading and a beveled border rather than strictly flat fills. Camera, scale and margins still need production normalization. Outputs are retained without edits to honor the requested four calls, one per image.

## terrain.plains.default

- File: `terrain.plains.default.png`
- ID: `terrain.plains.default`
- Tool: codex built-in image_gen
- Date: 2026-10-08
- Real alpha channel: Yes. 1774 × 887; RGBA; alpha range 0–255; 854,442 fully transparent pixels.

Exact prompt:

```text
Use case: stylized-concept.
Create one separate PNG concept-art image for the browser strategy game Dominion.
Shared style: Original illustrated miniature kingdom, like painted wooden tabletop miniatures. Chunky readable silhouettes, restrained texture, soft clean dark-brown outline. Fixed isometric camera, 2:1 diamond ground plane (true 2:1 dimetric, ~26.565 degrees). Light from the UPPER LEFT, soft shadow falling lower right. Sample faction "Orchard": warm agrarian culture. Palette: apple red, leaf green, straw gold, cream plaster, walnut brown. Fully transparent background with real PNG alpha, single centered subject, generous even transparent margin, no ground shadow outside the footprint except a small soft contact shadow. No text, no letters, no UI, no health bars, no selection rings, no watermark. Do not imitate Polytopia or any existing game.
These are concept images, not a production sprite atlas. Preserve clear silhouettes suitable for eventual small game sprites.
Subject: One isometric 2:1 diamond grass tile with a short earthy edge/thickness below it, a few tiny tufts and flowers. Tile only, nothing standing on it. Diamond centered, its width filling ~90% of the canvas. The top ground diamond width is exactly twice its height; its sloping edges are approximately 26.565 degrees from horizontal.
```

## unit.infantry.orchard.idle

- File: `unit.infantry.orchard.idle.png`
- ID: `unit.infantry.orchard.idle`
- Tool: codex built-in image_gen
- Date: 2026-10-08
- Real alpha channel: Yes. 1368 × 1150; RGBA; alpha range 0–255; 1,139,222 fully transparent pixels.

Exact prompt:

```text
Use case: stylized-concept.
Create one separate PNG concept-art image for the browser strategy game Dominion.
Shared style: Original illustrated miniature kingdom, like painted wooden tabletop miniatures. Chunky readable silhouettes, restrained texture, soft clean dark-brown outline. Fixed isometric camera, 2:1 diamond ground plane (true 2:1 dimetric, ~26.565 degrees). Light from the UPPER LEFT, soft shadow falling lower right. Sample faction "Orchard": warm agrarian culture. Palette: apple red, leaf green, straw gold, cream plaster, walnut brown. Fully transparent background with real PNG alpha, single centered subject, generous even transparent margin, no ground shadow outside the footprint except a small soft contact shadow. No text, no letters, no UI, no health bars, no selection rings, no watermark. Do not imitate Polytopia or any existing game.
These are concept images, not a production sprite atlas. Preserve clear silhouettes suitable for eventual small game sprites.
Subject: A single stocky infantry soldier miniature, three-quarter view facing lower-left, holding a short spear and a round wooden shield. Straw-gold tunic, leaf-green trim. Shield center is a plain flat empty disc (an ownership color mask will be painted there by the engine): no boss, emblem, decoration, or texture in that center disc. Feet at bottom center of the subject, with transparent margin below. No terrain tile or pedestal.
```

## city.orchard.tier1

- File: `city.orchard.tier1.png`
- ID: `city.orchard.tier1`
- Tool: codex built-in image_gen
- Date: 2026-10-08
- Real alpha channel: Yes. 1536 × 1024; RGBA; alpha range 0–254; 980,159 fully transparent pixels. No pixel is fully opaque.

Exact prompt:

```text
Use case: stylized-concept.
Create one separate PNG concept-art image for the browser strategy game Dominion.
Shared style: Original illustrated miniature kingdom, like painted wooden tabletop miniatures. Chunky readable silhouettes, restrained texture, soft clean dark-brown outline. Fixed isometric camera, 2:1 diamond ground plane (true 2:1 dimetric, ~26.565 degrees). Light from the UPPER LEFT, soft shadow falling lower right. Sample faction "Orchard": warm agrarian culture. Palette: apple red, leaf green, straw gold, cream plaster, walnut brown. Fully transparent background with real PNG alpha, single centered subject, generous even transparent margin, no ground shadow outside the footprint except a small soft contact shadow. No text, no letters, no UI, no health bars, no selection rings, no watermark. Do not imitate Polytopia or any existing game.
These are concept images, not a production sprite atlas. Preserve clear silhouettes suitable for eventual small game sprites.
Subject: A small village on a single 2:1 diamond footprint: two or three timber-and-cream-plaster cottages with red tile roofs, a small apple tree, a low fence. Buildings can rise above the diamond. Leave one small blank pennant on a pole uncolored (neutral cream) for engine ownership tint. Ground diamond width is twice its height; sloping edges approximately 26.565 degrees from horizontal. Keep the entire village and footprint visible.
```

## crest.orchard

- File: `crest.orchard.png`
- ID: `crest.orchard`
- Tool: codex built-in image_gen
- Date: 2026-10-08
- Real alpha channel: Yes. 1247 × 1261; RGBA; alpha range 0–255; 775,298 fully transparent pixels.

Exact prompt:

```text
Use case: stylized-concept.
Create one separate PNG concept-art image for the browser strategy game Dominion.
Shared style: Original illustrated miniature kingdom, like painted wooden tabletop miniatures. Chunky readable silhouettes, restrained texture, soft clean dark-brown outline. Fixed isometric camera, 2:1 diamond ground plane (true 2:1 dimetric, ~26.565 degrees). Light from the UPPER LEFT, soft shadow falling lower right. Sample faction "Orchard": warm agrarian culture. Palette: apple red, leaf green, straw gold, cream plaster, walnut brown. Fully transparent background with real PNG alpha, single centered subject, generous even transparent margin, no ground shadow outside the footprint except a small soft contact shadow. No text, no letters, no UI, no health bars, no selection rings, no watermark. Do not imitate Polytopia or any existing game.
These are concept images, not a production sprite atlas. Preserve clear silhouettes suitable for eventual small game sprites.
Subject: A flat heraldic shield crest: stylized apple with a leaf, on a split green/gold field, front view (not isometric). This crest is the explicit camera exception to the shared isometric scene style. Simple enough to read at 32px, bold clean shapes, minimal detail, flat frontal heraldry with the same soft dark-brown outline and Orchard palette. No ground plane or pedestal.
```

