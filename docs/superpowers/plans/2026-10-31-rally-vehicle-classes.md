# Rally Vehicle Classes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Five Rally cars (Hatchback, 4x4, RWD Classic, Rally Truck, Tractor) that handle, look and sound different, picked per player or voted by the room.

**Architecture:** TS owns the class ids, names and picker data (`shared/vehicles.ts`) and the server rules (pick, vote, lock, carry). Only an id crosses the wire, in `initSession.vehicle` and the ghost relay. Godot owns everything physical: `scripts/vehicles.gd` presets (controller overrides, per-surface multipliers, model layout, engine sound), applied to the one existing `CarController`.

**Tech Stack:** TypeScript + vitest (server/shared/client), Godot 4 GDScript (headless test runner), PartyKit-style game-core definition.

**Spec:** `docs/superpowers/specs/2026-10-31-rally-vehicle-classes-design.md`

## Prerequisite (the user, before Task 5)

Kenney blocks scripted downloads. Download Car Kit 3.1 from https://kenney.nl/assets/car-kit and copy `suv.glb`, `sedan-sports.glb`, `truck.glb`, `tractor.glb` from its `Models/GLB format/` into `games/blind-rally/godot/assets/kenney_car-kit/` (the shared `Textures/colormap.png` is already there). Then run `godot --headless --path games/blind-rally/godot --import`. Tasks 1–4 don't need them.

## Global Constraints

- Ids, exactly: `hatch`, `4x4`, `rwd`, `truck`, `tractor`. Names: Hatchback, 4x4, RWD Classic, Rally Truck, Tractor. Default `hatch`.
- Rally only. Blind Rally (no `variant`) pins `vehiclePick: "free"`, rejects `vehicle.*` actions with code `rally-only`, and always drives `hatch`.
- `MAX_SPEED` stays 45 m/s, global. Every class must sit under it (Task 4 test).
- `hatch` must drive and look exactly like today's car: its preset is `{}` and the existing Godot suite passes unchanged.
- On-site copy: short plain sentences, basic words, no idioms (simple Indian English, see `shared/rally.ts` rules for the register).
- UI follows the shell's Ink & Lime theme (`apps/web/src/style.css`). Ignore `ui_theme.md`.
- Commit straight to `master`, one commit per task. Title `Rally: <what changed>`, then a short mechanism-first bulleted body ending with what was tested. Stage only the files the task touched (the tree has unrelated untracked files).
- Commands, from the repo root: TS tests `pnpm vitest run games/blind-rally`; typecheck `pnpm -C games/blind-rally typecheck`; Godot tests `godot --headless --path games/blind-rally/godot --fixed-fps 60 --script res://tests/run_tests.gd` (exit 0 = pass).

## Review Focus

1. **A player changes class after readying.** Their Godot has already built the old car, so the change must un-ready them (free mode), or un-ready every car when the ballot's leader moves. Owned by Task 2.
2. **A room saved before this deploy** (no `vehicle` on teams, no `vehicleId`/`vehicleBallot`, no `vehiclePick`) loads with `hatch` everywhere and no crash. Owned by Task 2 (`upgrade.ts`).
3. **A spare takes over a car** (`fitCars` gives Car 2 to p4) and gets `hatch`, not the old driver's pick. Owned by Task 2.
4. **The host flips `vehiclePick` mid-lobby.** ballot→free clears the votes and every car falls back to its own pick. free→ballot shows the ballot leader (or `vehicleId`) for everyone. Owned by Task 2.
5. **A ghost relay with a missing or unknown `vehicle`** (old page vs new Godot during a deploy) draws a hatch ghost and logs nothing louder than a warning. Owned by Task 6.

---

### Task 1: Vehicle catalog and the `vehiclePick` setting

**Files:**
- Create: `games/blind-rally/shared/vehicles.ts`
- Modify: `games/blind-rally/shared/types.ts` (settings type, `VEHICLE_PICKS`, `DEFAULT_SETTINGS`), `games/blind-rally/shared/rally.ts` (parse, fields, preview, rules, briefing), `games/blind-rally/shared/index.ts` (re-export)
- Modify: Blind Rally's settings parser (wherever `DEFAULT_SETTINGS` is parsed, `grep -n parseSettings games/blind-rally/shared/*.ts`) to pin `vehiclePick: "free"`
- Test: `games/blind-rally/test/rally.test.ts`

**Interfaces:**
- Produces:
  - `export const VEHICLE_IDS = ["hatch", "4x4", "rwd", "truck", "tractor"] as const;` (keep it on one line; Task 4's Godot test parses this exact line)
  - `export type VehicleId = (typeof VEHICLE_IDS)[number];`
  - `export const DEFAULT_VEHICLE: VehicleId = "hatch";`
  - `export const isVehicleId = (v: unknown): v is VehicleId`
  - `export interface VehicleInfo { name: string; blurb: string; bars: { speed: 1|2|3|4|5; grip: 1|2|3|4|5; offroad: 1|2|3|4|5; weight: 1|2|3|4|5 } }`
  - `export const VEHICLES: Record<VehicleId, VehicleInfo>`
  - `types.ts`: `export type VehiclePick = "free" | "ballot"; export const VEHICLE_PICKS: readonly VehiclePick[]`, `BlindRallySettings.vehiclePick: VehiclePick`

Bars and blurbs (copy fixed here):

| id | speed | grip | offroad | weight | blurb |
| --- | --- | --- | --- | --- | --- |
| hatch | 3 | 3 | 3 | 2 | Good at everything. A safe first choice. |
| 4x4 | 2 | 5 | 4 | 4 | Slow, but grips on every road. Mud and snow do not stop it. |
| rwd | 4 | 2 | 2 | 2 | Fast, and the back slides a lot. Best on tarmac. |
| truck | 5 | 2 | 3 | 5 | Very fast on straight roads. Brake early for turns. |
| tractor | 1 | 4 | 5 | 5 | Very slow. But it can drive across fields. |

- [ ] **Step 1: Write failing tests** in `test/rally.test.ts`, `describe("vehicle classes: settings")`:
  - `VEHICLE_IDS` equals `["hatch","4x4","rwd","truck","tractor"]` and every id has a `VEHICLES` entry with all four bars in 1..5.
  - `parseRallySettings(undefined)!.vehiclePick === "free"`; `parseRallySettings({vehiclePick:"ballot"})!.vehiclePick === "ballot"`; `parseRallySettings({vehiclePick:"x"}) === null`.
  - `rallySettingFields(undefined, 3)` has a field `key: "vehiclePick"`, label `"Cars"`, options labelled `"Each player chooses"` and `"Everyone votes"`.
  - `rallyPreview({vehiclePick:"ballot"})` has a `{label:"Cars"}` row whose value is `"Everyone votes. Everyone drives the winner"`; free: `"Each player chooses"`.
  - Blind Rally's parser given `{vehiclePick:"ballot"}` returns `vehiclePick: "free"`.
- [ ] **Step 2:** `pnpm vitest run games/blind-rally/test/rally.test.ts`. Expected: FAIL (`vehicles.ts` missing).
- [ ] **Step 3: Implement.** Add the field after `trackPick` in `rallySettingFields`, with hint `"Each car gets 1 vote. A coin toss decides a tie"` (ballot) / `"Choose your car on the grid screen"` (free). Add a rules line: `"Choose your car before the race. Each car drives in a different way."` and, after the track-vote line, `"The host can make everyone vote for 1 car. Then everyone drives that car."` `rallyBriefing` gains no line (the car is chosen before the briefing shows); the grid shows it.
- [ ] **Step 4:** run the tests and the typecheck. Expected: PASS, no type errors.
- [ ] **Step 5: Commit** `Rally: five car classes and a Cars setting`.

### Task 2: Server: pick, vote, lock, carry

**Files:**
- Create: `games/blind-rally/server/vehicles.ts`
- Modify: `shared/types.ts` (`TeamState.vehicle`, `BlindRallyState.vehicleId`/`vehicleBallot`, `BlindRallyCarry`, actions), `server/parse.ts`, `server/game.ts`, `server/ballot.ts`, `server/teams.ts`, `server/upgrade.ts`
- Test: `games/blind-rally/test/rally.test.ts`, `games/blind-rally/test/phases.test.ts` (upgrade)

**Interfaces:**
- Consumes: Task 1's `VehicleId`, `VEHICLE_IDS`, `isVehicleId`, `DEFAULT_VEHICLE`, `settings.vehiclePick`.
- Produces:
  - `TeamState.vehicle: VehicleId`, `BlindRallyState.vehicleId: VehicleId`, `BlindRallyState.vehicleBallot: { votes: { teamId: number; vehicleId: VehicleId }[]; tied: VehicleId[] }`
  - `BlindRallyCarry.teams[i].vehicle?: VehicleId`, `BlindRallyCarry.vehicleId?: VehicleId`
  - Actions: `{ type: "vehicle.pick"; vehicleId: VehicleId }`, `{ type: "vehicle.vote"; vehicleId: VehicleId | null }`
  - `ballot.ts`: `export function count<T extends string>(votes: T[], order: readonly T[], seedKey: string): { winner: T; tied: T[] } | null`, used by `tally` (order = `trackCatalog()` ids, key `${seed}:${target}:${leaders}` unchanged so existing tie tests still pass) and by `settleVehicle`
  - `server/vehicles.ts`: `export function vehicleOf(state: BlindRallyState, team: TeamState): VehicleId` (Blind Rally → `hatch`; ballot → `state.vehicleId`; free → `team.vehicle`) and `export function settleVehicle(state: BlindRallyState): boolean` (drop dead cars' votes, clear votes when not in ballot mode, recount, move `vehicleId`; un-ready every car's player when it moves; returns whether it moved)

- [ ] **Step 1: Write failing tests**, `describe("vehicle classes: rules")`, using `newRally`, `act`, `refused`, `rallying` from `test/helpers.ts`:
  - New cars start `vehicle: "hatch"`, `state.vehicleId === "hatch"`.
  - Free: `vehicle.pick {vehicleId:"truck"}` by p0 sets team 1's vehicle and sets p0 `ready: false` (after p0 had readied). Picking the same class again changes nothing.
  - Refusals: `vehicle.pick` in ballot mode → `"cars-voted"`; `vehicle.vote` in free mode → `"cars-chosen"`; either after the start (`rallying(2)`) → `"wrong-phase"`; a watcher (`newRally(5)`, p4) → `"not-seated"`; Blind Rally (`newGame(4)`) → `"rally-only"`; parse rejects `{type:"vehicle.pick", vehicleId:"bus"}`.
  - Ballot: p0 votes `rwd`, p1 votes `rwd`, p2 votes `4x4` → `vehicleId === "rwd"`, every car's player un-readied when the leader moved. A 1–1 tie between `rwd` and `4x4` → `vehicleBallot.tied` equals both, and the winner is the same on a second identical run (seeded). `vehicle.vote {vehicleId:null}` takes the vote back. No votes → `vehicleId` stays what it was.
  - Review Focus 4: in ballot mode with votes, the host patches settings to free (use the same path the existing settings-change test uses, `game.ts:~330`) → votes empty, `vehicleOf` is each team's own pick.
  - Review Focus 3: p1 picks `truck`, p1 leaves, p4 takes Car 2 → Car 2's vehicle is `hatch`.
  - Carry: after `finishRun`, `rallyGame.carryOver` → new game with that carry keeps each car's vehicle and `vehicleId`.
  - Review Focus 2 (in `phases.test.ts` next to the existing upgrade test): a state without `vehicleId`, `vehicleBallot`, team `vehicle`, `settings.vehiclePick` → `upgrade` fills `hatch`, `{votes:[],tied:[]}`, `"free"`.
- [ ] **Step 2:** run, expect FAIL.
- [ ] **Step 3: Implement.** Error copy: `cars-voted` "Everyone votes for the car this time.", `cars-chosen` "Each player chooses a car this time. There is no vote.", `rally-only` "Cars cannot change in Blind Rally.", `not-seated` "You need a car first.", `wrong-phase` "The race has started. The car cannot change now." Call `settleVehicle` everywhere `settleTrack` is called in `game.ts`. `newTeam` sets `vehicle: DEFAULT_VEHICLE`; the seat-handover path in `teams.ts` that gives a freed car to a spare resets it to `DEFAULT_VEHICLE`. `restoreTeams`/`carryOf` carry `vehicle` (junk → `hatch`); `newGame` takes `carry.vehicleId` when valid. `upgrade.ts`: extend the early-return check and defaults.
- [ ] **Step 4:** run the whole package suite and the typecheck. Expected: PASS, and every existing track-ballot test unchanged.
- [ ] **Step 5: Commit** `Rally: pick a car, or vote for one`.

### Task 3: Over the wire: session, ghost, public state, results

**Files:**
- Modify: `shared/types.ts` (`NavigatorSession.vehicle`, `GhostRelay.vehicle`, `PublicTeam.vehicle`, `BlindRallyPublicState.vehiclePick` and `.vehicleBallot`), `server/projection.ts`, `server/race.ts` (`ghostOf`), `server/scoring.ts` (`placingLabel`), `client/rally/seat.ts` or wherever initSession is assembled from `session` (pass through, `grep -rn "teamShape" games/blind-rally/client`)
- Test: `test/rally.test.ts`, `test/projection.test.ts`, `test/stream.test.ts`

**Interfaces:**
- Consumes: Task 2's `vehicleOf`.
- Produces: `NavigatorSession.vehicle: VehicleId` (effective); `GhostRelay.vehicle: VehicleId`; `PublicTeam.vehicle: VehicleId` (effective); `BlindRallyPublicState.vehiclePick: VehiclePick`; `BlindRallyPublicState.vehicleBallot: { votes: {teamId:number; vehicleId:VehicleId}[]; tied: VehicleId[] } | null` (null unless ballot mode). Godot reads `initSession.vehicle` (string) and `ghost.vehicle` (string).

- [ ] **Step 1: Write failing tests:**
  - Free mode, Car 1 picks `rwd`: `getPrivateState(s,"p0").session.vehicle === "rwd"`; `getPublicState(s).teams[0].vehicle === "rwd"`; `vehicleBallot === null`.
  - Ballot mode won by `truck`: every team's `session.vehicle` and public `vehicle` is `truck`.
  - Shared-stage stream (existing ghost test pattern, `GHOST_EVERY_MS`): the relayed ghost has `vehicle` equal to the sender's effective class, and its key set is exactly the old keys plus `vehicle`.
  - Projection leak test: public state still has no coordinates (extend the existing check to the new fields).
  - `placingLabel` for a Rally finisher in `truck`: first line `"1st · Car 1 · Rally Truck · <track name>"`. Blind Rally's label is unchanged.
- [ ] **Step 2:** run, expect FAIL.
- [ ] **Step 3: Implement.** The class name in `placingLabel` only when `variant === "rally"`.
- [ ] **Step 4:** run the package suite and typecheck. Expected: PASS.
- [ ] **Step 5: Commit** `Rally: the car's class goes to Godot, the ghosts and the results`.

### Task 4: Godot presets and handling

**Files:**
- Create: `games/blind-rally/godot/scripts/vehicles.gd`
- Modify: `godot/scripts/car_controller.gd`, `godot/scripts/main.gd` (read `initSession.vehicle`)
- Create: `godot/tests/vehicle_tests.gd`; Modify: `godot/tests/run_tests.gd` (run it, like `rally_tests.gd`)

**Interfaces:**
- Produces:
  - `class_name Vehicles extends RefCounted`, `const IDS := ["hatch", "4x4", "rwd", "truck", "tractor"]`, `const PRESETS := { id: { "controller": {...}, "surfaces": {...}, "model": {...}, "audio": {...} } }`, `static func get_preset(id: String) -> Dictionary` (unknown → `hatch` + `push_warning`), `static func valid(id: String) -> String`
  - `CarController.vehicle: String` (read-only after apply), `CarController.apply_preset(id: String) -> void`: restores every `@export` to its scene default first (so switching classes on a re-init doesn't stack), then applies `controller` overrides and stores `surfaces` multipliers. `_physics_process` reads each surface field as `SURFACES[s][k] * _surf_mul.get(s, {}).get(k, 1.0)` (for `drag`, `grip`, `top`, `loose`, `traction`).
  - `main.gd`: on initSession, `car.apply_preset(Vehicles.valid(String(cfg.get("vehicle", "hatch"))))`. Probe build: key `V` cycles `Vehicles.IDS` (only when not `room`).

Starting tuning (hatch defaults in brackets; Task 7 tunes these):

| | engine_accel [13] | max_speed [32] | brake_decel [26] | max_yaw_rate [2.0] | yaw_response [9] | grip [6] | power_oversteer [0.9] | max_slip_deg [38] | drag [0.15] | impact_keep [0.45] | surfaces |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 4x4 | 11 | 29 | 26 | 1.9 | 7 | 7.5 | 0.5 | 30 | 0.15 | 0.65 | offroad `{drag:0.5, top:1.5, grip:1.2}`, sand `{drag:0.5, top:1.5}`, snow/ice `{grip:1.3}` |
| rwd | 14.5 | 33 | 26 | 2.1 | 10 | 4.8 | 1.6 | 46 | 0.15 | 0.45 | tarmac `{grip:1.1}` |
| truck | 12 | 38 | 19 | 1.6 | 6 | 5.5 | 0.6 | 34 | 0.10 | 0.7 | — |
| tractor | 9 | 19 | 26 | 2.0 | 8 | 7 | 0.3 | 28 | 0.15 | 0.7 | offroad `{drag:0.2, top:1.9}`, sand `{drag:0.25, top:1.9}` |

- [ ] **Step 1: Write failing tests** in `vehicle_tests.gd` (same shape as `rally_tests.gd`: `_init(runner)`, `run()`, `check()`):
  - `test_ids_match_ts`: read `ProjectSettings.globalize_path("res://") + "/../shared/vehicles.ts"`, regex the `VEHICLE_IDS = [...]` line, compare to `Vehicles.IDS` and `PRESETS.keys()`.
  - `test_speed_cap`: for each id, `max_speed × max over surfaces of (SURFACES[s].top × mul) × 1.15` (slope margin) `< 45.0`.
  - `test_hatch_is_today`: after `apply_preset("hatch")` every export equals its scene value.
  - `test_switch_does_not_stack`: `apply_preset("truck")` then `apply_preset("hatch")` → `max_speed == 32.0`.
  - `test_tractor_offroad`: on the existing offroad patch used by `test_offroad_slower`, full throttle 4 s: tractor's speed > hatch's speed.
  - `test_unknown_falls_back`: `apply_preset("bus")` → `car.vehicle == "hatch"`.
- [ ] **Step 2:** run the Godot suite. Expected: FAIL (`Vehicles` missing).
- [ ] **Step 3: Implement** per Interfaces. Leave `model` and `audio` empty dictionaries for now (Tasks 5, 6).
- [ ] **Step 4:** run the Godot suite. Expected: all pass, the pre-existing tests included.
- [ ] **Step 5: Commit** `Rally: five sets of handling in Godot`.

### Task 5: Godot models and paint (needs the Prerequisite)

**Files:**
- Modify: `godot/tools/bake_assets.gd` (JOBS `car_body_4x4`, `car_wheel_4x4`, … for `suv`, `sedan-sports`, `truck`, `tractor`), `godot/scripts/vehicles.gd` (`model`), `godot/scripts/car_paint.gd`, `godot/scripts/car_fx.gd`, `godot/scripts/camera_controller.gd` (bonnet offset from the preset), `godot/assets/LICENSES.md`
- Create (generated): `godot/assets/meshes/car_body_<id>.res`, `car_wheel_<id>.res`
- Test: `godot/tests/vehicle_tests.gd`

**Interfaces:**
- Consumes: Task 4's `Vehicles`, `apply_preset`.
- Produces: preset `model` keys: `body: String` (mesh path), `wheel: String`, `wheels: Array[Vector3]` (FL, FR, RL, RR in car space, the shape `car_fx.wheels` already uses), `box: Vector3` (collision size), `box_y: float`, `roundel: Transform3D`, `pod: Transform3D`, `stripes: bool`, `bonnet: Vector3`. `hatch` model = today's values, read off `car.tscn`. `static func Vehicles.dress(car: CarController, id: String) -> void` swaps Body/Wheel meshes, moves the wheels, roundel, light pod and collision shape, hides the stripes when `stripes` is false, and sets `car_fx.wheels` and the camera's `bonnet_offset`. `apply_preset` calls it. `CarPaint.ghost_mesh(vehicle: String, color: Color, shape: String) -> ArrayMesh` builds from the preset, not from our car's nodes (cache key gains the vehicle).

- [ ] **Step 1:** add bake JOBS with the `"car"` palette (the bake's green→`CAR_PAINT` remap is what makes `CarPaint.repaint` work). Scales: pick so the body's length is 3.8 m (hatch), 4.3 (4x4), 4.4 (rwd), 6.0 (truck), 3.6 (tractor). Kenney's paint material may not be named as on the hatchback: inspect each glb's material names (`print` them in a throwaway run) and map its paint material to `CAR_PAINT`. Run `godot --headless --path games/blind-rally/godot --script res://tools/bake_assets.gd -- car_body_4x4 car_wheel_4x4 …`. Expected: the eight `.res` files exist.
- [ ] **Step 2: Write failing tests:** for each id, `apply_preset(id)` then `CarPaint.apply(car, Color("#56b4e9"), 2, "square")`: the body has vertices within `HUE_TOLERANCE` of the team hue (paint landed), the collision box equals `model.box`, the car drives 3 s forward without falling through (y within 1 m of start), and `reset_to(spawn)` then 2 s of throttle moves it > 10 m (Review Focus: recovery with a different box). `CarPaint.ghost_mesh(id, …)` returns a mesh with an AABB within 10% of `model.box`.
- [ ] **Step 3:** implement `dress`, the preset model data, and `ghost_mesh(vehicle, …)`. Update `ghosts.gd`'s one caller to pass `"hatch"` for now (Task 6 wires it). If a model's paint can't be isolated cleanly, set its body to the team colour and keep the roof plate. Note it in the commit.
- [ ] **Step 4:** Godot suite passes. Then look at it: run the probe (`godot --path games/blind-rally/godot`), press V through all five in chase and bonnet cameras, and take a screenshot of each to `/tmp/claude-1000/.../scratchpad/` for the reviewer (wheels on the ground, plate on the roof, bonnet camera not inside the cab).
- [ ] **Step 5: Commit** `Rally: five car models, painted in team colours` (includes the baked `.res` and LICENSES rows; never the glb import cache).

### Task 6: Ghosts in the right car

**Files:**
- Modify: `godot/scripts/ghosts.gd`, `godot/scripts/web_bridge.gd` (if it filters ghost keys)
- Test: `godot/tests/rally_tests.gd` (`test_ghost_feed` neighbourhood)

**Interfaces:**
- Consumes: `CarPaint.ghost_mesh(vehicle, color, shape)`, `Vehicles.valid`.
- Produces: a ghost re-meshes when its `vehicle` or `color` changes (a rematch can change both).

- [ ] **Step 1: Write failing tests:** feed `{teamId:3, color:"#009e73", vehicle:"tractor", tick, position, heading, speed}` → the ghost's body mesh AABB matches the tractor's. Feed the same team again with `vehicle:"truck"` → re-meshed. Review Focus 5: a ghost with no `vehicle` and one with `"bus"` → hatch mesh, no error.
- [ ] **Step 2:** run, expect FAIL.
- [ ] **Step 3:** implement. The number label's transform comes from the preset's `roundel`.
- [ ] **Step 4:** Godot suite passes.
- [ ] **Step 5: Commit** `Rally: a rival's ghost is the car they chose`.

### Task 7: Engine sound per class, and the close-times check

**Files:**
- Modify: `godot/scripts/car_audio.gd`, `godot/scripts/vehicles.gd` (`audio`, final tuning numbers)
- Test: `godot/tests/vehicle_tests.gd`

**Interfaces:**
- Consumes: `car.vehicle`.
- Produces: preset `audio`: `{period: int, pitch: Vector2, harmonics: Array[float], grit: float}`. `period` replaces `_make_engine`'s `PERIOD` (400 = today), `pitch` replaces `lerpf(0.75, 2.6, _rpm)`'s ends, `harmonics` the five `sin` weights, `grit` the hiss level (0.06 today). `CarAudio.rebuild()` re-synthesises the engine loop when the vehicle changes after `start()`. Starting points: 4x4 `period 520, pitch (0.6, 2.0)`, rwd `360, (0.85, 2.9)`, truck `620, (0.55, 1.8), grit 0.1`, tractor `900, (0.5, 1.3)`, harmonics weighted to the 1st and 2nd so it chugs.

- [ ] **Step 1: Write failing tests:**
  - `test_audio_per_class`: after `apply_preset(id)` and `audio.start()`, the engine stream's length is `period × 24` samples. The hatch's equals today's (9600).
  - `test_close_times`: for each id, reset on Pine Panic's spawn and run the existing autopilot (`main.set_autopilot(true)`, as `test_autopilot_stage` does) to the finish, recording physics-frames ×  1/60 s. Assert 4x4, rwd and truck are within ±8% of hatch, tractor within +35%, and all finish. Cap each run at 2× hatch's time so a stuck car fails instead of hanging.
- [ ] **Step 2:** run, expect FAIL.
- [ ] **Step 3:** implement the audio params. Then tune the Task 4 numbers until `test_close_times` passes. Change grip/accel/top before touching anything else, and keep each class's character from the spec §2 table (the truck stays fastest on top speed, the tractor stays slowest). Record the final times in the commit body.
- [ ] **Step 4:** full Godot suite passes.
- [ ] **Step 5: Commit** `Rally: each car sounds like itself, and they finish close`.

### Task 8: The grid: choosing and voting, plus docs

**Files:**
- Create: `games/blind-rally/client/rally/vehicle-picker.ts`, `games/blind-rally/client/rally/vehicle-art.ts`
- Modify: `client/rally/grid.ts` (mount the picker above Start, show each car's class on its card), `client/rally/rally.css`, results view (class name comes free from `placingLabel`; check it renders)
- Modify docs: `rally-spec.md` (new §2.1 "Car classes"; strike the line in §7 if any), `docs/games/rally.md` (how to play: choosing a car), `blind-rally-map.md` ("Future: more cars": mark classes done for Rally)
- Test: `games/blind-rally/test/rally.test.ts` (picker view-model only)

**Interfaces:**
- Consumes: `VEHICLES`, `VEHICLE_IDS`, `PublicTeam.vehicle`, `BlindRallyPublicState.vehiclePick`/`.vehicleBallot`, actions `vehicle.pick`/`vehicle.vote` via `api.sendAction` (same call `trackPicker` in `client/stages.ts` uses).
- Produces: `vehicleCards(game: BlindRallyPublicState, me: string): { id: VehicleId; name: string; blurb: string; bars: VehicleInfo["bars"]; selected: boolean; votes: number; tied: boolean }[]` (pure, tested); `class VehiclePicker { el: HTMLElement; update(game, me, editable): void }`; `vehicleSvg(id: VehicleId): SVGElement` (side-on silhouettes in `currentColor`, 120×48 viewBox).

- [ ] **Step 1: Write failing tests** for `vehicleCards`: free mode, me in Car 2 with `rwd` → only `rwd` `selected`. Ballot with 2 votes on `truck` and mine on `truck` → `truck.votes === 2`, `selected` true. Tied → `tied` true on both leaders.
- [ ] **Step 2:** run, expect FAIL.
- [ ] **Step 3: Implement.** Cards are `<button aria-pressed>` in a radio-group-like row, arrow keys move focus, Enter/Space picks. On phones the row scrolls sideways with snap. On laptops all five fit in one row at 1280 wide. Bars are five ticks with a text label for screen readers ("Speed 4 of 5"). In ballot mode each card shows "N votes" and the leader gets the "Winning" tag (plus "coin toss" when tied, matching `coinFlipped`). Watchers and the post-start grid see the cards read-only. Each car card in the grid shows its class name under the player.
- [ ] **Step 4:** tests and typecheck pass. Then run the app (`pnpm dev` with `VITE_BLIND_RALLY=1` and `BLIND_RALLY=1`, the `run` skill) and check the grid at 1280×720, 1920×1080 and a 390×844 phone, in both modes, with two browser profiles: pick, vote, tie, start, and see the right ghost model in the other window. Screenshots to the scratchpad for the reviewer.
- [ ] **Step 5: Commit** `Rally: choose your car on the grid` (code + docs).

---

## Execution notes

- Tasks 1→2→3 are sequential (each extends the previous one's types). 4 can run after 1. 5→6→7 need the Prerequisite. 8 needs 3.
- The real-device check (two phones and a laptop, mixed classes, one shared-stage race) is the user's, after Task 8.
