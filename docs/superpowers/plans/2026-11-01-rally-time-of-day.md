# Rally v3 phase 1: time of day Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Time setting in both games (Day, Dawn, Dusk, Night, Day into night, Random). Godot draws it with shader darkness, headlight cones and glowing landmarks, on each car's own run clock.

**Architecture:** `shared/sky.ts` turns settings + room seed + track into a `SkyPlan`. The server sends it in the Navigator session and says it in words in public state. The host sends the car's run clock to Godot as a `clock` race event. A new `sky.gd` evaluates the plan on that clock and pushes `sky_*` uniforms through `Weather.register`, the path the cloud shade uses already. All darkness and light live in shader terms gated by `weather_seen()`, so the static map never changes.

**Tech Stack:** TypeScript (vitest), Godot 4.7.2 GDScript and shaders (Compatibility renderer, web export).

**Spec:** `docs/superpowers/specs/2026-11-01-rally-weather-time-of-day-design.md` (phase 1 = §2 `time`, §3 minus rain/wetness, §4.1–4.3, §4.7, §5 minus rain items).

## Global Constraints

- Repo root `/home/chakradharreddy/Repos/personal_projects/games`; package `games/blind-rally`. Commit straight to master, detailed mechanism-first commit bodies. Stage only your own files: the untracked root `*.md`, `kenney_car-kit.zip` and the deleted `ui_theme.md` aren't yours.
- Commands from the repo root: `pnpm vitest run games/blind-rally`, `pnpm typecheck`, and `godot --headless --path games/blind-rally/godot --fixed-fps 60 --script res://tests/run_tests.gd`. The Godot runner prints "0 failed" even when a test dies: grep its output for `SCRIPT ERROR`. Any hit is a failure.
- Godot changed in a task → before committing run `node games/blind-rally/scripts/export-godot.mjs` and commit `games/blind-rally/client/navigator/godot-build.json` with it.
- On-site copy: short plain sentences, basic words, no idioms (simple Indian English).
- Values from the spec, verbatim: setting key `time`, values `day | dawn | dusk | night | sunset | random`, labels Day · Dawn · Dusk · Night · Day into night · Random, default `day`. `runMs = par_seconds*1000` else `length / 20 * 1000`. sunset: day → night, `atMs = 0.25·runMs`, `overMs = 0.5·runMs`. Random: `stableHash(`${seed}:time`)` (from `@games/game-core`) uniform over the five real options. darkness: day 0, dawn and dusk 0.35, night 1. `NIGHT_FLOOR` 0.12. Headlight about 60 m. Ghost cones skipped past 80 m. Max 7 ghost heads.
- The existing `weather` setting keeps its key and values. Only its label changes, to **Mist**.
- Stutter rules: every new runtime material goes into the warm-up (`warmup.gd` sources via `main.warm_up()`). Anything that follows the car per frame reads `get_global_transform_interpolated()`. No `Light3D` nodes added.
- The user's dev servers own ports 5173/8787. Use other ports, and leave no background processes, servers, bots or browser pages behind.

## Review Focus

1. **Grid and countdown:** the sky clock must read 0 until GO, even though the Rally grid lets nothing move. The host sends `running: false` until `startsAt` has passed. Test in Task 3 (host clock maths, before start) and Task 4 (clock holds at 0 with no `clock` event).
2. **Reset hold:** the existing `freeze` event also fires during a reset's hold, but the sky must not stop then. The `clock` event's `running` ignores the hold. Test in Task 3.
3. **Reload mid-race at night, or mid-sunset:** a fresh Godot must land on the right light straight away, not at day. Test in Task 4 (an init then a `clock` event with ms ≫ 0 gives `light_at` k > 0 at once, no ramp).
4. **The map at night:** the map camera never sees darkness. The map render happens at load and every new term is gated by `weather_seen()`. Test in Task 5 (the map camera's cull mask lacks layer 4; Sky changes no node the map render reads, so the Sun's colour and energy stay as the scene set them).
5. **Unlit things at night:** the treeline, far landmarks, mist sprites and snowfall are unshaded and would glow bright on a black stage. They take `sky_tint` too. Test in Task 5 (each of those materials has `sky_tint` set to the night value after night is applied).

---

### Task 1: The sky plan, shared

**Files:**
- Create: `games/blind-rally/shared/sky.ts`
- Create: `games/blind-rally/godot/tests/sky_cases.json` (one table for both languages, read by Task 4 too)
- Create: `games/blind-rally/test/sky.test.ts`
- Modify: `games/blind-rally/shared/index.ts` (export the new names)

**Interfaces:**
- Produces (`shared/sky.ts`):
  - `type TimeSetting = "day" | "dawn" | "dusk" | "night" | "sunset" | "random"`
  - `const TIMES: readonly TimeSetting[]` (that order)
  - `type Light = "day" | "dawn" | "dusk" | "night"`
  - `interface SkyPlan { light: { from: Light; to: Light; atMs: number; overMs: number } }` (phase 2 adds `rain`)
  - `runMsOf(track: { length: number; par_seconds: number | null }): number`
  - `skyPlan(time: TimeSetting, seed: number, track: { length: number; par_seconds: number | null }): SkyPlan`
  - `lightAt(plan: SkyPlan, ms: number): { from: Light; to: Light; k: number }`, where k = clamp((ms − atMs) / overMs, 0, 1), and 1 when overMs is 0
  - `skyWords(plan: SkyPlan): string`

- [ ] **Step 1: Write `sky_cases.json`:** `{ "cases": [ { "plan": SkyPlan, "ms": number, "k": number } ] }`. Cover at least: a static night plan at ms 0 (k 1); a sunset plan with `atMs` 28000, `overMs` 56000 at ms 0 (k 0), 28000 (k 0), 56000 (k 0.5), 84000 (k 1) and 500000 (k 1).
- [ ] **Step 2: Write the failing tests** in `test/sky.test.ts`:
  - Every case in `sky_cases.json` gives `lightAt(plan, ms).k` ≈ `k` (`toBeCloseTo`, 6).
  - `runMsOf({length: 2259, par_seconds: null})` is `112950`, and `runMsOf({length: 2259, par_seconds: 90})` is `90000`.
  - `skyPlan("night", s, t)` is `{light: {from: "night", to: "night", atMs: 0, overMs: 0}}`. The same shape holds for day, dawn and dusk.
  - `skyPlan("sunset", s, {length: 2000, par_seconds: null})` is day → night with `atMs` 25000 and `overMs` 50000.
  - `skyPlan("random", seed, t)` is the same for the same seed, never has a `light` outside the four. Over seeds 0..199, every one of the five real options comes out at least once, with sunset recognised by `from != to`.
  - `skyWords` gives exactly: day "Day.", dawn "Dawn.", dusk "Dusk.", night "Night.", sunset "Day into night. The sun goes down while you drive."
- [ ] **Step 3: Run** `pnpm vitest run games/blind-rally/test/sky.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 4: Implement `shared/sky.ts`** to the interface above. Random hashes `${seed}:time` with `stableHash` modulo 5 over `["day","dawn","dusk","night","sunset"]`.
- [ ] **Step 5: Run** the test file again, then `pnpm typecheck`. Expected: PASS.
- [ ] **Step 6: Commit:** `Rally: the sky plan, shared`.

### Task 2: The Time setting in both lobbies

**Files:**
- Modify: `games/blind-rally/shared/types.ts` (`BlindRallySettings.time: TimeSetting`, `DEFAULT_SETTINGS.time = "day"`)
- Modify: `games/blind-rally/shared/rules-text.ts` (`parseSettings`, Blind Rally setting fields, `WEATHER` label → "Mist" in fields and preview)
- Modify: `games/blind-rally/shared/rally.ts` (`RALLY_DEFAULTS.time`, `parseRallySettings` reads `time` as a sixth free field, `rallySettingFields`, Mist label)
- Modify: `games/blind-rally/server/upgrade.ts` (a state whose settings lack a valid `time` gets `"day"`)
- Modify: `docs/games/rally.md`, `docs/games/blind-rally.md` (Settings sections: Time and Mist)
- Test: `games/blind-rally/test/rally.test.ts`, `test/assists.test.ts` or a settings test file, and wherever the upgrade is tested (`grep -rn upgrade games/blind-rally/test`)

**Interfaces:**
- Consumes: `TimeSetting`, `TIMES` (Task 1).
- Produces: `settings.time` is always a valid `TimeSetting` after parse or upgrade.

- [ ] **Step 1: Write the failing tests:**
  - `parseSettings({})!.time === "day"` and `parseSettings({time: "night"})!.time === "night"`. `parseSettings({time: "noon"})` is null. The same three checks hold for `parseRallySettings`.
  - `rallySettingFields({}, 3).map(f => f.key)` equals `["trackPick", "vehiclePick", "timeLimit", "camera", "weather", "time"]`. Update the existing expectation in `rally.test.ts:125`.
  - The `time` field's option labels are exactly `["Day", "Dawn", "Dusk", "Night", "Day into night", "Random"]`, its label is "Time", and the `weather` field's label is now "Mist". Both hold in both games.
  - Hints, exact strings: night "It's dark. Your lights show the road ahead." sunset "The sun goes down while you drive." random "A surprise. Everyone gets the same one." day, dawn and dusk "Everyone gets the same light."
  - An upgraded old state with no `time` has `settings.time === "day"`, and its other settings are unchanged.
- [ ] **Step 2: Run** `pnpm vitest run games/blind-rally`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** In Blind Rally the `time` field sits right after `weather`. Update the existing tests that list settings objects literally (e.g. `phases.test.ts:325`) to include `time`.
- [ ] **Step 4: Docs.** In each game doc's Settings section, add one line for Time and rename Weather to Mist. Use simple plain English.
- [ ] **Step 5: Run** vitest and `pnpm typecheck`. Expected: PASS.
- [ ] **Step 6: Commit:** `Rally: a Time setting in both games`.

### Task 3: Sky in the session, words in the lobby, the run clock to Godot

**Files:**
- Modify: `games/blind-rally/shared/types.ts` (`NavigatorSession.sky: SkyPlan`; `BlindRallyPublicState.skyWords: string`)
- Modify: `games/blind-rally/server/projection.ts` (session `sky: skyPlan(settings.time, state.seed, trackData(state.trackId))`, public `skyWords`)
- Modify: `games/blind-rally/shared/rules-text.ts` and `shared/rally.ts` (`TrackLine.sky?: string`. When it's set, the preview's Mist row is followed by a row `{label: "Light", value: track.sky}`.)
- Modify: `games/blind-rally/client/teams.ts:184`, `client/rally/grid.ts:148` (pass `sky: game.skyWords`)
- Modify: `games/blind-rally/client/role.ts` (new `runClock`) and `games/blind-rally/client/navigator/host.ts` (send the `clock` event)
- Test: `test/projection.test.ts`, `test/briefing.test.ts` or the rally preview tests, a new `test/clock.test.ts`

**Interfaces:**
- Consumes: `skyPlan`, `skyWords` (Task 1). `settings.time` (Task 2).
- Produces:
  - `runClock(game: BlindRallyPublicState, team: PublicTeam | undefined, now: number): { ms: number; running: boolean }` in `client/role.ts`. `ms = max(0, teamClock(game, team, now) − team.penaltyMs)`. `running = startsAt !== null && now >= startsAt && team.status === "running" && team.pausedSince === null && endedAt === null`, and it ignores any reset hold.
  - Race event to Godot: `{ kind: "clock", ms: number, running: boolean }`. The host sends it right after every session send, and from `tick()` whenever `running` flips. Godot's reply to it is Task 4.

- [ ] **Step 1: Write the failing tests:**
  - **Projection:** a Navigator's `session.sky` equals `skyPlan(time, seed, track)` for a night room and for a random room. `publicState(...).skyWords` equals `skyWords(that plan)`. The public-state leak test (`projection.test.ts:21`, `/seed|cloud|weather/i`) still passes. Don't widen it.
  - **Preview:** `rallyPreview({time: "night"}, {name: "Pine Panic", tie: false, sky: "Night."})` has a `Light` row "Night." right after the Mist row. Without `sky` there's no Light row. The same holds for `rulesPreview`.
  - **`runClock`:**
    - before `startsAt`: `{ms: 0, running: false}`
    - 30 s after start: `{ms: 30000, running: true}`
    - with `penaltyMs` 10000: still `ms` 30000
    - with `pausedMs` 5000: `ms` 25000
    - while `pausedSince` is set: `running` false
    - status `finished`: `running` false
    - a team with only a reset hold (no pause): `running` true
- [ ] **Step 2: Run** vitest. Expected: FAIL.
- [ ] **Step 3: Implement.** In `host.ts`, keep `private clockRunning: boolean | null`. Reset it to null in `sendSession()` next to `this.frozen = null`. In `tick()`, when the bridge is ready, the session is sent and `runClock(...).running !== clockRunning`, send the event and store the new value.
- [ ] **Step 4: Run** vitest and typecheck. Expected: PASS.
- [ ] **Step 5: Commit:** `Rally: the sky plan reaches the Navigator, and the run clock reaches Godot`.

### Task 4: `sky.gd`, the clock and the evaluator

**Files:**
- Create: `games/blind-rally/godot/scripts/sky.gd` (`class_name Sky extends Node`)
- Create: `games/blind-rally/godot/tests/sky_tests.gd` (registered in `tests/run_tests.gd` like the other suites)
- Modify: `games/blind-rally/godot/scripts/main.gd` (make a `Sky` child in `_setup_track`; `_on_session` reads `cfg.sky`; `_on_race_event` handles `"clock"`)
- Modify: `games/blind-rally/godot/scripts/weather.gd` (drop the `_physics_process` time advance; `time` comes from Sky)

**Interfaces:**
- Consumes: session `sky` (Task 3), shaped like `SkyPlan` (Task 1); event `{kind: "clock", ms, running}` (Task 3).
- Produces (`Sky`):
  - `var clock := 0.0` (seconds of run clock), `var running := false`
  - `func set_plan(plan: Dictionary) -> void`. A bad or missing plan means static day.
  - `func set_clock(ms: float, run: bool) -> void`
  - `func light_at(ms: float) -> Dictionary`, returning `{from: String, to: String, k: float}` with the same maths as the TS `lightAt`
  - `func darkness() -> float`, the darkness at `clock`: lerp of the spec values (day 0, dawn and dusk 0.35, night 1) from → to by k. Day into night passes 0.35 at k 0.5 because the curve goes day → dusk → night, two halves of k.
  - `signal changed`, emitted after each `_process` evaluation
  - `Weather.sky: Sky`. Weather's `time` getter returns `sky.clock` when sky is set, else its own counter (tests and local runs without a session).

- [ ] **Step 1: Write the failing tests** in `sky_tests.gd`:
  - Load `res://tests/sky_cases.json`. Every case gives `light_at(ms).k` within 1e-6.
  - A fresh Sky: `clock` is 0 and doesn't advance over 30 frames with no `clock` event.
  - After `set_clock(5000, true)`, `clock` is about 5.0 and grows with frames. After `set_clock(t, false)` it holds.
  - **Reload mid-sunset:** `set_plan(sunset 28000/56000)` then `set_clock(56000, true)`, and the same frame `darkness()` ≈ 0.35. No ramp.
  - `main.weather.time` equals `main.sky.clock` after a `clock` event.
  - A static night plan has `darkness()` 1. A missing plan has 0.
- [ ] **Step 2: Run** the Godot suite. Expected: the new tests FAIL. Grep for `SCRIPT ERROR`.
- [ ] **Step 3: Implement.** Advance `clock` in `_process(delta)` when `running` is set: render time, not physics ticks. That fixes clouds and snow stepping at 120 Hz+.
- [ ] **Step 4: Run** the suite. Expected: all pass, no `SCRIPT ERROR`.
- [ ] **Step 5:** Re-export, then **commit**: `Rally: one sky clock for the whole stage`.

### Task 5: Night in the shaders: darkness, tint, the floor

**Files:**
- Modify: `games/blind-rally/godot/shaders/weather.gdshaderinc` (new uniforms and `sky_light()`)
- Modify (apply it next to `cloud_shade_at`): `ground`, `road`, `palette`, `forest_far`, `sea`, `tunnel_roof`, `ghost` `.gdshader`
- Modify (unshaded, multiply `sky_tint` only): `treeline`, `far_landmark`, `mist`, `snowfall` `.gdshader`
- Modify: `games/blind-rally/godot/scripts/sky.gd` (palette table; pushes uniforms through Weather), `scripts/weather.gd` (forward `sky_*` to registered materials, incl. ones registered later), `scripts/eye_forest.gd` (register treeline and far_landmark materials), `scripts/main.gd` (perspective env: darken sky and fog colours by the tint; shadows off when darkness > 0.8, restored after)
- Test: `games/blind-rally/godot/tests/sky_tests.gd`

**Interfaces:**
- Consumes: `Sky.darkness()`, `Sky.changed`, `light_at` (Task 4).
- Produces (shader uniforms, in the include): `uniform float sky_dark = 0.0; uniform vec3 sky_tint : source_color = vec3(1.0); const float NIGHT_FLOOR = 0.12;` and `vec3 sky_light(vec3 world)`. In this task it returns `sky_tint * mix(1.0, NIGHT_FLOOR, sky_dark)`. Task 6 adds the headlight terms into the same function. Shaders multiply their colour by it inside the existing `weather_seen()` branch.
- Palette (`Sky.TINTS`, starting values to tune by eye): day `Color(1,1,1)`, dawn `Color(0.85,0.88,1.0)`, dusk `Color(1.0,0.82,0.68)`, night `Color(0.55,0.62,0.9)`. Tint and darkness both blend from → to by k.
- The car keyhole: the `palette` shader caps darkness at 0.35 within 4 m of `mist_car`, so the car never drops below dusk brightness.

- [ ] **Step 1: Write the failing tests:**
  - Night applied: every material registered with Weather, plus treeline, far_landmark, mist and snowfall, reads `sky_dark` 1.0 (shaded ones) and `sky_tint` = the night tint.
  - Day applied: `sky_dark` 0 and `sky_tint` white. Today's look is unchanged.
  - **Map safety:** the map camera's `cull_mask & 8 == 0`, and the Sun's colour and energy equal their scene values after night is applied.
  - Shadows: the Sun's shadows are off at night and back to their prior state at day. Phones keep shadows off.
  - A material registered after night is applied gets the night values (the late-register path).
- [ ] **Step 2: Run** the suite. Expected: FAIL.
- [ ] **Step 3: Implement.** Sky listens to its own evaluation each frame and pushes values only when they change by more than 0.002, so there's no per-frame `set_shader_parameter` on a static sky.
- [ ] **Step 4: Run** the suite. Expected: all pass, no `SCRIPT ERROR`.
- [ ] **Step 5:** Re-export, then **commit**: `Rally: night falls (in the shaders, not on the map)`.

### Task 6: Headlights, ghost lights, glowing landmarks

**Files:**
- Modify: `games/blind-rally/godot/shaders/weather.gdshaderinc` (headlight terms in `sky_light`)
- Modify: `games/blind-rally/godot/scripts/sky.gd` (pushes `head_pos`, `head_dir` and `head_on` from the car's interpolated transform each frame while `sky_dark > 0`)
- Modify: `games/blind-rally/godot/scripts/ghosts.gd` (fills `ghost_heads` from the positions it already interpolates)
- Modify: `games/blind-rally/godot/shaders/glow.gdshader` and whatever builds glow materials (`grep -rn glow.gdshader godot/scripts`): `uniform float night_boost = 0.0`, energy × (1 + 2·night_boost); Sky sets it to darkness
- Test: `games/blind-rally/godot/tests/sky_tests.gd`, `tests/warmup_tests.gd`

**Interfaces:**
- Consumes: Task 5's `sky_light(world)` and uniforms; `Ghosts` internals.
- Produces (uniforms):
  - `head_pos` vec3, `head_dir` vec2 (xz unit), `head_on` float = darkness
  - `ghost_heads[7]` vec4 (x, z, yaw, strength), `ghost_head_count` int
  - Own cone: 60 m long, half-angle about 22°, soft edges, brighter near the car, adding up to `(1 − floor)` back. Corner spread: 20 m, half-angle about 60°, half strength.
  - Ghost cone: 25 m, half-angle about 22°, 0.5 strength, skipped when the pixel is more than 80 m from that ghost.

- [ ] **Step 1: Write the failing tests:**
  - At night after a physics tick plus a render frame, `head_pos` on a registered material equals `car.get_global_transform_interpolated().origin` (within 1e-3), and `head_dir` matches its −Z basis in xz.
  - Day: `head_on` is 0.
  - With 3 ghosts relayed: `ghost_head_count` is 3, and entry 0's xz equals that ghost node's position. With 9 rivals it's capped at 7.
  - Glow materials have `night_boost` 1 at night and 0 at day.
  - Warm-up: no new material appears for the first time mid-race. Extend `warmup_tests.gd` so the source list still covers every material kind drawn after GO. If no new material was added, it asserts that.
- [ ] **Step 2: Run** the suite. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the suite. Expected: all pass, no `SCRIPT ERROR`.
- [ ] **Step 5:** Re-export, then **commit**: `Rally: headlights at night, and the landmarks light up`.

### Task 7: See it, measure it

**Files:**
- No product code unless a check fails. Measurements and screenshots go to the scratchpad `/tmp/claude-1000/-home-chakradharreddy-Repos-personal-projects-games/6ee89904-1f62-4d11-b7f1-3cba2e7b751d/scratchpad/v3-phase1/`.
- Tools: the stutter probe `…/scratchpad/stutter-instrumentation.diff` (apply, never commit, revert after) and the bots `…/scratchpad/bots/bot.mjs`.

- [ ] **Step 1: Screenshots** of all four stages at dawn, dusk, night and day into night (mid-change), in chase, bonnet and top-down, plus the map at night. Run a dev server on spare ports. Check by eye: the car is always visible, road edges are readable at night, the map looks as it does by day, and landmarks glow.
- [ ] **Step 2: Performance**, with the probe and bots on 8 cars at night, on Pine Panic and Snowblind, fresh load each time. The worst frame in the first 2 s after GO must be ≤ 33 ms, with no shader links after GO. The mean frame time over 20 s of autopilot must be within 10% of the same run at day. Report the numbers before and after.
- [ ] **Step 3:** If a check fails, fix it with a test where one is possible, re-export, and commit `Rally: <what>` with the numbers in the body. Then revert the probe and stop every server and bot.
