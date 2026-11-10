# Treasure Hunt M1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** M1 from the spec (§12.1). One person can walk and drive around a new, seeded 1.5 km map in the browser: on foot or in a buggy, getting in and out, with chunks loading around them and land that closes off the edges.

**Architecture:** A new package, `games/treasure-hunt`, laid out like `games/blind-rally`:
- `shared/` holds the TypeScript generator for layers 1–2 (macro heightfield and biomes, §4.2) and the layout type.
- `server/` holds a small `GameDefinition` that rolls the seed, builds the layout and starts exploring once every client has built its world.
- `godot/` is a new Godot 4.7 project. It builds layer 8 (2 m detail terrain) per 64 m chunk from the layout, streams chunks around the player, and runs the walker, the buggy and the camera.
- `client/` hosts the Godot web export in a same-origin iframe and talks to it through a JS host object, copied from Blind Rally's navigator.

**Tech Stack:**
- TypeScript, vitest, pnpm workspaces, `@games/game-core`, `@games/ui`.
- Godot 4.7.2 (`~/.local/bin/godot`), GDScript only, GL Compatibility renderer, Jolt physics at 60 Hz.
- Single-threaded web export (`web_nothreads_release.zip`).

**Spec:** `treasure-hunt-spec.md` (repo root). Read it alongside this plan. Section numbers below refer to it.

**Reference map:** `/tmp/claude-1000/-home-chakradharreddy-Repos-personal-projects-games/43612477-1c62-447b-a570-c4111be5de8d/scratchpad/blind-rally-map.md`. It maps the Blind Rally files this plan copies from. Read the section a task names. Don't read the whole thing.

## Global Constraints

- Package `@games/treasure-hunt`, directory `games/treasure-hunt`, manifest `id: "treasure-hunt"`, `name: "Treasure Hunt"`, `minPlayers: 1`, `maxPlayers: 8`.
- World coordinates are metres. Godot uses −Z forward. Playable area is x, z ∈ [−750, 750]. Edge ring runs to ±950. Sea level is y = 0.
- Macro grid: 32 m cells, origin −960, 61 × 61 vertices. Heights cross the wire as integer decimetres. Detail terrain: 2 m cells, 64 m chunks (33 × 33 vertices).
- Do not hoist shared Godot code into a common folder (§11, "wait until it hurts"). Copy what you need from `games/blind-rally/godot` into `games/treasure-hunt/godot`.
- No Godot threads. The web export is single-threaded, so the spec's "background thread" (§10) becomes time-slicing across frames.
- Desktop only for the game view (§2). Phones see the lobby and a plain message instead.
- Gated by a flag the same way Blind Rally is: server var `TREASURE_HUNT=1` and web env `VITE_TREASURE_HUNT=1`. `pnpm dev` sets both. `pnpm run deploy` and `pnpm host` set neither in M1.
- Site copy is plain Indian English: short sentences, basic words, no idioms.
- Commits go straight to `master`, one per task, and are pushed after each commit. Subject line `Treasure Hunt: <what a player gets>`, then a short body that explains why, in the style of `git show a176078`. End every message with `Claude-Session: https://claude.ai/code/session_01KwNUn9dpkZKSPFkAmAoz5c`. Stage only your files and never use `git add -A`, because the repo root has unrelated untracked files.
- TypeScript checks: `pnpm vitest run games/treasure-hunt` and `pnpm --filter @games/treasure-hunt typecheck`.
- Godot checks: `godot --headless --path games/treasure-hunt/godot --fixed-fps 60 --script res://tests/run_tests.gd`. Expect exit code 0, a final `0 failed`, and no `SCRIPT ERROR` or `Parse Error` anywhere in the output (grep for both).

## Review Focus

1. **A seed that spawns you in water or on a cliff.** The spawn is always on land (macro height ≥ 2 m) with a gentle slope. Test is in Task 1, over 1000 seeds.
2. **The buggy outruns chunk building.** You never fall through the ground. The chunk under the focus point and its 8 neighbours are built at once, outside the frame budget. Test is in Task 3.
3. **The session arrives twice** (reconnect, or Godot ready before the session). The world builds once per seed. A repeat `initSession` with the same seed does nothing. A different seed rebuilds. Test is in Task 6.
4. **Getting out of the buggy where the side is blocked.** You land on a clear spot. Try left, then right, then behind, then on the roof. Test is in Task 5.
5. **A client that never reports ready** (a hidden tab or a slow laptop). The round starts after `READY_TIMEOUT_MS` anyway, and that player becomes a spectator. A late `ready` does nothing. Test is in Task 2.

---

### Task 1: Package and the world generator, layers 1–2

**Files:**
- Create: `games/treasure-hunt/package.json`, `tsconfig.json` (copy Blind Rally's, rename the package to `@games/treasure-hunt`, keep `include: ["shared","server","client","test"]`, deps `@games/game-core`, `@games/ui`, `@games/protocol`)
- Create: `games/treasure-hunt/shared/world.ts`, `noise.ts`, `generate.ts`, `types.ts`, `index.ts`
- Create: `games/treasure-hunt/scripts/write-fixtures.ts` (or the fixture test below writes them when `UPDATE_FIXTURES=1`)
- Test: `games/treasure-hunt/test/generate.test.ts`, `test/fixtures.test.ts`
- Output: `games/treasure-hunt/godot/tests/fixtures/layout_{1,2,3,4,5}.json`

**Interfaces:**
- Produces, in `shared/world.ts`:
  ```ts
  export const PLAY_HALF = 750, WORLD_HALF = 950, SEA_LEVEL = 0;
  export const MACRO_CELL = 32, MACRO_ORIGIN = -960, MACRO_SIZE = 61;
  export const WALL_HALF = 770;             // invisible wall, 20 m into the ring (§4.4)
  export const BIOMES = ["meadow", "forest", "rocky", "wetland", "snowcap"] as const;
  export type Biome = (typeof BIOMES)[number];
  export type RingSide = "mountain" | "sea";
  ```
- Produces, in `shared/types.ts`:
  ```ts
  export interface TreasureLayout {
    version: 1;
    seed: number;                       // the seed actually used (after rerolls)
    macro: { origin: number; cell: number; size: number;
             heights: number[];         // size*size ints, decimetres, x fastest
             biomes: number[] };        // size*size indices into BIOMES
    ring: [RingSide, RingSide, RingSide, RingSide]; // north (−z), east (+x), south (+z), west (−x)
    spawn: { x: number; z: number; yaw: number };   // yaw in radians, faces the map centre
  }
  ```
- Produces, in `shared/generate.ts`:
  - `generateLayout(seed: number): TreasureLayout`. A pure, deterministic function of the seed (integer hashing, no `Math.random`).
  - `validateLayout(l: TreasureLayout): string[]`. Returns the problems found; empty means valid.
  - `makeLayout(seed: number): TreasureLayout`. Tries `seed`, `seed+1`, … up to 10 times and returns the first valid one. It throws if none of them is valid.
  - `macroHeight(l: TreasureLayout, x: number, z: number): number`. Bilinear interpolation, in metres. The server's loose height check uses it later.
- Produces, in `shared/noise.ts`: `valueNoise2(seed: number, x: number, z: number): number` (in [−1, 1], smooth) and `fbm2(seed, x, z, octaves, lacunarity, gain): number`.

Rules the generator must meet (§4.2 layers 1–2, §4.4). The algorithm is up to you; the properties are pinned:
- **Ring:** each side is `mountain` or `sea`. Each side is sea with probability 0.35, with at most 2 sea sides.
  - Mountain side: macro height 96 m outside the playable edge minus the height at the edge is ≥ 81 m, everywhere along that side (≈ 40° on average).
  - Sea side: height 64 m outside the playable edge is ≤ −3 m. The shoreline (height between 0 and 2 m) falls within the playable area's outer 150 m.
  - Corners take the steeper of the two rules.
- **Inside the playable area:** at least 70% of vertices are land (height > 0). Land heights mostly fall in 2–90 m. The interior has 2–4 basins, 1–3 ridges, and 1–2 river valleys. A valley is carved 8–15 m deep and 40–80 m wide along a polyline that crosses the playable area.
- **Biome per vertex,** in this order:
  - height ≥ 140 m → snowcap
  - slope ≥ 0.6 (height rise per metre, over neighbouring vertices) or height ≥ 100 m → rocky
  - height < 6 m and moisture > 0.55 → wetland
  - moisture > 0.5 → forest
  - otherwise meadow
  - `moisture = (fbm2(seed ^ 0x9e37, x/400, z/400, 3, 2, 0.5) + 1) / 2`
- **Spawn:** inside the playable area with a 100 m margin from its edge. Macro height ≥ 2 m. Slope < 0.25 over the surrounding cell.
- **Validation:** the ring rules above hold, land is at least 70%, the playable land has at least 3 distinct biomes, the spawn rules hold, and every height is finite.

- [ ] **Step 1: Write the failing tests** in `test/generate.test.ts`:
  - `generateLayout(7)` deep-equals a second `generateLayout(7)`, and `generateLayout(8)` differs.
  - The shape is right: `heights.length === 61*61`, `biomes.length === 61*61`, every height is an integer, every biome is in `[0, 5)`.
  - `macroHeight` at a vertex equals that vertex's height / 10. Midway between two vertices it equals their mean.
  - **1000 seeds** (seeds 1..1000): `validateLayout(makeLayout(s))` is `[]` for every one, and fewer than 2% of the seeds needed a reroll. Assert the counts. The spec asks for zero failed maps.
  - **1000 seeds spawn check** (Review Focus 1): for every spawn, `macroHeight ≥ 2`, the spawn is inside ±650, and yaw points at the origin within 0.01 rad.
  - A forced-ring case, using a test hook or a seed found by search: a layout with a sea side passes the sea rule, and one with 4 mountain sides passes the mountain rule.
  - Keep the whole file under 10 s.
- [ ] **Step 2:** Run `pnpm vitest run games/treasure-hunt/test/generate.test.ts`. Expected: FAIL, because the module isn't there.
- [ ] **Step 3:** Implement `shared/`.
- [ ] **Step 4:** Write `test/fixtures.test.ts`. For seeds 1–5 it compares `makeLayout(seed)` with `godot/tests/fixtures/layout_<seed>.json`. When `process.env.UPDATE_FIXTURES === "1"` it rewrites those files instead. Run it once with `UPDATE_FIXTURES=1` to create them, then run it without the variable. Expected: PASS. Godot tests read these files, so a generator change that isn't in the fixtures fails in vitest first.
- [ ] **Step 5:** Run `pnpm install`, all package tests, and the typecheck. Then commit and push. Subject: `Treasure Hunt: a new map from every seed`.

### Task 2: Server game

**Files:**
- Create: `games/treasure-hunt/shared/manifest.ts`, `shared/rules-text.ts` (export `treasureHuntManifest`, `treasureHuntRules: string[]`, `treasureHuntSettingFields(raw, players): SettingField[]`, which returns `[]` in M1)
- Create: `games/treasure-hunt/server/game.ts`, `server/index.ts` (`export { treasureHuntGame }`)
- Test: `games/treasure-hunt/test/game.test.ts`

**Interfaces:**
- Consumes: `makeLayout`, `TreasureLayout`.
- Produces, in `shared/types.ts` (add):
  ```ts
  export const READY_TIMEOUT_MS = 60_000;
  export type Phase = "generating" | "exploring" | "finished";
  export interface THPlayer { id: string; ready: boolean; spectator: boolean; removed: boolean }
  export interface THState { phase: Phase; seed: number; layout: TreasureLayout; players: THPlayer[];
                             startedAt: number | null; endedAt: number | null }
  export interface THPublic { phase: Phase; layout: TreasureLayout; players: THPlayer[]; startedAt: number | null }
  export type THAction = { type: "ready" } | { type: "end" };
  export type THEvent = { type: "explore-start"; spectators: string[] } | { type: "ended" } | { type: "player-removed"; playerId: string };
  export type THSettings = Record<string, never>;
  ```
- Produces: `treasureHuntGame: GameDefinition<THState, THAction, THPublic, Record<string, never>, THSettings, THEvent>`.

Rules:
- `createGame`: `seed = ctx.randomInt(2 ** 31)`, `layout = makeLayout(seed)`, every player starts `ready: false`, phase `generating`, and it sets the timer `"ready-timeout"` to `READY_TIMEOUT_MS`.
- `ready`: marks the player ready. When every non-removed player is ready: phase `exploring`, `startedAt = ctx.now`, cancel the timer, emit `explore-start` with no spectators. A `ready` in any other phase, or a repeat, is accepted as a no-op (Review Focus 5). Reject nothing that a slow tab could send late.
- `onTimer("ready-timeout")` in `generating`: players who aren't ready become `spectator: true`, then the same start happens. In other phases it does nothing.
- `end`: host only (`ctx.hostId`; reject `not-host` otherwise), and only in `exploring` (otherwise reject `not-exploring`). It sets phase `finished`, `endedAt = ctx.now`, and emits `ended`.
- `onPlayerRemoved`: marks the player `removed`, emits `player-removed`, and runs the "everyone ready?" check again. With no players left, it finishes.
- `getResult` when finished: `{ winnerIds: [], standings: [], headline: "Exploring is over." }`. Check that the shell's results screen copes with no winners. If it doesn't, return every non-removed player as a winner with the label "explored". Say which you chose in the report.
- `getAwaitedPlayerIds`: the players not yet ready during `generating`, otherwise `[]`.
- Manifest description: `"Explore a new map every round. Walk, or drive a buggy. Hidden caches come next."`. `icon` is an existing key; Rally uses `"car"`, so use that unless a better existing key fits. `treasureHuntRules`: 4–6 plain lines covering moving (WASD, mouse to look, Shift to run, Space to jump, E to get in or out of the buggy, R to right the buggy). Say that a computer with a keyboard is needed, and that caches are not in this version yet.

- [ ] **Step 1: Write the failing tests:**
  - create → `generating`, a layout is present, and the `ready-timeout` timer is set
  - all ready → `exploring` with an `explore-start` event and the timer cancelled
  - a timeout with one player not ready → that player is a spectator, and the phase is `exploring`
  - a late `ready` after start is ok and leaves state unchanged
  - `end` from a non-host is rejected `not-host`
  - `end` in `generating` is rejected `not-exploring`
  - removing the last unready player starts the round
  - `getPublicState` has the layout
  - `parseAction` rejects unknown shapes
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement `server/game.ts`, the manifest and the rules text.
- [ ] **Step 4:** Run the tests and the typecheck. Expected: PASS and clean.
- [ ] **Step 5:** Commit and push. Subject: `Treasure Hunt: the server rolls a map and waits for everyone`.

### Task 3: Godot project and streamed terrain (layer 8)

**Files:**
- Create: `games/treasure-hunt/godot/project.godot`. Copy the Blind Rally settings from the reference map §1 "Godot version and renderer": features 4.7 and GL Compatibility, Jolt, 60 Hz, physics interpolation, msaa 0. Add an `[input]` section with these actions:
  - `move_forward` (W, Up), `move_back` (S, Down), `move_left` (A, Left), `move_right` (D, Right)
  - `jump` (Space), `run` (Shift), `interact` (E), `reset_vehicle` (R), `release_mouse` (Escape)
- Create: `godot/export_presets.cfg`: one preset named `"Web"`, `variant/thread_support=false`, `export_path="../build/web/index.html"`, `exclude_filter="tests/*, web/*"`, custom shell `res://web/shell.html`.
- Create: `godot/scripts/world/terrain_field.gd`, `chunk.gd`, `chunk_streamer.gd`, `far_terrain.gd`, `water.gd`, `bounds.gd`, `godot/shaders/ground.gdshader` (new, simple: vertex colour × light, plus a slope darkening; no weather include in M1)
- Create: `godot/tests/run_tests.gd`. Copy Blind Rally's runner structure from reference map §4: the `Crashes` logger, `check`, the sub-suite pattern, and exit codes. It instantiates nothing by default. Each suite builds what it needs.
- Test: `godot/tests/terrain_tests.gd`, `godot/tests/stream_tests.gd`
- Create: `games/treasure-hunt/.gitignore` with `godot/.godot/` and `build/`

**Interfaces:**
- Consumes: the fixture JSON files from Task 1 (`res://tests/fixtures/layout_<n>.json`).
- Produces:
  - `class_name TerrainField extends RefCounted`
    - `static func from_layout(layout: Dictionary) -> TerrainField`
    - `func macro_height(x: float, z: float) -> float`: bilinear, the same as the TS `macroHeight`
    - `func height_at(x: float, z: float) -> float`: `macro_height + detail`, where detail is a `FastNoiseLite` (SIMPLEX_SMOOTH, FBM 3 octaves, frequency 1/40, seed = `layout.seed + 11`) × `DETAIL_AMP = 3.0`, and detail fades to 0 where macro height is below 1 m (keeps beaches flat)
    - `func normal_at(x, z) -> Vector3`, `func biome_at(x, z) -> int` (nearest macro vertex)
    - `var spawn: Vector3` (y from `height_at`), `var spawn_yaw: float`, `var ring: Array`, `var seed: int`
    - Constants mirroring `shared/world.ts`
  - `class_name TerrainChunk extends StaticBody3D`
    - `static func build(field: TerrainField, cx: int, cz: int, mat: Material) -> TerrainChunk`
    - Covers x ∈ [cx·64, cx·64+64] and z ∈ [cz·64, cz·64+64]
    - 33 × 33 vertices from `field.height_at`
    - Collider is a `HeightMapShape3D` 33 × 33 with uniform scale 2 (the scaled-heightmap trick, reference map §7)
    - Mesh is an `ArrayMesh` with vertex normals from `field.normal_at` (so seams match) and vertex colour from the biome palette
  - `class_name ChunkStreamer extends Node3D`
    - `func setup(field: TerrainField, mat: Material) -> void`
    - `const LOAD_RADIUS := 400.0`, `const UNLOAD_RADIUS := 480.0`, `const FRAME_BUDGET_MS := 4.0`
    - `func load_initial(at: Vector3) -> int`: builds every chunk whose centre is within `LOAD_RADIUS` of `at`, synchronously, and returns elapsed ms
    - `func ensure_around(at: Vector3) -> void`: builds the 3 × 3 chunks around `at` at once if missing
    - `func update(at: Vector3) -> void`: called each frame. It calls `ensure_around(at)`, then builds missing in-radius chunks nearest-first until `FRAME_BUDGET_MS` is spent, then frees chunks beyond `UNLOAD_RADIUS`
    - `func has_chunk(cx: int, cz: int) -> bool`, `func loaded_count() -> int`
    - Only chunks inside the world (±960) exist.
  - `far_terrain.gd`: one mesh over the whole world from the macro grid (32 m spacing), with heights `field.height_at(vertex) − 2·DETAIL_AMP` so it always sits below near chunks. No collider.
  - `water.gd`: a plane at y = 0 covering ±1200 with a simple blue translucent material. No collider.
  - `bounds.gd`: 4 static `BoxShape3D` walls at ±`WALL_HALF` (770), 400 m tall and 10 m thick, on physics layer 1, no mesh.
  - Biome vertex colours: meadow (0.45, 0.62, 0.30), forest (0.22, 0.42, 0.22), rocky (0.50, 0.48, 0.45), wetland (0.35, 0.45, 0.32), snowcap (0.92, 0.94, 0.96). Below 1.5 m height, sand (0.80, 0.74, 0.55).

- [ ] **Step 1: Write the failing Godot tests:**
  - `terrain_tests.gd`:
    - `macro_height` at a few vertices of `layout_1.json` equals `heights[i]/10`.
    - A built chunk's collider heights equal `height_at` at 5 sampled vertices, within 1 cm.
    - Two neighbouring chunks share edge heights exactly.
    - The far mesh is below `height_at` at 200 random points.
    - A mountain side of a fixture has `height_at` at 96 m into the ring ≥ edge + 75 m (detail can shave a little).
    - The walls exist at ±770.
  - `stream_tests.gd`:
    - `load_initial(spawn)` builds every in-radius chunk and nothing beyond `UNLOAD_RADIUS`.
    - It returns < 3000 ms per fixture headless.
    - **Review Focus 2:** after `load_initial`, teleport the focus 300 m and call `update` once. `has_chunk` is true for the focus chunk and its 8 neighbours.
    - Moving the focus away by 600 m and updating until stable frees the old chunks (`loaded_count` stays ≤ the in-radius count).
    - One `update` with nothing to build spends under 1 ms.
- [ ] **Step 2:** Run the Godot command. Expected: FAIL (missing scripts).
- [ ] **Step 3:** Implement. Per-vertex GDScript is fine inside one chunk (1089 vertices). The spec's ban is on per-vertex loops over the whole map, so never loop over the full 2 m grid.
- [ ] **Step 4:** Run the Godot command. Expected: exit 0, `0 failed`, and no SCRIPT ERROR or Parse Error. Record each fixture's `load_initial` ms in the report.
- [ ] **Step 5:** Commit and push. Subject: `Treasure Hunt: the land builds itself around you`.

### Task 4: Walking and the camera

**Files:**
- Create: `godot/scripts/player/walker.gd`, `godot/scripts/camera/rig_camera.gd`, `godot/scripts/main.gd`, `godot/scenes/main.tscn`
- Test: `godot/tests/walker_tests.gd`

**Interfaces:**
- Consumes: `TerrainField`, `ChunkStreamer`, `far_terrain.gd`, `water.gd`, `bounds.gd`.
- Produces:
  - `class_name Walker extends CharacterBody3D`
    - A capsule with radius 0.35 m and height 1.8 m, drawn as a capsule plus a small head sphere. It's a placeholder until a character pack lands.
    - `const WALK_SPEED := 1.7` (6 km/h, the spec's crossing speed, §4.3), `const RUN_SPEED := 3.4` (hold `run`), `const JUMP_VELOCITY := 4.5`, `const GRAVITY := 20.0`
    - `floor_max_angle = deg_to_rad(40)` (§4.2 reachable-on-foot slope)
    - `const SCRAMBLE_HEIGHT := 1.0`: moving into a ledge ≤ 1.0 m high while `jump` is held lifts you onto it over 0.25 s
    - `var input_enabled := true`
    - `func set_move(input: Vector2, run: bool, jump: bool) -> void` for tests; real input is read from the InputMap when `input_enabled`
    - Movement is relative to `look_yaw: float`, which the camera sets.
  - `class_name RigCamera extends Node3D`
    - Contains a `SpringArm3D` (collision mask 1) and a `Camera3D`.
    - `func follow(target: Node3D, profile: StringName) -> void`, with profiles `&"walk"` {length 4.0, pivot height 1.5, pitch −15°} and `&"drive"` {length 7.0, pivot height 2.0, pitch −12°}
    - Switching profile blends the length, pivot and target over `BLEND_S := 0.4` (§7.3).
    - Mouse look: a click captures the mouse, `release_mouse` frees it, and the sensitivity is 0.003 rad/px. Pitch is clamped to [−70°, 30°].
    - In the `drive` profile, yaw drifts back behind the target after 1.5 s without mouse input.
    - `var yaw: float` is read by the walker.
  - `main.gd` (on `main.tscn`)
    - `func start_world(layout: Dictionary) -> void`: builds the `TerrainField`, sets up the streamer, far terrain, water and bounds, places the walker at the spawn facing `spawn_yaw`, calls `load_initial`, then emits `signal world_ready(ms: int)`.
    - Without a host (editor or local run) it loads `res://tests/fixtures/layout_1.json`, or `layout_<n>` from a `--layout=<n>` command-line argument or a `?layout=<n>` URL query.
    - A daytime `DirectionalLight3D` (shadows on, 1024 map) and a `WorldEnvironment` with a procedural sky and distance fog starting at 300 m and ending at 1200 m.
    - **Fall check:** a body more than 5 m below `height_at` is placed back on the surface.
    - F3 toggles an FPS and chunk-count label.

- [ ] **Step 1: Write the failing tests** in `walker_tests.gd`. Use `main.tscn` with `layout_1`:
  - The walker starts on the ground at the spawn (within 0.3 m of `height_at`).
  - 2 s of forward input on flat ground covers 3.4 m ± 0.5 at walk, and 6.8 ± 0.8 with run.
  - A jump leaves the ground and lands.
  - Scramble: place a 0.9 m box ahead, hold forward and jump → the walker ends on top of it. A 1.6 m box isn't climbed.
  - The walker can't pass the wall at x = 770 (place it at 765 and push +x for 3 s).
  - Teleport the walker 20 m under the ground → next frame it's back on the surface.
  - `RigCamera`: after `follow(walker, &"drive")`, the arm length reaches 7.0 within 0.45 s.
- [ ] **Step 2:** Run the Godot command. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the Godot command. Expected: clean, as in Task 3. Also launch it windowed once (`godot --path games/treasure-hunt/godot`) and walk around for a sanity look if a display is available. Say in the report whether you could.
- [ ] **Step 5:** Commit and push. Subject: `Treasure Hunt: walk the map`.

### Task 5: The buggy, getting in and out, and righting it

**Files:**
- Create: `godot/scripts/vehicle/buggy.gd`. Copy `games/blind-rally/godot/scripts/car_controller.gd` and trim it to what a single vehicle needs. Drop the presets, wet/snow/puddles and remote control, and keep the arcade model.
- Create: `godot/scenes/buggy.tscn`, `godot/scripts/player/avatar.gd`
- Copy: the baked 4×4 body and wheel meshes from `games/blind-rally/godot/assets/meshes/` (whatever `Vehicles.PRESETS["4x4"].model` names) into `godot/assets/meshes/`. Also copy `assets/materials/vertex_color.tres`, and write `godot/assets/LICENSES.md` crediting the Kenney Car Kit (CC0) as the placeholder buggy body.
- Test: `godot/tests/buggy_tests.gd`

**Interfaces:**
- Consumes: `Walker`, `RigCamera`, `main.gd`.
- Produces:
  - `class_name Buggy extends CharacterBody3D`, collision layer 2.
    - Tuning: `max_speed = 15.3` (55 km/h, §7.2), `engine_accel = 9.0`, and grip higher than Blind Rally's hatch on dirt and grass (no surface probes in M1: treat all ground as `"offroad"` with high grip).
    - Slope cap: `floor_max_angle = deg_to_rad(35)`. On a steeper floor, throttle gives no forward force and the buggy slides back.
    - `func set_control(steer: float, throttle: float, brake: float) -> void`. `var driver: Node = null`. `var forward_speed: float` (read-only).
    - Keyboard input only while it has a driver.
  - `class_name PlayerAvatar extends Node`, owning the walker, the buggy and the camera:
    - `var mode: StringName` (`&"foot"` or `&"driving"`)
    - `func interact() -> bool`:
      - On foot within `ENTER_RANGE := 3.0` m of the buggy's driver door point: hide the walker, disable its collision, snap it to the seat, set `buggy.driver`, call `camera.follow(buggy, &"drive")`, and return true.
      - Driving: exit to the first clear spot of left door (2 m left), right, 3 m behind, or the roof. Clear means a shape query with the walker's capsule finds no world overlap. Then show the walker, `camera.follow(walker, &"walk")`, and return true.
      - Otherwise return false.
    - `func reset_vehicle() -> bool`: only when the buggy has had speed < 0.5 m/s with throttle held for ≥ 2 s (§7.2: "after 2 s stuck"), or is tilted more than 60°. It places the buggy upright 1 m above `height_at` at its x/z and returns true.
  - `main.gd`: spawns the buggy 6 m to the right of the walker's spawn, facing the same way. It also routes `interact` and `reset_vehicle` to the avatar. The streamer's focus is whichever body the player is controlling.

- [ ] **Step 1: Write the failing tests** in `buggy_tests.gd`:
  - Full throttle on flat ground for 8 s → `forward_speed` within 1 m/s of 15.3, never above 15.8.
  - It climbs a 25° ramp (a test box rotated) but fails a 45° ramp: after 5 s of throttle at its base it has gained < 2 m of height.
  - `interact` at 5 m from the door returns false. At 2 m it returns true, with `mode == &"driving"` and the walker hidden.
  - **Review Focus 4:** park the buggy with a wall box flush on its left side, then `interact` → the walker ends on the right side, clear of the wall.
  - Exit with both sides and the back blocked → the walker ends up on the roof.
  - `reset_vehicle` is false while moving. After 2.1 s of throttle against a wall it's true, and the buggy is upright on the ground.
  - The camera arm reaches the `drive` length after entering.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the Godot command. Expected: clean.
- [ ] **Step 5:** Commit and push. Subject: `Treasure Hunt: a buggy to cross the map`.

### Task 6: Web export, the browser view, and the lobby slot

**Files:**
- Create: `godot/web/shell.html`. Copy Blind Rally's and rename the boot message key `blindRallyBoot` → `treasureHuntBoot`.
- Create: `godot/scripts/web_bridge.gd`. Copy Blind Rally's (reference map §2) and rename the host global `blindRallyHost` → `treasureHuntHost`. Keep the deferred attach, the polling, `_cb_*` retention and JSON round-trips. The M1 interface:
  - TS → Godot: `initSession(config)` with `config = { layout: TreasureLayout }`
  - Godot → TS: `ready()`, `emitStatus({ kind: "world-ready", ms, chunks })`
- Create: `scripts/export-godot.mjs`. Copy Blind Rally's and trim it:
  - no tracks step, no `--upload`
  - public dir `apps/web/public/treasure-hunt/godot/<hash>/`
  - manifest `client/godot/godot-build.json` with `base: /treasure-hunt/godot/<hash>/`
- Create: `client/index.ts`, `client/view.ts`, `client/godot/bridge.ts`, `client/godot/loader.ts`, `client/godot/godot-build.json` (written by the export), `client/styles.css`, `client/env.d.ts`
- Modify:
  - `apps/server/src/games.ts`: add `treasureHunt` to `GameFlags`, include the game when it's on, and read `this.env.TREASURE_HUNT === "1"` where `index.ts` builds the flags.
  - `apps/server/package.json`: the dep, and `--var TREASURE_HUNT:1` in `dev`.
  - `apps/web/src/games.ts`: an entry behind `import.meta.env.VITE_TREASURE_HUNT === "1"`, section `"racing"`.
  - `apps/web/package.json`: the dep.
  - `apps/web/.env.development`: `VITE_TREASURE_HUNT=1`.
  - Root `.gitignore`: `apps/web/public/treasure-hunt/godot/`.
- Create: `docs/games/treasure-hunt.md`, plus a row in `docs/games/README.md` under Racing: `| [Treasure Hunt](treasure-hunt.md) | 1–8 | Explore a new 3D map every round. Caches coming soon. |`. Add a short "Treasure Hunt and its flag" note to the root `README.md` next to Blind Rally's.
- Test: `test/build.test.ts` (same checks as Blind Rally's `build.test.ts` with the new base), `test/session.test.ts`

**Interfaces:**
- Consumes: `THPublic`, `THAction`, `main.gd start_world`, `world_ready`.
- Produces: `default export: GameClientModule`. The view:
  - `generating`: mount the Godot iframe full-size with the loader's progress bar. When Godot calls `ready()`, send `initSession({ layout })`. On `world-ready`, send `act({ type: "ready" })` once, then show "Waiting for N players" until the phase is `exploring`.
  - `exploring`: the iframe fills the game area, plus a small top bar with an "End" button for the host (`act({type:"end"})`) and a one-line help strip: "Click to look around. WASD to move. E to get in or out."
  - **Phones and touch:** if `matchMedia("(pointer: coarse)")` matches and there's no fine pointer, don't mount Godot. Show "Treasure Hunt needs a computer with a keyboard and mouse." That player still sends `ready` so the room isn't held up.
  - **Review Focus 3:** the bridge sends `initSession` once per layout seed. If Godot calls `ready()` again (an iframe reload), the session is re-sent. In Godot, `main.gd` ignores a session whose `layout.seed` equals the world it already built, and rebuilds for a different seed.
  - `session.test.ts` covers this decision in a pure function: `shouldSendSession(lastSentSeed: number | null, godotReloaded: boolean, layoutSeed: number): boolean`.
  - Godot side: add a test to `stream_tests.gd` that calls `start_world` twice with the same layout (the second call doesn't rebuild; check that the chunk node instance ids are unchanged), then with `layout_2` (the world rebuilds).

- [ ] **Step 1: Write the failing tests:** `build.test.ts`, `session.test.ts`, and the Godot double-session test.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement the bridge, the view, the export script, the registration and the docs.
- [ ] **Step 4:** Run `node games/treasure-hunt/scripts/export-godot.mjs`. Expected: an export in `apps/web/public/treasure-hunt/godot/<hash>/` and an updated `godot-build.json`. Then run `pnpm install`, `pnpm typecheck`, `pnpm vitest run` (the whole repo), the Godot command and `pnpm build`. All must be clean.
- [ ] **Step 5:** Commit and push, without the export output, which is gitignored. Commit `godot-build.json`, though: the client imports it. Subject: `Treasure Hunt: play it in the browser`.

### Task 7: Browser check (controller-run, not a code task)

- [ ] Run the export, then start `pnpm dev`. Open the app with `#owner=dev` on a desktop-size window, create a room, pick Treasure Hunt and start.
- [ ] Measure the time from start to `world-ready` (the status event's `ms`, plus wall time) for 3 rounds. Target: under 10 s (§12 M1).
- [ ] Walk, run and jump. Get in the buggy, drive across the map for at least 60 s, and check that no chunk holes or missing ground appear ahead. Get out, get back in, and use R after getting stuck. Try to cross a mountain side and a sea side, and confirm the walls stop you.
- [ ] Read the F3 FPS during driving. Report the numbers. The target is 60 fps on this machine, with a 30 fps floor.
- [ ] Check the console for errors. Take screenshots of walking, driving, a mountain edge and a sea edge.
- [ ] Open the room on a phone-size touch emulation and confirm it shows the message, not the iframe.
