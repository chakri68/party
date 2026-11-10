# Task 4: denser minor points, eight kinds

Status: done.

- MinorKind now has 8 kinds (shed, barrels, signpost, woodpile, cart added). MINOR_MIN 60, MINOR_MAX 80.
- kindFor is exported and picks uniformly from MINOR_KINDS[biome] (forest, rocky, snowcap, wetland, meadow per the brief).
- MINOR_SLOT carries the exact hints and slots; the comment blocks in minor.ts and minor_points.gd list the new footprints.
- Godot builds: shed box 2.4^3 (collider), barrels 2-3 at 0.4 m out (cylinders), signpost 0.15 x 2 m with 1 m sign (no collider), woodpile 0.9x1.0x1.8 box, cart 1.4x1.0x2.4 box. All textured kenney models, null material.
- ground_y now takes 8 samples round the footprint (was 3), because shed/cart footprints are big enough that 3 samples left a gap on slopes. Footprints: shed 1.7, barrels 0.8, signpost 0.3, woodpile 1.0, cart 1.4.
- TRIES left at 6000. Over 4000 seeds the min count was 60 and only the uniform target (60..80) sets it, so no seed runs short. Per-seed layout time 12.7 ms before, 12.5-12.9 ms after.
- Tests: trails.test.ts (60-80 on 1000 seeds, kinds per biome via MINOR_KINDS, new 200-seed test: each kind on >=50% of maps, kindFor stays in list, new slot hints); minor_tests.gd covers all 8 kinds (slot clear, ground, solid unless signpost, barrels <=1.1 m, post 2 m, slope).
- Fixtures regenerated (layout_1..5; extra_layouts.json unchanged).
- Moved pins: none. No vitest or Godot expectation had to change.
- Results: vitest 347 passed; typecheck clean; Godot 2903 passed, 0 failed, exit 0, no SCRIPT ERROR.
- Not done: godot-build.json export (not requested here; scripts changed, so the build json will want a re-export at the end).
