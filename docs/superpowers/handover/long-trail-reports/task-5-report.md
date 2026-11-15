# Task 5 report: goals, scoring and recap

Status: DONE. Commit "Long Trail: goals, scoring and recap" (not pushed). Files: games/long-trail/shared/scoring.ts, shared/recap.ts, test/scoring.test.ts, test/recap.test.ts.

## TDD
RED: with scoring.ts/recap.ts moved aside, `pnpm vitest run games/long-trail/test/scoring.test.ts games/long-trail/test/recap.test.ts` -> "Test Files 2 failed (2), no tests" (imports missing). Tests were written first in content; sources were then restored.
GREEN: `pnpm vitest run games/long-trail` -> 6 files, 126 tests passed. `pnpm typecheck` clean.

## Exported signatures
scoring.ts: `EndView` (brief's fields plus `endPrices: Record<string, number>`), `POINTS`, `branchStops(route): string[]`, `dealGoals(pack, route, playerIds, randomInt): Record<string, Goal>`, `cargoSale(cargo, endPrices): number`, `wealth(c, route): number`, `gradeOf(pack, w): Grade`, `goalMet(goal, end): boolean`, `points(playerId, goal, end): number`, `outcome(players, goals, end, _pack, dayCount): GameOutcome`.
recap.ts: `DayLog`, `Recap` (as in brief), `buildRecap(log, pack, route, end, jobs, goals, goalText, randomInt, names = {}): Recap`.

## Decisions and deviations
1. EndView gets a required `endPrices` (good -> end-stop price). buildRecap has no Caravan, so it needs this to compute `cargoSale`. Task 6 must fill it from `c.prices[route.end]`.
2. buildRecap takes an optional trailing `names` map (player id -> display name) for results like "Asha got sick"; falls back to "Someone".
3. Deck reuse: usable cards (visit cards need a branch stop; protect needs 2+ players) are shuffled and dealt distinct. When exhausted, reshuffle; if the new top card repeats the last dealt id, swap it with another. With 1 usable card it would repeat (unavoidable). Throws if no usable card.
4. Visit stop = a stop on some path but not all (pathsOf); equals "one branch of a fork".
5. `recap.route` includes the start stop at day 1, then each stop at the day it was reached.
6. DayLog proposals carry no plan, so a passed proposal's question comes from that day's `plan`; a failed proposal reads "A plan that did not pass". Choice votes: go = votes for the picked option, noGo = the rest; question = `choice.label`.
7. Result text: biggest loss that day by the worst-day weights ("Ben died", "Asha got sick", "was badly hurt", "Lost 6 food", "Lost 20 coins", "Lost 1 animal"); with no loss, "Moved N km" or "Rested". worstDay text = event text + result.
8. Points: grade points only when arrived; goal points only if `goalMet`; alive points from `end.alive`; removed player scores 0 and has no standing/fate/reveal. nobody-dies and never-starve don't need arrival. Failed outcome: "Everyone died on the trail" if no in-game player alive, else "The season ended on day <dayCount>". Arrived headline uses `end.day`. `_pack` is unused in outcome.
9. A failed outcome with nobody arrived: winnerIds empty, standings still listed.

## Self-review
No Math.random; all picks via randomInt. Tests use fixtures only, a pack with grades 0/100/200/350. Only my four files added by path.

## Fix report (commit "Long Trail: recap names failed plans and gains")
- `DayLog.proposals: { by: string; plan: Plan; votes: Record<string, "go" | "no-go">; passed: boolean }[]` (plan added; Task 6 records it). Every proposal's question is its own plan in words; fork reads ", go to <stop name>".
- bigCall `result`: biggest absolute change that day, gains included ("Got 20 coins", "Got 3 silk", "<Name> got better"); also counts medicine and cargo (weight 1 per unit). worstDay still scores losses only (brief formula); ties go to the earliest day (comment added).
- dealGoals returns copies (`{ ...card.goal }`).
- Tests: strict 8-distinct (g9 swapped to a cargo card, kinds compared), copies test, dead-but-goal-met failed = 3, exact "Cy died", end-line stub test (randomInt returns 1, asked with lines.length), failed-plan/gains test, worstDay tie test. 131 tests pass, typecheck clean.
