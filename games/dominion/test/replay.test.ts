// Replays (§18): a match rebuilt from its setup and input log must land on
// exactly the same state, and nobody may see the log before the end.

import { seededRandomInt, type GameContext } from "@games/game-core";
import { describe, expect, it } from "vitest";
import { dominionGame as game } from "../server/game.ts";
import { ReplayRun } from "../server/replay.ts";
import { Rng } from "../shared/grid.ts";
import { unpackView } from "../shared/wire.ts";
import { DEFAULT_SETTINGS, type DominionAction, type DominionSettings, type DominionState } from "../shared/types.ts";

/** Everything but the log itself: the replay keeps its own. */
function comparable(s: DominionState) {
  const { replay: _r, ...rest } = structuredClone(s);
  return rest;
}

/**
 * A messy match: two people acting at random on a clock (some turns run
 * out), three computers, and one person removed halfway through.
 */
function play(seed: number, settings: Partial<DominionSettings>) {
  let now = 1_000_000;
  const randomInt = seededRandomInt(seed);
  const ctx = (): GameContext => ({ now, randomInt });
  let s = game.createGame([{ id: "a" }, { id: "b" }], { ...DEFAULT_SETTINGS, bots: 3, turnClock: 60, roundLimit: 30, ...settings }, { roundNumber: 1, dealerSeat: 1 }, ctx()).state;
  const rng = new Rng(seed);
  let removed = false;
  for (let n = 0; n < 20000 && s.phase === "playing"; n++) {
    const cur = s.factions[s.current]!;
    if (!removed && s.round === 10) {
      removed = true;
      s = game.onPlayerRemoved!(s, "b", ctx()).state;
      continue;
    }
    if (cur.bot) {
      now += 450;
      s = game.onTimer!(s, "bot", ctx()).state;
      continue;
    }
    const view = unpackView(game.getPrivateState(s, cur.id));
    // Now and then a person just lets the clock run out.
    if (rng.chance(0.08)) {
      now = (s.deadline ?? now) + 10;
      s = game.onTimer!(s, "turn", ctx()).state;
      continue;
    }
    now += 1500;
    const options: DominionAction[] = [{ type: "end-turn", turn: view.turn }];
    for (const [unit, dests] of Object.entries(view.moves)) for (const to of dests) options.push({ type: "move", turn: view.turn, unit, to });
    for (const [unit, as] of Object.entries(view.attacks)) for (const a of as) options.push({ type: "attack", turn: view.turn, unit, target: a.target });
    for (const c of view.cities) if (c.mine) options.push({ type: "train", turn: view.turn, city: c.mine.id, unitType: "infantry" });
    for (const u of view.units) if (u.owner === cur.id) options.push({ type: "capture", turn: view.turn, unit: u.id });
    // Mostly do something; end the turn about one time in eight.
    const pick = rng.chance(0.12) ? options[0]! : options[1 + rng.int(Math.max(1, options.length - 1))] ?? options[0]!;
    const r = game.handleAction(s, cur.id, pick, ctx());
    if (r.ok) s = r.transition.state;
  }
  return s;
}

function rebuild(s: DominionState): DominionState {
  const run = new ReplayRun(s.replay!.setup, s.settings, s.replay!.log);
  while (!run.index(1000));
  return run.final();
}

/** One messy match, shared by the tests that only need some match. */
let shared: DominionState | null = null;
const messy = () => (shared ??= play(3, {}));

describe("replays", { timeout: 60_000 }, () => {
  it("rebuild a messy match exactly: people, computers, clocks and a removal", () => {
    const s = messy();
    expect(s.phase).toBe("finished");
    expect(s.replay!.log.length).toBeGreaterThan(100);
    expect(comparable(rebuild(s))).toEqual(comparable(s));
  });

  it("with special factions too", () => {
    for (const factions of ["wildwood", "tidefolk", "rimeborn", "bloom"] as const) {
      const s = play(5, { factions, mapType: "continents", bots: 1 });
      expect(comparable(rebuild(s)), factions).toEqual(comparable(s));
    }
  });

  it("can jump to any turn, and agrees with walking there", () => {
    const s = messy();
    const run = new ReplayRun(s.replay!.setup, s.settings, s.replay!.log);
    while (!run.index(1000));
    expect(run.turns.at(-1)!.turn).toBe(-1);
    const k = Math.floor(run.turns.length / 2);
    const a = run.stateAt(k);
    expect(a.turn).toBe(run.turns[k]!.turn);
    expect(a.factions[a.current]!.id).toBe(run.turns[k]!.player);
    expect(comparable(run.stateAt(run.turns.length - 1))).toEqual(comparable(s));
  });

  it("stay secret until the game is over", () => {
    const randomInt = seededRandomInt(1);
    const s = game.createGame([{ id: "a" }, { id: "b" }], { ...DEFAULT_SETTINGS }, { roundNumber: 1, dealerSeat: 0 }, { now: 0, randomInt }).state;
    expect(game.getPrivateState(s, "a").replay).toBeNull();
    expect(JSON.stringify(game.getPublicState(s))).not.toContain("log");
    const over = messy();
    const view = game.getPrivateState(over, "a");
    expect(view.replay?.log.length).toBe(over.replay!.log.length);
  });

  it("keep the log small", () => {
    const s = messy();
    // Each entry is a few dozen bytes; a whole match stays a small part of the state.
    expect(JSON.stringify(s.replay).length / JSON.stringify(s).length).toBeLessThan(0.5);
  });
});
