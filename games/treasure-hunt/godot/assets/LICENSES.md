# Third-party assets

| Pack | Author | Source | License | Version |
| --- | --- | --- | --- | --- |
| Car Kit | Kenney (kenney.nl) | https://kenney.nl/assets/car-kit | CC0 1.0 | 3.1 |
| Nature Kit | Kenney (kenney.nl) | https://kenney.nl/assets/nature-kit | CC0 1.0 | 2.1 |

CC0 means credit isn't required. It's given anyway.

## Files used

| File | Baked as | Used for |
| --- | --- | --- |
| `suv.glb` (body, spare wheel) | `meshes/car_body_4x4.res` | the buggy's body, a placeholder |
| `suv.glb` (wheel) | `meshes/car_wheel_4x4.res` | the buggy's wheels |

Both meshes were baked by Blind Rally's `tools/bake_assets.gd` and copied from `games/blind-rally/godot/assets/meshes/`. They're vertex-coloured and point at `materials/vertex_color.tres`. Blind Rally's version of that material is a weather shader; this one is a plain StandardMaterial3D with the same base look (vertex colour as albedo, roughness 0.95, specular 0.25).

**Nature Kit** → `kenney_nature-kit/`, copied from `games/blind-rally/godot/assets/kenney_nature-kit/`. These are used as they are, not baked: `PieceKit.kenney()` takes each model's mesh and stretches it to the size its template needs. Most get a label colour as a material override. The glbs carry their colours in materials, with no texture files.

| File | Used for |
| --- | --- |
| `rock_tallA.glb`, `rock_tallB.glb` | the standing stones of a stone circle |
| `rock_largeA.glb` | fallen stones; the fallen block by a ruined lighthouse |
| `rock_smallA.glb` | rubble by a ruined lighthouse |
| `tent_detailedOpen.glb` | camp tents |
| `campfire_stones.glb`, `campfire_logs.glb` | the camp fire pit |
| `log.glb` | the camp's log seat |
| `log_large.glb` | a spare log at the camp |
