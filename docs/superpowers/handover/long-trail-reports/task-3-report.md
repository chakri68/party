# Task 3 report: travel, markets and health

Status: DONE. Commit: "Long Trail: travel, markets and health" (not pushed).

## Implemented
- `shared/numbers.ts`: N extended with the brief's values (kmPerDay kept) plus `traderEdge: 0.1`.
- `shared/travel.ts`: all functions in the brief, plus `roll` and `startLeg`.
- `test/travel.test.ts`: 59 tests on an in-file fixture route (a -> b fork -> c desert | d -> e) and fixture pack. Live tradeRoute not used.

## TDD
RED: `pnpm vitest run games/long-trail/test/travel.test.ts` -> "Test Files 1 failed, no tests" (import of ../shared/travel.ts failed).
GREEN: `pnpm vitest run games/long-trail` -> 3 files, 62 tests passed. `pnpm typecheck` clean (noUncheckedIndexedAccess fixes made along the way).

## Exported signatures (travel.ts)
- `roll(p: number, randomInt: (n:number)=>number): boolean`  // randomInt(1000) < round(p*1000)
- `rollPrices(route, randomInt): Caravan["prices"]`  // goods only, market stops only
- `planProblem(c, pack, route, plan, travellers, ctx:{healerAlive:boolean}): string|null`
- `applyTrades(c, pack, trades, traderLeads): void`
- `overCapacity(c, pack): boolean`
- `startLeg(c, route, toStopId): void`  // throws if no such leg
- `travelDay(c, pack, route, plan, travellers, perks, randomInt): DayReport`
- `arrived(c, route): boolean`, `failed(c, route): "all-dead"|"deadline"|null`
- types `Caravan`, `Perks`, `DayReport` as in the brief.

## Decisions worth knowing (Tasks 4, 6, 7)
1. **Day counter on arrival.** travelDay does NOT `day += 1` on the day it reaches `route.end`; day stays the arrival day. Otherwise arriving on `day === deadline` would make `arrived` false, contradicting Review Focus 2. All other days increment.
2. `failed`: "all-dead" if nobody has health > 0 (read from `c.health` values, not `travellers`); else "deadline" if `day > deadline` (also covers arriving late). `arrived` also reads `c.health`.
3. **Supply prices** are read from the pack's routes (stop with id `c.at`, `market.supplies`), since applyTrades has no route param. Goods use `c.prices`. A good with no price at the stop can't be bought or sold. Supplies can't be sold.
4. applyTrades sells first, then buys, clamped to cargo held and affordable coins (never negative). planProblem's coin check counts base buy prices, ignores sale revenue and the Trader discount (it has no traderLeads input), so it's conservative.
5. planProblem also: requires a fork choice when moving at a fork (rest day may leave it null); rejects qty 0 or non-integers; trades only when halted (`leg === null`) at a market.
6. Risk: "sick" point applies to any traveller with start-of-day health < 3. Risk uses the effective pace (after the over-capacity slowdown). Rest-day heal roll comes before the risk roll, each living traveller calls the risk roll even at risk 0 (so scripted rng sequences are per-traveller: [heal if hurt & rest & full], risk).
7. Cook turns half into full for both risk and rest healing; food use stays half. Perks apply whenever the flag is set; DayReport doesn't say whether one mattered, so the caller can't tell usage from the report.
8. Rest-day and halted-day water uses the leg kind if mid-leg, else "other". Moving with `leg === null` throws.
9. Animal loss: at fatigue >= max on a hard (effective) day, animals -1 (floor 0), fatigue 0; `animalLost` true only if one existed. Capacity check uses animals at start of day.

## Self-review
No Math.random. Stock clamps verified. No concerns beyond decision 1 and 3, which the controller may want to confirm. Only my three files were added.

## Fix report (follow-up commit "Long Trail: travel day counting and plan coins")
- Day counting: `day` always increments. `Caravan.arrivedDay: number | null` is set to the day just played on reaching `route.end`. `arrived` = arrivedDay set, <= deadline, someone alive. `failed` = "all-dead", else "deadline" if not arrived and `day > deadline`. Supersedes decision 1 above.
- planProblem: ctx is now `{ healerAlive: boolean; traderLeads: boolean }`. Coin check is `coins + sale revenue >= buy cost`, via a shared private `unitPrice(c, pack, item, buying, traderLeads)` also used by applyTrades. Supersedes decision 4.
- `DayReport.perksUsed: { driver: boolean; cook: boolean }`: true only when the perk applied (hard pace with shield, half rations with cook) with at least one living traveller.
- Tests updated and added (sell+buy in one plan, Trader pricing, arrival day cases, perksUsed). 64 tests pass, typecheck clean.

## Fix report 2 (commit "Long Trail: price supplies from the active route")
- `applyTrades(c: Caravan, route: RouteDef, trades: Trade[], traderLeads: boolean): void` (pack param dropped, it was unused). Supply prices come from `stopById(route, c.at).market?.supplies`; the across-routes search is gone. planProblem is unchanged in signature and already had `route`.
- Tests: two routes sharing a stop id with different supply prices (applyTrades and planProblem each price from their own); exact-outcome clamp test (coins 25, cargo 2: oversell + overbuy -> coins 5, cargo 4); overload-slowed hard plan gains no fatigue. Comment added in travelDay.
- 66 tests pass, typecheck clean.
