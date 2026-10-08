// Tidefolk: amphibious units, reef villages and cities, reef nests, sea
// creatures instead of warships. Plus the six edge cases: occupation, peace,
// fog, conversion, capacity and persistence.

import { seededRandomInt, type GameContext } from "@games/game-core";
import { describe, expect, it } from "vitest";
import { dominionGame as game } from "../server/game.ts";
import { FACTIONS, techsFor, trainableFor, UNITS, unitFor } from "../shared/content.ts";
import { indexOf } from "../shared/grid.ts";
import { generateWorld, validateWorld } from "../shared/mapgen.ts";
import { parseSettings } from "../shared/rules-text.ts";
import { cityIncome, connectedCities, indexUnits, isOccupied, reachable } from "../shared/rules.ts";
import { DEFAULT_SETTINGS, type City, type DominionAction, type DominionState, type MapType, type Unit } from "../shared/types.ts";

const ctx = (): GameContext => ({ now: 0, randomInt: seededRandomInt(1) });

/**
 * p0 Tidefolk, p1 orchard. Land on the left (cols 0–4), shallows in cols 5–7,
 * open ocean from col 8.
 */
function sea(size = 12): DominionState {
  const s = game.createGame([{ id: "p0" }, { id: "p1" }], { ...DEFAULT_SETTINGS, mapSize: 16, turnClock: 0 }, { roundNumber: 1, dealerSeat: 0 }, ctx()).state;
  s.size = size;
  s.tiles = Array.from({ length: size * size }, (_, i) => {
    const c = i % size;
    return { t: c <= 4 ? "plains" : c <= 7 ? "shallow" : "ocean", res: null, imp: null, road: false, feat: null, city: null, claim: null } as const;
  }).map((t) => ({ ...t }));
  s.cities = {};
  s.units = {};
  for (const f of s.factions) {
    f.memory = { codes: s.tiles.map(() => -1), seen: s.tiles.map(() => -1), cities: {} };
    f.credits = 50;
  }
  s.factions[0]!.kind = "tidefolk";
  s.factions[0]!.techs = ["tidecraft"];
  s.factions[1]!.kind = "orchard";
  s.factions[1]!.techs = ["gathering"];
  city(s, "c0", "p0", at(s, 1, 4), true);
  city(s, "c1", "p1", at(s, 10, 1), true);
  s.current = 0;
  return s;
}

function city(s: DominionState, id: string, owner: string, i: number, capital = false): City {
  const c: City = { id, name: id, at: i, owner, level: 1, pop: 0, capitalOf: capital ? owner : null, workshop: false, walls: false, parks: 0, pendingRewards: [], pendingChampion: false };
  s.cities[id] = c;
  s.tiles[i]!.city = id;
  s.tiles[i]!.claim = id;
  return c;
}

function put(s: DominionState, id: string, owner: string, i: number, type: Unit["type"] = "infantry", vessel?: Unit["vessel"]): Unit {
  const def = UNITS[type];
  const u: Unit = { id, type, owner, home: null, at: i, hp: def.hp, maxHp: def.hp, kills: 0, veteran: false, mp: def.move * 2, moved: false, attacked: false, done: false, settled: true, vessel };
  s.units[id] = u;
  return u;
}

function act(s: DominionState, who: string, a: DominionAction): DominionState {
  const r = game.handleAction(s, who, a, ctx());
  if (!r.ok) throw new Error(`${a.type}: ${r.error.message}`);
  return r.transition.state;
}
const fails = (s: DominionState, who: string, a: DominionAction) => !game.handleAction(s, who, a, ctx()).ok;
const at = (s: DominionState, r: number, c: number) => indexOf(r, c, s.size);
const moves = (s: DominionState, u: Unit) => reachable(s, u, indexUnits(Object.values(s.units)));

describe("the Tidefolk tree and roster", () => {
  it("swaps the fishing branch and replaces infantry", () => {
    expect(techsFor("tidefolk")).toEqual(expect.arrayContaining(["tidecraft", "currents", "deep_calling"]));
    expect(techsFor("tidefolk")).not.toContain("sailing");
    expect(trainableFor("tidefolk")).not.toContain("infantry");
    expect(trainableFor("tidefolk")).toContain("shell_guard");
    expect(unitFor("tidefolk", "infantry")).toBe("shell_guard");
    expect(unitFor("orchard", "infantry")).toBe("infantry");
  });

  it("start with a shell guard", () => {
    const s = game.createGame([{ id: "a" }, { id: "b" }], { ...DEFAULT_SETTINGS, factions: "tidefolk" }, { roundNumber: 1, dealerSeat: 0 }, ctx()).state;
    expect(Object.values(s.units).map((u) => u.type)).toEqual(["shell_guard", "shell_guard"]);
    expect(s.factions[0]!.techs).toEqual(["tidecraft"]);
  });

  it("can't refit ships into warships", () => {
    const s = sea();
    s.factions[0]!.techs.push("currents", "deep_calling");
    put(s, "boat", "p0", at(s, 3, 6), "archer", "transport");
    expect(fails(s, "p0", { type: "upgrade", turn: s.turn, unit: "boat", vessel: "scout" })).toBe(true);
  });
});

describe("amphibious units", () => {
  it("walk onto the shallows without boarding, and need Deep calling for the ocean", () => {
    const s = sea();
    const g = put(s, "g", "p0", at(s, 3, 4), "shell_guard");
    expect(moves(s, g).has(at(s, 3, 5))).toBe(true);
    const t = act(s, "p0", { type: "move", turn: s.turn, unit: "g", to: at(s, 3, 5) });
    expect(t.units.g!.vessel).toBeFalsy();
    const g2 = put(s, "g2", "p0", at(s, 5, 7), "shell_guard");
    expect(moves(s, g2).has(at(s, 5, 8))).toBe(false);
    s.factions[0]!.techs.push("currents", "deep_calling");
    expect(moves(s, g2).has(at(s, 5, 8))).toBe(true);
  });

  it("defend better on water", () => {
    const s = sea();
    put(s, "g", "p0", at(s, 6, 4), "shell_guard");
    put(s, "e", "p1", at(s, 6, 3));
    s.current = 1;
    const dry = game.getPrivateState(s, "p1").attacks.e![0]!.damage;
    s.units.g!.at = at(s, 6, 5);
    s.units.e!.at = at(s, 6, 4);
    const wet = game.getPrivateState(s, "p1").attacks.e![0]!.damage;
    expect(wet).toBeLessThan(dry);
  });

  it("reef runners: three tiles on water, one on land", () => {
    const s = sea();
    s.factions[0]!.techs.push("currents");
    const r = put(s, "r", "p0", at(s, 6, 5), "reef_runner");
    const m = moves(s, r);
    expect(m.has(at(s, 9, 5))).toBe(true);
    expect(m.has(at(s, 6, 3))).toBe(false);
    expect(m.has(at(s, 6, 4))).toBe(true); // the first step ashore is always allowed
  });

  it("stay amphibious when a sage converts them", () => {
    const s = sea();
    put(s, "g", "p0", at(s, 5, 4), "shell_guard");
    put(s, "sage", "p1", at(s, 5, 3), "sage");
    s.factions[1]!.techs.push("philosophy");
    s.current = 1;
    const t = act(s, "p1", { type: "convert", turn: s.turn, unit: "sage", target: at(s, 5, 4) });
    const g = t.units.g!;
    g.done = false;
    g.mp = 2;
    expect(moves(t, g).has(at(t, 5, 5))).toBe(true);
  });
});

describe("reef villages and cities", () => {
  it("only a ship or an amphibious unit can take one", () => {
    const s = sea();
    const v = at(s, 4, 6);
    s.tiles[v]!.feat = "village";
    put(s, "g", "p0", v, "shell_guard");
    const t = act(s, "p0", { type: "capture", turn: s.turn, unit: "g" });
    const reef = Object.values(t.cities).find((c) => c.at === v)!;
    expect(reef.owner).toBe("p0");
    // Its territory takes in water and land alike.
    expect(t.tiles[at(t, 4, 5)]!.claim).toBe(reef.id);
    expect(t.tiles[at(t, 4, 7)]!.claim).toBe(reef.id);
  });

  it("a ship or amphibious unit in a reef city occupies it", () => {
    const s = sea();
    const reef = city(s, "r1", "p1", at(s, 7, 6));
    put(s, "g", "p0", reef.at, "shell_guard");
    expect(isOccupied(reef, indexUnits(Object.values(s.units)))).toBe(true);
    expect(cityIncome(s, reef, indexUnits(Object.values(s.units))).total).toBe(0);
  });

  it("treaties keep you out of a partner's reef city", () => {
    const s = sea();
    city(s, "r1", "p1", at(s, 7, 6));
    const g = put(s, "g", "p0", at(s, 7, 5), "shell_guard");
    expect(moves(s, g).has(at(s, 7, 6))).toBe(true);
    s.treaties = [{ a: "p0", b: "p1", since: 1 }];
    expect(moves(s, g).has(at(s, 7, 6))).toBe(false);
  });

  it("land units trained in a reef city start afloat; amphibious ones don't", () => {
    const s = sea();
    const reef = city(s, "r0", "p0", at(s, 6, 6));
    reef.level = 3;
    s.factions[0]!.techs.push("riding");
    const t = act(s, "p0", { type: "train", turn: s.turn, city: "r0", unitType: "cavalry" });
    expect(Object.values(t.units).find((u) => u.type === "cavalry")?.vessel).toBe("transport");
    const empty = structuredClone(s);
    const t2 = act(empty, "p0", { type: "train", turn: empty.turn, city: "r0", unitType: "shell_guard" });
    expect(Object.values(t2.units).find((u) => u.type === "shell_guard")?.vessel).toBeFalsy();
  });

  it("are features, so fog remembers them as last seen", () => {
    const s = sea();
    const v = at(s, 4, 6);
    s.tiles[v]!.feat = "village";
    put(s, "g", "p0", at(s, 4, 5), "shell_guard");
    const t = act(s, "p0", { type: "move", turn: s.turn, unit: "g", to: at(s, 3, 5) });
    expect(game.getPrivateState(t, "p0").tiles[v]?.feat).toBe("village");
  });
});

describe("reef nests", () => {
  it("replace ports, pay beside fish or reefs, and link cities over water", () => {
    const s = sea();
    s.factions[0]!.techs.push("currents");
    const n = at(s, 1, 5);
    s.tiles[n]!.claim = "c0";
    expect(fails(s, "p0", { type: "develop", turn: s.turn, tile: n, kind: "port" })).toBe(true);
    let t = act(s, "p0", { type: "develop", turn: s.turn, tile: n, kind: "reef_nest" });
    expect(t.tiles[n]!.imp).toBe("reef_nest");
    expect(t.cities.c0!.level).toBe(2); // +2 population: straight to level 2
    expect(cityIncome(t, t.cities.c0!, indexUnits([])).reef).toBe(0);
    t.tiles[at(t, 0, 5)]!.res = "fish";
    t.tiles[at(t, 2, 6)]!.res = "fish";
    expect(cityIncome(t, t.cities.c0!, indexUnits([])).reef).toBe(1);
    // A reef city out at sea is its own harbour: linked to the capital.
    city(t, "r0", "p0", at(t, 8, 6));
    expect(connectedCities(t, "p0").has("r0")).toBe(true);
  });

  it("classic land units board ships at one", () => {
    const s = sea();
    s.factions[0]!.techs.push("currents", "riding");
    s.tiles[at(s, 1, 5)]!.imp = "reef_nest";
    s.tiles[at(s, 1, 5)]!.claim = "c0";
    const c = put(s, "cav", "p0", at(s, 2, 4), "cavalry");
    expect(moves(s, c).has(at(s, 1, 5))).toBe(true);
    const t = act(s, "p0", { type: "move", turn: s.turn, unit: "cav", to: at(s, 1, 5) });
    expect(t.units.cav!.vessel).toBe("transport");
  });
});

describe("leviathans", () => {
  it("are born in open water by a coastal city and never come ashore", () => {
    const s = sea();
    s.factions[0]!.techs.push("currents", "deep_calling");
    s.tiles[at(s, 1, 5)]!.claim = "c0";
    s.cities.c0!.level = 2;
    const t = act(s, "p0", { type: "train", turn: s.turn, city: "c0", unitType: "leviathan" });
    const lev = Object.values(t.units).find((u) => u.type === "leviathan")!;
    expect(t.tiles[lev.at]!.t).toBe("shallow");
    lev.done = false;
    lev.mp = 4;
    const m = moves(t, lev);
    expect([...m.keys()].every((i) => t.tiles[i]!.t !== "plains")).toBe(true);
    expect(m.size).toBeGreaterThan(0);
    const far = put(t, "far", "p0", at(t, 5, 7), "leviathan");
    expect(moves(t, far).has(at(t, 5, 9))).toBe(true); // open ocean
  });

  it("need water in the city's territory", () => {
    const s = sea();
    s.factions[0]!.techs.push("currents", "deep_calling");
    s.cities.c0!.level = 2;
    // c0's own neighbours: only (0..2, 5) are water, and none is claimed.
    expect(fails(s, "p0", { type: "train", turn: s.turn, city: "c0", unitType: "leviathan" })).toBe(true);
  });

  it("can't capture", () => {
    const s = sea();
    const v = at(s, 6, 9);
    s.tiles[v]!.feat = "village";
    s.factions[0]!.techs.push("currents", "deep_calling");
    put(s, "lev", "p0", v, "leviathan");
    expect(fails(s, "p0", { type: "capture", turn: s.turn, unit: "lev" })).toBe(true);
  });
});

describe("generation and the lobby", () => {
  it("60 seeds per map type: valid starts, each with a reef village nearby", () => {
    for (const mapType of ["continents", "landmass", "lakes", "archipelago"] as MapType[]) {
      for (let seed = 0; seed < 60; seed++) {
        const w = generateWorld(seed * 977 + 5, 16, ["tidefolk", "orchard"], { mapType, resources: "standard" });
        expect(validateWorld(w.tiles, w.starts, 16, mapType), `${mapType} seed ${seed}`).toBe(true);
        if (w.template) continue;
        const reef = w.tiles.some((t, i) => t.feat === "village" && t.t === "shallow" && Math.max(Math.abs(((i / 16) | 0) - ((w.starts[0]! / 16) | 0)), Math.abs((i % 16) - (w.starts[0]! % 16))) <= 5);
        expect(reef, `${mapType} seed ${seed}`).toBe(true);
      }
    }
  });

  it("leaves classic worlds exactly as they were", () => {
    const a = generateWorld(4242, 16, ["orchard", "forest"], { mapType: "continents", resources: "standard" });
    expect(a.tiles.some((t) => t.feat === "village" && t.t === "shallow")).toBe(false);
  });

  it("stays out of the lobby until its art lands", () => {
    expect(FACTIONS.tidefolk.released).toBe(false);
    expect(parseSettings({ factions: "tidefolk" })).toBeNull();
  });
});
