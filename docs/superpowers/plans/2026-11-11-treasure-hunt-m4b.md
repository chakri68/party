# Treasure Hunt M4b: The Full Set-Piece Library and Denser Minor Points

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The library grows from 6 templates to 16, built from the Kenney CC0 kits, and every map gets 60–80 minor points of 8 kinds. A map then has 10–14 mostly different set pieces, so rounds keep looking new.

**Architecture:**
- **Templates stay data plus a builder.** Each new template is:
  - an entry in `shared/templates.ts` (params, slots, `top`, maybe `lamps`, with its geometry noted in a comment beside it);
  - a site rule in `shared/sites.ts`;
  - a Godot builder in `godot/scripts/pieces/<id>.gd` that builds to those notes.
- **Tests come free from the fixtures.** `pieces.json` carries the samples. The existing `piece_tests.gd` already proves every slot is open and every lamp is lit, for every template in the fixture.
- **Minor points work the same way:** a `MinorKind`, a slot in `MINOR_SLOT`, and a builder branch in `minor_points.gd`.

**Tech Stack:** TypeScript (shared/server, vitest), Godot 4.7 GDScript (Compatibility renderer, web export), Kenney kits (glb).

**Spec:** `treasure-hunt-spec.md` (repo root):
- §4.2 layer 5 (minor points);
- §5 (set-piece library: "Build 16–20 templates… Each map picks 10–14");
- §6.1 (caches are hidden: "under a ledge, behind a door, on a high shelf, in a hollow log");
- §7.4 (lit set pieces include the windmill);
- §10 (download: "only the engine, the kits and the packs");
- §12 M4 ("Done when playtesters keep finding new things for about an hour").

M4a shipped time of day and the photo, shadow and lamp clues; this plan only feeds them new pieces. User rulings: the templates come from the new Kenney CC0 kits. The zips in the repo root are `kenney_castle-kit.zip`, `kenney_fantasy-town-kit_2.0.zip`, `kenney_survival-kit.zip` and `kenney_nature-kit.zip`.

## Global Constraints

- **Repo rules:**
  - Desktop only.
  - Commit straight to master. Stage only your own files, never `git add -A`. The repo root has untracked files that aren't ours, the kit zips among them: never commit a zip. Push after each commit.
  - End every commit message with `Claude-Session: https://claude.ai/code/session_01KwNUn9dpkZKSPFkAmAoz5c`.
- **Library (§5):**
  - 16 templates after this plan.
  - Every template has 2–4 cache slots with 0 ≤ dy ≤ 1, a site rule, rolled params and 3 label words.
  - A map has 10–14 pieces.
- **Minor points (§4.2 layer 5):** 40–80 per map is the spec's range. This plan aims for 60–80 (Ruling A).
- **Lit pieces (§7.4):** the windmill is the one new lit piece the spec names. The garden also gets lanterns (Ruling B).
- **Assets:**
  - Copy only the glb files a builder uses, plus each kit's `Textures/colormap.png` that the glbs point at, into `godot/assets/kenney_<kit>/`.
  - Add a row for every file to `godot/assets/LICENSES.md`.
  - Never unzip a whole kit into the repo. Unzip into the scratchpad and copy the files you need from there.
- **Pieces in Godot:**
  - At most 60 nodes per piece (the `MAX_NODES` check in `piece_tests.gd`).
  - Colliders on layer 1, built from simple shapes (`PieceKit.box_shape`, `cylinder_shape`, `convex_shape`), never trimesh.
  - Each piece's size is the geometry noted in its `templates.ts` comment. A Kenney model is stretched to that size with `PieceKit.kenney(…, size)`.
- **Label words:**
  - Each template's 3 labels name the colour of the part that `PieceKit.label_colour` tints, so the clue "the red windmill" is true on screen.
  - Textured kit models keep their own material, and only the label part gets `PieceKit.mat(colour)`.
- **Site copy:** short, simple, plain Indian English, with basic words and no idioms. The hints and names below are exact.
- **Commands:**
  - Vitest: `pnpm vitest run games/treasure-hunt` from the repo root.
  - Typecheck: `pnpm typecheck`.
  - Godot: `timeout 300 ~/.local/bin/godot --headless --path games/treasure-hunt/godot --fixed-fps 60 --script res://tests/run_tests.gd`. Pass means exit 0, `0 failed`, and no `SCRIPT ERROR` or `Parse Error` in the output.
  - Run `~/.local/bin/godot --headless --path games/treasure-hunt/godot --import` after adding glb files or a `class_name` script.
  - Export with `node games/treasure-hunt/scripts/export-godot.mjs`, and commit only `games/treasure-hunt/client/godot/godot-build.json`.
- **Never run `pnpm build`.**
- **Fixtures:**
  - After changing templates or the generator, run `UPDATE_FIXTURES=1 pnpm vitest run games/treasure-hunt/test/fixtures.test.ts`, then the Godot tests.
  - New templates and kinds change which maps seeds make. A test pinned to one seed's exact pieces or caches gets its expectation updated, never loosened, and the commit body says which pins moved.

## Rulings made in this plan

- **A. Minor points: 60–80, not 40–80.** The spec allows both, and the done-bar is "keep finding new things". Today's maps average 59.
- **B. Garden lanterns.** §7.4's list of lit pieces names four. A fifth lit piece gives night rounds one more landmark to steer by, at the cost of one more OmniLight.
- **C. No dam, no bridge.**
  - The terrain has dry valleys and no rivers, so a dam holds back nothing, and a bridge needs spans fitted to the ground on both sides.
  - The siege camp and the garden take their places in the 16.
  - Cost if wrong: two spec starter templates wait for rivers.
- **D. A photo needs a piece at least `PHOTO_MIN_TOP` (3 m) tall.** The frozen lake and the hot spring are flat. A 10° lens at 200 m frames 35 m, so a flat piece would be a grey sliver.
- **E. Windmill sails turn when `turning` is 1.** They're visual only and sit at least 3.9 m up, so they never touch a slot or the walker. A turning windmill is still a fixed landmark.

## Review Focus

1. **A slot inside a stretched model.** A Kenney mesh's AABB often isn't its visual footprint (roof overhangs, banner poles). `piece_tests.gd` checks every slot against the colliders, not the meshes. Each builder also gets a test that no mesh's AABB contains a slot's capsule centre at dy + 0.9 m.
2. **A template that never shows up.** If a site rule is too strict, the template exists only in tests. Over 200 seeds, every template must place on at least 10% of maps, and every map must have at least 9 distinct templates.
3. **Two-word names in clue text.** "fire lookout", "hot spring", "frozen lake", "siege camp": `pieceLabel` gives "red fire lookout", so every hint must read right with a two-word `{label}`. The existing one-word-per-hint test covers repeats. Add a test that no hint has `{label}` twice and none ends in `{label}'s` (the possessive reads badly on two words).
4. **Night on new pieces.** Lit-only photos and lamp clues must pick up the windmill and garden lamps. There's a test that over 60 night seeds, at least one photo faces a windmill or garden.
5. **Fixture churn hiding a real break.** A regenerated fixture can paper over a builder that moved a slot. `pieces.json` changes only by adding templates: the existing 6 templates' samples stay byte-identical (Task 2 checks this).

---

### Task 1: Kit assets and the loader

**Files:**
- Create: `godot/assets/kenney_castle-kit/`, `godot/assets/kenney_town-kit/` (from `kenney_fantasy-town-kit_2.0.zip`), `godot/assets/kenney_survival-kit/`. Each holds the glbs below plus `Textures/colormap.png`.
- Modify: `godot/assets/kenney_nature-kit/` (add files), `godot/assets/LICENSES.md`, `godot/scripts/pieces/kit.gd`
- Test: `godot/tests/piece_tests.gd` (a new `test_kits` step)

**Interfaces:**
- Produces: `PieceKit.kenney(parent, file, pos, size, yaw := 0.0, material = null)` takes `file` as `"<kit>/<model>"` with kit ∈ `nature`, `castle`, `town`, `survival`. A bare name (no slash) stays the nature kit, so today's callers don't change.
- `PieceKit.COLOURS` gains `"brown": Color("#8a5a34")`.
- Files to copy (a builder may swap in a close sibling from the same kit, as long as LICENSES.md lists exactly what's copied):
  - **town:** windmill, blade, wall-wood, wall-wood-broken, wall-wood-doorway-square, roof-gable, fence, fence-broken, cart, fountain-round, hedge, lantern, pillar-wood, planks, stairs-wood
  - **castle:** tower-square-base, tower-square-mid, tower-square-top, wall-half, rocks-large, rocks-small, siege-trebuchet, siege-trebuchet-demolished, siege-catapult, siege-catapult-demolished, siege-ballista, siege-ballista-demolished, flag-banner-long
  - **survival:** box-large, barrel, structure-canvas, structure, campfire-fishing-stand, signpost, tool-pickaxe, tool-shovel, resource-stone-large, bucket
  - **nature (added):** cliff_block_rock, cliff_blockHalf_rock, cliff_cave_rock, rock_smallFlatA, rock_smallB, log_stack

- [ ] **Step 1: Write the failing test.** `test_kits` loads every copied model through `PieceKit.kenney` at size (1, 1, 1) and checks:
  - the mesh is non-null and its AABB size is above 0.01 on each axis;
  - textured models (castle, town, survival) keep a material with an albedo texture when no material is passed.
- [ ] **Step 2: Run** the Godot tests and see `test_kits` fail.
- [ ] **Step 3: Implement.**
  - Unzip each kit into the scratchpad and copy the listed glbs and `Textures/colormap.png`, keeping the relative path the glb expects.
  - Run `--import`, then extend the loader and `COLOURS`.
  - Add LICENSES.md rows (pack, author, source URL, CC0 1.0, version from the zip's License.txt) and a "Files used" table per kit.
- [ ] **Step 4: Run** the Godot tests. Expected: PASS. Check that `git status` shows no zip and no `.godot/` files staged.
- [ ] **Step 5: Commit** with the message `Treasure Hunt: castle, town and survival kits`.

### Task 2: Five built templates: windmill, farm, watchtower, fire lookout, garden

**Files:**
- Modify: `shared/types.ts` (`TemplateId`), `shared/templates.ts`, `shared/sites.ts`, `godot/scripts/pieces/kit.gd` (`BUILDERS`, `LABELS`)
- Create: `godot/scripts/pieces/windmill.gd`, `farm.gd`, `watchtower.gd`, `lookout.gd`, `garden.gd`
- Regenerate: `godot/tests/fixtures/pieces.json` and any layout fixtures
- Test: `test/pieces.test.ts`, `godot/tests/piece_tests.gd`

**Interfaces:**
- Consumes: the Task 1 loader. `Site` in `sites.ts` (`h`, `biome`, `sea`, `peak`) and `padSpread`.
- Produces: `TemplateId` gains `"windmill" | "farm" | "watchtower" | "lookout" | "garden"`.
- **Templates.** Local frame as today: −Z is the front, +X the right. R is the windmill's rolled `height`.
  - **windmill:** name "windmill", labels white/red/brown, padR 10.
    - **roll:** height 9–13 (0.1), turning 0|1.
    - **site:** biome meadow or rocky, h ≥ 12, padSpread(10) ≤ 3.
    - **top:** height + 1.5.
    - **lamps:** door `{0, 2.6, −2.75, clue:true}`; hub `{0, height−1, −3.2, clue:false}`.
    - **geometry:**
      - the tower is 5 × 5 m, centred, height `height`;
      - the door is on −Z, and the roof cap is tinted by the label;
      - the hub is at (0, height−1, −2.8), with 4 blades each 0.45·height long, so the lowest tip is ≥ 3.95 m up;
      - a stack of crates 1 m high and 1.2 m square is centred at (3.8, 0).
    - **slots:**
      - (0, −3.3, 0) "By the door of the {label}."
      - (0, 3.3, 0) "Behind the {label}."
      - (3.8, 0, 1) "On the crates beside the {label}."
  - **farm:** name "farm", labels red/white/yellow (the barn walls), padR 16.
    - **roll:** buildings 1–3, ruin 0–2 (0 roofed, 1 roof broken, 2 walls only).
    - **site:** biome meadow or wetland, padSpread(16) ≤ 2.
    - **top:** 5 when ruin < 2, else 3.
    - **geometry:**
      - barn: 6 × 4 m, centred at (0, −5), walls 3 m, a 1.4 m doorway in the middle of its +Z wall;
      - building 2 at (−9, 3) and building 3 at (9, 3): each 4 × 4 m, walls 3 m, no doorway;
      - a cart (1.4 × 2.4, along Z) at (0, 4);
      - a broken fence along z = 10, x −6..6.
    - **slots:**
      - (0, −5, 0) "Inside the barn of the {label}."
      - (1.8, 4, 0) "Beside the cart at the {label}."
      - (0, 9.2, 0) "By the broken fence of the {label}."
  - **watchtower:** name "watchtower", labels grey/sandy/dark, padR 10.
    - **roll:** floors 1–3, broken 0|1.
    - **site:** biome ≠ forest, h ≥ 15, padSpread(10) ≤ 3.
    - **top:** floors·4 + (broken ? 0 : 1.5).
    - **geometry:**
      - tower: 5 × 5 m, centred, floors·4 tall, a doorway on −Z, solid inside (one box collider);
      - a rubble block 1.6 × 0.5 × 1.2 centred at (4.2, 0);
      - broken: no top cap, and a second rubble block at (−4.2, 1).
    - **slots:**
      - (0, −3.3, 0) "At the door of the {label}."
      - (4.2, 0, 0.5) "On the fallen stones by the {label}."
      - (0, 3.3, 0) "Behind the {label}."
  - **lookout:** name "fire lookout", labels green/brown/red (the cabin), padR 8.
    - **roll:** stilts 4–8 (0.1).
    - **site:** biome forest, h ≥ 10, padSpread(8) ≤ 3.
    - **top:** stilts + 3.5.
    - **geometry:**
      - 4 posts 0.25 m square at (±1.6, ±1.6);
      - a 4 × 4 × 2.5 cabin on top at y = stilts, with a 1 m roof;
      - a ladder of planks on the +Z face, x −0.4..0.4, z 1.6..2.0;
      - a log stack 1.6 × 1 × 0.8 centred at (3.6, −1).
    - **slots:**
      - (0, 0, 0) "Under the {label}, between its legs."
      - (0, 2.7, 0) "At the foot of the ladder of the {label}."
      - (3.6, 0.3, 0) "Beside the wood pile at the {label}."
  - **garden:** name "garden", labels white/sandy/dark (the fountain stone), padR 14.
    - **roll:** hedge 1.2–2.0 (0.1).
    - **site:** biome meadow, padSpread(14) ≤ 2.
    - **top:** 2.
    - **lamps:** `{−1.8, 2.2, −9.6, clue:true}` and `{1.8, 2.2, −9.6, clue:false}`.
    - **geometry:**
      - a square hedge ring with the hedge's centre line at x, z = ±8, 0.8 thick, `hedge` tall, with 2 m gaps at the middle of the −Z and +Z sides;
      - a fountain at the centre: radius 2, rim 0.6, centre column to 1.6;
      - lantern posts (0.1 thick, no collider, as at the camp) at (±1.8, −9.6), on either side of the −Z gate.
    - **slots:**
      - (0, 3, 0) "Behind the fountain in the {label}."
      - (6.5, 6.5, 0) "In a corner of the {label}."
      - (0, −9.5, 0) "Outside the gate of the {label}."
- **Hints.** Every hint above is exact copy.

- [ ] **Step 1: Write the failing tests.**
  - `pieces.test.ts`, for each new template:
    - `top` and `lamps` equal the values above for two rolls;
    - slots equal the listed ones;
    - every slot is within `padR − 1` of the origin;
    - slots are at least 1.5 m apart.
  - Hint test (Review Focus 3): no hint has `{label}` twice, and none contains `{label}'s`.
  - `pieces.json` for the old 6 templates is byte-identical to the committed one (parse both and compare those keys).
  - `piece_tests.gd`, per new sample: no `GeometryInstance3D`'s world AABB contains the point (slot.x, dy + 0.9, slot.z) (Review Focus 1).
  - The windmill with turning 1: after 60 frames, the blades' node has turned and the slot capsules are still clear.
- [ ] **Step 2: Run** vitest and Godot. Both fail.
- [ ] **Step 3: Implement** the templates, site rules and builders. Regenerate the fixtures, then fix any pinned seed tests as the Global Constraints say.
- [ ] **Step 4: Run** vitest, typecheck and Godot. Expected: PASS.
- [ ] **Step 5: Commit** with the message `Treasure Hunt: windmill, farm, watchtower, fire lookout and garden`.

### Task 3: Five land templates: quarry, cave, hot spring, frozen lake, siege camp

**Files:**
- Modify: `shared/types.ts`, `shared/templates.ts`, `shared/sites.ts`, `shared/sky.ts` (`PHOTO_MIN_TOP`), `server/photos.ts`, `godot/scripts/pieces/kit.gd`
- Create: `godot/scripts/pieces/quarry.gd`, `cave.gd`, `hot_spring.gd`, `frozen_lake.gd`, `siege_camp.gd`
- Regenerate: fixtures
- Test: `test/pieces.test.ts`, `test/photos.test.ts`, `godot/tests/piece_tests.gd`

**Interfaces:**
- Produces:
  - `TemplateId` gains `"quarry" | "cave" | "hot-spring" | "frozen-lake" | "siege-camp"`.
  - `PHOTO_MIN_TOP = 3` in `shared/sky.ts`. `photoCam` skips a target whose `top` is under it.
  - All 16 templates define `top`. The 4 old ones without it (shipwreck, stone-circle, camp, plane) get a `top` that matches what their builders already build. M4a's `piece_tests` check holds it to within 0.15 of the merged AABB top, so read the value off the builder; don't change the builder.
  - Adding those 4 `top`s changes shadow and photo candidates for the old templates. That's intended: re-run the clue tests and update pins. Task 2's byte-identical check on the old 6 templates now ignores `top` for these 4.
- **Templates:**
  - **quarry:** name "quarry", labels grey/sandy/red (the rock), padR 16.
    - **roll:** terraces 2–3.
    - **site:** biome rocky, padSpread(16) ≤ 4.
    - **top:** 2·terraces − 1.
    - **geometry:**
      - an open-fronted horseshoe of rock blocks (nature `cliff_*`);
      - step k (k = 0..terraces−1) is a block x −8..8, z (2+2k)..(4+2k), height 2k+1;
      - side walls at x −10..−8 and 8..10, z 0..(2+2·terraces), height 2·terraces−1;
      - a cart (1.4 × 2.4 along Z) at (4, −3), and tools leaning on it.
    - **slots:**
      - (−4, 3, 1) "On the lowest step of the {label}."
      - (5.8, −3, 0) "Beside the cart in the {label}."
      - (0, −8, 0) "At the mouth of the {label}."
  - **cave:** name "cave", labels grey/dark/sandy (the rock), padR 12.
    - **roll:** chambers 1–3.
    - **site:** biome rocky, padSpread(12) ≤ 6.
    - **top:** 6.
    - **geometry:**
      - a rock mound x −7..7, z −2..10, 6 m high;
      - a tunnel 2.5 wide and 2.5 high runs in from z = −2 along +Z for 3·chambers m;
      - the mound is built from boxes around the hollow: left and right walls, a roof slab and a back wall;
      - a rock 1 × 0.5 × 1 at (−5.5, −4).
    - **slots:**
      - (2.6, −3, 0) "At the mouth of the {label}."
      - (0, 3·chambers − 3.5, 0) "Deep inside the {label}."
      - (−5.5, −4, 0.5) "On a rock by the {label}."
  - **hot-spring:** name "hot spring", labels blue/green/white (the water), padR 10.
    - **roll:** steam 0–2, pools 1–2.
    - **site:** biome rocky or wetland, padSpread(10) ≤ 2.
    - **top:** 1.
    - **geometry:**
      - a pool of radius 3 at (0, 0): a water disc at y 0.05 inside a ring of rocks of radius 3–3.6, 0.4 high, with a ring collider;
      - if pools = 2, a second pool of radius 2 (rock ring 2–2.6) at (6.8, 2.5);
      - steam is a `CPUParticles3D` over each pool, `amount` 0 / 12 / 24 by `steam`;
      - a flat rock 1.2 × 0.5 × 1.2 at (−4.8, 2).
    - **slots:**
      - (0, −4.2, 0) "Among the rocks at the edge of the {label}."
      - (−4.8, 2, 0.5) "On a flat rock by the {label}."
      - pools = 2: (6.8, 5.7, 0) "Beside the small pool of the {label}."
  - **frozen-lake:** name "frozen lake", labels blue/white/grey (the ice), padR 18.
    - **roll:** hole 0|1.
    - **site:** biome snowcap, or rocky with h ≥ 25; padSpread(18) ≤ 3.
    - **top:** 2.5.
    - **geometry:**
      - an ice disc of radius 12 at y 0.03 (no collider; the pad is the floor);
      - if hole: a dark disc of radius 1.2 at (4, −3), and a fishing stand at (5.6, −3);
      - a canvas shelter 3 × 2.5 × 2.5 at (−11, 6).
    - **slots:**
      - (4, −1.4, 0) "By the hole in the ice of the {label}." when hole = 1, else (0, 0, 0) "In the middle of the {label}."
      - (−8.6, 6, 0) "Beside the shelter at the {label}."
      - (0, 13.5, 0) "On the far shore of the {label}."
  - **siege-camp:** name "siege camp", labels red/blue/yellow (the banners), padR 16.
    - **roll:** engines 2–3, broken 0..engines (int).
    - **site:** biome meadow or rocky, padSpread(16) ≤ 3.
    - **top:** 8 when the trebuchet stands, else 3. The trebuchet is the first to break.
    - **geometry:**
      - engine 0: a trebuchet 4 × 6 (x × z) at (0, −6);
      - engine 1: a catapult 3 × 4 at (−7, 3);
      - engine 2: a ballista 2.5 × 3 at (7, 3);
      - the first `broken` engines use the demolished models;
      - banner poles at (±3, 8).
    - **slots:**
      - (3, −6, 0) "Beside the big siege engine at the {label}."
      - (−7, 6, 0) "Behind the catapult at the {label}."
      - (0, 8, 0) "Between the banners at the {label}."

- [ ] **Step 1: Write the failing tests.**
  - The same per-template checks as in Task 2.
  - `photos.test.ts`: a layout whose only piece within `PHOTO_MAX` is a hot spring gives `photoCam` null.
  - Over 60 day seeds, no photo target has `top < PHOTO_MIN_TOP`.
- [ ] **Step 2: Run** and see the tests fail.
- [ ] **Step 3: Implement** the templates, rules, the 4 old `top`s, the photo filter and the builders. Regenerate the fixtures and update pins.
- [ ] **Step 4: Run** vitest, typecheck and Godot. Expected: PASS.
- [ ] **Step 5: Commit** with the message `Treasure Hunt: quarry, cave, hot spring, frozen lake and siege camp`.

### Task 4: Denser minor points, eight kinds

**Files:**
- Modify: `shared/minor.ts`, `godot/scripts/world/minor_points.gd`
- Regenerate: fixtures
- Test: `test/generate.test.ts` or a new `test/minor.test.ts`, `godot/tests/minor_tests.gd`

**Interfaces:**
- Produces:
  - `MinorKind` = `"rocks" | "log" | "campfire" | "shed" | "barrels" | "signpost" | "woodpile" | "cart"`.
  - `MINOR_MIN = 60`. `MINOR_MAX` stays 80.
  - `TRIES` rises as needed so 1000 seeds still validate.
- **New footprints and slots (local frame):**

  | kind | footprint | slot | hint |
  |---|---|---|---|
  | shed | survival `structure`: 2.4 × 2.4 × 2.4, centred | (2.2, 0, 0) | "Beside an old shed." |
  | barrels | 2–3 barrels within 0.8 m, ≤ 1.1 m high | (1.2, 0, 0) | "Beside some old barrels." |
  | signpost | a post 0.15 m thick, 2 m high, with a sign | (1.2, 0, 0) | "At the foot of a signpost." |
  | woodpile | nature `log_stack`: 1.8 (along Z) × 0.9 × 1.0 | (1.5, 0, 0) | "Beside a stack of logs." |
  | cart | town `cart`: 1.4 × 2.4 (along Z) | (1.4, 0, 0) | "Next to an old cart." |

- **kindFor by biome:**

  | biome | kinds |
  |---|---|
  | forest | log, campfire, woodpile, shed |
  | rocky | rocks, signpost, barrels |
  | snowcap | rocks, shed, signpost |
  | wetland | log, signpost, barrels |
  | meadow | any of the 8 |

  Pick uniformly within the list.

- [ ] **Step 1: Write the failing tests.**
  - Over 200 seeds, every map has 60–80 minor points.
  - Every one of the 8 kinds appears on at least 50% of maps.
  - kindFor never gives a kind outside its biome's list.
  - The 1000-seed validation still passes.
  - `minor_tests.gd`: each new kind's slot capsule is clear of its colliders, and its root sits on the ground (as the existing kinds are tested).
- [ ] **Step 2: Run** and see the tests fail.
- [ ] **Step 3: Implement.** Regenerate the fixtures and update pins.
- [ ] **Step 4: Run** vitest, typecheck and Godot. Expected: PASS.
- [ ] **Step 5: Commit** with the message `Treasure Hunt: more minor points, five new kinds`.

### Task 5: Library-wide checks, budget and export

**Files:**
- Modify: `test/pieces.test.ts`, maybe `shared/sites.ts` (site rules loosened only to meet these bars)
- Regenerate: `games/treasure-hunt/client/godot/godot-build.json` via export
- Test: `test/pieces.test.ts`, `test/caches.test.ts`

**Interfaces:** consumes all of the above. Produces no new names.

- [ ] **Step 1: Write the tests** (Review Focus 2 and 4).
  - Over 200 seeds:
    - every one of the 16 templates is placed on ≥ 10% of maps;
    - every map has ≥ 9 distinct templates;
    - the mean number of distinct templates per map is ≥ 10.
  - `makeLayout` plus `makeHunt` averages under 60 ms per seed over 50 seeds.
  - Over 60 night seeds, at least one photo faces a windmill or a garden.
- [ ] **Step 2: Run them.** If a template misses 10%, loosen only its own site rule (a bigger padSpread allowance, or one more biome). The ledger records which rule changed and why.
- [ ] **Step 3: Export** with `node games/treasure-hunt/scripts/export-godot.mjs`. The `.pck` grows by the copied kit files only: check that the export's file size rises by under 3 MB.
- [ ] **Step 4: Run** everything: vitest, typecheck and Godot. Expected: PASS.
- [ ] **Step 5: Commit** with the message `Treasure Hunt: library checks and a fresh build`.

### Task 6: Browser check (controller)

Run `pnpm dev`. Make a room and play a 15-minute Timed round at Day, then a Night round. Check these:
- **Every new template seen once:** use the private state's layout and the photo-render trick (`host.photos({list})` with test ids, and `emitPhoto` wrapped) to render each new template up close, by day and by night.
- **Clue board:** two-word labels read right ("Under the green fire lookout, between its legs.").
- **Night:** the windmill and garden lamps glow, and the windmill's sails turn.
- **Walking:** stand in the cave's back chamber, the barn and the garden corner. Each slot is reachable and visible with the torch.
- **Health:** no console errors, and the world loads in under 10 s.

Log the results in the ledger. Findings go to the final fix wave.
