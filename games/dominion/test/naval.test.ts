// Stage 4: ports, boarding and landing, vessels, splash, port links, beacons,
// water maps — and the fog memory that has to remember all of it.

import { seededRandomInt, type GameContext } from "@games/game-core";
import { describe, expect, it } from "vitest";
import { dominionGame as game } from "../server/game.ts";
import { UNITS } from "../shared/content.ts";
import { indexOf } from "../shared/grid.ts";
import { generateWorld, MAX_ATTEMPTS, validateWorld } from "../shared/mapgen.ts";
import { decodeTile, encodeTile } from "../shared/memory.ts";
import { connectedCities, reachable, indexUnits } from "../shared/rules.ts";
import {
  DEFAULT_SETTINGS,
  type City,
  type DominionAction,
  type DominionState,
  type FactionKind,
  type Improvement,
  type Tile,
  type Unit,
} from "../shared/types.ts";

const ctx = (): GameContext => ({ now: 0, randomInt: seededRandomInt(1) });

/** Land on the left (cols 0–3), shallow sea to the right, ocean beyond col 7. */
function coast(size = 12): DominionState {
  const s = game.createGame([{ id: "p0" }, { id: "p1" }], { ...DEFAULT_SETTINGS, mapSize: 16, turnClock: 0 }, { roundNumber: 1, dealerSeat: 0 }, ctx()).state;
  s.size = size;
  s.tiles = Array.from({ length: size * size }, (_, i) => {
    const c = i % size;
    return { t: c <= 3 ? "plains" : c <= 7 ? "shallow" : "ocean", res: null, imp: null, road: false, feat: null, city: null, claim: null } as Tile;
  });
  s.cities = {};
  s.units = {};
  for (const f of s.factions) f.memory = { codes: s.tiles.map(() => -1), seen: s.tiles.map(() => -1), cities: {} };
  city(s, "c0", "p0", indexOf(5, 2, size), true);
  city(s, "c1", "p1", indexOf(size - 1, 0, size), true);
  s.factions[0]!.techs.push("sailing");
  s.current = 0;
  return s;
}

function city(s: DominionState, id: string, owner: string, at: number, capital = false): City {
  const c: City = { id, name: id, at, owner, level: 1, pop: 0, capitalOf: capital ? owner : null, workshop: false, walls: false, parks: 0, pendingRewards: [], pendingChampion: false };
  s.cities[id] = c;
  s.tiles[at]!.city = id;
  s.tiles[at]!.claim = id;
  return c;
}

function put(s: DominionState, id: string, owner: string, at: number, type: Unit["type"] = "infantry", vessel: Unit["vessel"] = null): Unit {
  const def = UNITS[type];
  const u: Unit = { id, type, owner, home: null, at, hp: def.hp, maxHp: def.hp, kills: 0, veteran: false, mp: 2, moved: false, attacked: false, done: false, settled: true, vessel };
  if (vessel) u.mp = vessel === "transport" || vessel === "bomber" ? 4 : 6;
  s.units[id] = u;
  return u;
}

function act(s: DominionState, who: string, a: DominionAction): DominionState {
  const r = game.handleAction(s, who, a, ctx());
  if (!r.ok) throw new Error(`${a.type}: ${r.error.message}`);
  return r.transition.state;
}

const at = (s: DominionState, r: number, c: number) => indexOf(r, c, s.size);

describe("boarding and landing", () => {
  it("a unit boards at its own port, and lands with nothing left", () => {
    let s = coast();
    const port = at(s, 5, 4);
    s.tiles[port]!.imp = "port";
    s.tiles[port]!.claim = "c0";
    put(s, "u", "p0", at(s, 5, 3));
    s = act(s, "p0", { type: "move", turn: s.turn, unit: "u", to: port });
    expect(s.units.u!.vessel).toBe("transport");
    expect(s.units.u!.mp).toBe(0); // boarding makes no extra movement
    s = act(s, "p0", { type: "end-turn", turn: s.turn });
    s = act(s, "p1", { type: "end-turn", turn: s.turn });
    // Transports move 2 on shallows.
    expect(reachable(s, s.units.u!, indexUnits(Object.values(s.units))).has(at(s, 5, 6))).toBe(true);
    s = act(s, "p0", { type: "move", turn: s.turn, unit: "u", to: at(s, 4, 3) });
    expect(s.units.u!.vessel).toBeNull();
    expect(s.units.u!.done).toBe(true);
  });

  it("can't board without a port, or sail the ocean before Navigation", () => {
    const s = coast();
    put(s, "u", "p0", at(s, 5, 3));
    expect(reachable(s, s.units.u!, indexUnits(Object.values(s.units))).has(at(s, 5, 4))).toBe(false);
    const boat = put(s, "b", "p0", at(s, 2, 7), "infantry", "transport");
    expect(reachable(s, boat, indexUnits(Object.values(s.units))).has(at(s, 2, 8))).toBe(false);
    s.factions[0]!.techs.push("navigation");
    expect(reachable(s, boat, indexUnits(Object.values(s.units))).has(at(s, 2, 8))).toBe(true);
  });
});

describe("vessels", () => {
  it("a refit keeps health and cargo, and costs the turn", () => {
    let s = coast();
    s.factions[0]!.credits = 50;
    const u = put(s, "u", "p0", at(s, 3, 6), "swordsman", "transport");
    u.hp = 9;
    s = act(s, "p0", { type: "upgrade", turn: s.turn, unit: "u", vessel: "scout" });
    expect(s.units.u!).toMatchObject({ vessel: "scout", hp: 9, type: "swordsman", done: true });
    expect(game.handleAction(s, "p0", { type: "upgrade", turn: s.turn, unit: "u", vessel: "bomber" }, ctx()).ok).toBe(false);
  });

  it("bombers splash enemies, never friends, never back", () => {
    let s = coast();
    s.factions[0]!.techs.push("navigation");
    put(s, "bm", "p0", at(s, 6, 5), "infantry", "bomber");
    const target = put(s, "t", "p1", at(s, 3, 5));
    const near = put(s, "n", "p1", at(s, 2, 5));
    const friend = put(s, "f", "p0", at(s, 3, 6));
    put(s, "spot", "p0", at(s, 2, 6)); // sight of everything up there
    s = act(s, "p0", { type: "attack", turn: s.turn, unit: "bm", target: target.at });
    expect(s.units.n!.hp).toBeLessThan(near.hp);
    expect(s.units.f!.hp).toBe(friend.hp);
    expect(s.units.bm!.hp).toBe(10); // range 3: nothing reaches back
  });

  it("ships take reef villages, the only kind they can reach", () => {
    const s = coast();
    const u = put(s, "u", "p0", at(s, 3, 5), "infantry", "transport");
    s.tiles[u.at]!.feat = "village";
    const r = game.handleAction(s, "p0", { type: "capture", turn: s.turn, unit: "u" }, ctx());
    expect(r.ok).toBe(true);
    // A reef city: on the water, and the transport stays afloat in it.
    const t = r.ok ? r.transition.state : s;
    expect(t.tiles[u.at]!.city).not.toBeNull();
    expect(t.units.u!.vessel).toBe("transport");
  });
});

describe("ports and beacons", () => {
  it("two ports on the same water link their cities", () => {
    const s = coast();
    const other = city(s, "c2", "p0", at(s, 10, 2));
    const portA = at(s, 5, 4);
    const portB = at(s, 10, 4);
    for (const [p, c] of [[portA, "c0"], [portB, "c2"]] as const) {
      s.tiles[p]!.imp = "port";
      s.tiles[p]!.claim = c;
    }
    expect(connectedCities(s, "p0").has(other.id)).toBe(true);
    s.tiles[portB]!.imp = null;
    expect(connectedCities(s, "p0").has(other.id)).toBe(false);
  });

  it("a beacon pays the first sight once", () => {
    let s = coast();
    // Just out of the capital's sight until a unit walks up to the shore.
    const b = at(s, 2, 4);
    s.tiles[b]!.feat = "beacon";
    put(s, "u", "p0", at(s, 3, 2));
    s = act(s, "p0", { type: "move", turn: s.turn, unit: "u", to: at(s, 2, 3) });
    const pop = s.cities.c0!.pop + s.cities.c0!.level * 10;
    expect(s.factions[0]!.beacons).toContain(b);
    s = act(s, "p0", { type: "end-turn", turn: s.turn });
    s = act(s, "p1", { type: "end-turn", turn: s.turn });
    expect(s.cities.c0!.pop + s.cities.c0!.level * 10).toBe(pop);
  });
});

describe("water maps", () => {
  for (const mapType of ["continents", "archipelago"] as const) {
    it(`${mapType}: starts on the coast, a village each, rarely the template`, () => {
      let templates = 0;
      for (let seed = 0; seed < 40; seed++) {
        const kinds: FactionKind[] = ["orchard", "coastal", "steppe", "forest"];
        const w = generateWorld(seed * 31, 24, kinds, { mapType, resources: "standard" });
        if (w.template) {
          templates++;
          continue;
        }
        expect(validateWorld(w.tiles, w.starts, 24, mapType)).toBe(true);
        expect(w.attempts).toBeLessThanOrEqual(MAX_ATTEMPTS);
        expect(w.tiles.some((t) => t.feat === "beacon")).toBe(true);
      }
      expect(templates).toBeLessThan(4);
    });
  }
});

describe("fog memory", () => {
  it("remembers every improvement and feature exactly", () => {
    const imps: (Improvement | null)[] = [null, "farm", "lumber_camp", "mine", "mill", "forge", "market", "temple", "monument", "port"];
    for (const imp of imps) {
      for (const feat of [null, "village", "ruins", "beacon"] as const) {
        const tile: Tile = { t: "shallow", res: "fish", imp, road: true, feat, city: null, claim: null };
        expect(decodeTile(encodeTile(tile, 6))).toEqual({ t: "shallow", res: "fish", imp, road: true, feat, ownerSeat: 6 });
      }
    }
  });
});
