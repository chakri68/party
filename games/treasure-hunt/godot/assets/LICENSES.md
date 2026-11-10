# Third-party assets

| Pack | Author | Source | License | Version |
| --- | --- | --- | --- | --- |
| Car Kit | Kenney (kenney.nl) | https://kenney.nl/assets/car-kit | CC0 1.0 | 3.1 |
| Nature Kit | Kenney (kenney.nl) | https://kenney.nl/assets/nature-kit | CC0 1.0 | 2.1 |
| Castle Kit | Kenney (kenney.nl) | https://kenney.nl/assets/castle-kit | CC0 1.0 | 2.0 |
| Fantasy Town Kit | Kenney (kenney.nl) | https://kenney.nl/assets/fantasy-town-kit | CC0 1.0 | 2.0 |
| Survival Kit | Kenney (kenney.nl) | https://kenney.nl/assets/survival-kit | CC0 1.0 | 2.0 |

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
| `cliff_block_rock.glb`, `cliff_blockHalf_rock.glb` | cliff and cave pieces (M4b) |
| `log_stack.glb` | a stack of logs (M4b) |

These came from the kit's `Models/GLTF format/` folder.

**Fantasy Town Kit** → `kenney_town-kit/`, from the kit's `Models/GLB format/`. The models share one texture atlas. The glbs point at `Textures/colormap.png`, which is copied with them. `PieceKit.kenney()` takes them as `"<kit>/<model>"`.

| File | Used for |
| --- | --- |
| `windmill.glb` | M4b set pieces |
| `wall-wood.glb` | M4b set pieces |
| `fence.glb` | M4b set pieces |
| `fence-broken.glb` | M4b set pieces |
| `cart.glb` | M4b set pieces |
| `hedge.glb` | M4b set pieces |

**Castle Kit** → `kenney_castle-kit/`, from the kit's `Models/GLB format/`. The models share one texture atlas. The glbs point at `Textures/colormap.png`, which is copied with them. `PieceKit.kenney()` takes them as `"<kit>/<model>"`.

| File | Used for |
| --- | --- |
| `tower-square-base.glb` | M4b set pieces |
| `tower-square-mid.glb` | M4b set pieces |
| `tower-square-top.glb` | M4b set pieces |
| `rocks-large.glb` | M4b set pieces |
| `rocks-small.glb` | M4b set pieces |
| `siege-trebuchet.glb` | M4b set pieces |
| `siege-trebuchet-demolished.glb` | M4b set pieces |
| `siege-catapult.glb` | M4b set pieces |
| `siege-catapult-demolished.glb` | M4b set pieces |
| `siege-ballista.glb` | M4b set pieces |
| `siege-ballista-demolished.glb` | M4b set pieces |
| `flag-banner-long.glb` | M4b set pieces |

**Survival Kit** → `kenney_survival-kit/`, from the kit's `Models/GLB format/`. The models share one texture atlas. The glbs point at `Textures/colormap.png`, which is copied with them. `PieceKit.kenney()` takes them as `"<kit>/<model>"`.

| File | Used for |
| --- | --- |
| `box-large.glb` | M4b set pieces |
| `barrel.glb` | M4b set pieces |
| `structure-canvas.glb` | M4b set pieces |
| `structure.glb` | M4b set pieces |
| `campfire-fishing-stand.glb` | M4b set pieces |
| `signpost.glb` | M4b set pieces |
| `tool-pickaxe.glb` | M4b set pieces |
| `tool-shovel.glb` | M4b set pieces |
