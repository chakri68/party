# Third-party assets

Everything here is CC0 (public domain dedication). Credit isn't required, but it's given anyway, because Kenney earned it.

The glTF files in `kenney_*/` are **sources only**. `tools/bake_assets.gd` flattens each one into a single vertex-coloured mesh in `meshes/`, recoloured to the Blind Rally palette, and the Web export skips `assets/kenney_*/` entirely (see `export_presets.cfg`). So the game ships the baked `.res` meshes and one shared material, and no textures.

| Pack | Author | Source | License | Version |
| --- | --- | --- | --- | --- |
| Nature Kit | Kenney (kenney.nl) | https://kenney.nl/assets/nature-kit | CC0 1.0 | 2.1 |
| Racing Kit | Kenney (kenney.nl) | https://kenney.nl/assets/racing-kit | CC0 1.0 | 2.0 |
| Car Kit | Kenney (kenney.nl) | https://kenney.nl/assets/car-kit | CC0 1.0 | 3.1 |
| Space Kit | Kenney (kenney.nl) | https://kenney.nl/assets/space-kit | CC0 1.0 | 2.0 |
| Survival Kit | Kenney (kenney.nl) | https://kenney.nl/assets/survival-kit | CC0 1.0 | 2.0 |
| Holiday Kit | Kenney (kenney.nl) | https://kenney.nl/assets/holiday-kit | CC0 1.0 | 2.0 |

The license was checked on each pack's page ("Creative Commons CC0") and in the `License.txt` inside each download, which links https://creativecommons.org/publicdomain/zero/1.0/.

## Files used

**Nature Kit** → `kenney_nature-kit/`

| File | Baked as | Used for |
| --- | --- | --- |
| `tree_pineTallA.glb` | `pine_tall` | forest; Cliffhanger's wind-bent pines (sheared copies) |
| `tree_pineDefaultA.glb` | `pine_default` | forest; Cliffhanger's wind-bent pines |
| `tree_pineRoundC.glb` | `pine_round` | forest; Cliffhanger's wind-bent pines |
| `tree_pineSmallA.glb` | `pine_small` | forest, road edge; Cliffhanger's wind-bent pines |
| `log.glb` | `log` | roadside logs |
| `log_large.glb` | `log_large` | roadside, sawmill |
| `log_stackLarge.glb` | `log_stack` | sawmill piles, cabin woodpile, log landing |
| `rock_largeA.glb` | `rock_a` | roadside, forest floor; Cliffhanger's cuts and waterline |
| `rock_largeC.glb` | `rock_c` | roadside, stream banks; Cliffhanger's cuts |
| `rock_smallA.glb` | `rock_small` | stream banks; Cliffhanger heath |
| `rock_tallA.glb` | `rock_tall` | roadside; Cliffhanger's cuts and headlands |
| `stump_old.glb` | `stump` | roadside, forest floor |
| `plant_bushLarge.glb` | `bush` | forest floor; Cliffhanger's coastal scrub |
| `plant_bush.glb` | `bush_small` | forest floor; Cliffhanger's coastal scrub |
| `grass_large.glb` | `grass` | ditch tufts; Cliffhanger heath |
| `campfire_logs.glb` | `campfire` | ranger cabin, campsite |
| `tent_detailedOpen.glb` | `tent_camp` | campsite (recoloured red) |
| `campfire_stones.glb` | `fire_ring` | campsite |
| `cactus_tall.glb` | `saguaro` | Dust Devil scatter |
| `cactus_short.glb` | `cactus_short` | Dust Devil scatter |
| `rock_largeB.glb` | `red_rock_b` | wall-foot talus, stone arch legs |
| `rock_largeD.glb` | `red_rock_d` | wall-foot talus, stone arch legs |
| `rock_largeE.glb` | `red_rock_e` | talus, floor rocks |
| `rock_tallB.glb` | `hoodoo_b` | hoodoos |
| `rock_tallG.glb` | `hoodoo_g` | hoodoos |
| `rock_tallH.glb` | `hoodoo_h` | hoodoos, talus |
| `rock_tallE.glb` | `hoodoo_e` | stone arch legs |
| `rock_smallC.glb` | `pebble` | desert floor, berms |
| `rock_smallFlatA.glb` | `flat_rock` | the sand drift on the desert wreck |
| `plant_bushSmall.glb` | `scrub` | desert scrub; Cliffhanger heath |
| `plant_bushTriangle.glb` | `scrub_tri` | desert scrub; Cliffhanger heath |
| `grass.glb` | `dry_grass` | dry tufts, berms |

**Racing Kit** → `kenney_racing-kit/`

| File | Baked as | Used for |
| --- | --- | --- |
| `overheadRoundColored.glb` | `arch` | start and finish arches |
| `flagRed.glb` | `flag_red` | finish, spectators |
| `flagGreen.glb` | `flag_green` | start, spectators |
| `tent.glb` | `tent` | service park, stop control |
| `pylon.glb` | `cone` | start line cones |

**Car Kit** → `kenney_car-kit/`

| File | Baked as | Used for |
| --- | --- | --- |
| `hatchback-sports.glb` | `car_body`, `car_wheel` | the rally car (green paint remapped to the livery blue) |
| `sedan.glb` | `wreck` | the wreck in the ferns (body only, paint remapped to rust) |
| `tractor-shovel.glb` | `skidder` | the log landing's skidder (remapped to faded yellow and rust) |
| `Textures/colormap.png` | (sampled at bake time) | colours for the car meshes |

**Space Kit** → `kenney_space-kit/`

| File | Baked as | Used for |
| --- | --- | --- |
| `barrels.glb` | `drums` | fuel depot, mine, shack (recoloured faded red) |
| `barrel.glb` | `drum`, `drum_yellow` | fuel depot; Cliffhanger's bait shack |
| `satelliteDish_detailed.glb` | `dish` | radio tower |
| `machine_wireless.glb` | `radio_box` | radio tower's equipment box |
| `crater.glb` | `crater` | UFO easter egg (scorched) |
| `bones.glb` | `bones` | vultures easter egg |
| `alien.glb` | `alien` | UFO easter egg's pilot |

**Survival Kit** → `kenney_survival-kit/`

| File | Baked as | Used for |
| --- | --- | --- |
| `rock-sand-a.glb` | `sand_rock_a` | desert floor rocks |
| `rock-sand-b.glb` | `sand_rock_b` | desert floor rocks |
| `signpost.glb` | `signpost` | cow skull easter egg's LOST COW sign |
| `Textures/colormap.png` | (sampled at bake time) | colours for the three above |

**Holiday Kit** → `kenney_holiday-kit/`

| File | Baked as | Used for |
| --- | --- | --- |
| `tree-snow-a.glb` | `snow_pine_a` | Snowblind forest |
| `tree-snow-b.glb` | `snow_pine_b` | Snowblind forest |
| `tree-snow-c.glb` | `snow_pine_c`, `snow_pine_small` | Snowblind forest, road edge |
| `rocks-large.glb` | `granite_l` | rock walls; Cliffhanger's headland rock |
| `rocks-medium.glb` | `granite_m` | rock walls, forest floor |
| `rocks-small.glb` | `granite_s` | forest floor; Cliffhanger heath |
| `snow-pile.glb` | `snow_pile` | forest floor drifts |
| `lantern.glb` | `lantern` | the chalet |
| `bench.glb` | `bench` | chalet, frozen pond, ski hut; Cliffhanger's lay-by |
| `Textures/colormap.png` | (sampled at bake time) | colours for all of the above, moved off the kit's pastels |

## Everything else

The road, ground, stream, bridge, ranger cabin, sawmill, chevron boards, hay bales, tape, spectators, light pod, dust, tyre marks and all audio are generated by this project's own scripts (`tools/build_pine_panic.gd`, `scripts/car_fx.gd`, `scripts/car_audio.gd`). So are the fire watch tower, hunting stand, outhouse, forestry gate and sign, the fake junction, the beacon and campfire glows (`shaders/glow.gdshader`), and every creature and easter egg: deer, birds, moose, campers, Bigfoot and the wrong-way sign (`scripts/easter_eggs.gd`). No recorded samples are used.

Dust Devil (`tools/build_dust_devil.gd`, sharing `tools/stage_builder.gd`) generates its canyon terrain, roads and spurs, the stone arch's span, the radio tower's lattice, the fuel depot's tank, pump and hut, the windpump, shack, water tank, old mine and the drift on the wreck. Its easter eggs are generated in `scripts/easter_eggs.gd`: the tumbleweeds, roadrunner, vultures, cow skull and the flying saucer. The Kenney pieces they use are listed above.

Snowblind (`tools/build_snowblind.gd`) generates its mountain terrain, the packed-snow road with its ice and grit patches, the snowbanks, the chalet, the ski lift (pylons, cable, chairs, stations), the frozen pond and its ice hut, the wayside shrine, the parked plough, the avalanche fence and the ski hut. Snowfall is `shaders/snowfall.gdshader`, driven from `scripts/weather.gd`; the snow spray is `scripts/car_fx.gd`. Its easter eggs are generated in `scripts/easter_eggs.gd`: the snowmen, the skiers, the elk, the snowmobile and the yeti. The Kenney pieces it uses are listed above.

Cliffhanger (`tools/build_cliffhanger.gd`) generates its coast: the cliffs and the rock shelf under them, the road with its broken tarmac, the armco and the dry stone walls, the sea tunnel (bore, portals, lamps, and the rock over it, `shaders/tunnel_roof.gdshader` driven by `scripts/tunnel_roof.gd`), the lighthouse and keeper's cottage, the pier and its boats, the lobster pots, the chapel, the shipwreck on the rocks, the phone box, the lay-by, and the wind-bent pines (the Kenney pines above, sheared at build time). The sea is one plane on `shaders/sea.gdshader`; the sea fog is `scripts/weather.gd`'s banks in their "fog" style. Its easter eggs are generated in `scripts/easter_eggs.gd`: the gulls, the whale, the fishing boat, the seal, and the sea serpent or the kraken. The Kenney pieces it uses are listed above.
