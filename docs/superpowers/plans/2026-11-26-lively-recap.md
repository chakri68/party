# Lively Recap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add voice, room and game-log awards ("Around the table", On a roll, Rivals) and a loudest-moment line to the party recap.

**Architecture:** Phones send `voice-talk` on/off when they start and stop talking. The room (`runtime.ts`) times the bursts through a small in-memory `TableTally` (`apps/server/src/table.ts`), and writes closed counts into a new optional `party.table` on the `PartyLog`. `buildRecap` (pure, in game-core) turns `party.table` and the game log into the new awards. The shell shows them on the recap screen, in the share text and in the picture.

**Tech Stack:** TypeScript, Cloudflare Durable Objects, vitest, plain DOM views.

**Spec:** `docs/superpowers/specs/2026-11-26-lively-recap-design.md`

## Global Constraints

- No audio leaves the phone. Only `voice-talk` on/off (plus a peak level 0..1, 2 places) is sent.
- Talk events never bump the room version, never send an update, and persist at most once every 30 s (`TABLE_PERSIST_MS = 30_000`).
- Table counts never appear in room state or in any message to phones except through `recap`.
- Computer players are never counted.
- All new stored fields are optional and created with `??=`, so old stored rooms load.
- Copy: short, plain words, no idioms, no emoji. Exact strings below are fixed.
- Bump `PROTOCOL_VERSION` from 14 to 15.
- Work on a branch off `master` (`lively-recap`). Never on `product`.
- Run the full suite with `pnpm test` and `pnpm typecheck` before each commit.

## Review Focus

1. A phone that disconnects mid-burst (never sends `off`): the burst must close when the seat leaves the voice roster, counted up to the 2-minute cap. Test in Task 4.
2. A seat that turned counting off but keeps sending `voice-talk` (old tab, bug): ignored, and never scored for any voice award, including Quiet but strong. Tests in Tasks 3 and 4.
3. A host mute during a burst: the burst closes at the mute, not later. Test in Task 4.
4. An old stored room with no `party.table` and recaps built from old logs: no crash, `table` is `[]`, `moment` is null. Test in Task 1.
5. Toggling a chat reaction on and off many times: only adds count; the chat rate limit and `react` path still behave as today. Test in Task 4.

---

### Task 1: Recap awards in game-core

**Files:**
- Create: `packages/game-core/src/table.ts`
- Modify: `packages/game-core/src/recap.ts`, `packages/game-core/src/index.ts` (export `./table.ts`)
- Test: `packages/game-core/test/recap.test.ts`

**Interfaces:**
- Produces (in `table.ts`):
  ```ts
  export const TABLE_KEYS = ["talkMs", "overTalks", "offTurnMs", "winTalkMs", "voiceMs", "peak", "sounds", "reactions", "chats"] as const;
  export type TableKey = (typeof TABLE_KEYS)[number];
  export type TableCounts = Partial<Record<TableKey, number>>;
  export interface TableLog {
    seats: Record<string, TableCounts>;
    /** Most people talking at once, and the game on then (null: lobby or results). First time it was reached. */
    loudest: { count: number; gameId: string | null } | null;
    /** Seats that ever had counting on. Only these can win a voice award. */
    counted: string[];
  }
  export function emptyTableLog(): TableLog;
  ```
- Produces (in `recap.ts`): `PartyLog.table?: TableLog`; `Recap.table: RecapAward[]`; `Recap.moment: { count: number; gameId: string | null } | null`.

- [ ] **Step 1: Write failing tests** in `packages/game-core/test/recap.test.ts`, building logs by hand:
  - `on a roll`: player wins games 1, 2, 4 and 5 of 5 they played, with game 3 lost → no award (best run 2). Wins 3 in a row, with a game they were not in between the 2nd and 3rd → award `{ id: "streak", title: "On a roll", line: "Won 3 games in a row." }`.
  - `rivals`: A beats B in 3 games, B beats A in 2 (both played, one winner, the other not) → `{ id: "rivals", title: "Rivals", who: ["A", "B"], line: "Beat each other 3 and 2 times." }`. Equal 2 and 2 → `"Beat each other 2 times each."`. 2 and 1 → no award.
  - The 5-award cap: a log where five current rules qualify plus a streak → streak is left out (the new ones come after `RULES`).
  - `table awards`: with `table.seats` and `counted` set, assert each row's id, title and line from this table, at exact thresholds (at the minimum qualifies, one below does not):

    | id | title | score | min | line |
    |---|---|---|---|---|
    | chatty | Most talkative | talkMs | 180000 | `Talked for ${floor(min)} minutes.` |
    | overtalk | Talks over people | overTalks | 8 | `Started talking over someone ${n} times.` |
    | backseat | Backseat player | offTurnMs | 120000 | `Talked for ${floor(min)} minutes on other people's turns.` |
    | dj | DJ of the night | sounds | 10 | `Played ${n} sounds.` |
    | shout | Biggest shout | peak, only seats with talkMs >= 60000 | > 0 | `Had the loudest shout of the night.` |
    | speech | Victory speech | winTalkMs | 30000 | `Talked the most after winning.` |
    | hype | Most excited | reactions | 10 | `Sent ${n} reactions.` |
    | typist | Most messages | chats | 15 | `Sent ${n} chat messages.` |
    | quiet | Quiet but strong | lowest talkMs among seats with voiceMs >= 900000 and wins >= 2 | — | `Said the least, and still won ${wins} games.` |

  - Voice rows (chatty, overtalk, backseat, shout, speech, quiet) skip seats not in `counted`, even with counts present.
  - At most 3 table awards, and at most 2 of them voice rows: a log where chatty, overtalk, backseat and dj all qualify → `["chatty", "overtalk", "dj"]`.
  - Spread across both lists: the Champion who is also top talker gives way to a counted seat within 10% (talkMs 200000 vs 185000 → the second gets chatty); at 20% behind they don't. Peak: within 0.05.
  - `moment`: `loudest.count` 3 → `{ count: 3, gameId: "overheat" }`; 2 → null.
  - Old log without `table` → `table: []`, `moment: null`, no throw. `quiet` is null when only table awards exist.

- [ ] **Step 2: Run to see them fail**: `pnpm vitest run packages/game-core/test/recap.test.ts`. Expected: FAIL (no `table` on Recap, no streak award).

- [ ] **Step 3: Implement.** In `recap.ts`, pull the pick-and-spread loop out into `pickAwards(rules, order, ctx, awarded, limit, voiceLimit?)`, where each rule gets `near(top: number, best: number): boolean` (default `best >= top - 1`, times use `best >= top * 0.9`, peak uses `best >= top - 0.05`) and an optional `voice: true`. Run `RULES`, then the streak rule, then rivals (pair search: the highest smaller count, ties broken by the larger sum, then the earlier pair in `order`; `who[0]` is the one with more wins over the other; both go into `awarded`), all under `MAX_AWARDS`. Then the table rows with limit 3 and voice limit 2, sharing `awarded`. Quiet is a special case: eligible seats only, pick the lowest talkMs, ties up to `MAX_TIED`, no spreading. `quiet` text stays as today but is set only when both lists are empty.

- [ ] **Step 4: Run the tests**: `pnpm vitest run packages/game-core`. Expected: PASS, including the old recap tests.

- [ ] **Step 5: Commit**: `git commit -m "Recap: table awards, On a roll and Rivals"`

### Task 2: Wire messages

**Files:**
- Modify: `packages/protocol/src/index.ts`
- Test: `packages/protocol/test/voice.test.ts`

**Interfaces:**
- Produces:
  ```ts
  | { type: "voice-join"; muted: boolean; count: boolean }
  | { type: "voice-talk"; on: true }
  | { type: "voice-talk"; on: false; peak: number }
  | { type: "voice-count"; on: boolean }
  export const VOICE_TALK_LIMIT = { burst: 30, windowMs: 10_000 };
  export const PROTOCOL_VERSION = 15;
  ```

- [ ] **Step 1: Failing parse tests**: `voice-join` without `count` parses with `count: true`; with `count: false` keeps it; `voice-talk {on:true}` ok; `{on:false, peak:0.4567}` gives `peak: 0.46`; peak `-0.1`, `1.5`, `"x"`, or missing on `off` → null; `voice-count` needs a boolean `on`. `voice-self-mute` still parses as before.
- [ ] **Step 2: Run**: `pnpm vitest run packages/protocol`. Expected: FAIL.
- [ ] **Step 3: Implement** the parse cases. Split `voice-join` out of the shared case with `voice-self-mute`. Bump the version.
- [ ] **Step 4: Run** `pnpm vitest run packages/protocol` and `pnpm typecheck`. Expected: protocol PASS. Typecheck errors at the client's `voice-join` sends are fine until Task 5. Add `count: true` there now so typecheck passes.
- [ ] **Step 5: Commit**: `git commit -m "Protocol: voice-talk and voice-count"`

### Task 3: TableTally

**Files:**
- Create: `apps/server/src/table.ts`
- Test: `apps/server/test/table.test.ts`

**Interfaces:**
- Consumes: `TableLog`, `TableKey` from `@games/game-core`.
- Produces:
  ```ts
  export const TALK_BURST_CAP_MS = 120_000;
  export const TABLE_PERSIST_MS = 30_000;
  export interface TalkContext { gameId: string | null; offTurn: boolean; afterWin: boolean }
  /** In memory: open bursts and open voice sessions. Counts land in the TableLog passed in. */
  export class TableTally {
    setCounting(log: TableLog, id: string, on: boolean, now: number): void; // on adds id to log.counted, starts a voice session; off closes burst and session
    counting(id: string): boolean;
    talkOn(log: TableLog, id: string, now: number, ctx: TalkContext): void; // ignored if not counting or already open
    /** Closes this seat's burst. `peak` is the phone's; null when the room closes it (leave, mute). Returns true if anything was counted. */
    talkOff(log: TableLog, id: string, now: number, peak: number | null): boolean;
    /** Closes burst and voice session: left voice or disconnected. */
    drop(log: TableLog, id: string, now: number): void;
    open(): string[];
    bump(log: TableLog, id: string, key: "sounds" | "reactions" | "chats"): void;
  }
  ```

- [ ] **Step 1: Failing tests** (fake times):
  - on at 0, off at 5000 → `talkMs` 5000. Off at 300000 → `talkMs` 120000 (cap).
  - B turns on while A is open → B gets `overTalks` 1, A gets none. `loudest` is `{count: 2, gameId}` from B's context; a later 2 doesn't replace it; a 3 does.
  - `offTurn` ctx → the same ms also in `offTurnMs`; `afterWin` → `winTalkMs`.
  - `peak` is kept only from bursts of at least 1000 ms, and only the highest. `talkOff(..., null)` counts time but no peak.
  - Not counting → `talkOn` does nothing. `setCounting(false)` mid-burst closes it and counts it.
  - `voiceMs`: counting on at 0, `drop` at 60000 → 60000. Off then on again adds both stretches.
  - `bump` adds to the seat and does not need counting on.
- [ ] **Step 2: Run**: `pnpm vitest run apps/server/test/table.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `TableTally` (two `Map`s: open bursts `{start, ctx}` and session starts).
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit**: `git commit -m "Server: TableTally for talk and room counts"`

### Task 4: Room wiring

**Files:**
- Modify: `apps/server/src/runtime.ts`
- Test: `apps/server/test/table-room.test.ts` (use `harness.ts`, the `toyGame` from `bot-toy.ts`, like `voice.test.ts`)

**Interfaces:**
- Consumes: Task 2 messages, Task 3 `TableTally`, Task 1 `emptyTableLog`.

- [ ] **Step 1: Failing tests** through the room:
  - Join voice with `count: true`, `voice-talk on`, advance the world clock 10 s, `off` → after End party, `recap.table`/the underlying `data.party.table.seats[id].talkMs` is 10000. Read the stored data through the harness the way `recap.test.ts` does.
  - No message sent to any phone after `voice-talk` (no update, no version change), and `voice-talk` causes no storage write when the last table write was under 30 s ago; one after 30 s.
  - `voice-talk` from a seat not in voice, or self-muted, or host-muted, or with counting off → nothing counted.
  - Disconnect mid-burst (seat drops from the roster via `pruneVoice`) → burst closed and counted up to the cap.
  - Host mute mid-burst → counted up to the mute time.
  - `offTurn`: in a toy game awaiting only the other seat, talk counts into `offTurnMs`; when awaiting includes me, it doesn't; with awaiting empty it doesn't.
  - `afterWin`: talk on results after winning counts into `winTalkMs`.
  - Sound relayed → `sounds` 1; one dropped by the cooldown → not counted. Emote → `reactions` 1. React add then remove → `reactions` 1. Chat sent → `chats` 1.
  - The room state each phone gets (public, private, snapshot) contains none of the `TABLE_KEYS` names.
  - Over `VOICE_TALK_LIMIT` → extra messages dropped silently.
- [ ] **Step 2: Run**: `pnpm vitest run apps/server/test/table-room.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `private tally = new TableTally()` and `private lastTablePersist = 0` on the runtime (in memory). `table(): TableLog` returns `((data.party ??= emptyPartyLog()).table ??= emptyTableLog())`. Every count also sets `party.names[id] = seat.name`.
  - `voice-join`: after the roster change, `tally.setCounting(table, seat.id, msg.count, now)`.
  - `voice-count`: in voice only; `setCounting`. No persist.
  - `voice-talk`: in voice, not muted, `allow("talk", seat.id, VOICE_TALK_LIMIT)`. `on` → `talkOn` with ctx `{ gameId: phase === "playing" ? data.game.gameId : null, offTurn: phase === "playing" && awaiting.length > 0 && !awaiting.includes(id), afterWin: phase === "results" && party.games.at(-1)?.winnerIds.includes(id) }`. `off` → `talkOff`, then the throttled persist: `if (now - lastTablePersist >= TABLE_PERSIST_MS) { lastTablePersist = now; await this.persist(); }`.
  - `flushVoice`: after pruning, for each id in `tally.open()` or counting: not in the roster → `drop`; muted → `talkOff(..., null)`. This one hook covers leave, disconnect, host mute, self mute and End party.
  - Count `sounds` after both `allow` checks pass, `reactions` in `emote` after its `allow` and in `react` only on add, `chats` after the line is stored. Skip bot seats.
- [ ] **Step 4: Run** `pnpm test` and `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit**: `git commit -m "Room: count talk, sounds, reactions and chat for the recap"`

### Task 5: Phone sends talk events

**Files:**
- Modify: `apps/web/src/voice/prefs.ts`, `apps/web/src/voice/voice.ts`, `apps/web/src/views/voice-bar.ts`
- Test: `apps/web/test/voice/voice.test.ts`, `apps/web/test/voice/prefs.test.ts`, `apps/web/test/voice-bar.test.ts`

**Interfaces:**
- Consumes: Task 2 messages.
- Produces: `VoicePrefs.countTalk: boolean` (default `true`).

- [ ] **Step 1: Failing tests** with the existing fakes (fake mic level, fake clock):
  - `voice-join` carries `count: prefs.countTalk`.
  - The mic level goes over `SPEAK_ON` while published → one `{type:"voice-talk", on:true}`. It drops and the speaking hold runs out → one `{on:false, peak}` with the highest level seen, rounded to 2 places. No repeats while the state stays the same.
  - Push-to-talk released mid-burst (published goes null) → `off` sent at once.
  - Not published (muted, PTT not held) and loud mic → nothing sent.
  - `countTalk: false` → no `voice-talk` ever. Changing it while joined → `{type:"voice-count", on}`, plus `off` first if a burst is open.
  - Leaving voice mid-burst sends no `off` (the room closes it).
  - Settings sheet has a checkbox "Count my talk time for the recap" bound to `countTalk`. Old saved prefs without the field read as `true`.
- [ ] **Step 2: Run**: `pnpm vitest run apps/web/test/voice apps/web/test/voice-bar.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** in `tick()`: track the self seat's `speaking` changes together with `!!this.published && this.prefs.countTalk`. Keep a running `peak` for the open burst. Send through `this.guard` like other sends. Handle `countTalk` changes in `updatePrefs`.
- [ ] **Step 4: Run** `pnpm test` and `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit**: `git commit -m "Voice: send talk start and stop for the recap"`

### Task 6: Show it, and docs

**Files:**
- Modify: `apps/web/src/views/recap.ts`, `apps/web/src/views/recap-image.ts`, the recap CSS next to them, `docs/games/rooms.md`
- Test: `apps/web/test/recap.test.ts`, `apps/web/test/recap-image.test.ts`

**Interfaces:**
- Consumes: `Recap.table`, `Recap.moment` (Task 1). Game names come through the existing `gameName(id)` used by `recapMeta`.
- Produces: `export function momentText(moment: NonNullable<Recap["moment"]>, gameName: (id: string) => string): string`.

- [ ] **Step 1: Failing tests**:
  - `momentText({count:5, gameId:"overheat"}, ...)` → `"Loudest moment: 5 people talking at once, in Overheat."`. With `gameId: null` → `"Loudest moment: 5 people talking at once, in the lobby."`.
  - The recap screen shows a heading "Around the table" and the table awards after the main awards, then the moment line. No heading when `table` is empty.
  - `recapShareText` lists table awards after the main ones in the same `Title: Names.` form. The moment line is not in the share text. A recap with only table awards no longer falls back to the "N games tonight." text.
  - Picture: with 5 main awards, 3 table awards and a moment, every line stays inside `IMAGE_HEIGHT`. If it can't fit, the moment line is dropped first (test both).
- [ ] **Step 2: Run**: `pnpm vitest run apps/web/test/recap.test.ts apps/web/test/recap-image.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the screen section, the share text, and the picture layout (shrink spacing before dropping anything).
- [ ] **Step 4: Docs**: in `docs/games/rooms.md`, in the recap part, add On a roll and Rivals to the award examples. Add a short "Around the table" paragraph: up to three awards from the room, like **Most talkative**, **DJ of the night** or **Most excited**, plus the loudest moment. Then: "Voice counts only how long you talk, never what you say. Nothing is recorded. To turn it off, open voice settings and turn off **Count my talk time for the recap**."
- [ ] **Step 5: Run** `pnpm test` and `pnpm typecheck`. Expected: PASS.
- [ ] **Step 6: Commit**: `git commit -m "Recap: Around the table section and loudest moment"`
