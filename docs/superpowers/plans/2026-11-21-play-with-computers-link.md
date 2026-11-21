# Play with Computers Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A link (`?game=<id>&computers=<n>`) whose create button makes a room already on that game with computers seated.

**Architecture:**
- `POST /api/rooms?game=&computers=` hands a `RoomSetup` to the room's `claim`, which picks the game and seats the computers in the same write.
- Each game's manifest says whether it has computer players, so the client and CouchParty can tell without a room.
- CouchParty adds gallery links on its own branch.

**Tech Stack:** TypeScript, Cloudflare Workers + Durable Objects (partyserver), Vite, Vitest.

**Spec:** docs/superpowers/specs/2026-11-21-play-with-computers-link-design.md

## Global Constraints

- Shared code lands on `master` (tasks 1-3). Task 4 runs on the `product` branch, in the `../party-product` worktree, after master is merged into it.
- A bad setup never errors. That covers an unknown game, a game with no computers, a game locked for the tier, and a missing or bad count. The room is then a normal empty one on the default game.
- The count is clamped to `1..maxSeats(def) - 1`. The default is `max(1, (bestMinPlayers ?? minPlayers) - 1)`.
- Computers seated at creation are exactly like `add-bot` ones: the same names, ids and fields, made through one shared helper.
- The first person who joins becomes host, as today. Computers are never host.
- Nothing makes a room without a tap. A page load, a reload or a link preview must never create one.
- Copy: short plain sentences, basic words, no idioms, no emoji (Indian ESL readers).
- `PROTOCOL_VERSION` changes only if a wire message or room-state shape changes. The query string is HTTP and not part of the protocol.
- Commit trailer, exactly:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01KwNUn8AHWzbftW559ZRTih

## Review Focus

1. A setup for a game the free tier locks: the room must start on the default game with no computers. Today no game with computers is locked, so test it with a fixture.
2. A huge or negative `computers`, or a non-number: the count is clamped or falls back to the default, and never exceeds the free 8-seat cap.
3. A person joins a room made with 3 computers in a 4-max game: they get the seat, are host, and no computer is bumped needlessly. Today's lobby rule bumps the newest computer only when the table is full.
4. The cleanup timer for a room nobody joins still fires. Computers do not count as people.
5. The create button keeps the setup after a failed try. For example, a Turnstile failure leaves "Play Cheat with computers" in place for a retry.

---

### Task 1: Manifests say which games have computers

**Files:**
- Modify: `packages/game-core/src/index.ts` (`GameManifest`)
- Modify: the manifest in `games/<id>/shared/` for each of the 12 bot games: cheat, crazy-eights, farkle, go-fish, holdem, liars-dice, oh-hell, old-maid, overheat, president, sevens, thorns
- Test: `apps/server/test/games.test.ts`
- Modify: `AGENTS.md` ("Adding a game: computer players", step 1)

**Interfaces:**
- Produces: `GameManifest.computers?: true`. JSDoc: "The game has computer players (its definition sets `bot`). A test keeps the two in step."

- [ ] Test: in "lists exactly the games with computer players", also assert that for every game in `gamesFor({ blindRally: true, treasureHunt: true })`, `!!def.manifest.computers === !!def.bot`.
- [ ] Run it and watch it fail. Add the field and set `computers: true` on the 12 manifests. Run `pnpm vitest run apps/server/test/games.test.ts` and `pnpm -r --no-bail typecheck`.
- [ ] AGENTS.md step 1: "...set it as `bot` on the definition, and set `computers: true` on the manifest."
- [ ] Commit "Games: manifests say which games have computers".

### Task 2: A room can start on a game with computers seated

**Files:**
- Modify: `apps/server/src/runtime.ts` (`RoomSetup`, `claim`, a shared bot-seat helper used by `add-bot`)
- Modify: `apps/server/src/worker.ts` (`/api/rooms` reads the query and passes it to `claim`)
- Test: `apps/server/test/` (the runtime harness tests, and worker tests next to the existing `/api/rooms` ones)
- Modify: `docs/games/rooms.md` (one or two plain lines on the link)

**Interfaces:**
- Consumes: Task 1's `manifest.computers`. Not required on the server, which uses `def.bot`.
- Produces:
  - `export interface RoomSetup { gameId: string; computers?: number }`, exported from runtime.ts.
  - `claim(grant?: RoomGrant, setup?: RoomSetup): Promise<boolean>`.
  - `export function parseRoomSetup(url: URL): RoomSetup | undefined` in worker.ts. It is `undefined` without `game`. `computers` is parsed as an integer, or left undefined if missing or not a number.
  - The room stub's `claim` is called with the setup.
  - Check the product server: it calls `createFetch`, so it picks this up for free. Its tests must still pass, but it lives on the product branch, so leave a note in the report.

- [ ] Tests (runtime):
  - Claim with `{ gameId: "cheat" }`: the room's `gameId` is "cheat", there are 3 bot seats (Cheat's bestMin is 4), and the settings are Cheat's defaults.
  - `computers: 2` gives 2. `computers: 99` is clamped to `maxSeats - 1`. `computers: 0` and `-3` give 1.
  - Unknown game, a game without `bot` (e.g. "scribbl"), and a game locked for a free tier all give the default room with no seats.
  - A person who joins next is host and owner as today. The bots keep their seats.
  - The cleanup timer is still set.
- [ ] Tests (worker): `parseRoomSetup` with `?game=cheat&computers=3`, `?game=cheat`, `?computers=3` (undefined), and `?game=cheat&computers=abc` (no count). `/api/rooms?game=cheat` passes the setup to `claim`. Use the existing `getRoom` stub option.
- [ ] Implement:
  - Pull the seat-making out of `add-bot` into `private seatBot(): Seat`, or a nearby equivalent, and use it in both places.
  - In `claim`, after building `data`, apply a valid setup: set `gameId` and `settings` to `def.defaultSettings`, then push N bot seats.
  - Check the tier lock with the same rule as `lockedGameIds`, against `grant.tier`.
- [ ] Run `pnpm vitest run apps/server/test` and typecheck. Commit "Rooms: start on a game with computers seated".

### Task 3: The home screen offers "Play <game> with computers"

**Files:**
- Modify: `apps/web/src/views/home.ts`
- Modify: `apps/web/src/shell.ts` (`ShellOptions.createRoom` takes an optional setup; the default creator adds it to the query)
- Test: `apps/web/test/` (a new `home-setup.test.ts` or next to `shell.test.ts`, using the existing test style)

**Interfaces:**
- Consumes:
  - Task 1's `games[id].manifest.computers`, via the web `games` registry.
  - Task 2's query names `game` and `computers`.
- Produces:
  - `export interface RoomSetup { gameId: string; computers?: number }` in shell.ts. It is a client copy, the same shape as the server's.
  - `ShellOptions.createRoom?: (setup?: RoomSetup) => Promise<{ code: string } | { error: string; forgetKey?: boolean }>`.
  - `export function setupFromUrl(url: URL): RoomSetup | undefined` in shell.ts or home.ts. It returns the setup only when `games[id]?.manifest.computers` is set. `computers` must be a positive integer, else it is left out.

- [ ] Tests:
  - `setupFromUrl` with a known bot game, an unknown id, a non-bot game, and a bad count.
  - The default creator posts to `/api/rooms?game=cheat&computers=3`. Stub `fetch`.
  - The home view's create button reads "Play Cheat with computers" when the address has `?game=cheat`, and "Create room" otherwise. It keeps that text after a failed create.
- [ ] Implement:
  - The home view reads the setup once from `location` on mount.
  - Only the label and the `createRoom(setup)` argument change. The join form is untouched.
  - The name rule is unchanged: a name is still needed first.
- [ ] Run `pnpm vitest run apps/web` and typecheck. Commit "Home: a link can open a room on a game with computers".

### Task 4 (product branch): CouchParty links each computer game

Runs in `../party-product` on branch `product`, after master (Tasks 1-3) is merged in.

**Files:**
- Modify: `apps/product-web/src/gallery.ts` (`GalleryGame.computers: boolean`; the card adds `<a class="game-try" href="/play?game=<id>">Play with computers</a>` when set)
- Modify: `apps/product-web/src/create-room.ts`, `apps/product-web/src/api.ts` (pass the setup through to `/api/rooms?...`)
- Modify: `apps/product-web/src/site.css` or `product.css` (style the link in the existing card style)
- Test: `apps/product-web/test/` (gallery model and HTML; roomCreator passes the setup; api builds the query)

- [ ] Tests first, as listed.
- [ ] Implement.
  - `roomCreator` returns `(setup?) => ...`, and both attempts pass the setup.
  - `createRoom(token, setup?)` adds `?game=&computers=` when there is a setup.
- [ ] Run `pnpm vitest run apps/product-web apps/product-server` and typecheck. Commit "CouchParty: play with computers from the game list".
