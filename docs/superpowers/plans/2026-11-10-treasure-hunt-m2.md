# Treasure Hunt M2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** M2 from the spec (§12.2). A full solo round works from start to end. The map has set pieces, trails and small points of interest. The server hides caches and gives each player clues. The player finds a cache, gets out of the buggy, presses E and claims it. A Timed round ends on the clock with a results screen.

**Architecture:** This builds on M1, which is on `master` (`017b801..f2a2b30`).
- `shared/` gains generator layers 3–5: set pieces, trails and minor points. They go into the layout every client gets.
- `server/` gains layers 6–7: caches and clues. They live under `server/` so the client bundle never imports them. Cache positions never go into public or private state.
- **Caches are revealed by distance** (Ruling R1). The client streams its position at 4 Hz. When a player comes within 40 m of a cache in their own pool, the server sends that one cache's position to that player alone, and records it so a reload can re-show it.
- Godot builds the set pieces from a template id and rolled parameters. It flattens pads and trails into the terrain, places minor points, and shows a cache only once the server reveals it.

**Tech Stack:** As M1. TypeScript, vitest, `@games/game-core`, Godot 4.7.2 GDScript, single-threaded web export.

**Spec:** `treasure-hunt-spec.md` (repo root). The § numbers below refer to it. The M1 plan, `docs/superpowers/plans/2026-11-10-treasure-hunt-m1.md`, describes the code this plan extends.

## Rulings made while planning (the user can overturn these at review)

- **R1. Revealing caches by distance.** §4.2 keeps cache positions off the client, but §6.1 needs the cache to be visible when you're close. Reveal it through a private stream relay at 40 m. The server keeps the reveal in private state, so an iframe reload shows it again.
- **R2. Art is greybox plus the Kenney models already in the repo.** The 6 templates are built in code from boxes, cylinders and prisms, plus nature-kit rocks, logs, the tent and the campfire, copied from `games/blind-rally/godot/assets`. M2 downloads no new packs. A better look comes in M4 with the full library.
- **R3. The 6 templates:** lighthouse, shipwreck, stone circle, radio tower, abandoned camp and crashed plane. Together they cover coast, flat meadow, peak, forest and open ground. On maps without sea (about 18%), the 4 inland templates fill the 10–14 slots.
- **R4. Repeats and labels.** A template can appear up to 3 times on a map. Each placement gets a label word that is unique among its own kind, such as "the red lighthouse". The word also sets its colour or tone in Godot, so a clue always names exactly one thing.
- **R5. Solo only.** Every player is their own team. Everyone starts at the M1 spawn, and other players are not drawn (that's M3). Timed is the only mode (Race to N is M3).
- **R6. The fail rule for caches.** Spec §4.2 says to reroll when more than 10% of caches fail. Here, invalid cache spots are filtered out before picking, and the generator rerolls when fewer than 20 valid spots remain. The intent is the same.
- **R7. Cache spots sit at most 1 m above the ground under them**, which is the scramble height. "High shelf" spots wait for M4.
- **R8. Countdown is 3 s.** Movement is locked until the phase is `hunting`. This fixes M1's deferred head-start issue.
- **R9. Compass.** Bearing clues need a heading, so Godot draws a compass strip. The full map, pins and minimap are M3.

## Global Constraints

- Every M1 Global Constraint still holds: the package, coordinates, macro grid, no Godot threads, desktop-only game view, the flags, site copy, commits and the check commands. Re-read the M1 plan's Global Constraints.
- North is −Z, east is +X. Bearings are degrees clockwise from north: `bearing = (atan2(dx, -dz) in degrees + 360) % 360`.
- The layout's `version` becomes `2`. Regenerate the Godot fixtures (`UPDATE_FIXTURES=1`).
- Cache data (positions, pools, clues) is imported only from `server/`. Nothing under `shared/` or `client/` may import `server/`. A test enforces this (Task 3).
- Constants are in `shared/world.ts` unless a task says otherwise:
  - `REVEAL_RADIUS = 40`, `CLAIM_RANGE = 3` (client), `CLAIM_CHECK = 6` (server, XZ)
  - `POS_HZ = 4`, `MAX_SPEED = 25` (m/s; the buggy tops out at 15.3), `JUMP_GRACE_MS = 5000`, `POS_STALE_MS = 2000`, `HEIGHT_TOL = 20`
  - `COUNTDOWN_MS = 3000`, `TIMED_MINUTES = [15, 30, 60]` (default 30)
- Clue text and UI copy follow the site copy rule: short plain sentences, basic words, no idioms.

## Review Focus

1. **A cache you can't reach or can't see.** It's underwater, inside a collider, floating, or more than 1 m above the ground. For every template and 3 parameter samples, Godot checks every slot: it's not inside a collider, a capsule fits there, and something solid is under it within 0.3 m. The test is in Task 5.
2. **A clue that points at two things, or at nothing.** Every set piece a clue names exists, and its label is unique among its kind. A bearing clue's rounded values put the cache within 60 m of the spot they describe. Over 1000 seeds. The test is in Task 3.
3. **Claiming the wrong way:** from the buggy, from 10 m, someone else's cache, twice, after a teleport, or with no position sent. Each is rejected with its own error. The test is in Task 4.
4. **Reloading mid-round.** Revealed caches, claimed caches, the clue board and the timer all come back. Nothing is claimed twice. The test is in Task 7.
5. **More players than caches.** With 8 players and 20 caches, every player still gets a non-empty pool, and no cache is in two pools. The test is in Task 4.

---

### Task 1: Set-piece catalog and layer 3

**Files:**
- Create: `games/treasure-hunt/shared/templates.ts`, `shared/sites.ts`
- Modify: `shared/types.ts` (add `SetPiece`, layout `version: 2`, `pieces`), `shared/generate.ts` (call layer 3 and validate it), `shared/index.ts`
- Test: `test/pieces.test.ts`, then update `test/generate.test.ts` and `test/fixtures.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type TemplateId = "lighthouse" | "shipwreck" | "stone-circle" | "radio-tower" | "camp" | "plane";
  export interface SetPiece {
    id: string;            // "p0", "p1", … in placement order
    template: TemplateId;
    x: number; z: number;  // rounded to 0.1 m
    yaw: number;           // radians, Godot style
    padY: number;          // flat pad height in metres (from macroHeight at x,z, rounded to 0.1)
    padR: number;          // pad radius in metres
    variant: number;       // index into TEMPLATES[t].labels; unique per template on a map
    params: Record<string, number>;   // booleans are 0/1
  }
  export interface Slot { x: number; z: number; dy: number; hint: string }   // local frame, before yaw
  export interface Template {
    id: TemplateId;
    name: string;                 // "lighthouse"
    labels: [string, string, string];
    padR: number;
    roll(r: Rng): Record<string, number>;
    slots(params: Record<string, number>): Slot[];   // 2–4 slots, 0 ≤ dy ≤ 1
  }
  export const TEMPLATES: Record<TemplateId, Template>;
  export function placePieces(l: TreasureLayout, r: Rng): SetPiece[];
  export function pieceLabel(p: SetPiece): string;    // "red lighthouse"
  export function worldSlot(p: SetPiece, s: Slot): { x: number; z: number; dy: number };
  ```
- Parameters and labels (exact):

  | Template | padR | params | labels | site rule (macro grid) |
  |---|---|---|---|---|
  | lighthouse | 10 | `height` 14–22, `ruined` 0/1 | red, white, blue | the map has a sea side; within 120 m of a vertex below 0 m; height ≥ 8 m |
  | shipwreck | 14 | `length` 12–20, `buried` 0–0.5, `tilt` −20–20 (deg) | blue, green, black | within 40 m of a vertex below 0 m; height 0.5–4 m |
  | stone-circle | 14 | `stones` 6–12, `fallen` 0–3 | grey, dark, sandy | meadow; max height difference ≤ 2 m across the pad |
  | radio-tower | 8 | `height` 20–35, `wires` 0/1 | red, white, yellow | no vertex within 150 m is higher |
  | camp | 14 | `tents` 1–3, `firepit` 0/1 | orange, green, blue | forest; max height difference ≤ 3 m across the pad |
  | plane | 16 | `debris` 10–30, `heading` 0–2π | white, yellow, red | not forest or snowcap; max height difference ≤ 3 m across the pad |

- Rules for every placement:
  - `|x|, |z| ≤ 690`
  - ≥ 150 m from every other piece and ≥ 60 m from the spawn
  - `macroHeight ≥ 0.5`
- Placement:
  - Roll a target of 10–14.
  - Walk the templates in an `r`-shuffled order, round-robin, trying shuffled macro-grid vertices.
  - Each template places at most 3 times.
  - Stop at the target, or when nothing more fits.
  - Fewer than 10 placed means `validateLayout` reports `"pieces"`.
- The `Rng` type and seeding come from `shared/noise.ts`. Use a stream keyed `seed ^ 0x5e7` so layer 3 never disturbs layers 1–2.

- [ ] **Step 1: Write failing tests** in `pieces.test.ts`:
  - `every template rolls params in range and gives 2–4 slots with 0 ≤ dy ≤ 1`, over 50 rolls each.
  - `placePieces keeps the spacing, bounds and site rules`, over 200 seeds: check each rule from the table, plus spacing ≥ 150 and labels unique per template.
  - `worldSlot rotates by yaw`: a slot `{x:2,z:0}` on a piece at the origin with yaw π/2 lands at x≈0, z≈−2.
  - `1000 seeds: makeLayout never fails and every map has 10–14 pieces`. If the site rules can't reach that, the implementer may relax the height-difference limits by up to 50%, and must report what changed.
- [ ] **Step 2:** Run `pnpm vitest run games/treasure-hunt`. Expected: FAIL.
- [ ] **Step 3:** Implement. Bump `version` to 2. Regenerate the fixtures with `UPDATE_FIXTURES=1 pnpm vitest run games/treasure-hunt/test/fixtures.test.ts`.
- [ ] **Step 4:** Run vitest and typecheck, then the Godot suite: M1 tests must still pass on the v2 fixtures. Expected: clean.
- [ ] **Step 5:** Commit and push: `Treasure Hunt: landmarks on every map`.

### Task 2: Trails and minor points (layers 4–5)

**Files:**
- Create: `shared/trails.ts`, `shared/minor.ts`
- Modify: `shared/types.ts` (`trails`, `minor`), `shared/generate.ts`
- Test: `test/trails.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface Trail { pts: [number, number][] }          // XZ, 0.1 m rounding, about 16 m apart
  export type MinorKind = "rocks" | "log" | "campfire";
  export interface MinorPoint { id: string; kind: MinorKind; x: number; z: number; yaw: number }  // id "m0", …
  export const TRAIL_HALF_WIDTH = 2;
  export function makeTrails(l: TreasureLayout, r: Rng): Trail[];
  export function placeMinor(l: TreasureLayout, r: Rng): MinorPoint[];
  export const MINOR_SLOT: Record<MinorKind, Slot>;   // one slot each; hints: "Beside a pile of rocks.", "Under a fallen log.", "Next to an old campfire."
  ```
- Trails:
  - Take a minimum spanning tree over the pieces plus the spawn, by plain distance, and drop edges longer than 450 m.
  - Each edge is a polyline sampled every 16 m, with a sideways sine wobble of amplitude 0–20 m (rolled per edge) that is zero at both ends.
  - Drop the edge if any sample has `macroHeight < 1` or a macro slope above 20°.
  - Trails stop at the pad edge, not at the piece's centre.
- Minor points:
  - Roll 40–80 of them, from uniform candidates with `|x|, |z| ≤ 720`.
  - Each point: `macroHeight ≥ 1` and slope < 25°.
  - Spacing: ≥ 35 m from each other, ≥ `padR + 20` from every piece and ≥ 6 m from any trail.
  - Kind by biome: forest → log or campfire, rocky → rocks, anything else → any of the three.
  - Seed streams: `seed ^ 0x7a11` for trails, `seed ^ 0x3140` for minor points.

- [ ] **Step 1: Failing tests:**
  - Over 200 seeds:
    - every trail point is on land with `macroHeight ≥ 1`;
    - trail points are 12–20 m apart;
    - every trail end is within `padR + 4` of a piece or the spawn;
    - minor points keep all their spacing rules.
  - Over 1000 seeds: 40–80 minor points per map, and every piece within 450 m of another piece is joined by some trail path.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement, then regenerate the fixtures.
- [ ] **Step 4:** Run vitest, typecheck and the Godot suite. Expected: clean.
- [ ] **Step 5:** Commit: `Treasure Hunt: tracks between the landmarks`.

### Task 3: Caches and clues (layers 6–7, server only)

**Files:**
- Create: `server/caches.ts`, `server/clues.ts`, `server/hunt.ts`
- Test: `test/caches.test.ts`, `test/clues.test.ts`, `test/imports.test.ts`

**Interfaces:**
- Consumes: `TEMPLATES`, `worldSlot`, `MINOR_SLOT`, `pieceLabel`, `macroHeight`, `makeLayout`'s validation.
- Produces:
  ```ts
  export interface Cache { id: string; x: number; z: number; dy: number; source: string /* piece or minor id */; difficulty: 1 | 2 | 3; clues: string[] }  // id "c0", …
  export function makeCaches(l: TreasureLayout, r: Rng): Cache[] | null;  // null = fewer than 20 valid spots
  export function cluesFor(l: TreasureLayout, c: Omit<Cache, "clues" | "difficulty">, r: Rng): { clues: string[]; difficulty: 1 | 2 | 3 };
  export function makeHunt(seed: number): { layout: TreasureLayout; caches: Cache[] };  // tries seed, seed+1, … up to 10 times; throws after that
  ```
- Cache spots:
  - Candidates are every piece slot (through `worldSlot`) plus every minor point's slot.
  - A spot is valid when `macroHeight ≥ 0.5`, `|x|, |z| ≤ 730`, and the macro slope there is < 35°.
  - Pick 20–30, about half from pieces when there are enough.
  - Fewer than 20 valid spots means `null`, and `makeHunt` rerolls (R6).
  - Seed stream `seed ^ 0xcac4e`.
- Clues. Pick one or two kinds; difficulty = the easiest kind the cache got:
  - **Landmark** (difficulty 1, piece slots only): the slot's `hint` with `{label}` filled in, e.g. `"Behind the door of the red lighthouse."`
  - **Relational** (difficulty 2): two pieces A and B where the cache's projection onto AB has t ∈ [0.2, 0.8] and lies within 25% of |AB| off the line. Text: `"Between the {A} and the {B}, nearer the {nearer one}."`
  - **Bearing** (difficulty 3): from the nearest piece within 600 m. Bearing rounded to 10°, distance to 50 m (minimum 50). Text: `"About {d} m from the {label}, at {b}°."`
  - Each cache gets 1 clue, or 2 with probability 0.4. Never two of the same kind.

- [ ] **Step 1: Failing tests:**
  - **Review Focus 2.** Over 1000 seeds through `makeHunt`:
    - zero throws, and 20–30 caches per map;
    - every cache has 1–2 clues;
    - every label a clue names belongs to exactly one piece on that map;
    - for bearing clues, the point at the rounded bearing and distance from the named piece is within 60 m of the cache;
    - relational clues meet their t and offset rules.
  - `imports.test.ts`: no file under `shared/` or `client/` imports from `server/`. Scan import specifiers with a regex.
  - Determinism: `makeHunt(42)` twice gives deep-equal results.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run vitest and typecheck. Expected: clean.
- [ ] **Step 5:** Commit: `Treasure Hunt: hidden caches and the clues to find them`.

### Task 4: The Timed round on the server

**Files:**
- Modify: `shared/types.ts`, `shared/rules-text.ts` (add `treasureHuntSettingFields`), `shared/index.ts`, `server/game.ts`
- Test: `test/game.test.ts` (extend), `test/claim.test.ts`

**Interfaces:**
- Produces:
  - Phases: `"generating" | "countdown" | "hunting" | "finished"`. This renames M1's `exploring`; update every use.
  - `THSettings = { minutes: 15 | 30 | 60 }`, default 30.
  - `treasureHuntSettingFields(raw: unknown, players: number): SettingField[]` gives one select, "Round length", with "15 minutes", "30 minutes" and "60 minutes". Copy Blind Rally's `blindRallySettingFields` shape.
  - State keeps `caches: Cache[]` and, per player:
    - `pool: string[]`, `found: string[]`, `revealed: string[]`, `lastClaimAt: number | null`;
    - and in memory only: `pos: {x,y,z,foot,at} | null`, `jumpAt: number`.
  - `THPublic` adds `endsAt: number | null`, `countdownEndsAt: number | null`, and per player `foundCount: number`, `poolSize: number`. No cache data.
  - `getPrivateState(s, id)` returns `{ clues: { id: string; clues: string[]; difficulty: number; found: boolean }[]; revealed: { id: string; x: number; z: number; dy: number }[] }`, covering only that player's pool.
  - Actions add `{ type: "claim"; cacheId: string }`. Stream input is `{ t: "pos"; x: number; y: number; z: number; foot: boolean }`.
  - Events: `countdown`, `hunt-start`, `claimed {playerId, foundCount}`, `ended`.
- Flow:
  - Everyone ready (or the M1 ready timeout) moves to `countdown`, with timer `countdown` = `COUNTDOWN_MS`.
  - Then `hunting`, with timer `round` = minutes × 60 000.
  - The round ends on the timer, when every active non-spectator has found their whole pool, or when the host sends `end`.
  - `createGame` uses `makeHunt(seed)`.
- Pools:
  - `size = min(8, floor(caches / players))`.
  - Sort the caches by difficulty, then deal them snake-wise to the non-spectator players, so every pool gets the same mix and no cache is in two pools.
  - Spectators get none.
  - Deal at `createGame`, then deal again at `countdown` with the final non-spectator list.
- `onStream` for a `pos` message, from a non-removed player in `countdown` or `hunting`:
  - If the speed from the last `pos` is above `MAX_SPEED` and the gap is under 2 s, set `jumpAt = now`.
  - Store `pos`.
  - For each unrevealed pool cache within `REVEAL_RADIUS` (XZ), add it to `revealed` and add a relay `{ to: [id], data: { t: "reveal", id, x, z, dy } }`.
  - Return `persist: false`, unless something was revealed.
- `claim` checks, in this order, each with its own code:
  - `not-hunting`
  - `not-yours` (not in your pool)
  - `already-found`
  - `no-position` (no `pos`, or older than `POS_STALE_MS`)
  - `in-vehicle` (`!foot`)
  - `too-far` (XZ > `CLAIM_CHECK`, or |y − macroHeight| > `HEIGHT_TOL`)
  - `moved-too-fast` (`now − jumpAt < JUMP_GRACE_MS`)
  - On success: push to `found`, set `lastClaimAt`, emit `claimed`, and end the round if everyone is done.
- `getResult`:
  - Standings sort by found count, then the total difficulty found, then the earlier `lastClaimAt`.
  - `value` is the found count, with label `"{n} found"`.
  - Winners are every player level with the top on all three keys. With nobody found, `winnerIds` is empty and the headline is `"Nobody found a cache."`

- [ ] **Step 1: Failing tests.** Cover each of the following:
  - The phases run in order with the right timers.
  - **Review Focus 5:** 8 players and 20 caches give pools of size 2, no overlap and the same difficulty totals ±1.
  - **Review Focus 3:** every claim error code, each reached by setting up exactly its condition.
  - A legal claim succeeds once, and the second try gives `already-found`.
  - A reveal relay goes only to the owner, only once per cache, and stays in private state.
  - A teleport (a 300 m jump in 0.25 s) blocks claims for 5 s, then allows them.
  - The round ends when the pool is cleared and when the timer fires.
  - The result order uses all three tie-breaks.
  - The public state JSON never holds any cache `x`. Search the stringified public state for every cache's x value.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run vitest and typecheck. Expected: clean.
- [ ] **Step 5:** Commit: `Treasure Hunt: a timed hunt you can win`.

### Task 5: Set pieces in Godot

**Files:**
- Create: `godot/scripts/pieces/kit.gd` (shared helpers), plus `lighthouse.gd`, `shipwreck.gd`, `stone_circle.gd`, `radio_tower.gd`, `camp.gd`, `plane.gd`, and `godot/scripts/world/pieces.gd`
- Copy: from `games/blind-rally/godot/assets/kenney_nature-kit/`, `rock_tallA.glb`, `rock_tallB.glb`, `rock_largeA.glb`, `tent_detailedOpen.glb`, `campfire_stones.glb`, `campfire_logs.glb`, `log.glb`, `log_large.glb` and `rock_smallA.glb` (with their textures). Credit them in `godot/assets/LICENSES.md`.
- Modify: `scripts/main.gd` (build the pieces in `start_world`)
- Test: `godot/tests/piece_tests.gd`, fixture `godot/tests/fixtures/pieces.json`, written by a new vitest case in `test/fixtures.test.ts`. For each template it holds 3 param samples (min, max and a middle roll) and each sample's slots.

**Interfaces:**
- Produces:
  - `class_name PieceKit` with `static func build(piece: Dictionary) -> Node3D`. It dispatches on `template`, and the root is placed at `(x, padY, z)` with `rotation.y = yaw`.
  - Each template script has `static func build(params: Dictionary, label_index: int) -> Node3D`, made of `MeshInstance3D` primitives plus `StaticBody3D` colliders on layer 1 with simple shapes. Label colours:
    - red `#c8463c`, white `#e8e4dc`, blue `#3c6ec8`, green `#4c8c4a`, black `#2a2a2a`, yellow `#e0b83a`, orange `#e07a2e`
    - grey `#8a8a86`, dark `#55534f`, sandy `#c2a878`
  - `Pieces` (in `world/pieces.gd`) has `func build_all(layout: Dictionary) -> void` and `func clear() -> void`. Each piece gets `visibility_range_end = 1100`.
  - The night lamp on the lighthouse and radio tower is an unlit emissive mesh only. Lighting comes in M4.
- Every slot must be open in the geometry: a capsule-sized space (r 0.35, h 1.8) standing on a surface at `dy`.

- [ ] **Step 1: Failing tests** in `piece_tests.gd`:
  - **Review Focus 1.** For every template × sample in `pieces.json`, build it at the origin on a flat test floor, then for every slot:
    - `intersect_point` finds no collider at slot + 0.5 m up;
    - a capsule shape query at the slot's standing position finds no overlap;
    - a ray from 2 m above the slot hits within 0.3 m of `dy`.
  - Every template has at least one collider. Every piece's AABB is under 60 m across, except the plane's debris, which may reach `debris` m.
  - `build_all` on `layout_1` makes one child per piece. Calling it twice replaces the pieces and doesn't double them.
- [ ] **Step 2:** Run the Godot suite. Expected: FAIL.
- [ ] **Step 3:** Implement. Keep each template script under about 120 lines.
- [ ] **Step 4:** Run the Godot suite and vitest. Expected: clean.
- [ ] **Step 5:** Commit: `Treasure Hunt: lighthouses, wrecks and stone circles`.

### Task 6: Pads, trails and minor points in the land

**Files:**
- Modify: `godot/scripts/world/terrain_field.gd`, `godot/shaders/ground.gdshader` (or the chunk's vertex colours), `scripts/main.gd`
- Create: `godot/scripts/world/minor_points.gd`
- Test: `godot/tests/terrain_tests.gd` (extend), `godot/tests/minor_tests.gd`

**Interfaces:**
- `TerrainField.height_at(x, z)` now also blends:
  - **Pads:** within `padR` the height is exactly `padY`. From `padR` to `padR + 10` it smoothsteps back to the normal terrain.
  - **Trails:** within `TRAIL_HALF_WIDTH + 1` m of a trail polyline, the detail noise scales to 0. The macro shape stays, so trails follow the land. Use a coarse spatial hash, so a lookup stays cheap.
- Trail ground colour: a dirt brown (`#8a6a48`) within the trail's half-width, blending out over 1 m.
- `MinorPoints` has `func build_all(layout: Dictionary)` and `clear()`, placing the copied Kenney models:
  - `rocks`: 3–5 rock models
  - `log`: `log_large`
  - `campfire`: stones plus logs
  - Each gets a collider and `visibility_range_end = 300`.

- [ ] **Step 1: Failing tests:**
  - `height_at` at a piece's centre equals `padY` (±0.01), and at `padR + 10` equals the plain field.
  - On a trail point, the detail noise is 0. Compare against `macro_height` (±0.01).
  - A chunk built over a pad has a flat floor (max − min < 0.05 within the pad).
  - The minor point count equals the layout's.
  - The M1 sea, walker and buggy tests still pass.
  - Time for `load_initial`: report it. It must stay under 1.5× M1's ~210 ms headless.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the Godot suite. Expected: clean.
- [ ] **Step 5:** Commit: `Treasure Hunt: flat ground under landmarks and dirt tracks`.

### Task 7: Caches, claiming and the compass in Godot

**Files:**
- Create: `godot/scripts/hunt/cache.gd`, `godot/scripts/hunt/caches.gd`, `godot/scripts/hud/compass.gd`, `godot/scripts/hud/prompt.gd`
- Modify: `scripts/web_bridge.gd`, `scripts/main.gd`, `scripts/player/avatar.gd`
- Test: `godot/tests/hunt_tests.gd`

**Interfaces:**
- Bridge, TS → Godot:
  - `revealCache({id, x, z, dy})`: idempotent by id.
  - `cacheFound({id})`
  - `setPhase({phase})`: walker and buggy input is on only in `hunting`.
- Bridge, Godot → TS:
  - `emitPos({x, y, z, foot})` at `POS_HZ`, only in `countdown` or `hunting`.
  - `emitClaim({id})`
- `Caches` has `reveal(id, x, z, dy)`, `found(id)`, `nearest_claimable(pos: Vector3) -> String` (within `CLAIM_RANGE`, not found, otherwise `""`) and `clear()`.
  - A cache is a 0.5 × 0.35 × 0.35 m crate in `#d8a23a`, with a lighter strip, placed at `height_at(x, z) + dy`. It has no collider.
  - `found(id)` hides it after a 0.3 s scale-down.
- `avatar.interact()`: on foot, a claimable cache comes first. It emits `emitClaim` and returns true without touching the buggy.
- HUD:
  - The compass is a strip at the top centre: ±60° of the camera's heading, ticks every 10°, labels every 30°, N/E/S/W, and the heading as a number.
  - The prompt reads "Press E to pick up" whenever `nearest_claimable` isn't empty.

- [ ] **Step 1: Failing tests:**
  - A repeated reveal makes one crate, sitting on the ground (±0.05).
  - `nearest_claimable` is empty at 3.5 m and returns the id at 2.5 m, and is empty once found.
  - `interact` near a cache claims it. The mode stays `foot` and `emitClaim` fires with the id.
  - `interact` in the buggy near a cache doesn't claim.
  - `setPhase("countdown")` stops the walker from moving under held input, and `hunting` lets it move.
  - The compass reads 0 facing −Z, 90 facing +X and 270 facing −X.
  - `emitPos` fires about 4 times a second (8 ± 1 in 2 s).
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the Godot suite. Expected: clean.
- [ ] **Step 5:** Commit: `Treasure Hunt: find a cache and pick it up`.

### Task 8: The browser view for a full round

**Files:**
- Modify: `client/view.ts`, `client/godot/bridge.ts`, `client/styles.css`, `apps/web/src/games.ts` (settingFields), `docs/games/treasure-hunt.md`, `shared/rules-text.ts`
- Create: `client/hud.ts` (the clue board, timer and countdown DOM; pure render functions)
- Test: `test/hud.test.ts`, `test/session.test.ts` (extend)

**Interfaces:**
- The view:
  - Forwards `emitPos` to `api.stream({t:"pos", …})` and `emitClaim` to `act({type:"claim", cacheId})`.
  - Relays `{t:"reveal"}` to `bridge.revealCache`.
  - On every state update, re-sends every `privateState.revealed` entry (idempotent), `cacheFound` for found ids, and `setPhase`.
  - Shows the claim error messages as a short toast, with plain text per code. For example, `in-vehicle` → "Get out of the buggy first."
- The HUD over the iframe:
  - **Timer:** `mm:ss` left, from `endsAt`.
  - **Score:** "3 of 6 found".
  - **Countdown:** "3", "2", "1" over the map.
  - **Clue board:** a right-side panel with its own toggle button. It lists the player's pool clues; found ones are ticked and greyed.
  - **Help line:** "Click to look around. WASD to move. E to get in or out, or to pick up a cache. 0° is north."
- `hud.ts` exports pure functions: `formatLeft(ms: number): string`, `scoreText(found: number, pool: number): string`, `clueItems(priv): {text: string; found: boolean}[]`.

- [ ] **Step 1: Failing tests:**
  - `formatLeft(0) === "0:00"`, `formatLeft(61_000) === "1:01"`, and negative values clamp to `"0:00"`.
  - `scoreText(3, 6) === "3 of 6 found"`.
  - **Review Focus 4:** a view-level pure function `resync(priv, phase)` returns the bridge calls to make: every reveal, every found id and the phase. Applying it twice gives the same set.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. Then run `node games/treasure-hunt/scripts/export-godot.mjs`, `pnpm typecheck` and `pnpm vitest run`, then the Godot suite. Don't run `pnpm build`. It leaves a wasm over 25 MiB in `apps/web/dist`, which breaks `wrangler dev`; if you need it, run `rm -rf apps/web/dist/*/godot` afterwards.
- [ ] **Step 4:** Update the docs and rules text (controls, clue kinds, how claiming works, Timed mode), in plain short sentences.
- [ ] **Step 5:** Commit: `Treasure Hunt: play a full timed round`.

### Task 9: Browser check (controller)

The controller plays one full solo round in `pnpm dev`:
- set a 15-minute round;
- read a landmark clue, drive to the piece, get out and claim the cache;
- read a bearing clue and use the compass;
- reload mid-round and check the reveals, clues and timer come back;
- end the round and check the results.

Report load time and any errors. FPS can't be measured in the automated window (see the M1 notes), so note that for the user.
