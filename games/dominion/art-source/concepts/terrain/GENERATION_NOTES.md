# Terrain generation notes

## Retry record and final selection

Each image was regenerated exactly once (20 built-in calls total). All initial keyed images failed at least one corner-alpha check. The plains.v2 first attempt was rejected for black background/glow. mountain.default retry was rejected for incorrect canvas dimensions; its first image remains selected. All other retries are selected. The ocean.default retry fixes the earlier four-wave issue.

### terrain.plains.v3 retry

Date: 2026-10-08. Tool: codex built-in image_gen. Style reference: terrain.plains.default.png.

Source: /home/chakradharreddy/.codex/generated_images/01a11ab8-6cee-7d70-a80a-1c3357b5fc35/exec-a4d257fa-1184-4593-9cc1-5df8945e2730.png

Exact retry prompt:

```text
Use case: stylized-concept. Generate terrain.plains.v3: plains tile, green top facets, two small clusters of yellow-green grass pyramids.
Use the supplied terrain.plains.default.png as STYLE REFERENCE: match its camera, diamond proportions, slab thickness, facet size and flat colors exactly. Preserve the tile size and position across the series. Replace its grass props with the requested subject.
Stylized LOW-POLY, flat-shaded faceted geometry. Hard angular edges, every facet one flat solid color, no gradients, no texture, no outlines, no glow, no bloom, no vignette, no drop shadow. Shading only from facet orientation; light from upper left. Fixed isometric camera, one 2:1 diamond tile (true dimetric ~26.565 degrees) with a thin earth slab underneath, the diamond filling ~90% of canvas width, same size and position in every image. Canvas 1536x1024. FACET BUDGET: tile top 3-6 large facets; each prop under ~12 facets. Props stay within the diamond footprint; tall props may rise above it.
BACKGROUND: perfectly flat uniform solid magenta #FF00FF filling the whole canvas. No magenta or pink anywhere in the subject. No text, UI, watermark. Original design, not copying any existing game.
CRITICAL: background must be opaque solid RGB(255,0,255), not black or transparent. Remove all glow and soft lighting. Each polygon is a uniform color. This is a chroma-key sprite.
RETRY FOR CHROMA KEY FAILURE: Make the entire background including all four corner pixels exactly #FF00FF. No color variation, compression noise, edge vignette or background shading. Keep the subject completely free of pink.
```

### terrain.forest.default retry

Date: 2026-10-08. Tool: codex built-in image_gen. Style reference: terrain.plains.default.png.

Source: /home/chakradharreddy/.codex/generated_images/01a11ab8-6cee-7d70-a80a-1c3357b5fc35/exec-831e8657-7dd4-4f23-ab1e-868dfdf2d566.png

Exact retry prompt:

```text
Use case: stylized-concept. Generate terrain.forest.default: green tile with 3 low-poly conifer trees (stacked dark-green cones, brown prism trunks), slightly varied heights.
Use the supplied terrain.plains.default.png as STYLE REFERENCE: match its camera, diamond proportions, slab thickness, facet size and flat colors exactly. Preserve the tile size and position across the series. Replace its grass props with the requested subject.
Stylized LOW-POLY, flat-shaded faceted geometry. Hard angular edges, every facet one flat solid color, no gradients, no texture, no outlines, no glow, no bloom, no vignette, no drop shadow. Shading only from facet orientation; light from upper left. Fixed isometric camera, one 2:1 diamond tile (true dimetric ~26.565 degrees) with a thin earth slab underneath, the diamond filling ~90% of canvas width, same size and position in every image. Canvas 1536x1024. FACET BUDGET: tile top 3-6 large facets; each prop under ~12 facets. Props stay within the diamond footprint; tall props may rise above it.
BACKGROUND: perfectly flat uniform solid magenta #FF00FF filling the whole canvas. No magenta or pink anywhere in the subject. No text, UI, watermark. Original design, not copying any existing game.
CRITICAL: background must be opaque solid RGB(255,0,255), not black or transparent. Remove all glow and soft lighting. Each polygon is a uniform color. This is a chroma-key sprite.
RETRY FOR CHROMA KEY FAILURE: Make the entire background including all four corner pixels exactly #FF00FF. No color variation, compression noise, edge vignette or background shading. Keep the subject completely free of pink.
```

### terrain.forest.v2 retry

Date: 2026-10-08. Tool: codex built-in image_gen. Style reference: terrain.plains.default.png.

Source: /home/chakradharreddy/.codex/generated_images/01a11ab8-6cee-7d70-a80a-1c3357b5fc35/exec-c9532f8f-b7f9-483d-a21d-f3a30a6f3dc9.png

Exact retry prompt:

```text
Use case: stylized-concept. Generate terrain.forest.v2: green tile with 2 rounded broadleaf trees (faceted polyhedron canopies) and one small conifer.
Use the supplied terrain.plains.default.png as STYLE REFERENCE: match its camera, diamond proportions, slab thickness, facet size and flat colors exactly. Preserve the tile size and position across the series. Replace its grass props with the requested subject.
Stylized LOW-POLY, flat-shaded faceted geometry. Hard angular edges, every facet one flat solid color, no gradients, no texture, no outlines, no glow, no bloom, no vignette, no drop shadow. Shading only from facet orientation; light from upper left. Fixed isometric camera, one 2:1 diamond tile (true dimetric ~26.565 degrees) with a thin earth slab underneath, the diamond filling ~90% of canvas width, same size and position in every image. Canvas 1536x1024. FACET BUDGET: tile top 3-6 large facets; each prop under ~12 facets. Props stay within the diamond footprint; tall props may rise above it.
BACKGROUND: perfectly flat uniform solid magenta #FF00FF filling the whole canvas. No magenta or pink anywhere in the subject. No text, UI, watermark. Original design, not copying any existing game.
CRITICAL: background must be opaque solid RGB(255,0,255), not black or transparent. Remove all glow and soft lighting. Each polygon is a uniform color. This is a chroma-key sprite.
RETRY FOR CHROMA KEY FAILURE: Make the entire background including all four corner pixels exactly #FF00FF. No color variation, compression noise, edge vignette or background shading. Keep the subject completely free of pink.
```

### terrain.mountain.default retry

Date: 2026-10-08. Tool: codex built-in image_gen. Style reference: terrain.plains.default.png.

Source: /home/chakradharreddy/.codex/generated_images/01a11ab8-6cee-7d70-a80a-1c3357b5fc35/exec-d05fe7c5-64ee-470b-b5c3-18dc370e97d7.png

Exact retry prompt:

```text
Use case: stylized-concept. Generate terrain.mountain.default: tile whose top is a grey-brown faceted mountain: one big angular peak with a flat white snow cap, plus a small foothill. Grey stone slab sides.
Use the supplied terrain.plains.default.png as STYLE REFERENCE: match its camera, diamond proportions, slab thickness, facet size and flat colors exactly. Preserve the tile size and position across the series. Replace its grass props with the requested subject.
Stylized LOW-POLY, flat-shaded faceted geometry. Hard angular edges, every facet one flat solid color, no gradients, no texture, no outlines, no glow, no bloom, no vignette, no drop shadow. Shading only from facet orientation; light from upper left. Fixed isometric camera, one 2:1 diamond tile (true dimetric ~26.565 degrees) with a thin earth slab underneath, the diamond filling ~90% of canvas width, same size and position in every image. Canvas 1536x1024. FACET BUDGET: tile top 3-6 large facets; each prop under ~12 facets. Props stay within the diamond footprint; tall props may rise above it.
BACKGROUND: perfectly flat uniform solid magenta #FF00FF filling the whole canvas. No magenta or pink anywhere in the subject. No text, UI, watermark. Original design, not copying any existing game.
CRITICAL: background must be opaque solid RGB(255,0,255), not black or transparent. Remove all glow and soft lighting. Each polygon is a uniform color. This is a chroma-key sprite.
RETRY FOR CHROMA KEY FAILURE: Make the entire background including all four corner pixels exactly #FF00FF. No color variation, compression noise, edge vignette or background shading. Keep the subject completely free of pink.
```

### terrain.mountain.v2 retry

Date: 2026-10-08. Tool: codex built-in image_gen. Style reference: terrain.plains.default.png.

Source: /home/chakradharreddy/.codex/generated_images/01a11ab8-6cee-7d70-a80a-1c3357b5fc35/exec-12d0890e-9692-42a1-b923-0c9c9a79568f.png

Exact retry prompt:

```text
Use case: stylized-concept. Generate terrain.mountain.v2: tile with two sharp grey angular peaks of different heights, no snow, a few green facets at the base.
Use the supplied terrain.plains.default.png as STYLE REFERENCE: match its camera, diamond proportions, slab thickness, facet size and flat colors exactly. Preserve the tile size and position across the series. Replace its grass props with the requested subject.
Stylized LOW-POLY, flat-shaded faceted geometry. Hard angular edges, every facet one flat solid color, no gradients, no texture, no outlines, no glow, no bloom, no vignette, no drop shadow. Shading only from facet orientation; light from upper left. Fixed isometric camera, one 2:1 diamond tile (true dimetric ~26.565 degrees) with a thin earth slab underneath, the diamond filling ~90% of canvas width, same size and position in every image. Canvas 1536x1024. FACET BUDGET: tile top 3-6 large facets; each prop under ~12 facets. Props stay within the diamond footprint; tall props may rise above it.
BACKGROUND: perfectly flat uniform solid magenta #FF00FF filling the whole canvas. No magenta or pink anywhere in the subject. No text, UI, watermark. Original design, not copying any existing game.
CRITICAL: background must be opaque solid RGB(255,0,255), not black or transparent. Remove all glow and soft lighting. Each polygon is a uniform color. This is a chroma-key sprite.
RETRY FOR CHROMA KEY FAILURE: Make the entire background including all four corner pixels exactly #FF00FF. No color variation, compression noise, edge vignette or background shading. Keep the subject completely free of pink.
```

### terrain.water.shallow.default retry

Date: 2026-10-08. Tool: codex built-in image_gen. Style reference: terrain.plains.default.png.

Source: /home/chakradharreddy/.codex/generated_images/01a11ab8-6cee-7d70-a80a-1c3357b5fc35/exec-a7b20a8d-9136-4ba7-9969-52a3d6e41e76.png

Exact retry prompt:

```text
Use case: stylized-concept. Generate terrain.water.shallow.default: tile with a light turquoise water top in 3-4 flat facets, a sandy-beige slab side, one tiny flat lighter facet suggesting a ripple. Water surface sits slightly below the slab rim.
Use the supplied terrain.plains.default.png as STYLE REFERENCE: match its camera, diamond proportions, slab thickness, facet size and flat colors exactly. Preserve the tile size and position across the series. Replace its grass props with the requested subject.
Stylized LOW-POLY, flat-shaded faceted geometry. Hard angular edges, every facet one flat solid color, no gradients, no texture, no outlines, no glow, no bloom, no vignette, no drop shadow. Shading only from facet orientation; light from upper left. Fixed isometric camera, one 2:1 diamond tile (true dimetric ~26.565 degrees) with a thin earth slab underneath, the diamond filling ~90% of canvas width, same size and position in every image. Canvas 1536x1024. FACET BUDGET: tile top 3-6 large facets; each prop under ~12 facets. Props stay within the diamond footprint; tall props may rise above it.
BACKGROUND: perfectly flat uniform solid magenta #FF00FF filling the whole canvas. No magenta or pink anywhere in the subject. No text, UI, watermark. Original design, not copying any existing game.
CRITICAL: background must be opaque solid RGB(255,0,255), not black or transparent. Remove all glow and soft lighting. Each polygon is a uniform color. This is a chroma-key sprite.
RETRY FOR CHROMA KEY FAILURE: Make the entire background including all four corner pixels exactly #FF00FF. No color variation, compression noise, edge vignette or background shading. Keep the subject completely free of pink. Output must be 1536x1024.
```

### terrain.water.shallow.v2 retry

Date: 2026-10-08. Tool: codex built-in image_gen. Style reference: terrain.plains.default.png.

Source: /home/chakradharreddy/.codex/generated_images/01a11ab8-6cee-7d70-a80a-1c3357b5fc35/exec-2efb1650-7d5b-484b-9e83-9d29cea5c869.png

Exact retry prompt:

```text
Use case: stylized-concept. Generate terrain.water.shallow.v2: shallow water tile with a light turquoise water top in 3-4 flat facets, sandy-beige slab sides, water surface slightly below the slab rim. Tiny flat lighter ripple facets arranged differently, toward the right side, and one small sand bar facet.
Use the supplied terrain.plains.default.png as STYLE REFERENCE: match its camera, diamond proportions, slab thickness, facet size and flat colors exactly. Preserve the tile size and position across the series. Replace its grass props with the requested subject.
Stylized LOW-POLY, flat-shaded faceted geometry. Hard angular edges, every facet one flat solid color, no gradients, no texture, no outlines, no glow, no bloom, no vignette, no drop shadow. Shading only from facet orientation; light from upper left. Fixed isometric camera, one 2:1 diamond tile (true dimetric ~26.565 degrees) with a thin earth slab underneath, the diamond filling ~90% of canvas width, same size and position in every image. Canvas 1536x1024. FACET BUDGET: tile top 3-6 large facets; each prop under ~12 facets. Props stay within the diamond footprint; tall props may rise above it.
BACKGROUND: perfectly flat uniform solid magenta #FF00FF filling the whole canvas. No magenta or pink anywhere in the subject. No text, UI, watermark. Original design, not copying any existing game.
CRITICAL: background must be opaque solid RGB(255,0,255), not black or transparent. Remove all glow and soft lighting. Each polygon is a uniform color. This is a chroma-key sprite.
RETRY FOR CHROMA KEY FAILURE: Make the entire background including all four corner pixels exactly #FF00FF. No color variation, compression noise, edge vignette or background shading. Keep the subject completely free of pink. Output must be 1536x1024.
```

### terrain.ocean.default retry

Date: 2026-10-08. Tool: codex built-in image_gen. Style reference: terrain.plains.default.png.

Source: /home/chakradharreddy/.codex/generated_images/01a11ab8-6cee-7d70-a80a-1c3357b5fc35/exec-162be614-6915-45ff-9ef4-b944230111f6.png

Exact retry prompt:

```text
Use case: stylized-concept. Generate terrain.ocean.default: tile with a deep navy-to-blue water top in 3-4 flat facets (each facet one solid blue), dark blue slab side, two small angular lighter-blue wave wedges.
Use the supplied terrain.plains.default.png as STYLE REFERENCE: match its camera, diamond proportions, slab thickness, facet size and flat colors exactly. Preserve the tile size and position across the series. Replace its grass props with the requested subject.
Stylized LOW-POLY, flat-shaded faceted geometry. Hard angular edges, every facet one flat solid color, no gradients, no texture, no outlines, no glow, no bloom, no vignette, no drop shadow. Shading only from facet orientation; light from upper left. Fixed isometric camera, one 2:1 diamond tile (true dimetric ~26.565 degrees) with a thin earth slab underneath, the diamond filling ~90% of canvas width, same size and position in every image. Canvas 1536x1024. FACET BUDGET: tile top 3-6 large facets; each prop under ~12 facets. Props stay within the diamond footprint; tall props may rise above it.
BACKGROUND: perfectly flat uniform solid magenta #FF00FF filling the whole canvas. No magenta or pink anywhere in the subject. No text, UI, watermark. Original design, not copying any existing game.
CRITICAL: background must be opaque solid RGB(255,0,255), not black or transparent. Remove all glow and soft lighting. Each polygon is a uniform color. This is a chroma-key sprite.
RETRY FOR CHROMA KEY FAILURE: Make the entire background including all four corner pixels exactly #FF00FF. No color variation, compression noise, edge vignette or background shading. Keep the subject completely free of pink. Output must be 1536x1024. Exactly two low elongated triangular wave wedges, not clusters of pyramids.
```

### terrain.ocean.v2 retry

Date: 2026-10-08. Tool: codex built-in image_gen. Style reference: terrain.plains.default.png.

Source: /home/chakradharreddy/.codex/generated_images/01a11ab8-6cee-7d70-a80a-1c3357b5fc35/exec-50110945-c962-464c-a793-2268a412f2c5.png

Exact retry prompt:

```text
Use case: stylized-concept. Generate terrain.ocean.v2: ocean tile with a deep navy-to-blue water top in 3-4 flat facets (each facet one solid blue), dark blue slab side, exactly two small angular lighter-blue wave wedges in a different arrangement: one near the back center and one near the front left. Wedges are low elongated triangular prisms.
Use the supplied terrain.plains.default.png as STYLE REFERENCE: match its camera, diamond proportions, slab thickness, facet size and flat colors exactly. Preserve the tile size and position across the series. Replace its grass props with the requested subject.
Stylized LOW-POLY, flat-shaded faceted geometry. Hard angular edges, every facet one flat solid color, no gradients, no texture, no outlines, no glow, no bloom, no vignette, no drop shadow. Shading only from facet orientation; light from upper left. Fixed isometric camera, one 2:1 diamond tile (true dimetric ~26.565 degrees) with a thin earth slab underneath, the diamond filling ~90% of canvas width, same size and position in every image. Canvas 1536x1024. FACET BUDGET: tile top 3-6 large facets; each prop under ~12 facets. Props stay within the diamond footprint; tall props may rise above it.
BACKGROUND: perfectly flat uniform solid magenta #FF00FF filling the whole canvas. No magenta or pink anywhere in the subject. No text, UI, watermark. Original design, not copying any existing game.
CRITICAL: background must be opaque solid RGB(255,0,255), not black or transparent. Remove all glow and soft lighting. Each polygon is a uniform color. This is a chroma-key sprite.
RETRY FOR CHROMA KEY FAILURE: Make the entire background including all four corner pixels exactly #FF00FF. No color variation, compression noise, edge vignette or background shading. Keep the subject completely free of pink. Output must be 1536x1024. Exactly two low elongated triangular wave wedges, not clusters of pyramids.
```


Date: 2026-10-08

All images: codex built-in image_gen; style reference terrain.plains.default.png (`../m1/terrain.plains.default.png`), loaded with view_image before generation and supplied in every call. No CLI generation. Original generated PNGs were copied from $CODEX_HOME/generated_images; originals retained.

Known visual limitations: generated facets retain subtle shading/gradients; tile size and position vary across images, so exact reference matching was not achieved. terrain.ocean.default has four pointed wave forms instead of two wedges. terrain.water.shallow.v2 has a raised multifacet sand bar rather than a single flat facet. No visible pink/magenta subject regions were observed. Alpha validation is recorded below; it does not certify exact geometric/style compliance.

Postprocessing for every id, inside this directory:

```sh
python3 ~/.codex/skills/.system/imagegen/scripts/remove_chroma_key.py --input <id>.key.png --out <id>.png --auto-key border --despill
```

## terrain.plains.v2

- Date: 2026-10-08
- Tool: codex built-in image_gen
- Style reference: terrain.plains.default.png
- Files: terrain.plains.v2.key.png, terrain.plains.v2.png

Exact prompt:

```text
Use case: stylized-concept. Generate terrain.plains.v2: plains tile, green top facets, a single small low-poly boulder.
Use the supplied terrain.plains.default.png as STYLE REFERENCE: match its camera, diamond proportions, slab thickness, facet size and flat colors exactly. Preserve the tile size and position across the series. Replace its grass props with the requested subject.
Stylized LOW-POLY, flat-shaded faceted geometry. Hard angular edges, every facet one flat solid color, no gradients, no texture, no outlines, no glow, no bloom, no vignette, no drop shadow. Shading only from facet orientation; light from upper left. Fixed isometric camera, one 2:1 diamond tile (true dimetric ~26.565 degrees) with a thin earth slab underneath, the diamond filling ~90% of canvas width, same size and position in every image. Canvas 1536x1024. FACET BUDGET: tile top 3-6 large facets; each prop under ~12 facets. Props stay within the diamond footprint; tall props may rise above it.
BACKGROUND: perfectly flat uniform solid magenta #FF00FF filling the whole canvas. No magenta or pink anywhere in the subject. No text, UI, watermark. Original design, not copying any existing game.
CRITICAL: background must be opaque solid RGB(255,0,255), not black or transparent. Remove all glow and soft lighting. Each polygon is a uniform color. This is a chroma-key sprite.
```

Regenerated once: initial output had a black background and glow and was rejected before keying. Initial exact prompt:

```text
Use case: stylized-concept. Generate terrain.plains.v2: plains tile, green top facets, a single small low-poly boulder.
Use the supplied terrain.plains.default.png as STYLE REFERENCE: match its camera, diamond proportions, slab thickness, facet size and flat colors exactly. Preserve the tile size and position across the series. Replace its grass props with the requested subject.
Stylized LOW-POLY, flat-shaded faceted geometry. Hard angular edges, every facet one flat solid color, no gradients, no texture, no outlines, no glow, no bloom, no vignette, no drop shadow. Shading only from facet orientation; light from upper left. Fixed isometric camera, one 2:1 diamond tile (true dimetric ~26.565 degrees) with a thin earth slab underneath, the diamond filling ~90% of canvas width, same size and position in every image. Canvas 1536x1024. FACET BUDGET: tile top 3-6 large facets; each prop under ~12 facets. Props stay within the diamond footprint; tall props may rise above it.
BACKGROUND: perfectly flat uniform solid magenta #FF00FF filling the whole canvas. No magenta or pink anywhere in the subject. No text, UI, watermark. Original design, not copying any existing game.
```

## terrain.plains.v3

- Date: 2026-10-08
- Tool: codex built-in image_gen
- Style reference: terrain.plains.default.png
- Files: terrain.plains.v3.key.png, terrain.plains.v3.png

Exact prompt:

```text
Use case: stylized-concept. Generate terrain.plains.v3: plains tile, green top facets, two small clusters of yellow-green grass pyramids.
Use the supplied terrain.plains.default.png as STYLE REFERENCE: match its camera, diamond proportions, slab thickness, facet size and flat colors exactly. Preserve the tile size and position across the series. Replace its grass props with the requested subject.
Stylized LOW-POLY, flat-shaded faceted geometry. Hard angular edges, every facet one flat solid color, no gradients, no texture, no outlines, no glow, no bloom, no vignette, no drop shadow. Shading only from facet orientation; light from upper left. Fixed isometric camera, one 2:1 diamond tile (true dimetric ~26.565 degrees) with a thin earth slab underneath, the diamond filling ~90% of canvas width, same size and position in every image. Canvas 1536x1024. FACET BUDGET: tile top 3-6 large facets; each prop under ~12 facets. Props stay within the diamond footprint; tall props may rise above it.
BACKGROUND: perfectly flat uniform solid magenta #FF00FF filling the whole canvas. No magenta or pink anywhere in the subject. No text, UI, watermark. Original design, not copying any existing game.
CRITICAL: background must be opaque solid RGB(255,0,255), not black or transparent. Remove all glow and soft lighting. Each polygon is a uniform color. This is a chroma-key sprite.
```

## terrain.forest.default

- Date: 2026-10-08
- Tool: codex built-in image_gen
- Style reference: terrain.plains.default.png
- Files: terrain.forest.default.key.png, terrain.forest.default.png

Exact prompt:

```text
Use case: stylized-concept. Generate terrain.forest.default: green tile with 3 low-poly conifer trees (stacked dark-green cones, brown prism trunks), slightly varied heights.
Use the supplied terrain.plains.default.png as STYLE REFERENCE: match its camera, diamond proportions, slab thickness, facet size and flat colors exactly. Preserve the tile size and position across the series. Replace its grass props with the requested subject.
Stylized LOW-POLY, flat-shaded faceted geometry. Hard angular edges, every facet one flat solid color, no gradients, no texture, no outlines, no glow, no bloom, no vignette, no drop shadow. Shading only from facet orientation; light from upper left. Fixed isometric camera, one 2:1 diamond tile (true dimetric ~26.565 degrees) with a thin earth slab underneath, the diamond filling ~90% of canvas width, same size and position in every image. Canvas 1536x1024. FACET BUDGET: tile top 3-6 large facets; each prop under ~12 facets. Props stay within the diamond footprint; tall props may rise above it.
BACKGROUND: perfectly flat uniform solid magenta #FF00FF filling the whole canvas. No magenta or pink anywhere in the subject. No text, UI, watermark. Original design, not copying any existing game.
CRITICAL: background must be opaque solid RGB(255,0,255), not black or transparent. Remove all glow and soft lighting. Each polygon is a uniform color. This is a chroma-key sprite.
```

## terrain.forest.v2

- Date: 2026-10-08
- Tool: codex built-in image_gen
- Style reference: terrain.plains.default.png
- Files: terrain.forest.v2.key.png, terrain.forest.v2.png

Exact prompt:

```text
Use case: stylized-concept. Generate terrain.forest.v2: green tile with 2 rounded broadleaf trees (faceted polyhedron canopies) and one small conifer.
Use the supplied terrain.plains.default.png as STYLE REFERENCE: match its camera, diamond proportions, slab thickness, facet size and flat colors exactly. Preserve the tile size and position across the series. Replace its grass props with the requested subject.
Stylized LOW-POLY, flat-shaded faceted geometry. Hard angular edges, every facet one flat solid color, no gradients, no texture, no outlines, no glow, no bloom, no vignette, no drop shadow. Shading only from facet orientation; light from upper left. Fixed isometric camera, one 2:1 diamond tile (true dimetric ~26.565 degrees) with a thin earth slab underneath, the diamond filling ~90% of canvas width, same size and position in every image. Canvas 1536x1024. FACET BUDGET: tile top 3-6 large facets; each prop under ~12 facets. Props stay within the diamond footprint; tall props may rise above it.
BACKGROUND: perfectly flat uniform solid magenta #FF00FF filling the whole canvas. No magenta or pink anywhere in the subject. No text, UI, watermark. Original design, not copying any existing game.
CRITICAL: background must be opaque solid RGB(255,0,255), not black or transparent. Remove all glow and soft lighting. Each polygon is a uniform color. This is a chroma-key sprite.
```

## terrain.mountain.default

- Date: 2026-10-08
- Tool: codex built-in image_gen
- Style reference: terrain.plains.default.png
- Files: terrain.mountain.default.key.png, terrain.mountain.default.png

Exact prompt:

```text
Use case: stylized-concept. Generate terrain.mountain.default: tile whose top is a grey-brown faceted mountain: one big angular peak with a flat white snow cap, plus a small foothill. Grey stone slab sides.
Use the supplied terrain.plains.default.png as STYLE REFERENCE: match its camera, diamond proportions, slab thickness, facet size and flat colors exactly. Preserve the tile size and position across the series. Replace its grass props with the requested subject.
Stylized LOW-POLY, flat-shaded faceted geometry. Hard angular edges, every facet one flat solid color, no gradients, no texture, no outlines, no glow, no bloom, no vignette, no drop shadow. Shading only from facet orientation; light from upper left. Fixed isometric camera, one 2:1 diamond tile (true dimetric ~26.565 degrees) with a thin earth slab underneath, the diamond filling ~90% of canvas width, same size and position in every image. Canvas 1536x1024. FACET BUDGET: tile top 3-6 large facets; each prop under ~12 facets. Props stay within the diamond footprint; tall props may rise above it.
BACKGROUND: perfectly flat uniform solid magenta #FF00FF filling the whole canvas. No magenta or pink anywhere in the subject. No text, UI, watermark. Original design, not copying any existing game.
CRITICAL: background must be opaque solid RGB(255,0,255), not black or transparent. Remove all glow and soft lighting. Each polygon is a uniform color. This is a chroma-key sprite.
```

## terrain.mountain.v2

- Date: 2026-10-08
- Tool: codex built-in image_gen
- Style reference: terrain.plains.default.png
- Files: terrain.mountain.v2.key.png, terrain.mountain.v2.png

Exact prompt:

```text
Use case: stylized-concept. Generate terrain.mountain.v2: tile with two sharp grey angular peaks of different heights, no snow, a few green facets at the base.
Use the supplied terrain.plains.default.png as STYLE REFERENCE: match its camera, diamond proportions, slab thickness, facet size and flat colors exactly. Preserve the tile size and position across the series. Replace its grass props with the requested subject.
Stylized LOW-POLY, flat-shaded faceted geometry. Hard angular edges, every facet one flat solid color, no gradients, no texture, no outlines, no glow, no bloom, no vignette, no drop shadow. Shading only from facet orientation; light from upper left. Fixed isometric camera, one 2:1 diamond tile (true dimetric ~26.565 degrees) with a thin earth slab underneath, the diamond filling ~90% of canvas width, same size and position in every image. Canvas 1536x1024. FACET BUDGET: tile top 3-6 large facets; each prop under ~12 facets. Props stay within the diamond footprint; tall props may rise above it.
BACKGROUND: perfectly flat uniform solid magenta #FF00FF filling the whole canvas. No magenta or pink anywhere in the subject. No text, UI, watermark. Original design, not copying any existing game.
CRITICAL: background must be opaque solid RGB(255,0,255), not black or transparent. Remove all glow and soft lighting. Each polygon is a uniform color. This is a chroma-key sprite.
```

## terrain.water.shallow.default

- Date: 2026-10-08
- Tool: codex built-in image_gen
- Style reference: terrain.plains.default.png
- Files: terrain.water.shallow.default.key.png, terrain.water.shallow.default.png

Exact prompt:

```text
Use case: stylized-concept. Generate terrain.water.shallow.default: tile with a light turquoise water top in 3-4 flat facets, a sandy-beige slab side, one tiny flat lighter facet suggesting a ripple. Water surface sits slightly below the slab rim.
Use the supplied terrain.plains.default.png as STYLE REFERENCE: match its camera, diamond proportions, slab thickness, facet size and flat colors exactly. Preserve the tile size and position across the series. Replace its grass props with the requested subject.
Stylized LOW-POLY, flat-shaded faceted geometry. Hard angular edges, every facet one flat solid color, no gradients, no texture, no outlines, no glow, no bloom, no vignette, no drop shadow. Shading only from facet orientation; light from upper left. Fixed isometric camera, one 2:1 diamond tile (true dimetric ~26.565 degrees) with a thin earth slab underneath, the diamond filling ~90% of canvas width, same size and position in every image. Canvas 1536x1024. FACET BUDGET: tile top 3-6 large facets; each prop under ~12 facets. Props stay within the diamond footprint; tall props may rise above it.
BACKGROUND: perfectly flat uniform solid magenta #FF00FF filling the whole canvas. No magenta or pink anywhere in the subject. No text, UI, watermark. Original design, not copying any existing game.
CRITICAL: background must be opaque solid RGB(255,0,255), not black or transparent. Remove all glow and soft lighting. Each polygon is a uniform color. This is a chroma-key sprite.
```

## terrain.water.shallow.v2

- Date: 2026-10-08
- Tool: codex built-in image_gen
- Style reference: terrain.plains.default.png
- Files: terrain.water.shallow.v2.key.png, terrain.water.shallow.v2.png

Exact prompt:

```text
Use case: stylized-concept. Generate terrain.water.shallow.v2: shallow water tile with a light turquoise water top in 3-4 flat facets, sandy-beige slab sides, water surface slightly below the slab rim. Tiny flat lighter ripple facets arranged differently, toward the right side, and one small sand bar facet.
Use the supplied terrain.plains.default.png as STYLE REFERENCE: match its camera, diamond proportions, slab thickness, facet size and flat colors exactly. Preserve the tile size and position across the series. Replace its grass props with the requested subject.
Stylized LOW-POLY, flat-shaded faceted geometry. Hard angular edges, every facet one flat solid color, no gradients, no texture, no outlines, no glow, no bloom, no vignette, no drop shadow. Shading only from facet orientation; light from upper left. Fixed isometric camera, one 2:1 diamond tile (true dimetric ~26.565 degrees) with a thin earth slab underneath, the diamond filling ~90% of canvas width, same size and position in every image. Canvas 1536x1024. FACET BUDGET: tile top 3-6 large facets; each prop under ~12 facets. Props stay within the diamond footprint; tall props may rise above it.
BACKGROUND: perfectly flat uniform solid magenta #FF00FF filling the whole canvas. No magenta or pink anywhere in the subject. No text, UI, watermark. Original design, not copying any existing game.
CRITICAL: background must be opaque solid RGB(255,0,255), not black or transparent. Remove all glow and soft lighting. Each polygon is a uniform color. This is a chroma-key sprite.
```

## terrain.ocean.default

- Date: 2026-10-08
- Tool: codex built-in image_gen
- Style reference: terrain.plains.default.png
- Files: terrain.ocean.default.key.png, terrain.ocean.default.png

Exact prompt:

```text
Use case: stylized-concept. Generate terrain.ocean.default: tile with a deep navy-to-blue water top in 3-4 flat facets (each facet one solid blue), dark blue slab side, two small angular lighter-blue wave wedges.
Use the supplied terrain.plains.default.png as STYLE REFERENCE: match its camera, diamond proportions, slab thickness, facet size and flat colors exactly. Preserve the tile size and position across the series. Replace its grass props with the requested subject.
Stylized LOW-POLY, flat-shaded faceted geometry. Hard angular edges, every facet one flat solid color, no gradients, no texture, no outlines, no glow, no bloom, no vignette, no drop shadow. Shading only from facet orientation; light from upper left. Fixed isometric camera, one 2:1 diamond tile (true dimetric ~26.565 degrees) with a thin earth slab underneath, the diamond filling ~90% of canvas width, same size and position in every image. Canvas 1536x1024. FACET BUDGET: tile top 3-6 large facets; each prop under ~12 facets. Props stay within the diamond footprint; tall props may rise above it.
BACKGROUND: perfectly flat uniform solid magenta #FF00FF filling the whole canvas. No magenta or pink anywhere in the subject. No text, UI, watermark. Original design, not copying any existing game.
CRITICAL: background must be opaque solid RGB(255,0,255), not black or transparent. Remove all glow and soft lighting. Each polygon is a uniform color. This is a chroma-key sprite.
```

## terrain.ocean.v2

- Date: 2026-10-08
- Tool: codex built-in image_gen
- Style reference: terrain.plains.default.png
- Files: terrain.ocean.v2.key.png, terrain.ocean.v2.png

Exact prompt:

```text
Use case: stylized-concept. Generate terrain.ocean.v2: ocean tile with a deep navy-to-blue water top in 3-4 flat facets (each facet one solid blue), dark blue slab side, exactly two small angular lighter-blue wave wedges in a different arrangement: one near the back center and one near the front left. Wedges are low elongated triangular prisms.
Use the supplied terrain.plains.default.png as STYLE REFERENCE: match its camera, diamond proportions, slab thickness, facet size and flat colors exactly. Preserve the tile size and position across the series. Replace its grass props with the requested subject.
Stylized LOW-POLY, flat-shaded faceted geometry. Hard angular edges, every facet one flat solid color, no gradients, no texture, no outlines, no glow, no bloom, no vignette, no drop shadow. Shading only from facet orientation; light from upper left. Fixed isometric camera, one 2:1 diamond tile (true dimetric ~26.565 degrees) with a thin earth slab underneath, the diamond filling ~90% of canvas width, same size and position in every image. Canvas 1536x1024. FACET BUDGET: tile top 3-6 large facets; each prop under ~12 facets. Props stay within the diamond footprint; tall props may rise above it.
BACKGROUND: perfectly flat uniform solid magenta #FF00FF filling the whole canvas. No magenta or pink anywhere in the subject. No text, UI, watermark. Original design, not copying any existing game.
CRITICAL: background must be opaque solid RGB(255,0,255), not black or transparent. Remove all glow and soft lighting. Each polygon is a uniform color. This is a chroma-key sprite.
```

## Requested command results after retries

| ID | Corner alpha | Partial pixels | Alpha bbox |
|---|---|---|---|
| terrain.forest.default | [0, 255, 255, 255] | 0 | (0, 0, 1536, 1024) |
| terrain.forest.v2 | [0, 255, 255, 255] | 0 | (0, 0, 1536, 1024) |
| terrain.mountain.default | [0, 255, 255, 255] | 0 | (0, 0, 1536, 1024) |
| terrain.mountain.v2 | [0, 255, 255, 255] | 0 | (0, 0, 1536, 1024) |
| terrain.ocean.default | [0, 255, 255, 255] | 0 | (0, 0, 1536, 1024) |
| terrain.ocean.v2 | [255, 255, 255, 255] | 0 | (0, 0, 1536, 1024) |
| terrain.plains.v2 | [0, 255, 255, 255] | 0 | (0, 0, 1536, 1024) |
| terrain.plains.v3 | [255, 255, 255, 255] | 0 | (0, 0, 1536, 1024) |
| terrain.water.shallow.default | [255, 255, 255, 255] | 0 | (0, 0, 1536, 1024) |
| terrain.water.shallow.v2 | [255, 255, 255, 255] | 0 | (0, 0, 1536, 1024) |

## Final alpha validation

Background variation persisted after the single retries. Final cleanup used the same supplied remover with `--tolerance 50 --force` appended to the requested command. No image synthesis or custom editing code was used. Key PNGs remain unmodified generated originals. All final images are 1536×1024; all four corners have alpha 0. Partial counts use 0 < alpha < 255. Bbox is (left, top, right-exclusive, bottom-exclusive). Corner order is top-left, top-right, bottom-left, bottom-right. Hard alpha edges and slight color fringes may remain; exact flat-color and registration requirements were not achieved by the generator.

| ID | Size | Corner alpha | Partial pixels | Alpha bbox |
|---|---|---|---|---|
| terrain.forest.default | 1536×1024 | [0, 0, 0, 0] | 0 | (44, 104, 1492, 928) |
| terrain.forest.v2 | 1536×1024 | [0, 0, 0, 0] | 0 | (62, 126, 1475, 927) |
| terrain.mountain.default | 1536×1024 | [0, 0, 0, 0] | 0 | (50, 103, 1486, 922) |
| terrain.mountain.v2 | 1536×1024 | [0, 0, 0, 0] | 0 | (73, 109, 1466, 924) |
| terrain.ocean.default | 1536×1024 | [0, 0, 0, 0] | 0 | (24, 110, 1512, 898) |
| terrain.ocean.v2 | 1536×1024 | [0, 0, 0, 0] | 0 | (42, 108, 1494, 896) |
| terrain.plains.v2 | 1536×1024 | [0, 0, 0, 0] | 0 | (40, 87, 1496, 915) |
| terrain.plains.v3 | 1536×1024 | [0, 0, 0, 0] | 0 | (46, 95, 1490, 898) |
| terrain.water.shallow.default | 1536×1024 | [0, 0, 0, 0] | 0 | (28, 113, 1509, 927) |
| terrain.water.shallow.v2 | 1536×1024 | [0, 0, 0, 0] | 0 | (40, 124, 1496, 926) |
