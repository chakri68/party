# Party Recap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The host ends the party; everyone sees a recap of the night with awards; CouchParty adds "host your own party" prompts.

**Architecture:** Games report per-player counts through a new optional `partyStats` hook. The room runtime logs each finished game in `RoomData.party`, and a pure `buildRecap` in game-core turns the log into awards. A new `ended` room phase carries the recap to every client. The web shell draws it and hands a slot to the host app through a new `partyOver` shell hook.

**Tech Stack:** TypeScript, Cloudflare Durable Objects (room runtime), Vite web client, vitest, pnpm monorepo.

**Spec:** `docs/superpowers/specs/2026-11-13-party-recap-design.md`

## Branches

- Tasks 1–7 are shared code: branch `party-recap` off `master`, in the worktree `../games-recap`. Fast-forward `master` when done.
- Task 8 is product-only: merge `master` into `product` (worktree `../games-product`), then build there. Push both branches.

## Global Constraints

- Copy: short, plain sentences, basic words, no idioms (simple Indian English). No emoji in the UI; icons are SVG.
- Animate pop-ins (the award cards rise in one after another). With reduced motion, everything shows at once. No gradients.
- `PROTOCOL_VERSION` goes from 6 to 7 (the phase and message sets change).
- The log keeps at most 50 games. Award ties name up to 3 people; with more than 3 tied, skip the award. At most 5 awards.
- Computer players (ids in `GameOutcome.names`, not in room seats) never get awards and are left out of the log.
- No browser `confirm()` for End party: an inline confirm.

## Review Focus

1. **A player leaves before End party.** The recap still names them, from `party.names`. The test lives in Task 2 (`buildRecap` with a name that has no seat).
2. **Rejoining an ended room** with a resume token, or a stranger opening the link. Both get the recap, and the room cap does not turn them away. Task 3 test.
3. **The host drops right after End party.** The phase stays `ended`. No one can start a game, even after host migration. Task 3 test (`start-game` from the new host is refused).
4. **A game ended with "Back to lobby" from results.** It was already logged when it finished, and it must not be logged twice. Task 3 test.
5. **Old stored rooms** without `party` load and play. The log starts empty on the first finished game. Task 3 test.

---

### Task 1: Stat keys and the `partyStats` hook (game-core)

**Files:**
- Modify: `packages/game-core/src/index.ts`
- Test: `packages/game-core/test/stats.test.ts`

**Interfaces:**
- Produces:
  - `export const STAT_KEYS = ["liesTold","liesUncaught","rightCalls","wrongCalls","bigBids","votesAgainst","survivedAsBad","fooled","firstGuesses"] as const`
  - `export type StatKey = (typeof STAT_KEYS)[number]`
  - `export type PartyStats = Record<string, Partial<Record<StatKey, number>>>`
  - `export function bumpStat(stats: PartyStats, playerId: string, key: StatKey, by = 1): void`, which mutates in place, for games to keep counts in their state.
  - On `GameDefinition`: `partyStats?(state: TState): PartyStats`, documented as "Counts for the party recap, per player. Read once, when the game finishes."

- [ ] Test: `bumpStat` creates the player and the key, adds `by`, and leaves other players alone.
- [ ] Implement, run `pnpm vitest run packages/game-core`, and commit: "Game core: party stat keys and the partyStats hook".

### Task 2: `buildRecap` (game-core)

**Files:**
- Create: `packages/game-core/src/recap.ts`, exported from `index.ts`
- Test: `packages/game-core/test/recap.test.ts`

**Interfaces:**
- Produces:
```ts
export interface PartyGame { gameId: string; endedAt: number; players: string[]; winnerIds: string[]; loserIds?: string[]; stats: PartyStats }
export interface PartyLog { startedAt: number | null; games: PartyGame[]; names: Record<string, string>; endedAt: number | null }
export interface RecapAward { id: string; title: string; who: string[]; line: string }
export interface Recap { gamesPlayed: number; minutes: number; topGameId: string | null; awards: RecapAward[]; quiet: string | null }
export const PARTY_LOG_MAX = 50;
export function emptyPartyLog(): PartyLog;
/** Null when no game finished. `now` stands in for endedAt when unset. */
export function buildRecap(log: PartyLog, now: number): Recap | null;
```
- `minutes` = round((endedAt − startedAt) / 60000). `topGameId` = the most-logged gameId. On a tie, the one played most recently wins.
- `quiet` is `"Quiet night. Play more to earn awards."` when `awards` is empty; otherwise null.

**Award table.** Tried in this order; titles and lines are exact. Sum each stat over all games.

| id | title | score | min | line (one person) | line (tie) |
|---|---|---|---|---|---|
| champion | Champion of the night | wins | 2 | `Won ${w} of ${played} games.` | `Won ${w} games each.` |
| liar | Biggest liar | liesUncaught if anyone has ≥3, else liesTold | 3 | `Told ${told} lies. Got away with ${uncaught}.` (drop the second sentence when uncaught is 0) | same, built from the first named person's counts |
| eye | Sharpest eye | rightCalls | 2 | `Called ${n} bluffs right.` | same |
| suspicious | Most suspicious | votesAgainst | 3 | `Got ${n} votes against them.` | same |
| sneaky | Best actor | survivedAsBad + fooled | 2 | `Fooled the table ${n} times.` | same |
| bold | Boldest bidder | bigBids | 3 | `Made ${n} big bids.` | same |
| quick | Fastest guesser | firstGuesses | 2 | `Guessed first ${n} times.` | same |
| trusting | Too trusting | wrongCalls | 3 | `Called ${n} bluffs wrong.` | same |

**Picking.** For each award, candidates are players with score ≥ min. If every top scorer already has an award, look at the players without one: if their best score is at least the top − 1 (and ≥ min), take them instead. Name everyone at the chosen score. More than 3 named: skip. Stop at 5 awards. `who` holds names from `log.names`, in the order the players first appear in the log.

- [ ] Tests:
  - every award fires at its min and not one below
  - the liar falls back to liesTold
  - a 2-way tie names both
  - a 4-way tie skips the award
  - the cap is 5
  - spread: A tops `eye` by 1 but already holds `champion`, so B gets `eye`
  - an empty log returns null
  - a name with no current seat is still used (Review Focus 1)
  - `quiet` is set when nothing qualifies
  - `topGameId` and `minutes`
- [ ] Implement, run, and commit: "Game core: party recap awards".

### Task 3: Runtime, the party log and `end-party` (protocol + server)

**Files:**
- Modify: `packages/protocol/src/index.ts`, `apps/server/src/runtime.ts`
- Test: `apps/server/test/recap.test.ts` (uses `test/harness.ts`)

**Interfaces:**
- Consumes: `PartyLog`, `emptyPartyLog`, `buildRecap`, `PARTY_LOG_MAX`, `Recap` (Task 2).
- Produces (protocol):
  - `RoomPhase` adds `"ended"`.
  - `RoomPublicState.recap: Recap | null`, set only in `ended`.
  - `ClientMessage` adds `{ type: "end-party" }`, parsed with the other no-payload messages.
  - `PROTOCOL_VERSION = 7`.

**Runtime changes:**
- `RoomData.party?: PartyLog`. It is optional for old rooms; create it with `??=` the first time it's needed.
- `startGame` sets `party.startedAt ??= now`.
- In `applyTransition`, where the phase becomes `results`, log `{gameId, endedAt: now, players, winnerIds, loserIds, stats}`:
  - `players` are the seat ids in the outcome's standings, falling back to all seats.
  - Ids in `outcome.names` and ids with no seat are filtered out of every field.
  - `stats` come from `def.partyStats?.(state) ?? {}`, with the same filter.
  - Add each player's seat name to `party.names`, and trim `games` to the last `PARTY_LOG_MAX`.
- `end-party` is host only, in phase `lobby` or `results`:
  - set `party.endedAt = now`
  - `game = null`, `phase = "ended"`
  - clear game timers and set no one as awaited
  - commit
- `publicState().recap` is `phase === "ended" ? buildRecap(party ?? emptyPartyLog(), now) : null`.
- `onJoin` in `ended` skips the room-full check (late viewers).
- Every other game message already checks its phase. Verify that `ended` is excluded from:
  - `ready`, `select-game`, `suggest-game`, `update-settings`
  - `start-game`, `debug-start`, `return-to-lobby`
  - `game-action`, `stream`

  Chat, react and emote stay allowed.

- [ ] Tests:
  - a finished game is logged once; "Back to lobby" from results adds no second entry (Review Focus 4)
  - "Back to lobby" mid-game logs nothing
  - `end-party` is refused from a non-host (`not-host`) and while playing (`wrong-phase`)
  - after `end-party`, `start-game`, `select-game` and `ready` are refused, and chat still goes out
  - after the host leaves, the new host's `start-game` is still refused (Review Focus 3)
  - a late joiner gets `phase: "ended"` and the recap, even with the room at its cap (Review Focus 2)
  - the log is capped at 50
  - a stored room without `party` finishes a game and logs it (Review Focus 5)
  - `end-party` with no finished games gives `recap: null`
- [ ] Run `pnpm vitest run apps/server packages/protocol` (the protocol version tests may need the new number), then commit: "Rooms: party log and End party".

### Task 4: Stats in Cheat and Liar's Dice

**Files:**
- Modify: `games/cheat/shared/types.ts`, `games/cheat/server/game.ts`, `games/liars-dice/shared/types.ts`, `games/liars-dice/server/game.ts`
- Test: each game's `test/game.test.ts`

Both states gain `stats: PartyStats` (start `{}`). Both definitions return it from `partyStats`, and it never appears in public or private state.

**Cheat:**
- `play`: a dishonest play (`!isHonest(cards, claim)`) adds `liesTold` for the player.
- `call`: the caller gets `rightCalls` if the play `lied`, otherwise `wrongCalls`.
- A lying play that closes its window uncalled (in `accept`) adds `liesUncaught`.

**Liar's Dice** (at the reveal, in `call`):
- Each bid in this round's bid list whose quantity is more than the revealed count adds `liesTold` for its bidder. Use the reveal's own counting rule.
- A bid whose quantity is more than the expected count adds `bigBids`. Expected = total dice × (1/3 if 1s count as wild for that face, else 1/6).
- The caller gets `rightCalls` if `success`, otherwise `wrongCalls`.

- [ ] Tests: a scripted Cheat game with 3 uncaught lies reports `liesUncaught: 3` and `liesTold: 3` for that player. A right call and a wrong call land on the right callers. A Liar's Dice round checks `liesTold`, `bigBids` and the caller's call count against a known roll (use the tests' rigged dice).
- [ ] Run both games' tests, then commit: "Cheat, Liar's Dice: party recap stats".

### Task 5: Stats in Imposter, Nightfall, Fake Word / Bluff Definitions, Doodle Dash

**Files:**
- Modify: `games/{imposter,nightfall,bluff,scribbl}/shared/types.ts` and `server/game.ts`
- Test: each game's `test/game.test.ts`

Same pattern as Task 4: `stats: PartyStats` in state, returned by `partyStats`, kept out of the projections.

- **Imposter:**
  - `closeVote`: each candidate gets `votesAgainst` for each vote on them (first vote and runoff both count).
  - `settle`: when the imposter side wins, the imposter gets `survivedAsBad`.
- **Nightfall:**
  - `closeVote`: each target gets `votesAgainst` per day vote.
  - At the end of each day, every Wolf-team player still alive and not voted out gets `survivedAsBad`.
- **Bluff** (one `game.ts` serves both games): in `reveal`, wherever `FOOLED_POINTS` is added, the author gets `fooled` +1.
- **Doodle Dash** (`scribbl`): in `guess`, when `t.guessed` was empty before the push, the guesser gets `firstGuesses`.

- [ ] Tests: one short scripted game per file asserts the counts above. Nightfall's test also checks that the counts are absent from public and private state (put it next to the existing `secrecy.test.ts` checks).
- [ ] Run, then commit: "Imposter, Nightfall, Bluff, Doodle Dash: party recap stats".

### Task 6: Recap screen and End party in the web shell

**Files:**
- Modify: `apps/web/src/shell.ts`, `apps/web/src/views/room.ts`, `apps/web/src/style.css`, `docs/games/rooms.md`
- Create: `apps/web/src/views/recap.ts`
- Test: `apps/web/test/recap.test.ts`

**Interfaces:**
- Consumes: `Recap` and `RoomPublicState.recap` (Tasks 2–3).
- Produces:
  - `ShellOptions.partyOver?(outlet: HTMLElement, ctx: { isHost: boolean; recap: Recap | null }): void`
  - `recapShareText(recap: Recap, gameName: (id: string) => string, site: string): string`, exported from `views/recap.ts`
  - `recapView(opts): HTMLElement`

**`partyOver` hook.** Add it to the `Omit` in `Config` and keep it in `shellConfig()` like `beforeStart`. The default is undefined; without it the shell shows a plain **Home** button.

**End party:**
- A `link` button "End party" for the host, under the lobby actions and the results actions.
- Tapping it swaps in an inline row: "End the party for everyone? You will see the recap." plus **End party** (sends `end-party`) and **Cancel**.

**The `ended` phase in `render()`.** Drop the game view, then:
- with a recap, show the recap screen;
- with `recap: null`, show the closed screen.

**Recap screen** (`recapView`):
- `h2` "Tonight's recap".
- A meta line, `${n} games · ${duration} · Most played: ${name}`:
  - `n === 1` reads "1 game"
  - duration is `"${m} min"` under 60, else `"${h} hr ${m} min"`
  - the "Most played" part is left out when `topGameId` is null
- One card per award: title, `who` joined with "and" in large type, then the line. Or the `quiet` line.
- **Share** button: on a coarse pointer with Web Share, `navigator.share({ text })`; otherwise copy to the clipboard and swap the label to "Copied" for 1.5 s.
- Then the `partyOver` outlet (`<div class="party-over">`), or the Home button.

**Share text:** `${appTitle} recap: ${title}: ${who}. … Play at ${location.host}`. Copy and paste as one block like the lobby's share code.

**Closed screen:**
- for `fatal` `room-not-found`, or `ended` with a null recap
- the message `FATAL_COPY["room-not-found"]` (or "This party is over." for ended)
- the `partyOver` outlet with `recap: null`, or Home

**Motion:**
- cards get `--i` and a CSS rise-in keyed on a class, staggered 80 ms
- under `prefers-reduced-motion: reduce`, no animation

**Docs:** `docs/games/rooms.md` gets a short "Ending the party" paragraph.

- [ ] Tests, for the pure functions:
  - `recapShareText` output for 2 awards
  - meta-line pieces: 1 game vs 3, 45 min vs 80 min ("1 hr 20 min"), no top game
- [ ] Run `pnpm vitest run apps/web` and `pnpm -r typecheck` (or the repo's typecheck script).
- [ ] Browser check with `pnpm dev`:
  - 3 tabs play two quick games, the host ends the party, and all three see the same recap
  - Share copies the text
  - a 4th tab opening the link sees the recap
  - check phone and desktop, light and dark
- [ ] Commit: "Web: End party and the recap screen".

### Task 7: Keep it current: the registry test and AGENTS.md

**Files:**
- Modify: `apps/server/test/games.test.ts`
- Create: `AGENTS.md`, and `CLAUDE.md` holding just `@AGENTS.md` so Claude sessions load it too

**Registry test.** Every game in the server registry must either define `partyStats` or appear in `RECAP_EXEMPT`, a `Set` in the test file whose comment says "Games with no recap stats yet. Don't add new games here: give them partyStats." Its contents are the 19 current games without stats. The failure message names the game and points to `AGENTS.md`.

**`AGENTS.md`.** Short. It covers:
- the repo layout (one line each: `games/<id>`, `apps/web`, `apps/server`, `packages/*`, `apps/product-*` on `product` only)
- the branch rule: shared code on `master`, merged into `product`
- the site copy rule
- a section **"Adding a game: party recap stats"**:
  - every new game implements `partyStats` from day one
  - which `StatKey` fits which mechanic (a table: bluffing → `liesTold`/`liesUncaught`, calling → `rightCalls`/`wrongCalls`, voting someone out → `votesAgainst`, hidden-bad role survives → `survivedAsBad`, others pick your fake → `fooled`, race to answer → `firstGuesses`, risky bids → `bigBids`)
  - keep counts in state with `bumpStat`, never in public/private state
  - add a scripted test of the counts
  - if no key fits, add a new `StatKey` and its award row in `packages/game-core/src/recap.ts` (and its test) instead of bending an old one
  - the registry test enforces this

- [ ] Run `pnpm vitest run apps/server/test/games.test.ts` and confirm it passes.
- [ ] Temporarily drop `cheat`'s `partyStats` and see the failure message, then restore it.
- [ ] Commit: "Docs: AGENTS.md, recap stats required for new games".
- [ ] Fast-forward `master` to `party-recap` and push.

### Task 8: CouchParty prompts (product)

**Files** (in the product worktree after `git merge master`):
- Create: `apps/product-web/src/party-over.ts`
- Modify: `apps/product-web/src/play.ts`, `apps/product-web/src/product.css`
- Test: `apps/product-web/test/party-over.test.ts`

**Interfaces:**
- Consumes: `ShellOptions.partyOver` (Task 6) and `me()` from `./api.ts`. Its `tier` is `"pass"` when the signed-in user holds a pass. On a failed call, treat it as no pass.
- Produces: `partyOverContent(who: "joinee" | "host" | "host-pass" | "closed"): HTMLElement`, which is pure, plus the `partyOver(outlet, ctx)` wired in `play.ts`.

**Copy, exact:**

| who | content |
|---|---|
| joinee | h3 "Your turn to host." · p "Start your own party. It is free, and your friends do not need an app." · primary link **Start a room** → `/play` · small "Want every game and 16 players? See Host Pass" with "See Host Pass" linking `/pricing` |
| host | primary link **Start a new room** → `/play` · small "Get Host Pass for every game and up to 16 players." with "Host Pass" linking `/pricing` |
| host-pass | primary link **Start a new room** → `/play` |
| closed | h3 "This party is over." · primary link **Start your own room** → `/play` · p "It is free. No app needed." |

**Choosing.** `recap === null` gives `closed`. Otherwise:
- a non-host gives `joinee`
- a host with `(await me()).tier === "pass"` gives `host-pass`
- any other host gives `host`

Render `host` first, then swap to `host-pass` with `morph` from `motion.ts`, so the slot doesn't jump.

- [ ] Tests: each `who` renders the exact text and hrefs above.
- [ ] Run `pnpm vitest run apps/product-web` and the product typecheck.
- [ ] Browser check on product dev (5174 plus wrangler dev 8788):
  - the host tab shows the Host Pass line
  - a player tab shows "Your turn to host."
  - an unknown room code shows "This party is over." and Start your own room
- [ ] Commit: "CouchParty: host-your-own prompts after the party". Push `product`.
