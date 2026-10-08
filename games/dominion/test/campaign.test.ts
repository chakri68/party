// Stage 3: the full land tree, special units, buildings, monuments, capitals
// and teams. Precise setups on a flat board, driven through the adapter.

import { seededRandomInt, type GameContext } from "@games/game-core";
import { describe, expect, it } from "vitest";
import { dominionGame as game } from "../server/game.ts";
import { FACTION_KINDS, UNITS } from "../shared/content.ts";
import { indexOf } from "../shared/grid.ts";
import { generateWorld, validateWorld } from "../shared/mapgen.ts";
import { cityIncome, indexUnits, scoreOf, visionOf } from "../shared/rules.ts";
import { DEFAULT_SETTINGS, type City, type DominionAction, type DominionState, type Unit } from "../shared/types.ts";

const ctx = (): GameContext => ({ now: 0, randomInt: seededRandomInt(1) });

function flat(size = 10, players = 2): DominionState {
  const ids = Array.from({ length: players }, (_, i) => ({ id: `p${i}` }));
  const s = game.createGame(ids, { ...DEFAULT_SETTINGS, mapSize: 16, turnClock: 0 }, { roundNumber: 1, dealerSeat: 0 }, ctx()).state;
  s.size = size;
  s.tiles = Array.from({ length: size * size }, () => ({ t: "plains", res: null, imp: null, road: false, feat: null, city: null, claim: null }));
  s.cities = {};
  s.units = {};
  for (const f of s.factions) f.memory = { codes: s.tiles.map(() => -1), seen: s.tiles.map(() => -1), cities: {} };
  // A capital each, far apart.
  s.factions.forEach((f, k) => city(s, `c${k}`, f.id, k === 0 ? 0 : size * size - 1 - k * 3, true));
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

function claim(s: DominionState, cityId: string, ...tiles: number[]) {
  for (const i of tiles) s.tiles[i]!.claim = cityId;
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

const at = (s: DominionState, r: number, c: number) => indexOf(r, c, s.size);

describe("special units", () => {
  it("knights strike again after a kill", () => {
    const s = flat();
    put(s, "k", "p0", at(s, 4, 4), "knight");
    put(s, "e1", "p1", at(s, 4, 5)).hp = 2;
    put(s, "e2", "p1", at(s, 5, 4)).hp = 2;
    // A spotter isn't needed: units see their neighbours.
    let st = act(s, "p0", { type: "attack", turn: s.turn, unit: "k", target: at(s, 4, 5) });
    expect(st.units.e1).toBeUndefined();
    st = act(st, "p0", { type: "attack", turn: st.turn, unit: "k", target: at(st, 5, 4) });
    expect(st.units.e2).toBeUndefined();
    expect(st.units.k!.chained).toBe(2);
  });

  it("siege can't move and shoot in one turn", () => {
    const s = flat();
    put(s, "sg", "p0", at(s, 4, 4), "siege");
    put(s, "e", "p1", at(s, 4, 6));
    put(s, "spot", "p0", at(s, 4, 7)); // sight on the target
    const moved = act(s, "p0", { type: "move", turn: s.turn, unit: "sg", to: at(s, 3, 4) });
    expect(fails(moved, "p0", { type: "attack", turn: moved.turn, unit: "sg", target: at(s, 4, 6) })).toBe(true);
    expect(fails(s, "p0", { type: "attack", turn: s.turn, unit: "sg", target: at(s, 4, 6) })).toBe(false);
  });

  it("cavalry with Free Spirit falls back after attacking", () => {
    const s = flat();
    s.factions[0]!.techs.push("free_spirit");
    put(s, "cav", "p0", at(s, 4, 4), "cavalry");
    put(s, "e", "p1", at(s, 4, 5), "defender");
    const st = act(s, "p0", { type: "attack", turn: s.turn, unit: "cav", target: at(s, 4, 5) });
    expect(fails(st, "p0", { type: "move", turn: st.turn, unit: "cav", to: at(s, 4, 3) })).toBe(false);
    // Without it, the attack ends the turn.
    s.factions[0]!.techs.pop();
    const st2 = act(s, "p0", { type: "attack", turn: s.turn, unit: "cav", target: at(s, 4, 5) });
    expect(fails(st2, "p0", { type: "move", turn: st2.turn, unit: "cav", to: at(s, 4, 3) })).toBe(true);
  });

  it("sages convert, and converted units don't refund", () => {
    const s = flat();
    s.factions[0]!.techs.push("free_spirit");
    put(s, "sage", "p0", at(s, 4, 4), "sage");
    put(s, "e", "p1", at(s, 4, 5), "swordsman");
    let st = act(s, "p0", { type: "convert", turn: s.turn, unit: "sage", target: at(s, 4, 5) });
    expect(st.units.e!.owner).toBe("p0");
    const before = st.factions[0]!.credits;
    st = act(st, "p0", { type: "disband", turn: st.turn, unit: "e" });
    expect(st.factions[0]!.credits).toBe(before);
  });

  it("champions can't be converted", () => {
    const s = flat();
    put(s, "sage", "p0", at(s, 4, 4), "sage");
    put(s, "champ", "p1", at(s, 4, 5), "champion");
    expect(fails(s, "p0", { type: "convert", turn: s.turn, unit: "sage", target: at(s, 4, 5) })).toBe(true);
  });

  it("sages mend their neighbours", () => {
    const s = flat();
    put(s, "sage", "p0", at(s, 4, 4), "sage");
    put(s, "hurt", "p0", at(s, 4, 5)).hp = 3;
    const st = act(s, "p0", { type: "mend", turn: s.turn, unit: "sage" });
    expect(st.units.hurt!.hp).toBe(7);
  });

  it("disbanding refunds half, rounded down", () => {
    const s = flat();
    s.factions[0]!.techs.push("free_spirit");
    put(s, "k", "p0", at(s, 4, 4), "cavalry");
    const before = s.factions[0]!.credits;
    const st = act(s, "p0", { type: "disband", turn: s.turn, unit: "k" });
    expect(st.factions[0]!.credits).toBe(before + 1);
  });
});

describe("buildings", () => {
  function farmland(s: DominionState) {
    const c = s.cities.c0!;
    // Move the capital inland so it has neighbours on every side.
    s.tiles[0]!.city = null;
    c.at = at(s, 3, 3);
    s.tiles[c.at]!.city = "c0";
    claim(s, "c0", ...[at(s, 2, 2), at(s, 2, 3), at(s, 2, 4), at(s, 3, 2), at(s, 3, 4), at(s, 4, 2), at(s, 4, 3), at(s, 4, 4), at(s, 3, 3)]);
    s.factions[0]!.credits = 200;
    s.factions[0]!.techs.push("gathering", "farming", "construction", "roads", "commerce", "hunting", "archery", "spirituality");
    return c;
  }

  it("mills pay a population per neighbouring farm, once per city", () => {
    const s = flat();
    const c = farmland(s);
    s.tiles[at(s, 2, 2)]!.imp = "farm";
    s.tiles[at(s, 2, 4)]!.imp = "farm";
    const st = act(s, "p0", { type: "develop", turn: s.turn, tile: at(s, 2, 3), kind: "mill" });
    expect(st.cities.c0!.pop + (st.cities.c0!.level - c.level) * 2).toBe(2);
    expect(fails(st, "p0", { type: "develop", turn: st.turn, tile: at(s, 4, 3), kind: "mill" })).toBe(true);
  });

  it("demolishing keeps the credit, and rebuilding doesn't pay twice", () => {
    const s = flat();
    farmland(s);
    s.tiles[at(s, 2, 3)]!.res = "crops";
    let st = act(s, "p0", { type: "develop", turn: s.turn, tile: at(s, 2, 3), kind: "farm" });
    const level = st.cities.c0!.level;
    const pop = st.cities.c0!.pop;
    st = act(st, "p0", { type: "develop", turn: st.turn, tile: at(s, 2, 3), kind: "demolish" });
    expect(st.cities.c0!.level).toBe(level);
    expect(st.cities.c0!.pop).toBe(pop);
    // The crops are gone now; a temple would pay, a second farm couldn't be built.
    expect(st.tiles[at(s, 2, 3)]!.credited).toContain("farm");
  });

  it("markets pay for neighbouring production, up to four", () => {
    const s = flat();
    const c = farmland(s);
    // Five farms touch the market; only four count.
    claim(s, "c0", at(s, 1, 3));
    for (const [r, cc] of [[2, 2], [2, 4], [3, 2], [3, 4], [1, 3]] as const) s.tiles[at(s, r, cc)]!.imp = "farm";
    s.tiles[at(s, 2, 3)]!.imp = "market";
    expect(cityIncome(s, c, indexUnits(Object.values(s.units))).market).toBe(4);
  });

  it("temples gather culture each turn, capped", () => {
    let s = flat();
    farmland(s);
    s = act(s, "p0", { type: "develop", turn: s.turn, tile: at(s, 2, 3), kind: "temple" });
    const before = scoreOf(s, "p0");
    for (let k = 0; k < 24; k++) s = act(s, s.factions[s.current]!.id, { type: "end-turn", turn: s.turn });
    expect(s.tiles[at(s, 2, 3)]!.culture).toBe(100);
    expect(scoreOf(s, "p0")).toBeGreaterThanOrEqual(before + 100);
  });
});

describe("monuments and victory", () => {
  it("ten techs earn a monument to place", () => {
    let s = flat();
    const f = s.factions[0]!;
    f.techs = ["gathering", "farming", "construction", "strategy", "hunting", "forestry", "archery", "riding", "roads"];
    f.credits = 100;
    const before = scoreOf(s, "p0");
    s = act(s, "p0", { type: "research", turn: s.turn, tech: "climbing" });
    // 25 for the tech, 100 for the achievement (plus whatever the refresh explored).
    expect(scoreOf(s, "p0")).toBeGreaterThanOrEqual(before + 125);
    expect(s.factions[0]!.monuments!.earned).toContain("research");
    expect(s.factions[0]!.monuments!.unplaced).toBe(1);
    claim(s, "c0", at(s, 0, 1));
    const pop = s.cities.c0!.pop + s.cities.c0!.level * 10;
    s = act(s, "p0", { type: "monument", turn: s.turn, tile: at(s, 0, 1) });
    expect(s.tiles[at(s, 0, 1)]!.imp).toBe("monument");
    expect(s.factions[0]!.monuments!.unplaced).toBe(0);
    expect(s.cities.c0!.pop + s.cities.c0!.level * 10).toBeGreaterThan(pop); // +3 population
    expect(fails(s, "p0", { type: "monument", turn: s.turn, tile: at(s, 0, 2) })).toBe(true);
  });

  it("holding every capital through a turn wins", () => {
    let s = flat(10, 3);
    s.settings.victory = "capitals";
    // p0 takes both other capitals; nobody's eliminated (they keep a town each).
    s.cities.c1!.owner = "p0";
    s.cities.c2!.owner = "p0";
    city(s, "t1", "p1", at(s, 5, 5));
    city(s, "t2", "p2", at(s, 6, 1));
    for (let k = 0; k < 3 && s.phase === "playing"; k++) s = act(s, s.factions[s.current]!.id, { type: "end-turn", turn: s.turn });
    expect(s.phase).toBe("finished");
    expect(s.outcome).toEqual({ winnerIds: ["p0"], reason: "capitals" });
  });
});

describe("teams", () => {
  function teamGame() {
    const s = flat(10, 4);
    s.settings.teams = 2;
    s.factions.forEach((f, k) => (f.team = k % 2));
    return s;
  }

  it("allies can't attack each other", () => {
    const s = teamGame();
    put(s, "a", "p0", at(s, 4, 4));
    put(s, "b", "p2", at(s, 4, 5));
    expect(fails(s, "p0", { type: "attack", turn: s.turn, unit: "a", target: at(s, 4, 5) })).toBe(true);
  });

  it("share vision when it's on", () => {
    const s = teamGame();
    put(s, "far", "p2", at(s, 5, 5));
    s.settings.sharedVision = true;
    expect(visionOf(s, "p0")[at(s, 5, 5)]).toBe(1);
    s.settings.sharedVision = false;
    expect(visionOf(s, "p0")[at(s, 5, 5)]).toBe(0);
  });

  it("win together, fallen allies included", () => {
    const s = teamGame();
    // p1 and p3 (team 1) down to one city between them, standing in p0's unit's path.
    delete s.cities.c3;
    s.tiles.forEach((t) => t.city === "c3" && (t.city = null));
    const u = put(s, "u", "p0", s.cities.c1!.at);
    void u;
    s.factions[3]!.eliminated = true;
    const st = act(s, "p0", { type: "capture", turn: s.turn, unit: "u" });
    expect(st.phase).toBe("finished");
    expect(new Set(st.outcome!.winnerIds)).toEqual(new Set(["p0", "p2"]));
  });
});

describe("factions", () => {
  it("every classic faction gets a valid start", () => {
    for (const kind of FACTION_KINDS) {
      for (let seed = 0; seed < 15; seed++) {
        const w = generateWorld(seed * 101, 16, [kind, "orchard"], { mapType: "landmass", resources: "standard" });
        expect(validateWorld(w.tiles, w.starts, 16), `${kind} seed ${seed}`).toBe(true);
      }
    }
  });

  it("citadel keepers open leaner", () => {
    const s = game.createGame([{ id: "a" }, { id: "b" }], { ...DEFAULT_SETTINGS, factions: "citadel" }, { roundNumber: 1, dealerSeat: 0 }, ctx()).state;
    expect(s.factions[1]!.credits).toBe(3);
    expect(s.factions[1]!.techs).toEqual(["strategy"]);
  });
});
