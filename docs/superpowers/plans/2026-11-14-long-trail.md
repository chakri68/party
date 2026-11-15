# Long Trail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Long Trail (`long-trail`), a 3–8 player shared-caravan trail game on the room runtime, with the core engine and the Trade Route setting.

**Architecture:** A normal game package in `games/long-trail/` (copy `games/heist`'s shape). All rules are pure functions in `shared/` that take a `SettingPack` (data plus twist hooks), so later settings are new pack files only. `server/game.ts` is a phase machine over those functions. `client/view.ts` renders the public and private projections on the shell's theme.

**Tech Stack:** TypeScript, pnpm workspace, vitest, `@games/game-core` (ballots, RNG, `PartyStats`), `@games/ui` (`h`, `avatar`, `seatName`).

**Spec:** `docs/superpowers/specs/2026-11-14-long-trail-design.md`. Read it before any task. Where this plan pins a number or a name, the plan wins. Where the spec leaves something to the builder, this plan's calls are marked *(plan call)*.

## Global Constraints

- Players 3–8. Lengths: Short (5 stops, deadline day 12), Normal (8 stops, day 20), Epic (12 stops, day 32), default Normal. "Stops" counts every stop on any start-to-end path, including both ends.
- Every random choice goes through `ctx.randomInt`. Tests use `seededRandomInt`.
- Job info and secret goals appear only in `getPrivateState` for their owner, never in public state, until the `recap` phase.
- Party stats live in server state only (AGENTS.md, "Adding a game: party recap stats").
- Player-facing copy: short plain sentences, basic words, no idioms, no emoji. Icons are SVG.
- Every name in the Trade Route pack is invented. No real place names, nothing from the 1970s classic (names, lines, tombstones, hunting).
- UI follows the shell's Ink & Lime theme (`apps/web/src/style.css` tokens). Ignore `ui_theme.md` at the repo root.
- Commit to `master` after each task and push (the repo's convention). Commit subjects look like `Long Trail: <what>`.

## Review Focus

1. **The last traveller dies on the day the caravan reaches the end.** Deaths are applied before the arrival check, so it's a fail. Test in Task 3.
2. **Arriving exactly on the deadline day** counts as arrived (`day <= deadline`), and day `deadline + 1` without arriving fails. Test in Task 3.
3. **Stock never goes negative:** buying past your coins, selling cargo you don't have, food running out mid-day. Short food becomes a health hit, not a negative number. Tests in Task 3.
4. **Removals:** the leader during `plan` or `vote`, the target of a protect goal (counts as met), and the last living traveller (fail). Tests in Task 6.
5. **Nobody connected, or a host Skip in every phase:** the game still moves forward to the recap. Test in Task 6.

---

## File map

```
games/long-trail/
  package.json, tsconfig.json                 copy heist's, name @games/long-trail
  shared/index.ts                             re-exports
  shared/types.ts                             every shared type below
  shared/manifest.ts                          longTrailManifest
  shared/settings.ts                          parseLongTrailSettings, longTrailSettingFields, setupProblem
  shared/rules-text.ts                        longTrailRules
  shared/pack.ts                              SettingPack interface, packFor(id)
  shared/packs/trade-route.ts                 tradeRoute: SettingPack (data only + twist)
  shared/numbers.ts                           every tunable number, one object
  shared/travel.ts                            plan validation, markets, travel day, health
  shared/events.ts                            event draw, effects, armed abilities
  shared/info.ts                              per-job private info
  shared/scoring.ts                           goals, wealth, grade, points, outcome
  shared/recap.ts                             recap from the day log
  server/index.ts, server/game.ts             longTrailGame
  client/index.ts, client/view.ts, client/styles.css, client/env.d.ts
  test/helpers.ts, pack.test.ts, travel.test.ts, events.test.ts,
       scoring.test.ts, recap.test.ts, game.test.ts, secrecy.test.ts, balance.test.ts
packages/game-core/src/index.ts, src/recap.ts, test/recap.test.ts   new stat key + award
apps/server/src/games.ts, apps/server/package.json                  registration
apps/web/src/games.ts, apps/web/package.json                        registration
docs/games/long-trail.md, docs/games/README.md, README.md           player docs
```

*(Plan call)* The pack lives in `shared/packs/`, not `packs/` as the spec sketched, so the client can import its labels.

---

### Task 1: Package, types, settings, manifest

**Files:**
- Create: `games/long-trail/package.json`, `tsconfig.json`, `shared/index.ts`, `shared/types.ts`, `shared/manifest.ts`, `shared/settings.ts`, `shared/rules-text.ts`, `shared/numbers.ts`, `test/settings.test.ts`

**Interfaces (Produces):**

```ts
// shared/types.ts
export type SettingId = "trade-route";              // monsoon, space-convoy later
export type Length = "short" | "normal" | "epic";
export interface LongTrailSettings { setting: SettingId; length: Length }
export const DEFAULT_SETTINGS: LongTrailSettings = { setting: "trade-route", length: "normal" };

export type Pace = "slow" | "steady" | "hard";
export type Rations = "full" | "half" | "none";
export type Health = 0 | 1 | 2 | 3;                 // dead, badly hurt, sick, well
export type Supply = "food" | "water" | "medicine" | "animals";
export type JobId = "guide" | "healer" | "trader" | "quartermaster" | "scout" | "driver" | "cook" | "lookout";
export type ArmableJob = "guide" | "scout" | "quartermaster" | "lookout";
export type Grade = "broke" | "fair" | "rich" | "legendary";
export type Phase = "reveal" | "plan" | "vote" | "choice" | "summary" | "recap" | "over";

export interface Stock {
  food: number; water: number; medicine: number; coins: number; animals: number;
  cargo: Record<string, number>;                   // good id → units
}
export interface Trade { item: string; qty: number }   // item: a good or a Supply; qty > 0 buys, < 0 sells (goods only)
export interface Plan {
  pace: Pace; rations: Rations; rest: boolean;
  fork: string | null;                             // next stop id, only at a fork
  doses: string[];                                 // player ids getting medicine today
  trades: Trade[];                                 // only at a market stop
}
export type Goal =
  | { kind: "coins"; atLeast: number }
  | { kind: "protect"; target: string }
  | { kind: "arrive-by"; share: number }           // day <= ceil(share * deadline)
  | { kind: "visit"; stop: string }
  | { kind: "cargo"; good: string; atLeast: number }
  | { kind: "never-starve" }                       // no day on "none" rations
  | { kind: "nobody-dies" }
  | { kind: "grade"; atLeast: Grade };

export type LongTrailAction =
  | { type: "ack" }
  | { type: "propose"; plan: Plan }
  | { type: "vote"; vote: "go" | "no-go" }
  | { type: "choose"; option: 0 | 1 }
  | { type: "arm"; on: boolean }                   // the actor's own armable job
  | { type: "next" }                               // summary and recap
```

Server state, public state, private state and event types also live here; Task 6 defines their fields. Put `LongTrailServerState`, `LongTrailPublicState`, `LongTrailPrivateState`, `LongTrailEvent` as empty-for-now exported interfaces so `index.ts` compiles.

```ts
// shared/settings.ts
export const MIN_PLAYERS = 3, MAX_PLAYERS = 8;
export function parseLongTrailSettings(input: unknown): LongTrailSettings | null;
export function longTrailSettingFields(raw: unknown, players: number): SettingField[];
export function setupProblem(settings: LongTrailSettings, players: number): string | null;  // always null in v1
// shared/manifest.ts
export const longTrailManifest: GameManifest;      // id "long-trail", name "Long Trail", icon "map"
// shared/rules-text.ts
export const longTrailRules: string[];
```

- [ ] **Step 1: Scaffold.** Copy `games/heist/package.json` and `tsconfig.json`, rename to `@games/long-trail`, dependencies `@games/game-core`, `@games/ui`, `@games/audio`. Add `"@games/long-trail": "workspace:*"` to `apps/server/package.json` and `apps/web/package.json`, then run `pnpm install`.
- [ ] **Step 2: Write the failing test** `test/settings.test.ts`:

```ts
expect(parseLongTrailSettings(undefined)).toEqual({ setting: "trade-route", length: "normal" });
expect(parseLongTrailSettings({ length: "epic" })).toEqual({ setting: "trade-route", length: "epic" });
expect(parseLongTrailSettings({ length: "huge" })).toBeNull();
expect(parseLongTrailSettings({ setting: "monsoon" })).toBeNull();
expect(parseLongTrailSettings([])).toBeNull();
const f = longTrailSettingFields({}, 5);
expect(f.map((x) => x.key)).toEqual(["setting", "length"]);
expect(f[1]!.options.map((o) => o.label)).toEqual(["Short", "Normal", "Epic"]);
expect(f[1]!.selected).toBe(1);
expect(f[1]!.hint).toBe("8 stops, about 25 min");   // Short: "5 stops, about 15 min", Epic: "12 stops, about 45 min"
expect(longTrailManifest).toMatchObject({ id: "long-trail", minPlayers: 3, maxPlayers: 8 });
```

- [ ] **Step 3: Run** `pnpm vitest run games/long-trail/test/settings.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 4: Implement** settings, manifest and rules text the way `games/heist/shared/rules-text.ts` does. The setting field has one option, "Trade route". Hint: "Camels, desert and markets. Sell goods for a better grade." Manifest description: "One caravan, a long trail and not enough food. Plan each day together, and keep your own goal secret." `rules-text.ts` is 12–18 plain lines covering the day loop, votes, health, jobs, goals, markets and scoring, with the numbers from the spec (+5, 0–6, +3, +2). `numbers.ts` exports an empty `N` object for now; Tasks 3–5 fill it.
- [ ] **Step 5: Run** the test and `pnpm typecheck`. Expected: PASS, no type errors.
- [ ] **Step 6: Commit** `Long Trail: package, settings and manifest`.

---

### Task 2: The setting pack and Trade Route data

**Files:**
- Create: `shared/pack.ts`, `shared/packs/trade-route.ts`, `test/pack.test.ts`

**Interfaces:**

```ts
// shared/pack.ts
export type LegKind = "desert" | "mountain" | "river" | "plain";
export type Danger = 0 | 1 | 2;                    // calm, rough, dangerous
export interface Leg { to: string; km: number; kind: LegKind; safe?: boolean }   // at a fork, exactly one branch is safe
export interface StopDef {
  id: string; name: string;
  next: Leg[];                                     // [] at the end, 2 at a fork, otherwise 1
  market?: { goods: Record<string, [number, number]>; supplies: Partial<Record<Supply, number>> };  // price ranges, fixed supply prices
}
export interface RouteDef { start: string; end: string; deadline: number; stops: StopDef[] }
export type Target = "everyone" | "random" | "weakest";
export interface Effect {
  stock?: Partial<Record<Supply | "coins", number>>;
  cargo?: number;                                  // lose this many units of the most-held good (negative only)
  health?: { target: Target; steps: number };      // steps > 0 hurts
  km?: number;                                     // negative = distance lost
  lostTime?: boolean;                              // marks it for the Scout
  chance?: { p: number; then: Effect; else?: Effect };   // p in 0..1
}
export interface PlainEvent { id: string; kind: LegKind | "any"; severity: Danger; text: string; effect: Effect }
export interface ChoiceEvent {
  id: string; kind: LegKind | "any"; severity: Danger; text: string;
  options: [{ label: string; effect: Effect }, { label: string; effect: Effect }];   // options[0] is the safer one
}
export type EventCard = PlainEvent | ChoiceEvent;   // ChoiceEvent has `options`
export interface GoalCard { id: string; text: string; goal: Goal | "protect-someone" }   // "protect-someone" gets a target when dealt
export interface SettingPack {
  id: SettingId; name: string;
  labels: Record<Supply | "coins" | "cargo", string>;
  goods: { id: string; name: string }[];
  jobs: Record<JobId, { name: string; info: string; ability: string }>;   // copy for the view and rules
  routes: Record<Length, RouteDef>;
  start(players: number): Stock;
  capacityPerAnimal: number;
  events: EventCard[];
  goals: GoalCard[];
  grades: Record<Grade, number>;                   // wealth thresholds, broke = 0
  endLines: { arrived: Record<Grade, string[]>; failed: string[] };
}
export function packFor(id: SettingId): SettingPack;
export function stopById(route: RouteDef, id: string): StopDef;
export function pathsOf(route: RouteDef): string[][];   // every start→end stop-id path
```

*(Plan call)* The Trade Route signature twist is markets, which every pack can describe with `market` on a stop. That means no hook functions are needed in v1, and `twist` from the spec sketch is dropped until Monsoon needs one (YAGNI).

- [ ] **Step 1: Write the failing test** `test/pack.test.ts`. For each length of `tradeRoute`:

```ts
const paths = pathsOf(r);
expect(paths.length).toBe({ short: 2, normal: 4, epic: 8 }[len]);           // 1, 2, 3 forks
for (const p of paths) expect(p.length).toBe({ short: 5, normal: 8, epic: 12 }[len]);
expect(r.deadline).toBe({ short: 12, normal: 20, epic: 32 }[len]);
// every fork: two legs, exactly one safe; every leg 40–100 km
// the shortest path at steady pace (N.kmPerDay.steady, Task 3) fits in deadline - 3 days
// about half the stops on each path have a market (between 40% and 60%, start and end excluded)
// the end stop has a market (cargo sells there)
```

Pack-wide: 8 jobs; at least 30 events, with at least a third choice events; every `LegKind` has at least 3 events of each severity counting `"any"`; at least 12 goal cards, all 8 `Goal` kinds present; every event `id` unique; `grades.broke === 0` and thresholds strictly increasing; `start(3)` and `start(8)` give positive stock and 3 goods.

- [ ] **Step 2: Run** `pnpm vitest run games/long-trail/test/pack.test.ts`. Expected: FAIL.
- [ ] **Step 3: Write `pack.ts`** (types, `packFor`, `stopById`, `pathsOf` by DFS) **and `packs/trade-route.ts`**. Goods: silk, spice, salt. Starting stock *(plan call, Task 7 tunes)*: food `8 × players`, water `6 × players`, medicine 3, coins 60, animals `2 + ceil(players / 2)`, cargo 2 of each good. `capacityPerAnimal` 4. Grades: fair 100, rich 200, legendary 350. Job copy comes from the spec's job table. Write the event and goal text in the site's plain style, with invented names. End lines: 2–3 dry ones per grade and 3 for failure, e.g. "Rich, late, and two short. A normal trip."
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `Long Trail: setting pack and Trade Route data`.

---

### Task 3: Travel, markets and health

**Files:**
- Create: `shared/travel.ts`, `test/travel.test.ts`
- Modify: `shared/numbers.ts`

**Interfaces:**

```ts
// shared/numbers.ts (starting values, tuned in Task 7)
export const N = {
  kmPerDay: { slow: 20, steady: 30, hard: 40 },
  foodPerTraveller: { full: 2, half: 1, none: 0 },
  waterPerTraveller: { desert: 2, other: 1 },
  risk: { hard: 1, half: 1, none: 2, thirst: 3, hungry: 2, sick: 1 },   // risk points per traveller per day
  riskStepChance: 0.12,                            // chance of losing a step, per risk point
  restHealChance: 0.6,                             // per traveller below Well, on a rest day with full rations
  animalFatigue: { hard: 1, rest: -2, max: 3 },    // at max, the next hard day kills one animal and resets to 0
} as const;

// shared/travel.ts
export interface Caravan {                         // the part of server state these functions touch
  stock: Stock; at: string; leg: Leg | null; kmLeft: number;   // leg null while halted at a stop
  day: number; health: Record<string, Health>; fatigue: number;
  prices: Record<string, Record<string, number>>;  // stop id → good id → price, rolled at start
  visited: string[]; starved: boolean;             // starved: any day on "none" rations
}
export function rollPrices(route: RouteDef, randomInt: (n: number) => number): Caravan["prices"];
export function planProblem(c: Caravan, pack: SettingPack, route: RouteDef, plan: Plan, travellers: string[], ctx: { healerAlive: boolean }): string | null;
export function applyTrades(c: Caravan, pack: SettingPack, trades: Trade[], traderLeads: boolean): void;   // trader: buy 10% cheaper, sell 10% dearer, rounded in the caravan's favour
export function overCapacity(c: Caravan, pack: SettingPack): boolean;   // total cargo > animals × capacityPerAnimal
export function travelDay(c: Caravan, pack: SettingPack, route: RouteDef, plan: Plan, travellers: string[], perks: Perks, randomInt: (n: number) => number): DayReport;
export function arrived(c: Caravan, route: RouteDef): boolean;   // at end, someone alive, day <= deadline
export function failed(c: Caravan, route: RouteDef): "all-dead" | "deadline" | null;
export interface Perks { driverHardShield: boolean; cookHalfAsFull: boolean }   // each once per leg, the caller tracks use
export interface DayReport { km: number; reached: string | null; used: Partial<Record<Supply, number>>; healthChanges: { playerId: string; from: Health; to: Health }[]; animalLost: boolean; shortFood: boolean; shortWater: boolean }
```

**Rules for `travelDay`** *(plan calls, from the spec)*:
1. Trades and doses are applied by the caller first (`applyTrades`, then a dose moves a traveller up one step and uses 1 medicine).
2. A rest day: no km, `fatigue += rest`, clamped at 0. Every traveller below Well, alive, with full rations heals one step with `restHealChance`.
3. A moving day: speed is `kmPerDay[pace]`, one pace slower if `overCapacity`. Hard pace adds fatigue, and at max an animal is lost. The caravan moves `min(speed, kmLeft)`. Reaching the stop sets `at`, halts, and pushes the stop to `visited`. Leftover km are lost (spec: "the rest of that day is lost").
4. Food and water per living traveller, drawn from stock. If stock runs short, use what's there, set `shortFood` / `shortWater`, and add `hungry` / `thirst` risk for everyone.
5. Risk per living traveller = the sum of the risk points that apply. Roll one step down with `min(1, risk × riskStepChance)`. The Driver shield cancels the `hard` point, and Cook turns `half` into `full` for health. `day += 1`.

- [ ] **Step 1: Write the failing tests** `test/travel.test.ts`, with a two-stop test route and seeded RNG:
  - `planProblem` rejects: a fork id on a non-fork day or not one of the branches, trades away from a market, an unknown item, selling more cargo than held, buying past coins (the total across trades), a dose to a dead or unknown player, more doses than medicine, a dose on a moving day while the Healer is dead. It accepts a plain steady/full plan.
  - Trader leading pays 9 for a good priced 10 and gets 11 selling it (`Math.floor` on buys, `Math.ceil` on sells).
  - Steady pace moves 30 km. Over capacity, steady moves 20. Halting with 10 km left moves 10 and sets `reached`.
  - 4 travellers on full rations on a desert leg use 8 food and 8 water.
  - With 3 food and 4 travellers on full rations: food ends at 0, never negative, and `shortFood` is true.
  - The fourth hard day in a row from fatigue 0 loses an animal and resets fatigue.
  - With `randomInt` stubbed to always return 0 (every roll hits), a hard/none day moves each living traveller down exactly one step. With the Driver shield and Cook perk set, a hard/half day with risk forced to 0 changes nothing.
  - Review Focus 1: the last living traveller dies on the day `reached === route.end`, so `arrived` is false and `failed` gives `"all-dead"`.
  - Review Focus 2: reaching the end on `day === deadline` counts as arrived. At `day === deadline + 1`, not at the end, `failed` gives `"deadline"`.
- [ ] **Step 2: Run** `pnpm vitest run games/long-trail/test/travel.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `travel.ts` and the `N` values above.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `Long Trail: travel, markets and health`.

---

### Task 4: Events, abilities and job info

**Files:**
- Create: `shared/events.ts`, `shared/info.ts`, `test/events.test.ts`

**Interfaces:**

```ts
// shared/events.ts
export const SEVERITY_WEIGHTS: Record<Danger, [number, number, number]> = { 0: [3, 1, 0], 1: [1, 2, 1], 2: [0, 1, 3] };
export function rollDangers(route: RouteDef, randomInt): Record<string, Danger>;   // key: `${from}>${to}`
export function drawEvent(pack: SettingPack, kind: LegKind, danger: Danger, randomInt, exclude: string[]): EventCard;   // exclude: ids drawn this game, reshuffle when exhausted
export function applyEffect(c: Caravan, effect: Effect, travellers: string[], randomInt): EffectReport;
export interface EffectReport { text: string[]; healthChanges: DayReport["healthChanges"]; stock: Partial<Record<Supply | "coins", number>>; km: number }
export interface Armed { guide: boolean; scout: boolean; quartermaster: boolean; lookout: boolean }
export interface Used { guide: boolean; scout: boolean; quartermaster: boolean; lookout: boolean }   // once per game
export function resolveEvent(c, pack, card, armed: Armed, used: Used, alive: Record<JobId, boolean>, travellers, randomInt): { card: EventCard; fired: ArmableJob[]; pendingChoice: ChoiceEvent | null; report: EffectReport | null };
export const CACHE_FOOD = 10;                      // Quartermaster cache, at the end of travel

// shared/info.ts
export type JobInfo =
  | { job: "guide"; nextLeg: Danger | null }
  | { job: "healer"; worsenChance: Record<string, number> }   // per sick or hurt traveller, today's chance at the current plan
  | { job: "trader"; nextMarket: { stop: string; prices: Record<string, number> } | null }
  | { job: "quartermaster"; foodDays: number; waterDays: number }   // at current rations and the next leg's kind
  | { job: "scout"; nextFork: { stop: string; km: Record<string, number> } | null }   // total km on each branch to where the branches meet
  | { job: "driver"; fatigue: number; max: number }
  | { job: "cook"; foodDays: Record<Rations, number> }
  | { job: "lookout"; odds: { option: 0 | 1; p: number }[] | null };   // today's choice event, while it's open
export function jobInfo(job: JobId, c: Caravan, pack, route, state: { dangers; plan: Plan; travellers: string[]; choice: ChoiceEvent | null }): JobInfo;
```

**Rules** *(plan calls)*:
- Guide armed, unused, alive → the first **plain** event drawn is rerolled once (the reroll stands).
- Lookout armed → the first **choice** event drawn is swapped once.
- Scout armed → the first event whose effect (or chosen option's effect) has `lostTime` gets its `km` and lost days zeroed.
- Quartermaster armed → at the end of the next moving day's travel, `+CACHE_FOOD` food.
- An armed ability whose holder is dead does nothing. Using one sets `used` and clears `armed`.
- `weakest` = lowest living health, ties broken by `randomInt`. `random` = any living traveller. Dead travellers are never targets.
- Effects clamp stock at 0, and `km` never takes the caravan back past the stop it left.

- [ ] **Step 1: Write the failing tests** `test/events.test.ts`:
  - `drawEvent` with danger 0 never returns severity 2. It honours `kind` (or `"any"`) and doesn't repeat an excluded id until the pool is used up.
  - An armed Guide rerolls a plain event once: `fired` includes `"guide"`, `used.guide` is true, and a second plain event the next day isn't rerolled.
  - An armed Lookout swaps a choice event. `pendingChoice` is the new card.
  - An armed Scout zeroes a `lostTime` effect. A dead Scout's armed ability does nothing.
  - `applyEffect` with `{ health: { target: "weakest", steps: 1 } }` hits the lowest living traveller. `{ stock: { food: -50 } }` with 10 food leaves 0. A `chance` with `p: 1` applies `then`, and with `p: 0` applies `else`.
  - `jobInfo("quartermaster")` with 20 food, 4 travellers on full gives `foodDays: 2`. `jobInfo("scout")` gives `null` when no fork is ahead. `jobInfo("lookout")` gives the choice's chance `p` values.
- [ ] **Step 2: Run** `pnpm vitest run games/long-trail/test/events.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `events.ts` and `info.ts`.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `Long Trail: events, job abilities and job info`.

---

### Task 5: Goals, scoring and the recap

**Files:**
- Create: `shared/scoring.ts`, `shared/recap.ts`, `test/scoring.test.ts`, `test/recap.test.ts`

**Interfaces:**

```ts
// shared/scoring.ts
export function dealGoals(pack, route, playerIds: string[], randomInt): Record<string, Goal>;
//   distinct cards per player; "protect-someone" gets a random other player; a "visit" goal names a stop on only one fork branch
export function wealth(c: Caravan, route: RouteDef): number;      // coins + Σ cargo × end-stop price
export function gradeOf(pack, wealth: number): Grade;
export function goalMet(goal: Goal, end: EndView): boolean;
export interface EndView { arrived: boolean; day: number; deadline: number; coins: number; cargo: Record<string, number>; grade: Grade | null; alive: Record<string, boolean>; removed: string[]; visited: string[]; starved: boolean; deaths: number }
export const POINTS = { arrived: 5, grade: { broke: 0, fair: 2, rich: 4, legendary: 6 }, goal: 3, alive: 2 } as const;
export function points(playerId: string, goal: Goal, end: EndView): number;
export function outcome(players: string[], goals: Record<string, Goal>, end: EndView, pack, dayCount: number): GameOutcome;
//   arrived: winnerIds = top points (ties share), headline "Arrived <grade>, day <n>"; failed: winnerIds [], headline "Everyone died on the trail" / "The season ended on day <n>"
//   standings: points, label like "9 pts · goal met"
```

**Goal rules:** coins, cargo, arrive-by and grade goals need `arrived`. A protect goal is met if the target is alive at the end or was removed. Nobody-dies counts deaths among travellers still in the game. Never-starve uses `starved`. Visit checks `visited`. A removed player's own goal is void, and they get no standing.

```ts
// shared/recap.ts
export interface DayLog {
  day: number; leader: string; plan: Plan;
  proposals: { by: string; votes: Record<string, "go" | "no-go">; passed: boolean }[];
  stayedCourse: boolean;
  event: { id: string; text: string; choice?: { votes: Record<string, 0 | 1>; picked: 0 | 1; label: string } } | null;
  report: { km: number; reached: string | null; healthChanges: DayReport["healthChanges"]; stockDelta: Partial<Record<Supply | "coins", number>>; cargoDelta: Record<string, number> };
  where: string;                                   // stop name, or "between X and Y"
}
export interface Recap {
  route: { stop: string; name: string; day: number }[];
  fates: { playerId: string; alive: boolean; day?: number; where?: string }[];
  bigCalls: { day: number; question: string; go: number; noGo: number; result: string }[];   // up to 3
  worstDay: { day: number; text: string } | null;
  reveals: { playerId: string; job: JobId; goal: string; met: boolean }[];
  haul: { coins: number; cargoSale: number; wealth: number; grade: Grade | null };
  line: string;
}
export function buildRecap(log: DayLog[], pack, route, end: EndView, jobs: Record<string, JobId>, goals: Record<string, Goal>, goalText: Record<string, string>, randomInt): Recap;
```

**Recap rules** *(plan calls)*:
- **bigCalls:** every plan vote and choice vote, ranked by margin `|go − noGo|` ascending, then more voters, then later day. Top 3. `question` is the plan in a few words ("Hard pace, half rations", "Ford the river"). `result` is that day's biggest change in a few words.
- **worstDay** score = `10 × health steps lost + food lost + water lost + coins lost / 2 + 5 × animals lost`, highest wins, null if every day scored 0.
- **line:** a random pick from `endLines`.

- [ ] **Step 1: Write the failing tests:**
  - `scoring.test.ts`: `dealGoals` for 8 players is distinct, and a protect target is never the holder (100 seeds). Wealth with 50 coins and 3 silk at an end price of 20 is 110. `gradeOf(110)` is `"fair"`, `gradeOf(99)` is `"broke"`, `gradeOf(350)` is `"legendary"`. On arrival as rich, with the goal met and alive: `points` is 14 (5 + 4 + 3 + 2). Failed with the goal met: 3, alive: 2. A protect goal whose target was removed is met. A coins goal on a failed caravan isn't. `outcome` for a failed caravan has empty `winnerIds`. Tied top points share the win.
  - `recap.test.ts`: a hand-built 4-day log gives `bigCalls` ordered by margin (a 2–1 vote before a 3–0), at most 3 entries; `worstDay` is the day with a death; `fates` lists the death with its day and `where`; and `route` lists the stops in the order they were reached, with days.
- [ ] **Step 2: Run** `pnpm vitest run games/long-trail/test/scoring.test.ts games/long-trail/test/recap.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `scoring.ts` and `recap.ts`.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `Long Trail: goals, scoring and recap`.

---

### Task 6: The server game, registration and party stats

**Files:**
- Create: `server/game.ts`, `server/index.ts`, `test/helpers.ts`, `test/game.test.ts`, `test/secrecy.test.ts`
- Modify: `shared/types.ts`, `packages/game-core/src/index.ts` (`STAT_KEYS`), `packages/game-core/src/recap.ts` (`RULES`), `packages/game-core/test/recap.test.ts`, `apps/server/src/games.ts`

**Timers** *(plan call, fixed, no speed preset)*: reveal 30 s, plan 45 s, vote 25 s, choice 20 s, summary 5 s, recap 20 s. One timer id, `"phase"`, as in Heist.

**Phase flow:**

| Phase | Ends when | Then |
|---|---|---|
| `reveal` | all connected acked, or timer | `plan` (leader = seat `randomInt(n)`) |
| `plan` | leader proposes, timer, or Skip | `vote`. On timer or Skip, the open plan is proposed for them |
| `vote` | all connected players in the game voted, or timer | passed: resolve the day. Failed on the 1st proposal: `plan` with the next seat. Failed on the 2nd: resolve with the stay-the-course plan |
| `choice` | all connected voted, or timer | apply the picked option, then `summary` |
| `summary` | all connected tapped Next, or timer | arrived or failed: `recap`. Otherwise `plan`, leader = the next seat after the day's last proposer |
| `recap` | all connected tapped Next, or timer | `over` (`getResult` turns non-null here) |

**Resolving a day:** apply trades and doses, then `travelDay`, perks, and the Quartermaster cache. Then draw an event (on rest days and days the caravan sits at a stop too, using the last leg's kind) and run `resolveEvent`. A choice event goes to `choice`, otherwise `summary`. Append a `DayLog`, then check `failed` / `arrived`. At a stop, the plan must include the `fork` when the stop has two legs, and the next leg starts once the plan passes.

**Votes:** a majority of votes cast passes, and a tie (0–0 included) fails. Everyone in the game votes, dead travellers included. Choice: majority, and a tie goes to the leader's vote, or option 0 if the leader didn't vote.

**The open / stay-the-course plan:** yesterday's pace and rations (day 1: steady/full), `rest: false`, the `safe` branch at a fork, no doses, no trades.

**Arming:** `arm` is valid in `plan` and `vote` for the actor's own armable job, while alive and unused. Arming is never public.

**Skip** (`skipTurn`): leader in `plan` → the open plan. A voter in `vote` or `choice` → dropped from this ballot (`dropVoter`). In `reveal`, `summary` or `recap` → counts as acked or Next.

**Removal** (`onPlayerRemoved`): mark them `left`, take their traveller out of `travellers` (not a death), drop their votes. Their goal is void, and goals that target them count as met. A leader removed in `plan` or `vote` → the next seat plans fresh, at a fresh clock. If fewer than 2 players are left, the game ends interrupted with no winner (`over` with no recap). If no living traveller is left → fail, then `recap`.

**Party stats:** add `"noGoVotes"` to `STAT_KEYS`, and an award to `RULES`: `{ id: "doubter", title: "Hardest to convince", min: 5, score: noGoVotes, line: "Voted No-go N times." }`, with a test in `packages/game-core/test/recap.test.ts` the same way the other awards are tested. Long Trail bumps `noGoVotes` for each No-go on a plan vote.

**State shapes** (in `shared/types.ts`):
- **Server:** `phase, deadline, settings, players {id, left, away}, travellers: string[]` (in the game, alive or dead), `caravan: Caravan, dangers, jobs: Record<id, JobId>, goals, goalText, armed, used, perksUsedThisLeg {driver, cook}, leader: number, proposalNo: 1 | 2, plan: Plan | null, lastPlan, ballot, choiceBallot, choice: ChoiceEvent | null, acks: string[], drawn: string[], log: DayLog[], lastDay: DayLog | null, recap: Recap | null, end: EndView | null, interrupted: boolean, stats: PartyStats`.
- **Public:** phase, deadline, leader id, proposal no., day, deadline day, the route as stop names plus forks (with no km beyond the current leg), current stop or leg with km left, stock with food and water as **bands** (`"plenty" | "some" | "low" | "out"`, by days left at current rations: ≥ 6, 3–5, 1–2, 0), coins, medicine, animals and cargo exact, prices at the current stop if it's a market, travellers' health, every player's **job** (public), the pending plan, vote counts plus who has voted, closed votes by name, the open choice card, `lastDay`, and `recap` from the `recap` phase on.
- **Private:** your job's `JobInfo`, your goal text, whether your ability is armed or used, your vote, your choice vote, and whether you've acked or tapped Next.

- [ ] **Step 1: Write `test/helpers.ts`** in the style of `games/heist/test/helpers.ts`: `start(n, settings?, seed?)`, `act`, `ok`, `err`, `ring`, `ids`, `leaderId`, `proposeOpen(s)`, `voteAll(s, vote, except?)`, `chooseAll(s, option)`, `nextAll(s)`, `playDay(s)` (propose open, all Go, settle any choice with 0, tap Next).
- [ ] **Step 2: Write the failing tests** `test/game.test.ts`:
  - createGame: one traveller per player, all Well, 8 distinct jobs dealt from the 8 (a subset for fewer players), and every player has a goal.
  - Only the leader may propose (`not-leader`). An invalid plan is rejected with the `planProblem` text.
  - A 2–2 vote fails and passes the lead to the next seat with `proposalNo` 2. A second failure stays the course: `log.at(-1).stayedCourse` is true.
  - A choice tie goes to the leader's pick.
  - `arm` outside your armable job is rejected. Arming the Guide shows up only in the Guide's private state.
  - Review Focus 4: removing the leader during `plan` gives the next seat a fresh plan clock. Removing a protect target makes that goal met at the end. Removing the last living traveller → `recap` with the failed headline.
  - Review Focus 5: from `reveal`, ringing the phase timer over and over (nobody acts) reaches `over` within `(deadline + 1) × 6 + 3` rings, for every length.
  - Host Skip on the leader proposes the open plan.
  - A seeded full game played with `playDay` reaches `recap`, then `over`, and `getResult` is non-null only in `over`.
  - `partyStats` counts each No-go vote, and neither projection contains `stats`.
- [ ] **Step 3: Write the failing tests** `test/secrecy.test.ts`: in every phase of a seeded game, `JSON.stringify(getPublicState(s))` contains no goal text, no armed flags and no `JobInfo` fields (`worsenChance`, `foodDays`, `nextFork`, `odds`, `fatigue`, `nextMarket`). Another player's private state never contains your goal. Public `recap` (from the `recap` phase) does reveal everything.
- [ ] **Step 4: Run** `pnpm vitest run games/long-trail packages/game-core`. Expected: FAIL.
- [ ] **Step 5: Implement** `server/game.ts` (clone-and-mutate helpers as in Heist's `game.ts`), `server/index.ts`, the stat key and award, and register `"long-trail": longTrailGame` in `GAMES` in `apps/server/src/games.ts`.
- [ ] **Step 6: Run** `pnpm test && pnpm typecheck`. Expected: all pass, including `apps/server/test/games.test.ts` (partyStats present).
- [ ] **Step 7: Commit** `Long Trail: the server game, and a Hardest to convince award`.

---

### Task 7: Balance check

**Files:**
- Create: `test/balance.test.ts`
- Modify: `shared/numbers.ts`, `shared/packs/trade-route.ts` (numbers only)

Two bots drive full games through `longTrailGame` with seeded RNG, 300 games per length and 5 players:
- **Sensible:** steady pace. Full rations while food covers the days left on this leg, otherwise half. Rest when someone is Badly hurt and the deadline margin is at least 3 days. Dose anyone Badly hurt. At markets, buy food and water to cover the next leg plus 2 days, sell any good whose price here is at least 20% above its range middle, and buy the cheapest good up to capacity with spare coins over 40. Choice: option 0. Arm every armable ability on day 1.
- **Careless:** random pace, random rations, no trades, random choices.

- [ ] **Step 1: Write the test.** It asserts, per length: the sensible arrival rate is in **[0.55, 0.80]**; among sensible arrivals, `fair` + `rich` is at least 50% and `legendary` at most 15%; the careless arrival rate is at most 0.35; and the median day count for sensible arrivals is between `deadline − 5` and `deadline − 1`. It prints the table with `console.table` so tuning can see it.
- [ ] **Step 2: Run** `pnpm vitest run games/long-trail/test/balance.test.ts`. Expected: probably FAIL on some band.
- [ ] **Step 3: Tune** only `N`, the pack's start stock, prices, grade thresholds and event effects until it passes for all three lengths. Don't change rules. If the numbers can't pass without a rule change, stop and report.
- [ ] **Step 4: Run** `pnpm test`. Expected: PASS, and the whole balance file under 20 s.
- [ ] **Step 5: Commit** `Long Trail: tune numbers to the balance bands`, with the final table in the commit body.

---

### Task 8: Client view

**Files:**
- Create: `client/index.ts`, `client/view.ts`, `client/styles.css`, `client/env.d.ts`
- Modify: `apps/web/src/games.ts`

**Register:** `"long-trail": { section: "strategy", manifest: longTrailManifest, rules: longTrailRules, settingFields: longTrailSettingFields, loadClient: () => import("@games/long-trail/client").then((m) => m.default) }`.

**Layout** (phone first, also checked at 1280×720). Class prefix `lt-`:

```
┌ Day 7 of 20 · Plan · 0:32 ───────────────┐
│ ●──●──◐····○──○<○──○──○   Salt Well 40 km │  route strip: reached, current, ahead, fork
├ Food ▓▓▓░ some  Water ▓▓░░ low  Med 2  ──┤
│ Coins 84 · Camels 4 · Silk 3 Spice 0 Salt 5 (12/16) │
├ Travellers ─────────────────────────────┤
│ (face) Ravi · Guide · Well               │
│ (face) Asha · Healer · Sick              │
├ You: Guide ── Next leg looks rough ─────┤
│ Goal: Arrive before day 16    [Use reroll] │  private panel
├ Phase panel ────────────────────────────┤
│ leader: plan form │ others: plan preview + Go/No-go │
│ choice: card + two buttons │ summary: day report + Next │
│ recap: route, fates, big calls, worst day, reveals, haul, line, Done │
└──────────────────────────────────────────┘
```

The plan form: pace and rations as segmented buttons, a Rest toggle, fork buttons (only at a fork), dose checkboxes per traveller (only with medicine), and at a market a trade list with − / + per item showing price and running coins. Propose is disabled with the `planProblem` text when it's invalid, which uses the shared function, the same as the server.

- [ ] **Step 1: Implement** the view, following `games/heist/client/view.ts` (render from props, `rejected` shows the message, countdown from `api.serverNow()`, `api.setTurn("Plan the day")` for the leader). Use stock labels from `packFor(settings).labels`. No emoji, theme tokens only.
- [ ] **Step 2: Run** `pnpm typecheck`. Expected: PASS.
- [ ] **Step 3: Play it** with `pnpm dev`: open `/#owner=dev` plus 2 more tabs, create a room, pick Long Trail on Short, and play to the recap. Check every phase at phone width (390×844) and at 1280×720, with no horizontal scroll. Take a screenshot of the plan form, a choice event and the recap.
- [ ] **Step 4: Commit** `Long Trail: the client view`.

---

### Task 9: Player docs

**Files:**
- Create: `docs/games/long-trail.md`
- Modify: `docs/games/README.md`, `README.md`

- [ ] **Step 1: Write** `docs/games/long-trail.md` with the same sections as `docs/games/heist.md` (The short version, How it plays, Winning and scoring, Settings, On your screen, When things go sideways, Tips), using the shipped numbers from `numbers.ts` and the pack.
- [ ] **Step 2: Add** a row to `docs/games/README.md` (`| [Long Trail](long-trail.md) | 3–8 | One caravan, a long trail, and a secret goal each. |`) and add Long Trail to the README's **Strategy** line.
- [ ] **Step 3: Check** the docs against the code. Every number in the doc matches `N`, `POINTS`, the timers and the pack.
- [ ] **Step 4: Commit** `Docs: Long Trail`.
