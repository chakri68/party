# Dominion M1 concept generation

Date: 2026-10-08
Tool: codex built-in image_gen
Mode: built-in; no CLI fallback. Four individual initial calls and one city regeneration. PNGs copied unchanged from the generated_images directory. No game code written.

Read assets-spec.md Direction and scope before generation. These are concepts, not normalized production sprites.

Alpha checks use python3 + PIL. Semi-transparent counts alone cannot prove absence of a halo: visual inspection is also recorded. The distance metric measures proximity to the alpha core, not necessarily the subject silhouette.

## terrain.plains.default

File: `terrain.plains.default.png`

Tool: codex built-in image_gen

Date: 2026-10-08

Source: `/home/chakradharreddy/.codex/generated_images/01a11ab0-3b24-7de1-8f10-c7700af759b9/exec-e3ce7460-12d5-4bf5-be6e-8629b152a517.png`

Mode: RGBA; size: 1774×887; corner alpha (TL, TR, BL, BR): [0, 0, 0, 0]; pixels with 0<alpha<200: 10787; those farther than 3 pixels (Chebyshev distance) from alpha>=200: 1225.

Visual halo check: no broad halo visible; narrow edge artifacts remain.

Exact selected-image prompt:

```text
Use case: stylized-concept
Asset type: CONCEPT art for the browser strategy game Dominion; individual PNG asset, not a production atlas.
Subject: one isometric 2:1 diamond tile: flat top in two or three green facets, thin flat brown earth slab sides below. Optionally 2-3 tiny low-poly grass pyramids. Nothing else on it. Diamond fills ~90% of canvas width.
Shared style:
- Stylized LOW-POLY, flat-shaded faceted geometry. Each object is a small number of planar facets with hard angular edges. Every facet is ONE flat solid color: no gradients, no texture, no painterly brushwork, no noise, no outlines, no fine detail. Shading only from facet orientation: light tone on top/left-facing facets, mid tone on front, dark tone on right/shadow-facing facets.
- Chunky simplified silhouettes, toy-like proportions, clean "designed object" look like a minimal 3D render with flat shading. Not realistic, not illustrated.
- Fixed isometric camera, 2:1 diamond ground plane (true dimetric ~26.565 degrees). Light from UPPER LEFT.
- Sample faction "Orchard", warm agrarian culture. Flat saturated palette: apple red #D64541, leaf green #4CAF50, deep green #2E7D32, straw gold #F2C14E, cream #F4E9D0, walnut brown #7A4E2D.
- Fully transparent background with real alpha. NO glow, NO halo, NO vignette, NO drop shadow outside the subject. Single centered subject, even transparent margin.
- No text, letters, UI, health bars, selection rings, watermark. Original design; do not copy Polytopia or any existing game's artwork or units.
```

## unit.infantry.orchard.idle

File: `unit.infantry.orchard.idle.png`

Tool: codex built-in image_gen

Date: 2026-10-08

Source: `/home/chakradharreddy/.codex/generated_images/01a11ab0-3b24-7de1-8f10-c7700af759b9/exec-5ac8c386-bcee-410b-8452-c11f183d1cb2.png`

Mode: RGBA; size: 1254×1254; corner alpha (TL, TR, BL, BR): [0, 0, 0, 0]; pixels with 0<alpha<200: 18535; those farther than 3 pixels (Chebyshev distance) from alpha>=200: 4234.

Visual halo check: no broad halo visible; narrow edge artifacts remain.

Exact selected-image prompt:

```text
Use case: stylized-concept
Asset type: CONCEPT art for the browser strategy game Dominion; individual PNG asset, not a production atlas.
Subject: one low-poly infantry soldier, three-quarter view facing lower-left, standing upright: blocky head with simple cap/helmet, wedge torso in straw gold with green trim facets, short spear (a thin prism with a pyramid tip), round faceted shield whose face is a single flat cream disc (engine paints ownership color there). Feet at bottom center. Canvas square; the figure's height is about 70% of the canvas.
Shared style:
- Stylized LOW-POLY, flat-shaded faceted geometry. Each object is a small number of planar facets with hard angular edges. Every facet is ONE flat solid color: no gradients, no texture, no painterly brushwork, no noise, no outlines, no fine detail. Shading only from facet orientation: light tone on top/left-facing facets, mid tone on front, dark tone on right/shadow-facing facets.
- Chunky simplified silhouettes, toy-like proportions, clean "designed object" look like a minimal 3D render with flat shading. Not realistic, not illustrated.
- Fixed isometric camera, 2:1 diamond ground plane (true dimetric ~26.565 degrees). Light from UPPER LEFT.
- Sample faction "Orchard", warm agrarian culture. Flat saturated palette: apple red #D64541, leaf green #4CAF50, deep green #2E7D32, straw gold #F2C14E, cream #F4E9D0, walnut brown #7A4E2D.
- Fully transparent background with real alpha. NO glow, NO halo, NO vignette, NO drop shadow outside the subject. Single centered subject, even transparent margin.
- No text, letters, UI, health bars, selection rings, watermark. Original design; do not copy Polytopia or any existing game's artwork or units.
```

## city.orchard.tier1

File: `city.orchard.tier1.png`

Tool: codex built-in image_gen

Date: 2026-10-08

Source: `/home/chakradharreddy/.codex/generated_images/01a11ab0-3b24-7de1-8f10-c7700af759b9/exec-ad2b5e39-f555-4d7d-9a16-c8f29f2a33b2.png`

Mode: RGBA; size: 1536×1024; corner alpha (TL, TR, BL, BR): [0, 0, 0, 0]; pixels with 0<alpha<200: 16994; those farther than 3 pixels (Chebyshev distance) from alpha>=200: 3540.

Visual halo check: FAIL. A broad colored halo remains after the single requested regeneration. Saved the regenerated concept, but it does not meet the no-halo requirement. No alpha cleanup applied.

Initial attempt: Mode: RGBA; size: 1536×1024; corner alpha (TL, TR, BL, BR): [0, 0, 0, 0]; pixels with 0<alpha<200: 20762; those farther than 3 pixels (Chebyshev distance) from alpha>=200: 7027.

Initial exact prompt:

```text
Use case: stylized-concept
Asset type: CONCEPT art for the browser strategy game Dominion; individual PNG asset, not a production atlas.
Subject: a small village sitting on one 2:1 diamond footprint of flat green facets: two or three low-poly cottages (cream box walls, red prism roofs), one faceted apple tree (green polyhedron canopy with a few red cube apples), and one pole with a blank flat cream pennant. Buildings rise above the diamond.
Shared style:
- Stylized LOW-POLY, flat-shaded faceted geometry. Each object is a small number of planar facets with hard angular edges. Every facet is ONE flat solid color: no gradients, no texture, no painterly brushwork, no noise, no outlines, no fine detail. Shading only from facet orientation: light tone on top/left-facing facets, mid tone on front, dark tone on right/shadow-facing facets.
- Chunky simplified silhouettes, toy-like proportions, clean "designed object" look like a minimal 3D render with flat shading. Not realistic, not illustrated.
- Fixed isometric camera, 2:1 diamond ground plane (true dimetric ~26.565 degrees). Light from UPPER LEFT.
- Sample faction "Orchard", warm agrarian culture. Flat saturated palette: apple red #D64541, leaf green #4CAF50, deep green #2E7D32, straw gold #F2C14E, cream #F4E9D0, walnut brown #7A4E2D.
- Fully transparent background with real alpha. NO glow, NO halo, NO vignette, NO drop shadow outside the subject. Single centered subject, even transparent margin.
- No text, letters, UI, health bars, selection rings, watermark. Original design; do not copy Polytopia or any existing game's artwork or units.
```

Exact selected-image prompt:

```text
Use case: stylized-concept
Asset type: CONCEPT art for the browser strategy game Dominion; individual PNG asset, not a production atlas.
Subject: a small village sitting on one 2:1 diamond footprint of flat green facets: two or three low-poly cottages (cream box walls, red prism roofs), one faceted apple tree (green polyhedron canopy with a few red cube apples), and one pole with a blank flat cream pennant. Buildings rise above the diamond.
Shared style:
- Stylized LOW-POLY, flat-shaded faceted geometry. Each object is a small number of planar facets with hard angular edges. Every facet is ONE flat solid color: no gradients, no texture, no painterly brushwork, no noise, no outlines, no fine detail. Shading only from facet orientation: light tone on top/left-facing facets, mid tone on front, dark tone on right/shadow-facing facets.
- Chunky simplified silhouettes, toy-like proportions, clean "designed object" look like a minimal 3D render with flat shading. Not realistic, not illustrated.
- Fixed isometric camera, 2:1 diamond ground plane (true dimetric ~26.565 degrees). Light from UPPER LEFT.
- Sample faction "Orchard", warm agrarian culture. Flat saturated palette: apple red #D64541, leaf green #4CAF50, deep green #2E7D32, straw gold #F2C14E, cream #F4E9D0, walnut brown #7A4E2D.
- Fully transparent background with real alpha. NO glow, NO halo, NO vignette, NO drop shadow outside the subject. Single centered subject, even transparent margin.
- No text, letters, UI, health bars, selection rings, watermark. Original design; do not copy Polytopia or any existing game's artwork or units.
Transparency correction: Output a clean hard-edged cutout. Every pixel outside the actual polygon silhouette must have alpha exactly 0. No soft colored aura around the tree, flag, roofs or ground; no bloom or ambient haze. Opaque solid-color polygon interiors, with at most a narrow antialiased edge. Keep only the requested cottages, apple tree, blank pennant and diamond footprint; omit rocks and extra decoration.
```

## crest.orchard

File: `crest.orchard.png`

Tool: codex built-in image_gen

Date: 2026-10-08

Source: `/home/chakradharreddy/.codex/generated_images/01a11ab0-3b24-7de1-8f10-c7700af759b9/exec-5d8c24ee-dda4-46c7-9a28-1655de172ed0.png`

Mode: RGBA; size: 1230×1278; corner alpha (TL, TR, BL, BR): [0, 0, 0, 0]; pixels with 0<alpha<200: 10269; those farther than 3 pixels (Chebyshev distance) from alpha>=200: 1208.

Visual halo check: no broad halo visible; narrow edge artifacts remain.

Exact selected-image prompt:

```text
Use case: stylized-concept
Asset type: CONCEPT art for the browser strategy game Dominion; individual PNG asset, not a production atlas.
Subject: flat front-view heraldic shield (not isometric), split green/gold field, a geometric faceted apple with an angular leaf. Built from flat polygons only. Must read at 32px. For this crest only, front view overrides the shared isometric camera instruction.
Shared style:
- Stylized LOW-POLY, flat-shaded faceted geometry. Each object is a small number of planar facets with hard angular edges. Every facet is ONE flat solid color: no gradients, no texture, no painterly brushwork, no noise, no outlines, no fine detail. Shading only from facet orientation: light tone on top/left-facing facets, mid tone on front, dark tone on right/shadow-facing facets.
- Chunky simplified silhouettes, toy-like proportions, clean "designed object" look like a minimal 3D render with flat shading. Not realistic, not illustrated.
- Fixed isometric camera, 2:1 diamond ground plane (true dimetric ~26.565 degrees). Light from UPPER LEFT.
- Sample faction "Orchard", warm agrarian culture. Flat saturated palette: apple red #D64541, leaf green #4CAF50, deep green #2E7D32, straw gold #F2C14E, cream #F4E9D0, walnut brown #7A4E2D.
- Fully transparent background with real alpha. NO glow, NO halo, NO vignette, NO drop shadow outside the subject. Single centered subject, even transparent margin.
- No text, letters, UI, health bars, selection rings, watermark. Original design; do not copy Polytopia or any existing game's artwork or units.
```

## Visual limitations

Generated concepts deviate from strict flat-color geometry: some facets show tonal variation. Terrain contains more grass pyramids and facets than requested. Infantry shield face is subdivided instead of a single uniform cream disc, and figure occupies more than 70% of its canvas. Crest has a beveled border and more facets than the requested minimal mark. City retains a broad halo after its one retry. Production normalization remains necessary.

## city.orchard.tier1 (chroma-key regeneration)

Date: 2026-10-08
Mode: built-in image_gen

Prompt:

Stylized LOW-POLY, flat-shaded faceted geometry. Few planar facets, hard angular edges, every facet one flat solid color, no gradients, no texture, no outlines, no glow, no bloom, no vignette, no drop shadow. Shading only from facet orientation; light from upper left. Fixed isometric camera, 2:1 diamond ground (true dimetric). Palette: apple red #D64541, leaf green #4CAF50, deep green #2E7D32, straw gold #F2C14E, cream #F4E9D0, walnut brown #7A4E2D.
Subject: a small village on one 2:1 diamond footprint of flat green facets with thin brown earth slab sides: two low-poly cottages (cream box walls, red prism roofs), one faceted apple tree (green polyhedron canopy, a few red cube apples), one wooden pole with a blank flat cream pennant. Single centered subject with an even margin.
BACKGROUND: perfectly flat uniform solid magenta #FF00FF filling the entire canvas edge to edge. No magenta anywhere in the subject. No lighting effects on the background.
No text, UI, watermark. Original design, not copying any existing game.
