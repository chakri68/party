# Rally v3: time of day and rain

**Status:** design approved in chat 2026-11-01 · **Package:** `games/blind-rally` (Rally and Blind Rally) · **Parents:** `rally-spec.md`, `blind-rally-map.md` ("Future: rain and night stages"), v2 spec `2026-10-31-rally-vehicle-classes-design.md`

Stages get a time of day (day, dawn, dusk, night) and rain, and both can change during a run: the sun goes down, a storm rolls in, the rain clears. Night is about seeing less. Rain is about gripping less. Everyone in a room gets the same sky at the same moment of their own run.

Built in two phases, each its own plan and each shippable alone:

1. **Time of day:** settings, the sky plan, the shared sky clock, night lighting and headlights.
2. **Rain:** wetness, wet grip, puddles, rain streaks and sound.

## 1. Goals

- Night and dusk change how a stage reads without making it unfair or unplayable. You can lose the road, never your car.
- Rain changes how the car drives. You notice it in the first corner.
- A change during the run is fair: two cars at the same point of their run see the same sky, whoever started when, and a reloaded page lands on the right sky.
- The static map never changes. It's the Navigator's ground truth.
- No new mid-race hitches. Everything new is warmed up at load (the stutter work, 9d728f4).
- Cheap: no new real lights. Everything is in the shaders the stage already uses.

Out of scope: lightning and thunder, wind gusts that push the car, snow falling harder as a "rain" setting (see §4.6), per-player weather, weather on the static map, a day/night cycle that loops.

## 2. Lobby

Two new settings, in both games, next to the existing one:

| key | Label | Options (label → value) | Default |
| --- | --- | --- | --- |
| `time` | Time | Day `day` · Dawn `dawn` · Dusk `dusk` · Night `night` · Day into night `sunset` · Random `random` | `day` |
| `rain` | Rain | Dry `dry` · Rain `rain` · Rain starts `storm` · Rain stops `clears` · Random `random` | `dry` |

- The existing `weather` setting keeps its key and values but its label becomes **Mist**, since "Weather" now covers three things.
- Hints, in short plain sentences (site-copy rule): Night "It's dark. Your lights show the road ahead." Day into night "The sun goes down while you drive." Rain "The road is wet. Cars slide more." Rain starts "Rain starts while you drive." Rain stops "The rain stops and the road dries." Random "A surprise. Everyone gets the same one."
- Phase 1 adds `time` only. Phase 2 adds `rain`.
- Saved states without these keys upgrade to `day` / `dry` (`server/upgrade.ts`).
- The briefing card (Blind Rally) and the grid (Rally) say the resolved sky in words once the track is known, Random included: "Night. Rain starts halfway." The Driver in Blind Rally sees only this line. Their view has no 3D.

## 3. The sky plan (shared)

A pure function in a new `shared/sky.ts`. No state is stored. Server and client both compute it from the same three inputs, so it can't drift.

```ts
type Light = "day" | "dawn" | "dusk" | "night";
interface SkyPlan {
  light: { from: Light; to: Light; atMs: number; overMs: number };
  rain: { from: number; to: number; atMs: number; overMs: number }; // 0..1; phase 2
}
skyPlan(time: TimeSetting, rain: RainSetting, seed: number, track: { length: number; par_seconds: number | null }): SkyPlan
skyWords(plan: SkyPlan): string // "Night. Rain starts halfway."
wetnessAt(plan: SkyPlan, ms: number): number // phase 2
```

- **Run length:** `runMs = par_seconds * 1000` when a track has one, else `length / 20 * 1000` (20 m/s ≈ the hatch's measured 111.5 s over Pine Panic's 2259 m).
- **Random** (`stableHash` from `@games/game-core`; Godot never resolves a plan, it only evaluates the one in its session): `stableHash(`${seed}:time`)` picks uniformly from the five real time options. `stableHash(`${seed}:rain`)` picks dry 40%, rain 20%, storm 20%, clears 20%. Same seed, same pick, both sides.
- **Static settings:** `from == to`, `atMs = 0`, `overMs = 0`.
- **sunset:** day → night, `atMs = 0.25 · runMs`, `overMs = 0.5 · runMs`. The palette passes through dusk on the way.
- **storm:** rain 0 → 1, `atMs` = a seeded 30–50% of `runMs` (`stableHash(`${seed}:rainAt`)`), `overMs = 30000`.
- **clears:** rain 1 → 0, `atMs` = seeded 30–50% of `runMs`, `overMs = 20000`.
- **Wetness** lags the rain. It's derived, not stored. Rising rain: wetness ramps `from → to` starting at `atMs` over `overMs + 20000`. Falling rain: it ramps `from → to` starting at `atMs` over `overMs + 40000`. Static rain: wetness equals rain, so "Rain" starts on an already wet road.
- After `atMs + overMs` the plan holds at `to` for the rest of the run, however long it takes.

**Where it goes:** `NavigatorSession.sky: SkyPlan` (both games, beside `clouds`), and `BlindRallyPublicState.skyWords: string | null` for the briefing and grid. `skyWords` is null until the track is known.

**One table, two languages:** `games/blind-rally/godot/tests/sky_cases.json` lists plans and `(ms → light blend, rain, wetness)` triples. Vitest checks `shared/sky.ts` against it. The Godot suite checks `sky.gd`'s evaluator against the same file.

## 4. Godot

### 4.1 The sky clock

The sky runs on the car's **run clock**: the team clock without penalties, which is `raceElapsed − pausedMs − the current pause`. It's 0 on the grid and through the countdown.

- The host sends it as a race event `{kind: "clock", ms, running}` (`runClock` in `client/role.ts`: `teamClock` minus `penaltyMs`), right after every session send and whenever `running` flips. Not the existing `freeze`/`go`: those also fire during a reset's hold.
- The new `scripts/sky.gd` (`class_name Sky`) owns the clock. It jumps to each `clock` event's `ms` and advances in `_process` with render delta while `running`. A reset's hold doesn't stop it, because the team clock doesn't stop for a reset either.
- `Weather.time` reads `Sky.clock` instead of counting physics ticks. This fixes clouds and snow stepping at 120 Hz+ and mist restarting on reload, both at once.
- Physics reads the same clock at each tick (for wet grip). A render-rate clock read at 60 Hz ticks is fine: grip moves over tens of seconds.

### 4.2 What Sky produces

Every frame, Sky evaluates the plan at the clock:

- **light:** a `sky_tint` colour and the eye-level background and fog colours. The Sun and Environment nodes keep their scene values (the static map renders with them), so all darkening and tinting happens in shader terms gated by `weather_seen()`. The unshaded treeline, far landmarks, mist and snowfall take `sky_tint` too. Day changes nothing: today's look is the `day` row.
- **`darkness`** 0..1: day 0, dawn and dusk about 0.35, night 1 (tuned in play).
- **`rain`** and **`wetness`** 0..1 (phase 2).

Shader-side values go to every registered material through `Weather.register` and `weather.gdshaderinc`, the same path the cloud shade uses today. Tints per `Light` sit in one table in `sky.gd`: warm at dusk, cool at dawn, a faint blue moon at night. The Sun's shadows switch off at night (darkness > 0.8).

### 4.3 Night in the shaders (phase 1)

All new terms live in `weather.gdshaderinc` and are skipped when the camera can't see render layer 4, like the mist. The map stays clean for free.

- **Darkness:** a multiply on albedo, like the cloud shade, with a floor (`NIGHT_FLOOR`, about 0.12 of day brightness) so road edges stay faintly readable.
- **Headlights:** a soft cone from the car's **interpolated** transform (`get_global_transform_interpolated()`, per the stutter fix). About 60 m long, brighter near the car, soft edges, lighting ground, road, trees and props. Plus a wider, shorter spread that shows corners. Uniforms: `head_pos`, `head_dir`, `head_on` (0..1, scaled by darkness so lights fade in at dusk).
- **Keyhole:** the car itself always gets at least dusk brightness, so it never vanishes into the dark.
- **Ghost headlights:** `ghost_heads[7]` (vec4: xz, heading, strength), filled by `ghosts.gd` from the positions it already interpolates. A cheaper short cone each, skipped past 80 m from the pixel, so rivals show as moving pools of light.
- **Landmarks** glow with darkness through `glow.gdshader`: fire-tower beacon, cabin windows, start and finish arches, campfire. They stay useful to call out at night.
- **Top-down camera:** the same cones, seen from above. **Bonnet:** the same, from inside.

### 4.4 Wet roads (phase 2)

- **Look:** wetness darkens ground and road albedo, raises the road's shine (specular and roughness down), and fades in puddle masks.
- **Puddles:** seeded spots along the road centreline (room seed, about one per 120 m, only on `road` and `tarmac` surfaces), so every car meets the same puddles. Built at load into a small uniform array for the road shader and a list for the car. Driving through one when wetness > 0.3 adds drag (`PUDDLE_DRAG`, tuned so a straight-line pass costs about 0.2 s) and a splash in `car_fx`.
- **Grip:** `CarController` multiplies each surface row by `wet_grip(surface, wetness)`. These sit on top of every class's own surface numbers:

  | Surface | Grip at wetness 1 | `loose` at wetness 1 |
  | --- | --- | --- |
  | `road` (gravel) | ×0.80 | ×1.15 |
  | `offroad`, `sand` | ×0.75 | ×1.15 |
  | `snow` | ×0.90 | ×1.05 |
  | `tarmac` | ×0.95 | ×1.10 |
  | `ice` | ×1.00 | ×1.00 |

  It's linear in wetness. Starting points, tuned by the lap-time check (§5).

### 4.5 Rain you see and hear (phase 2)

- **Streaks:** `shaders/rain.gdshader`, one MultiMesh draw in a box round the camera, moved in the shader like `snowfall.gdshader`. Visible instances scale with `rain`. They slant with the weather wind. They hide while the camera is under a tunnel roof (`tunnel_roof.gd` knows its spans).
- **Sound:** a synthesised rain loop and a wet tyre hiss in `car_audio.gd`, built in `prepare()` at load and never at the first gesture. In Blind Rally the Driver's dashboard plays the rain loop too, through `packages/audio`, so the Driver hears the weather they can't see.

### 4.6 Biomes

- **Forest, desert, coast:** as above. Desert rain is allowed. It's a game.
- **Snow (Snowblind):** rain falls as snow. `rain` adds to today's snowfall amount instead of drawing streaks, wetness uses the `snow` and `ice` grip rows, and there are no puddles. The setting's hint stays the same, and `skyWords` says "snow" instead of "rain" on this track.

### 4.7 Hard rules (from the stutter work)

- Every new material (rain streaks, any new glow, splash) is added to `warmup.gd` and covered by its test.
- Anything that follows the car per frame reads the interpolated transform.
- No `Light3D` nodes added: no `OmniLight3D` or `SpotLight3D` headlights. The Compatibility renderer pays per light per object.

## 5. Testing and performance

- **TS (vitest):** `skyPlan` for every setting × a few seeds; Random's picks are deterministic per seed and every option is reachable; timings land in the stated fractions; `sky_cases.json` passes; settings parse, defaults and old-state upgrade; `session.sky` and `skyWords` in the projection (and no leak of other teams' runs); the host's `runClock` maths with a pause, a penalty and a reset hold.
- **Godot:** `sky.gd`'s evaluator passes `sky_cases.json`; the clock holds at 0 before any `clock` event and follows each one (jump, run, stop); `Weather.time` follows `Sky.clock`; `wet_grip` returns the table's values; puddles are identical for the same seed; warm-up covers every new material; the map camera's cull mask still excludes layer 4. Grep the runner's output for `SCRIPT ERROR` every time.
- **Lap-time check (phase 2):** autopilot on all four stages, dry against full rain, every class. Wet is slower by roughly 3–8% and nobody resets more than dry. Tractor and 4x4 lose the least.
- **Looks (human check):** browser screenshots of each stage at dawn, dusk, night and in rain, in chase, bonnet and top-down, saved to the scratchpad for review. Headless Godot can't render, so this is how we see it.
- **Performance:** the stutter probe plus bots, 8 cars on Pine Panic and Snowblind, at night with "Rain starts". Worst frame in the first 2 s after GO ≤ 33 ms, no shader links after GO (including when the rain begins), and mean frame time within 10% of day and dry on the laptop.

## 6. Risks

- **Phones and fill rate:** headlight cones plus 7 ghost cones on every pixel. Mitigation: the distance early-out, and ghost cones drop to the nearest 3 if the probe shows a cost.
- **Night readability:** too dark and the Navigator can't call anything. The floor, landmark glow and wide corner spread are the levers. Tune on a real phone.
- **Stacking:** murky mist + night + storm is the worst case. Every layer keeps its own keyhole, and the car is always visible.
- **Clock drift:** the render clock and the server can drift by a frame or two over a run. That's harmless, since nothing scored depends on the sky.
