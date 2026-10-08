# Resources & world features — generation notes

Tool: codex built-in image_gen (codex-cli 0.155.1), style refs `m1/terrain.plains.default.png` and `terrain/terrain.forest.default.png`. Date: 2026-10-08.

Codex hit its usage limit before copying outputs, so these were recovered from `~/.codex/generated_images/01a11ace-47c4-7ea0-8a93-85e022e2db97/` and keyed by hand with:

    remove_chroma_key.py --auto-key border --tolerance 50 --despill --edge-contract 1

Result: 0 partially transparent pixels, 0 residual magenta pixels per file. `resource.fish.default` came back natively transparent (no magenta background) and only had 74 stray fringe pixels zeroed.

`feature.ruins.default` is **not generated yet** (usage limit).

## Prompt (all calls)

Shared style (repeat verbatim in each prompt):
Stylized LOW-POLY, flat-shaded faceted geometry. Hard angular edges, every facet one flat solid color, no gradients, no texture, no outlines, no rim lines, no glow, no bloom, no vignette, no drop shadow. Shading only from facet orientation; light from upper left. Fixed isometric camera (true dimetric, 2:1 ground diamond). Flat saturated colors.
BACKGROUND: perfectly flat uniform opaque solid magenta RGB(255,0,255) filling the whole canvas edge to edge. No magenta or pink anywhere in the subject. No text, UI, watermark. Original design, not copying any existing game.
FACET BUDGET: whole subject under ~25 facets.

These are OVERLAY PROPS drawn on top of an existing terrain tile by the engine, so: NO tile, NO ground slab, NO grass base under them, just the objects themselves standing on an implied isometric ground plane. Subject centered, its footprint fitting inside an imaginary 2:1 diamond about 60% of the canvas width. Must read as a clear symbol at 60px wide. Canvas 1024x1024.
Resources (neutral, no faction colors):
1. resource.fruit.default — one round faceted berry bush with a few large red and orange cube/polyhedron fruits.
2. resource.animals.default — two low-poly goats/deer, blocky bodies, simple horns, one standing one grazing.
3. resource.fish.default — two angular faceted fish arcing as if leaping, plus a small flat light-blue splash wedge under them (no water tile).
4. resource.crops.default — a low isometric patch of 3-4 rows of golden wheat wedges, the patch shaped like a small 2:1 diamond.
5. resource.ore.default — a cluster of 3-4 angular grey rocks with bright cyan-violet crystal shards sticking out (no pink, no magenta).
World features:
6. feature.village.default — an unclaimed neutral village: 2-3 small round huts with conical straw roofs in muted brown/beige, a tiny campfire wedge. No faction colors, no flags. Footprint can be up to 80% of canvas width.
7. feature.ruins.default — ancient ruins: a few broken grey stone columns, one fallen column, a stone archway fragment, a bit of green moss facet. Footprint up to 80% of canvas width.


## Per-asset subject lines

Resources (neutral, no faction colors):
1. resource.fruit.default — one round faceted berry bush with a few large red and orange cube/polyhedron fruits.
2. resource.animals.default — two low-poly goats/deer, blocky bodies, simple horns, one standing one grazing.
3. resource.fish.default — two angular faceted fish arcing as if leaping, plus a small flat light-blue splash wedge under them (no water tile).
4. resource.crops.default — a low isometric patch of 3-4 rows of golden wheat wedges, the patch shaped like a small 2:1 diamond.
5. resource.ore.default — a cluster of 3-4 angular grey rocks with bright cyan-violet crystal shards sticking out (no pink, no magenta).
World features:
6. feature.village.default — an unclaimed neutral village: 2-3 small round huts with conical straw roofs in muted brown/beige, a tiny campfire wedge. No faction colors, no flags. Footprint can be up to 80% of canvas width.
7. feature.ruins.default — ancient ruins: a few broken grey stone columns, one fallen column, a stone archway fragment, a bit of green moss facet. Footprint up to 80% of canvas width.
