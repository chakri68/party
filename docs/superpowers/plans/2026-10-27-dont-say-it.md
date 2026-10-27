# Don't Say It Implementation Plan

**Spec:** `docs/superpowers/specs/2026-10-27-dont-say-it-design.md`. **Template:** `games/imposter`.

Commit straight to master after each task. Targeted check: `pnpm vitest run games/dont-say-it packages && pnpm typecheck`.

### Task 1: Package, types, rules, teams, cards

Files: `games/dont-say-it/{package.json,tsconfig.json}`, `shared/{index,manifest,types,rules-text}.ts`, `server/{teams,cards}.ts`, `test/{rules,teams,guard}.test.ts`.

Tests:
- `cards: 150+, five forbidden each, none equal to or containing the target, no repeats`
- `teams: balanced split; switch keeps sizes within 1; restore from carry evens out`
- `settings fields: turn length and turns per team`
- `guard: nothing under client/ or shared/ imports server/`

### Task 2: Server

Files: `server/{index,game}.ts`, `test/game.test.ts`.

Tests:
- `teams phase: switch, host shuffle, host start needs 2+ a side`
- `secrets: the card is in the describer's and the other team's view only`
- `turn: got/skip/oops score, floor at 0, next card, no repeats`
- `buzz: freezes the clock; fair; nope then uphold/drop; drop resumes the same card with the time left`
- `dispute clocks: describer silence escalates, captain silence drops`
- `turns alternate, describers rotate, sudden death on a tie, shared win`
- `leaving: describer mid-turn ends it; captain hands over; team below 2 ends the game`
- `skip and disconnect never leave a phase stuck`
- `carry: teams and used cards survive a rematch`
- `random games: always finish`

### Task 3: Client and registration

Files: `client/{index,view}.ts`, `client/styles.css`, `client/env.d.ts`, `apps/server/src/games.ts`, `apps/web/src/games.ts`, both apps' `package.json`.

Check: `pnpm typecheck`, `pnpm build`.

### Task 4: Verify

`pnpm vitest run --testTimeout=60000`, then the report at `.superpowers/sdd/games/dont-say-it-report.md`.
