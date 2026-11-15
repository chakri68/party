# Task 6 report: the server game, registration and party stats

Status: DONE_WITH_CONCERNS (server/game.ts is 782 lines, over the ~700 line mark; not split, as asked).
Commit: eb5f290 "Long Trail: the server game, and a Hardest to convince award" (on master, not pushed).

## Implemented
- `games/long-trail/server/game.ts`: `longTrailGame: GameDefinition<…>`. Heist-style clone-and-mutate helpers, one `"phase"` timer, `allHere`, stray-alarm slack. Phases reveal → plan → vote → [plan → vote] → [choice] → summary → … → recap → over.
- `games/long-trail/server/index.ts`: `export { longTrailGame }`.
- `games/long-trail/shared/types.ts`: `Vote`, `Band`, `TIMERS`, `LongTrailPlayer`, `ChoiceBallot`, `DayDraft`, and the four state/event types (below).
- `packages/game-core`: `"noGoVotes"` in `STAT_KEYS`; `RULES` row `{ id: "doubter", title: "Hardest to convince", min: 5, score: noGoVotes, line: "Voted No-go N times." }`; test row in the `it.each` award table.
- `apps/server/src/games.ts`: `"long-trail": longTrailGame` in GAMES (not in RECAP_EXEMPT; has partyStats).
- `AGENTS.md`: one row in the stat-key table (`noGoVotes`, per No-go cast).
- PROTOCOL_VERSION: unchanged. STAT_KEYS isn't wire state; the wire `Recap.awards[].id` is a string field that just gets a new value. No client code maps award ids (grep found only game-core).

## Tests and TDD
- RED: `pnpm vitest run games/long-trail packages/game-core` -> game.test.ts and secrecy.test.ts fail to load ("Cannot find module '../server/game.ts'"), recap.test.ts "doubter fires at its minimum" fails (`[]` vs the award).
- GREEN: same command -> 12 files, 201 tests pass.
- `pnpm typecheck`: exit 0. `pnpm test`: first run had 5 failures in 4 files under load (not captured); two re-runs both 152 files / 2460 tests passed. Likely the known load flake.
- New tests: `test/game.test.ts` (21): createGame deal (8 distinct jobs, subset for 4, goals and text), reveal -> plan, not-leader, bad-plan with planProblem text ("No market here."), 2-2 fail -> next seat proposalNo 2 -> stayedCourse, 0-0 fails, majority of votes cast passes, next-day leader, host Skip proposes open plan, choice tie -> leader's pick, tie with leader absent -> 0, arm rejected for Healer (`no-ability`), armed Guide only in Guide's private state, arm wrong phase, leader removed mid-plan -> next seat with fresh 45 s clock and traveller gone, protect target removed -> met, last living traveller removed -> recap -> "Everyone died on the trail", <2 players -> interrupted result, leaver's vote dropped, timer-only game ends within (deadline+1)*6+3 rings for short/normal/epic, seeded full game -> recap -> over with getResult only in over, partyStats counts No-go and no projection holds stats.
- `test/secrecy.test.ts` (3 seeds, 8 players, everyone armable arms on day 1, mixed votes): every step checks with `findLeaks` that no goal text or goal JSON reaches public state, events or other seats' private state; public JSON has no `"armed"` key and none of worsenChance/foodDays/nextFork/odds/fatigue/nextMarket; in recap/over the public state contains every goal text.

## State shapes (Task 8 reads these; all in shared/types.ts)

Server `LongTrailServerState`:
`phase, deadline, phaseMs, settings, players {id,left,away}[], travellers: string[], caravan: Caravan, dangers: Record<legKey, Danger>, jobs: Record<id, JobId>, goals: Record<id, Goal>, goalText: Record<id, string>, armed: Armed, used: Used, perksUsedThisLeg {driver,cook}, leader: number (seat), proposalNo: 1|2, plan: Plan|null (being voted), lastPlan: Plan|null, ballot: Ballot<Vote>|null, choiceBallot: {eligible, votes: Record<id,0|1>}|null, choice: ChoiceEvent|null, acks: string[], drawn: string[], proposals: DayLog["proposals"] (today's, closed), draft: {log: DayLog, before: Stock}|null (a day waiting on a choice), fired: ArmableJob[] (last day), log: DayLog[], lastDay: DayLog|null, recap: Recap|null, end: EndView|null, interrupted: boolean, stats: PartyStats`.
Extras beyond the brief's list: `phaseMs`, `proposals`, `draft`, `fired`.

Public `LongTrailPublicState`:
```
phase, deadline, phaseMs, settings
players: { id, left, job: JobId }[]          // jobs are public
leader: string; proposalNo: 1|2; day; deadlineDay
route: { start, end, stops: { id, name, next: string[], market: boolean }[] }  // no km, no kinds, no dangers
at: string; leg: { to, km, kind, kmLeft } | null   // current leg only; null when halted at `at`
visited: string[]
stock: { food: Band, water: Band, medicine, coins, animals, cargo }
capacity: number                               // animals * capacityPerAnimal
prices: { goods, supplies } | null             // only when halted at a market stop
travellers: { id, health }[]
openPlan: Plan                                 // what Skip/timeout proposes; plan form default
plan: Plan | null                              // pending proposal
votes: { voted: string[], of: number } | null  // open plan vote or choice vote
proposals: DayLog["proposals"]                 // today's closed votes, by name
choice: { id, text, options: [label, label] } | null   // no effects or odds
fired: ArmableJob[]                            // abilities that fired on the last day (incl. quartermaster cache)
lastDay: DayLog | null
acked: string[]                                // who tapped Got it / Next this phase
recap: Recap | null; goals: Record<id, Goal> | null   // from recap on (not when interrupted)
interrupted: boolean
```
Bands: days = floor(stock / living * per-day use) at the pending plan (else open plan) rations and the leg the caravan travels next (current leg, else the leg out of the stop: the plan's fork or the safe branch). >=6 plenty, 3-5 some, 1-2 low, 0 out; no use (none rations / nobody alive) = plenty.

Private `LongTrailPrivateState`:
`job: JobId|null, info: JobInfo|null (null once left or over), goal: Goal|null (structured; protect has target id), goalText: string|null, ability: {job: ArmableJob, armed, used, canArm}|null (null for non-armable jobs; canArm ignores the phase, arm is valid only in plan/vote), vote: Vote|null, choiceVote: 0|1|null, acked: boolean`.
JobInfo uses the pending plan if one is up, else the open plan.

Events (all public): `plan {leader, proposalNo}`, `proposed {by, plan}`, `vote-closed {passed, votes}`, `choice {id}`, `day-done {day}`, `recap`, `game-over {interrupted}`.

Actions: `ack` (reveal), `next` (summary, recap), `propose {plan}` (leader, plan phase; `bad-plan` with planProblem text), `vote`, `choose {option}`, `arm {on}` (codes: `no-ability`, `wrong-phase`, `dead`, `used`).

## Decisions worth knowing
1. **No event on the arrival day, or when nobody is left alive** after travel. The brief doesn't say; a choice vote after reaching Mirren Gate made no sense.
2. **Doses** apply only to a present, living traveller below Well with medicine left; otherwise skipped with no medicine spent. On a moving day they also need a living Healer at resolution time (re-checked, since the Healer could leave between propose and close).
3. **Goal text.** dealGoals returns no card id, so text is matched back: exact goal match for plain kinds; protect goals take the protect cards' texts in deal order ("this traveller"; the view names the target from `goal.target`); visit goals use the card text only if its stop matches, else "Visit <stop name>.". Two players could in theory share a visit text if they got the same stop.
4. Votes close as a majority of votes cast (the brief), unlike Heist's majority of eligible. noGoVotes bumps at close, per No-go in the ballot.
5. Leader removed in plan or vote: the proposal (if any) is dropped unrecorded, the next seat plans with the same proposalNo and a fresh clock. Leader removed during choice: their vote is dropped, so a tie goes to option 0. Removal during recap recomputes `end` so the result drops them; the recap shown stays as built.
6. Removal deletes the traveller from `caravan.health` too, so `failed` sees only travellers still in the game.
7. Every random call goes through ctx.randomInt (shuffle for jobs, dealGoals, rollPrices, rollDangers, leader, travel, events, recap line).

## Self-review
- No secrets in public: dangers, drawn, other stops' prices, armed, used, goals, JobInfo and stats are not projected; recap and goals only from recap on.
- Only my files staged by path; repo-root untracked secrets untouched.
- `getAwaitedPlayerIds` names voters who haven't voted (the public state shows who voted anyway).

## Concerns
- **server/game.ts is 782 lines.** About 180 of them are parsing (parsePlan/parseAction), goal text matching and the two projections; those would move cleanly into e.g. `server/views.ts` if you want it under 700.
- Balance: in the seeded secrecy runs the open plan (steady, full, never buying) starves most of an 8-player caravan on Short by day 9-11. Task 7 tuning.
- First full `pnpm test` run had 5 failures in 4 files that didn't reproduce in two re-runs; I didn't capture which files.

## Fix report 1 (commit 0453a1c "Long Trail: leader after reveal, skip test, split views")

1. **Leader after the reveal.** `createGame` no longer picks a leader (seat 0 is a placeholder). The new `firstPlan` runs as the reveal ends, from both the timer and everyone acking. It picks `seats[randomInt(seats.length)]` among seats still in. `startPlan` always moves a left leader seat on with `nextSeat`. Test: "never hands the first plan to someone who left in the reveal" (seeds 1-20, p0 removed in the reveal). It fails on the old game.ts (checked by swapping the old file in), and passes now.
2. **Host Skip test.** "host Skip alone ends a short/normal/epic game": from the reveal, each step skips every awaited player, or rings the timer when nobody is awaited. It asserts `over` within (deadline+1)*6+3 steps. Behaviour change that came with it: a vote or choice ballot that everyone was skipped out of (eligible empty) now closes at once, so a skipped vote is one step, not two. Without that change the test still passed on the old code, but with less room to spare.
3. **Split.** `server/parse.ts`: VOTES, isId, oneOf, parsePlan, parseAction. `server/views.ts`: goalTexts, band, publicState, privateState. Also `server/world.ts`, which wasn't in the ruling. It holds the read-only lookups that both game.ts and views.ts use (JOBS, ARMABLE, isArmable, world, find, activeIds, leaderOf, isAlive, jobAlive, aliveJobs, legOut, openPlan). Without it, views.ts and game.ts would import each other. It was a pure move: after it, before any fix, 159/159 long-trail tests passed and tsc was clean. Sizes: game.ts 610, parse.ts 49, views.ts 106, world.ts 38 lines.

Commands:
- `pnpm vitest run games/long-trail packages/game-core` -> Test Files 12 passed (12), Tests 205 passed (205)
- `pnpm typecheck` -> exit 0
