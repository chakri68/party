# SVG sprite contract (classic pack)

Hand-authored low-poly sprites. The approved concepts in `../concepts/` are the visual reference; this file is the law. If a concept and this file disagree, this file wins.

## Geometry

All coordinates are logical pixels (zoom 1). Export at 2× for the atlas.

The ground diamond is 96×48. Every sprite that sits on a tile places that diamond at a fixed spot so anchors are constant per family:

| Family | viewBox | Diamond vertices (top, right, bottom, left) | Ground anchor |
|---|---|---|---|
| Tile (`terrain.*`) | `0 0 96 72` | (48,16) (96,40) (48,64) (0,40) | (48,40) → normalized (0.5, 0.5556) |
| City (`city.*`) | `0 0 96 120` | (48,64) (96,88) (48,112) (0,88) | (48,88) → (0.5, 0.7333) |
| Tall tile (`terrain.mountain.*`, tall forests) | `0 0 96 104` | (48,48) (96,72) (48,96) (0,72) | (48,72) → (0.5, 0.6923) |
| Unit (`unit.*`) | `0 0 48 64` | n/a, feet contact centered at (24,60) | (24,60) → (0.5, 0.9375) |
| Mounted unit (`unit.cavalry.*`, `unit.knight.*`) | `0 0 64 64` | n/a, mount's hooves centered at (32,60) | (32,60) → (0.5, 0.9375) |
| Overlay (`resource.*`, `feature.*`, `improvement.*`, `road.*`) | `0 0 96 72` | same as tile: (48,16) (96,40) (48,64) (0,40) | (48,40) → (0.5, 0.5556) |
| Effect (`effect.*`) | `0 0 48 48` | n/a | center (24,24) → (0.5, 0.5) |

Overlays are drawn by the engine directly on top of a tile, so they contain **no grass, no diamond, no slab**: only the objects, placed on the implied diamond. Tall overlays may use the headroom; nothing may go below the diamond's bottom vertex.

A tile has 16 units of headroom above the diamond for low props. Anything taller uses the tall-tile row: same diamond, shifted down 32.

Earth slab: 8 units deep under the two lower diamond edges. For the tile row:
- Left face: `(0,40) (48,64) (48,72) (0,48)`
- Right face: `(48,64) (96,40) (96,48) (48,72)`

Other families shift these by the same offset as their diamond (+32 tall tile, +48 city).

Units are ~44–52 units tall. One tile is ~96 wide, so a unit covers about half the tile width. Cities may rise up to ~60 units above their diamond.

## Facets and light

- Every polygon is one flat `fill`. No gradients, filters, blur, opacity, strokes, or `stroke` outlines. Ever.
- Light from upper left. Each material has three tones: **light** for top and up-left faces, **mid** for left/front faces, **dark** for right/shadow faces.
- Facet budget: tile top 3–6 facets, each individual prop (one tree, one tuft, one rock) ≤ 12, unit ≤ ~45 polygons, tier-1 city ≤ ~90.
- A prop on same-tone ground may step one tone so its edge survives (a light-left face on light grass becomes mid).
- No cast or contact shadows. Facet tone carries the depth; the engine can add a shared shadow later.
- Roofs are hip roofs: front slope light, right hip dark, back slope mid. A gable shows only one slope in this projection.
- Adjacent facets share exact vertices. Antialiasing still leaves hairline seams between them, so every multi-facet material sits on an **underlay**: one polygon covering the whole material's silhouette in its mid tone (the full diamond for grass, the outline for a mountain). The facets are drawn over it. Underlays don't count toward facet budgets.
- Integer or half-integer coordinates only.

## Palette

| Material | light | mid | dark |
|---|---|---|---|
| grass | `#8BC34A` | `#6BAA3E` | `#4E8A34` |
| earth | `#9A6A42` | `#8A5A33` | `#5E3B20` |
| stone | `#C9C6BF` | `#A8A49B` | `#7E7A72` |
| snow | `#FFFFFF` | `#EEF2F5` | `#CFD8DE` |
| foliage (neutral trees) | `#7CC25A` | `#5A9E44` | `#3F7A32` |
| sand | `#F2DDA4` | `#E3C887` | `#C4A86A` |
| shallow water | `#8FE3E8` | `#5FD0D8` | `#3BB0BC` |
| ocean | `#3D8FE0` | `#2A6FC4` | `#1C4F98` |
| wet slab (under water) | `#3BB0BC` | `#2B8E9A` | `#1E6C78` |
| deep slab (under ocean) | `#1C4F98` | `#173F7C` | `#112F5E` |
| ice / crystal (ore) | `#9EE7F5` | `#5CC3E6` | `#6A5BD8` |
| dry grass | `#D6E36A` | `#B9CC4F` | `#93A83A` |
| foam (wave crests, ripples) | `#F2FBFF` | `#D4EEF7` | `#A9D6E8` |
| impact (effects) | `#FFF3B0` | `#FFC94A` | `#FF8A3D` |
| vitality (effects) | `#E9FFE0` | `#8EF07A` | `#3FBF5A` |
| Orchard straw gold | `#F7D57A` | `#F2C14E` | `#C99A2E` |
| Orchard leaf green | `#5CBF60` | `#4CAF50` | `#2E7D32` |
| Orchard apple red | `#E8635D` | `#D64541` | `#A8322F` |
| Orchard cream | `#FBF3E1` | `#F4E9D0` | `#D9C9A6` |
| Forest clans rust | `#E8884A` | `#C8642E` | `#9A4720` |
| Forest clans charcoal fur | `#6E6B78` | `#4F4C58` | `#34323C` |
| Forest clans bone | `#F3EAD6` | `#E2D3B4` | `#BFAE8C` |
| horse | `#B98A5E` | `#9C6E45` | `#74502F` |
| walnut (wood) | `#9A6A42` | `#7A4E2D` | `#5A3820` |
| skin | `#E8B48A` | `#D49A6E` | `#B07A52` |

Add a new material only with a three-tone row here.

Rows labelled with a faction are free to reuse for neutral subjects where the color is literal: apple red for fruit and fire, straw gold for wheat and flame cores, bone for pale animals, sand for thatch. Shared trees use foliage, never Orchard leaf green.

Faction colors must not sit near terrain colors. Orchard leaf green is close to grass, which is acceptable for trim. It should never be the main color of a unit's silhouette, and its dark tone must border every green part a unit has.

Factions: **Orchard** (agrarian; gold/green/red/cream; timber-and-plaster cottages, red hip roofs) and **Forest clans** (hunters; rust/charcoal/bone; log longhouses with steep dark roofs, hide and antler details, round wooden shields). Units of the same role share a pose and silhouette across factions; the faction shows in palette, headgear and trim.

Effects sit on top of units, so each effect symbol gets a **rim**: one polygon behind it in the dark tone of a contrasting material (walnut dark, apple red dark, leaf dark). Gold effects (capture, research) always need it, because Orchard units are gold. Light direction applies loosely to effects; the underlay rule doesn't.

## Draw order (engine contract)

Every terrain SVG has two groups: `<g id="ground">` (slab, underlay, top facets, flat details) and `<g id="props">` (anything that rises: trees, peaks, rocks). Export them as separate frames. `tools/split_terrain.py` wraps existing files; author new ones with both groups.

1. All terrain **ground**, back to front.
2. All `road.*` overlays, in a separate pass. Diagonal road ends straddle a vertex and spill onto the two side tiles, so a per-tile pass would let those tiles cover them.
3. Per tile back to front: terrain **props**, then resource/feature/improvement overlay, city, unit, effect.

Drawing whole tiles in pass 1 paints a mountain's peak under the wheat field behind it; the split is what keeps occlusion right.

Road kit: per tile draw `road.center` plus one `road.<dir>` per connected neighbour. Directions are in grid terms; the screen mapping is in the header comment of `road.center.svg`. Road width is constant on the ground, so orthogonal and diagonal strips differ on screen. That's correct, not a bug.

Overlay budgets: each object ≤ 12 facets, each improvement sprite ≤ ~45 polygons, resource ≤ ~60 (crops excepted: 14 sheaves at ~7 each).

## Ownership

Shapes the engine tints with the player color go in `<g id="owner">`. The engine finds them **by group id, never by color**.

- Fill owner polygons with the placeholder `#BDBDBD`. That grey appears nowhere in the palette, so a stray match is obvious in review.
- For shading inside the owner area, add `data-tone="light"`, `"mid"` (default) or `"dark"` to each polygon. The engine derives the three tones from the player color.
- Faction palette never goes inside `owner`. Nothing in `owner` is baked with player color.

## Files

- Source: `svg/<family>/<id>.svg`, one sprite per file, `id` = stable asset ID.
- Export: `rsvg-convert -w <2×viewBox width> -h <2×viewBox height> <id>.svg -o svg/_exports/<id>.png`
- Root element: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="…" width="…" height="…">` with width/height equal to viewBox size. No `<style>`, no CSS classes, no external refs.
