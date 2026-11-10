# Treasure Hunt M4a: Time of Day, Night, Photo and Light Clues

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rounds happen at a chosen time of day with a sky clock that keeps running. Night has working lights. Photo and light clues join the existing three clue kinds. All of it runs on the 6 set pieces that already exist.

**Architecture:**
- **Shared sky model.** `shared/sky.ts` holds one model of the sky, shared by server and client: the start minute, the sun's position and how dark it is. A Godot copy (`DayClock`) follows the same JSON cases.
- **Server.** It fixes the start minute when the game is created, so a "Random" time is the same for everyone. It uses that minute and the round length to make the new clues:
  - **Shadow:** where a tall piece's shadow ends at a given clock time.
  - **Lamp:** under a lamp that comes on after dark.
  - **Photo:** a camera pose about 5 m from the cache, facing a landmark.
- **Godot.** It turns the clock into sun, moon, sky and fog, switches lamps, headlights and the torch on and off, and renders each photo in a SubViewport. It sends the photo back to the page as a JPEG.

**Tech Stack:** TypeScript (shared/server/client, vitest), Godot 4.7 GDScript (Compatibility renderer, web export).

**Spec:** `treasure-hunt-spec.md` (repo root), §2 (Time of day), §3 step 1, §6.2 (Photo, Light), §7.4 (Night). The user ruled the full time of day into M4. M4b (a separate plan) adds 10+ templates from new Kenney kits and denser minor points; this plan touches no new templates.

## Global Constraints

- **Repo rules:**
  - Desktop only.
  - Commit straight to master. Stage only your own files, never `git add -A`; the repo root has untracked files that aren't ours. Push after each commit.
  - End every commit message with `Claude-Session: https://claude.ai/code/session_01KwNUn9dpkZKSPFkAmAoz5c`.
- **Time of day (§2):** the lobby picks Day, Dusk, Night or Random. The sky clock runs during the round, so a long Timed round at dusk ends in the dark.
- **Clock rate:** 1 game minute per real minute. The clock sits at the start minute in the teams phase and the countdown, runs during hunting, and stops at the end.
- **Night is never pitch black (§7.4):** a dim moonlight keeps the land readable in silhouette.
- **Lit set pieces (§7.4):** of today's 6, these are the lighthouse (working only), the radio tower and the camp. Their lamps come on at dusk and can be seen from far away.
- **Headlights (§7.4):** always on after dusk when the buggy has a driver. Long reach, narrow beam.
- **Torch (§7.4):** every player has one and toggles it with F. Short reach, wide beam.
- **Caches at night (§7.4):** a small reflective strip on every cache catches the torch at under 8 m.
- **Photo clues (§6.2):** taken about 5 m from the cache, facing a landmark. The client renders them once the world is built, at the round's time of day. At night the camera only faces lit set pieces.
- **Light clues (§6.2):** the generator only picks a light clue that will be true during the round's time window.
- **Caches stay secret (§9):** a photo pose reaches only the teams that hold that clue. The cache layout can already be worked out from the public seed (an M2 ruling), so a photo pose leaks nothing new.
- **Site copy:** short, simple, plain Indian English, with basic words and no idioms.
- **Commands:**
  - Vitest: `pnpm vitest run games/treasure-hunt` from the repo root.
  - Typecheck: `pnpm typecheck`.
  - Godot: `timeout 300 ~/.local/bin/godot --headless --path games/treasure-hunt/godot --fixed-fps 60 --script res://tests/run_tests.gd`. Pass means exit 0, `0 failed`, and no `SCRIPT ERROR` or `Parse Error` in the output.
  - Run `--import` after adding a `class_name` script.
  - Export with `node games/treasure-hunt/scripts/export-godot.mjs`, and commit only `games/treasure-hunt/client/godot/godot-build.json`.
- **Never run `pnpm build`.** It leaves a wasm over 25 MiB in `apps/web/dist` and breaks `wrangler dev`.
- **Fixtures:** after changing generator or template output, run `UPDATE_FIXTURES=1 pnpm vitest run games/treasure-hunt/test/fixtures.test.ts`, then the Godot tests.

## Constants (`shared/sky.ts` unless noted; Godot copies them in `day_clock.gd` and says so)

| Name | Value | Notes |
|---|---|---|
| `START_MIN` | `{ day: 600, dusk: 1060, night: 1320 }` | minutes after midnight: 10:00, 17:40, 22:00 |
| `SUNRISE`, `SUNSET` | 360, 1080 | |
| `SUN_MAX_EL` | 55 | degrees at noon |
| `DARK_LIGHT_EL`, `DARK_FULL_EL` | 6, −6 | darkAt is 0 at or above 6°, 1 at or below −6°, smoothstep between |
| `SHADOW_MIN_EL` | 15 | no shadow clue with the sun lower than this |
| `SHADOW_MAX` | 100 | metres; a longer shadow is no clue |
| `SHADOW_STEP` | 10 | clue times are whole multiples of 10 minutes |
| `LAMP_ON` | 0.3 | darkness at which lamps and headlights switch on |
| `LAMP_CLUE_DARK` | 0.5 | a lamp clue needs the round to reach this |
| `LAMP_REACH` | 3 | metres from a lamp's foot to a slot it lights |
| `PHOTO_DIST`, `PHOTO_EYE` | 5, 1.7 | metres |
| `PHOTO_MAX` | 250 | metres to the landmark |
| `PHOTO_TARGET`, `LIGHT_TARGET` | 3, 2 | caches per map that get a photo / a light clue, when spots allow |
| `PHOTO_W`, `PHOTO_H`, `PHOTO_Q` | 480, 270, 0.75 | Godot render size and JPEG quality |
| `TORCH_RANGE`, `TORCH_ANGLE` | 18, 35 | metres, degrees (SpotLight3D spot_angle) |
| `HEAD_RANGE`, `HEAD_ANGLE` | 60, 18 | |
| `GLINT_RANGE` | 8 | metres |
| `CLUE_DIFFICULTY` | shadow 3, lamp 2, photo 2 | in server/clues.ts, beside the existing ones |

## Copy (exact)

- **Lobby field:** label `Time of day`. Options: `Day`, `Dusk`, `Night`, `Random`. Hints:
  - day: `It stays light.`
  - dusk: `The sun sets during the round. A long round ends in the dark.`
  - night: `It is dark. Press F for your torch. Buggy lights come on by themselves.`
  - random: `A surprise. Everyone gets the same one.`
- **Clues:**
  - shadow: `Where the shadow of the {label} ends at {HH:MM}.`
  - lamp: `Under the lamp at the {label}. It comes on when it gets dark.`
  - photo: `A photo taken about 5 m from the cache, looking at the {label}.`
- **Photo still rendering:** `The photo is loading.`
- **Rules:** replace the line starting `A clue names a place` with:
  `A clue names a place, says the cache is between two places, gives a distance and a direction, shows a photo taken near the cache, or says where a shadow ends or a lamp shines.`
  Then add:
  - `The clock at the top shows the time in the game. It moves 1 minute for every real minute. A shadow clue needs that time.`
  - `At night, press F to turn your torch on or off. Buggy lights come on by themselves when it gets dark. Some places have lamps that come on when it gets dark. A cache has a small strip that shines when your torch is close.`

## Review Focus

1. **Reload mid-round:** a page or iframe reload in hunting puts the sky at the right minute at once, not at the start minute. Test in Task 8.
2. **Random time:** every player gets the same start minute, because it's resolved once on the server and sent as public state. Test in Task 2.
3. **Dusk round length:** a 15-minute dusk round never reaches `LAMP_CLUE_DARK`, so it offers no lamp clue. A 60-minute one does. Test in Task 4.
4. **Shadow tip in a bad place:** a tip in the sea, out of bounds or on a cliff is dropped by the same filter caches already pass. So is a time outside the window, or a sun below 15°. Test in Task 4.
5. **Photo camera in a bad place:** a camera underwater, inside a piece's pad, or with the view blocked by a ridge makes no photo clue. At night it only faces a lit piece. Test in Task 5.

---

### Task 1: The shared sky model

**Files:**
- Create: `games/treasure-hunt/shared/sky.ts`
- Create: `games/treasure-hunt/godot/tests/day_cases.json`
- Modify: `games/treasure-hunt/shared/index.ts` (re-export)
- Test: `games/treasure-hunt/test/sky.test.ts`

**Interfaces:**
- Produces:
  - Types and values: `type TimeSetting = "day" | "dusk" | "night" | "random"`, `TIMES`, `TIME_LABELS`, `timeHint(t: TimeSetting): string`.
  - `startMinOf(t: TimeSetting, seed: number): number`. Random picks day, dusk or night by `stableHash(\`${seed}:time\`) % 3` from `@games/game-core`.
  - `sunAt(min: number): { az: number; el: number }`, in degrees. `az` is a compass bearing (0 north = −Z, 90 east = +X).
  - `darkAt(min: number): number`, from 0 to 1.
  - `darkWithin(startMin: number, minutes: number): boolean`. True when `darkAt` reaches `LAMP_CLUE_DARK` on any whole minute of the window.
  - `clockText(min: number): string`, as `"HH:MM"`, wrapping past 24:00 and flooring the minute.
  - `shadowTip(at: { x: number; z: number }, top: number, min: number): { x: number; z: number } | null`.
  - The constants table's sky constants.

- [ ] **Step 1: Write the failing tests** in `test/sky.test.ts`:
  - `sunAt(720)` is `{ az: 180, el: 55 }`. `sunAt(360).el` is 0 and its `az` is 90. `sunAt(1080).az` is 270.
  - `darkAt(720) === 0`, `darkAt(0) === 1`, and `darkAt` is monotonic non-decreasing from 1060 to 1140.
  - `clockText(1060) === "17:40"`, `clockText(1445) === "00:05"`, `clockText(600.9) === "10:00"`.
  - `startMinOf("dusk", 7) === 1060`, and `startMinOf("random", s)` is always one of the three values. Across seeds 0..299 each value appears at least 60 times.
  - The `shadowTip` tip lies opposite the sun, at distance `top / tan(el)`. With `top` 20 at minute 720 (sun due south, el 55) from (0, 0), the tip is (0, −14.0) to 0.05. It's null at `sunAt.el < 15`, and null when the length is over 100.
  - `darkWithin(1060, 15) === false`, `darkWithin(1060, 60) === true`, `darkWithin(600, 60) === false`, `darkWithin(1320, 15) === true`.
  - Every case in `godot/tests/day_cases.json` (`{cases: [{min, az, el, dark}]}`, at least 12 minutes including 0, 360, 600, 720, 1060, 1080, 1100, 1320) matches `sunAt` and `darkAt` to 1e-3.
- [ ] **Step 2: Run** `pnpm vitest run games/treasure-hunt/test/sky.test.ts`. Expected: FAIL (no module).
- [ ] **Step 3: Implement `shared/sky.ts`.** The sun model, exactly (all angles in degrees):
  ```ts
  // t runs 0 at sunrise to 1 at sunset; outside that the sun is below the horizon.
  const t = (min - SUNRISE) / (SUNSET - SUNRISE);
  el = SUN_MAX_EL * Math.sin(Math.PI * t);           // negative at night, from the same formula
  az = ((90 + 180 * t) % 360 + 360) % 360;
  dark = smoothstep from DARK_LIGHT_EL (0) down to DARK_FULL_EL (1) on el
  tip = at − (top / tan(el)) · (sin az, −cos az)      // x and z
  ```
  `min` is taken mod 1440 first.
- [ ] **Step 4: Write `day_cases.json`** from the implementation, rounded to 4 decimals, and rerun. Expected: PASS.
- [ ] **Step 5: Commit** with the message `Treasure Hunt: a sky clock both sides share`.

### Task 2: The time setting and the round's start minute

**Files:**
- Modify: `shared/types.ts` (THSettings, parseTHSettings, THPublic), `shared/rules-text.ts`, `server/game.ts` (createGame, getPublicState), `server/hunt.ts`
- Test: `test/game.test.ts`, `test/teams.test.ts` (or wherever settings are parsed today; follow the file that holds `parseTHSettings` tests)

**Interfaces:**
- Consumes: Task 1's `TimeSetting`, `TIMES`, `TIME_LABELS`, `timeHint` and `startMinOf`.
- Produces:
  - `THSettings.time: TimeSetting`, default `"day"`.
  - `THPublic.sky: { startMin: number }`.
  - `THState.sky: { startMin: number }`.
  - `interface HuntSky { startMin: number; minutes: number }` and `makeHunt(seed: number, sky: HuntSky = { startMin: START_MIN.day, minutes: 30 })` in `server/hunt.ts`. This task only threads `sky` through; Tasks 4 and 5 use it.
  - `treasureHuntSettingFields` gains the `time` field.

- [ ] **Step 1: Write the failing tests.**
  - `parseTHSettings({ time: "dusk" }).time === "dusk"`. A missing `time` gives `"day"`. `time: "noon"` gives null.
  - `createGame` with `time: "random"` gives the same `getPublicState(...).sky.startMin` to every player. It equals `startMinOf("random", s)` for the seed `s` drawn first from `ctx.randomInt`, with a stubbed `randomInt`.
  - With `time: "night"`, `sky.startMin === 1320`.
  - The `time` setting field has label `Time of day`, the four options in the order Day, Dusk, Night, Random, and the hint copy from the Copy section.
  - The rules array holds the new and replaced lines from the Copy section.
- [ ] **Step 2: Run** them and see them fail.
- [ ] **Step 3: Implement.**
  - In `createGame`, draw `s = ctx.randomInt(2 ** 31)` once and set `startMin = startMinOf(settings.time, s)`, then call `makeHunt(s, { startMin, minutes: settings.minutes })`.
  - Store `sky: { startMin }` on the state and copy it into public state.
  - The settings field goes after Round length.
- [ ] **Step 4: Run** vitest and typecheck. Expected: PASS.
- [ ] **Step 5: Commit** with the message `Treasure Hunt: pick the time of day in the lobby`.

### Task 3: Tall pieces and lamps, both sides

**Files:**
- Modify: `shared/templates.ts`, `test/fixtures.test.ts` (pieces.json gains `top` and `lamps` per sample), `godot/tests/fixtures/pieces.json` (regenerated), `godot/scripts/pieces/kit.gd`, `lighthouse.gd`, `radio_tower.gd`, `camp.gd`, `godot/tests/piece_tests.gd`
- Test: `test/pieces.test.ts`, `godot/tests/piece_tests.gd`

**Interfaces:**
- Produces, in `shared/templates.ts`:
  - On `Template`: `top?(p: Record<string, number>): number` (metres above the pad of the piece's highest point, at its local origin) and `lamps?(p: Record<string, number>): Lamp[]`.
  - `interface Lamp { x: number; y: number; z: number; clue: boolean }`, in the local frame. `clue` is true only for a ground lamp a cache can be "under".
  - `worldLamp(piece: SetPiece, lamp: Lamp): { x: number; y: number; z: number }`, with y = padY + lamp.y. It turns the lamp the same way `worldSlot` turns a slot.
- **Values:**
  - **lighthouse:**
    - `top` is `height + 3.6` when working and `height + 1.1` when ruined.
    - `lamps`, working only: the top lamp `{x:0, y:height+1.2, z:0, clue:false}` and a door lamp `{x:0, y:2.6, z:-(R+0.25), clue:true}`.
  - **radio-tower:**
    - `top` is `height + 3.5`.
    - `lamps`: the top lamp `{x:0, y:height+3.25, z:0, clue:false}` and a hut door lamp `{x:b+3.5, y:2.6, z:-1.75, clue:true}`.
  - **camp:** a lantern on a post at `polar(3π/4, 2.6)` with y 2.2 and `clue:true`. No `top`.
  - The other templates have neither.
- **Produces, in Godot:**
  - Every lamp is a node named `Lamp<i>` (an `OmniLight3D`, `omni_range` 9, hidden by default). It's paired with the glowing mesh: the existing `Lamp` meshes for the top lamps, and a new small bulb and post for the door and camp lamps.
  - `PieceKit.set_lamps_on(on: bool)` switches every lamp material between emissive and plain. Nothing calls it yet.

- [ ] **Step 1: Write the failing tests.**
  - TS: for every sample in pieces.json, `top` and `lamps` match the values above. Every `clue: true` lamp is within `LAMP_REACH` (XZ) of at least one slot of the same piece.
  - Godot `piece_tests.gd`: for each sample, building it at the origin gives a merged mesh AABB top within 0.15 of `top` (when present). Each lamp in the fixture has an `OmniLight3D` within 0.05 of its position, and the camp post stands clear of every slot (the existing slot-clear check covers it).
- [ ] **Step 2: Run** both suites and see them fail.
- [ ] **Step 3: Implement** the TS values, regenerate the fixtures, and build the lamp nodes in Godot.
- [ ] **Step 4: Run** vitest, typecheck and Godot. Expected: PASS.
- [ ] **Step 5: Commit** with the message `Treasure Hunt: lamps and heights on the set pieces`.

### Task 4: Shadow and lamp clues

**Files:**
- Modify: `server/clues.ts`, `server/caches.ts`, `server/hunt.ts`
- Test: `test/clues.test.ts`, `test/caches.test.ts`, `test/generate.test.ts` (the 1000-seed run)

**Interfaces:**
- Consumes:
  - Task 1's `sunAt`, `shadowTip`, `darkWithin`, `clockText` and constants.
  - Task 2's `HuntSky`.
  - Task 3's `top`, `lamps` and `worldLamp`.
- Produces:
  - `ClueKind` gains `"shadow" | "lamp"`.
  - `CacheSpot` gains an optional `shadowMin?: number`, the clock minute of its shadow clue. A shadow spot's `source` is its piece id.
  - `cacheSpots(l, sky)`, `clueTexts(l, s, sky)`, `clueKinds(l, s, sky)`, `cluesFor(l, c, sky, r)`, `rateClues(l, s, kinds, sky)` and `makeCaches(l, r, sky, tally?)`: `sky` is added before the rng or tally in every one.
  - `shadowSpots(l: TreasureLayout, sky: HuntSky, r: Rng): CacheSpot[]`.

- **Rules:**
  - **Shadow spots:** for each piece with `top`, list the minutes `m` in the window `[startMin, startMin + minutes]` that are multiples of `SHADOW_STEP` and have `sunAt(m).el ≥ SHADOW_MIN_EL` and `shadowTip(...)` non-null. Pick one by `r`, giving a spot at the tip with `dy: 0` and `shadowMin: m`. A piece with no such minute gives nothing.
  - **Shadow spot filtering:** the spots join `cacheSpots`'s candidates and pass its existing filter (bounds, land, slope, at least one clue kind).
  - **Shadow clue:** fits only a spot with `shadowMin`, and its text uses `clockText(shadowMin)`.
  - **Shadow spots and other clue kinds:** a shadow spot is not "at a piece", so the never-3-at-a-piece cap doesn't apply. Its landmark kind never fits, and bearing may come from its own piece (it isn't by the door).
  - **Lamp clue:** fits a slot spot when `darkWithin(startMin, minutes)` and a `clue: true` lamp of the spot's piece is within `LAMP_REACH` in XZ.
  - **Quota:** before the half-and-half split, `makeCaches` moves forward up to `LIGHT_TARGET` spots that can take a shadow or lamp clue (chosen by `r`). When one of those becomes a cache, its light kind is its first clue. Uniqueness keeps working on the joined clue text.

- [ ] **Step 1: Write the failing tests.**
  - On a fixture layout with a lighthouse:
    - day 10:00 and 60 minutes gives shadow spots whose clue matches `/^Where the shadow of the .+ ends at 1[01]:[0-5]0\.$/`;
    - night 22:00 gives none;
    - a sky window entirely before sunrise gives none.
  - Lamp clues:
    - `darkWithin` false (dusk, 15 minutes) gives no lamp clue on any spot;
    - dusk with 60 minutes gives a lamp clue on the lighthouse door slot of a working lighthouse;
    - a ruined lighthouse gives none.
  - Over seeds 1..50 at night with 30 minutes, at least 40 maps have at least 1 cache with a lamp clue. Over seeds 1..50 at day with 30 minutes, at least 40 maps have a shadow clue. No map has more than `LIGHT_TARGET` forced ones beyond chance (count caches whose first clue is light: ≤ 2 + the natural ones is fine; assert ≥ 1).
  - The existing 1000-seed generate test still finds zero failed maps with the default sky, and a 100-seed run at night with 15 minutes also finds zero.
- [ ] **Step 2: Run** them and see them fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** vitest and typecheck. If the 1000-seed tests time out under load, rerun that file alone. Expected: PASS.
- [ ] **Step 5: Commit** with the message `Treasure Hunt: shadow and lamp clues`.

### Task 5: Photo clues on the server

**Files:**
- Create: `server/photos.ts`
- Modify: `server/clues.ts`, `server/caches.ts`, `server/game.ts` (private state), `shared/types.ts`
- Test: `test/photos.test.ts`, `test/caches.test.ts`, `test/game.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces:
  - `interface PhotoCam { x: number; z: number; yaw: number; pitch: number; target: string }` in `shared/types.ts`:
    - x and z are rounded to 0.1;
    - yaw is Godot radians and pitch is radians up, both rounded to 0.01;
    - `target` is the piece id the camera faces.
  - `photoCam(l: TreasureLayout, s: CacheSpot, sky: HuntSky): PhotoCam | null` in `server/photos.ts`.
  - `Cache.photo: PhotoCam | null`.
  - `THPrivate.clues[i].photo: PhotoCam | null`.
  - `ClueKind` gains `"photo"`.
- **Camera rule:**
  - **Target:** the nearest piece within `PHOTO_MAX` that isn't the spot's own piece. At night (`darkAt(startMin) ≥ LAMP_CLUE_DARK`), only pieces whose template has `lamps` count.
  - **Position:** the camera sits `PHOTO_DIST` from the spot, on the side away from the target (so the cache spot is between the camera and the target).
  - **Rejected when:**
    - the camera is outside `CACHE_BOUND` or below `CACHE_MIN_HEIGHT` on macroHeight;
    - it's within `padR` of any piece;
    - the sight line from eye height (`macroHeight + PHOTO_EYE`) to the target's `padY + (top ?? 6) / 2`, sampled every 16 m, passes more than 2 m under macroHeight anywhere.
  - **Aim:** yaw faces the target, Godot style (yaw 0 faces −Z, positive turns left). Pitch is the elevation angle to that mid-height point.
- **Clue:** photo text from the Copy section. The photo clue's uniqueness key includes the pose (`clues.join("\n") + "|" + x + "," + z`).
- **Quota:** `PHOTO_TARGET` works the same way as `LIGHT_TARGET`, and a spot can't be forced for both.

- [ ] **Step 1: Write the failing tests.**
  - `photoCam`:
    - its camera is 5 ± 0.1 m from the spot, and the spot lies within 1 m of the camera-to-target line;
    - yaw points at the target: `forward = (−sin yaw, −cos yaw)` is within 0.02 rad of the target bearing;
    - it returns null for a spot whose camera lands in the sea;
    - a fixture with a ridge between the spot and the only near piece gives null;
    - at night, a spot near only a plane and a shipwreck gives null.
  - Over seeds 1..50 at day with 30 minutes, at least 40 maps have at least 1 photo cache.
  - `getPrivateState` gives a photo pose only on the clues that team holds. In Race, a cache not yet released shows no photo to anyone.
- [ ] **Step 2: Run** them and see them fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** vitest and typecheck. Expected: PASS.
- [ ] **Step 5: Commit** with the message `Treasure Hunt: photo clues`.

### Task 6: The day clock and the light in Godot

**Files:**
- Create: `godot/scripts/world/day_clock.gd` (`class_name DayClock`), `godot/scripts/world/daylight.gd` (`class_name Daylight`), `godot/tests/day_tests.gd`
- Modify: `godot/scenes/main.tscn` (a `Moon` DirectionalLight3D: shadows off, energy 0), `godot/scripts/main.gd`, `godot/scripts/web_bridge.gd`, `godot/tests/run_tests.gd`

**Interfaces:**
- Consumes: Task 1's model and `day_cases.json`.
- Produces:
  - `DayClock` (Node):
    - static `sun_at(min: float) -> Vector2` (x is az, y is el) and static `dark_at(min: float) -> float`, mirroring sky.ts;
    - `set_clock(min: float, running: bool)`;
    - `minute() -> float`, which advances by wall time at 1 minute per 60 s while running, like Blind Rally's `SkyClock`;
    - signal `dark_changed(dark: float)`, emitted when the darkness moves by more than 0.01 or lands on 0 or 1.
  - `Daylight` (Node):
    - `setup(sun: DirectionalLight3D, moon: DirectionalLight3D, env: Environment, sky: ProceduralSkyMaterial)`;
    - `apply(min: float)` points the sun along `-(sin az·cos el, sin el, −cos az·cos el)`. Its energy is `1 - dark`, and shadows are off once the sun is below the horizon.
    - **Moon:** the moon is fixed (az 200, el 35) with energy `0.15 * dark`.
    - **Ambient and sky:** ambient energy is `lerp(0.8, 0.25, dark)`. Sky, horizon and fog colours lerp to the night palette `#0b1530` / `#1a2440` / `#141c30`. A warm horizon `#e89a5a` shows while el is between −6 and 10.
  - **Bridge:** `web_bridge.gd` gets an inbound `host.skyClock({min, running})` with the seam `receive_sky_clock_json`, and the signal `sky_clock_set(min: float, running: bool)`.
  - **main.gd wiring:** main.gd owns a `DayClock` and a `Daylight`, applies every frame, and makes `day_clock.dark_changed` available to Task 7.

- [ ] **Step 1: Write the failing tests** in `day_tests.gd`:
  - every case in `day_cases.json` matches `sun_at` and `dark_at` to 1e-3;
  - with `set_clock(720, false)`, `minute()` stays at 720 after 2 s of wall time. With `running` true it reaches about 720 + 2/60 (use the wall-time seam the Rally clock uses);
  - `Daylight.apply(720)` gives a sun forward whose horizontal part points north (the sun is south), and the sun's energy is 1. `apply(0)` gives sun energy 0, moon energy 0.15 and ambient 0.25;
  - `receive_sky_clock_json('{"min":1100,"running":true}')` emits `sky_clock_set(1100, true)`.
- [ ] **Step 2: Run** Godot and see them fail.
- [ ] **Step 3: Implement**, then run `--import`.
- [ ] **Step 4: Run** Godot. Expected: PASS.
- [ ] **Step 5: Commit** with the message `Treasure Hunt: the sun moves`.

### Task 7: Night tools

**Files:**
- Modify:
  - `godot/scripts/main.gd` (wire dark_changed; F toggles torch; glint tick)
  - `godot/scripts/vehicle/buggy.gd` (two headlight SpotLight3D)
  - `godot/scripts/vehicle/fleet.gd` (lights by driver)
  - `godot/scripts/camera/rig_camera.gd` or `player/walker.gd` (torch SpotLight3D on the camera)
  - `godot/scripts/hunt/cache.gd` and `hunt/caches.gd` (a per-cache strip material that glints)
  - `godot/scripts/pieces/kit.gd` (the `set_lamps_on` caller)
  - `godot/scripts/world/pieces.gd` (show the `Lamp<i>` lights)
- Test: `godot/tests/night_tests.gd` (new), plus additions in `fleet_tests.gd` and `hunt_tests.gd`

**Interfaces:**
- Consumes: Task 3's lamp nodes and `set_lamps_on`, and Task 6's `dark_changed`.
- Produces:
  - **Buggy:** `Buggy.set_lights(on: bool)`. Fleet calls it with `dark ≥ LAMP_ON and the buggy has a driver` (local driving counts) on every `dark_changed` and every vehicles list.
  - **Pieces:** `Pieces.set_lamps(on: bool)` shows every `Lamp<i>` and calls `PieceKit.set_lamps_on`.
  - **Torch:** `main.torch_on: bool`, toggled by the F key (an `InputMap` action `torch`, added in project.godot). The light only shines when `torch_on`. It works on foot and riding.
  - **Glint:** `Caches.glint(from: Vector3, torch_on: bool, dark: float)` sets each visible cache's strip emission energy to 2 when `torch_on`, `dark ≥ LAMP_ON` and the cache is within `GLINT_RANGE`, else 0.
  - **Values:** headlights: range `HEAD_RANGE`, angle `HEAD_ANGLE`, energy 4. Torch: range `TORCH_RANGE`, angle `TORCH_ANGLE`, energy 2.

- [ ] **Step 1: Write the failing tests.**
  - A dark of 0.4 turns on a driven buggy's lights and leaves a parked one off. A dark of 0.2 turns everything off.
  - `set_lamps(true)` makes every `Lamp<i>` visible.
  - The F action toggles `torch_on`, and the torch light's `visible` follows it.
  - `glint`: within 8 m with the torch on at dark 0.6 gives emission 2. At 9 m it's 0, with the torch off it's 0, and at dark 0.1 it's 0.
- [ ] **Step 2: Run** Godot and see them fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** Godot. Expected: PASS.
- [ ] **Step 5: Commit** with the message `Treasure Hunt: lights for the night`.

### Task 8: Photos in Godot, and the page's half of the sky

**Files:**
- Create: `godot/scripts/hunt/photos.gd` (`class_name Photos`), `godot/tests/photo_tests.gd`
- Modify:
  - `godot/scripts/world/chunk_streamer.gd` (`hold`/`release`)
  - `godot/scripts/web_bridge.gd` (inbound `photos`, outbound `emitPhoto`)
  - `godot/scripts/main.gd`
  - `client/godot/bridge.ts` (`skyClock`, `photos`, `emitPhoto` with a `godotPhoto` checker)
  - `client/view.ts` (send the clock and the photo list; keep the returned images)
- Test: `test/session.test.ts` (or a new `test/sky-view.test.ts`), `godot/tests/photo_tests.gd`

**Interfaces:**
- Consumes: Task 5's `PhotoCam` in `THPrivate`, Task 6's bridge seam, and `THPublic.sky` and `startedAt`.
- Produces:
  - **Streamer:** `ChunkStreamer.hold(at: Vector3)` keeps chunks within `LOAD_RADIUS` of `at` from unloading until `release()`.
  - **Photos (Godot):**
    - `Photos.set_list(list: Array)` takes `{id, x, z, yaw, pitch}` entries and renders, one at a time, those not already rendered for the same pose;
    - signal `photo_ready(id: String, data: String)`, where `data` is base64 JPEG;
    - the seam `_capture() -> Image`, which tests override.
  - **Photo render steps:**
    1. Place a `Camera3D` in a `SubViewport` (`PHOTO_W`×`PHOTO_H`, sharing the main World3D) at `(x, ground + PHOTO_EYE, z)`, using `TerrainField` height, with the given yaw and pitch.
    2. Call `ensure_around` on the camera and on a point 150 m along its forward, then `hold`.
    3. Wait 2 frames and set `render_target_update_mode = UPDATE_ONCE`.
    4. Wait for `frame_post_draw` and capture.
    5. `release`, then make the JPEG with `save_jpg_to_buffer(PHOTO_Q)` and base64 it.
  - **Bridge:** `web_bridge.gd` handles inbound `host.photos({list})` → `photos_set(list)`, and outbound `host.emitPhoto({id, data})`.
  - **Client bridge:** `bridge.ts` gets `skyClock(min, running)` and `photos(list)` on the bridge class. A `photo(p: {id, data})` handler is checked by `godotPhoto(p: unknown): {id: string; data: string} | null`, which rejects non-strings and data over 400 000 chars.
  - **Sky minute:** `skyMinute(game: THPublic, now: number): number` in `client/view.ts` (exported for tests):
    - `startMin` before hunting;
    - `startMin + (now − startedAt)/60000` in hunting;
    - `startMin + replay.durationS/60` when finished.
  - **View:** the view sends `skyClock(skyMinute(...), phase === "hunting")` on every update and on bridge `ready`. It sends the list of photo clue poses whenever the private clues change, and on `ready`.
  - **Image store:** a `Map` keyed `${id}|${x},${z}` holds the data URLs for Task 9's board.

- [ ] **Step 1: Write the failing tests.**
  - TS, `skyMinute`: for a hunting game with `startedAt = now − 90 000`, `startMin` 600 gives 601.5. Teams gives 600. A finished game with `durationS` 1800 gives 630.
  - TS: on bridge `ready` during hunting, the view sends `skyClock` with the current minute (Review Focus 1), and `photos` with the private photo clues.
  - TS: `godotPhoto` accepts `{id: "c1", data: "abc"}` and rejects a number, a missing id and a 400 001-char data.
  - Godot `photo_tests.gd`, with `_capture` overridden to return a 4×4 image:
    - `set_list` with two poses emits `photo_ready` twice, in order;
    - the same list again emits nothing;
    - the same id with a new pose emits once;
    - `hold` keeps a chunk loaded that `update` far away would otherwise unload, and `release` lets it go.
- [ ] **Step 2: Run** both suites and see them fail.
- [ ] **Step 3: Implement**, then run `--import`.
- [ ] **Step 4: Run** vitest, typecheck and Godot. Expected: PASS.
- [ ] **Step 5: Commit** with the message `Treasure Hunt: photos rendered in the world`.

### Task 9: The clock and photos in the HUD, and export

**Files:**
- Modify: `client/hud.ts`, `client/view.ts`, `client/styles.css`, `client/godot/godot-build.json` (export)
- Test: `test/hud.test.ts`

**Interfaces:**
- Consumes: Task 8's image store and `skyMinute`, and Task 1's `clockText`.
- Produces:
  - `clueItems(priv, photoFor?: (id: string, cam: PhotoCam) => string | undefined)` gives `{ text, found, taken, photo: { src?: string } | null }`. `photo` is null when the clue has no camera, and `src` is undefined while the photo is loading.
  - A `th-clock` span in the bar showing `clockText(skyMinute(...))`, updated on the existing 4 Hz tick.

- [ ] **Step 1: Write the failing tests.**
  - `clueItems` for a clue with a camera and no image gives `photo: {}`, and the board renders the text `The photo is loading.`
  - With an image, it renders an `<img>` with that src and the alt `Photo clue`.
  - Without a camera, `photo` is null and nothing extra renders.
  - The bar shows `17:40` for a dusk game in countdown.
- [ ] **Step 2: Run** them and see them fail.
- [ ] **Step 3: Implement.** The image is full board width, with an aspect ratio of 16/9 and a 1px `--line` border.
- [ ] **Step 4: Run** vitest and typecheck, then export Godot. Expected: PASS, and a new build id.
- [ ] **Step 5: Commit** `godot-build.json` and the client files with the message `Treasure Hunt: the game clock and photo clues on screen`.

### Task 10: Browser check (controller)

The controller runs this on `pnpm dev` with two tabs, faking positions through `treasureHuntHost` where walking would take too long.

- **Day 10:00, Timed 15:** the clock reads 10:00 and moves. A shadow clue's time is inside the window. Standing at the shadow tip at that time, the tower's shadow ends within a few metres of you.
- **Photos:** at least one photo clue shows an image within about 10 s of hunting starting. Standing at its pose shows the same view.
- **Dusk, Timed 60:** set the clock by stubbing `skyClock` to 18:30. The sky goes dark but not black (the moon). Lamps glow at lit pieces and can be seen from far away. A driven buggy's headlights come on, F toggles the torch, and a revealed cache's strip glints within 8 m.
- **Night, Race to 3:** photos face only lit pieces. Lamp clues appear.
- **Reload:** reload mid-round and the sky lands on the current minute.
- **Performance:** fps at night with lamps and headlights stays within the M1 target on this machine (note the number).
- **Console:** no errors.

Record the results in the ledger. Bugs go to the final fix wave.
