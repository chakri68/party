// Wildwood, the first special faction: a swapped tech branch, tending instead
// of harvesting, forest income, and owls that hatch and fly. Plus the six edge
// cases every special capability owes an answer to: occupation, peace, fog,
// conversion, capacity and persistence.

import { seededRandomInt, type GameContext } from "@games/game-core";
import { describe, expect, it } from "vitest";
import { dominionGame as game } from "../server/game.ts";
import { FACTIONS, parentFor, techsFor, trainableFor, UNITS } from "../shared/content.ts";
import { indexOf } from "../shared/grid.ts";
import { generateWorld, validateWorld } from "../shared/mapgen.ts";
import { dominionSettingFields, parseSettings } from "../shared/rules-text.ts";
import { cityIncome, indexUnits, reachable, visionOf } from "../shared/rules.ts";
import { DEFAULT_SETTINGS, type City, type DominionAction, type DominionState, type MapType, type Unit } from "../shared/types.ts";

const ctx = (): GameContext => ({ now: 0, randomInt: seededRandomInt(1) });

/** p0 is Wildwood, p1 orchard settlers, on a flat 10×10 board. */
function wood(size = 10): DominionState {
  const s = game.createGame([{ id: "p0" }, { id: "p1" }], { ...DEFAULT_SETTINGS, mapSize: 16, turnClock: 0 }, { roundNumber: 1, dealerSeat: 0 }, ctx()).state;
  s.size = size;
  s.tiles = Array.from({ length: size * size }, () => ({ t: "plains", res: null, imp: null, road: false, feat: null, city: null, claim: null }));
  s.cities = {};
  s.units = {};
  for (const f of s.factions) {
    f.memory = { codes: s.tiles.map(() => -1), seen: s.tiles.map(() => -1), cities: {} };
    f.credits = 50;
  }
  s.factions[0]!.kind = "wildwood";
  s.factions[0]!.techs = ["tending"];
  s.factions[1]!.kind = "orchard";
  s.factions[1]!.techs = ["gathering"];
  city(s, "c0", "p0", 0, true);
  city(s, "c1", "p1", size * size - 1, true);
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

function put(s: DominionState, id: string, owner: string, at: number, type: Unit["type"] = "infantry"): Unit {
  const def = UNITS[type];
  const u: Unit = { id, type, owner, home: null, at, hp: def.hp, maxHp: def.hp, kills: 0, veteran: false, mp: def.move * 2, moved: false, attacked: false, done: false, settled: true };
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

describe("the Wildwood tree", () => {
  it("swaps the hunting branch, and the rest of the branch follows", () => {
    const tree = techsFor("wildwood");
    expect(tree).not.toContain("hunting");
    expect(tree).not.toContain("forestry");
    expect(tree).not.toContain("mathematics");
    expect(tree).toEqual(expect.arrayContaining(["tending", "grovecraft", "skyroost", "archery", "spirituality"]));
    expect(parentFor("wildwood", "archery")).toBe("tending");
    // Classic factions never see Wildwood techs.
    expect(techsFor("orchard")).not.toContain("tending");
  });

  it("is enforced on the server, both ways", () => {
    const s = wood();
    expect(fails(s, "p0", { type: "research", turn: s.turn, tech: "hunting" })).toBe(true);
    expect(fails(s, "p0", { type: "research", turn: s.turn, tech: "archery" })).toBe(false);
    const t = end(s);
    expect(fails(t, "p1", { type: "research", turn: t.turn, tech: "tending" })).toBe(true);
  });

  it("trains its own units, and nobody else can", () => {
    expect(trainableFor("wildwood")).toEqual(expect.arrayContaining(["bramble", "dryad", "owl_egg"]));
    expect(trainableFor("wildwood")).not.toContain("great_owl"); // only hatched
    expect(trainableFor("orchard")).not.toContain("bramble");
    const s = wood();
    expect(fails(s, "p0", { type: "train", turn: s.turn, city: "c0", unitType: "bramble" })).toBe(false);
    s.factions[1]!.techs.push("tending"); // even with the tech somehow
    const t = end(s);
    expect(fails(t, "p1", { type: "train", turn: t.turn, city: "c1", unitType: "bramble" })).toBe(true);
  });
});

describe("tending", () => {
  it("grows the city and leaves the resource, once per tile", () => {
    const s = wood();
    const i = at(s, 0, 1);
    s.tiles[i]!.claim = "c0";
    s.tiles[i]!.t = "forest";
    s.tiles[i]!.res = "animals";
    expect(fails(s, "p0", { type: "develop", turn: s.turn, tile: i, kind: "harvest" })).toBe(true);
    const t = act(s, "p0", { type: "develop", turn: s.turn, tile: i, kind: "tend" });
    expect(t.tiles[i]!.res).toBe("animals");
    expect(t.tiles[i]!.tended).toBe(true);
    expect(t.cities.c0!.pop).toBe(1);
    expect(t.factions[0]!.credits).toBe(47);
    expect(fails(t, "p0", { type: "develop", turn: t.turn, tile: i, kind: "tend" })).toBe(true);
    expect(game.getPrivateState(t, "p0").tiles[i]?.tended).toBe(true);
  });

  it("needs the faction's version of the harvest tech", () => {
    const s = wood();
    const i = at(s, 1, 0);
    s.tiles[i]!.claim = "c0";
    s.tiles[i]!.res = "fruit";
    expect(fails(s, "p0", { type: "develop", turn: s.turn, tile: i, kind: "tend" })).toBe(true); // needs Gathering
    s.factions[0]!.techs.push("gathering");
    expect(fails(s, "p0", { type: "develop", turn: s.turn, tile: i, kind: "tend" })).toBe(false);
  });

  it("is Wildwood's alone; a captor of tended land harvests it normally", () => {
    const s = wood();
    const i = at(s, 0, 1);
    Object.assign(s.tiles[i]!, { claim: "c0", t: "forest", res: "animals", tended: true });
    s.factions[1]!.techs.push("hunting");
    s.cities.c0!.owner = "p1"; // say it fell
    s.current = 1;
    expect(fails(s, "p1", { type: "develop", turn: s.turn, tile: i, kind: "tend" })).toBe(true);
    const t = act(s, "p1", { type: "develop", turn: s.turn, tile: i, kind: "harvest" });
    expect(t.tiles[i]!.res).toBeNull();
  });
});

describe("forests", () => {
  it("no lumber camps or mines; groves instead", () => {
    const s = wood();
    s.factions[0]!.techs.push("grovecraft", "climbing", "mining");
    const f = at(s, 0, 1);
    const m = at(s, 1, 0);
    Object.assign(s.tiles[f]!, { claim: "c0", t: "forest" });
    Object.assign(s.tiles[m]!, { claim: "c0", t: "mountain", res: "ore" });
    expect(fails(s, "p0", { type: "develop", turn: s.turn, tile: f, kind: "lumber_camp" })).toBe(true);
    expect(fails(s, "p0", { type: "develop", turn: s.turn, tile: m, kind: "mine" })).toBe(true);
    const t = act(s, "p0", { type: "develop", turn: s.turn, tile: f, kind: "grove" });
    expect(t.tiles[f]!.imp).toBe("grove");
    expect(t.cities.c0!.pop).toBe(1);
  });

  it("untouched forest pays: +1 per four, at most +2, groves included", () => {
    const s = wood(12);
    const units = indexUnits([]);
    const forest = (n: number) => {
      for (let k = 0; k < n; k++) Object.assign(s.tiles[at(s, 1 + Math.floor(k / 6), k % 6)]!, { claim: "c0", t: "forest" });
    };
    expect(cityIncome(s, s.cities.c0!, units).forest).toBe(0);
    forest(4);
    expect(cityIncome(s, s.cities.c0!, units).forest).toBe(1);
    s.tiles[at(s, 1, 0)]!.imp = "grove";
    expect(cityIncome(s, s.cities.c0!, units).forest).toBe(1);
    s.tiles[at(s, 1, 0)]!.imp = "lumber_camp"; // someone else's work: not untouched
    expect(cityIncome(s, s.cities.c0!, units).forest).toBe(0);
    forest(12);
    expect(cityIncome(s, s.cities.c0!, units).forest).toBe(2);
    // A classic owner of the same land gets nothing for it.
    s.cities.c0!.owner = "p1";
    expect(cityIncome(s, s.cities.c0!, units).forest).toBe(0);
  });

  it("bramble beasts dig in among the trees", () => {
    const s = wood();
    const b = put(s, "b", "p0", at(s, 4, 4), "bramble");
    put(s, "e", "p1", at(s, 4, 5));
    s.current = 1;
    const open = game.getPrivateState(s, "p1").attacks.e?.[0]?.damage;
    s.tiles[b.at]!.t = "forest";
    const wooded = game.getPrivateState(s, "p1").attacks.e?.[0]?.damage;
    expect(wooded).toBeLessThan(open!);
  });

  it("dryads walk forests at plain cost and mend their neighbours", () => {
    const s = wood();
    for (const c of [5, 6]) s.tiles[at(s, 4, c)]!.t = "forest";
    const d = put(s, "d", "p0", at(s, 4, 4), "dryad");
    const inf = put(s, "i", "p0", at(s, 6, 4));
    s.tiles[at(s, 6, 5)]!.t = "forest";
    const units = indexUnits(Object.values(s.units));
    expect(reachable(s, d, units).has(at(s, 4, 5))).toBe(true);
    expect(reachable(s, d, units).get(at(s, 4, 5))).toBe(0); // one tile, like plains
    expect(reachable(s, inf, units).get(at(s, 6, 5))).toBe(0); // the one-step rule, not cheap ground
    put(s, "hurt", "p0", at(s, 4, 3)).hp = 4;
    const t = act(s, "p0", { type: "mend", turn: s.turn, unit: "d" });
    expect(t.units.hurt!.hp).toBe(8);
  });
});

describe("owls", () => {
  function nest(s: DominionState): Unit {
    s.factions[0]!.techs.push("grovecraft", "skyroost");
    s.cities.c0!.level = 3;
    const t = act(s, "p0", { type: "train", turn: s.turn, city: "c0", unitType: "owl_egg" });
    Object.assign(s, t);
    return Object.values(s.units).find((u) => u.type === "owl_egg")!;
  }

  it("an egg sits still, takes a city slot, and hatches on its owner's third turn", () => {
    let s = wood();
    const egg = nest(s);
    expect(egg.home).toBe("c0");
    for (let k = 0; k < 4; k++) s = end(s); // p1, p0 (1), p1, p0 (2)
    expect(s.units[egg.id]!.type).toBe("owl_egg");
    expect(game.getPrivateState(s, "p0").moves[egg.id]).toBeUndefined();
    expect(game.getPrivateState(s, "p0").units.find((u) => u.id === egg.id)?.mine?.maturesIn).toBe(1);
    s = end(end(s)); // p0 (3)
    const owl = s.units[egg.id]!;
    expect(owl.type).toBe("great_owl");
    expect(owl.hp).toBe(10);
    expect(owl.home).toBe("c0");
    expect(owl.age).toBeUndefined();
  });

  it("a wounded egg hatches a wounded owl", () => {
    let s = wood();
    const egg = nest(s);
    s.units[egg.id]!.hp = 2; // of 5
    for (let k = 0; k < 6; k++) s = end(s);
    expect(s.units[egg.id]!.hp).toBe(4); // 40% of 10
  });

  it("eggs can't be converted; owls can, and keep their wings", () => {
    const s = wood();
    put(s, "egg", "p0", at(s, 4, 4), "owl_egg");
    put(s, "owl", "p0", at(s, 4, 6), "great_owl");
    put(s, "sage", "p1", at(s, 4, 5), "sage");
    s.factions[1]!.techs.push("philosophy");
    s.current = 1;
    expect(fails(s, "p1", { type: "convert", turn: s.turn, unit: "sage", target: at(s, 4, 4) })).toBe(true);
    const t = act(s, "p1", { type: "convert", turn: s.turn, unit: "sage", target: at(s, 4, 6) });
    expect(t.units.owl!.owner).toBe("p1");
    t.units.owl!.done = false;
    t.units.owl!.mp = 6;
    // Over the water it goes, for its new owner too.
    for (let r = 0; r < 10; r++) t.tiles[at(t, r, 7)]!.t = "shallow";
    expect(reachable(t, t.units.owl!, indexUnits(Object.values(t.units))).has(at(t, 4, 8))).toBe(true);
  });

  it("fly over water, peaks and zones, but land on land", () => {
    const s = wood();
    s.factions[0]!.techs.push("grovecraft", "skyroost");
    const owl = put(s, "owl", "p0", at(s, 4, 2), "great_owl");
    for (let r = 0; r < 10; r++) s.tiles[at(s, r, 3)]!.t = "shallow";
    s.tiles[at(s, 4, 4)]!.t = "mountain"; // no Climbing
    const units = indexUnits(Object.values(s.units));
    const r = reachable(s, owl, units);
    expect(r.has(at(s, 4, 3))).toBe(false); // can't end on water
    expect(r.has(at(s, 4, 4))).toBe(true); // can perch on a peak
    expect(r.has(at(s, 4, 5))).toBe(true); // three plain steps
    // An enemy fighter's zone doesn't pin it.
    const z = wood();
    const o2 = put(z, "owl", "p0", at(z, 4, 2), "great_owl");
    put(z, "e", "p1", at(z, 3, 4));
    expect(reachable(z, o2, indexUnits(Object.values(z.units))).has(at(z, 4, 5))).toBe(true);
  });

  it("see three tiles and can't capture", () => {
    const s = wood();
    put(s, "owl", "p0", at(s, 5, 5), "great_owl");
    expect(visionOf(s, "p0")[at(s, 8, 8)]).toBe(1);
    s.tiles[at(s, 5, 5)]!.feat = "village";
    expect(fails(s, "p0", { type: "capture", turn: s.turn, unit: "owl" })).toBe(true);
    expect(game.getPrivateState(s, "p0").idleUnits).toContain("owl"); // it can still move
  });

  it("respect treaties: no landing in a partner's city", () => {
    const s = wood();
    const owl = put(s, "owl", "p0", at(s, 8, 8), "great_owl");
    s.treaties = [{ a: "p0", b: "p1", since: 1 }];
    expect(reachable(s, owl, indexUnits(Object.values(s.units))).has(s.cities.c1!.at)).toBe(false);
  });
});

describe("persistence and the lobby", () => {
  it("an egg's age survives a JSON round trip", () => {
    let s = wood();
    s.factions[0]!.techs.push("grovecraft", "skyroost");
    s.cities.c0!.level = 3;
    s = act(s, "p0", { type: "train", turn: s.turn, city: "c0", unitType: "owl_egg" });
    s = end(end(s));
    const back = JSON.parse(JSON.stringify(s)) as DominionState;
    expect(back).toEqual(s);
    expect(Object.values(back.units).find((u) => u.type === "owl_egg")?.age).toBe(1);
  });

  it("stays out of the lobby and out of Mixed until its art lands", () => {
    expect(FACTIONS.wildwood.released).toBe(false);
    expect(parseSettings({ factions: "wildwood" })).toBeNull();
    const field = dominionSettingFields({}, 2).find((f) => f.key === "factions")!;
    expect(field.options.some((o) => (o.patch as { factions: string }).factions === "wildwood")).toBe(false);
    for (let seed = 0; seed < 20; seed++) {
      const s = game.createGame([{ id: "a" }, { id: "b" }], { ...DEFAULT_SETTINGS }, { roundNumber: 1, dealerSeat: 0 }, { now: 0, randomInt: seededRandomInt(seed) }).state;
      expect(s.factions.every((f) => f.kind !== "wildwood")).toBe(true);
    }
  });

  it("starts with Tending when picked by name", () => {
    const s = game.createGame([{ id: "a" }, { id: "b" }], { ...DEFAULT_SETTINGS, factions: "wildwood" }, { roundNumber: 1, dealerSeat: 0 }, ctx()).state;
    expect(s.factions.map((f) => f.techs)).toEqual([["tending"], ["tending"]]);
    expect(game.getPrivateState(s, "a").kind).toBe("wildwood");
  });
});

describe("generation", () => {
  it("60 seeds per map type give Wildwood valid starts", () => {
    for (const mapType of ["continents", "landmass", "lakes", "archipelago"] as MapType[]) {
      for (let seed = 0; seed < 60; seed++) {
        const w = generateWorld(seed * 977 + 3, 16, ["wildwood", "orchard"], { mapType, resources: "standard" });
        expect(validateWorld(w.tiles, w.starts, 16, mapType), `${mapType} seed ${seed}`).toBe(true);
      }
    }
  });
});
