# Treasure Hunt M3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Several people hunt the same map together: teams, positions streamed and drawn, shared buggies with a passenger seat, team pins, Race to N, and a top-down replay at the end.

**Architecture:**
- **Server.** Owns teams, seats, pins, the clue release and a ~1 Hz route log. Positions stream at 10 Hz and are relayed as-is to everyone, without a storage write.
- **Public state.** Carries the seed, not the 24 KB layout. Every client rebuilds the layout from the seed with the shared generator.
- **Godot.** Draws other players as team-tinted capsules and other drivers' buggies as puppets. It only enters a seat after the server confirms it.
- **TS view.** Owns the 2D map, used three ways: minimap, full map with pins, and the replay.

**Tech Stack:** TypeScript (game-core `GameDefinition`, vitest), Godot 4.7.2 GDScript (headless test runner), plain DOM and canvas.

**Spec:** `treasure-hunt-spec.md` §6.3, §6.4, §7.2, §7.3, §8, §9 and §12 (M3). It builds on M2 (`docs/superpowers/plans/2026-11-10-treasure-hunt-m2.md`).

## Global Constraints

- **Repo rules:**
  - Desktop only.
  - Commit straight to master, stage only your own files (never `git add -A`), and push after each commit.
  - End every commit message with `Claude-Session: https://claude.ai/code/session_01KwNUn9dpkZKSPFkAmAoz5c`.
- **Players never collide with each other.** Players and buggies pass through each other (§13.3). Remote capsules and puppet buggies have no colliders.
- **Seats.** A buggy has 2 seats: a driver and a passenger. The passenger only looks around and drops pins (§7.2).
- **Positions aren't secret, caches are (§9).** Cache x/z reach a client only through a reveal to that player's team, or in the replay after the round ends.
- **Position stream.** 10 Hz. The server keeps the latest snapshot in memory with `persist: false`, and persists about once a second (§9).
- **Pins.** Visible to your own team only. At most 5 live per player; a 6th removes your oldest (§8).
- **Minimap.** Teammates are always shown. Other teams show as dots only within 150 m. Name tags show within 50 m (§7.5, §8).
- **Race to N.** N is 3–10, default 5. 3 clues are open at the start, plus 1 more each time any team claims a cache. A claimed cache is gone for everyone (§6.3, §8).
- **Timed.** 15, 30 or 60 minutes. Each team has its own pool. Ties are broken by total difficulty, then by who claimed their last cache first (§8).
- **Solo.** A team of one, with the same rules.
- **Bodies.** Team-tinted capsules with name tags. The character pack is M5 (user ruling, 2026-11-10).
- **Replay.** A top-down 2D map with team-coloured routes, a mark at each find and a time slider (user ruling).
- **Site copy.** Short, simple, plain Indian English, with basic words and no idioms.
- **Commands:**
  - Vitest: `pnpm vitest run games/treasure-hunt` from the repo root.
  - Typecheck: `pnpm typecheck`.
  - Godot: `timeout 300 ~/.local/bin/godot --headless --path games/treasure-hunt/godot --fixed-fps 60 --script res://tests/run_tests.gd`. Pass means exit 0, `0 failed`, and no `SCRIPT ERROR` or `Parse Error` in the output.
  - Run `--import` after adding a `class_name` script.
  - Export with `node games/treasure-hunt/scripts/export-godot.mjs`.
- **Never run `pnpm build`.** It leaves a wasm over 25 MiB in `apps/web/dist` and breaks `wrangler dev`.

## Review Focus

1. **Two players press E on the same free driver seat at once.**
   - Expected: the first gets it. The second sees "Someone is already in that seat." and stays on foot, and their Godot never entered the buggy.
   - Pinned by tests in Task 6 (server) and Task 9 (Godot enters only on confirm).
2. **A driver leaves the room mid-drive with a passenger aboard.**
   - Expected: the driver seat frees and the buggy parks at the last streamed pose for everyone. The passenger stays seated and can get out.
   - Pinned by a test in Task 6.
3. **The iframe reloads, or a player rejoins mid-round.**
   - Expected: roster, buggies (with who's in them), team pins and reveals all come back on Godot's `ready()`.
   - Pinned by a `GodotFeed` test in Task 9.
4. **Race: two teams claim the same cache back to back.**
   - Expected: the first wins. The second gets "Another team found this cache first.", and the clue shows as taken for everyone.
   - Pinned by a test in Task 4.
5. **The host leaves during the teams phase.**
   - Expected: the new host (from `ctx.hostId`) can start, and nobody is stuck.
   - Pinned by a test in Task 2.

---

## Constants (Task 1 adds these to `shared/world.ts`)

| Name | Value | Notes |
|---|---|---|
| `POS_HZ` | 10 | was 4 |
| `TRACK_MIN_MS` | 1000 | a route point is kept at most once a second |
| `TRACK_MIN_M` | 5 | and only after moving this far |
| `TRACK_CAP` | 2000 | points per player |
| `PIN_CAP` | 5 | live pins per player |
| `SEAT_RANGE` | 4 | metres, XZ, from your last pos to the buggy |
| `DOT_RANGE` | 150 | other teams on the minimap |
| `NAME_RANGE` | 50 | name tags |
| `RACE_OPEN_START` | 3 | |
| `RACE_TARGETS` | `[3,4,5,6,7,8,9,10]`, default 5 | |
| `MAX_TEAMS` | 8 | one per team colour |
| `LOOSE_BUGGIES` | 3 | |

---

### Task 1: Seed-only public state

The 24 KB layout goes out with every state broadcast. M3 adds pins and seats, which broadcast often, so public state carries `seed` and each client rebuilds the layout.

**Files:**
- Modify: `shared/types.ts` (`THPublic.layout` → `seed: number`), `shared/world.ts` (the constants table), `server/game.ts` (`getPublicState`), `client/view.ts`
- Create: `client/layout-cache.ts`
- Test: `test/layout-seed.test.ts`, `test/session.test.ts`

**Interfaces:**
- Produces:
  - `layoutFor(seed: number): TreasureLayout`, which memoises the last seed.
  - `THPublic.seed`.

- [ ] **Step 1: Write the failing tests**
  - `generateLayout(makeHunt(s).layout.seed)` deep-equals `makeHunt(s).layout` for 20 fixed seeds, including one that rerolls.
  - `JSON.stringify(getPublicState(state)).length < 4000` for 8 players.
  - `layoutFor(s) === layoutFor(s)`, the same object.
- [ ] **Step 2: Run** `pnpm vitest run games/treasure-hunt`. Expect FAIL.
- [ ] **Step 3: Implement.**
  - The view passes `layoutFor(game.seed)` to `bridge.setSession`.
  - Keep the `layout` field name inside `SessionConfig`.
- [ ] **Step 4: Run** the vitest suite and typecheck. Expect PASS.
- [ ] **Step 5: Commit** "Treasure Hunt: send the seed, not the map".

### Task 2: Teams and the teams phase

**Files:**
- Create: `shared/teams.ts`
- Modify: `shared/types.ts`, `server/game.ts`, `test/game.test.ts`
- Test: `test/teams.test.ts`

**Interfaces:**
- Produces:
  - **Colours.** `TEAM_COLORS` copied from `games/blind-rally/shared/types.ts:126` (all 8, same order, key/name/hex/shape), plus `teamColor(key)`.
  - **Phase.** `Phase = "teams" | "countdown" | "hunting" | "finished"`. `"generating"` is gone.
  - **Types.**
    - `THTeam { id: number; color: TeamColorKey }`
    - `THPlayer` gains `teamId: number | null`
    - `THPublic.teams: (THTeam & { foundCount: number; poolSize: number })[]`
  - **Actions.**
    - `{type:"team.join", teamId: number}`
    - `{type:"team.new"}`
    - `{type:"team.assign", playerId, teamId}` (host only)
    - `{type:"start"}` (host only)
  - **Settings.** `THSettings { mode: "timed" | "race"; minutes: THMinutes; target: number }`. The default is `{mode:"timed", minutes:30, target:5}`. `parseTHSettings` accepts a missing `mode` or `target` as the default.
  - **Carry.** `carryOver(state) → { teams: { color: TeamColorKey; members: string[] }[] }`.

**Rules:**
- **createGame.**
  - With a carry, players go back to their carried teams. New players each get a new team.
  - Without a carry, every player gets their own team, coloured in `TEAM_COLORS` order.
- **Team changes.**
  - `team.new` fails with `"too-many-teams"` / "There are already 8 teams." when 8 teams are in use.
  - A team with no members is deleted. Its colour is free again.
  - Team actions only work in `teams`.
  - `ready` works as in M2 but never starts the round.
- **start.** Host only.
  - Needs at least one ready player; otherwise `"nobody-ready"` / "Wait until someone has loaded the map."
  - Players who aren't ready become spectators.
  - Teams left with no hunters take no part in the round.
  - Then the countdown begins.
- **Removed.** `READY_TIMER` and its re-arm logic. The host decides when to start.
- **Awaited players.** `getAwaitedPlayerIds` lists players who aren't ready, during `teams`.

- [ ] **Step 1: Write the failing tests** in `test/teams.test.ts`:
  - `solo game: one team, start → countdown`
  - `team.join moves a player and deletes an empty team`
  - `ninth team is refused`
  - `only the host can start or assign`
  - `host leaves in teams phase: the new ctx.hostId can start` (Review Focus 5)
  - `carry puts players back on their teams; a newcomer gets a new team`
  - `not-ready players become spectators on start`
- [ ] **Step 2: Run** the vitest suite. Expect FAIL.
- [ ] **Step 3: Implement** in `server/game.ts` and `shared/teams.ts`. Update the M2 tests that relied on auto-start: they now send `start`. Rename `"generating"` to `"teams"` in `client/view.ts` and `client/hud.ts` so typecheck stays green. Godot needs no change, since it locks on anything but `hunting`.
- [ ] **Step 4: Run** the vitest suite and typecheck. Expect PASS.
- [ ] **Step 5: Commit** "Treasure Hunt: pick teams before the hunt".

### Task 3: Timed mode by team

**Files:** Modify `server/game.ts` and `shared/types.ts`. Test: `test/claim.test.ts` and `test/team-timed.test.ts`.

**Interfaces:**
- Produces:
  - `THPrivate { teamId: number | null; clues: { id; clues; difficulty; found: boolean; taken: boolean }[]; revealed: {id,x,z,dy}[]; pins: Pin[] }`. `pins` stays empty until Task 7, and `taken` is always false in Timed.
  - Server teams hold `pool: string[]`, `found: string[]`, `revealed: string[]` and `lastClaimAt`. These move from player to team.

**Rules:**
- **Pools.** `dealPools(caches, teamIds)` deals per team at start.
- **Claims and reveals.**
  - Any hunter on the team can claim.
  - A reveal relays to every connected member of the team, and is recorded on the team.
  - The claim checks are M2's, in M2's order, with `not-yours` meaning "not on your team's list".
- **End.**
  - The round ends when every team in play has cleared its pool, or on the timer, or when the host ends it.
- **Result.**
  - Teams are ranked by found, then difficulty, then last claim.
  - `winnerIds` is every member of the top team. The headline is `"Team ${name} wins"`, or `"Nobody found a cache."`.
  - Each player's standings row is their team's count, labelled `"${n} found · ${teamName}"`.

- [ ] **Step 1: Write the failing tests:**
  - `a teammate's reveal reaches the whole team`
  - `either teammate can claim; foundCount is the team's`
  - `two teams get pools of the same size and difficulty total within 1`
  - `team win headline and winnerIds`
- [ ] **Step 2: Run** the vitest suite. Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the vitest suite and typecheck. Expect PASS.
- [ ] **Step 5: Commit** "Treasure Hunt: Timed mode for teams".

### Task 4: Race to N

**Files:** Modify `server/game.ts`. Test: `test/race.test.ts`.

**Rules:**
- **Release order.** Every cache, in a seeded shuffle: `rng(layout.seed ^ 0x52414345)` with a Fisher–Yates shuffle, so it's deterministic.
- **Open caches.** The first `min(RACE_OPEN_START + totalClaims, caches.length)` are open. Every team's private `clues` lists exactly the open caches:
  - `found` when this team claimed it.
  - `taken` when another team did.
- **Reveals.** Any hunter within `REVEAL_RADIUS` of an open, unclaimed cache reveals it to their own team.
- **Claims.**
  - A claim on a cache that isn't open fails with `"not-yours"`.
  - A claim on one another team has claimed fails with `"taken"` / "Another team found this cache first."
- **End.**
  - The first team to `target` claims wins, and the round finishes at once.
  - The `minutes` timer still caps the round. At the cap, the ranking is the same as Timed.
  - The round also ends if every cache is claimed.

- [ ] **Step 1: Write the failing tests:**
  - `3 open at start, 4 after the first claim, same list for every team`
  - `second team's claim on a taken cache is refused` (Review Focus 4)
  - `first team to target wins at once`
  - `release order is the same for the same seed`
- [ ] **Step 2: Run** the vitest suite. Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the vitest suite and typecheck. Expect PASS.
- [ ] **Step 5: Commit** "Treasure Hunt: Race to N".

### Task 5: Position stream v2 and the route log

**Files:** Modify `server/game.ts`, `shared/types.ts` and `shared/world.ts`. Test: `test/stream.test.ts`.

**Interfaces:**
- Produces:
  - **Stream in.** `THStreamIn = { t:"pos"; x; y; z; yaw: number; foot: boolean; v: string | null }`. `yaw` is radians, Godot style. `v` is the id of the vehicle you sit in.
  - **Relay.** The parsed snapshot, rounded to 0.01, goes in `relay` to every other seated player. The client receives `(from, data)`.
  - **Replay.**
    ```ts
    THReplay {
      durationS: number;
      tracks: { playerId: string; teamId: number; points: [number, number, number][] }[]; // [s since start, x, z], ints
      finds: { cacheId: string; teamId: number; playerId: string; t: number; x: number; z: number }[];
    }
    ```
  - **Public state.** `THPublic.replay: THReplay | null`, set only in `finished`.

**Rules:**
- **Speed check.** It uses the new `POS_HZ`.
- **Route points.** A point is appended when `now - lastPointAt ≥ TRACK_MIN_MS` and the player has moved at least `TRACK_MIN_M` since the last point, capped at `TRACK_CAP`. That snapshot returns `persist: true` (§9: about once a second). Every other snapshot returns `persist: false` with a `relay`.
- **Finds.** Each claim adds a find.
- **Spectators.** Their snapshots are dropped, with no relay. Only hunters are drawn.
- **Old clients.** A missing `yaw` reads as 0 and a missing `v` as null, because Godot sends the M2 shape until Task 8. A wrong type (a string yaw, a numeric v) drops the snapshot.

- [ ] **Step 1: Write the failing tests:**
  - `snapshot relays to everyone else, persist false`
  - `a route point at most once a second and only after 5 m; that step persists`
  - `route capped at 2000`
  - `replay is null until finished, then holds routes and finds`
  - `missing yaw/v default to 0/null; wrong types are dropped`
- [ ] **Step 2: Run** the vitest suite. Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the vitest suite and typecheck. Expect PASS.
- [ ] **Step 5: Commit** "Treasure Hunt: stream positions to everyone".

### Task 6: Buggies and seats (server)

**Files:**
- Create: `shared/buggies.ts`
- Modify: `server/game.ts`, `shared/types.ts`
- Test: `test/buggies.test.ts`, `test/seats.test.ts`

**Interfaces:**
- Produces:
  - **Slots.** `buggySlots(layout): { id: string; x: number; z: number; yaw: number }[]`:
    - Team slots `"t0".."t7"`: the 8 flattest of 16 candidates on a ring 8 m from spawn, all facing the spawn yaw.
    - Loose slots `"l0".."l2"`: at pieces picked with `rng(layout.seed ^ 0x42554747)`, `padR + 5` m from each piece centre on the side towards the spawn.
  - **Vehicle.** `Vehicle { id; x; y: number | null; z; yaw; driver: string | null; passenger: string | null }`, with `THPublic.vehicles: Vehicle[]`. At start there's one team slot per team in play, plus every loose slot. `y` is null until somebody drives it.
  - **Actions.**
    - `{type:"seat", vehicleId, seat: "driver" | "passenger"}`
    - `{type:"unseat", x, y, z, yaw}`

**Rules:**
- **Seating.** Allowed in `hunting` only, for non-spectator hunters. Errors, in this order:
  - `"no-position"`
  - `"in-vehicle"` / "Get out first." (you're already seated)
  - `"too-far-seat"` / "Go closer to the buggy." (`> SEAT_RANGE` in XZ)
  - `"seat-taken"` / "Someone is already in that seat."
- **Driving.** While you're the driver, each snapshot with `v === id` updates the vehicle pose in memory.
- **Getting out.** `unseat` frees your seat. When you were the driver, the pose becomes the sent one, clamped to within 5 m of the last streamed pose.
- **Leaving.** A removed player's seats free. A driver's buggy keeps its last streamed pose.

- [ ] **Step 1: Write the failing tests:**
  - `slots are deterministic, on land, and team slots are ≥ 4 m apart` (over 200 fixture seeds)
  - `second driver on the same seat gets seat-taken` (Review Focus 1)
  - `too far is refused`
  - `driver stream moves the buggy; passenger stream doesn't`
  - `driver leaves: seat frees, pose is the last streamed, passenger stays` (Review Focus 2)
  - `unseat pose clamped to 5 m`
- [ ] **Step 2: Run** the vitest suite. Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the vitest suite and typecheck. Expect PASS.
- [ ] **Step 5: Commit** "Treasure Hunt: shared buggies with two seats".

### Task 7: Pins (server)

**Files:** Modify `server/game.ts` and `shared/types.ts`. Test: `test/pins.test.ts`.

**Interfaces:**
- Produces:
  - `Pin { id: string; by: string; x: number; z: number }`, rounded to 0.1. Ids come from a `"q${n}"` counter on the state.
  - Actions `{type:"pin", x, z}` and `{type:"unpin", pinId}`.
  - `THPrivate.pins` holds your team's pins, oldest first.

**Rules:**
- **When and who.** Pins work in `countdown` and `hunting`, for hunters only.
- **Position.** Positions must lie within ±950.
- **Cap.** A 6th live pin removes your own oldest.
- **Removing.** Only the pin's owner can unpin, else `"not-your-pin"`.
- **Privacy.** Another team's pins never appear in your private state.

- [ ] **Step 1: Write the failing tests:**
  - `pin shows to teammates, not to the other team`
  - `sixth pin drops the oldest`
  - `only the owner unpins`
  - `out of bounds is refused`
- [ ] **Step 2: Run** the vitest suite. Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the vitest suite and typecheck. Expect PASS.
- [ ] **Step 5: Commit** "Treasure Hunt: team pins".

### Task 8: Godot remote players, plus bridge v3 plumbing

**Files:**
- Create: `godot/scripts/net/remotes.gd` (`class_name Remotes`)
- Modify: `godot/scripts/web_bridge.gd`, `godot/scripts/main.gd`, `client/godot/bridge.ts`, `client/view.ts`
- Test: `godot/tests/remote_tests.gd` (register it in `run_tests.gd`), `test/session.test.ts`

**Interfaces:**
- **TS → Godot.** Both calls are idempotent and full-list where a list is sent:
  - `roster({me, players: [{id, name, color: "#rrggbb", team}]})`
  - `remotePos({id, x, y, z, yaw, foot, v})`
- **Godot → TS.** `emitPos` adds `yaw` and `v` (null on foot).
- **Remotes.**
  - `upsert(id, snap: Dictionary, now_s: float)`
  - `set_roster(list)`
  - `_process` interpolates over 100 ms.
  - Each player is a capsule (radius 0.35, height 1.8, no collider) with the team colour as albedo.
  - The name is a `Label3D` billboard with `visibility_range_end = NAME_RANGE` (50).
  - A player is hidden when `v != null`, since their buggy draws them, and removed after 5 s without a snapshot.
- **View.** `stream(from, data)` sends `{t:"pos"}` from others to `remotePos` with `id = from`. Reveals still go to `GodotFeed`.

- [ ] **Step 1: Write the failing tests:**
  - Godot `remote_tests.gd`:
    - `upsert twice → one capsule, tinted`
    - `stale 5 s → removed`
    - `v set → hidden`
    - `name label range is 50`
  - TS: `pos relay from another player becomes a remotePos call`.
- [ ] **Step 2: Run** both suites. Expect FAIL.
- [ ] **Step 3: Implement.** Use headless seams `receive_roster_json` and `receive_remote_json` in `web_bridge.gd`, like M2's.
- [ ] **Step 4: Run** both suites and typecheck. Expect PASS.
- [ ] **Step 5: Commit** "Treasure Hunt: see the other players".

### Task 9: Godot shared buggies, seats and the passenger

**Files:**
- Create: `godot/scripts/vehicle/fleet.gd` (`class_name Fleet`)
- Modify: `godot/scripts/vehicle/buggy.gd`, `godot/scripts/player/avatar.gd`, `godot/scripts/main.gd`, `godot/scripts/web_bridge.gd`, `client/godot/bridge.ts`, `client/view.ts`
- Test: `godot/tests/fleet_tests.gd`, `test/session.test.ts`

**Interfaces:**
- **TS → Godot.** `vehicles({me, list: Vehicle[]})`, full list, idempotent.
- **Godot → TS.**
  - `emitSeat({vehicleId, seat})`
  - `emitUnseat({x, y, z, yaw})`
- **Fleet.** Holds one `Buggy` per vehicle id, at `buggySlots` poses. Godot gets the slots from `vehicles`, not by recomputing them.
- **Buggy modes:**
  - `&"local"`: I drive. Physics as in M2.
  - `&"puppet"`: someone else drives. No collider. It follows `remotePos` snapshots with `v == id` over 100 ms, and pitch and roll come from `field.height_at` at the four wheel corners.
  - `&"parked"`: a collider and no input. It sits at the vehicle's pose, with `y` from the highest corner (as `buggy_spawn`) when null.
- **Avatar:**
  - **E near a buggy.** Asks for the driver seat if it's free, else the passenger seat, else does nothing, via `emitSeat`. It doesn't move until a `vehicles` list names `me` in that seat. Then it enters as driver (M2 behaviour), or as passenger: snapped to `SEAT + Vector3(0.9, 0, 0)`, free-look camera, no driving input.
  - **E while seated.** Gets out locally (M2's exit spot) and sends `emitUnseat` with the buggy's pose.
  - **Without a bridge connection** (headless or standalone), E enters directly, as in M2, so the old tests keep working.
- **Startup.** `main.gd` drops the single `$Buggy` scene node for `Fleet`. Until the first `vehicles` call, the fleet holds one local buggy at the old `buggy_spawn`, which keeps M1/M2 standalone play.
- **TS.** `GodotFeed.sync()` also sends `roster`, `vehicles` and (from Task 10) `pins`. That's Review Focus 3.

- [ ] **Step 1: Write the failing tests:**
  - Godot `fleet_tests.gd`:
    - `E asks, doesn't enter until confirmed` (Review Focus 1)
    - `confirm as driver → local mode`
    - `someone else drives → puppet, no collider`
    - `passenger snaps to the seat and follows the puppet`
    - `exit sends unseat with the pose`
    - `parked y from the highest corner`
  - TS: `GodotFeed: a second ready() re-sends roster, vehicles and reveals` (Review Focus 3).
- [ ] **Step 2: Run** both suites. Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** both suites and typecheck. Expect PASS.
- [ ] **Step 5: Commit** "Treasure Hunt: drive together".

### Task 10: Godot pins

**Files:**
- Create: `godot/scripts/hunt/pins.gd` (`class_name Pins`)
- Modify: `web_bridge.gd`, `main.gd`, `client/godot/bridge.ts`, `client/view.ts`
- Test: `godot/tests/pin_tests.gd`, `test/session.test.ts`

**Interfaces:**
- **TS → Godot.** `pins({list: [{id, x, z, color, mine}]})`, full list.
- **Godot → TS.** `emitPin({x, z})`.
- **The beacon.** An unshaded cylinder, radius 0.3 m and 40 m tall, in the team colour, standing on `field.height_at`.
- **P key.** Ray-marches from the camera along its forward vector in 2 m steps against `field.height_at`, up to 600 m. On a hit it emits `emitPin`. With no hit it does nothing.
- **View.** Turns `emitPin` into `act({type:"pin", x, z})`. Rejections go through the toast copy table: `"not-your-pin"` → "You can only remove your own pins."

- [ ] **Step 1: Write the failing tests:**
  - Godot:
    - `pins list builds beacons and replaces on a new list`
    - `ray hits the ground ahead`
    - `ray into the sky emits nothing`
  - TS: `emitPin becomes a pin action`.
- [ ] **Step 2: Run** both suites. Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** both suites. Expect PASS.
- [ ] **Step 5: Commit** "Treasure Hunt: drop pins for your team".

### Task 11: Teams lobby in the view, settings, rules and docs

**Files:**
- Create: `client/teams.ts`
- Modify: `client/view.ts`, `client/hud.ts`, `client/styles.css`, `shared/rules-text.ts`, `docs/games/treasure-hunt.md`, `shared/manifest.ts` (only if the blurb needs it)
- Test: `test/teams-view.test.ts`

**Rules:**
- **The teams panel.** In `teams`, a panel sits over the loading stage. Godot keeps loading behind it.
  - **Rows.** One row per team: colour swatch, shape, team name and members. Each member shows "loading" or "ready".
  - **Buttons.** "Join" on the other teams, and "New team".
  - **Host extras.**
    - A per-player select to move them to another team.
    - A "Start" button. It's disabled until at least one player is ready, with the text "Waiting for the map to load."
  - **Non-hosts** see "The host will start the game."
- **The HUD.**
  - **Score.** Shows the team's score: `"${found} of ${pool} found"` in Timed, `"${found} of ${target}"` in Race.
  - **Clue board.** Taken clues are struck through and greyed, marked "Taken".
- **Settings fields.**
  - Mode: Timed / Race.
  - Round length.
  - "Caches to win" (3–10). Shown only when the mode is Race.
- **Rules and docs.** Rewrite them for teams, Race, seats, pins (P key, map click), the minimap and the M key, in plain simple English.

- [ ] **Step 1: Write the failing tests** for the pure helpers:
  - `teamRows(pub, names, me)`
  - `canStart(pub)`
  - `raceScoreText`
  - `settingFields hides target in Timed`
- [ ] **Step 2: Run** the vitest suite. Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the vitest suite and typecheck. Expect PASS.
- [ ] **Step 5: Commit** "Treasure Hunt: team lobby".

### Task 12: The map: minimap, full map, pins by click

**Files:**
- Create: `client/map/map-canvas.ts`, `client/map/overlays.ts`
- Modify: `client/view.ts`, `client/styles.css`
- Test: `test/map.test.ts`

**Interfaces:**
- **`MapCanvas`.** `new MapCanvas(layout)` paints the base once to an offscreen 1024² canvas:
  - macro height shading
  - sea in blue below 0
  - trails
  - each piece as a dot with its label word
- **`draw()`.** `draw(ctx, view: { cx; cz; metresAcross; w; h }, overlays: Overlay[])`.
- **Coordinates.** `worldToMap` and `mapToWorld`, both pure.
- **`visibleDots(me, others, teamOf)`.** Teammates always; other teams only within `DOT_RANGE`.

**Rules:**
- **Minimap.**
  - 180 px, north-up, 300 m across, centred on your last emitted position.
  - Shows team-coloured dots, your arrow by yaw, and your team's pins.
- **The M key.** It toggles the full map: the whole island, with the same overlays. `releasePointer()` runs on open. The key is caught by a `keydown` listener on the iframe's `contentWindow` and on `document`.
- **Clicks on the full map.**
  - A click drops a pin with `act({type:"pin"})`.
  - A click within 12 px of your own pin removes it.
  - Esc or M closes the map.

- [ ] **Step 1: Write the failing tests:**
  - `worldToMap ∘ mapToWorld is identity`
  - `visibleDots hides a far other-team player and keeps a far teammate`
  - `click near own pin → unpin, elsewhere → pin`
- [ ] **Step 2: Run** the vitest suite. Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the vitest suite and typecheck. Expect PASS.
- [ ] **Step 5: Commit** "Treasure Hunt: a map with pins".

### Task 13: Replay screen and export

**Files:**
- Create: `client/replay.ts`
- Modify: `client/view.ts`, `client/styles.css`, `client/godot/godot-build.json` (from the export)
- Test: `test/replay.test.ts`

**Rules:**
- **Where.** In `finished` with `replay` set, the view shows a `MapCanvas` of the whole island under the shell's result card, where the Godot stage was.
- **What it draws.**
  - Each route as a team-coloured line up to slider time `t`.
  - Each find at or before `t` as a team-coloured ring with a tick.
  - A legend of team names.
- **Controls.**
  - A range slider from 0 to `durationS`.
  - A Play/Pause button that plays at 60× (a 30-minute round in 30 s).
- **Export.** Run `node games/treasure-hunt/scripts/export-godot.mjs` and commit the new `godot-build.json`.

- [ ] **Step 1: Write the failing tests:**
  - `routeUpTo(points, t)` cuts a route at `t` and interpolates the last segment.
  - `findsUpTo(finds, t)`.
  - `formatClock(s)` gives `"12:05"`.
- [ ] **Step 2: Run** the vitest suite. Expect FAIL.
- [ ] **Step 3: Implement.** Then export.
- [ ] **Step 4: Run** all three suites and typecheck. Expect PASS.
- [ ] **Step 5: Commit** "Treasure Hunt: replay the round on a map".

### Task 14: Two-tab browser check (controller)

Not dispatched. The controller runs it on `pnpm dev`, with two browser tabs as two players:
- Form two teams, then start.
- Each side sees the other's capsule and name.
- One drives while the other rides as passenger.
- A pin shows only for its own team.
- Race to 3 ends at the third claim. Use the seed trick from M2's Task 9 to put a player on a cache.
- The replay shows both routes and the finds.
