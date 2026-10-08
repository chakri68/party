// Stage 5: contact, treaties and their notice, embassies, infiltrators and
// sabotage (with the fog rules they need), the peace monument, and the
// computer looking after a removed player's empire.

import { seededRandomInt, type GameContext } from "@games/game-core";
import { describe, expect, it } from "vitest";
import { dominionGame as game } from "../server/game.ts";
import { UNITS } from "../shared/content.ts";
import { indexOf } from "../shared/grid.ts";
import { totalIncome, visionOf } from "../shared/rules.ts";
import { DEFAULT_SETTINGS, type City, type DominionAction, type DominionEvent, type DominionState, type Unit } from "../shared/types.ts";

const ctx = (): GameContext => ({ now: 0, randomInt: seededRandomInt(1) });

function board(players = 2, size = 12): DominionState {
  const ids = Array.from({ length: players }, (_, i) => ({ id: `p${i}` }));
  const s = game.createGame(ids, { ...DEFAULT_SETTINGS, mapSize: 16, turnClock: 0 }, { roundNumber: 1, dealerSeat: 0 }, ctx()).state;
  s.size = size;
  s.tiles = Array.from({ length: size * size }, () => ({ t: "plains", res: null, imp: null, road: false, feat: null, city: null, claim: null }));
  s.cities = {};
  s.units = {};
  for (const f of s.factions) {
    f.memory = { codes: s.tiles.map(() => -1), seen: s.tiles.map(() => -1), cities: {} };
    f.techs.push("diplomacy");
    f.credits = 50;
  }
  const spots = [indexOf(1, 1, size), indexOf(1, 6, size), indexOf(8, 1, size), indexOf(8, 8, size)];
  s.factions.forEach((f, k) => city(s, `c${k}`, f.id, spots[k]!, true));
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

function run(s: DominionState, who: string, a: DominionAction) {
  const r = game.handleAction(s, who, a, ctx());
  if (!r.ok) throw new Error(`${a.type}: ${r.error.message}`);
  return r.transition;
}
const act = (s: DominionState, who: string, a: DominionAction) => run(s, who, a).state;
const fails = (s: DominionState, who: string, a: DominionAction) => !game.handleAction(s, who, a, ctx()).ok;
const end = (s: DominionState) => act(s, s.factions[s.current]!.id, { type: "end-turn", turn: s.turn });
const at = (s: DominionState, r: number, c: number) => indexOf(r, c, s.size);

/** p0 and p1 meet: units side by side, then any action settles contact. */
function met(s: DominionState): DominionState {
  put(s, "a", "p0", at(s, 4, 3));
  put(s, "b", "p1", at(s, 4, 4));
  return act(s, "p0", { type: "move", turn: s.turn, unit: "a", to: at(s, 5, 3) });
}

function peace(s: DominionState): DominionState {
  s = act(s, "p0", { type: "offer-peace", turn: s.turn, to: "p1" });
  // p1 answers out of turn.
  return act(s, "p1", { type: "answer-peace", from: "p0", accept: true });
}

describe("contact and treaties", () => {
  it("you meet by seeing each other, and only then can offer", () => {
    let s = board();
    expect(fails(s, "p0", { type: "offer-peace", turn: s.turn, to: "p1" })).toBe(true);
    s = met(s);
    expect(s.factions[0]!.contacts).toContain("p1");
    expect(s.factions[1]!.contacts).toContain("p0");
    s = act(s, "p0", { type: "offer-peace", turn: s.turn, to: "p1" });
    // One offer per pair, either way.
    expect(fails(s, "p0", { type: "offer-peace", turn: s.turn, to: "p1" })).toBe(true);
  });

  it("peace stops attacks, captures and occupation", () => {
    let s = met(board());
    s = peace(s);
    expect(fails(s, "p0", { type: "attack", turn: s.turn, unit: "a", target: s.units.b!.at })).toBe(true);
    // Can't walk into their city either.
    put(s, "c", "p0", at(s, 1, 5));
    expect(fails(s, "p0", { type: "move", turn: s.turn, unit: "c", to: s.cities.c1!.at })).toBe(true);
  });

  it("breaking peace gives notice until the breaker's next turn", () => {
    let s = peace(met(board()));
    s = act(s, "p0", { type: "break-peace", turn: s.turn, with: "p1" });
    expect(fails(s, "p0", { type: "attack", turn: s.turn, unit: "a", target: s.units.b!.at })).toBe(true);
    s = end(s); // p1's turn: still notice, p1 can't strike first either
    expect(fails(s, "p1", { type: "attack", turn: s.turn, unit: "b", target: s.units.a!.at })).toBe(true);
    s = end(s); // p0's turn begins: notice over, war
    expect(fails(s, "p0", { type: "attack", turn: s.turn, unit: "a", target: s.units.b!.at })).toBe(false);
  });

  it("offers lapse after two rounds", () => {
    let s = met(board());
    s = act(s, "p0", { type: "offer-peace", turn: s.turn, to: "p1" });
    for (let k = 0; k < 4; k++) s = end(s);
    expect(s.offers).toEqual([]);
    expect(fails(s, "p1", { type: "answer-peace", from: "p0", accept: true })).toBe(true);
  });
});

describe("embassies", () => {
  it("pay and see only while peace holds", () => {
    let s = met(board());
    const base = totalIncome(s, "p0");
    s = act(s, "p0", { type: "embassy", turn: s.turn, with: "p1" });
    expect(totalIncome(s, "p0")).toBe(base); // at war: nothing
    s = peace(s);
    expect(totalIncome(s, "p0")).toBe(base + 1);
    expect(visionOf(s, "p0")[s.cities.c1!.at]).toBe(1);
    s = act(s, "p0", { type: "break-peace", turn: s.turn, with: "p1" });
    expect(totalIncome(s, "p0")).toBe(base);
  });
});

describe("infiltrators", () => {
  it("stay hidden unless an enemy is right next to them", () => {
    const s = board();
    put(s, "spy", "p0", at(s, 1, 4), "infiltrator"); // two from p1's capital: in sight, not adjacent
    expect(visionOf(s, "p1")[at(s, 1, 4)]).toBe(1);
    expect(game.getPrivateState(s, "p1").units.some((u) => u.id === "spy")).toBe(false);
    put(s, "guard", "p1", at(s, 1, 3));
    expect(game.getPrivateState(s, "p1").units.some((u) => u.id === "spy")).toBe(true);
  });

  it("their moves aren't told to anyone who can't make them out", () => {
    const s = board();
    put(s, "spy", "p0", at(s, 2, 4), "infiltrator");
    const t = run(s, "p0", { type: "move", turn: s.turn, unit: "spy", to: at(s, 2, 5) });
    const toP1 = t.events.filter((e) => e.visibility.kind === "private" && e.visibility.playerId === "p1").map((e) => e.event as DominionEvent);
    // (2,5) is next to p1's capital at (1,6): adjacent, so p1 does see it arrive.
    expect(toP1.some((e) => e.type === "move")).toBe(true);
    const s2 = board();
    put(s2, "spy", "p0", at(s2, 3, 3), "infiltrator");
    const t2 = run(s2, "p0", { type: "move", turn: s2.turn, unit: "spy", to: at(s2, 3, 4) });
    const toP1b = t2.events.filter((e) => e.visibility.kind === "private" && e.visibility.playerId === "p1").map((e) => e.event as DominionEvent);
    expect(toP1b.some((e) => e.type === "move")).toBe(false);
  });

  it("sabotage stops a city's pay for a turn and leaves raiders", () => {
    let s = board();
    put(s, "spy", "p0", s.cities.c1!.at, "infiltrator");
    s = act(s, "p0", { type: "sabotage", turn: s.turn, unit: "spy" });
    expect(s.units.spy).toBeUndefined();
    expect(Object.values(s.units).filter((u) => u.type === "raider" && u.owner === "p0")).toHaveLength(2);
    const before = s.factions[1]!.credits;
    s = end(s);
    expect(s.factions[1]!.credits).toBe(before); // c1 was their only city
    s = end(s);
    s = end(s);
    expect(s.factions[1]!.credits).toBeGreaterThan(before);
  });

  it("no sabotage in peacetime", () => {
    let s = peace(met(board()));
    put(s, "spy", "p0", at(s, 0, 6), "infiltrator");
    s.units.spy!.at = s.cities.c1!.at; // say it slipped in before the treaty
    expect(fails(s, "p0", { type: "sabotage", turn: s.turn, unit: "spy" })).toBe(true);
  });
});

describe("the peace monument", () => {
  it("three treaties, five rounds old", () => {
    let s = board(4);
    for (const f of s.factions) f.contacts = s.factions.filter((g) => g !== f).map((g) => g.id);
    for (const other of ["p1", "p2", "p3"]) {
      s = act(s, "p0", { type: "offer-peace", turn: s.turn, to: other });
      s = act(s, other, { type: "answer-peace", from: "p0", accept: true });
    }
    for (let k = 0; k < 4 * 5 && !s.factions[0]!.monuments!.earned.includes("peace"); k++) s = end(s);
    expect(s.factions[0]!.monuments!.earned).toContain("peace");
  });
});

describe("a removed player's empire", () => {
  it("is kept by the computer, not dissolved", () => {
    const s = board(3);
    const t = game.onPlayerRemoved!(s, "p0", ctx());
    const after = t.state;
    expect(after.factions[0]!.eliminated).toBe(false);
    expect(after.factions[0]!.bot?.level).toBe("normal");
    expect(Object.values(after.cities).some((c) => c.owner === "p0")).toBe(true);
    // It was their turn: nobody's awaited, and the computer's timer is set.
    expect(game.getAwaitedPlayerIds(after)).toEqual([]);
    expect(t.timers).toContainEqual({ kind: "set", timerId: "bot", delayMs: 700 });
    expect(game.getPublicState(after).players[0]).toMatchObject({ caretaker: true });
    const next = game.onTimer!(after, "bot", ctx()).state;
    expect(next.revision).toBeGreaterThan(after.revision);
  });
});
