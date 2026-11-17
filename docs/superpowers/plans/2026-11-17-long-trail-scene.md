# Long Trail Scene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An animated canvas band at the top of Long Trail where the caravan walks through the current land, and each day's event is acted out.

**Architecture:** The server records what the event alone did (`DayLog.eventOutcome`) and what part of the day already ran during a choice (`today`). The client computes a `SceneModel` from public state alone (a pure, tested function), then a `TrailScene` class draws it on a canvas at 30 fps, running the day's beats (travel, event, settle) through a small director. Kenney CC0 PNGs make the far backdrop. Everything alive is drawn in code.

**Tech Stack:** TypeScript, Canvas 2D, Vite (`import.meta.glob`), vitest (node environment, no DOM).

**Spec:** `docs/superpowers/specs/2026-11-17-long-trail-scene-design.md`

## Global Constraints

- The scene reads only `LongTrailPublicState`, the pack and the route. Nothing in `games/long-trail/client/scene/` may import `LongTrailPrivateState` or read `props.private`.
- It must never show how dangerous a leg is, which way at a fork is safer or shorter, or prices. Sky and weather come only from the event that happened.
- Band: full width of the game column (max 600px), aspect ratio near 4:1, about 150px tall on a phone. Canvas `aria-hidden="true"`.
- 30 fps. Pause when `document.visibilityState !== "visible"` or the band is off screen (IntersectionObserver). Stop in `destroy()`.
- `prefers-reduced-motion: reduce`: no scrolling and no walking. Each beat draws one still frame.
- No flashing faster than 3 times a second.
- Copy: short, plain sentences, no idioms, no emoji anywhere (UI, docs, commits). The scene itself has no words.
- Day report timer: `TIMERS.summary = 9_000`. Beat lengths: travel 3000 ms, event 4000 ms, settle 2000 ms. On a choice day: travel 3000 ms then the situation loop in `choice`, and the result 5000 ms then settle 2000 ms in `summary`.
- Dead travellers fade out and are not drawn after. No graves, tombstones, wagons or oxen. Nothing copied from the classic trail game.
- Art: Kenney Background Elements Redux (CC0) for the far layers, credited in `games/long-trail/client/assets/LICENSES.md`. Only the files used are committed.
- Long Trail state changes do not bump `PROTOCOL_VERSION` (earlier Long Trail state changes did not).
- Run tests with `pnpm vitest run games/long-trail` and types with `pnpm --filter @games/long-trail typecheck`.

## Review Focus

1. **A reload mid-report (`props.snapshot`)** shows the end state at once, not the sequence again. Test in Task 6 (`startAt` with `snapshot`).
2. **A tab hidden through a whole day report and then shown again** shows the end state, with no burst of catch-up frames. Test in Task 6 (`beatAt` past the total).
3. **The leader changing the draft many times** changes the walking speed without restarting the day's sequence. Test in Task 5 (`beatsKey` ignores the draft).
4. **More badly hurt travellers than camels, or no camels at all**: only as many ride as there are camels, and the rest limp. Test in Task 5.
5. **A player who left, or a seat with no avatar seed**: their traveller is not drawn, and a missing colour falls back to a fixed one. Nothing throws. Test in Task 5.

---

## File Structure

| File | Job |
|---|---|
| `games/long-trail/shared/events.ts` | `EffectReport` gains `cargo` and `lucky`. New `EventOutcome` type. |
| `games/long-trail/shared/recap.ts` | `DayLog.eventOutcome?` |
| `games/long-trail/shared/types.ts` | `LongTrailPublicState.today`. `TIMERS.summary` to 9000. |
| `games/long-trail/server/game.ts` | Sets `eventOutcome` in `resolveDay` and `closeChoice`. Extracts `stockDeltas`. |
| `games/long-trail/server/views.ts` | Projects `today` during `choice`. |
| `games/long-trail/shared/pack.ts` | `SceneId`, `SCENE_IDS`, `scene` fields on cards and options. |
| `games/long-trail/shared/packs/trade-route.ts` | A scene on every card and option. |
| `packages/ui/src/faces.ts` | `faceColor(seed)`. |
| `games/long-trail/client/scene/model.ts` | `sceneModel()`: pure, from public state to what to draw. |
| `games/long-trail/client/scene/director.ts` | `beatAt()`, `startAt()`: pure timing. |
| `games/long-trail/client/scene/art.ts` | Loads the Kenney PNGs, with flat-shape fallbacks. |
| `games/long-trail/client/scene/sprites.ts` | Camel, traveller, tent, fire, stall, house, gate, rider, drawn in code. |
| `games/long-trail/client/scene/backdrop.ts` | Parallax layers for each terrain, and the forked path. |
| `games/long-trail/client/scene/events/*.ts` | One file for each event scene. `index.ts` is the registry. |
| `games/long-trail/client/scene/stage.ts` | `TrailScene`: canvas, DPR, loop, pause, reduced motion, draws the model. |
| `games/long-trail/client/view.ts`, `styles.css` | Mount the scene above a thinner route line. |
| `games/long-trail/test/scene-*.test.ts` | Model, director, drawing smoke tests, and the private-state guard. |

---

### Task 1: The server records what the event did

**Files:**
- Modify: `games/long-trail/shared/events.ts` (`EffectReport`, `applyEffect`)
- Modify: `games/long-trail/shared/recap.ts:8-19` (`DayLog`)
- Modify: `games/long-trail/server/game.ts:173-270` (`resolveDay`, `closeChoice`)
- Test: `games/long-trail/test/events.test.ts`, `games/long-trail/test/game.test.ts`

**Interfaces:**
- Produces:
  - `EffectReport` gains `cargo: number` (units lost, 0 or negative) and `lucky: boolean | null` (the outcome of the first `chance` roll met, null if the effect has none).
  - `export type EventOutcome = Omit<EffectReport, "text">` in `shared/events.ts`.
  - `DayLog.eventOutcome?: EventOutcome`. It is missing when no event happened, and in games stored before this change.

- [ ] **Step 1: Write the failing tests**

In `events.test.ts`:
- `"applyEffect reports cargo lost"`: a caravan with cargo `{ silk: 3 }`, effect `{ cargo: -2 }`. Expect `report.cargo === -2`. With cargo `{ silk: 1 }`, expect `-1` (clamped).
- `"applyEffect reports which way a chance went"`: effect `{ chance: { p: 1, then: { stock: { water: 1 } } } }` gives `lucky === true`. `p: 0` gives `lucky === false`. `{ stock: { water: 1 } }` gives `lucky === null`.

In `game.test.ts`:
- `"a plain event's outcome is kept apart from the day"`: play seeded days until `lastDay.event` is set and the card is not a choice. Expect `lastDay.eventOutcome` to be defined. Expect each of its `healthChanges` to also be in `lastDay.report.healthChanges`, and its `healthChanges` to be the last `eventOutcome.healthChanges.length` entries of that list.
- `"a choice's outcome is kept after the vote"`: reach a `choice` phase (loop seeds as other tests do), `chooseAll(s, 0)`. Expect `lastDay.eventOutcome` to be defined and `lastDay.event.choice` to be set.
- `"no event, no outcome"`: a day where the caravan arrives at the end has `eventOutcome === undefined`.

- [ ] **Step 2: Run the tests and check they fail**

Run: `pnpm vitest run games/long-trail/test/events.test.ts games/long-trail/test/game.test.ts`
Expected: FAIL on `cargo`, `lucky` and `eventOutcome`.

- [ ] **Step 3: Implement**

- `applyEffect`: add `report.cargo -= lost` where the cargo loop ends. Set `report.lucky` on the first `chance` it meets (`report.lucky ??= rolled`, starting from `null`).
- `resolveDay`: after `changes.push(...res.report!.healthChanges)`, set `state.draft.log.eventOutcome = outcomeOf(res.report!)`. `closeChoice`: the same with `res.report`.
- `outcomeOf(r: EffectReport): EventOutcome` drops `text` and clones the arrays. Put it in `server/game.ts`.

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm vitest run games/long-trail`
Expected: PASS, including the old `secrecy.test.ts` (the outcome holds nothing secret).

- [ ] **Step 5: Commit**

```bash
git add games/long-trail/shared/events.ts games/long-trail/shared/recap.ts games/long-trail/server/game.ts games/long-trail/test/events.test.ts games/long-trail/test/game.test.ts
git commit -m "Long Trail: the day log keeps what the event did"
```

---

### Task 2: Today's travel is public during a choice. The day report is 9 s.

**Files:**
- Modify: `games/long-trail/shared/types.ts` (`LongTrailPublicState`, `TIMERS`)
- Modify: `games/long-trail/server/game.ts` (`closeDraft`)
- Modify: `games/long-trail/server/views.ts` (`publicState`)
- Test: `games/long-trail/test/game.test.ts`, `games/long-trail/test/secrecy.test.ts`

**Interfaces:**
- Consumes: `DayLog` (Task 1).
- Produces:
  - `LongTrailPublicState.today: { day: number; plan: Plan; report: DayLog["report"] } | null`. It is set only while `phase === "choice"` and `state.draft` exists. Its `report.stockDelta` and `cargoDelta` are filled as `closeDraft` fills them.
  - `export function stockDeltas(before: Stock, now: Stock): { stockDelta: DayLog["report"]["stockDelta"]; cargoDelta: Record<string, number> }` in `server/game.ts`, used by `closeDraft` and `views.ts`. If importing from `game.ts` into `views.ts` makes a cycle, move it to `server/world.ts`.
  - `TIMERS.summary === 9_000`.

- [ ] **Step 1: Write the failing tests**

- `game.test.ts` `"today is public only during a choice"`: in `plan`, `vote` and `summary`, `g.getPublicState(s).today` is `null`. In `choice`, it has `day === s.draft.log.day`, `plan` equal to the plan that passed, and `report.km` equal to `draft.log.report.km`.
- `game.test.ts` `"the day report waits 9 seconds"`: on entering `summary`, `s.deadline - now === 9_000`.
- `secrecy.test.ts`: the existing `sealed()` already runs on every phase. Add a `choice`-phase call if the seeded loop does not reach one, so `today` is checked for job info and goals.

- [ ] **Step 2: Run the tests and check they fail**

Run: `pnpm vitest run games/long-trail/test/game.test.ts`
Expected: FAIL on `today` and on the 9000 ms deadline. Any old test that asserts a 5000 ms summary also fails. Update that test to 9000.

- [ ] **Step 3: Implement** the field, the projection and the timer as in Interfaces.

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm vitest run games/long-trail && pnpm --filter @games/long-trail typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add games/long-trail/shared/types.ts games/long-trail/server/game.ts games/long-trail/server/views.ts games/long-trail/test/game.test.ts games/long-trail/test/secrecy.test.ts
git commit -m "Long Trail: today's travel is public during a choice, day report 9 s"
```

---

### Task 3: Every card names its scene

**Files:**
- Modify: `games/long-trail/shared/pack.ts`
- Modify: `games/long-trail/shared/packs/trade-route.ts` (the `ev` and `ch` helpers and all 54 cards)
- Test: `games/long-trail/test/pack.test.ts`

**Interfaces:**
- Produces:
  - `export const SCENE_IDS = ["calm", "storm", "robbers", "fire", "water", "rocks", "camel-trouble", "sick", "visitor", "water-found", "turn-back", "thief", "leak"] as const;`
  - `export type SceneId = (typeof SCENE_IDS)[number];`
  - `PlainEvent.scene?: SceneId` (the event). `ChoiceEvent.scene?: SceneId` (the situation, looped while people pick). Each option: `scene?: SceneId` (the result) and `badScene?: SceneId` (the result when `eventOutcome.lucky === false`, falling back to `scene`).
  - The fields are optional in the type, so a future pack still compiles. The test makes them required for packs that ship.

- [ ] **Step 1: Write the failing test**

`pack.test.ts` `"every card and option has a scene"`: for every card in `packFor("trade-route").events`, `SCENE_IDS` includes `card.scene`. For a choice card, every option's `scene` is in `SCENE_IDS`, and `badScene` is in it when set. Also check that every option whose effect has a `chance` has a `badScene`.

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm vitest run games/long-trail/test/pack.test.ts`
Expected: FAIL (no scenes yet).

- [ ] **Step 3: Add the types, then a scene to every card**

Add `scene` as the last argument of `ev(...)`, and as part of the `ch(...)` arguments. Plain cards use the table in the spec's "Event scenes" section. Choice cards: pick the situation and results from the same list. Add a 14th scene only if a card truly fits none, and say which card in the commit message.

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm vitest run games/long-trail`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add games/long-trail/shared/pack.ts games/long-trail/shared/packs/trade-route.ts games/long-trail/test/pack.test.ts
git commit -m "Long Trail: every event card names its scene"
```

---

### Task 4: Avatar colour for the client

**Files:**
- Modify: `packages/ui/src/faces.ts`, `packages/ui/src/index.ts` (re-export)
- Test: `packages/ui/test/faces.test.ts` (new)

**Interfaces:**
- Produces: `export function faceColor(seed: string): string`. It returns the same disc colour `faceSvg(seed)` paints, so it is the first pick of `picker(seed)` from `DISCS`. Exported from `@games/ui`.

- [ ] **Step 1: Write the failing test**

`"faceColor matches the face's disc"`: for seeds `["a", "zed", "p3"]`, `faceSvg(seed)` contains `faceColor(seed)`. `faceColor("a") === faceColor("a")`.

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm vitest run packages/ui`
Expected: FAIL, `faceColor` is not exported.

- [ ] **Step 3: Implement.** Have `faceSvg` call the same picker, so the two can never drift.

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm vitest run packages/ui`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/faces.ts packages/ui/src/index.ts packages/ui/test/faces.test.ts
git commit -m "UI: faceColor, the avatar's disc colour"
```

---

### Task 5: The scene model

**Files:**
- Create: `games/long-trail/client/scene/model.ts`
- Test: `games/long-trail/test/scene-model.test.ts`

**Interfaces:**
- Consumes: `LongTrailPublicState` (with `today`, `lastDay.eventOutcome`), `SettingPack`, `RouteDef`, `SceneId`, `EventOutcome`, `Plan`, `Health`.
- Produces:

```ts
export type Terrain = LegKind | "town" | "market" | "gate";
export interface Walker { id: string; color: string; health: Health; riding: boolean } // health is the final health; 0 = fades out in settle
export type BeatKind = "travel" | "event" | "situation" | "settle";
export interface Beat {
  kind: BeatKind;
  ms: number; // Infinity for "situation"
  health: Record<string, Health>; // what each walker is drawn with as this beat starts
  camels: number; // camels drawn as this beat starts
  scene?: SceneId; // event and situation beats
  outcome?: EventOutcome | null; // event beats
  fill?: [number, number]; // travel: share of the leg walked at the start and at the end, 0..1
  arrive?: string | null; // travel: stop id reached, slides in
}
export interface SceneModel {
  terrain: Terrain;
  fork: boolean; // halted at a fork with no leg yet: draw two alike paths
  camp: boolean;
  speed: 0 | 1 | 2 | 3; // 0 stopped, then slow, steady, hard
  walkers: Walker[];
  camels: number;
  overloaded: boolean;
  beats: Beat[]; // [] in plan and vote
  beatsKey: string; // `${phase}:${day}`; a new key starts the sequence again
}
export interface SceneInput {
  game: LongTrailPublicState;
  pack: SettingPack;
  route: RouteDef;
  draft: Plan | null; // the leader's draft in plan, else null
  colorOf: (playerId: string) => string | null;
}
export const FALLBACK_COLOR = "#d9c3a0";
export function sceneModel(input: SceneInput): SceneModel;
```

Rules the function follows:
- **Which plan sets the pace and camp:** `draft` in plan, `game.plan` in vote, `game.today.plan` in choice, `game.lastDay.plan` in summary, else `game.openPlan`.
- **Terrain:** `game.leg.kind` while on a leg. Halted with `game.at === route.end` gives `gate`, a market stop gives `market`, any other stop gives `town`.
- **Speed:** 0 if halted (no leg) and not resting. Otherwise 1, 2 or 3 by pace. `camp` when the shown plan has `rest`.
- **`fork`:** true when halted at a stop whose `next` has 2 ways. It never depends on which way is safe.
- **Walkers:** `game.travellers` in seat order, skipping players with `left`, and skipping health 0 unless they died today (in `lastDay.report.healthChanges` or `today.report.healthChanges` with `to === 0`). `color = colorOf(id) ?? FALLBACK_COLOR`. `riding`: health 1, and only the first `camels` such walkers in seat order.
- **Beats in `summary`, plain or no event:** travel (3000) unless `plan.rest`, then event (4000) if `lastDay.event` is set, then settle (2000). Event scene: the card's `scene` from `pack.events` by `lastDay.event.id`, else `"calm"`.
- **Beats in `summary` after a choice** (`lastDay.event.choice` set): event (5000) with the picked option's `badScene` when `eventOutcome?.lucky === false`, else its `scene`, else `"calm"`. Then settle (2000). No travel beat.
- **Beats in `choice`:** travel (3000) from `today` (skip it if `today` is null or `today.plan.rest`), then situation (Infinity) with the card's `scene ?? "calm"`.
- **Health per beat:** split `report.healthChanges` into the event's part (its last `eventOutcome.healthChanges.length` entries) and the rest. The travel beat starts from each traveller's first `from`. The event and situation beats start after the rest is applied. Settle starts from the final health. Camels the same way: the event's `outcome.stock.animals` is taken off last.
- **`fill`:** the leg share before and after `report.km`, from `game.leg` (or 1 at the end when `report.reached`).

- [ ] **Step 1: Write the failing tests**

Build public states with the real server, as other tests do (`start`, `toPlan`, `proposeOpen`, `voteAll`, `g.getPublicState`), then call `sceneModel`. Tests:
- `"plan: no beats, speed from the leader's draft"`: in plan with `draft = { ...openPlan, pace: "hard" }`, `speed === 3` and `beats` is `[]`. With `draft.rest = true`, `camp === true`.
- `"the draft does not restart the sequence"` (Review Focus 3): the same state with two drafts gives the same `beatsKey`.
- `"summary: travel, event, settle"`: after a passed vote with a plain event, the beat kinds are `["travel", "event", "settle"]` with ms `[3000, 4000, 2000]`, and the event `scene` equals the card's scene.
- `"choice then summary: travel plays once"`: in `choice`, kinds are `["travel", "situation"]`. After `chooseAll`, kinds are `["event", "settle"]` and the event ms is 5000.
- `"a lucky false choice uses the bad scene"`: hand-built `game.lastDay` with a choice whose option has `badScene: "storm"` and `eventOutcome.lucky = false` gives an event scene `"storm"`.
- `"rest day: camp, no travel beat"`.
- `"halted at a fork: two alike paths, nothing about safety"`: `fork === true`. Swap the game's safe way (`forks`) and get an equal model.
- `"left players and missing colours"` (Review Focus 5): a removed player is not in `walkers`. `colorOf` returning `null` gives `FALLBACK_COLOR`.
- `"riders capped by camels"` (Review Focus 4): 3 travellers at health 1 with 2 camels gives exactly 2 riding. With 0 camels, nobody rides.
- `"a traveller who dies today fades, then is gone"`: dead today means in `walkers` with health 0. Dead on an earlier day means not in `walkers`.
- `"event health is applied last"`: with `report.healthChanges = [{a 3->2 travel}, {b 3->1 event}]` and `eventOutcome.healthChanges = [{b 3->1}]`, the travel beat has `a: 3, b: 3`, the event beat has `a: 2, b: 3`, and settle has `a: 2, b: 1`.
- `"an old game without eventOutcome"`: `lastDay.eventOutcome` undefined gives an event beat with `outcome: null` and no throw.

- [ ] **Step 2: Run the tests and check they fail**

Run: `pnpm vitest run games/long-trail/test/scene-model.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `sceneModel`** in `client/scene/model.ts`. It imports only from `../../shared/*`, and has no DOM and no `@games/ui`.

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm vitest run games/long-trail/test/scene-model.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add games/long-trail/client/scene/model.ts games/long-trail/test/scene-model.test.ts
git commit -m "Long Trail scene: the model, from public state to what to draw"
```

---

### Task 6: The director

**Files:**
- Create: `games/long-trail/client/scene/director.ts`
- Test: `games/long-trail/test/scene-director.test.ts`

**Interfaces:**
- Consumes: `Beat` (Task 5).
- Produces:

```ts
export interface BeatPos { index: number; t: number } // t in 0..1; a situation beat loops t over SITUATION_LOOP_MS
export const SITUATION_LOOP_MS = 2400;
export function totalMs(beats: Beat[]): number; // Infinity if any beat is a situation
export function beatAt(beats: Beat[], elapsedMs: number): BeatPos | null; // null when beats is []; past the end gives the last beat at t = 1
export function startAt(beats: Beat[], opts: { snapshot: boolean }): number; // elapsed to begin from: 0, or the end of the last finite beat for a snapshot
```

- [ ] **Step 1: Write the failing tests**

- `"walks through the beats"`: with `[travel 3000, event 4000, settle 2000]`, `beatAt(b, 0)` is `{0, 0}`, `beatAt(b, 4500)` is `{1, 0.375}`, and `beatAt(b, 8999)` has index 2.
- `"long past the end stays on the last frame"` (Review Focus 2): `beatAt(b, 600_000)` is `{2, 1}`.
- `"a situation loops"`: `[travel 3000, situation Infinity]` at `3000 + 1200` gives `{1, 0.5}`, and at `3000 + 2400 * 7 + 600` gives `{1, 0.25}`.
- `"a snapshot starts at the end"` (Review Focus 1): `startAt(b, { snapshot: true }) === 9000`. For the choice beats, it starts at 3000 (the situation, after travel). `startAt(b, { snapshot: false }) === 0`.
- `"no beats"`: `beatAt([], 10) === null`.

- [ ] **Step 2: Run the tests and check they fail**

Run: `pnpm vitest run games/long-trail/test/scene-director.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run the tests and check they pass.** Same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add games/long-trail/client/scene/director.ts games/long-trail/test/scene-director.test.ts
git commit -m "Long Trail scene: the director, beats over time"
```

---

### Task 7: Art, sprites and backdrops

**Files:**
- Create: `games/long-trail/client/assets/kenney/*.png` (only the pieces used), `games/long-trail/client/assets/LICENSES.md`
- Create: `games/long-trail/client/scene/art.ts`, `sprites.ts`, `backdrop.ts`
- Create: `games/long-trail/test/scene-fake-ctx.ts` (a recording fake `CanvasRenderingContext2D` built on a `Proxy`: every method is a no-op that records its name, every property can be set)
- Test: `games/long-trail/test/scene-draw.test.ts`

**Interfaces:**
- Consumes: `Terrain`, `Walker`, `Health` (Task 5).
- Produces:

```ts
// art.ts
export interface Art { far: Partial<Record<Terrain, CanvasImageSource>>; clouds: CanvasImageSource[] }
export function loadArt(): Promise<Art>; // never rejects; a missing or broken file is left out
// sprites.ts  (x, y = feet on the ground line; frame = walk phase 0..1; s = scale from band height)
export function drawCamel(c: CanvasRenderingContext2D, x: number, y: number, s: number, frame: number, load: "normal" | "high" | "none"): void;
export function drawTraveller(c: CanvasRenderingContext2D, x: number, y: number, s: number, frame: number, w: { color: string; health: Health; riding: boolean; alpha: number }): void;
export function drawTent(c, x, y, s): void; export function drawFire(c, x, y, s, frame): void;
export function drawStall(c, x, y, s, hue: number): void; export function drawHouse(c, x, y, s): void;
export function drawGate(c, x, y, s): void; export function drawRider(c, x, y, s, frame, facing: 1 | -1): void;
// backdrop.ts
export interface View { w: number; h: number; ground: number; s: number } // css px; ground = y of the path
export function drawBackdrop(c: CanvasRenderingContext2D, art: Art, v: View, terrain: Terrain, scrollPx: number, opts: { fork: boolean; night: boolean }): void;
```

- [ ] **Step 1: Get the art**

Download Kenney Background Elements Redux from https://www.kenney.nl/assets/background-elements-redux into a new empty folder in the scratchpad, not the repo. Only unzip and copy the PNGs. Run nothing from it. Pick the pieces for the far layer of each terrain (desert, mountain, river, plain) and 2 or 3 clouds. Copy only those into `client/assets/kenney/`, keeping Kenney's file names. Keep the total under 300 KB. If a terrain has no fitting piece (desert dunes are likely missing), leave it out: `backdrop.ts` draws that layer in code. Write `LICENSES.md` the way `games/treasure-hunt/godot/assets/LICENSES.md` does, with the pack name, the URL, CC0 and the file list. Also note that the sprites in `scene/sprites.ts` are our own.

- [ ] **Step 2: Write the failing test**

`scene-draw.test.ts`, using the fake ctx and `Art = { far: {}, clouds: [] }` (no images, so the code paths run):
- `"every terrain draws"`: `drawBackdrop` for each `Terrain`, with `fork` true and false, at scroll 0 and 10_000, does not throw and calls `fill` at least once.
- `"every sprite draws"`: each `draw*` at frame 0, 0.5 and 0.99, and the traveller at health 1, 2 and 3, riding or not, with alpha 0.5, does not throw.

- [ ] **Step 3: Run the test and check it fails**

Run: `pnpm vitest run games/long-trail/test/scene-draw.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement**

- `art.ts`: `import.meta.glob("../assets/kenney/*.png", { eager: true, query: "?url", import: "default" })`, mapped by file name to terrain or cloud. Load each with `new Image()`, and resolve on load or on error. `loadArt` must not run at import time in node tests. `scene-draw.test.ts` does not import it.
- Sprites are flat shapes with no outlines, in the Kenney style. A walk cycle is 2 to 4 leg positions picked from `frame`. Sick (health 2): a smaller bob and a slight lean. Badly hurt (health 1) and not riding: a limp. Riding: seated on the camel's back, drawn by the stage.
- Parallax: far layer at 0.15× the scroll, near hills at 0.4×, ground at 1×. A fork splits the ground path into two equal branches that look the same.

- [ ] **Step 5: Run the tests and check they pass.** Same command. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add games/long-trail/client/assets games/long-trail/client/scene/art.ts games/long-trail/client/scene/sprites.ts games/long-trail/client/scene/backdrop.ts games/long-trail/test/scene-fake-ctx.ts games/long-trail/test/scene-draw.test.ts
git commit -m "Long Trail scene: Kenney backdrops and our own sprites"
```

---

### Task 8: The event scenes

**Files:**
- Create: `games/long-trail/client/scene/events/index.ts` and one file for each scene: `calm.ts`, `storm.ts`, `robbers.ts`, `fire.ts`, `water.ts`, `rocks.ts`, `camel-trouble.ts`, `sick.ts`, `visitor.ts`, `water-found.ts`, `turn-back.ts`, `thief.ts`, `leak.ts`
- Test: `games/long-trail/test/scene-draw.test.ts` (extend)

**Interfaces:**
- Consumes: `View`, sprites (Task 7), `SceneId` (Task 3), `EventOutcome` (Task 1).
- Produces:

```ts
export interface Stagehand {
  c: CanvasRenderingContext2D;
  v: View;
  t: number; // 0..1 through the beat
  loop: boolean; // situation: t loops, so the scene must look the same at t = 0 and t = 1
  outcome: EventOutcome | null;
  caravan: { x0: number; x1: number }; // where the caravan stands, css px
  target: { id: string; x: number } | null; // the walker the event hurts (first in outcome.healthChanges), if any
}
export interface EventScene {
  still: number; // the t drawn under reduced motion
  /** Changes how the caravan is drawn this frame: crouch, offset, turn round, hide a camel. */
  pose?(h: Stagehand): { crouch?: boolean; dx?: number; facing?: 1 | -1; hideCamel?: number; night?: boolean };
  /** Draws behind the caravan. */
  back?(h: Stagehand): void;
  /** Draws in front of the caravan. */
  front?(h: Stagehand): void;
}
export const SCENES: Record<SceneId, EventScene>; // in index.ts; the Record type makes a missing scene a type error
```

What each scene does is in the spec's "Event scenes" table. Also:
- **`outcome` decides the ending.** `robbers` take a pack only if `outcome.cargo < 0` or `outcome.stock.coins < 0`. `camel-trouble` hides a camel only if `outcome.stock.animals < 0`, and otherwise the others pull it out. `fire` darkens the packs only if `outcome.cargo` or `outcome.stock.food` dropped. With `outcome === null`, the scene plays its mildest version.
- **`storm`, `fire` and `thief` flicker or blow at no more than 3 changes a second.**
- **`water` and `water-found`** draw a river or a spring in the ground layer when the terrain has none.

- [ ] **Step 1: Write the failing test**

- `"every scene draws through its beat"`: for each id in `SCENE_IDS`, for t in `[0, 0.25, 0.5, 0.75, 1]`, with `loop` false and true, with `outcome` null and with an outcome that loses a camel, 2 cargo, 10 coins and hurts one traveller: `pose`, `back` and `front` (where defined) do not throw. `still` is in `[0, 1]`.
- `"a situation loops cleanly"`: for each scene, `pose` at t = 0 and at t = 1 with `loop: true` gives equal results.

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm vitest run games/long-trail/test/scene-draw.test.ts`
Expected: FAIL, `events/index.ts` not found.

- [ ] **Step 3: Implement** the 13 scenes and the registry.

- [ ] **Step 4: Run the tests and check they pass.** Same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add games/long-trail/client/scene/events games/long-trail/test/scene-draw.test.ts
git commit -m "Long Trail scene: the event scenes"
```

---

### Task 9: The stage, in the view

**Files:**
- Create: `games/long-trail/client/scene/stage.ts`
- Modify: `games/long-trail/client/view.ts` (constructor, `settle`, `renderStrip`, `destroy`), `games/long-trail/client/styles.css`
- Test: `games/long-trail/test/scene-private.test.ts`

**Interfaces:**
- Consumes: `sceneModel`, `SceneInput` (Task 5), `beatAt`, `startAt` (Task 6), `loadArt`, sprites, `drawBackdrop` (Task 7), `SCENES` (Task 8), `faceColor` (Task 4).
- Produces:

```ts
export class TrailScene {
  readonly el: HTMLElement; // <div class="lt-scene"><canvas aria-hidden="true"></div>
  constructor();
  update(model: SceneModel, opts: { snapshot: boolean }): void; // a new beatsKey restarts the beats from startAt(...)
  destroy(): void;
}
```

How it works:
- **Loop:** `requestAnimationFrame`, drawing only when 33 ms or more have passed since the last frame. Elapsed time comes from `performance.now()` at the moment the beats began. Hidden or off screen: cancel the frame request. On return, draw the one frame for the current elapsed time, so there are no catch-up frames.
- **Size:** a `ResizeObserver` on `el`. The canvas takes css size × `devicePixelRatio` (capped at 2), and `View` comes from the css size. `ground = 0.78 * h`, `s = h / 150`.
- **Reduced motion:** `matchMedia("(prefers-reduced-motion: reduce)")`, watched for changes. When it is on, scroll stays at 0, `frame` is 0, each beat draws at `SCENES[id].still`, and the loop draws only when the model or the beat changes.
- **Drawing order:** backdrop, scene `back`, camels, then walkers in the current beat's `health` (riders on camels), scene `front`. In the settle beat, walkers with final health 0 fade by alpha `1 - t`. Camp: a tent and a fire, with the caravan still. Halted at a town: houses, or stalls for `market`, or the gate. The travel beat slides the town in from the right when `arrive` is set.
- **`view.ts`:**
  - Build one `TrailScene` in the constructor and insert `scene.el` above `this.strip`.
  - In `settle`, show and hide it like the strip: hidden in reveal, recap and over. Call `scene.update(sceneModel({ game, pack, route, draft: this.leading() ? this.form.plan(g) : null, colorOf }), { snapshot: props.snapshot })`, where `colorOf = (id) => { const seat = props.room.seats.find(s => s.id === id); return seat ? faceColor(seat.avatarSeed) : null; }`.
  - `destroy` calls `scene.destroy()`.
  - The plan form's `changed` callback already calls `settle`, so a new draft reaches the scene.
- **`styles.css`:** `.lt-scene { aspect-ratio: 4 / 1; border-radius: 14px; overflow: hidden; background: var(--surface-2); }`, with the canvas filling it. Make `.lt-route` thinner (nodes 10px, here node 14px, `min-height: 18px`).

- [ ] **Step 1: Write the failing test**

`scene-private.test.ts` `"the scene never reads private state"`: read every `.ts` file under `games/long-trail/client/scene/` (`node:fs` `readdirSync` with recursion) and expect none to contain `PrivateState`, `.private` or `info.ts`.

- [ ] **Step 2: Run it.** `pnpm vitest run games/long-trail/test/scene-private.test.ts`. Expected: it passes once the folder exists. It is a guard for later changes, and it fails if Step 3 breaks the rule.

- [ ] **Step 3: Implement `TrailScene` and the view changes.**

- [ ] **Step 4: Check types and tests**

Run: `pnpm --filter @games/long-trail typecheck && pnpm vitest run games/long-trail`
Expected: PASS.

- [ ] **Step 5: Check it in the real app**

Use the `run` skill to start the app (`pnpm dev`), and open a room with 3 players in three browser tabs at phone width (390×844). Check and note each result:
- The scene walks during plan and vote. Changing the pace in the leader's form changes the speed, and the sequence does not restart.
- After a vote passes, the day report plays travel, the event, then settle within 9 s.
- On a choice day, travel then the loop plays in the choice, and the result plays in the report.
- Reload a tab mid-report: it shows the end state.
- Switch to another tab for 20 s and come back: no jump or burst. In DevTools Performance, no frames run while the tab is hidden.
- Turn on reduced motion in DevTools rendering: still frames.
- With CPU throttling at 4×, typing in the plan form does not lag.
- Dark and light theme both look right.

- [ ] **Step 6: Commit**

```bash
git add games/long-trail/client/scene/stage.ts games/long-trail/client/view.ts games/long-trail/client/styles.css games/long-trail/test/scene-private.test.ts
git commit -m "Long Trail: the trail scene in the game view"
```

---

### Task 10: The player guide

**Files:**
- Modify: `docs/games/long-trail.md`

- [ ] **Step 1: Update the guide.** Use these exact lines.

- "How it plays" step 6: `6. **Day report (9 s).** The caravan walks, and the day's event plays out at the top of the screen. Then you see how far you moved, what you lost or got, and who got sick. Tap **Next**. Then the next player leads.`
- "Settings", the timers line: change `5 s for the day report` to `9 s for the day report`.
- "On your screen", replace the "The trail." bullet with: `- **The trail.** At the top, your caravan walks through the land you are crossing: desert, mountains, river or plains. There is one traveller for each living player, in their colour, and one camel for each camel you have. Sick travellers walk slowly. Badly hurt travellers ride a camel. Each day's event plays out here. Under it, a line of stops shows the forks ahead and where you are, or how many km are left to the next stop.`

- [ ] **Step 2: Check the whole suite**

Run: `pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add docs/games/long-trail.md
git commit -m "Long Trail guide: the trail scene and the 9 s day report"
```
