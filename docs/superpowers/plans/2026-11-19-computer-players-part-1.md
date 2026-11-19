# Computer Players, Part 1 (room support + Crazy Eights pilot) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A host can seat computer players in the lobby, and they play Crazy Eights by the same rules as people, from the server.

**Architecture:** The room runtime owns bot seats and drives them: after every commit in a game it asks each bot seat's game `bot.decide(view, ctx)` whether it wants to move, sets a `bot:<seatId>` timer, and on firing asks again and runs the move through `handleAction` like a person's. Games only add a pure `decide()`. Part 2 (the other 11 games) is a separate plan written after the pilot is played by hand.

**Tech Stack:** TypeScript, Cloudflare Durable Objects via partyserver, Vitest, plain DOM client (`h()` from `@games/ui`).

**Spec:** `docs/superpowers/specs/2026-11-19-computer-players-design.md` (read it before any task).

## Global Constraints

- Words players read: short, plain sentences, basic words, no idioms, easy for Indian readers. No emoji anywhere (UI, docs, commits); icons are SVG.
- A bot sees only `getPublicState(state)` and `getPrivateState(state, botId)`. Never the raw state.
- Every bot move goes through the game's own `handleAction`.
- Bump `PROTOCOL_VERSION` from 8 to 9 (wire shape changes in Task 2).
- Shared code lands on `master`. Never on `product`.
- Latency: a person's action never runs bot code inline; bots use the room's existing timer table and alarm, not `setTimeout`; `decide()` stays within a few milliseconds.
- Bot think time: `800 + randomInt(801)` ms, times `min(1, 3 / botSeatsInGame)`, floored at 350 ms.
- A bot seat that makes more than `BOT_MAX_RUN = 50` moves with no other seat moving in between is stuck.
- Stuck message, shown to everyone: "A computer player got stuck, so the game ended."
- Copy: button "Add computer"; line under it "Computers play by the same rules. They only see their own cards."; seat tag "computer"; blocked game line "Remove computers to play this"; one-tap button "Remove computers".
- Bot names (pick the first not used by any seat, case-insensitive): Asha, Ravi, Meera, Arjun, Priya, Kiran, Neha, Vikram, Divya, Rahul, Anjali, Sanjay.
- Run `pnpm vitest run <paths>` for the tests a task touches and `pnpm -r --no-bail typecheck` before each commit. Long Trail's `vite/client` typecheck error is known and not yours.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01KwNUn8AHWzbftW559ZRTih
  ```

## Review Focus

1. **`decide()` throws inside an alarm.** `onAlarm` rethrows so the DO retries, which would retry a broken bot forever. Expect: the throw is caught inside the bot path and treated as stuck, never reaching `recover()`/rethrow. Test in Task 3.
2. **Eviction mid bot game.** `load()` must not put bot seats into grace, and pending `bot:` timers must still fire after a reload. Test in Task 3.
3. **Only bots left in the lobby.** The last person leaves a lobby with bots: no bot becomes host, the cleanup timer still runs. Test in Task 2.
4. **Free room cap.** In a free room `add-bot` stops at `freeMaxPlayers`, and a person joining a full free room bumps a bot rather than being turned away. Test in Task 2.
5. **Rooms stored before this shipped.** A stored `RoomData` without `bot`/`botRun` loads and plays normally. Test in Task 2.

---

### Task 1: Bot contract and all-bot simulator

**Files:**
- Modify: `packages/game-core/src/index.ts` (contract types, near `GameDefinition` at ~156)
- Modify: `packages/game-core/src/testing.ts` (add `playBots`)
- Test: `packages/game-core/test/bots.test.ts`

**Interfaces:**
- Produces (in `@games/game-core`):
  ```ts
  export interface BotView<TPublic, TPrivate> { playerId: string; public: TPublic; private: TPrivate }
  export interface BotContext { randomInt(maxExclusive: number): number }
  export interface GameBot<TPublic, TPrivate, TAction> {
    /** One move, or null for "nothing to do right now". Pure: no memory across calls. */
    decide(view: BotView<TPublic, TPrivate>, ctx: BotContext): TAction | null;
  }
  // on GameDefinition<TState, TAction, TPublicState, TPrivateState, TSettings, TEvent>:
  bot?: GameBot<TPublicState, TPrivateState, TAction>;
  ```
- Produces (in `@games/game-core/testing`):
  ```ts
  export interface BotRunResult {
    outcome: GameOutcome | null;      // null when it hit maxMoves
    moves: number;
    rejected: { playerId: string; action: unknown; code: string }[];
    stuck: { playerId: string; reason: "null-while-awaited" }[];
  }
  export function playBots(def: AnyGameDefinition, opts: { players: number; seed: number; settings?: unknown; maxMoves?: number }): BotRunResult;
  ```
  Behaviour: seat ids `p1..pN`; `createGame` with `seededRandomInt(seed)`; loop until `getResult` or `maxMoves` (default 5000): ask `decide` for every seat (views only, via `getPublicState`/`getPrivateState`); apply the first awaited seat's non-null move, else any seat's; if none moves, fire the earliest pending game timer through `onTimer` (track `set`/`cancel` from every transition's `timers`); if no timer either, record each awaited seat as `stuck` and stop. A rejected move is recorded and the loop stops.

- [ ] **Step 1: Write the failing tests** in `packages/game-core/test/bots.test.ts` with an inline toy game ("count to 20": awaited is the current player, action `{ type: "add", n: 1|2 }`, a winner at 20; plus a timer-driven phase where awaited is empty and a `pass` is optional, closed by `onTimer("window")`):
  - `playBots finishes a game whose bot always moves` → `outcome` not null, `rejected` empty, `stuck` empty.
  - `playBots fires game timers when nobody wants to move` → finishes, and the toy's `onTimer` ran at least once.
  - `playBots reports a bot that returns null while awaited` → toy variant whose `decide` returns null at 10 → `stuck` = `[{ playerId: <current>, reason: "null-while-awaited" }]`, `outcome` null.
  - `playBots records a rejected move and stops` → toy variant that returns `{ type: "add", n: 3 }` → `rejected[0].code` equals the toy's error code.
  - `decide only ever gets views` → spy `decide`; every `view` deep-equals `{ playerId, public: getPublicState(s), private: getPrivateState(s, playerId) }` for the state at that moment.
- [ ] **Step 2: Run to see them fail.** `pnpm vitest run packages/game-core/test/bots.test.ts` → FAIL (`playBots` not exported).
- [ ] **Step 3: Add the types to `index.ts` and `playBots` to `testing.ts`.** `testing.ts` must not import vitest.
- [ ] **Step 4: Run tests.** Same command → PASS. Then `pnpm -r --no-bail typecheck`.
- [ ] **Step 5: Commit** `game-core: a bot contract for games, and an all-bot simulator for tests`.

---

### Task 2: Bot seats in the room (protocol, add/remove, caps, host, recap, gating)

**Files:**
- Modify: `packages/protocol/src/index.ts` (`SeatPublic`, `RoomPublicState`, `ClientMessage`, parser, `ErrorCode`, `PROTOCOL_VERSION`)
- Modify: `apps/server/src/runtime.ts` (`SeatData`, `onSeatedMessage`, `onJoin`, `ensureHost`, `load`, `logGame`, `publicState`, nudge targets)
- Create: `apps/server/test/bot-toy.ts` (toy game with a bot, shared by Tasks 2–3)
- Test: `apps/server/test/bots.test.ts`, plus a parser case in the protocol's existing tests

**Interfaces:**
- Consumes: `GameBot`, `BotView`, `BotContext` from Task 1.
- Produces:
  - Wire: `SeatPublic.bot?: true`; `RoomPublicState.botGameIds: string[]` (ids of games with `bot`); client messages `{ type: "add-bot" }` and `{ type: "remove-bots" }`; `ErrorCode` gains `"game-ended"`; `PROTOCOL_VERSION = 9`.
  - Server: `SeatData.bot?: true`. Bot seat: `id` = `"bot-" + host.randomToken().slice(0, 8)`, name from the bot names list, `avatarSeed` = `"bot-" + name`, `resumeToken: ""`, `ready: true`, `presence: "connected"`, `owner: false`, `joinedAt: now`.
  - `apps/server/test/bot-toy.ts` exports `toyGame: AnyGameDefinition` (id `"toy"`, min 2, max 4, turn-based, with `bot`, a `skipTurn`, an optional `call` move during a timer window, and a test knob `toyKnobs = { decide: "normal" | "null" | "throw" | "illegal" }`) and `plainGame` (id `"plain"`, no `bot`).
- Lobby removal of one bot reuses the existing `remove-player` (it already deletes a seat outside a game). Mid-game it already refuses with "too-early", which is what we want.

- [ ] **Step 1: Write the failing tests** in `apps/server/test/bots.test.ts` (`World` and `join` from `./harness.ts`, runtime built with `{ toy: toyGame, plain: plainGame }`, default `"toy"`):
  - `host adds a computer in the lobby` → seat with `bot: true`, name `"Asha"`, `ready: true`; `roomOf(a).botGameIds` contains `"toy"`, not `"plain"`.
  - `only the host, only in lobby or results, only for bot games` → non-host gets `not-host`; with `plain` selected → `not-available`; while playing → `wrong-phase`.
  - `names skip ones already seated` → a person named "asha" seated → first bot is `"Ravi"`.
  - `stops at the table's max` → toy max 4: 1 person + 3 bots, a 4th `add-bot` → `room-full` error, non-fatal.
  - `a person joining a full lobby bumps the newest bot` → 1 person + 3 bots, new person joins → seated; the most recently added bot is gone.
  - `free room: bots stop at the free cap, and a person still gets in` → `world.tierLimits = { premiumGameIds: [], freeMaxPlayers: 3 }`, room claimed as free; third seat via `add-bot` refused past 3; a person joining bumps a bot.
  - `remove-bots takes every computer out; remove-player takes one` (lobby).
  - `a bot is never host` → host leaves a lobby with only bots → `hostId` is null; the cleanup timer is set.
  - `picking a game without bots is refused while computers sit` → `select-game plain` → error `not-available`, message `"Remove computers to play this"`; after `remove-bots` it works.
  - `bots win games but get no awards` → finish a toy game a bot wins → results show the bot as winner; `end-party` recap has no award or champion naming the bot.
  - `nudges never target a bot`.
  - `a room stored before bots loads and plays` → put a `RoomData` without `bot`/`botRun`/`botGameIds` into `world.store`, `load()`, join, start → plays.
  - Protocol parser: `add-bot` and `remove-bots` parse; extra junk is ignored like other messages.
- [ ] **Step 2: Run to see them fail.** `pnpm vitest run apps/server/test/bots.test.ts` → FAIL.
- [ ] **Step 3: Protocol changes**, then runtime changes:
  - `add-bot`: host only, phase `lobby`/`results`, `this.games[data.gameId].bot` present else `not-available` "This game can't have computers.", `activeSeats().length < maxSeats(def)` else non-fatal `room-full` "The table is full.".
  - `remove-bots`: host only, lobby/results; drop all bot seats.
  - `onJoin`, new seat, not `playing`, table full: if a bot is seated, remove the newest bot (highest `joinedAt`) and seat the person; else `room-full` as now.
  - `ensureHost`: candidates exclude `bot`; if no person qualifies, `hostId = null` (bots never fall back as host).
  - `load()`: skip bot seats when marking `reconnecting`.
  - `logGame`: `human(id)` also requires the seat isn't a bot.
  - Nudge targets exclude bot seats.
  - `select-game` and `start-game`: if any bot seat and the target/current game has no `bot` → `not-available` "Remove computers to play this".
  - `publicState().botGameIds`.
- [ ] **Step 4: Run tests.** `pnpm vitest run apps/server/test packages/protocol` → PASS, including all existing runtime tests. Then typecheck.
- [ ] **Step 5: Commit** `Room: computer seats in the lobby`.

---

### Task 3: The room plays its bots

**Files:**
- Modify: `apps/server/src/runtime.ts`
- Test: `apps/server/test/bots.test.ts` (new `describe("bots in a game")`)

**Interfaces:**
- Consumes: `toyGame`, `toyKnobs` (Task 2), `GameBot` (Task 1).
- Produces (private to the runtime): `BOT_TIMER_PREFIX = "bot:"`, `BOT_MAX_RUN = 50`, `RoomData.botRun?: { seatId: string; moves: number; skipped: boolean }`, methods `scheduleBots()`, `onBotTimer(seatId: string): GameEventEnvelope<unknown>[]`, `botStuck(seatId: string, reason: string): GameEventEnvelope<unknown>[]`, `endGameToLobby(message: string | null)`, `personWatching(): boolean`.

Behaviour (spec, "Driving turns", "Latency", "When a bot can't move", "When no person is watching"):
- `commit()` calls `scheduleBots()` before persisting, when `phase === "playing"`. For each bot seat in the game without a pending `bot:` timer, if `personWatching()` (some non-bot seat `connected`) and `decide(view, ctx)` returns non-null, set `bot:<id>` at `now + delay` (Global Constraints formula; `botSeatsInGame` = bot seats in `data.seats` not `left`).
- If every non-bot seat in the game is `left`: `endGameToLobby(null)` instead.
- `handleAlarm` routes `bot:` keys to `onBotTimer`; all due bot timers in one alarm share the one `commit`.
- `onBotTimer`: return `[]` unless playing, the seat is still a bot in the game, and `personWatching()`. Call `decide` inside `try`; a throw → `botStuck(id, "threw")` (log via `host.logError`). `null` and awaited → `botStuck(id, "null")`; `null` and not awaited → `[]`. Else `handleAction`; rejected → `botStuck(id, "rejected")`; ok → `applyTransition(t, true)` and update `botRun` (same seat: `moves + 1`; other seat: reset to `{ seatId, moves: 1, skipped: false }`); `moves > BOT_MAX_RUN` → `botStuck(id, "run")`.
- A person's `game-action` resets `botRun` to undefined.
- `botStuck`: log; if `!botRun?.skipped`, mark skipped and apply `skipTurn(state, id)`, returning its events if any; otherwise (or no events) `endGameToLobby("A computer player got stuck, so the game ended.")` and return `[]`.
- `endGameToLobby(message)`: the body of today's `return-to-lobby` (phase lobby, game null, clear `game:` **and** `bot:` timers, drop non-connected/non-reconnecting seats, `ensureHost`, reset ready, keep bots `ready: true`, clear awaiting, clear `botRun`); no recap entry; if `message`, send `{ type: "error", code: "game-ended", message, fatal: false }` to every live seated conn. `return-to-lobby` calls it with `null`.
- `resetReady()` keeps bot seats ready.

- [ ] **Step 1: Write the failing tests** (1 person "Ana" + bots, toy game; advance with `world.tick(room, 3000)` in a loop):
  - `bots take their turns after a short think` → after start, nothing happens at +300 ms; within +1700 ms of a bot's turn its move is applied; an all-bot-but-one table finishes.
  - `a person's move goes out before any bot moves` → after Ana's `game-action`, Ana's next update has her move and the bot's move is not in it.
  - `bots take optional moves` → toy's call window (awaited empty): a bot sends `call` before the window timer.
  - `null while awaited: skip first, then back to the lobby` → `toyKnobs.decide = "null"` → first: skip event; second time: phase `lobby`, every conn got error `game-ended` with the stuck message, recap game count unchanged.
  - `decide throwing is stuck, not a rollback` → `toyKnobs.decide = "throw"` → `world.errors` has the throw, the alarm call resolves (no rethrow), game skipped then ended as above.
  - `a rejected bot move is stuck` → `"illegal"`.
  - `the in-a-row cap` → toy variant where one bot keeps the turn → ended after 51 moves via skip then lobby.
  - `bots pause while no person is connected, and pick up on reconnect` → Ana disconnects; ticking 10 s moves nothing; Ana rejoins with her resume token; the bot moves within 2 s.
  - `the game ends when every person has left` → Ana sends `leave` → phase `lobby`, no `game-ended` message.
  - `a reload mid-game keeps bots playing` → `room2 = world.runtime(...)`, `await room2.load()` → bot seats still `connected`, pending bot timer fires on `room2`.
  - `think time shrinks at big tables` → with 3 bots the delay is in [800, 1600]; with 6 bots in [400, 800] (floor 350).
- [ ] **Step 2: Run to see them fail.** `pnpm vitest run apps/server/test/bots.test.ts` → FAIL.
- [ ] **Step 3: Implement** as described above.
- [ ] **Step 4: Run** `pnpm vitest run apps/server/test` → PASS (all runtime tests too). Typecheck.
- [ ] **Step 5: Commit** `Room: computer players take their turns`.

---

### Task 4: Lobby UI for computers

**Files:**
- Modify: `apps/web/src/views/room.ts` (seat list ~600–630, game list ~700–780, start button)
- Modify: `apps/web/src/style.css` (tag style reuse; button row)
- Modify: `docs/games/rooms.md` (a "Computer players" section, plain words)

**Interfaces:**
- Consumes: `SeatPublic.bot`, `RoomPublicState.botGameIds`, messages `add-bot`, `remove-bots`, `remove-player` (Task 2).

- [ ] **Step 1: Seat rows.** A bot row shows the `tag` "computer" after the name, no "ready" text, and for the host the existing remove button (no `confirm()` for bots).
- [ ] **Step 2: Add button.** Host only, when `botGameIds` includes `room.gameId` and seats < `room.maxSeats`: a button "Add computer" under the seat list and the line "Computers play by the same rules. They only see their own cards." in `muted`. At the max, the button shows disabled.
- [ ] **Step 3: Game list.** When any bot is seated, games not in `botGameIds` are disabled for the host with the meta line "Remove computers to play this" (same slot as the "Up to N players" warning). The dialog shows one "Remove computers" button above the sections, which sends `remove-bots`.
- [ ] **Step 4: Start.** If bots are seated and `room.gameId` isn't in `botGameIds`, the start button is disabled with that same line.
- [ ] **Step 5: Docs.** `docs/games/rooms.md`: who can add computers, which games, that they only see their own cards, that a person always gets a seat, that bots pause when nobody is connected.
- [ ] **Step 6: Verify.** `pnpm --filter @games/web build` passes. Run the web dev server against a local `apps/server` (`pnpm dev`; if the ports are busy, run Vite on another port with `--strictPort`) and drive headless Chrome over CDP (a small script in the session scratchpad) at 360px: create a room via `/#owner=dev`, add 3 computers, open the game list, screenshot both. Check: no horizontal scroll, the tag and button render, blocked games show the line.
- [ ] **Step 7: Commit** `Lobby: add and remove computer players`.

---

### Task 5: Crazy Eights bot (pilot)

**Files:**
- Create: `games/crazy-eights/server/bot.ts`
- Modify: `games/crazy-eights/server/game.ts` (wire `bot` on `crazyEightsGame`)
- Test: `games/crazy-eights/test/bot.test.ts`
- Modify: `apps/server/test/games.test.ts` (registry list of bot games)
- Modify: `docs/games/crazy-eights.md`, `AGENTS.md` (new section "Adding a game: computer players")

**Interfaces:**
- Consumes: `GameBot`, `BotView`, `BotContext` (Task 1); `playBots` (Task 1); `CrazyEightsPublicState`, `CrazyEightsPrivateState`, `CrazyEightsAction` from `games/crazy-eights/shared/types.ts`.
- Produces: `export const crazyEightsBot: GameBot<CrazyEightsPublicState, CrazyEightsPrivateState, CrazyEightsAction>`.

Strategy (average person): not its turn → `null`. With `playableCardIds`: most of the time play a non-8 playable card, preferring the suit it holds most of and higher ranks first; keep 8s for when nothing else plays; when playing an 8, call the suit it holds most of (ignoring the 8s). About 1 in 8 moves, play a random playable card instead (an 8 still calls its best suit). Nothing playable and `canDraw` → `draw`. Nothing playable and no draw → `null` (the game's own pass handles it; check `settle` in `game.ts` and keep the all-bot test green).

- [ ] **Step 1: Write the failing tests** in `games/crazy-eights/test/bot.test.ts`:
  - `plays a matching non-8 before an 8`, `calls the suit it holds most`, `draws when nothing plays`, `does nothing when it isn't its turn` (hand-built views).
  - `all-bot games finish` → for `players` in [2, 4, 7] and seeds 1..200: `playBots(crazyEightsGame, { players, seed })` → `outcome` not null, `rejected` empty, `stuck` empty.
  - `stays fast` → total time of 200 four-player games / total moves is under 1 ms per `decide`.
- [ ] **Step 2: Run to see them fail.** `pnpm vitest run games/crazy-eights/test/bot.test.ts` → FAIL.
- [ ] **Step 3: Implement `crazyEightsBot`** and set `bot: crazyEightsBot` on `crazyEightsGame`.
- [ ] **Step 4: Registry.** In `apps/server/test/games.test.ts` add `it("lists exactly the games with computer players")` comparing `Object.keys(all).filter((id) => all[id]!.bot)` to `["crazy-eights"]` (sorted), with a comment that adding bots to a game updates this list on purpose.
- [ ] **Step 5: Docs.** `docs/games/crazy-eights.md`: one line saying computers can play. `AGENTS.md`: a short "Adding a game: computer players" section: optional `bot.decide` from views only, pure, a few ms; an all-bot `playBots` test over many seeds and table sizes; update the registry list; one docs line.
- [ ] **Step 6: Run** `pnpm vitest run games/crazy-eights apps/server/test` → PASS. Typecheck.
- [ ] **Step 7: Commit** `Crazy Eights: computer players`.

---

## After Task 5

The whole-branch review runs, then the user plays Crazy Eights against computers by hand. Part 2 (the other 11 games) gets its own plan after that, informed by the pilot.
