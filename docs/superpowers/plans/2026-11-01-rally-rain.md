# Rally v3 phase 2: rain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Rain setting in both games (Dry, Rain, Rain starts, Rain stops, Random). Rain makes the road wet and slippery, leaves puddles, falls on screen and sounds like rain. On Snowblind it falls as snow.

**Architecture:** The shared `SkyPlan` gains a `rain` ramp. Wetness is derived from it with a lag, and both TS and GDScript evaluate both against the same fixture. `SkyClock` (Godot) evaluates rain and wetness on the run clock. It feeds: `CarController` (wet grip and puddle drag, read at each physics tick), the shared weather include (`sky_wet`, puddle masks), a one-draw rain streak layer, and `CarAudio`. Blind Rally's Driver gets the public rain ramp and plays a rain loop through `packages/audio`.

**Tech Stack:** TypeScript (vitest); Godot 4.7.2 GDScript and shaders (Compatibility renderer, WebGL2 web export, phones).

**Spec:** `docs/superpowers/specs/2026-11-01-rally-weather-time-of-day-design.md`. Phase 2 = §2 `rain`, §3 rain/wetness, §4.4–4.6, §4.7, §5 rain items.

## Global Constraints

- **Repo and commits:** repo root `/home/chakradharreddy/Repos/personal_projects/games`; package `games/blind-rally`. Commit straight to master, with detailed mechanism-first bodies. Stage only your own files. The untracked root `*.md`, `kenney_car-kit.zip` and the deleted `ui_theme.md` aren't yours.
- **Commands, from the repo root:**
  - `pnpm vitest run games/blind-rally`
  - `pnpm typecheck`
  - `godot --headless --path games/blind-rally/godot --fixed-fps 60 --script res://tests/run_tests.gd`. Its runner now fails on any SCRIPT ERROR or SHADER ERROR. Still check that the exit code is 0.
- **Re-export:** if Godot changed in a task, run `node games/blind-rally/scripts/export-godot.mjs` and commit `games/blind-rally/client/navigator/godot-build.json` with that task.
- **On-site copy:** short plain sentences, basic words, no idioms (simple Indian English).
- **The Rain setting:**
  - key `rain`; values `dry | rain | storm | clears | random`
  - labels Dry · Rain · Rain starts · Rain stops · Random; default `dry`
  - hints: Dry "The road is dry." · Rain "The road is wet. Cars slide more." · Rain starts "Rain starts while you drive." · Rain stops "The rain stops and the road dries." · Random "A surprise. Everyone gets the same one."
- **Random:** `stableHash(`${seed}:rain`)` picks dry 40%, rain 20%, storm 20%, clears 20%.
- **Rain ramp timing:**
  - storm: rain 0 → 1, `atMs` = seeded 30–50% of `runMs` (`stableHash(`${seed}:rainAt`)`), `overMs = 30000`
  - clears: rain 1 → 0, same seeded `atMs`, `overMs = 20000`
  - rain: 1 → 1
  - dry: 0 → 0
- **Wetness lag:**
  - Rising rain: wetness ramps from → to, starting at `atMs`, over `overMs + 20000`.
  - Falling rain: it ramps from → to, starting at `atMs`, over `overMs + 40000`.
  - Static rain: wetness equals rain.
- **Wet grip:** linear in wetness. At wetness 1:

  | Surface | grip | loose |
  | --- | --- | --- |
  | `road` | ×0.80 | ×1.15 |
  | `offroad` | ×0.75 | ×1.15 |
  | `sand` | ×0.75 | ×1.15 |
  | `snow` | ×0.90 | ×1.05 |
  | `tarmac` | ×0.95 | ×1.10 |
  | `ice` | ×1.00 | ×1.00 |

- **Puddles:** about one per 120 m of road, only on `road` and `tarmac`, seeded by the room seed. Drag applies only when wetness > 0.3. `PUDDLE_DRAG` is tuned so a straight-line pass costs about 0.2 s.
- **Snow biome (Snowblind):**
  - Rain falls as snow: `rain` adds to snowfall. No streaks, no puddles.
  - Wet grip uses the `snow` row for every surface except `ice` (×1).
  - Words say "Snow" instead of "Rain".
- **Stutter rules:**
  - Every new runtime material (rain streaks, splash) goes into the warm-up via `main.warm_up()` sources.
  - Anything that follows the car per frame reads `get_global_transform_interpolated()`.
  - No `Light3D` nodes.
  - Nothing toggles shader variants mid-race. Uniforms only.
  - Push uniforms only when values move.
- **Map:** the static map never changes. Every new shader term sits inside the `weather_seen()` gate.
- **Godot sky class:** it is `SkyClock` (`scripts/sky.gd`), not `Sky`.
- **Ports and cleanup:** the user's dev servers own ports 5173/8787, so use other ports. Leave no servers, bots or browser pages running.

## Review Focus

1. **Reload mid-storm.** A fresh Godot must land on the right rain and wetness straight away, with the same grip as everyone else at that run moment. Test in Task 3: set the clock past `atMs` and check that `wetness()` and the car's `wet` are right that frame.
2. **Wetness after the rain stops.** In Rain stops, the road stays wet (grip low) for 40 s after the rain ends, not dry at once. Test in Task 1 (fixture) and Task 3 (grip at the dry-out midpoint).
3. **Puddles are the same for everyone.** Same seed and stage give identical puddles. They are never off the road, and never on Snowblind. Test in Task 4.
4. **Dry is exactly today.** With `rain: dry`, grip, look and sound are bit-for-bit what they were. Test in Task 3 (grip rows unchanged at wetness 0) and Task 4 (`sky_wet` stays 0, no puddle drag).
5. **The Driver hears it only when it rains.** Blind Rally's Driver rain loop is silent on a dry run. It follows the ramp, stops at the finish, and respects the mute setting. Test in Task 6.

---

### Task 1: The rain plan, shared

**Files:**
- Modify: `games/blind-rally/shared/sky.ts`
- Modify: `games/blind-rally/server/projection.ts`, and every other `skyPlan(`/`skyWords(` caller (`grep -rn "skyPlan(\|skyWords(" games/blind-rally`)
- Modify: `games/blind-rally/godot/tests/sky_cases.json`
- Test: `games/blind-rally/test/sky.test.ts`

**Interfaces:**
- Produces (`shared/sky.ts`):
  - `type RainSetting = "dry" | "rain" | "storm" | "clears" | "random"`; `const RAINS: readonly RainSetting[]` (in that order)
  - `RAIN_LABELS: Record<RainSetting, string>`; `rainHint(rain: RainSetting): string`
  - `SkyPlan` gains `rain: { from: number; to: number; atMs: number; overMs: number }`
  - `skyPlan(time: TimeSetting, rain: RainSetting, seed: number, track: TrackLen): SkyPlan`. This is a breaking change; update its callers. The server passes `settings.rain`. Until Task 2 adds the setting, pass `"dry"`.
  - `rainAt(plan: SkyPlan, ms: number): number`, and `wetnessAt(plan: SkyPlan, ms: number): number`. Both are 0..1, with the lag rules from Global Constraints.
  - `skyWords(plan: SkyPlan, trackId: string): string`. Phrases:
    - static rain: "Rain."
    - storm: "Rain starts during the run."
    - clears: "Rain stops during the run."
    - dry: no rain phrase
  - The light words come first, then a space, then the rain phrase. Example: "Night. Rain starts during the run."
  - On `SNOW_TRACKS = ["snowblind"]`, the rain phrase says "Snow" in place of "Rain".
- Fixture: each case may also carry `"rain"` and `"wet"` expected values. The case's plan includes `rain`. Task 3's GDScript reads the same file.

- [ ] **Step 1: Write the failing tests.**
  - **Fixture cases.** A storm plan `{rain: {from: 0, to: 1, atMs: 40000, overMs: 30000}}`:

    | ms | rain | wet |
    | --- | --- | --- |
    | 0 | 0 | 0 |
    | 55000 | 0.5 | 0.3 |
    | 70000 | 1 | 0.6 |
    | 90000 | 1 | 1 |

    A clears plan `{from: 1, to: 0, atMs: 40000, overMs: 20000}`:

    | ms | rain | wet |
    | --- | --- | --- |
    | 50000 | 0.5 | 0.8333 |
    | 60000 | 0 | 0.6667 |
    | 100000 | 0 | 0 |

    A static rain plan at ms 0: rain 1, wet 1. Every fixture case passes `rainAt` and `wetnessAt` to 4 places.
  - `skyPlan(t, "storm", seed, {length: 2000, par_seconds: null})`:
    - `rain.from` is 0 and `rain.to` is 1
    - `overMs` is 30000
    - `atMs` is in [30000, 50000] (run 100000)
    - it is deterministic per seed
  - `"clears"` mirrors this, with `overMs` 20000.
  - `"random"` over seeds 0..399: the counts per option fall in dry 25–55%, the other three 10–30% each, and each option appears.
  - `skyWords` exact strings:
    - "Day." for dry day
    - "Night. Rain." for rain at night
    - "Day. Rain starts during the run." for a storm
    - "Day. Snow stops during the run." for clears on `snowblind`
  - The existing light-only expectations still hold, with dry.
- [ ] **Step 2: Run** `pnpm vitest run games/blind-rally`. Expect FAIL.
- [ ] **Step 3: Implement.** `stableHash(`${seed}:rainAt`) % 1000 / 1000` maps to 30–50% of `runMs`.
- [ ] **Step 4: Run** vitest and typecheck. Expect PASS.
- [ ] **Step 5: Commit** `Rally: the rain plan, shared`.

### Task 2: The Rain setting in both lobbies

**Files:**
- Modify: `shared/types.ts` (`BlindRallySettings.rain`; `DEFAULT_SETTINGS.rain = "dry"`)
- Modify: `shared/rules-text.ts` and `shared/rally.ts` (parse, setting fields, `RALLY_DEFAULTS`)
- Modify: `server/upgrade.ts`, `server/projection.ts` (pass `settings.rain` to `skyPlan` and the track id to `skyWords`)
- Modify: `docs/games/rally.md`, `docs/games/blind-rally.md`
- Test: `test/time-setting.test.ts` (or a sibling `rain-setting.test.ts`), `test/rally.test.ts`, `test/projection.test.ts`

**Interfaces:**
- Consumes: Task 1's `RainSetting`, `RAINS`, `RAIN_LABELS`, `rainHint`, and the new `skyPlan` and `skyWords` signatures.
- Produces: `settings.rain`, always valid after parse or upgrade.

- [ ] **Step 1: Write the failing tests.**
  - Parse in both games:
    - `{}` gives rain `"dry"`
    - `{rain: "storm"}` gives `"storm"`
    - `{rain: "hail"}` is null
  - The `rain` field sits right after `time` in both games. Its label is "Rain", and its option labels are exactly Dry, Rain, Rain starts, Rain stops, Random. All five hints match the exact strings in Global Constraints.
  - `rallySettingFields({}, 3)` keys end `..., "weather", "time", "rain"`.
  - An upgraded old state with no `rain` gets `"dry"`. A current state is upgraded to the same object.
  - Projection:
    - a storm room's `session.sky.rain` equals `skyPlan(...).rain`
    - `skyWords` includes "Rain starts during the run."
    - on Snowblind it says "Snow"
- [ ] **Step 2: Run** the tests and confirm they FAIL.
- [ ] **Step 3: Implement.** In the docs, add one Rain line in each game's Settings section.
- [ ] **Step 4: Run** vitest and typecheck, and confirm they PASS.
- [ ] **Step 5: Commit** `Rally: a Rain setting in both games`.

### Task 3: Godot evaluates rain and wetness; wet grip

**Files:**
- Modify: `godot/scripts/sky.gd`: parse `plan.rain`, `rain_at(ms)`, `wetness_at(ms)`, `rain()`, `wetness()`, and `signal rain_changed(rain: float, wet: float)`, emitted when either value moves more than 0.002 or lands at a ramp end
- Modify: `godot/scripts/car_controller.gd`: `var wet := 0.0`, `var snowy := false`, and `static func wet_grip(surface: String, wet: float, snowy: bool) -> Dictionary` returning `{grip, loose}` multipliers. `_physics_process` applies them to the surface row.
- Modify: `godot/scripts/main.gd`: connect `rain_changed` to set `car.wet`. Set `car.snowy = biome.weather == "snow"` on track setup.
- Test: `godot/tests/sky_tests.gd` (fixture rain and wet), `godot/tests/vehicle_tests.gd` or a new `rain_tests.gd` registered in `run_tests.gd`

**Interfaces:**
- Consumes: the session `sky.rain` (Task 1 shape) and `sky_cases.json` rain and wet values.
- Produces:
  - `SkyClock.rain() -> float`, `SkyClock.wetness() -> float`, `signal rain_changed(rain, wet)`
  - `CarController.wet`, `CarController.snowy`, `CarController.wet_grip(...)`
  - A missing or malformed `plan.rain` means dry (0 → 0).

- [ ] **Step 1: Write the failing tests.**
  - Every `sky_cases.json` case with `rain`/`wet` matches `rain_at`/`wetness_at` within 1e-4.
  - `wet_grip` gives exactly the Global Constraints values:
    - `wet_grip("road", 1, false)` = `{grip: 0.80, loose: 1.15}`
    - `("road", 0.5, false)` = `{0.90, 1.075}`
    - `("ice", 1, false)` = `{1, 1}`
    - `("road", 1, true)` = `{0.90, 1.05}`
    - `("ice", 1, true)` = `{1, 1}`
    - every surface at wet 0 = `{1, 1}`
  - **Reload mid-storm.** Set the storm plan from the Task 1 fixture, then `set_clock(70000, true)`. Within the same frame, `car.wet` ≈ 0.6.
  - **Rain stops.** At ms 60000 on the clears plan, `car.wet` ≈ 0.667, so the road is still wet with no rain.
  - **Grip effect.** On a straight piece of road, with the same input from rest and steering held, the lateral slip after 2 s is larger at wet 1 than at wet 0. Use the existing vehicle-test drive helpers.
  - **Dry is today.** `_surface_row` output times `wet_grip(...,0,...)` equals today's rows exactly.
- [ ] **Step 2: Run** the Godot suite. Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the suite. Expect it to pass with exit 0.
- [ ] **Step 5: Re-export, then commit** `Rally: wet roads grip less`.

### Task 4: Wet look and puddles

**Files:**
- Modify: `godot/shaders/weather.gdshaderinc`:
  - `uniform float sky_wet = 0.0;`
  - `const int PUDDLE_MAX = 24; uniform vec3 puddles[24]; uniform int puddle_count = 0;`
  - `float puddle_at(vec2 xz)`, returning 0..1 with a soft edge
- Modify: `godot/shaders/ground.gdshader` and `road.gdshader`. Wetness darkens albedo (×(1 − 0.35·wet), ground ×(1 − 0.25·wet)). The road's roughness drops toward 0.25 and specular rises. Puddle masks appear only on the road, scaled by `sky_wet`. Everything stays inside `weather_seen()`.
- Create: `godot/scripts/puddles.gd` (`class_name Puddles`). It holds `static func place(track: Track, seed: int, snowy: bool) -> PackedVector3Array`, with (x, z, radius) per puddle.
  - Walk `track.centerline`, one candidate every 120 m with a seeded ±30 m jitter.
  - Keep a candidate only where a downward ray on the surface-probe layer (physics layer 4) hits `surface` meta `road` or `tarmac`.
  - Radius is seeded 1.6–2.8 m. Cap at `PUDDLE_MAX`.
  - Return empty when `snowy`.
- Modify: `godot/scripts/weather.gd`: forward `sky_wet` and the puddle uniforms like the other `sky_*` values, including late registration.
- Modify: `godot/scripts/car_controller.gd`: `var puddles := PackedVector3Array()` and `const PUDDLE_DRAG`. When `wet > 0.3` and the car's xz is inside a puddle, add `PUDDLE_DRAG` (scaled by `(wet − 0.3) / 0.7`) to drag.
- Modify: `godot/scripts/car_fx.gd`: a splash burst from the existing puff system when the car enters a puddle above wet 0.3. Use the existing puff material. If it needs a new one, add it to `warm_sources()`.
- Modify: `godot/scripts/main.gd`: after a session, `puddles = Puddles.place(track, seed, snowy)`, then pass the result to weather and the car.
- Test: `godot/tests/rain_tests.gd`

**Interfaces:**
- Consumes: Task 3's `rain_changed` / `wetness()` and `car.wet`.
- Produces: `Puddles.place(...)`, `CarController.puddles`, and `CarController.in_puddle() -> bool`.

- [ ] **Step 1: Write the failing tests.**
  - `Puddles.place` with the same track and seed gives identical arrays. A different seed gives a different array.
  - On Pine Panic the count is between `floor(length / 120) − 4` and `PUDDLE_MAX`. Every puddle's centre is on `road` or `tarmac` (re-probe it).
  - On Snowblind the result is empty.
  - At wet 1, `sky_wet` reads 1 on the registered ground and road materials. At dry it stays 0, and no `sky_wet` or `puddles` push happens per frame on a static sky.
  - **Puddle drag.** At wet 1, a car driven straight through a puddle at 20 m/s loses more speed than the same pass at wet 0. At wet 0.2 there is no extra loss.
  - The map camera's cull mask still lacks layer 4. The `puddles` uniform is set only on registered weather materials.
  - **Warm-up.** No new material first appears after GO. Extend the existing warm-up coverage check.
- [ ] **Step 2: Run** the tests. Expect FAIL.
- [ ] **Step 3: Implement.** Tune `PUDDLE_DRAG` so a straight 20 m/s pass through one puddle at wet 1 costs 0.15–0.25 s against dry. Assert that range in the test.
- [ ] **Step 4: Run** the suite. Expect it to pass with exit 0.
- [ ] **Step 5: Re-export, then commit** `Rally: the road gets wet, and the puddles slow you`.

### Task 5: Rain you see; snow on Snowblind

**Files:**
- Create: `godot/shaders/rain.gdshader`. Build it like `snowfall.gdshader`: unshaded, one MultiMesh draw, positions wrapped in a box round the camera in the shader, thin streaks slanted by the weather wind. Take `sky_tint` and `sky_haze`, so rain dims at night.
- Modify: `godot/scripts/weather.gd`:
  - `_build_rain()`, a MultiMeshInstance3D on render layer 4 with `MAX_DROPS := 3000`
  - `visible_instance_count = round(rain · MAX_DROPS)`, set only when rain moves
  - Hidden while the camera is inside a tunnel bore. Use `TunnelRoof.distance_to_bore(cam_pos) < reach.y`, checked per frame only while rain > 0.
  - Snow style: rain adds to the snowfall instead, `snowfall = clamp(base + rain · 0.6, 0, 1)`, with no streaks.
  - `warm_sources()` includes the rain MMI.
- Modify: `godot/scripts/main.gd`: connect `rain_changed` to `weather.set_rain(rain)`.
- Test: `godot/tests/rain_tests.gd`

**Interfaces:**
- Consumes: Task 3's `rain_changed`.
- Produces: `Weather.set_rain(r: float) -> void` and `Weather.rain_visible() -> int`, the visible drop count (for tests).

- [ ] **Step 1: Write the failing tests.**
  - On a non-snow stage at rain 1, `rain_visible() == 3000`. At rain 0.5 it is 1500. At rain 0 it is 0 and the node is hidden.
  - On Snowblind at rain 1, `rain_visible() == 0`, and `snowfall` rises from its base by 0.6, clamped to 1.
  - The rain layer is layer 4, so the map camera never draws it.
  - **Warm-up.** The rain MMI is in `warm_sources()`, and it is drawn during the load warm-up.
  - **Tunnel.** On Cliffhanger, with the camera placed inside the bore at rain 1, the rain node is hidden. Outside the bore it is visible.
- [ ] **Step 2: Run** the tests. Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the suite. Expect it to pass with exit 0.
- [ ] **Step 5: Re-export, then commit** `Rally: rain falls (snow on Snowblind)`.

### Task 6: Rain you hear (car and Blind Rally Driver)

**Files:**
- Modify: `godot/scripts/car_audio.gd`:
  - In `prepare()`, build a rain loop: `_make_noise(...)` band-limited, about 2 s, loop-seamless.
  - Build a wet tyre hiss: a high band noise.
  - The rain loop's volume follows `rain`.
  - The hiss's volume is wet × speed share. It is silent below 3 m/s.
  - Nothing is built at the first gesture.
- Modify: `godot/scripts/main.gd`: connect `rain_changed` to `audio.set_rain(rain, wet)`.
- Modify: `shared/types.ts`, `server/projection.ts`: public `BlindRallyPublicState.skyRain: SkyPlan["rain"]`. It is the same ramp the words already announce, and the leak regex `/seed|cloud|weather/i` must still pass.
- Modify: `packages/audio/src/index.ts`: `ambient(level: number): void`.
  - It starts a looping filtered-noise source lazily on the unlocked context and ramps gain to `level × the user's volume` over 0.5 s.
  - Level 0 ramps to silence and stops the source.
  - It respects the sound-off setting.
- Modify: `games/blind-rally/client/driver/driver.ts`: in `tick()`, call `audio.ambient(rainAt({light: …, rain: game.skyRain}, runClock(game, team, now).ms))` while the team runs, and `audio.ambient(0)` otherwise.
- Test: `test/driver-rain.test.ts`, with the rain-level computation extracted as a pure function `driverRainLevel(game, team, now): number` in `client/driver/`. Also `godot/tests/rain_tests.gd`.

**Interfaces:**
- Consumes: Task 1's `rainAt` and `client/role.ts`'s `runClock`.
- Produces:
  - `CarAudio.set_rain(rain: float, wet: float)`
  - `audio.ambient(level)`
  - `driverRainLevel(...)`

- [ ] **Step 1: Write the failing tests.**
  - `driverRainLevel`:
    - 0 on a dry plan
    - 1 for static rain while running
    - 0.5 at the storm midpoint
    - 0 before GO, after the team finishes, and while paused
  - The public state has `skyRain`, and the leak test still passes.
  - **Godot.** After `prepare()` and before any gesture, the rain loop and hiss streams exist. At `set_rain(1, 1)` the rain player's target volume is above its value at `set_rain(0, 0)`, which is silent. The hiss is silent at speed 0.
- [ ] **Step 2: Run** both suites. Expect FAIL.
- [ ] **Step 3: Implement.** `ambient` in `packages/audio` is not unit-testable without WebAudio. Keep it small and route the logic through `driverRainLevel`.
- [ ] **Step 4: Run** vitest, typecheck and the Godot suite. Expect PASS.
- [ ] **Step 5: Re-export, then commit** `Rally: you can hear the rain (and so can the Driver)`.

### Task 7: Lap times, looks, performance

**Files:**
- No product code unless a check fails.
- Output goes to `/tmp/claude-1000/-home-chakradharreddy-Repos-personal-projects-games/6ee89904-1f62-4d11-b7f1-3cba2e7b751d/scratchpad/v3-phase2/`.
- Reuse the phase-1 probe at `…/scratchpad/v3-phase1/perf-probe.diff` and the bots at `…/scratchpad/recovered/bot.mjs`. Apply them but never commit them, and revert them afterwards.

- [ ] **Step 1: Lap-time check.**
  - Autopilot on all four stages, dry against full rain (static `rain`), for every class.
  - Expected: wet is slower by roughly 3–8%, nobody resets more than when dry, and the tractor and 4x4 lose the least.
  - If a class falls outside that range, tune the `wet_grip` table, keep the same shape across surfaces, update the test values, and commit `Rally: wet grip tuned on lap times` with the before/after table.
- [ ] **Step 2: Screenshots.**
  - Each stage in rain, day and night, in chase, bonnet and top-down.
  - Snowblind in "rain" (heavier snow).
  - Cliffhanger inside the tunnel in rain.
  - Write a `looks.md` with what reads well and what doesn't. Leave taste tuning to the user.
- [ ] **Step 3: Performance.**
  - 8 cars at night with "Rain starts", on Pine Panic and Snowblind, fresh load each run.
  - Targets:
    - worst frame in the first 2 s after GO ≤ 33 ms
    - no shader links after GO, including when the rain begins
    - mean frame time within 10% of day and dry
  - Write the results to `perf.md`.
- [ ] **Step 4: Fix and clean up.**
  - If a check fails, fix it with a test, re-export and commit.
  - Revert the probe, restore the committed build, and stop servers and bots.
