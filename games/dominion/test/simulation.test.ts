// Whole matches played by a random agent through the public adapter. Checks
// the invariants (§19) on every accepted transition, including fog.

import { seededRandomInt, type GameContext } from "@games/game-core";
import { describe, expect, it } from "vitest";
import { dominionGame as game } from "../server/game.ts";
import { HARVEST, TECH_ORDER, TECHS, techCost, TERRAIN, TRAINABLE, UNITS } from "../shared/content.ts";
import { Rng } from "../shared/grid.ts";
import { canSail, canStand, visionOf } from "../shared/rules.ts";
import {
  DEFAULT_SETTINGS,
  type DominionAction,
  type DominionEvent,
  type DominionPrivateState,
  type DominionSettings,
  type DominionState,
} from "../shared/types.ts";

function chooseAction(view: DominionPrivateState, rng: Rng): DominionAction {
  const turn = view.turn;
  const options: DominionAction[] = [];
  for (const [unit, targets] of Object.entries(view.attacks)) {
    for (const t of targets) options.push({ type: "attack", turn, unit, target: t.target }, { type: "attack", turn, unit, target: t.target });
  }
  for (const u of view.units) {
    if (!u.mine) continue;
    if (!u.mine.done && !u.mine.moved && u.mine.settled) options.push({ type: "capture", turn, unit: u.id });
    if (!u.mine.done && !u.mine.moved && u.hp < u.maxHp) options.push({ type: "heal", turn, unit: u.id });
    if (u.mine.kills >= 3 && !u.veteran) options.push({ type: "promote", turn, unit: u.id });
  }
  for (const [unit, dests] of Object.entries(view.moves)) {
    for (let k = 0; k < 3; k++) options.push({ type: "move", turn, unit, to: rng.pick(dests) });
  }
  for (const c of view.cities) {
    if (!c.mine) continue;
    if (c.mine.pendingRewards.length) options.push({ type: "reward", turn, city: c.mine.id, choice: rng.chance(0.5) ? "workshop" : "scout" });
    const unitType = rng.pick(TRAINABLE);
    if (view.credits >= UNITS[unitType].cost) options.push({ type: "train", turn, city: c.mine.id, unitType });
  }
  view.tiles.forEach((t, i) => {
    if (t?.vis && t.owner === view.me && t.res && HARVEST[t.res] && view.credits >= 2) {
      options.push({ type: "develop", turn, tile: i, kind: "harvest" });
    }
  });
  const tech = rng.pick(TECH_ORDER);
  if (!view.techs.includes(tech) && view.credits >= techCost(tech, view.cityCount)) {
    if (!TECHS[tech].parent || view.techs.includes(TECHS[tech].parent!)) options.push({ type: "research", turn, tech });
  }
  if (!options.length || rng.chance(0.08)) return { type: "end-turn", turn };
  return rng.pick(options);
}

function checkInvariants(before: DominionState, after: DominionState, events: { visibility: { kind: string; playerId?: string }; event: DominionEvent }[]) {
  const tiles = new Set<number>();
  for (const u of Object.values(after.units)) {
    expect(tiles.has(u.at), "one unit per tile").toBe(false);
    tiles.add(u.at);
    // Ships on water they may sail, everyone else on land they may stand on.
    // Fliers can perch anywhere on land, peaks included.
    const ok = u.vessel ? canSail(after, u.owner, u.at) : UNITS[u.type].flying ? TERRAIN[after.tiles[u.at]!.t].land : canStand(after, u.owner, u.at);
    expect(ok, `${u.type}/${u.vessel ?? "land"}`).toBe(true);
    expect(u.hp).toBeGreaterThan(0);
    expect(u.hp).toBeLessThanOrEqual(u.maxHp);
  }
  for (const f of after.factions) expect(f.credits).toBeGreaterThanOrEqual(0);

  for (const f of after.factions) {
    const view = game.getPrivateState(after, f.id);
    const json = JSON.stringify(view);
    // No seed, ever. (The key never exists in a projection; the value would be a coincidence.)
    expect(json.includes('"seed"')).toBe(false);
    if (after.phase !== "playing") continue;
    const vis = visionOf(after, f.id);
    for (const u of view.units) {
      if (u.owner !== f.id) expect(vis[u.at], "enemy units only on visible tiles").toBe(1);
    }
    for (const c of view.cities) {
      if (!c.vis) continue;
      expect(vis[c.at]).toBe(1);
    }
    view.tiles.forEach((t, i) => {
      if (t?.vis) expect(vis[i]).toBe(1);
      // A fogged tile shows memory, never the present (here: never a newer improvement than remembered).
      if (t && !t.vis) expect(t.seen).toBeLessThanOrEqual(after.round);
    });

    // Every spatial event for this player touches tiles they saw before or after.
    const was = visionOf(before, f.id);
    for (const e of events) {
      if (e.visibility.kind !== "private" || e.visibility.playerId !== f.id) continue;
      const ev = e.event;
      const spots =
        ev.type === "attack" ? [ev.from, ev.to]
        : ev.type === "move" ? [ev.from, ev.to].filter((x): x is number => x !== null)
        : ev.type === "spawn" || ev.type === "capture" || ev.type === "develop" || ev.type === "heal" ? [ev.at]
        : [];
      for (const i of spots) expect(was[i] || vis[i], `${ev.type} at an unseen tile`).toBeTruthy();
    }
  }
  const pub = JSON.stringify(game.getPublicState(after));
  expect(pub.includes('"tiles"')).toBe(false);
  expect(pub.includes('"seed"')).toBe(false);
}

function play(seed: number, players: number, settings: Partial<DominionSettings>, maxActions = 6000) {
  const randomInt = seededRandomInt(seed);
  const ctx = (): GameContext => ({ now: 0, randomInt });
  const ids = Array.from({ length: players }, (_, i) => ({ id: `p${i}` }));
  let state = game.createGame(ids, { ...DEFAULT_SETTINGS, turnClock: 0, ...settings }, { roundNumber: 1, dealerSeat: seed % players }, ctx()).state;
  const rng = new Rng(seed);
  let accepted = 0;
  for (let n = 0; n < maxActions && state.phase === "playing"; n++) {
    const me = state.factions[state.current]!.id;
    const view = game.getPrivateState(state, me);
    const action = chooseAction(view, rng);
    const res = game.handleAction(state, me, action, ctx());
    if (!res.ok) {
      // Only end-turn must always be legal for the player whose turn it is.
      expect(action.type).not.toBe("end-turn");
      continue;
    }
    accepted++;
    checkInvariants(state, res.transition.state, res.transition.events as never);
    state = res.transition.state;
  }
  return { state, accepted };
}

// Whole matches with full fog checks after every action: slow by design.
describe("simulated matches", { timeout: 30_000 }, () => {
  it("two players to the round limit, ending on score", () => {
    const { state, accepted } = play(11, 2, { roundLimit: 30 });
    expect(accepted).toBeGreaterThan(100);
    expect(state.phase).toBe("finished");
    expect(game.getResult(state)?.winnerIds.length).toBeGreaterThan(0);
  });

  it("four players in fog, lakes map", () => {
    const { state } = play(5, 4, { roundLimit: 30, mapType: "lakes" });
    expect(state.phase).toBe("finished");
  });

  it("is reproducible from the same seed", () => {
    const a = play(21, 3, { roundLimit: 30 }, 1500).state;
    const b = play(21, 3, { roundLimit: 30 }, 1500).state;
    expect(a).toEqual(b);
  });

});

/** People always end their turn at once; computers play on their timer, as the room would fire it. */
function playWithBots(
  seed: number,
  humans: number,
  settings: Partial<DominionSettings>,
  maxSteps = 4000,
  setup?: (s: DominionState) => void,
) {
  const randomInt = seededRandomInt(seed);
  const ctx = (): GameContext => ({ now: 0, randomInt });
  const ids = Array.from({ length: humans }, (_, i) => ({ id: `p${i}` }));
  let state = game.createGame(ids, { ...DEFAULT_SETTINGS, turnClock: 0, ...settings }, { roundNumber: 1, dealerSeat: 0 }, ctx()).state;
  setup?.(state);
  let botTicks = 0;
  for (let n = 0; n < maxSteps && state.phase === "playing"; n++) {
    const cur = state.factions[state.current]!;
    const before = state;
    if (cur.bot) {
      expect(game.getAwaitedPlayerIds(state)).toEqual([]);
      const t = game.onTimer!(state, "bot", ctx());
      // Every tick either hands the turn on or schedules the next batch: no stalls.
      const advanced = t.state.current !== state.current || t.state.phase !== "playing";
      expect(advanced || t.timers?.some((r) => r.kind === "set" && r.timerId === "bot")).toBe(true);
      checkInvariants(before, t.state, t.events as never);
      state = t.state;
      botTicks++;
    } else {
      const r = game.handleAction(state, cur.id, { type: "end-turn", turn: state.turn }, ctx());
      if (!r.ok) throw new Error(r.error.message);
      state = r.transition.state;
    }
  }
  return { state, botTicks };
}

describe("computer players", { timeout: 30_000 }, () => {
  it("gives a lone player one opponent", () => {
    const s = game.createGame([{ id: "solo" }], { ...DEFAULT_SETTINGS }, { roundNumber: 1, dealerSeat: 0 }, { now: 0, randomInt: seededRandomInt(2) }).state;
    expect(s.factions).toHaveLength(2);
    expect(s.factions[1]!.bot?.level).toBe("normal");
    const pub = game.getPublicState(s);
    expect(pub.players[1]!.name).toBeTruthy();
  });

  it("never seats more than eight", () => {
    const ids = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}` }));
    const s = game.createGame(ids, { ...DEFAULT_SETTINGS, bots: 7 }, { roundNumber: 1, dealerSeat: 0 }, { now: 0, randomInt: seededRandomInt(2) }).state;
    expect(s.factions).toHaveLength(8);
  });

  for (const level of ["easy", "normal", "hard"] as const) {
    it(`${level} computers expand, fight and finish a match`, () => {
      const { state, botTicks } = playWithBots(17, 1, { bots: 3, botLevel: level, roundLimit: 30 });
      expect(state.phase).toBe("finished");
      expect(botTicks).toBeGreaterThan(30);
      const botCities = Object.values(state.cities).filter((c) => state.factions.find((f) => f.id === c.owner)?.bot).length;
      // Four capitals at the start; computers that only sat still would leave it at 3 for them.
      expect(botCities).toBeGreaterThan(3);
      expect(game.getResult(state)?.names?.cpu1).toMatch(/computer/);
    });
  }

  it("teams of computers play it out, and allies never fight", () => {
    const { state } = playWithBots(23, 1, { bots: 3, teams: 2, roundLimit: 30 });
    expect(state.phase).toBe("finished");
    const winners = state.outcome!.winnerIds;
    const teams = new Set(winners.map((id) => state.factions.find((f) => f.id === id)!.team));
    expect(teams.size).toBe(1);
  });

  it("capital control ends or runs to the limit cleanly", () => {
    const { state } = playWithBots(29, 1, { bots: 2, victory: "capitals", roundLimit: 30, botLevel: "hard" });
    expect(state.phase).toBe("finished");
    expect(["capitals", "score", "conquest"]).toContain(state.outcome!.reason);
  });

  it("computers play Wildwood: tend, train their own, hatch owls, fog checks and all", () => {
    const seen = new Set<string>();
    let tended = false;
    const { state } = playWithBots(31, 1, { bots: 3, botLevel: "normal", roundLimit: 30 }, 6000, (s) => {
      // Two Wildwood computers among classic ones, as a lobby pick would seat them.
      for (const f of s.factions.slice(1, 3)) {
        f.kind = "wildwood";
        f.techs = ["tending"];
      }
    });
    for (const u of Object.values(state.units)) if (state.factions.find((f) => f.id === u.owner)?.kind === "wildwood") seen.add(u.type);
    tended = state.tiles.some((t) => t.tended);
    expect(state.phase).toBe("finished");
    expect(tended).toBe(true);
    expect([...seen].some((t) => ["bramble", "dryad", "owl_egg", "great_owl"].includes(t))).toBe(true);
    for (const f of state.factions.slice(1, 3)) expect(f.techs.filter((t) => ["grovecraft", "skyroost"].includes(t)).length).toBeGreaterThan(0);
  });

  it("computers take to the water on an archipelago, fog checks and all", () => {
    const { state } = playWithBots(4, 1, { bots: 3, botLevel: "hard", mapType: "archipelago", mapSize: 24, roundLimit: 30 }, 20000);
    expect(state.phase).toBe("finished");
    expect(state.tiles.some((t) => t.imp === "port")).toBe(true);
  });
});
