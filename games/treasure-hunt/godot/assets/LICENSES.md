# Third-party assets

| Pack | Author | Source | License | Version |
| --- | --- | --- | --- | --- |
| Car Kit | Kenney (kenney.nl) | https://kenney.nl/assets/car-kit | CC0 1.0 | 3.1 |

CC0 means credit isn't required. It's given anyway.

## Files used

| File | Baked as | Used for |
| --- | --- | --- |
| `suv.glb` (body, spare wheel) | `meshes/car_body_4x4.res` | the buggy's body, a placeholder |
| `suv.glb` (wheel) | `meshes/car_wheel_4x4.res` | the buggy's wheels |

Both meshes were baked by Blind Rally's `tools/bake_assets.gd` and copied from `games/blind-rally/godot/assets/meshes/`. They're vertex-coloured and point at `materials/vertex_color.tres`. Blind Rally's version of that material is a weather shader; this one is a plain StandardMaterial3D with the same base look (vertex colour as albedo, roughness 0.95, specular 0.25).
