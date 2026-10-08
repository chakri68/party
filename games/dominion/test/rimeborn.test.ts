// Rimeborn: no ships, ever. They freeze water into ice that thaws when left
// alone, build roads on it, and chill what they shoot. Plus the six edge
// cases: occupation, peace, fog, conversion, capacity and persistence.

import { seededRandomInt, type GameContext } from "@games/game-core";
import { describe, expect, it } from "vitest";
import { decide, landPlan } from "../server/bot.ts";
import { unpackView } from "../shared/wire.ts";
import { dominionGame as game } from "../server/game.ts";
import { FACTIONS, ICE, trainableFor, UNITS } from "../shared/content.ts";
import { indexOf, Rng } from "../shared/grid.ts";
import { generateWorld, validateWorld } from "../shared/mapgen.ts";
import { decodeTile } from "../shared/memory.ts";
import { parseSettings } from "../shared/rules-text.ts";
import { connectedCities, indexUnits, reachable } from "../shared/rules.ts";
import { DEFAULT_SETTINGS, type City, type DominionAction, type DominionState, type MapType, type Unit } from "../shared/types.ts";

const ctx = (): GameContext => ({ now: 0, randomInt: seededRandomInt(1) });

/** p0 Rimeborn, p1 orchard. Land in cols 0–3 and 8–11, a strait of shallows between. */
function strait(size = 12): DominionState {
  const s = game.createGame([{ id: "p0" }, { id: "p1" }], { ...DEFAULT_SETTINGS, mapSize: 16, turnClock: 0 }, { roundNumber: 1, dealerSeat: 0 }, ctx()).state;
  s.size = size;
  s.tiles = Array.from({ length: size * size }, (_, i) => {
    const c = i % size;
    return { t: c >= 4 && c <= 7 ? "shallow" : "plains", res: null, imp: null, road: false, feat: null, city: null, claim: null } as const;
  }).map((t) => ({ ...t }));
  s.cities = {};
  s.units = {};
  for (const f of s.factions) {
    f.memory = { codes: s.tiles.map(() => -1), seen: s.tiles.map(() => -1), cities: {} };
    f.credits = 50;
  }
  s.factions[0]!.kind = "rimeborn";
  s.factions[0]!.techs = ["frostcraft"];
  s.factions[1]!.kind = "orchard";
  s.factions[1]!.techs = ["gathering"];
  city(s, "c0", "p0", at(s, 1, 1), true);
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
const end = (s: DominionState) => act(s, s.factions[s.current]!.id, { type: "end-turn", turn: s.turn });
const at = (s: DominionState, r: number, c: number) => indexOf(r, c, s.size);
const moves = (s: DominionState, u: Unit) => reachable(s, u, indexUnits(Object.values(s.units)));
const freeze = (s: DominionState, unit: string, target: number) => act(s, "p0", { type: "freeze", turn: s.turn, unit, target });

describe("freezing", () => {
  it("turns an adjacent shallow into ice for a credit, ending the unit's turn", () => {
    const s = strait();
    put(s, "u", "p0", at(s, 5, 3));
    expect(game.getPrivateState(s, "p0").freezes.u).toEqual(expect.arrayContaining([at(s, 5, 4)]));
    const t = freeze(s, "u", at(s, 5, 4));
    expect(t.tiles[at(t, 5, 4)]!.t).toBe("ice");
    expect(t.tiles[at(t, 5, 4)]!.ice).toEqual({ from: "shallow", owner: "p0", until: t.round + ICE.rounds });
    expect(t.factions[0]!.credits).toBe(49);
    expect(t.units.u!.done).toBe(true);
  });

  it("makes walkable land for everyone, plains cost", () => {
    let s = strait();
    put(s, "u", "p0", at(s, 5, 3));
    s = freeze(s, "u", at(s, 5, 4));
    const enemy = put(s, "e", "p1", at(s, 6, 3));
    expect(moves(s, enemy).has(at(s, 5, 4))).toBe(true);
  });

  it("needs Deep freeze for ocean, and refuses cities, improvements, features and units", () => {
    const s = strait();
    s.tiles[at(s, 5, 4)]!.t = "ocean";
    s.tiles[at(s, 4, 4)]!.feat = "beacon";
    s.tiles[at(s, 6, 4)]!.imp = "port";
    put(s, "u", "p0", at(s, 5, 3));
    expect(game.getPrivateState(s, "p0").freezes.u ?? []).toEqual([]);
    s.factions[0]!.techs.push("ice_roads", "deep_freeze");
    expect(game.getPrivateState(s, "p0").freezes.u).toEqual([at(s, 5, 4)]);
  });

  it("is refused inside a treaty partner's land", () => {
    const s = strait();
    s.tiles[at(s, 5, 4)]!.claim = "c1";
    put(s, "u", "p0", at(s, 5, 3));
    expect(fails(s, "p0", { type: "freeze", turn: s.turn, unit: "u", target: at(s, 5, 4) })).toBe(false);
    s.treaties = [{ a: "p0", b: "p1", since: 1 }];
    expect(fails(s, "p0", { type: "freeze", turn: s.turn, unit: "u", target: at(s, 5, 4) })).toBe(true);
  });

  it("is Rimeborn's alone", () => {
    const s = strait();
    put(s, "e", "p1", at(s, 5, 3));
    s.current = 1;
    expect(fails(s, "p1", { type: "freeze", turn: s.turn, unit: "e", target: at(s, 5, 4) })).toBe(true);
  });
});

describe("thawing", () => {
  function iced(): DominionState {
    let s = strait();
    put(s, "u", "p0", at(s, 5, 3));
    s = freeze(s, "u", at(s, 5, 4));
    return s;
  }
  const rounds = (s: DominionState, n: number) => {
    for (let k = 0; k < 2 * n; k++) s = end(s);
    return s;
  };

  it("holds while the freezer's people are beside it", () => {
    const s = rounds(iced(), ICE.rounds + 2);
    expect(s.tiles[at(s, 5, 4)]!.t).toBe("ice");
  });

  it("thaws when left alone, roads and all", () => {
    let s = iced();
    s.tiles[at(s, 5, 4)]!.road = true;
    delete s.units.u;
    s = rounds(s, ICE.rounds + 1);
    expect(s.tiles[at(s, 5, 4)]!.t).toBe("shallow");
    expect(s.tiles[at(s, 5, 4)]!.road).toBe(false);
    expect(s.tiles[at(s, 5, 4)]!.ice).toBeUndefined();
  });

  it("never from under a unit, even an enemy's", () => {
    let s = iced();
    delete s.units.u;
    put(s, "e", "p1", at(s, 5, 4));
    s = rounds(s, ICE.rounds + 1);
    expect(s.tiles[at(s, 5, 4)]!.t).toBe("ice");
    delete s.units.e;
    s = rounds(s, 1);
    expect(s.tiles[at(s, 5, 4)]!.t).toBe("shallow");
  });

  it("is remembered in the fog as last seen", () => {
    const s = iced();
    const code = s.factions[0]!.memory.codes[at(s, 5, 4)]!;
    expect(decodeTile(code).t).toBe("ice");
  });

  it("survives a JSON round trip mid-freeze", () => {
    const s = iced();
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});

describe("ice roads", () => {
  it("need Ice roads, and link cities over the strait", () => {
    let s = strait();
    city(s, "c2", "p0", at(s, 1, 8));
    for (let c = 4; c <= 7; c++) Object.assign(s.tiles[at(s, 1, c)]!, { t: "ice", ice: { from: "shallow", owner: "p0", until: 99 } });
    put(s, "spot", "p0", at(s, 1, 5)); // eyes on the middle of the strait, standing on the ice
    expect(fails(s, "p0", { type: "develop", turn: s.turn, tile: at(s, 1, 4), kind: "road" })).toBe(true);
    s.factions[0]!.techs.push("ice_roads", "riding", "roads");
    for (let c = 2; c <= 7; c++) s = act(s, "p0", { type: "develop", turn: s.turn, tile: at(s, 1, c), kind: "road" });
    expect(connectedCities(s, "p0").has("c2")).toBe(true);
  });

  it("classic empires can't build on ice at all", () => {
    const s = strait();
    s.factions[1]!.techs.push("riding", "roads");
    Object.assign(s.tiles[at(s, 9, 5)]!, { t: "ice", ice: { from: "shallow", owner: "p0", until: 99 } });
    put(s, "e", "p1", at(s, 9, 6));
    s.current = 1;
    expect(fails(s, "p1", { type: "develop", turn: s.turn, tile: at(s, 9, 5), kind: "road" })).toBe(true);
  });
});

describe("Rimeborn units", () => {
  it("swap archers for ice archers; no ships", () => {
    expect(trainableFor("rimeborn")).not.toContain("archer");
    expect(trainableFor("rimeborn")).toContain("ice_archer");
    const s = strait();
    s.factions[1]!.techs.push("fishing", "sailing");
    s.tiles[at(s, 2, 4)]!.imp = "port";
    s.tiles[at(s, 2, 4)]!.claim = "c0";
    // Even at their own (captured) port, they never board.
    const u = put(s, "u", "p0", at(s, 2, 3));
    s.factions[0]!.techs.push("ice_roads"); // what Sailing would map to
    expect(moves(s, u).has(at(s, 2, 4))).toBe(false);
  });

  it("an ice archer's hit chills: no moving next turn", () => {
    let s = strait();
    s.factions[0]!.techs.push("hunting", "archery");
    put(s, "a", "p0", at(s, 9, 1), "ice_archer");
    put(s, "e", "p1", at(s, 9, 3));
    put(s, "spot", "p0", at(s, 8, 3));
    s = act(s, "p0", { type: "attack", turn: s.turn, unit: "a", target: at(s, 9, 3) });
    expect(s.units.e!.chilled).toBe(true);
    expect(game.getPrivateState(s, "p1").units.find((u) => u.id === "e")?.chilled).toBe(true);
    s = end(s);
    expect(s.units.e!.mp).toBe(0);
    expect(game.getPrivateState(s, "p1").moves.e).toBeUndefined();
    expect(fails(s, "p1", { type: "attack", turn: s.turn, unit: "e", target: at(s, 9, 1) })).toBe(true); // out of reach anyway
    s = end(end(s));
    expect(s.units.e!.mp).toBeGreaterThan(0);
  });

  it("sledges race on ice", () => {
    const s = strait();
    s.factions[0]!.techs.push("ice_roads");
    for (let c = 4; c <= 7; c++) Object.assign(s.tiles[at(s, 6, c)]!, { t: "ice", ice: { from: "shallow", owner: "p0", until: 99 } });
    const sl = put(s, "s", "p0", at(s, 6, 3), "sledge");
    expect(moves(s, sl).has(at(s, 6, 7))).toBe(true);
  });

  it("glacier wardens hold the ice", () => {
    const s = strait();
    Object.assign(s.tiles[at(s, 6, 4)]!, { t: "ice", ice: { from: "shallow", owner: "p0", until: 99 } });
    put(s, "w", "p0", at(s, 6, 3), "glacier_warden");
    put(s, "e", "p1", at(s, 6, 2));
    s.current = 1;
    const dry = game.getPrivateState(s, "p1").attacks.e![0]!.damage;
    s.units.w!.at = at(s, 6, 4);
    s.units.e!.at = at(s, 6, 3);
    const icy = game.getPrivateState(s, "p1").attacks.e![0]!.damage;
    expect(icy).toBeLessThan(dry);
  });

  it("a converted sledge keeps its ice speed on anyone's ice", () => {
    const s = strait();
    for (let c = 4; c <= 7; c++) Object.assign(s.tiles[at(s, 6, c)]!, { t: "ice", ice: { from: "shallow", owner: "p0", until: 99 } });
    const sl = put(s, "s", "p1", at(s, 6, 3), "sledge");
    sl.converted = true;
    expect(moves(s, sl).has(at(s, 6, 7))).toBe(true);
  });
});

describe("the computer", () => {
  it("stranded with a village across the strait, it freezes toward it", () => {
    const s = strait();
    s.factions[0]!.bot = { level: "hard", name: "Frost" };
    s.factions[0]!.credits = 5;
    s.tiles[at(s, 5, 9)]!.feat = "village";
    put(s, "u", "p0", at(s, 5, 3));
    // It knows its own island, the strait, and the village beyond.
    for (const f of [s.factions[0]!]) f.memory.codes = s.tiles.map((t) => (t.t === "shallow" ? 3 : 0));
    const view = unpackView(game.getPrivateState(s, "p0"));
    view.tiles[at(s, 5, 9)] = { ...view.tiles[at(s, 5, 9)]!, feat: "village" };
    expect(landPlan(view, at(s, 5, 3), s.size).toward).toBe(at(s, 5, 9));
    const a = decide(view, "hard", new Rng(1), { banned: new Set() });
    expect(a).toMatchObject({ type: "freeze", unit: "u" });
    // Any of the three shallows facing the village is equally close to it.
    expect([at(s, 4, 4), at(s, 5, 4), at(s, 6, 4)]).toContain((a as { target: number }).target);
  });

  it("with land of its own still to explore, it walks instead", () => {
    const s = strait();
    s.factions[0]!.bot = { level: "hard", name: "Frost" };
    put(s, "u", "p0", at(s, 5, 3));
    const view = unpackView(game.getPrivateState(s, "p0"));
    expect(landPlan(view, at(s, 5, 3), s.size).walk).toBe(true);
  });
});

describe("generation and the lobby", () => {
  it("60 seeds per map type give valid, coastal starts", () => {
    for (const mapType of ["continents", "landmass", "lakes", "archipelago"] as MapType[]) {
      for (let seed = 0; seed < 60; seed++) {
        const w = generateWorld(seed * 977 + 7, 16, ["rimeborn", "orchard"], { mapType, resources: "standard" });
        expect(validateWorld(w.tiles, w.starts, 16, mapType), `${mapType} seed ${seed}`).toBe(true);
      }
    }
  });

  it("starts with Frostcraft when picked by name, and stays out of the lobby", () => {
    const s = game.createGame([{ id: "a" }, { id: "b" }], { ...DEFAULT_SETTINGS, factions: "rimeborn" }, { roundNumber: 1, dealerSeat: 0 }, ctx()).state;
    expect(s.factions[0]!.techs).toEqual(["frostcraft"]);
    expect(FACTIONS.rimeborn.released).toBe(false);
    expect(parseSettings({ factions: "rimeborn" })).toBeNull();
  });
});
