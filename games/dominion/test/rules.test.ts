import { seededRandomInt, type GameContext } from "@games/game-core";
import { describe, expect, it } from "vitest";
import { dominionGame as game } from "../server/game.ts";
import { indexOf } from "../shared/grid.ts";
import { generateWorld, inspectStarts, MIN_START_DISTANCE, templateWorld, validateWorld } from "../shared/mapgen.ts";
import { indexUnits, reachable, strike, totalIncome } from "../shared/index.ts";
import { DEFAULT_SETTINGS, type DominionState, type FactionKind, type Unit } from "../shared/types.ts";

const ctx = (seed = 1, now = 0): GameContext => ({ now, randomInt: seededRandomInt(seed) });

function newGame(players = 2, seed = 1, settings = {}): DominionState {
  const ids = Array.from({ length: players }, (_, i) => ({ id: `p${i}` }));
  return game.createGame(ids, { ...DEFAULT_SETTINGS, ...settings }, { roundNumber: 1, dealerSeat: 0 }, ctx(seed)).state;
}

/** A blank all-plains board with two empty factions, for precise rule tests. */
function flatGame(size = 8): DominionState {
  const s = newGame(2, 7, { mapSize: 16 });
  s.size = size;
  s.tiles = Array.from({ length: size * size }, () => ({ t: "plains", res: null, imp: null, road: false, feat: null, city: null, claim: null }));
  s.cities = {};
  s.units = {};
  for (const f of s.factions) {
    f.memory = { codes: s.tiles.map(() => -1), seen: s.tiles.map(() => -1), cities: {} };
  }
  // A city each in opposite corners, so nobody's eliminated on the first action.
  const last = size * size - 1;
  for (const [id, owner, at] of [["home", "p0", 0], ["away", "p1", last]] as const) {
    s.tiles[at]!.city = id;
    s.tiles[at]!.claim = id;
    s.cities[id] = { id, name: id, at, owner, level: 1, pop: 0, capitalOf: owner, workshop: false, walls: false, parks: 0, pendingRewards: [], pendingChampion: false };
  }
  s.current = 0;
  return s;
}

function put(s: DominionState, id: string, owner: string, r: number, c: number, type: Unit["type"] = "infantry"): Unit {
  const u: Unit = {
    id, type, owner, home: null, at: indexOf(r, c, s.size), hp: 10, maxHp: 10, kills: 0, veteran: false,
    mp: type === "cavalry" ? 4 : 2, moved: false, attacked: false, done: false, settled: true,
  };
  if (type === "defender" || type === "swordsman") u.hp = u.maxHp = 15;
  s.units[id] = u;
  return u;
}

describe("map generation", () => {
  it("is deterministic for a seed", () => {
    const a = generateWorld(123, 24, ["orchard", "forest", "orchard"], { mapType: "landmass", resources: "standard" });
    const b = generateWorld(123, 24, ["orchard", "forest", "orchard"], { mapType: "landmass", resources: "standard" });
    expect(a).toEqual(b);
  });

  const presets: [number, number, "landmass" | "lakes"][] = [
    [16, 2, "landmass"], [16, 4, "lakes"], [24, 4, "landmass"], [24, 6, "lakes"], [32, 8, "landmass"],
  ];
  for (const [size, players, mapType] of presets) {
    it(`${size}×${size}, ${players} players, ${mapType}: starts are fair and reachable`, () => {
      let templates = 0;
      const kinds: FactionKind[] = Array.from({ length: players }, (_, i) => (i % 2 ? "forest" : "orchard"));
      for (let seed = 0; seed < 60; seed++) {
        const w = generateWorld(seed * 7919, size, kinds, { mapType, resources: "standard" });
        if (w.template) {
          templates++;
          continue;
        }
        expect(validateWorld(w.tiles, w.starts, size)).toBe(true);
        expect(inspectStarts(w.tiles, w.starts, size).spacing).toBeGreaterThanOrEqual(MIN_START_DISTANCE);
        expect(w.attempts).toBeLessThanOrEqual(32);
      }
      // The fallback is a safety net, not the normal path.
      expect(templates).toBeLessThan(3);
    });
  }

  it("has a template that passes for small games", () => {
    const t = templateWorld(16, ["orchard", "forest"]);
    const rep = inspectStarts(t.tiles, t.starts, 16);
    expect(rep.sameRegion).toBe(true);
    expect(rep.villageNear.every(Boolean)).toBe(true);
  });
});

describe("combat", () => {
  it("matches the draft formula", () => {
    // Even infantry: A = D = 2, so 4.5 × 2 × ½ = 4.5 → 5.
    expect(strike({ attack: 2, hp: 10, maxHp: 10 }, { defense: 2, hp: 10, maxHp: 10 }, 1)).toBe(5);
    // Never less than 1, never more than the defender has.
    expect(strike({ attack: 1, hp: 1, maxHp: 10 }, { defense: 3, hp: 15, maxHp: 15 }, 2)).toBe(1);
    expect(strike({ attack: 4, hp: 35, maxHp: 35 }, { defense: 1, hp: 2, maxHp: 10 }, 1)).toBe(2);
  });

  it("retaliates only in range, and previews what it does", () => {
    const s = flatGame();
    const a = put(s, "a", "p0", 2, 2, "archer");
    put(s, "d", "p1", 2, 4);
    // Ranged attacks need sight of the target: a spotter next to it.
    put(s, "spot", "p0", 3, 5);
    const res = game.handleAction(s, "p0", { type: "attack", turn: s.turn, unit: a.id, target: indexOf(2, 4, s.size) }, ctx());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const after = res.transition.state;
    expect(after.units.a!.hp).toBe(10); // infantry can't reach range 2
    expect(after.units.d!.hp).toBeLessThan(10);
  });
});

describe("movement", () => {
  it("lets a fresh unit step into a forest but not further", () => {
    const s = flatGame();
    s.tiles[indexOf(2, 3, s.size)]!.t = "forest";
    const u = put(s, "u", "p0", 2, 2);
    const r = reachable(s, u, indexUnits(Object.values(s.units)));
    expect(r.has(indexOf(2, 3, s.size))).toBe(true);
    expect(r.get(indexOf(2, 3, s.size))).toBe(0);
    expect(r.has(indexOf(2, 4, s.size))).toBe(false);
  });

  it("needs Climbing for mountains", () => {
    const s = flatGame();
    s.tiles[indexOf(2, 3, s.size)]!.t = "mountain";
    const u = put(s, "u", "p0", 2, 2);
    expect(reachable(s, u, indexUnits([u])).has(indexOf(2, 3, s.size))).toBe(false);
    s.factions[0]!.techs.push("climbing");
    expect(reachable(s, u, indexUnits([u])).has(indexOf(2, 3, s.size))).toBe(true);
  });

  it("forbids squeezing diagonally between blocked tiles", () => {
    const s = flatGame();
    s.tiles[indexOf(2, 3, s.size)]!.t = "ocean";
    s.tiles[indexOf(3, 2, s.size)]!.t = "ocean";
    const u = put(s, "u", "p0", 2, 2);
    expect(reachable(s, u, indexUnits([u])).has(indexOf(3, 3, s.size))).toBe(false);
  });

  it("stops in an enemy zone of control", () => {
    const s = flatGame();
    const u = put(s, "u", "p0", 2, 1, "cavalry");
    const e = put(s, "e", "p1", 2, 4);
    const r = reachable(s, u, indexUnits([u, e]));
    expect(r.get(indexOf(2, 3, s.size))).toBe(0);
    expect(r.has(indexOf(2, 3, s.size))).toBe(true);
    // Cavalry has 2 tiles: (2,3) is in the zone, and nothing past it is reachable through it.
    expect(r.has(indexOf(2, 5, s.size))).toBe(false);
  });
});

describe("turns and economy", () => {
  it("grants income once per turn and only on the first real turn", () => {
    const s = newGame(2, 3);
    const me = s.factions[0]!;
    // Opening 5 + capital (level 1 + capital bonus 1) = 7.
    expect(me.credits).toBe(7);
    expect(s.factions[1]!.credits).toBe(5);
    const r = game.handleAction(s, me.id, { type: "end-turn", turn: s.turn }, ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.transition.state.factions[1]!.credits).toBe(7);
    expect(r.transition.state.factions[0]!.credits).toBe(7);
  });

  it("rejects stale and out-of-turn actions", () => {
    const s = newGame(2, 3);
    expect(game.handleAction(s, s.factions[1]!.id, { type: "end-turn", turn: s.turn }, ctx()).ok).toBe(false);
    expect(game.handleAction(s, s.factions[0]!.id, { type: "end-turn", turn: s.turn - 1 }, ctx()).ok).toBe(false);
  });

  it("levels cities and resolves rewards on end turn", () => {
    const s = newGame(2, 5);
    const me = s.factions[0]!;
    const city = Object.values(s.cities).find((c) => c.owner === me.id)!;
    const harvestable = s.tiles.findIndex((t) => t.claim === city.id && t.res && (t.res === "fruit" || t.res === "animals"));
    me.credits = 100;
    me.techs.push("gathering", "hunting");
    let state = s;
    for (const i of s.tiles.map((t, i) => (t.claim === city.id && (t.res === "fruit" || t.res === "animals") ? i : -1)).filter((i) => i >= 0).slice(0, 2)) {
      const r = game.handleAction(state, me.id, { type: "develop", turn: state.turn, tile: i, kind: "harvest" }, ctx());
      expect(r.ok).toBe(true);
      if (r.ok) state = r.transition.state;
    }
    expect(harvestable).toBeGreaterThanOrEqual(0);
    const leveled = state.cities[city.id]!;
    expect(leveled.level).toBe(2);
    expect(leveled.pendingRewards).toEqual([2]);
    const r = game.handleAction(state, me.id, { type: "end-turn", turn: state.turn }, ctx());
    if (!r.ok) throw new Error(r.error.message);
    expect(r.transition.state.cities[city.id]!.workshop).toBe(true);
    expect(r.transition.state.cities[city.id]!.pendingRewards).toEqual([]);
  });

  it("captures a village only the turn after arriving", () => {
    const s = flatGame();
    const village = indexOf(4, 4, s.size);
    s.tiles[village]!.feat = "village";
    const u = put(s, "u", "p0", 4, 3);
    let r = game.handleAction(s, "p0", { type: "move", turn: s.turn, unit: u.id, to: village }, ctx());
    if (!r.ok) throw new Error(r.error.message);
    let st = r.transition.state;
    expect(game.handleAction(st, "p0", { type: "capture", turn: st.turn, unit: u.id }, ctx()).ok).toBe(false);
    r = game.handleAction(st, "p0", { type: "end-turn", turn: st.turn }, ctx());
    if (!r.ok) throw new Error(r.error.message);
    st = r.transition.state;
    r = game.handleAction(st, "p1", { type: "end-turn", turn: st.turn }, ctx());
    if (!r.ok) throw new Error(r.error.message);
    st = r.transition.state;
    r = game.handleAction(st, "p0", { type: "capture", turn: st.turn, unit: u.id }, ctx());
    if (!r.ok) throw new Error(r.error.message);
    st = r.transition.state;
    const city = Object.values(st.cities).find((c) => c.at === village);
    expect(city?.owner).toBe("p0");
    expect(totalIncome(st, "p0")).toBeGreaterThan(0);
  });

  it("ends a turn on the clock, once", () => {
    const s = newGame(2, 9);
    const deadline = s.deadline!;
    const early = game.onTimer!(s, "turn", ctx(1, deadline - 10_000));
    expect(early.state.turn).toBe(s.turn);
    const due = game.onTimer!(s, "turn", ctx(1, deadline));
    expect(due.state.turn).toBe(s.turn + 1);
    // The same alarm again finds a new deadline and does nothing.
    const again = game.onTimer!(due.state, "turn", ctx(1, deadline));
    expect(again.state.turn).toBe(s.turn + 1);
  });

  it("ends in conquest when the last city falls", () => {
    const s = flatGame();
    const away = s.cities.away!;
    // An enemy already settled on p1's only city, at the start of p0's turn.
    const u = put(s, "u", "p0", 7, 7);
    expect(u.at).toBe(away.at);
    const r = game.handleAction(s, "p0", { type: "capture", turn: s.turn, unit: u.id }, ctx());
    if (!r.ok) throw new Error(r.error.message);
    const end = r.transition.state;
    expect(end.phase).toBe("finished");
    expect(game.getResult(end)?.winnerIds).toEqual(["p0"]);
    expect(end.factions[1]!.eliminated).toBe(true);
    expect(r.transition.timers).toContainEqual({ kind: "cancel", timerId: "turn" });
  });

  it("turns a surrendering empire's cities neutral", () => {
    const s = newGame(3, 4);
    const quitter = s.factions[2]!.id;
    const r = game.handleAction(s, quitter, { type: "surrender" }, ctx());
    if (!r.ok) throw new Error(r.error.message);
    const st = r.transition.state;
    expect(st.factions[2]!.eliminated).toBe(true);
    expect(Object.values(st.cities).filter((c) => c.owner === null)).toHaveLength(1);
    expect(Object.values(st.units).some((u) => u.owner === quitter)).toBe(false);
    expect(st.phase).toBe("playing");
  });
});
