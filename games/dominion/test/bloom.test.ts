// The Bloom: a mycelium network they grow and move fast on, larvae that
// mature or evolve, venom, brood mothers, and burning. Plus the six edge
// cases: occupation, peace, fog, conversion, capacity and persistence.

import { seededRandomInt, type GameContext } from "@games/game-core";
import { describe, expect, it } from "vitest";
import { dominionGame as game } from "../server/game.ts";
import { parseAction } from "../server/parse.ts";
import { FACTIONS, NETWORK, techsFor, trainableFor, UNITS } from "../shared/content.ts";
import { indexOf } from "../shared/grid.ts";
import { generateWorld, validateWorld } from "../shared/mapgen.ts";
import { parseSettings } from "../shared/rules-text.ts";
import { indexUnits, onNetwork, reachable } from "../shared/rules.ts";
import { DEFAULT_SETTINGS, type City, type DominionAction, type DominionState, type MapType, type Unit } from "../shared/types.ts";

const ctx = (): GameContext => ({ now: 0, randomInt: seededRandomInt(1) });

/** p0 the Bloom, p1 orchard, on a flat 12×12 board. c0 claims radius 1 around (2,2). */
function swarm(size = 12): DominionState {
  const s = game.createGame([{ id: "p0" }, { id: "p1" }], { ...DEFAULT_SETTINGS, mapSize: 16, turnClock: 0 }, { roundNumber: 1, dealerSeat: 0 }, ctx()).state;
  s.size = size;
  s.tiles = Array.from({ length: size * size }, () => ({ t: "plains" as const, res: null, imp: null, road: false, feat: null, city: null, claim: null }));
  s.cities = {};
  s.units = {};
  for (const f of s.factions) {
    f.memory = { codes: s.tiles.map(() => -1), seen: s.tiles.map(() => -1), cities: {} };
    f.credits = 50;
  }
  s.factions[0]!.kind = "bloom";
  s.factions[0]!.techs = ["spreading"];
  s.factions[1]!.kind = "orchard";
  s.factions[1]!.techs = ["gathering"];
  const c0 = city(s, "c0", "p0", at(s, 2, 2), true);
  for (let r = 1; r <= 3; r++) for (let c = 1; c <= 3; c++) s.tiles[at(s, r, c)]!.claim = c0.id;
  city(s, "c1", "p1", at(s, 10, 10), true);
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

function put(s: DominionState, id: string, owner: string, i: number, type: Unit["type"] = "infantry"): Unit {
  const def = UNITS[type];
  const u: Unit = { id, type, owner, home: null, at: i, hp: def.hp, maxHp: def.hp, kills: 0, veteran: false, mp: def.move * 2, moved: false, attacked: false, done: false, settled: true };
  s.units[id] = u;
  return u;
}

function act(s: DominionState, who: string, a: DominionAction): DominionState {
  const r = game.handleAction(s, who, a, ctx());
  if (!r.ok) throw new Error(`${a.type}: ${r.error.message}`);
  return r.transition.state;
}
const fails = (s: DominionState, who: string, a: DominionAction) => !game.handleAction(s, who, a, ctx()).ok;
const end = (s: DominionState) => act(s, s.factions[s.current]!.id, { type: "end-turn", turn: s.turn });
const at = (s: DominionState, r: number, c: number) => indexOf(r, c, s.size);
const moves = (s: DominionState, u: Unit) => reachable(s, u, indexUnits(Object.values(s.units)));

describe("the Bloom's tree and roster", () => {
  it("swaps the gathering branch; strategy and diplomacy hang off Spreading", () => {
    const tree = techsFor("bloom");
    expect(tree).not.toContain("gathering");
    expect(tree).not.toContain("farming");
    expect(tree).toEqual(expect.arrayContaining(["spreading", "venom", "broodcraft", "strategy", "diplomacy"]));
    expect(trainableFor("bloom")).toContain("larva");
    expect(trainableFor("bloom")).not.toContain("infantry");
    // Stingers and brood mothers only come from larvae.
    expect(trainableFor("bloom")).not.toContain("stinger");
  });

  it("starts with a drone, not a larva", () => {
    const s = game.createGame([{ id: "a" }, { id: "b" }], { ...DEFAULT_SETTINGS, factions: "bloom" }, { roundNumber: 1, dealerSeat: 0 }, ctx()).state;
    expect(Object.values(s.units).map((u) => u.type)).toEqual(["drone", "drone"]);
  });

  it("can't build roads", () => {
    const s = swarm();
    s.factions[0]!.techs.push("riding", "roads");
    expect(fails(s, "p0", { type: "develop", turn: s.turn, tile: at(s, 1, 1), kind: "road" })).toBe(true);
  });
});

describe("the network", () => {
  it("is their territory from the start, and spreads to touching land for 2", () => {
    const s = swarm();
    expect(onNetwork(s, "p0", at(s, 1, 1))).toBe(true);
    expect(onNetwork(s, "p0", at(s, 1, 4))).toBe(false);
    expect(fails(s, "p0", { type: "develop", turn: s.turn, tile: at(s, 1, 5), kind: "spread" })).toBe(true); // not touching
    const t = act(s, "p0", { type: "develop", turn: s.turn, tile: at(s, 1, 4), kind: "spread" });
    expect(t.tiles[at(t, 1, 4)]!.myc).toBe("p0");
    expect(t.factions[0]!.credits).toBe(50 - NETWORK.spreadCost);
    expect(onNetwork(t, "p0", at(t, 1, 4))).toBe(true);
  });

  it("goes into rivals' land, but never a treaty partner's", () => {
    const s = swarm();
    city(s, "c2", "p1", at(s, 2, 5));
    s.tiles[at(s, 2, 4)]!.claim = "c2";
    expect(fails(s, "p0", { type: "develop", turn: s.turn, tile: at(s, 2, 4), kind: "spread" })).toBe(false);
    s.treaties = [{ a: "p0", b: "p1", since: 1 }];
    expect(fails(s, "p0", { type: "develop", turn: s.turn, tile: at(s, 2, 4), kind: "spread" })).toBe(true);
  });

  it("makes swarm units quick on it and slow off it", () => {
    const s = swarm();
    const d = put(s, "d", "p0", at(s, 2, 1), "drone");
    // On the network: half a point a step, so a 1-move drone crosses the city's land.
    expect(moves(s, d).has(at(s, 2, 3))).toBe(true);
    const off = put(s, "o", "p0", at(s, 6, 6), "drone");
    // Off it, plains cost 3: the first step is always allowed, the second isn't.
    expect(moves(s, off).has(at(s, 6, 7))).toBe(true);
    expect(moves(s, off).has(at(s, 6, 8))).toBe(false);
    // Classic units ignore it.
    const inf = put(s, "i", "p0", at(s, 3, 1));
    expect(moves(s, inf).has(at(s, 3, 3))).toBe(false);
  });

  it("absorbs fruit and crops instead of harvesting them", () => {
    const s = swarm();
    s.tiles[at(s, 1, 1)]!.res = "fruit";
    s.tiles[at(s, 1, 2)]!.res = "crops";
    expect(fails(s, "p0", { type: "develop", turn: s.turn, tile: at(s, 1, 1), kind: "harvest" })).toBe(true);
    let t = act(s, "p0", { type: "develop", turn: s.turn, tile: at(s, 1, 1), kind: "absorb" });
    expect(t.tiles[at(t, 1, 1)]!.res).toBeNull();
    expect(t.cities.c0!.pop).toBe(1);
    t = act(t, "p0", { type: "develop", turn: t.turn, tile: at(t, 1, 2), kind: "absorb" });
    expect(t.cities.c0!.level).toBe(2);
  });

  it("is remembered in the fog as last seen", () => {
    let s = swarm();
    s = act(s, "p0", { type: "develop", turn: s.turn, tile: at(s, 1, 4), kind: "spread" });
    // p1 had a look, then left.
    const spy = put(s, "e", "p1", at(s, 1, 5));
    s = end(s);
    delete s.units[spy.id];
    s = end(end(s));
    const known = game.getPrivateState(s, "p1").tiles[at(s, 1, 4)];
    expect(known?.vis).toBe(false);
    expect(known?.myc).toBe("p0");
  });

  it("captured Bloom land belongs to the captor, and gives the swarm nothing", () => {
    const s = swarm();
    s.cities.c0!.owner = "p1";
    const d = put(s, "d", "p0", at(s, 2, 1), "drone");
    expect(onNetwork(s, "p0", at(s, 2, 2))).toBe(false);
    expect(moves(s, d).has(at(s, 2, 3))).toBe(false);
  });
});

describe("larvae", () => {
  it("cost 1, fill a slot, and mature into drones after two turns", () => {
    let s = swarm();
    s = act(s, "p0", { type: "train", turn: s.turn, city: "c0", unitType: "larva" });
    const larva = Object.values(s.units).find((u) => u.type === "larva")!;
    expect(s.factions[0]!.credits).toBe(49);
    expect(larva.home).toBe("c0");
    expect(fails(s, "p0", { type: "capture", turn: s.turn, unit: larva.id })).toBe(true);
    s = end(end(s)); // p0's first turn
    expect(s.units[larva.id]!.type).toBe("larva");
    s = end(end(s)); // second
    expect(s.units[larva.id]!.type).toBe("drone");
    expect(s.units[larva.id]!.hp).toBe(10);
  });

  it("evolve early on the network, paying the difference", () => {
    const s = swarm();
    s.factions[0]!.techs.push("venom");
    put(s, "l", "p0", at(s, 1, 1), "larva");
    const t = act(s, "p0", { type: "evolve", turn: s.turn, unit: "l", into: "stinger" });
    expect(t.units.l!.type).toBe("stinger");
    expect(t.factions[0]!.credits).toBe(50 - (UNITS.stinger.cost - UNITS.larva.cost));
    expect(t.units.l!.done).toBe(true);
  });

  it("only on their own network, and only with the tech", () => {
    const s = swarm();
    put(s, "l", "p0", at(s, 6, 6), "larva");
    s.factions[0]!.techs.push("venom");
    expect(fails(s, "p0", { type: "evolve", turn: s.turn, unit: "l", into: "stinger" })).toBe(true);
    put(s, "l2", "p0", at(s, 1, 1), "larva");
    expect(fails(s, "p0", { type: "evolve", turn: s.turn, unit: "l2", into: "brood_mother" })).toBe(true);
    expect(fails(s, "p0", { type: "evolve", turn: s.turn, unit: "l2", into: "knight" })).toBe(true);
  });

  it("converted, they keep their stats but crawl: the new owner has no network", () => {
    const s = swarm();
    const d = put(s, "d", "p1", at(s, 2, 1), "drone");
    d.converted = true;
    expect(moves(s, d).has(at(s, 2, 3))).toBe(false);
  });
});

describe("venom", () => {
  it("a stinger's hit poisons: 1 HP at each of the next two turn starts, never the last", () => {
    let s = swarm();
    put(s, "st", "p0", at(s, 6, 5), "stinger");
    put(s, "e", "p1", at(s, 6, 6), "defender"); // sturdy enough to feel both bites
    s.factions[1]!.techs.push("strategy");
    s = act(s, "p0", { type: "attack", turn: s.turn, unit: "st", target: at(s, 6, 6) });
    const hp = s.units.e!.hp;
    expect(s.units.e!.poison).toEqual({ turns: 2, by: "p0" });
    expect(game.getPrivateState(s, "p1").units.find((u) => u.id === "e")?.poisoned).toBe(true);
    s = end(s);
    expect(s.units.e!.hp).toBe(hp - 1);
    s = end(end(s));
    expect(s.units.e!.hp).toBe(hp - 2);
    expect(s.units.e!.poison).toBeUndefined();
  });

  it("can't kill on its own", () => {
    let s = swarm();
    const e = put(s, "e", "p1", at(s, 6, 6));
    e.hp = 1;
    e.poison = { turns: 2, by: "p0" };
    s = end(s);
    expect(s.units.e!.hp).toBe(1);
  });

  it("healing draws it out instead of restoring health", () => {
    let s = swarm();
    const e = put(s, "e", "p1", at(s, 6, 6));
    e.hp = 6;
    e.poison = { turns: 2, by: "p0" };
    s = end(s);
    expect(s.units.e!.hp).toBe(5);
    s = act(s, "p1", { type: "heal", turn: s.turn, unit: "e" });
    expect(s.units.e!.poison).toBeUndefined();
    expect(s.units.e!.hp).toBe(5);
  });

  it("stops biting once there's peace", () => {
    let s = swarm();
    const e = put(s, "e", "p1", at(s, 6, 6));
    e.poison = { turns: 2, by: "p0" };
    s.treaties = [{ a: "p0", b: "p1", since: 1 }];
    s = end(s);
    expect(s.units.e!.hp).toBe(10);
  });
});

describe("brood mothers", () => {
  it("lay a larva on the network beside them each turn, while the city has room", () => {
    let s = swarm();
    s.cities.c0!.level = 2; // room for 3
    const b = put(s, "b", "p0", at(s, 1, 1), "brood_mother");
    b.home = "c0";
    s = end(end(s));
    // Her brood, larvae and whatever they've grown into.
    const brood = () => Object.values(s.units).filter((u) => u.id !== "b" && u.home === "c0");
    expect(brood().map((u) => u.type)).toEqual(["larva"]);
    s = end(end(s));
    expect(brood()).toHaveLength(2);
    s = end(end(s));
    expect(brood()).toHaveLength(2); // mother + 2: the city is full
    expect(brood().map((u) => u.type)).toContain("drone"); // the first has grown up
  });
});

describe("burning", () => {
  it("an enemy on spread mycelium can burn it; territory can't be burned", () => {
    let s = swarm();
    s = act(s, "p0", { type: "develop", turn: s.turn, tile: at(s, 1, 4), kind: "spread" });
    s = end(s);
    put(s, "e", "p1", at(s, 1, 4));
    put(s, "e2", "p1", at(s, 3, 3));
    expect(fails(s, "p1", { type: "burn", turn: s.turn, unit: "e2" })).toBe(true);
    s = act(s, "p1", { type: "burn", turn: s.turn, unit: "e" });
    expect(s.tiles[at(s, 1, 4)]!.myc).toBeUndefined();
    expect(s.units.e!.done).toBe(true);
  });

  it("not a treaty partner's", () => {
    let s = swarm();
    s = act(s, "p0", { type: "develop", turn: s.turn, tile: at(s, 1, 4), kind: "spread" });
    s = end(s);
    put(s, "e", "p1", at(s, 1, 4));
    s.treaties = [{ a: "p0", b: "p1", since: 1 }];
    expect(fails(s, "p1", { type: "burn", turn: s.turn, unit: "e" })).toBe(true);
  });
});

describe("persistence, parsing and the lobby", () => {
  it("poison, age and mycelium survive a JSON round trip", () => {
    let s = swarm();
    s = act(s, "p0", { type: "develop", turn: s.turn, tile: at(s, 1, 4), kind: "spread" });
    s = act(s, "p0", { type: "train", turn: s.turn, city: "c0", unitType: "larva" });
    put(s, "e", "p1", at(s, 6, 6)).poison = { turns: 1, by: "p0" };
    s = end(end(s));
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it("every special-faction action makes it through the parser", () => {
    const actions = [
      { type: "develop", turn: 1, tile: 3, kind: "tend" },
      { type: "develop", turn: 1, tile: 3, kind: "grove" },
      { type: "develop", turn: 1, tile: 3, kind: "reef_nest" },
      { type: "develop", turn: 1, tile: 3, kind: "spread" },
      { type: "develop", turn: 1, tile: 3, kind: "absorb" },
      { type: "freeze", turn: 1, unit: "u1", target: 4 },
      { type: "evolve", turn: 1, unit: "u1", into: "stinger" },
      { type: "burn", turn: 1, unit: "u1" },
    ];
    for (const a of actions) expect(parseAction(a), JSON.stringify(a)).toEqual(a);
    expect(parseAction({ type: "evolve", turn: 1, unit: "u1", into: "dragon" })).toBeNull();
  });

  it("60 seeds per map type give valid starts", () => {
    for (const mapType of ["continents", "landmass", "lakes", "archipelago"] as MapType[]) {
      for (let seed = 0; seed < 60; seed++) {
        const w = generateWorld(seed * 977 + 11, 16, ["bloom", "orchard"], { mapType, resources: "standard" });
        expect(validateWorld(w.tiles, w.starts, 16, mapType), `${mapType} seed ${seed}`).toBe(true);
      }
    }
  });

  it("stays out of the lobby until its art lands", () => {
    expect(FACTIONS.bloom.released).toBe(false);
    expect(parseSettings({ factions: "bloom" })).toBeNull();
  });
});
