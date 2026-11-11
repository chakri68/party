# Treasure Hunt M5b Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real characters in place of capsules. Each player picks one of 8 Kenney Mini Characters in the teams panel; it wears the team colour, animates, and sits properly in a buggy.

**Architecture:**
- **One Godot `CharacterModel` node** wraps an instanced GLB. It tints the shirt swatch with a small shader, and maps a few named states to the pack's shared animations.
- **The server owns each player's pick.** It's public state that rides the roster to Godot.
- **Seated players are placed from the vehicles list,** at the driver or passenger seat, so two people in one buggy no longer overlap.

**Tech Stack:** Godot 4.7.2 (GLB import, AnimationPlayer, a spatial shader), TypeScript (shared, server and client; vitest).

**Spec:** `treasure-hunt-spec.md` §7.5 (characters), §7.3 (seats), §13.5. M3's memory parked "seat offsets with the character pack" here.

## Global Constraints

- Commit straight to master and push after each commit. Stage only your own files, never `git add -A`. Root spec .md files and `kenney_*.zip` are never committed. No attribution or session lines in commits.
- Commit style: a `Treasure Hunt: …` subject, then a body of plain sentences on what changed and why.
- On-site copy is short, plain Indian English.
- Never run `pnpm build`.
- §7.5: "a preset list of male and female characters (about 4 of each) from one animated pack, so they all share the same rig and animations. The team colour tints the clothing material. Player names float above heads within 50 m."
- §13.3: no player collisions, ever. Models are visual only. The walker keeps its collision capsule.
- Assets: Kenney Mini Characters (CC0) from `kenney_mini-characters.zip` in the repo root. Copy only what's used into `godot/assets/kenney_mini-characters/`, and add a LICENSES.md entry.
- Commands:
  - Godot tests: `timeout 300 ~/.local/bin/godot --headless --path games/treasure-hunt/godot --fixed-fps 60 --script res://tests/run_tests.gd`. Run `--import` once after adding assets.
  - vitest: `pnpm vitest run games/treasure-hunt`
  - typecheck: `pnpm typecheck`
  - export: `node games/treasure-hunt/scripts/export-godot.mjs`. Commit only `client/godot/godot-build.json` from it.

## Rulings

- **A. The 8 characters are `female-a`…`female-d` and `male-a`…`male-d`,** in that order. UI labels are "Woman 1"–"Woman 4" and "Man 1"–"Man 4". The pack's other characters (knight, robot, zombie, and so on) stay out.
- **B. The default pick is `CHARACTERS[stableHash(playerId) % 8]`,** so a player who never picks still gets a stable look. A pick carries over to the rematch through `carryOver`.
- **C. Picking is allowed in the teams phase only,** as the spec's "in the lobby" means here. The teams panel is where players gather before a round.
- **D. Shirt tint is found automatically, not from a table.**
  - At load, take the body mesh's vertices whose strongest bone weight is on `torso`. Their UVs give the most common colormap cell (16×4 grid, 32 px cells): that is the shirt cell. Sleeves share it.
  - A shader on `body-mesh` recolours only texels in that cell to the team colour, and keeps the swatch's light-to-dark gradient.
- **E. Animations map from states:**
  - idle, walk (0.5–4.5 m/s), sprint (over 4.5 m/s);
  - jump (rising and airborne), fall (falling and airborne);
  - drive for the driver, sit for the passenger;
  - pick-up for 0.6 s after my own claim, and when a remote teammate's claim lands.
- **F. Model height is 1.7 m,** scaled from the GLB's AABB at load. Name tags sit 0.4 m above the head.
- **G. Remotes beyond 150 m stop animating.** The AnimationPlayer is paused, and the pose holds. This caps the cost of 7 skeletons in a browser.

## Review Focus

1. **An unknown or missing character id** never crashes and falls back to the default. That covers saved rooms, a bad action, and a roster from an older page. Tests in Tasks 2 and 1.
2. **A player switches team after picking.** Their model recolours to the new team at once, for me and for everyone else, with no rebuild glitch. Test in Task 4.
3. **A remote changes character in the teams phase.** Their model swaps in place: one model, not two. Test in Task 4.
4. **A seated remote whose buggy isn't in the fleet yet.** That happens when the vehicles list lags the pos relay. It falls back to the relayed position and doesn't crash. Test in Task 5.
5. **Distant remotes stop animating, and resume** when they come back within 150 m. Test in Task 4.

---

### Task 1: Assets and `CharacterModel`

**Files:**
- Create: `godot/assets/kenney_mini-characters/` (the 8 GLBs, `Textures/colormap.png`, `License.txt`), `godot/scripts/player/character_model.gd`, `godot/shaders/shirt_tint.gdshader`
- Modify: `godot/assets/LICENSES.md`
- Test: `godot/tests/character_tests.gd` (new; register in `run_tests.gd`)

**Interfaces:**
- Produces `class_name CharacterModel extends Node3D`:
  - `const IDS: Array[String] = ["female-a","female-b","female-c","female-d","male-a","male-b","male-c","male-d"]`
  - `const HEIGHT := 1.7`
  - `func setup(id: String, color: Color) -> void`: builds, or rebuilds if the id changed. An unknown id falls back to `IDS[0]`.
  - `func set_color(color: Color) -> void`: shader uniform only, no rebuild.
  - `func play(state: StringName) -> void`: one of `&"idle"`, `&"walk"`, `&"sprint"`, `&"jump"`, `&"fall"`, `&"drive"`, `&"sit"`, `&"pick-up"`. Crossfade 0.15 s; repeated calls are a no-op.
  - `func set_animating(on: bool) -> void`
  - `var id: String`, `var shirt_cell: Vector2i`
  - `static func shirt_cell_of(mesh: Mesh, skin: Skin, skeleton: Skeleton3D) -> Vector2i`
  - `static func state_for(speed: float, on_floor: bool, vy: float, seat: StringName) -> StringName`: seat is `&""`, `&"driver"` or `&"passenger"`.

- [ ] **Step 1: Write the failing tests** in `character_tests.gd`:
  - Every id in `IDS` loads. Each model has an AnimationPlayer with all of `idle, walk, sprint, jump, fall, drive, sit, pick-up`. Its AABB height after setup is within 0.05 of 1.7.
  - **Shirt cell:** `shirt_cell` is within the grid (x 0..15, y 0..3) and isn't a skin-tone cell: for `female-a` and `male-a`, assert it differs from the head mesh's most common cell.
  - **Colour:** `set_color(Color.RED)` changes the shader's `team_color` uniform and doesn't rebuild (same child node instance).
  - **Rebuild:** `setup("male-b", c)` after `setup("female-a", c)` leaves exactly one model child. `setup("nope", c)` gives `id == "female-a"` and no error (Review Focus 1).
  - **`state_for`:**
    - (0, true, 0, "") → idle; (3, true, 0, "") → walk; (6, true, 0, "") → sprint;
    - (3, false, 2, "") → jump; (3, false, -2, "") → fall;
    - (9, false, -2, "driver") → drive; (0, true, 0, "passenger") → sit.
  - **Playback:** `play(&"walk")` twice leaves the player on "walk" without restarting it (`current_animation_position` keeps advancing).
- [ ] **Step 2:** Run the Godot suite. Expect FAIL.
- [ ] **Step 3: Implement.**
  - Copy the 8 GLBs, the colormap and the License from the zip's `Models/GLB format/`. Run `--import`.
  - Shader: `uniform vec4 team_color; uniform ivec2 cell; uniform sampler2D albedo_tex;`.
    - Inside the cell, output `team_color.rgb * (lum(tex) / lum(cell_mid_texel))`, clamped.
    - Elsewhere, pass the texture through.
    - Apply it as `surface_override_material` on `body-mesh` only.
  - LICENSES.md gets a "Kenney Mini Characters (CC0)" entry listing the 8 files.
- [ ] **Step 4:** Run the Godot suite. All pass.
- [ ] **Step 5:** Commit and push.

### Task 2: Character choice on the server

**Files:**
- Create: `shared/characters.ts`
- Modify: `shared/types.ts` (THPlayer, THAction, THCarry), `shared/index.ts` (export), `server/game.ts` (createGame, parseAction, the action handler, getPublicState, carryOver)
- Test: `test/characters.test.ts` (new); update exact-equality pins in existing tests

**Interfaces:**
- Produces, in `shared/characters.ts`:
  - `CHARACTERS` (the 8 ids, `as const`) and `type CharacterId`;
  - `CHARACTER_LABELS: Record<CharacterId, string>`;
  - `isCharacterId(v: unknown): v is CharacterId`;
  - `defaultCharacter(playerId: string): CharacterId`, which uses the existing `stableHash` (find it in shared; don't add a second hash).
- `THPlayer.character: CharacterId`, which is public.
- Action `{ type: "character"; id: CharacterId }`.
- `THCarry.characters?: Record<string, CharacterId>`.

- [ ] **Step 1: Write the failing tests:**
  - **Default:** `defaultCharacter` is stable per id and always in `CHARACTERS`. Over 100 ids it uses at least 6 of the 8.
  - **Picking:**
    - createGame gives every player their default, or their carried pick when `match.carry.characters[id]` is a valid id.
    - An invalid carried value falls back to the default.
    - The action in the teams phase sets it, and it appears in public state.
    - In countdown or hunting it's rejected with `"wrong-phase"` and the message `"You can pick a character only before the round starts."`.
  - **Parsing:** `parseAction({type:"character", id:"robot"})` is null.
  - **Carry:** `carryOver(s).characters` maps every non-removed player to their pick.
  - **Saved rooms (Review Focus 1):** a saved state whose players lack `character` gives public `character === defaultCharacter(id)`.
- [ ] **Step 2:** Run it. Expect FAIL.
- [ ] **Step 3: Implement.** A late joiner (`onPlayerJoined` or the equivalent) also gets their default.
- [ ] **Step 4:** Run the full treasure-hunt vitest and typecheck. All pass.
- [ ] **Step 5:** Commit and push.

### Task 3: The picker in the teams panel

**Files:**
- Create: `client/characters/*.png` (the 8 previews from the zip's `Previews/`, renamed `<id>.png`)
- Modify: `client/teams.ts` (pure `pickerItems` plus the DOM), `client/view.ts` (send the action, roster `character`), `client/godot/bridge.ts` (Roster type), `client/styles.css`, `shared/rules-text.ts`
- Test: `test/teams-view.test.ts`, `test/session.test.ts` (or wherever `rosterFor` is tested)

**Interfaces:**
- Consumes: Task 2's `CHARACTERS`, `CHARACTER_LABELS`, `THPlayer.character` and the `character` action.
- Produces:
  - `pickerItems(game, me): { id: CharacterId; label: string; src: string; chosen: boolean }[]`;
  - the roster player gains `character: CharacterId`, which Task 4 reads in Godot.

- [ ] **Step 1: Write the failing tests:**
  - `pickerItems` returns 8 items in `CHARACTERS` order, with labels "Woman 1"…"Man 4". Exactly one is `chosen`, and it matches my public `character`.
  - `rosterFor(...)` includes `character` for each player.
  - The panel renders the picker only in the teams phase, only for my own row, with `aria-pressed` on the chosen one. Clicking sends `{type:"character", id}`.
- [ ] **Step 2:** Run the tests. Expect FAIL.
- [ ] **Step 3: Implement.**
  - The picker is a row of 8 small square image buttons (48 px), under my name, with the heading "Your character".
  - Rule line, after the teams line: `"Pick your character before the round starts. Your team colour shows on its shirt."`
- [ ] **Step 4:** Run the tests and typecheck. All pass.
- [ ] **Step 5:** Commit and push.

### Task 4: Models for me and for remotes

**Files:**
- Modify: `godot/scripts/player/walker.gd` (swap the capsule and head visuals for a CharacterModel; keep the collision shape), `godot/scripts/net/remotes.gd` (a CharacterModel per remote instead of the capsule mesh; tag height), `godot/scripts/main.gd` (pass my character and colour from the roster; claim → pick-up), `godot/scripts/web_bridge.gd` (only if roster parsing needs the field)
- Test: `godot/tests/remote_tests.gd`, `godot/tests/walker_tests.gd`, `godot/tests/character_tests.gd`

**Interfaces:**
- Consumes: Task 1's `CharacterModel` and the roster's `character` (a string; unknown → default).
- Produces:
  - `Remotes.model(id: String) -> CharacterModel`, which replaces `capsule(id)`; update its callers and tests;
  - `Walker.model: CharacterModel`.

- [ ] **Step 1: Write the failing tests:**
  - **A remote gets a model:** a remote shows a `CharacterModel` with the roster's id and colour.
  - **Team switch (Review Focus 2):** a roster update changing only its team colour calls `set_color`, so the same model instance remains.
  - **Character switch (Review Focus 3):** a roster update changing its character leaves one model with the new id.
  - **Animation from motion:** a remote moving 3 m/s between snapshots plays walk; a still one plays idle.
  - **Far remotes (Review Focus 5):** beyond 150 m `set_animating(false)` applies; back within 150 m, true.
  - **The name tag** sits at `CharacterModel.HEIGHT + 0.4`.
  - **Me:** the walker's model plays walk and sprint by speed, and jump or fall in the air. A local claim plays pick-up, then returns to the motion state within 0.7 s.
- [ ] **Step 2:** Run it. Expect FAIL.
- [ ] **Step 3: Implement.**
  - Remote speed comes from the lerp: from_pos to to_pos over LERP_S. Remote airborne isn't known, so remotes use idle, walk or sprint only.
  - A remote teammate's pick-up plays when their team's found count rises while they're within 6 m of a revealed cache. If that's awkward to know in Godot, skip remote pick-up and say so. That part is optional.
- [ ] **Step 4:** Run the Godot suite. All pass.
- [ ] **Step 5:** Commit and push.

### Task 5: Seats

**Files:**
- Modify: `godot/scripts/player/avatar.gd` (show my model at SEAT/RIDE_SEAT with drive/sit while seated), `godot/scripts/net/remotes.gd` (`set_seats`, seated placement), `godot/scripts/main.gd` (feed `set_seats` from `vehicles_set`)
- Test: `godot/tests/remote_tests.gd`, `godot/tests/fleet_tests.gd` or `avatar` tests

**Interfaces:**
- Consumes: `PlayerAvatar.SEAT`, `PlayerAvatar.RIDE_SEAT`, `Fleet.get_buggy(id)`, the vehicles list `[{id, driver, passenger, …}]`.
- Produces: `Remotes.set_seats(list: Array) -> void` and `Remotes.fleet: Fleet`, set by main.

- [ ] **Step 1: Write the failing tests:**
  - **Two remotes in one buggy:**
    - The driver's model sits at `buggy.global_transform * SEAT` and the passenger's at `* RIDE_SEAT`, each within 0.05 m.
    - They are at least 0.8 m apart, and they play drive and sit.
    - Both follow the buggy when it moves.
  - **Review Focus 4:** a remote with `v` set whose vehicle isn't in the fleet uses the relayed pos and plays idle, without errors.
  - **Getting out:** when a remote gets out (`v` null), it returns to the relayed pos and motion states.
  - **Me seated:** as driver, my model is visible at SEAT playing drive; as passenger, at RIDE_SEAT playing sit. On foot again, it's back on the walker.
- [ ] **Step 2:** Run it. Expect FAIL.
- [ ] **Step 3: Implement.** Seated models face the buggy's forward (−Z).
- [ ] **Step 4:** Run the Godot suite. All pass.
- [ ] **Step 5:** Commit and push.

### Task 6: Export and browser check

- [ ] **Step 1:** Run the export, commit `godot-build.json`, and note the .pck size change in the ledger.
- [ ] **Step 2:** Restart `pnpm dev`. Then check in two tabs, one room:
  - **Teams phase:** the picker shows 8 faces, and picking updates my row and the other tab's model.
  - **Team switch:** switching team recolours the shirt.
  - **Day photo:** render a photo, using the photo trick or the camera, of a remote walking and of two players in one buggy (driver and passenger apart, drive and sit poses).
  - **Night:** the model reads under the torch.
  - No console errors, and world-ready under 10 s.
- [ ] **Step 3:** Log the results in the ledger. Fix anything found in the same task.
