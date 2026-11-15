# Task 2 report: setting pack and Trade Route data

Status: DONE_WITH_CONCERNS. Commit: see `git log` ("Long Trail: setting pack and Trade Route data"), not pushed.

## Implemented
- `shared/pack.ts`: all brief types, `packFor`, `stopById` (throws on unknown id), `pathsOf` (DFS).
- `shared/packs/trade-route.ts`: `tradeRoute` with short/normal/epic routes (5/8/12 stops, 1/2/3 forks, deadlines 12/20/32), markets, 8 jobs, 53 events (18 choices), 15 goal cards, grades 0/100/200/350, end lines (3 per arrived grade, 3 failed), start stock per brief, capacity 4.
- `shared/numbers.ts`: `N.kmPerDay = { slow: 20, steady: 30, hard: 40 }`.
- `shared/index.ts`: re-exports pack.ts and tradeRoute.
- `test/pack.test.ts`: 20 tests as in the brief.

Route days at steady (ceil per leg): shortest path short 9/12 (limit 9), normal 16/20 (limit 17), epic 28/32 (limit 29). Saltmere (market) is on every route as a fork branch, so the "visit Saltmere" goal always works; Vessa Pass likewise.

## TDD
- RED: `pnpm vitest run games/long-trail/test/pack.test.ts` failed, trade-route.ts import not found.
- GREEN: same command after implementing: 23 passed across long-trail (2 files). Event test failed twice first on the one-third choice ratio, fixed by adding choice events.
- `pnpm typecheck`: clean. `pnpm test` full: 14 failures in other games (crazy-eights, go-fish, treasure-hunt, pass-the-bomb...), all random-seed-heavy tests timing out under load; the ones I re-ran in isolation pass. Unrelated to this change.

## Self-review
- Fixed after commit (amended): a fever line said "three people"; an arrive-by goal text was clunky.
- No Math.random, no real place names, no emoji.

## Concerns
1. Market share test: for Short the interior has 3 stops, so 40-60% is impossible with whole stops. The test allows floor(0.4n)..ceil(0.6n), which gives 1-2 of 3. Short path has 2 of 3 (67%). Normal 3 of 6, Epic 5 of 10.
2. Event deck has many more `kind`-specific lost-time and choice events than the minimum; balance (damage sizes, prices, grades) is untuned, left for Task 7.
3. Cargo-effect events and "cargo" goals use the good ids silk/spice/salt; protect goals ("protect-someone") need the dealer in a later task to fill the target.
4. A `visit` goal on Vessa Pass is fine on all lengths but the player can skip it by taking the safe branch; intended.

## Fix round (coordinator review)
Commit "Long Trail: pack copy and content fixes". All 6 items done: Camp now has no food bonus; guide, fish, farmer, fire text match effects (farmer and fire now cost 2 coins); idioms replaced, arrive-by goals read "a few days / many days to spare"; end lines rewritten to hold for any outcome (no claims about survivors, camels or lateness; failed lines no longer say "nobody made it"); calm mountain/river/plain choices moved to their sections; 3 new tests. Pack tests 27/27, typecheck clean.
