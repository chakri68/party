# Host Controls (Party Voice Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The host can lock the room, hand the host role to someone else, restart the running game, and pause Nightfall. No voice yet.

**Architecture:**
- Protocol v10 adds `locked` and `paused` to `RoomPublicState`, four host messages, and a fatal `room-locked` error. All shape changes land in Task 1, so the version bumps once.
- `RoomRuntime` keeps the lock, the tokens allowed back in, and the pause (timers held as time left) in `RoomData`. Every change goes through the existing `commit`. Nothing new is written on the hot paths.
- A new optional `GameDefinition.pause` hook lets a game shift its own deadlines. Nightfall is the only game that defines it. A `manifest.pausable` flag tells the client which games have it, the same way `computers` does.
- The lobby's X per person becomes a small per-seat host menu (Make host, Remove), built from a pure `seatActions()` list that phase 3 extends with Mute. Restart and Pause go next to End game in `renderControls`.

**Tech Stack:** TypeScript, Cloudflare Durable Objects (partyserver), Vite, Vitest.

**Spec:** docs/superpowers/specs/2026-11-21-party-voice-design.md (phase 1 = section 6 item 1; rules in 5.1 to 5.3, host UI in 5.4, tests in 7, copy in 8)

## Global Constraints

- Bump `PROTOCOL_VERSION` from 9 to 10 (in Task 1 only). Shape changes: `locked` and `paused` in `RoomPublicState`; `lock-room`, `transfer-host`, `restart-game` and `pause-game` client messages; the `room-locked` error code.
- Player-facing copy: short plain sentences, basic words, no idioms, no slang. It must be easy for Indian readers of English as a second language. No emoji anywhere: UI, docs or tests. Icons are SVG (`apps/web/src/brand.ts`). Exact copy for this phase: "The host locked this room.", "The game is paused.", "Restart this game for everyone?", "Make host", "Remove", "Lock room", "Unlock room", "Pause", "Resume", "Restart".
- Latency and maintainability: no extra storage writes or commits on hot paths beyond what the feature needs. A repeat lock or pause with the same value sends nothing and writes nothing. The pause check on `game-action` reads one field. A refused restart writes nothing.
- Host-only checks reuse `hostOnly()`. The actor is always the connection's seat.
- Shared code lands on `master` only. Nothing here touches `product`.
- Docs in `docs/games/` change in the same task as the behaviour they describe.
- Tests: `pnpm vitest run <file>` for one file, `pnpm test` for all, `pnpm typecheck` for types. Runtime tests use `apps/server/test/harness.ts` (`World`, `join`, `send`, `roomOf`) and go in a new `apps/server/test/host-controls.test.ts`.
- Commit trailer, exactly:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01KwNUn8AHWzbftW559ZRTih

## Review Focus

1. A game hook sets a timer while paused. For example, someone drops during a Nightfall reveal and the reveal ends, so a new phase starts. The timer must wait for Resume, and the new deadline must match it. Pinned in Task 4: "timers set during a pause wait for resume" and "hooks see the clock stopped".
2. The game ends while paused, because a leaver ends it. The room goes to results, `paused` goes false, and no held timer comes back later. Pinned in Task 4: "a game that ends while paused drops the pause".
3. The host leaves while the game is paused. The new host must be able to Resume, or the table is stuck. Pinned in Task 4: "the new host can resume".
4. A friend's phone sleeps in the lobby of a locked room. Their seat goes when grace runs out, or when the host taps Start. They must get back in, but someone the host removed must not. Pinned in Task 1.
5. Restart with a seat that is reconnecting. They are dealt in, the game is told they are away, and if their grace then runs out they show as disconnected, not removed. Pinned in Task 3: "keeps reconnecting seats".

---

### Task 1: Protocol v10 and Lock room (server)

**Files:**
- Modify: `packages/protocol/src/index.ts`
- Modify: `apps/server/src/runtime.ts` (`RoomData`, `onJoin`, `onSeatedMessage`, `onGraceExpired`, `startGame`, `endGameToLobby`, `publicState`)
- Modify: `apps/web/src/views/room.ts` (`FATAL_COPY` only)
- Test: `packages/protocol/test/text.test.ts`, `apps/server/test/host-controls.test.ts` (new)

**Interfaces:**
- Produces (protocol):
  - `PROTOCOL_VERSION = 10`.
  - `RoomPublicState.locked: boolean` ("New people can't join. Seats already in, the owner, and seats dropped for being away still can.") and `RoomPublicState.paused: boolean` ("The host paused the game. Only in `playing`."). Task 1 always sends `paused: false`. Task 4 fills it in.
  - `ClientMessage` gains `{ type: "lock-room"; locked: boolean }`, `{ type: "transfer-host"; playerId: string }`, `{ type: "restart-game" }` and `{ type: "pause-game"; paused: boolean }`. Each has a one-line doc comment saying it is host only.
  - `ErrorCode` gains `"room-locked"`, and it is added to `FATAL_ERRORS`.
  - `parseClientMessage`: `lock-room` and `pause-game` need a boolean. `transfer-host` needs `isStr(playerId, 64)`, the same as `remove-player`. `restart-game` joins the no-field list. Extra fields are dropped.
- Produces (runtime): `RoomData.locked?: boolean` and `RoomData.returnTokens?: string[]`. These are the resume tokens of seats dropped for being away, kept for the room's life, the newest 64 only. Also `private rememberAway(seat: SeatData): void`, which skips empty tokens and bots.

- [ ] **Step 1: Write the failing protocol tests** in `text.test.ts`, `describe("parseClientMessage: host controls")`:
  - `{type:"lock-room",locked:true}` gives `{type:"lock-room",locked:true}`. `locked:"yes"` and a missing `locked` give `null`.
  - `{type:"transfer-host",playerId:"abc"}` parses. A missing id, a number, and a 65-character id give `null`.
  - `{type:"restart-game",junk:1}` gives `{type:"restart-game"}`.
  - `{type:"pause-game",paused:false}` parses. `paused:0` gives `null`.
  - `FATAL_ERRORS.has("room-locked")` is true.
- [ ] **Step 2: Write the failing runtime tests** in `host-controls.test.ts`, `describe("lock room")`. Use the toy games (`games = { toy: toyGame, plain: plainGame }`, default `"toy"`, as `bots.test.ts` does). Each test starts from a claimed room with host `a`:
  - "a locked room refuses a new person, fatally": `a` sends `lock-room true`, and `roomOf(a).locked` is `true`. Then `join(world, room, "Cy")` gets `last("error")` equal to `{ code: "room-locked", message: "The host locked this room.", fatal: true }`, and `closed` is not null. The seat count is unchanged.
  - "only the host locks": `b` sends it, and the reply is `not-host`. `locked` stays `false`.
  - "locking twice sends nothing the second time": `stateVersion` and the update count are unchanged after the repeat.
  - "seats already in come back": `b` disconnects, then rejoins with its token inside grace, and is `connected`.
  - "the owner always gets in": a join with `OWNER_KEY` is seated.
  - "a seat the lobby grace removed gets back in, once": `b` disconnects, then `tick(GRACE_MS)`, and `b` is gone. A join with `b`'s old token is seated (a new seat). A second join with the same token, after that seat leaves, gets `room-locked`.
  - "a seat dropped at Start gets back in": `b` disconnects, `a` starts (b is dropped), then `return-to-lobby` and `lock-room true`. A join with `b`'s token is seated.
  - "removed or left stays out": `remove-player b` in the lobby, then a rejoin with `b`'s token gets `room-locked`. The same for a seat that sent `leave`.
  - "the lock comes before a computer gives up its seat": `a` plus 3 `add-bot` fills toy's 4 seats. Lock, then a new join gets `room-locked`, and there are still 3 bots.
  - "unlock lets people in": `lock-room false`, then a join is seated.
  - "the lock lasts through a game": lock, start, `return-to-lobby`, and `locked` is still `true`.
  - "an ended party ignores the lock": lock, `end-party`, then a new join is seated (it is only a recap to look at).
  - "lock-room is refused in an ended room": the reply is `wrong-phase`.
  - "the owner can never be removed" (spec 5.3): the owner joins with `OWNER_KEY` and is not host. The host's `remove-player` on them gets `{ code: "not-available", message: "You can't remove them." }`, and they stay seated. Nothing on the wire says why.
- [ ] **Step 3: Run both files and check they fail.** Run: `pnpm vitest run packages/protocol/test/text.test.ts apps/server/test/host-controls.test.ts`. Expected: FAIL (the message is not parsed, and `locked` is undefined).
- [ ] **Step 4: Implement the protocol changes** listed in Interfaces.
- [ ] **Step 5: Implement lock in `runtime.ts`.**
  - `lock-room`: `hostOnly()` and `inPhase("lobby", "playing", "results")`. If the value is the same, return with no commit. Otherwise set `data.locked` and commit.
  - `onJoin`, new-seat branch, first check (before `game-in-progress` and before the room-full or bot-bump step): if `data.locked && data.phase !== "ended" && !owner`, admit only when `msg.resumeToken` is in `data.returnTokens`. Remove that token from the list once used. Otherwise `fatal(conn, "room-locked", "The host locked this room.")`.
  - Call `rememberAway` for the seats dropped by: `onGraceExpired`'s lobby branch, `startGame`'s "not connected" filter, and `endGameToLobby`'s filter of `disconnected` seats. Never for `remove-player` or `leave`.
  - `publicState`: `locked: !!data.locked`, `paused: false`.
  - `remove-player`: a target with `owner: true` gets the same "You can't remove them." as today's self-remove. The UI still shows the button.
  - `FATAL_COPY` in `room.ts`: `"room-locked": "The host locked this room."`. Keep the stored resume token on this error (do not add it to the clear list), so a dropped friend can try again.
- [ ] **Step 6: Run the tests and check they pass.** Run the Step 3 command, then `pnpm test` and `pnpm typecheck`. Expected: all PASS.
- [ ] **Step 7: Commit** "Room: protocol v10 and lock room".

### Task 2: Make host (server)

**Files:**
- Modify: `apps/server/src/runtime.ts` (`onSeatedMessage`)
- Test: `apps/server/test/host-controls.test.ts`

**Interfaces:**
- Consumes: Task 1's `transfer-host` message.
- Produces: the `transfer-host` handler. On success it sets `data.hostId` and commits once. `ensureHost` is unchanged.

- [ ] **Step 1: Write the failing tests**, `describe("make host")`, with people `a` (host), `b` and `c`:
  - "hands the host role over at once": `a` sends `transfer-host b`, and `roomOf(c).hostId` is `b`'s id. Exactly one new update per person.
  - "refuses what it can't do": target is self, a bot, a `reconnecting` seat, or an unknown id. Each gets `{ code: "not-available", message: "You can't make them host.", fatal: false }`, and `stateVersion` is unchanged.
  - "only the host": `b` sends it, and the reply is `not-host`.
  - "the old host doesn't take it back": `a` gives it to `b`, then `a` disconnects and rejoins with its token. `hostId` is still `b`. Then `b`'s grace runs out (`b` disconnects, `tick(GRACE_MS)`, in the lobby). The role goes to the longest-seated connected person, as today.
  - "works mid-game": start, then `transfer-host b`, and `hostId` is `b`. A later `return-to-lobby` from `a` gets `not-host`.
  - "refused in an ended room": the reply is `wrong-phase`.
- [ ] **Step 2: Run and check it fails.** Run: `pnpm vitest run apps/server/test/host-controls.test.ts -t "make host"`. Expected: FAIL.
- [ ] **Step 3: Implement** the `transfer-host` case: `hostOnly()`, `inPhase("lobby", "playing", "results")`, and a target that is `connected`, not a bot, and not the sender.
- [ ] **Step 4: Run and check it passes**, then `pnpm typecheck`.
- [ ] **Step 5: Commit** "Room: make host".

### Task 3: Restart (server)

**Files:**
- Modify: `apps/server/src/runtime.ts` (split `startGame`, add the `restart-game` case)
- Test: `apps/server/test/host-controls.test.ts`

**Interfaces:**
- Consumes: Task 1's `restart-game` message.
- Produces:
  - `private startCheck(def: AnyGameDefinition, n: number): { code: ErrorCode; message: string } | null`. This is the owner gate, the head count and `setupProblem`, with the copy `startGame` uses today. `startGame` calls it, and its behaviour is unchanged.
  - `private dealGame(def: AnyGameDefinition, conn: Conn, debug?: {...}): Promise<GameEventEnvelope<unknown>[] | null>`. It holds everything in `startGame` after the checks: dealer, round number, carry, createGame, phase, ready, suggestions and botRun. Its return is the events to commit, or null when a bad debug deck was already answered. Name it whatever reads best, but `startGame` and restart must share it.
  - The `restart-game` case. Restart counts as a new game for `roundNumber` and dealer rotation, the same as Rematch.

- [ ] **Step 1: Write the failing tests**, `describe("restart")`, on sevens (the harness default) with `a`, `b` and `c`. For the toy cases, use a fixture `{ ...toyGame, setupProblem: () => problem }` with a `let problem: string | null = null` variable:
  - "starts the same game again in one update": after a play, `restart-game` gives `phase: "playing"`, the same `gameId` and settings, and `roundNumber` one higher. Hands are dealt again (52 cards across the private hands, and the board is empty). Exactly one new update per person.
  - "keeps reconnecting seats": `c` disconnects, then restart. `c` is in `seats` and dealt in (has a hand in the stored state). Its presence is `reconnecting`. After `tick(GRACE_MS)`, `c` is `disconnected` and still seated. Use toy with a recording `onPlayerDisconnected` to check that the new game is told `c` is away right after the deal.
  - "drops disconnected seats": `c` disconnects, `tick(GRACE_MS)`, then restart. `c` is not in `seats`.
  - "refused before ending anything": three cases. (1) `world.ownerRequired = true`, the owner `reconnecting`: the reply is `cannot-start`. (2) 2 players, `b` disconnected past grace: `not-enough-players`. (3) The fixture's `problem = "Bad deck"`: `bad-setup` with message "Bad deck". Each time `phase` stays `playing`, the stored game state is deep-equal to before, and `stateVersion` is unchanged.
  - "no recap entry": restart, then `return-to-lobby` and `end-party`. `roomOf(a).recap` is `null`.
  - "only the host, only mid-game": `b` gets `not-host`, and a host in the lobby or results gets `wrong-phase`.
- [ ] **Step 2: Run and check it fails.** Run: `pnpm vitest run apps/server/test/host-controls.test.ts -t restart`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The restart case is `hostOnly()` and `inPhase("playing")`. `kept` = seats that are `connected` or `reconnecting`.
  - Run `startCheck(def, kept.length)`. On failure send the error and return, with no commit.
  - Otherwise call `endGameToLobby(null)` (it clears game and bot timers, drops the other seats, and resets ready), then `dealGame`.
  - Then, for each `reconnecting` seat, `applyGameHook(onPlayerDisconnected)`. Commit once with all the events.
  - Also check `lockedGameIds` and `botsAllowed` as `startGame` does. They can't fail for a game that is already running, but a shared check keeps it honest.
- [ ] **Step 4: Run and check it passes**, then `pnpm test` (the `startGame` split must not change any older test) and `pnpm typecheck`.
- [ ] **Step 5: Commit** "Room: restart a game".

### Task 4: Pause (hook, runtime, Nightfall)

**Files:**
- Modify: `packages/game-core/src/index.ts` (`GameDefinition.pause`, `GameManifest.pausable`)
- Modify: `apps/server/src/runtime.ts`
- Modify: `games/nightfall/shared/types.ts`, `games/nightfall/shared/manifest.ts`, `games/nightfall/server/game.ts`, `games/nightfall/client/view.ts`
- Modify: `docs/games/nightfall.md`
- Test: `apps/server/test/host-controls.test.ts`, `apps/server/test/games.test.ts`, `games/nightfall/test/game.test.ts`

**Interfaces:**
- Consumes: Task 1's `pause-game` message and `RoomPublicState.paused`. Task 3's restart (it must clear the pause through `endGameToLobby`).
- Produces:
  - `GameDefinition.pause?(state: TState, paused: boolean, ctx: GameContext): GameTransition<TState, TEvent>`. JSDoc: "The host paused (true) or resumed (false). The room holds every game timer by time left and sets it again on resume. The game shifts its own deadline fields here, by the time paused. While paused, every hook sees `ctx.now` stopped at the moment of the pause."
  - `GameManifest.pausable?: true`. JSDoc: "The definition has `pause`, so the host gets Pause in a game. A test keeps the two in step."
  - `RoomData.pause?: { at: number; timers: Record<string, number> }`. The timers map a key to ms left, for `game:` and `bot:` keys only. `publicState().paused = !!data.pause`.
  - Nightfall: `NightfallServerState.pausedAt?: number | null`, and `NightfallPublicState.pausedAt: number | null`.

- [ ] **Step 1: Write the failing registry test** in `games.test.ts`, "lists exactly the games that can pause": the ids with `def.pause` are `["nightfall"]`, and for every game `!!def.manifest.pausable === !!def.pause`.
- [ ] **Step 2: Write the failing Nightfall tests** in `game.test.ts`, `describe("pause")`:
  - "resume moves the deadline by the time paused": `s = seven()`, with deadline `D`. `g.pause!(s, true, ctx(5000))` sets `pausedAt` to 5000, and `getPublicState(...).pausedAt` is 5000. Then `g.pause!(that, false, ctx(65000))` gives `deadline === D + 60000` and `pausedAt === null`. Both transitions have `events: []` and no timers.
  - "resume with nothing paused changes nothing", and "a finished game ignores pause": the state is deep-equal to before.
- [ ] **Step 3: Write the failing runtime tests**, `describe("pause")`. Use the fixture `pauseToy = { ...toyGame, manifest: { ...toyGame.manifest, pausable: true }, pause: (s) => ({ state: s, events: [] }) }`, and `plain` for "can't pause":
  - "holds the game timer by time left": two people play to 10 (toy's window timer is `TOY_WINDOW_MS`). `tick(2000)`, then pause, and `paused` is `true`. `tick(60_000)`: still `playing`, and the stored `timers` has no `game:window`. Resume, then `tick(2999)`: still `playing`. Then `tick(1)`: `results`.
  - "computers wait while paused": one person and a bot, with the bot to move. Pause, then `tick(10_000)`. Toy's `total` is unchanged and there is no `bot:` timer. Resume: the `bot:` timer is back at resume time plus its time left. After `tick(BOT_THINK_MS + 1001)` the bot has moved.
  - "refuses moves while paused": `game-action` gives `action-rejected` with `{ code: "wrong-phase", message: "The game is paused." }`. `skip-turn` and `nudge` give `error` with the same code and message. `stream` is dropped with no reply. `stateVersion` is unchanged.
  - "awaitingSince moves on by the time paused": note `awaitingSince` as `t0`. Pause, `tick(30_000)`, resume, and `awaitingSince === t0 + 30_000`.
  - "only the host, only mid-game, only games that pause": `b` gets `not-host`. The lobby gives `wrong-phase`. A `plain` game gives `{ code: "not-available", message: "This game can't pause." }`. Pausing twice gives no second update.
  - "the new host can resume": `a` pauses, then `a` sends `leave`. `b` is host, and `b`'s `pause-game false` works.
  - "timers set during a pause wait for resume" and "hooks see the clock stopped": use the fixture `pauseToy` plus `onPlayerDisconnected: (s, _id, ctx) => { seen.push(ctx.now); return { state: s, events: [], timers: [{ kind: "set", timerId: "late", delayMs: 4000 }] }; }`. Pause at `P`, `tick(10_000)`, then `b` disconnects: `seen` is `[P]`, and the stored timers have no `game:late`. Resume at `R`: `timers["game:late"] === R + 4000`.
  - "a game that ends while paused drops the pause": a fixture `onPlayerRemoved` that ends the toy (`phase: "done"`, `winner` set). Pause, then `b` leaves. The room is `results`, `paused` is `false`, and no `game:` or `bot:` timers are left.
  - "back to lobby and restart clear the pause": pause, then `return-to-lobby`: `paused` is `false`. Start, pause, then `restart-game`: `paused` is `false`, and the new game's timers run.
  - "Nightfall through the room": `new RoomRuntime("K7DX", world.host(), { nightfall: nightfallGame }, "nightfall")`, with 5 people, then start. Note the reveal `deadline` as `D`. `tick(5000)`, pause, `tick(60_000)`, resume. The public `game.deadline === D + 60_000`. Ticking to `D + 60_000` moves the phase to `night`.
- [ ] **Step 4: Run all three and check they fail.** Run: `pnpm vitest run apps/server/test/games.test.ts apps/server/test/host-controls.test.ts games/nightfall/test/game.test.ts`. Expected: FAIL.
- [ ] **Step 5: Implement the game-core types**, and `pausable: true` on Nightfall's manifest.
- [ ] **Step 6: Implement the runtime.**
  - `pause-game`: `hostOnly()` and `inPhase("playing")`. If the game has no `def.pause`, reply `not-available` "This game can't pause.". If the value is the same, return with no commit.
  - **Pause:** apply `def.pause(state, true, ctx)` with `applyTransition`. Then set `data.pause = { at: now, timers }`. `timers` holds `max(0, at - now)` for every `game:` and `bot:` key, and those keys are cleared from `data.timers`. Commit.
  - **Resume:** `pausedFor = now - pause.at`. Set each held timer again at `now + left`. If `awaitingSince` is not null, it becomes `min(now, awaitingSince + pausedFor)`. Delete `data.pause`, then apply `def.pause(state, false, ctx)` (this sees the real clock). Commit, which schedules bots again.
  - `ctx()`: `now` is `data.pause?.at ?? host.now()`.
  - `applyTransition` while paused: a `set` goes to `pause.timers[key] = delayMs`. A `cancel` deletes the key from both maps.
  - `scheduleBots`: return when paused, after the "only computers left" check. `onBotTimer`: return null when paused.
  - Refuse `game-action`, `skip-turn` and `nudge` while paused with `wrong-phase` "The game is paused.". Drop `stream` with no reply.
  - Clear `data.pause` in `endGameToLobby`, and in `applyTransition`'s outcome branch.
- [ ] **Step 7: Implement Nightfall.**
  - `pause` on the definition: pause sets `pausedAt = ctx.now`. Resume adds `ctx.now - pausedAt` to `deadline` when `deadline > 0`, then sets `pausedAt = null`. Return no events and no timers (the room holds the phase timer).
  - Expose `pausedAt: state.pausedAt ?? null` in `getPublicState`. `createGame` sets `pausedAt: null`.
  - `view.ts` `renderClock`: use `game.pausedAt ?? this.api.serverNow()` as "now", so the timer and bar stop. Play no tick while paused.
  - Check `secrecy.test.ts` still passes: `pausedAt` is a time, not a secret.
- [ ] **Step 8: Update the docs.** `docs/games/nightfall.md` "When things go sideways" gets: "**The host pauses the game.** The timer stops for everyone. Nobody can pick or vote. When the host taps **Resume**, the timer goes on from where it stopped."
- [ ] **Step 9: Run and check it passes.** Run the Step 4 command, then `pnpm test` and `pnpm typecheck`. Expected: all PASS.
- [ ] **Step 10: Commit** "Room: pause, with Nightfall as the first game".

### Task 5: Host controls in the shell (client and rooms doc)

**Files:**
- Create: `apps/web/src/views/host-menu.ts`
- Modify: `apps/web/src/views/room.ts` (`lobby`, `renderControls`, the `update` handler)
- Modify: `apps/web/src/brand.ts` (a `more` icon: three filled dots, same `STROKE` style)
- Modify: `apps/web/src/style.css` (seat menu button, dialog list, paused note), following the existing `.kick` and `.dialog` styles
- Modify: `docs/games/rooms.md`
- Test: `apps/web/test/host-menu.test.ts` (new)

**Interfaces:**
- Consumes: `RoomPublicState.locked` and `.paused` (Task 1), `manifest.pausable` (Task 4), and the four messages.
- Produces (`host-menu.ts`, DOM-free so it tests without a browser):
  ```ts
  /** Phase 3 adds "mute". */
  export type SeatActionKind = "make-host" | "remove";
  export interface SeatAction { kind: SeatActionKind; label: string; confirm: string | null; danger: boolean }
  export function seatActions(room: RoomPublicState, me: string, seat: SeatPublic): SeatAction[];
  export function seatActionMessage(kind: SeatActionKind, seat: SeatPublic): ClientMessage;
  ```
  - Rules: return `[]` unless `room.hostId === me` and `seat.id !== me`.
  - `make-host` is only for a person (not a bot) who is `connected`. Label "Make host", confirm `Make ${name} the host?`.
  - `remove` is always there. Label "Remove", confirm `Remove ${name} from the room?`, or `null` for a bot. `danger: true`.
  - Order: Make host, then Remove.

- [ ] **Step 1: Write the failing test** `host-menu.test.ts`. Build a minimal `RoomPublicState` fixture, cast as needed:
  - A non-host viewer gets `[]`, and the host on their own seat gets `[]`.
  - The host on a connected person gets kinds `["make-host", "remove"]`, with confirms `"Make Ben the host?"` and `"Remove Ben from the room?"`.
  - The host on a reconnecting person gets `["remove"]` only.
  - The host on a bot gets `["remove"]` with `confirm: null`.
  - `seatActionMessage("make-host", ben)` gives `{ type: "transfer-host", playerId: ben.id }`, and `"remove"` gives `{ type: "remove-player", playerId: ben.id }`.
- [ ] **Step 2: Run and check it fails.** Run: `pnpm vitest run apps/web/test/host-menu.test.ts`. Expected: FAIL (no module).
- [ ] **Step 3: Implement `host-menu.ts`.**
- [ ] **Step 4: Change the lobby seat rows.**
  - Bots keep today's X (one action, no confirm).
  - A person gets a button with `icon("more")` and `aria-label` `Actions for ${name}`. It opens a `<dialog class="dialog seat-menu">`, built the way `openGameList` builds its dialog: `closeOnBackdrop`, the seat's name as the title, one button per `seatActions()` item (`class="danger"` when `danger`), and a "Cancel" `form method="dialog"` button.
  - Tapping an action closes the dialog. Then it asks `confirm()` (as Remove does today) and sends `seatActionMessage`.
  - The menu is one loop over `seatActions()`, so phase 3 adds Mute in `host-menu.ts` alone.
- [ ] **Step 5: Add the lobby lock.**
  - For the host, under the player list: a toggle button with `aria-pressed`, labelled "Lock room" or "Unlock room", that sends `lock-room`.
  - For everyone while `room.locked`: `h("p", { class: "muted", role: "status" }, "The room is locked. New players can't join.")` in the invite block.
- [ ] **Step 6: Change `renderControls`.**
  - While `room.paused`, show everyone "The game is paused." (`role: "status"`), and do not show the Remind or Skip buttons.
  - The host's items before End game, in this order:
    - **Pause** or **Resume**, only when `games[room.gameId]?.manifest.pausable`. It sends `pause-game` and does not ask first.
    - **Restart**. It asks `confirm("Restart this game for everyone?")`, then sends `restart-game`.
    - **End game**, as today.
- [ ] **Step 7: Handle restart in the `update` handler.**
  - When `prev.room.phase === "playing"`, `u.room.phase === "playing"` and `roundNumber` changed, call `dropGameView()` before `render()`, so the game view mounts fresh.
  - Non-hosts get the toast `${seatName(u.room, u.room.hostId)} restarted the game.`.
- [ ] **Step 8: Update `docs/games/rooms.md`.**
  - "What only the host can do": replace the X line with "Tap the dots next to a player to **Make host** or **Remove** them. Both ask first. A computer still has its own remove button, and it doesn't ask." Add "**Lock room** in the lobby. While it is locked, new players can't join. Players already in the room can still come back. So can someone whose phone went to sleep and lost their seat. Tap **Unlock room** to open it again."
  - The "You can't get in if" table gets the row "The host locked this room. | The host locked the room to new players."
  - "When the host leaves": add "The host can also give the role to someone else with **Make host**. They get "You're the host now."".
  - "During a game": add "Host: **Restart** starts the same game again with the same settings (asks first). Players who are reconnecting stay in." Also add "Host: **Pause** and **Resume**, in games that can pause (Nightfall for now). While paused, the timer stops and nobody can play."
  - Remove the ✕ and ✓ glyphs in the lines you touch.
- [ ] **Step 9: Run the tests and type checks.** Run: `pnpm vitest run apps/web/test/host-menu.test.ts`, `pnpm test` and `pnpm typecheck`. Expected: PASS.
- [ ] **Step 10: Manual check** with `pnpm dev`, two browsers and five tabs for Nightfall:
  - The menu works with the keyboard (Tab, Enter, Escape) and by touch.
  - Make host moves the host tag, and the new host gets the toast.
  - Lock, then a new tab sees "The host locked this room.".
  - Restart redraws the game.
  - Pause stops the Nightfall timer on every tab, and Resume goes on from the same second.
- [ ] **Step 11: Commit** "Shell: host menu, lock, restart and pause controls".
