// Performance check against the spec's budgets (§17): the largest preset,
// eight hard computers on a 32×32 map, played to the round limit.
// Run: node scripts/perf.ts [seed] [mapType]
//
// Measures the full state and every player's projection (JSON bytes), and
// how long each computer batch, each projection and each map takes to make.

import { seededRandomInt, type GameContext } from "@games/game-core";
import { dominionGame as game } from "../server/game.ts";
import { ReplayRun } from "../server/replay.ts";
import { generateWorld } from "../shared/mapgen.ts";
import { CLASSIC_FACTIONS } from "../shared/content.ts";
import { DEFAULT_SETTINGS, type DominionState, type MapType } from "../shared/types.ts";

const seed = Number(process.argv[2] ?? 1);
const mapType = (process.argv[3] ?? "continents") as MapType;
const BUDGET = { stateKiB: 512, viewKiB: 128, actionMs: 50 };

const kib = (v: unknown) => Buffer.byteLength(JSON.stringify(v)) / 1024;
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))] ?? 0;

// Map generation, alone.
const gen: number[] = [];
for (let k = 0; k < 20; k++) {
  const t0 = performance.now();
  generateWorld(seed * 1000 + k, 32, Array.from({ length: 8 }, (_, i) => CLASSIC_FACTIONS[i % CLASSIC_FACTIONS.length]!), { mapType, resources: "abundant" });
  gen.push(performance.now() - t0);
}

const randomInt = seededRandomInt(seed);
const ctx = (): GameContext => ({ now: 0, randomInt });
let s: DominionState = game.createGame(
  [{ id: "p0" }],
  { ...DEFAULT_SETTINGS, mapSize: 32, mapType, bots: 7, botLevel: "hard", roundLimit: 60, turnClock: 0, resources: "abundant" },
  { roundNumber: 1, dealerSeat: 0 },
  ctx(),
).state;
// The one person leaves at once; the computer keeps their empire (and the replay log knows).
s = game.onPlayerRemoved!(s, "p0", ctx()).state;

const batch: number[] = [];
const view: number[] = [];
let maxState = 0;
let maxView = 0;
let maxUnits = 0;
let maxCities = 0;
for (let n = 0; n < 200_000 && s.phase === "playing"; n++) {
  const t0 = performance.now();
  s = game.onTimer!(s, "bot", ctx()).state;
  batch.push(performance.now() - t0);
  // Sample the expensive measurements every so often.
  if (n % 25 === 0) {
    maxState = Math.max(maxState, kib(s));
    maxUnits = Math.max(maxUnits, Object.keys(s.units).length);
    maxCities = Math.max(maxCities, Object.keys(s.cities).length);
    for (const f of s.factions) {
      const t1 = performance.now();
      const v = game.getPrivateState(s, f.id);
      view.push(performance.now() - t1);
      maxView = Math.max(maxView, kib(v));
    }
  }
}

const row = (name: string, value: string, ok: boolean) => console.log(`${ok ? "ok  " : "OVER"} ${name.padEnd(34)} ${value}`);
console.log(`${mapType}, seed ${seed}: ${s.round - 1} rounds, ${batch.length} computer batches, peak ${maxUnits} units / ${maxCities} cities`);
row("full state, peak", `${maxState.toFixed(1)} KiB (budget ${BUDGET.stateKiB})`, maxState < BUDGET.stateKiB);
row("one player's view, peak", `${maxView.toFixed(1)} KiB (budget ${BUDGET.viewKiB})`, maxView < BUDGET.viewKiB);
row("computer batch (4 actions), p95", `${pct(batch, 0.95).toFixed(1)} ms, max ${Math.max(...batch).toFixed(1)}`, pct(batch, 0.95) < BUDGET.actionMs * 4);
row("projection, p95", `${pct(view, 0.95).toFixed(1)} ms, max ${Math.max(...view).toFixed(1)}`, pct(view, 0.95) < BUDGET.actionMs);
// After the end the fog lifts for everyone: the biggest view there is.
const finalView = Math.max(...s.factions.map((f) => kib(game.getPrivateState(s, f.id))));
row("view after the game, fog lifted", `${finalView.toFixed(1)} KiB (budget ${BUDGET.viewKiB})`, finalView < BUDGET.viewKiB);
// The replay: its log, and the time to index it (what the viewer does first).
const logKiB = kib(s.replay?.log ?? []);
row("replay log", `${logKiB.toFixed(1)} KiB, ${s.replay?.log.length ?? 0} entries`, maxState + logKiB < BUDGET.stateKiB);
const t2 = performance.now();
const run = new ReplayRun(s.replay!.setup, s.settings, s.replay!.log);
while (!run.index(1000));
const indexMs = performance.now() - t2;
const t3 = performance.now();
run.stateAt(Math.floor(run.turns.length * 0.7));
// The viewer plays while it indexes, so what matters is staying ahead of playback (a few turns a second).
const perTurn = indexMs / run.turns.length;
row("replay: index, per turn", `${perTurn.toFixed(0)} ms (${(indexMs / 1000).toFixed(1)} s for ${run.turns.length} turns)`, perTurn < 250);
row("replay: jump to a turn", `${(performance.now() - t3).toFixed(0)} ms`, performance.now() - t3 < 1000);
row("map generation, p95", `${pct(gen, 0.95).toFixed(1)} ms`, pct(gen, 0.95) < BUDGET.actionMs);
