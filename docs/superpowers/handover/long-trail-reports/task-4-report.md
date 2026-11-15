# Task 4 report: events, job abilities and job info

Status: DONE. Commit a12fadb "Long Trail: events, job abilities and job info" (not pushed).

## Implemented
- `shared/events.ts`: SEVERITY_WEIGHTS, CACHE_FOOD, rollDangers, drawEvent, applyEffect, resolveEvent, plus extras `resolveChoice`, `hasLostTime`, `isChoice`.
- `shared/info.ts`: JobInfo, InfoState, jobInfo.
- `shared/travel.ts`: small refactor only: exported `effectivePace` and `riskPoints`, travelDay now uses them (behaviour unchanged, 66 old tests pass).
- `test/fixtures.ts`: fixture route/pack/helpers moved out of travel.test.ts, imported by both test files. `test/events.test.ts`: 33 tests.

## TDD
RED: `pnpm vitest run games/long-trail/test/events.test.ts` -> "Test Files 1 failed (1), Tests no tests" (../shared/events.ts missing).
GREEN: first full run 98/99 (one wrong expectation in my own healer test: "none" rations means no food shortage, so 0.84 not 1; test fixed). Final `pnpm vitest run games/long-trail` -> 4 files, 99 tests passed. `pnpm typecheck` clean.

## Exported signatures
- events.ts
  - `SEVERITY_WEIGHTS: Record<Danger,[number,number,number]>`; `CACHE_FOOD = 10`
  - `rollDangers(route, randomInt): Record<string, Danger>`
  - `drawEvent(pack, kind: LegKind|"any", danger, randomInt, exclude: string[]): EventCard`
  - `applyEffect(c, effect, travellers, randomInt, opts?: { scout?: boolean }): EffectReport`
  - `resolveEvent(c, pack, card, armed, used, alive, travellers, randomInt): { card; fired: ArmableJob[]; pendingChoice: ChoiceEvent|null; report: EffectReport|null }`
  - `resolveChoice(c, card: ChoiceEvent, option: 0|1, armed, used, alive, travellers, randomInt): { fired: ArmableJob[]; report: EffectReport }`
  - `hasLostTime(effect): boolean`, `isChoice(card): card is ChoiceEvent`
  - types EffectReport, Armed, Used, ResolvedEvent
- info.ts: `jobInfo(job, c, pack, route, state: InfoState): JobInfo`, `InfoState = { dangers; plan; travellers; choice }`
- travel.ts additions: `effectivePace(c, pack, plan): Pace|null`, `riskPoints({pace, rations, shortFood, shortWater, sick, driverShield}): number`

## Decisions and deviations (for Tasks 5/6)
1. **rollDangers** distribution was unspecified: uniform 0..2 per leg; the `safe` fork branch is uniform 0..1 (never dangerous).
2. **Reroll/swap draw type-restricted**: Guide reroll draws another plain card, Lookout swap draws another choice card (excluding the original id, reshuffling to the full filtered pool if empty). Kind = `c.leg?.kind ?? card.kind`, danger = the card's own severity. resolveEvent has no history, so exclude is only the original id.
3. **Scout on a choice**: resolveEvent cannot know the chosen option, so I added `resolveChoice` (same fired/spent logic, applies the chosen option with the Scout flag). Task 6 should call it when the choice resolves. The Scout fires only if the effect (recursively, incl. chance branches) has lostTime; with a chance it can fire and the good branch roll may still happen (Scout spent). Scout zeroes km on every lostTime sub-effect applied. There are no lost days in v1.
4. applyEffect: positive km never finishes the leg (kmLeft floor 1, arrival happens in travelDay). Cargo loss takes one unit at a time from the most-held good (first wins ties). `report.stock` is the real delta after clamping; cargo loss and km show up in `text` (cargo isn't in the stock map). `text` lines are terse ("food +2", "cargo -3", "-15 km"); the view should rely on the structured fields.
5. A dead holder's armed ability does nothing and `armed` stays set (not cleared). Mutates `armed`/`used` in place.
6. drawEvent: if danger weights are all zero for severities present in the pool, falls back to uniform over present severities.
7. jobInfo look-ahead is inclusive of the start stop: from the current leg's destination, or `c.at` when halted. So a halted Trader at a market sees that market, and a Scout halted at a fork sees that fork. Guide halted gives the leg leaving `c.at` (safe branch at a fork). Mid-leg gives the leg after the current one. Quartermaster waterDays uses that next leg's kind ("other" when none).
8. Healer worsenChance ignores Driver/Cook perks (no alive info in InfoState). Leg kind for water: current leg, else the upcoming leg if moving, else "other". Risk cap of 1 is practically unreachable (max 8 points = 0.96).
9. Quartermaster/cook day counts floor, and cap at 99 when per-day need is 0 (none rations).
10. Lookout odds: `p` is the option's chance.p, 0 when the option has no chance.

## Self-review
- No Math.random; every pick via randomInt (randomInt only called for ties/choices of more than one candidate when picking a target).
- Stock never negative (clamped, tested). Only my own paths added by path.
- Concern: the cache (CACHE_FOOD) isn't applied here; Task 6 adds it at the end of the next moving day's travel.

## Fix report (commit "Long Trail: Scout only fires when it saves time")
- `EffectReport.scoutSaved: boolean`: set when the Scout flag zeroed km (lostTime effect, km < 0, on a leg). resolveEvent and resolveChoice spend the Scout (`used`, `armed`, `fired`) only when it is true; otherwise it stays armed.
- Healer info: with `plan.fork` set, water need uses that branch's leg kind, else the safe branch.
- Tests: Scout stays armed on a chance branch with no lostTime and when halted; Scout still spends when the branch saves; healer fork test (plain vs desert). Filler "jobs with no info" test dropped. 99 tests pass, typecheck clean.
