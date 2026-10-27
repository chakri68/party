# Pass the Bomb modes Implementation Plan

**Spec:** `docs/superpowers/specs/2026-10-27-pass-the-bomb-modes-design.md`. **Game:** `games/pass-the-bomb`.

Commit straight to master after each task. Targeted check: `pnpm vitest run games/pass-the-bomb games/chain-words packages && pnpm typecheck`. Chain Words re-exports Bomb helpers, so it rides along.

### Task 1: Modes, rules, categories, the viability table

Files: `shared/{types,rules,rules-text,viable,index}.ts`, `server/{categories,prompts}.ts`, `test/rules.test.ts`.

Tests (`test/rules.test.ts`):
- `categories: 80+ each, all dictionary words, none twice`
- `effectiveCluster: reverse flips, everything else leaves it`
- `shapeProblem: ending wants the end, length wants 5–10, defaults unchanged`
- `prompts: every combination has a viable prompt, each with 8+ answers that fit`
- `viable table matches a fresh count`
- `parseSettings-side check: a combination with no prompts is blocked, with a hint`
- `setting fields: seven, defaults selected`

### Task 2: Server

Files: `server/game.ts`, `test/game.test.ts`, `test/vote.test.ts`.

Tests (`test/game.test.ts`, existing kept):
- `modes: an ending/length/category word passes; a wrong shape is bad-word`
- `reverse: the bomb shows it backwards, the word needs it forwards`
- `category: the category is public and changes with the prompt`
- `time-up: a word after the fuse's deadline loses`
- `random games with every mode combination end`

Tests (`test/vote.test.ts`):
- `strict rejects, allow accepts`
- `vote: opens with the fuse frozen, voters snapshotted, submitter excluded`
- `vote: strict majority rejects, tie allows; holder keeps it, fuse resumes`
- `vote: allowed word passes and goes into used; rejected word stays rejected`
- `vote: hidden until it closes (public and other players' private state)`
- `vote: closes early when settled; timer closes the rest; early alarm re-arms`
- `vote: two per hold, then straight rejections`
- `vote: nobody eligible allows; voter leaving or dropping is dropped; submitter leaving calls it off`

### Task 3: Client

Files: `client/{view,styles}.ts|css`.

Mode badges, category on the bomb, the vote card with buttons and bar, the result line. `pnpm build` green.
