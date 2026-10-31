# Rally v2: vehicle classes

**Status:** design approved 2026-10-31 · **Package:** `games/blind-rally` (Rally variant only) · **Parents:** `rally-spec.md`, `blind-rally-map.md` ("Future: more cars")

Five cars that drive differently, picked per player or voted by the room. Blind Rally doesn't get them yet. The plumbing is shared, so switching it on there later is a lobby job, not a physics job.

## 1. Goals

- Each class wins somewhere and loses somewhere. A good driver can post a competitive time in any of them, and lap times on a typical stage land within a few seconds of each other. The tractor is the joke car, and it's allowed to be slower overall *and* sometimes the best line.
- Classes differ in handling, model and engine sound. Same physics model, different numbers.
- Nothing new goes over the wire except an id.

Out of scope: Blind Rally pickers, liveries/cosmetics beyond today's team paint, pre-race setup (tyres, springs), per-class server speed caps, per-class dashboard themes.

## 2. Roster

| id | Name | Model (Kenney Car Kit 3.1) | Character |
| --- | --- | --- | --- |
| `hatch` | Hatchback | today's car (`car_body.res`) | The all-rounder. Today's tuning, unchanged. Default. |
| `4x4` | 4x4 | `suv.glb` | Slower top end and acceleration. Grips everywhere: offroad/sand drag about ×0.5, snow/ice grip up. Heavy: keeps more speed through wall hits (`impact_keep` up), slower yaw response. |
| `rwd` | RWD Classic | `sedan-sports.glb` | Quick to accelerate, low base grip, big `power_oversteer`, higher `max_slip_deg`. Shines on tarmac, a handful on gravel. |
| `truck` | Rally Truck | `truck.glb` | Highest top speed, still below the server cap. Slow steer and yaw, long braking, huge momentum (low `drag`, high `impact_keep`). |
| `tractor` | Tractor | `tractor.glb` | About 60% of the hatch's top speed. Offroad and sand barely slow it (drag and top-speed multipliers near 1.0). Cutting across fields is a real line, and checkpoints keep it honest. Comedic engine. |

These numbers are starting points. Final tuning comes from the lap-time test (§7).

## 3. Lobby and rules

- **New setting `vehiclePick`:** `"free"` (default) | `"ballot"`. Label "Cars". Options: "Each player chooses" / "Everyone votes".
- **Free:** every car has its own `vehicle`. It defaults to `hatch` when the car is made, and the car's player changes it on the grid until the race starts.
- **Ballot:** one vote per car, live count, most votes wins, everyone drives the winner. A tie is settled by the room seed and shown as a tie, exactly like the track ballot. No votes means `hatch`.
- The grid shows a row of class cards: a thumbnail (a pre-rendered PNG per class, kept under `client/rally/`), name, one-line blurb, and four 1–5 bars: Speed, Grip, Offroad, Weight. In ballot mode the cards show vote counts instead of "picked".
- The race start locks the choice. Rematches keep each car's class (free) or the last winner (ballot) until someone changes it.
- Rules text, settings preview and briefing card mention the car choice. The copy follows the site style (short plain sentences, basic words).
- Results line: `1st · Car 2 · Rally Truck · Pine Panic` / `1:42.3 (no resets)`.

## 4. Server

- `shared/vehicles.ts`: `VEHICLE_IDS` (the tuple above), `VehicleId`, and `VEHICLES: Record<VehicleId, {name, blurb, bars: {speed, grip, offroad, weight}}>`. Lobby-safe, no tuning numbers.
- State: `team.vehicle: VehicleId`. In ballot mode the effective class comes from a ballot with `target: "vehicle"` in `state.ballots`, counted by the same code as the track ballot (`ballot.ts`, generalised over the option type, not duplicated).
- Actions (`parse.ts`, `game.ts`): `vehicle.pick {vehicleId}` (free mode, your own car, before the start) and `vehicle.vote {vehicleId | null}` (ballot mode, one per car, a new vote replaces the old). Rejections follow the existing style ("The cars are voted this time.").
- `initSession` gets `vehicle: VehicleId`.
- The ghost DTO (`ghostOf`) gets `vehicle`, rebuilt field by field like the rest.
- Public projection: each car's class is public (it's on the grid anyway). Still no coordinates.
- `MAX_SPEED` stays global at 45 m/s. §7 enforces that every class sits under it.

## 5. Godot

- `scripts/vehicles.gd` (`class_name Vehicles`): `const PRESETS := {id: {controller: {...}, surfaces: {...}, model: {...}, audio: {...}}}`.
  - `controller`: overrides for any `CarController` `@export`. Missing keys keep today's value, so `hatch` is `{}`.
  - `surfaces`: per-surface multipliers on top of `SURFACES` (e.g. `tractor: {offroad: {drag: 0.25, top: 1.8}}`). Applied as `SURFACES[s][k] * preset.surfaces.get(s, {}).get(k, 1.0)`.
  - `model`: scene/mesh path, scale, collision box size, wheel positions if the model's wheels are separate, bonnet-camera offset, paint hue to recolour.
  - `audio`: base pitch, rev range, grit/harmonics for `car_audio.gd`.
- `car_controller.gd`: `apply_preset(id)` sets exports and stores the surface multipliers. It's called once before the race. An unknown id falls back to `hatch` with a warning.
- `car.tscn` gets its body built from the preset (swap mesh, collision shape, light pod/roundel placement). The hatch path stays byte-for-byte today's.
- `car_paint.gd`: team paint on every model. Kenney models share a colormap texture, so recolouring may need a per-model approach (material override on the body surface, or a hue swap on a copied texture). **Prove this first.** It's the riskiest part.
- `ghosts.gd`: build each ghost's mesh from the ghost's `vehicle`, not from our own car. Cache per (vehicle, colour).
- `car_fx.gd`: dust/marks follow the preset's wheel positions and track width.
- `main.gd`: read `initSession.vehicle`. The probe build gets a key or query param to cycle classes for tuning.

## 6. Client

- `client/rally/grid.ts`: class card row plus the vote mode. Keyboard and touch friendly. Laptop sizes 1280×720 to 1920×1080 and phones both checked. Ink & Lime theme (`apps/web/src/style.css`), not `ui_theme.md`.
- `client/rally/seat.ts` / initSession: pass `vehicle` through.
- Results view: class name in each line.

## 7. Testing

- TS (`test/rally.test.ts`, `projection.test.ts`): parse/reject for both actions in both modes, lock at the start, rematch carry-over, ballot count and the seeded tie, the ghost DTO carries `vehicle` and nothing else new, settings parse/pin.
- Godot (`tests/rally_tests.gd`):
  - `Vehicles.PRESETS` keys equal `VEHICLE_IDS` (the test reads the ids from a small generated or hand-mirrored list, and the TS test checks the same list, so a drift fails one side).
  - Every preset's effective top speed on its fastest surface is under 45 m/s.
  - Each class's car scene builds, paints, and makes a ghost.
  - **Close-times check:** autopilot drives Pine Panic once per class. Hatch, 4x4, RWD and Truck finish within ±8% of the hatch's time. Tractor finishes, and within +35%.
- Manual: one real Rally race with mixed classes, two phones and a laptop, shared stage, ghosts showing the right models.

## 8. Risks

- **Paint on Kenney models** (§5): if recolouring is ugly, fall back to a coloured roof plate plus number and shape. Colour plus shape was always the rule.
- **Autopilot as a tuning judge:** it drives one line, and humans don't. The ±8% window keeps classes in the same ballpark. Feel tuning still needs a human pass.
- **Truck near the cap:** a downhill run with the truck could brush 45 m/s. The cap test uses top speed × the best surface `top` × a slope margin.
