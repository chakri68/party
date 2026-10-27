# Chain Words Implementation Plan

**Spec:** `docs/superpowers/specs/2026-10-27-chain-words-design.md`. **Template:** `games/pass-the-bomb`.

Commit straight to master after each task. Targeted check: `pnpm vitest run games/chain-words packages && pnpm typecheck`.

### Task 1: Package, types, rules, openers

Files: `games/chain-words/{package.json,tsconfig.json}`, `shared/{index,manifest,types,rules,rules-text,openers}.ts`, `server/words.ts`, `test/rules.test.ts`.

Tests (`test/rules.test.ts`):
- `openers: are real words, 3+ letters, none twice`
- `openers: each ends on a letter with plenty to follow`
- `shapeProblem: wants letters, three or more, starting with the letter`
- `wordsOn: counts dictionary words by first letter, minus used ones`
- `settings fields: hints follow the choice`

### Task 2: Server

Files: `server/{index,game}.ts`, `test/game.test.ts`.

Tests (`test/game.test.ts`):
- `createGame: opens with a word from the list, on a visible clock`
- `words: a good word passes the turn with a fresh clock`
- `words: wrong letter, non-words and repeats bounce, and the clock keeps running`
- `words: the opener can't be played again`
- `clock: running out costs a life and passes the turn, same letter`
- `clock: an early alarm re-arms instead of firing`
- `clock: last life out; down to one, they win, standings in order`
- `rescue: a letter with nothing left gets rerolled, nobody loses a life`
- `leaving: the holder leaving passes the turn with a fresh clock`
- `leaving: down to one ends it`
- `presence: turns skip the dropped, unless there's nobody else`
- `skip: the host can skip a dropped holder, no life lost`
- `stream: holder's typing for this turn only`
- `nothing secret: public and private state don't carry typing or presence internals`
- `random games: always end with one winner`

### Task 3: Client and registration

Files: `client/{index,view}.ts`, `client/styles.css`, `client/env.d.ts`, `apps/server/src/games.ts`, `apps/web/src/games.ts`, both apps' `package.json`.

Check: `pnpm typecheck`, `pnpm build`, the guard test in `packages/words`.

### Task 4: Verify

`pnpm vitest run --testTimeout=60000`, then the report at `.superpowers/sdd/games/chain-words-report.md`.
