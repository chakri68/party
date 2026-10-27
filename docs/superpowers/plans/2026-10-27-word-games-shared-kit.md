# Word games shared kit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the dictionary, edit distance and seeded tie-break out of the single games that own them into `@games/words` and `@games/game-core`, add ballot helpers, and change no game's behaviour.

**Architecture:** A new workspace package `packages/words` with a client-safe entry (`.`) and a server-only one (`./dictionary`). Ballot helpers sit next to `shuffle` in `packages/game-core/src/index.ts`. Pass the Bomb, Scribbl and Blind Rally switch their imports to the new homes.

**Tech Stack:** TypeScript 6, pnpm workspaces, vitest 5, Cloudflare Worker (server), Vite (web).

**Spec:** `docs/superpowers/specs/2026-10-27-word-games-shared-kit-design.md`

## Global Constraints

- Commit straight to `master`, no branches. Detailed commit bodies in the repo's existing voice (see `git log`).
- `@games/words/dictionary` is server only. Nothing under `games/*/client` or `games/*/shared` may import it.
- Moves are verbatim: no behaviour change to `isWord`, `unpack`, `editDistance`, `isClose`, or the FNV hash.
- Every existing assertion survives, moved rather than deleted.
- Match surrounding comment density and naming. Comments explain why, in the repo's dry voice.

## Review Focus

- A client chunk pulling in the dictionary: the Task 2 guard test, plus the Task 4 build grep.
- A tie whose winner changes with vote order: Task 3's `tally` test casts the same votes in two orders.
- A voter who leaves mid-ballot still counting toward `strictMajority`'s denominator: Task 3's `dropVoter` test.
- `castVote` from someone outside the snapshot (a spectator, a late joiner): Task 3's `not-eligible` test.
- `cleanChatText` without `max` changing room chat: Task 4 keeps the existing 200 cap test.

---

### Task 1: `@games/words` with edit distance (from Scribbl)

**Files:**
- Create: `packages/words/package.json`, `packages/words/tsconfig.json`, `packages/words/src/index.ts`, `packages/words/test/text.test.ts`
- Modify: `games/scribbl/shared/rules.ts` (delete `editDistance`, `isClose`), `games/scribbl/server/game.ts` (import from `@games/words`), `games/scribbl/test/rules.test.ts` (drop the moved cases), `games/scribbl/package.json` (add dep)

**Interfaces:**
- Produces: `editDistance(a: string, b: string, max?: number): number`, `isClose(guess: string, word: string): boolean` from `@games/words`.

- [ ] **Step 1:** Create the package. `package.json` follows `packages/game-core/package.json`, with `"name": "@games/words"` and exports `{ ".": "./src/index.ts", "./dictionary": "./src/dictionary.ts" }`. `tsconfig.json` extends `../../tsconfig.base.json`, `lib: ["ES2023"]`, include `["src", "test"]`.
- [ ] **Step 2:** Move the edit-distance cases from `games/scribbl/test/rules.test.ts` (`kitten/sitting` = 3, early stop = 2, `aple` close, `appel` not, identical not, `ca` too short) into `packages/words/test/text.test.ts`, importing from `../src/index.ts`. Run `pnpm vitest run packages/words`: expect FAIL (no export).
- [ ] **Step 3:** Move both functions verbatim with their comments into `src/index.ts`. Delete them from scribbl's `rules.ts`. Import them in `scribbl/server/game.ts` from `@games/words`. Add `"@games/words": "workspace:*"` to scribbl's deps, then run `pnpm install`.
- [ ] **Step 4:** Run `pnpm vitest run packages/words games/scribbl && pnpm typecheck`: expect PASS.
- [ ] **Step 5:** Commit: "Words: a shared package, starting with Scribbl's edit distance".

### Task 2: The dictionary moves to `@games/words/dictionary` (from Pass the Bomb)

**Files:**
- Move: `games/pass-the-bomb/server/dictionary.ts` → `packages/words/src/packed.ts`; `games/pass-the-bomb/scripts/build-dictionary.mjs` → `packages/words/scripts/build-dictionary.mjs`
- Create: `packages/words/src/dictionary.ts`, `packages/words/test/dictionary.test.ts`, `packages/words/test/guard.test.ts`
- Modify: `games/pass-the-bomb/server/words.ts` (keep `CLUSTERS`, `MIN_MATCHES`; drop `unpack`/`isWord`), `server/game.ts`, `test/rules.test.ts`, `test/game.test.ts`, `package.json`

**Interfaces:**
- Produces from `@games/words/dictionary`: `WORD_COUNT: number`, `unpack(packed: string): string[]`, `isWord(word: string): boolean`, `allWords(): readonly string[]` (sorted, unpacked once, cached).

- [ ] **Step 1:** Write `dictionary.test.ts` with the Bomb's two dictionary tests, moved verbatim, plus: `allWords()` has length `WORD_COUNT`, and `allWords() === allWords()` (same cached array).
- [ ] **Step 2:** Write `guard.test.ts`. It walks `games/*/client` and `games/*/shared` with `node:fs` (`readdirSync(..., { recursive: true })`) and asserts no `.ts` file contains `@games/words/dictionary`. Resolve paths from `import.meta.dirname`.
- [ ] **Step 3:** Run `pnpm vitest run packages/words`: expect FAIL on the dictionary test.
- [ ] **Step 4:** `git mv` the generated file to `src/packed.ts` and the script to `packages/words/scripts/`. Point the script's output at `../src/packed.ts`. Add one header line: `// Source: SCOWL via Debian wamerican; permissive licence, see /usr/share/doc/wamerican/copyright.` Make the same edit in `packed.ts`'s current header, so it reads as if regenerated. Do not regenerate: the system list may have drifted. Write `src/dictionary.ts` with `unpack`/`isWord` moved verbatim, `allWords()`, and a re-export of `WORD_COUNT`.
- [ ] **Step 5:** In the Bomb, import `isWord` from `@games/words/dictionary`. Replace `unpack(PACKED)` in both test files with `allWords()`. Delete the moved dictionary tests from `rules.test.ts`; the cluster tests stay. Add the dep and run `pnpm install`.
- [ ] **Step 6:** Run `pnpm test && pnpm typecheck`: expect PASS.
- [ ] **Step 7:** Commit: "Words: the dictionary leaves Pass the Bomb, with a guard on the way out".

### Task 3: Ballot helpers and `stableHash` in game-core (from Blind Rally)

**Files:**
- Modify: `packages/game-core/src/index.ts` (append a `// Ballots` section), `packages/game-core/tsconfig.json` (include `test`), `games/blind-rally/server/ballot.ts` (delete local `hash`, import `stableHash`)
- Create: `packages/game-core/test/ballot.test.ts`

**Interfaces:**
- Produces exactly the spec's block: `Ballot<C>`, `openBallot`, `castVote` (returns `GameError | null`, codes `not-eligible`, `bad-choice`), `dropVoter`, `allVoted`, `strictMajority`, `tally` (returns `{ winner, tied, counts }`), `stableHash`.

- [ ] **Step 1:** Write `ballot.test.ts`:
  - `castVote` by `"zed"`, who isn't in `["a","b","c"]`, returns code `not-eligible`. A choice outside `allowed` returns `bad-choice`. Neither changes `votes`.
  - Re-voting overwrites: `a` votes `x` and then `y`, so `votes.a === "y"`.
  - With eligible `a,b,c,d`, two `reject` votes give `strictMajority(b, "reject") === false`, and three give `true`. Eligible `a,b,c`, two `reject`, then `dropVoter("c")`: still `true`, and the denominator is now 2.
  - `allVoted` is false until everyone eligible has voted, then true.
  - `tally`: a clear winner has `tied` `[]`. A 1–1 tie between `x` and `y` reports `tied: ["x","y"]`, and the winner is the same whether `a` or `b` voted first. An empty ballot gives `winner: null`.
  - `stableHash("abc") === 440920331` (Blind Rally's FNV-1a, checked against the old function).
- [ ] **Step 2:** Run `pnpm vitest run packages/game-core`: expect FAIL.
- [ ] **Step 3:** Implement in `index.ts`. `tally` counts in `order`, finds the leaders, and picks `leaders[stableHash(seedKey + ":" + leaders.join(",")) % leaders.length]`. `counts` holds every `order` entry, zeros included. Blind Rally's `ballot.ts` imports `stableHash` and drops its own `hash`; its call sites stay the same.
- [ ] **Step 4:** Run `pnpm test && pnpm typecheck`: expect PASS, including `games/blind-rally/test/track-pick.test.ts`.
- [ ] **Step 5:** Commit: "Game core: ballots, and Blind Rally's coin moves in".

### Task 4: `cleanChatText(max)` and the whole-kit check

**Files:**
- Modify: `packages/protocol/src/index.ts:53`
- Test: `packages/protocol/test/` (create `text.test.ts` if there's no chat-text test yet)

- [ ] **Step 1:** Test: `cleanChatText("x".repeat(300))` has length 200, `cleanChatText("hello world", 5) === "hello"`, and the emoji case `cleanChatText("😀😀😀", 2) === "😀😀"`.
- [ ] **Step 2:** Add `max = CHAT_MAX_LENGTH` as the second parameter. Run `pnpm test && pnpm typecheck`: expect PASS.
- [ ] **Step 3:** Run `pnpm build`, then `grep -rl "0aardvark8s1baci4k4us6" apps/web/dist`: expect no output (a real run from the start of `PACKED`).
- [ ] **Step 4:** Commit: "Protocol: chat cleaning takes a cap, for clues and definitions".
