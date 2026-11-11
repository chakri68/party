# Treasure Hunt M5a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish part one: a "same map again" rematch, the hot/cold signal, and sound built in code.

**Architecture:**
- **Same map:** the seed rides `carryOver` into the next `createGame`, and a lobby setting picks whether to use it.
- **Hot/cold:** the server owns the signal. It turns each team member's streamed position into one of 4 levels and relays only that level, only to that player. The page shows a meter, and Godot beeps.
- **Sound:** all synthesised once at load into short looping `AudioStreamWAV`s, the way Blind Rally's `car_audio.gd` does it. Per frame only pitch and volume move. The page's sound settings reach Godot over the bridge.

**Tech Stack:** TypeScript (shared/server/client, vitest), Godot 4.7.2 GDScript (headless tests), the room platform's `carryOver` and `SettingField`.

**Spec:** `treasure-hunt-spec.md` (repo root): §12 M5, §6.2 Hot/cold row, §11 (`car_audio.gd` reuse). M5 was split by the user on 2026-11-11: the character pack and seat offsets move to M5b, once a pack zip lands.

## Global Constraints

- Commit straight to master and push after each commit. Stage only your own files, never `git add -A`. Root spec .md files and `kenney_*.zip` are never committed.
- End every commit message with `Claude-Session: https://claude.ai/code/session_01KwNUn9dpkZKSPFkAmAoz5c`.
- Commit style: a `Treasure Hunt: …` subject, then a body of plain sentences on what changed and why.
- On-site copy is short, plain Indian English: simple words, no idioms.
- Never run `pnpm build`.
- Hot/cold (§6.2): "No text. A signal that gets stronger as you get closer." Distance quantised to **4 levels**, so it can't be triangulated. **One per team per round**, as late-round help.
- Sound is quiet on purpose (Rally's MAX_DB −8). Nothing plays before the first user gesture. Muting on the page mutes Godot.
- Commands:
  - Godot tests: `timeout 300 ~/.local/bin/godot --headless --path games/treasure-hunt/godot --fixed-fps 60 --script res://tests/run_tests.gd`
  - vitest: `pnpm vitest run games/treasure-hunt`
  - typecheck: `pnpm typecheck`
  - web export: `node games/treasure-hunt/scripts/export-godot.mjs`. Commit only `client/godot/godot-build.json` from it.

## Rulings

- **A. "Replay this seed" is a same-room rematch, not a URL.** The platform has no way to put settings in a link, and game views can't send `update-settings`. A cross-room link needs platform work (room URL params or a text setting), so it's out of M5a. The lobby gets a **Map** setting: "New map" / "Same map again". The replay shows the map number so people can talk about it.
- **B. Hot/cold unlocks late and lasts a while.**
  - Timed: it unlocks at half the round. Race: 10 minutes after the hunt starts.
  - A team member picks one unfound cache on the board. Every member of that team then gets their own level for `HOTCOLD_MS` = 180 000 ms, or until that cache is found or taken.
  - Bands: level 3 under 50 m, 2 under 150 m, 1 under 300 m, 0 beyond.
- **C. Sounds in M5a:**
  - buggy engine and gravel;
  - footsteps;
  - an ambient bed (wind always; birds by day, crickets by night, crossfaded on `dark`);
  - a reveal ping, a claim chime, and the hot/cold beep.
  - No music.

## Review Focus

1. **Another team never learns a level.** It's never relayed to another team, never during a jump's grace, and never for a cache not on the team's board. Test in Task 2.
2. **A signal ends cleanly.** That holds when its cache is claimed, by this team or (Race) another, or when its time runs out. Clients see it end via private state, without needing one more stream message. Test in Task 2.
3. **Reloading mid-signal.** The meter comes back with the current level from private state, not blank until the band changes. Tests in Tasks 2 and 3.
4. **"Same map again" with no usable carry falls back to a new map.** That covers a first round, an old room, a different game before, or a changed mode or time; it falls back silently and never throws. Test in Task 1.
5. **Muted page, or no gesture yet:** Godot stays silent, and a live unmute works without a reload. Test in Task 4.

---

### Task 1: Same map again

**Files:**
- Modify: `shared/types.ts` (THSettings, DEFAULT_SETTINGS, parseTHSettings, THCarry)
- Modify: `server/game.ts` (`createGame`, `carryOver`)
- Modify: `shared/rules-text.ts` (Map field, rule line)
- Modify: `client/replay.ts` (map number line)
- Test: `test/same-map.test.ts` (new), plus existing settings tests if they pin DEFAULT_SETTINGS

**Interfaces:**
- Produces: `THSettings.map: "new" | "same"` (default `"new"`); `THCarry.seed?: number`.

- [ ] **Step 1: Write the failing tests** in `test/same-map.test.ts`. Build games the way `test/team-timed.test.ts` does.
  - `parseTHSettings({map: "same"}).map === "same"`; `parseTHSettings({}).map === "new"`; `parseTHSettings({map: "x"}) === null`.
  - `carryOver(finishedState).seed === finishedState.layout.seed`.
  - With `map: "same"` and `match.carry = {teams: [...], seed: S}`: the new state has `layout.seed === S`, and the same cache ids and positions as a fresh `makeHunt(S, …)` with those settings.
  - With `map: "new"` and the same carry, the seed comes from `ctx.randomInt` (use a stub ctx returning a known value ≠ S).
  - Review Focus 4: `map: "same"` with `carry` undefined, with `{teams: []}` (no seed) and with `{seed: "x"}` all fall back to `ctx.randomInt` and don't throw.
  - `treasureHuntSettingFields({map: "same"}, 2)` has a field with key `"map"`, label `"Map"`, options labelled `"New map"` and `"Same map again"`, selected 1, and hint `"Uses the map from the last round. If there was none, you get a new map."`. With `map: "new"` the hint is `"A new map every round."`.
- [ ] **Step 2:** Run `pnpm vitest run games/treasure-hunt/test/same-map.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement.**
  - `createGame`: the seed is `parsed.map === "same" && Number.isInteger(carry?.seed) ? carry.seed : ctx.randomInt(2 ** 31)`. `THCarry.seed` is the finished `layout.seed`.
  - `startMinOf` keeps reading that seed, so "random" time repeats too.
  - Add the rule line `"Map: pick Same map again to play the last round's map one more time."` after the "Every round is a new map" line.
  - The replay title area shows `Map ${seed}` (class `th-replay-map`).
- [ ] **Step 4:** Run the file, then `pnpm vitest run games/treasure-hunt` and `pnpm typecheck`. All pass. Any fixture or settings test that pins DEFAULT_SETTINGS gains `map: "new"`.
- [ ] **Step 5:** Commit and push.

### Task 2: Hot/cold on the server

**Files:**
- Modify: `shared/world.ts` (constants), `shared/types.ts` (action, private state, relay type)
- Modify: `server/game.ts` (action handler, `parseAction`, `onStream`, `getPrivateState`, server team/player fields)
- Test: `test/hotcold.test.ts` (new)

**Interfaces:**
- Produces, in `shared/world.ts`:
  - `HOTCOLD_MS = 180_000`, `HOTCOLD_RACE_UNLOCK_MS = 600_000`, `HOTCOLD_BANDS = [50, 150, 300] as const`;
  - `hotColdLevel(dist: number): 0 | 1 | 2 | 3` (3 when under 50, … 0 at 300 and beyond).
- Produces, in `shared/types.ts`:
  - action `{ type: "hotcold"; cacheId: string }`;
  - relay `THHotCold = { t: "hotcold"; id: string; level: 0 | 1 | 2 | 3 }`;
  - `THPrivate.hotcold: { used: boolean; unlockAt: number | null; active: { id: string; until: number; level: 0 | 1 | 2 | 3 | null } | null }`. `unlockAt` is the server ms when it opens, null before hunting. `level` is this player's last relayed level, or null.
- Server team gains `hotcold: { id: string; until: number } | null` and `hotcoldUsed: boolean`; server player gains `hcLevel: 0|1|2|3|null`. Read all three with `?? null` / `?? false` for rooms saved before them.

- [ ] **Step 1: Write the failing tests** in `test/hotcold.test.ts`:
  - `hotColdLevel`: 0→3, 49.9→3, 50→2, 149→2, 150→1, 299→1, 300→0, 5000→0.
  - **Unlock:**
    - Timed, 30 min: an action at start + 14:59 is rejected with code `"hotcold-locked"`, and at start + 15:00 it's accepted.
    - Race: locked before 10:00, accepted after.
    - `unlockAt` in private state matches both.
  - **Rejects** (codes): `"hotcold-used"` on a second use by any member; `"no-such-cache"` for a cache not on the team's board; `"already-found"` for a found one; `"taken"` for one another team claimed (Race); `"wrong-phase"` outside hunting; spectators get `"spectator"`.
  - **Stream relays:**
    - After activation, a member's stream relays `{t:"hotcold", id, level}` to that member only (`relays[].to` is `[thatPlayer]`).
    - It relays only when the level changes: same band twice gives one relay, and crossing 150 m gives a new one.
    - Teammates each get their own level.
  - **Review Focus 1:** no other-team player ever appears in a hotcold relay's `to`. No hotcold relay goes out inside JUMP_GRACE_MS of a jump.
  - **Review Focus 2:**
    - After `until`, the stream relays nothing and private `active` is null.
    - After the target is claimed by the team, or by another team in Race, private `active` is null and no more relays go out.
    - `used` stays true in all three cases.
  - **Review Focus 3:** after a relay, `getPrivateState(s, player).hotcold.active.level` equals the last relayed level.
- [ ] **Step 2:** Run it. Expect FAIL.
- [ ] **Step 3: Implement.**
  - The action sets `team.hotcold = {id, until: now + HOTCOLD_MS}` and `hotcoldUsed = true`, resets every member's `hcLevel` to null, and persists (it's a game action).
  - In `onStream`, after the reveal loop: while the team's signal is live (`now < until` and the cache is unclaimed) and the player isn't jumping, compute the level from `hotColdLevel(Math.hypot(c.x − x, c.z − z))`. Relay it to `[playerId]` only when it differs from `hcLevel`, and store it.
  - The `hcLevel` change rides the in-memory state. Persist on a relay, as reveals do.
  - `getPrivateState` derives `active` as null once the signal has expired or its cache is claimed. There's no timer: derive it on read.
- [ ] **Step 4:** Run the file, then the whole treasure-hunt vitest and typecheck. All pass.
- [ ] **Step 5:** Commit and push.

### Task 3: Hot/cold on the page

**Files:**
- Modify: `client/hud.ts` (pure `hotColdView`, meter element, board button), `client/view.ts` (relay parse, button → `act`, level to Godot), `client/godot/bridge.ts` (`hotCold` fn), `client/styles.css`
- Modify: `shared/rules-text.ts` (rule line)
- Test: `test/hud.test.ts`, `test/session.test.ts` or `test/stream.test.ts` (whichever owns relay parsing today)

**Interfaces:**
- Consumes: Task 2's `THPrivate.hotcold`, `THHotCold`, action `hotcold`.
- Produces:
  - `hotColdView(priv: THPrivate | null, now: number, streamed: number | null): { meter: 0|1|2|3 | null; leftMs: number; canUse: boolean; opensInMs: number | null }`. `streamed` is the latest relayed level for the active id, which wins over `active.level`.
  - Bridge fn `hotCold({level})` with level −1..3, where −1 is off.

- [ ] **Step 1: Write the failing tests.**
  - `hotColdView`:
    - meter null when there's no active signal;
    - meter = `active.level` when `streamed` is null (Review Focus 3);
    - meter = `streamed` when set;
    - `canUse` false when used, locked or not hunting;
    - `opensInMs` = `unlockAt − now` while locked.
  - Relay parse accepts `{t:"hotcold", id:"c1", level:2}` and rejects level 4, level "2", or a missing id.
  - The view sends `{fn:"hotCold", arg:{level}}` when the meter changes, and `{level:-1}` when the signal ends.
- [ ] **Step 2:** Run the tests. Expect FAIL.
- [ ] **Step 3: Implement.**
  - **Meter:** 4 bars, filled up to the level, coloured from blue (0) to red (3). No words on it; `aria-label` is `"Hot or cold"`. Show it with a time-left ring or number while active.
  - **Board:** each unfound clue gets a button `"Hot or cold"` while `canUse`. While locked, one line above the board reads `"Hot or cold opens in M:SS."`.
  - **Rule line:** `"Once in a round, your team can use Hot or cold on one clue. For 3 minutes, a meter shows how close each of you is to that cache. It opens halfway through a timed round, or 10 minutes into a race."`
- [ ] **Step 4:** Run the tests, the whole treasure-hunt vitest, and typecheck. All pass.
- [ ] **Step 5:** Commit and push.

### Task 4: Sound engine, settings bridge, buggy and steps

**Files:**
- Create: `godot/scripts/audio/synth.gd` (pure loop builders: `class_name Synth`, static), `godot/scripts/audio/hunt_audio.gd` (`class_name HuntAudio`, a Node under main)
- Modify: `godot/scripts/web_bridge.gd` (inbound `sound`), `godot/scripts/main.gd` (create HuntAudio, first-gesture start, feed it the buggy, walker and dark), `client/godot/bridge.ts` + `client/view.ts` (send `sound`)
- Test: `godot/tests/audio_tests.gd` (new, registered in `run_tests.gd`), a bridge test in vitest

**Interfaces:**
- Produces:
  - Bridge in: `host.sound({muted: bool, volume: 0..1})`, with web_bridge signal `sound_set(muted: bool, volume: float)`.
  - `HuntAudio`:
    - `prepare()` builds every loop, silent;
    - `start()` runs on the first gesture;
    - `set_sound(muted: bool, volume: float)`;
    - `tick(dt: float, buggy_speed: float, driving: bool, walk_speed: float, on_floor: bool, dark: float)`;
    - `ping(kind: StringName)` with kind `&"reveal"`, `&"claim"` or `&"beep"`;
    - `set_hot_cold(level: int)` with level −1..3.
  - Pure statics on HuntAudio, for tests:
    - `step_interval(speed: float) -> float`: seconds between steps; INF below 0.5 m/s. Walking at 3 m/s gives 0.5 s, running at 6 m/s gives 0.33 s.
    - `ambient_mix(dark: float) -> Vector3`: wind, birds, crickets as linear 0..1. Birds fade out and crickets fade in between dark 0.3 and 0.7.
    - `beep_interval(level: int) -> float`: INF for −1; 2.0, 1.2, 0.6 and 0.25 s for levels 0–3.

- [ ] **Step 1: Write the failing tests** in `audio_tests.gd`:
  - **The three pure statics**, at the values above.
  - **Synth:** loops are `AudioStreamWAV` with `loop_mode` forward, 22050 Hz, and a length under 2 s. Same seed, same bytes.
  - **Review Focus 5:**
    - Before `start()`, after `prepare()`, no player is `playing`.
    - `set_sound(true, x)` mutes the master bus, and `set_sound(false, 0.5)` unmutes it with no reload.
    - `volume` maps to the bus level with `linear_to_db`.
  - **Bridge:** `receive_sound_json('{"muted":true,"volume":0.4}')` emits `sound_set(true, 0.4)`. Junk is dropped, and volume is clamped to 0..1.
  - **Page (vitest):** on start and whenever `audio.settings.sound` or `.volume` changes, checked once a second, the view sends `{fn:"sound", arg:{muted: !sound, volume}}`.
- [ ] **Step 2:** Run both suites. Expect FAIL.
- [ ] **Step 3: Implement.**
  - **Engine and gravel:** copy the synthesis approach from `games/blind-rally/godot/scripts/car_audio.gd`, not the file. That covers the period, harmonics and grit loop, the noise loops, `_drive` for volume, and `SILENT_DB` stops.
    - Pitch rides `abs(buggy_speed) / buggy.max_speed`. Gravel rides speed while driving.
    - Use a lower engine: a `PERIOD` of 480 (about 46 Hz), because the buggy is slow and big-tyred.
  - **Steps:** a short noise burst, played on `step_interval` while `on_floor`.
  - **Ambient:**
    - wind is filtered noise;
    - birds are chirp loops (short sine sweeps);
    - crickets are pulsed high sine.
  - Everything is on its own bus under Master (name it `"Hunt"`), and MAX_DB −8.
  - Main calls `prepare()` behind the loader, `start()` on the first key or mouse press, and `tick()` every frame.
  - Spectators hear the ambient only.
- [ ] **Step 4:** Run both suites and typecheck. All pass.
- [ ] **Step 5:** Commit and push.

### Task 5: Event sounds and the hot/cold beep

**Files:**
- Modify: `godot/scripts/audio/hunt_audio.gd`, `godot/scripts/audio/synth.gd`, `godot/scripts/web_bridge.gd` (inbound `hotCold`), `godot/scripts/main.gd` (wire reveal, claim and hot/cold)
- Test: `godot/tests/audio_tests.gd`

**Interfaces:**
- Consumes: Task 3's bridge `hotCold({level})`, Task 4's `HuntAudio`.
- Produces: web_bridge signal `hot_cold_set(level: int)` from `receive_hot_cold_json`.

- [ ] **Step 1: Write the failing tests.**
  - `receive_hot_cold_json('{"level":2}')` emits 2. Levels outside −1..3 or non-numbers are dropped.
  - After `set_hot_cold(3)` and ticking 1.0 s, the beep has played 4 times (0.25 s interval), counted through a `beeped` signal on HuntAudio.
  - After `set_hot_cold(-1)`, ticking 5 s plays none.
  - `cache_revealed` makes main call `ping(&"reveal")` once per new id, and a second reveal of the same id is silent. `cache_found` for my team calls `ping(&"claim")`. Count both via signals.
- [ ] **Step 2:** Run it. Expect FAIL.
- [ ] **Step 3: Implement.**
  - The reveal ping is a rising two-note sine.
  - The claim chime is a three-note major arpeggio.
  - The beep is a short 880 Hz sine whose pitch rises a semitone per level.
  - All three are one-shot `AudioStreamWAV`s built in `prepare()`.
- [ ] **Step 4:** Run the Godot suite. All pass.
- [ ] **Step 5:** Commit and push.

### Task 6: Export and browser check

**Files:**
- Modify: `client/godot/godot-build.json` (from the export)

- [ ] **Step 1:** Run the export and commit `godot-build.json`.
- [ ] **Step 2:** Restart `pnpm dev`, because a long-running Vite can serve stale shared modules. Then do a two-tab browser check in one room, Timed 15 minutes:
  - **Lobby:** the Map setting shows, with its hint.
  - **Hot/cold:** while locked, the board line counts down. To get past the 7:30 unlock without waiting, use a short round, or check in Race after 10 minutes, or stub the clock in tests and only check the UI states live.
  - **After unlock:** pressing "Hot or cold" on a clue shows the meter. Walking the host toward the cache with `emitPos` makes the meter climb 0→3, and the second tab (other team) gets no level.
  - **After the round:** "Same map again" then Start builds the same map (same `world-ready` seed), and the replay shows `Map <seed>`.
  - **Sound:** after a click, the ambient plays. Muting in the room's sound settings silences Godot within a second, and unmuting brings it back.
  - No console errors.
- [ ] **Step 3:** Log the results in the ledger. Fix anything found in the same task.
