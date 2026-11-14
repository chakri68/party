import { describe, expect, it } from "vitest";
import { N } from "../shared/numbers.ts";
import type { RouteDef, SettingPack } from "../shared/pack.ts";
import type { Health, Plan } from "../shared/types.ts";
import {
  applyTrades,
  arrived,
  failed,
  overCapacity,
  planProblem,
  rollPrices,
  roll,
  startLeg,
  travelDay,
  type Caravan,
  type Perks,
} from "../shared/travel.ts";

// Fixture: a -> b (fork) -> c (desert, safe) | d (plain) -> e. a and d are markets.
const route: RouteDef = {
  start: "a",
  end: "e",
  deadline: 10,
  stops: [
    { id: "a", name: "A", next: [{ to: "b", km: 100, kind: "plain" }], market: { goods: { silk: [8, 12] }, supplies: { food: 3, medicine: 7 } } },
    {
      id: "b",
      name: "B",
      next: [
        { to: "c", km: 90, kind: "desert", safe: true },
        { to: "d", km: 60, kind: "plain" },
      ],
    },
    { id: "c", name: "C", next: [{ to: "e", km: 40, kind: "plain" }] },
    { id: "d", name: "D", next: [{ to: "e", km: 40, kind: "plain" }], market: { goods: { silk: [10, 10] }, supplies: { water: 2 } } },
    { id: "e", name: "E", next: [] },
  ],
};
const pack = {
  id: "trade-route",
  goods: [{ id: "silk", name: "Silk" }],
  capacityPerAnimal: 10,
  routes: { short: route, normal: route, epic: route },
} as unknown as SettingPack;

const P4 = ["p1", "p2", "p3", "p4"];
const NO_PERKS: Perks = { driverHardShield: false, cookHalfAsFull: false };
const plan = (o: Partial<Plan> = {}): Plan => ({ pace: "steady", rations: "full", rest: false, fork: null, doses: [], trades: [], ...o });
const zero = () => 0;
const never = () => 999;

function van(o: Partial<Caravan> = {}): Caravan {
  return {
    stock: { food: 100, water: 100, medicine: 3, coins: 50, animals: 4, cargo: {} },
    at: "a",
    leg: null,
    kmLeft: 0,
    day: 1,
    health: { p1: 3, p2: 3, p3: 3, p4: 3 },
    fatigue: 0,
    prices: { a: { silk: 10 }, d: { silk: 10 } },
    visited: ["a"],
    starved: false,
    arrivedDay: null,
    ...o,
  };
}
/** A caravan mid-leg on a leg of the given kind. */
function onLeg(kind: "desert" | "plain", kmLeft: number, o: Partial<Caravan> = {}): Caravan {
  return van({ at: "b", leg: { to: kind === "desert" ? "c" : "d", km: 90, kind }, kmLeft, ...o });
}
/** Seeded rng for stable tests. */
function seeded(seed: number) {
  let s = seed;
  return (n: number) => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return Math.floor((s / 4294967296) * n);
  };
}
/** Returns the given values in order, then 999 (every later roll misses). */
const seq = (...v: number[]) => {
  let i = 0;
  return () => v[i++] ?? 999;
};
const H = (...h: Health[]) => Object.fromEntries(h.map((x, i) => [`p${i + 1}`, x]));

describe("roll", () => {
  it("hits when randomInt returns 0 and p > 0, never at p 0", () => {
    expect(roll(0.12, zero)).toBe(true);
    expect(roll(0, zero)).toBe(false);
    expect(roll(1, never)).toBe(true);
  });
});

describe("rollPrices", () => {
  it("rolls each good within its range, only at markets", () => {
    const p = rollPrices(route, seeded(7));
    expect(Object.keys(p).sort()).toEqual(["a", "d"]);
    expect(p.a?.silk).toBeGreaterThanOrEqual(8);
    expect(p.a?.silk).toBeLessThanOrEqual(12);
    expect(p.d?.silk).toBe(10);
    expect(rollPrices(route, zero).a?.silk).toBe(8);
    expect(rollPrices(route, (n) => n - 1).a?.silk).toBe(12);
  });
});

describe("planProblem", () => {
  const check = (c: Caravan, p: Plan, healerAlive = true, traderLeads = false) => planProblem(c, pack, route, p, P4, { healerAlive, traderLeads });
  it("accepts a plain steady/full plan", () => {
    expect(check(van({ at: "e" }), plan())).toBeNull();
    expect(check(van(), plan())).toBeNull();
    expect(check(van({ at: "b" }), plan({ fork: "c" }))).toBeNull();
  });
  it("checks forks", () => {
    expect(check(van(), plan({ fork: "b" }))).not.toBeNull(); // not a fork day
    expect(check(van({ at: "b" }), plan({ fork: "e" }))).not.toBeNull(); // not a branch
    expect(check(onLeg("plain", 20), plan({ fork: "d" }))).not.toBeNull(); // mid-leg
    expect(check(van({ at: "b" }), plan())).not.toBeNull(); // fork needs a choice when moving
    expect(check(van({ at: "b" }), plan({ rest: true }))).toBeNull();
  });
  it("checks trades", () => {
    expect(check(van({ at: "b" }), plan({ trades: [{ item: "silk", qty: 1 }] }))).not.toBeNull(); // no market
    expect(check(onLeg("plain", 20, { at: "a" }), plan({ trades: [{ item: "silk", qty: 1 }] }))).not.toBeNull(); // mid-leg
    expect(check(van(), plan({ trades: [{ item: "gold", qty: 1 }] }))).not.toBeNull(); // unknown item
    expect(check(van(), plan({ trades: [{ item: "water", qty: 1 }] }))).not.toBeNull(); // not sold here
    expect(check(van(), plan({ trades: [{ item: "food", qty: -1 }] }))).not.toBeNull(); // can't sell supplies
    expect(check(van(), plan({ trades: [{ item: "silk", qty: -1 }] }))).not.toBeNull(); // none held
    expect(check(van({ stock: { ...van().stock, cargo: { silk: 2 } } }), plan({ trades: [{ item: "silk", qty: -3 }] }))).not.toBeNull();
    expect(check(van({ stock: { ...van().stock, cargo: { silk: 2 } } }), plan({ trades: [{ item: "silk", qty: -2 }] }))).toBeNull();
    // 5 silk at 10 = 50 coins, fine. Split across trades, 6 total = 60, too much.
    expect(check(van(), plan({ trades: [{ item: "silk", qty: 5 }] }))).toBeNull();
    expect(check(van(), plan({ trades: [{ item: "silk", qty: 3 }, { item: "silk", qty: 3 }] }))).not.toBeNull();
    expect(check(van(), plan({ trades: [{ item: "food", qty: 10 }, { item: "medicine", qty: 2 }] }))).toBeNull(); // 30 + 14
    expect(check(van(), plan({ trades: [{ item: "silk", qty: 0 }] }))).not.toBeNull();
  });
  it("lets a plan sell and buy together, and counts the Trader's prices", () => {
    const broke = van({ stock: { ...van().stock, coins: 0, cargo: { silk: 5 } } });
    expect(check(broke, plan({ trades: [{ item: "silk", qty: -5 }, { item: "food", qty: 10 }] }))).toBeNull(); // 50 in, 30 out
    expect(check(broke, plan({ trades: [{ item: "silk", qty: -1 }, { item: "food", qty: 10 }] }))).not.toBeNull(); // 10 in, 30 out
    const tight = van({ stock: { ...van().stock, coins: 9 } });
    expect(check(tight, plan({ trades: [{ item: "silk", qty: 1 }] }))).not.toBeNull();
    expect(check(tight, plan({ trades: [{ item: "silk", qty: 1 }] }), true, true)).toBeNull(); // 9 with the Trader
  });
  it("checks doses", () => {
    expect(check(van(), plan({ doses: ["p1"] }), true)).toBeNull();
    expect(check(van({ health: { ...van().health, p2: 0 } }), plan({ doses: ["p2"] }))).not.toBeNull(); // dead
    expect(check(van(), plan({ doses: ["zz"] }))).not.toBeNull(); // unknown
    expect(check(van(), plan({ doses: ["p1", "p2", "p3", "p4"] }))).not.toBeNull(); // 4 > 3 medicine
    expect(check(van(), plan({ doses: ["p1"] }), false)).not.toBeNull(); // moving, healer dead
    expect(check(van(), plan({ doses: ["p1"], rest: true }), false)).toBeNull(); // rest day is fine
  });
});

describe("applyTrades", () => {
  it("trades at the listed price", () => {
    const c = van();
    applyTrades(c, route, [{ item: "silk", qty: 3 }, { item: "food", qty: 5 }], false);
    expect(c.stock.cargo.silk).toBe(3);
    expect(c.stock.food).toBe(105);
    expect(c.stock.coins).toBe(50 - 30 - 15);
    applyTrades(c, route, [{ item: "silk", qty: -2 }], false);
    expect(c.stock.cargo.silk).toBe(1);
    expect(c.stock.coins).toBe(5 + 20);
  });
  it("trader leading: buys at 9 for a price of 10, sells at 11", () => {
    const c = van();
    applyTrades(c, route, [{ item: "silk", qty: 1 }], true);
    expect(c.stock.coins).toBe(41);
    applyTrades(c, route, [{ item: "silk", qty: -1 }], true);
    expect(c.stock.coins).toBe(52);
    expect(c.stock.cargo.silk).toBe(0);
  });
  it("rounds in the caravan's favour", () => {
    const c = van({ prices: { a: { silk: 7 } } });
    applyTrades(c, route, [{ item: "silk", qty: 1 }], true); // 6.3 -> 6
    expect(c.stock.coins).toBe(44);
    applyTrades(c, route, [{ item: "silk", qty: -1 }], true); // 7.7 -> 8
    expect(c.stock.coins).toBe(52);
  });
  it("never goes negative: oversells and overbuys are clamped", () => {
    const c = van({ stock: { ...van().stock, coins: 25, cargo: { silk: 2 } } });
    // sell 5 but hold 2 -> +20 coins (45); buy 20 silk at 10 but afford 4 -> -40 (5 left)
    applyTrades(c, route, [{ item: "silk", qty: 20 }, { item: "silk", qty: -5 }], false);
    expect(c.stock.coins).toBe(5);
    expect(c.stock.cargo.silk).toBe(4);
  });
  it("prices supplies from the route it is given", () => {
    const mk = (food: number): RouteDef => ({
      start: "a",
      end: "z",
      deadline: 10,
      stops: [
        { id: "a", name: "A", next: [{ to: "z", km: 10, kind: "plain" }], market: { goods: {}, supplies: { food } } },
        { id: "z", name: "Z", next: [] },
      ],
    });
    const cheap = mk(2);
    const dear = mk(9);
    const two = { ...pack, routes: { short: cheap, normal: dear, epic: dear } } as unknown as SettingPack;
    const a = van();
    applyTrades(a, cheap, [{ item: "food", qty: 1 }], false);
    expect(a.stock.coins).toBe(48);
    const b = van();
    applyTrades(b, dear, [{ item: "food", qty: 1 }], false);
    expect(b.stock.coins).toBe(41);
    expect(planProblem(van({ stock: { ...van().stock, coins: 5 } }), two, cheap, plan({ trades: [{ item: "food", qty: 2 }] }), P4, { healerAlive: true, traderLeads: false })).toBeNull();
    expect(planProblem(van({ stock: { ...van().stock, coins: 5 } }), two, dear, plan({ trades: [{ item: "food", qty: 2 }] }), P4, { healerAlive: true, traderLeads: false })).not.toBeNull();
  });
});

describe("overCapacity", () => {
  it("compares cargo to animals x capacity", () => {
    expect(overCapacity(van({ stock: { ...van().stock, cargo: { silk: 40 } } }), pack)).toBe(false);
    expect(overCapacity(van({ stock: { ...van().stock, cargo: { silk: 41 } } }), pack)).toBe(true);
    expect(overCapacity(van({ stock: { ...van().stock, animals: 0, cargo: { silk: 1 } } }), pack)).toBe(true);
  });
});

describe("startLeg", () => {
  it("sets the leg and km left", () => {
    const c = van({ at: "b" });
    startLeg(c, route, "d");
    expect(c.leg?.to).toBe("d");
    expect(c.kmLeft).toBe(60);
    expect(() => startLeg(c, route, "zz")).toThrow();
  });
});

describe("travelDay: moving", () => {
  it("steady moves kmPerDay.steady", () => {
    const c = onLeg("plain", 60);
    const r = travelDay(c, pack, route, plan(), P4, NO_PERKS, never);
    expect(r.km).toBe(N.kmPerDay.steady);
    expect(c.kmLeft).toBe(60 - N.kmPerDay.steady);
    expect(r.reached).toBeNull();
    expect(c.day).toBe(2);
  });
  it("over capacity, steady counts as slow", () => {
    const c = onLeg("plain", 60, { stock: { ...van().stock, cargo: { silk: 41 } } });
    expect(travelDay(c, pack, route, plan(), P4, NO_PERKS, never).km).toBe(N.kmPerDay.slow);
  });
  it("halting with 10 km left moves 10, reaches the stop and halts", () => {
    const c = onLeg("plain", 10);
    const r = travelDay(c, pack, route, plan(), P4, NO_PERKS, never);
    expect(r.km).toBe(10);
    expect(r.reached).toBe("d");
    expect(c.at).toBe("d");
    expect(c.leg).toBeNull();
    expect(c.kmLeft).toBe(0);
    expect(c.visited).toContain("d");
    expect(c.day).toBe(2);
    expect(c.arrivedDay).toBeNull(); // d is not the end
  });
  it("throws when moving without a leg", () => {
    expect(() => travelDay(van(), pack, route, plan(), P4, NO_PERKS, never)).toThrow();
  });
});

describe("travelDay: food and water", () => {
  it("4 travellers, full rations, desert leg: 2 food and 2 water each", () => {
    const c = onLeg("desert", 90);
    const r = travelDay(c, pack, route, plan(), P4, NO_PERKS, never);
    expect(r.used).toEqual({ food: 4 * N.foodPerTraveller.full, water: 4 * N.waterPerTraveller.desert });
    expect(c.stock.food).toBe(100 - 8);
    expect(c.stock.water).toBe(100 - 8);
  });
  it("half rations eat half, plain legs drink less", () => {
    const c = onLeg("plain", 90);
    const r = travelDay(c, pack, route, plan({ rations: "half" }), P4, NO_PERKS, never);
    expect(r.used.food).toBe(4 * N.foodPerTraveller.half);
    expect(r.used.water).toBe(4 * N.waterPerTraveller.other);
  });
  it("short food uses what is there, never negative, sets shortFood", () => {
    const c = onLeg("plain", 90, { stock: { ...van().stock, food: 3 } });
    const r = travelDay(c, pack, route, plan(), P4, NO_PERKS, never);
    expect(c.stock.food).toBe(0);
    expect(r.used.food).toBe(3);
    expect(r.shortFood).toBe(true);
    expect(r.shortWater).toBe(false);
  });
  it("short water sets shortWater, and hits health when the roll lands", () => {
    const c = onLeg("desert", 90, { stock: { ...van().stock, water: 0 } });
    const r = travelDay(c, pack, route, plan(), P4, NO_PERKS, zero);
    expect(c.stock.water).toBe(0);
    expect(r.shortWater).toBe(true);
    expect(r.healthChanges.length).toBe(4);
  });
  it("rations none eat nothing and flag starved", () => {
    const c = onLeg("plain", 90);
    const r = travelDay(c, pack, route, plan({ rations: "none" }), P4, NO_PERKS, never);
    expect(r.used.food ?? 0).toBe(0);
    expect(r.shortFood).toBe(false);
    expect(c.starved).toBe(true);
  });
  it("the dead eat nothing", () => {
    const c = onLeg("plain", 90, { health: H(3, 3, 0, 0) });
    const r = travelDay(c, pack, route, plan(), P4, NO_PERKS, never);
    expect(r.used.food).toBe(2 * N.foodPerTraveller.full);
  });
});

describe("travelDay: fatigue", () => {
  it("the fourth hard day in a row from 0 loses an animal and resets", () => {
    const c = onLeg("plain", 900);
    const rs = [1, 2, 3, 4].map(() => travelDay(c, pack, route, plan({ pace: "hard" }), P4, NO_PERKS, never));
    expect(rs.map((r) => r.animalLost)).toEqual([false, false, false, true]);
    expect(c.stock.animals).toBe(3);
    expect(c.fatigue).toBe(0);
  });
  it("rest recovers fatigue, clamped at 0", () => {
    const c = van({ fatigue: 1 });
    travelDay(c, pack, route, plan({ rest: true }), P4, NO_PERKS, never);
    expect(c.fatigue).toBe(0);
  });
  it("a hard plan slowed by overload gains no fatigue", () => {
    const c = onLeg("plain", 90, { stock: { ...van().stock, cargo: { silk: 41 } } });
    const r = travelDay(c, pack, route, plan({ pace: "hard" }), P4, NO_PERKS, never);
    expect(r.km).toBe(N.kmPerDay.steady);
    expect(c.fatigue).toBe(0);
  });
  it("steady days leave fatigue alone", () => {
    const c = onLeg("plain", 90, { fatigue: 2 });
    travelDay(c, pack, route, plan(), P4, NO_PERKS, never);
    expect(c.fatigue).toBe(2);
  });
});

describe("travelDay: risk", () => {
  it("hard/none with every roll hitting drops each living traveller exactly one step", () => {
    const c = onLeg("plain", 90, { health: H(3, 2, 1, 0) });
    const r = travelDay(c, pack, route, plan({ pace: "hard", rations: "none" }), P4, NO_PERKS, zero);
    expect(c.health).toEqual(H(2, 1, 0, 0));
    expect(r.healthChanges).toEqual([
      { playerId: "p1", from: 3, to: 2 },
      { playerId: "p2", from: 2, to: 1 },
      { playerId: "p3", from: 1, to: 0 },
    ]);
  });
  it("driver shield and cook perk cancel hard/half risk", () => {
    const c = onLeg("plain", 90);
    const r = travelDay(c, pack, route, plan({ pace: "hard", rations: "half" }), P4, { driverHardShield: true, cookHalfAsFull: true }, zero);
    expect(r.healthChanges).toEqual([]);
    expect(c.health).toEqual(H(3, 3, 3, 3));
  });
  it("without perks, hard/half does hit", () => {
    const c = onLeg("plain", 90);
    const r = travelDay(c, pack, route, plan({ pace: "hard", rations: "half" }), P4, NO_PERKS, zero);
    expect(r.healthChanges.length).toBe(4);
  });
  it("a steady full day with every roll hitting is safe", () => {
    const c = onLeg("plain", 90);
    expect(travelDay(c, pack, route, plan(), P4, NO_PERKS, zero).healthChanges).toEqual([]);
  });
});

describe("travelDay: rest", () => {
  it("moves nothing; the hurt heal on full rations when the roll lands", () => {
    const c = van({ health: H(3, 2, 1, 0) });
    // rolls in order: p1 risk, p2 heal, p2 risk, p3 heal, p3 risk
    const r = travelDay(c, pack, route, plan({ rest: true }), P4, NO_PERKS, seq(999, 0, 999, 0, 999));
    expect(r.km).toBe(0);
    expect(c.at).toBe("a");
    expect(c.health).toEqual(H(3, 3, 2, 0));
    expect(c.day).toBe(2);
  });
  it("no healing on half rations (unless the cook steps in), or when the roll misses", () => {
    const half = van({ health: H(2, 3, 3, 3) });
    travelDay(half, pack, route, plan({ rest: true, rations: "half" }), P4, NO_PERKS, zero);
    expect(half.health.p1).toBe(1); // no heal, and half rations plus sick still bite
    const cook = van({ health: H(2, 3, 3, 3) });
    travelDay(cook, pack, route, plan({ rest: true, rations: "half" }), P4, { driverHardShield: false, cookHalfAsFull: true }, seq(0, 999));
    expect(cook.health.p1).toBe(3); // heal roll hit, risk roll missed
    const miss = van({ health: H(2, 3, 3, 3) });
    travelDay(miss, pack, route, plan({ rest: true }), P4, NO_PERKS, seq(999, 999));
    expect(miss.health.p1).toBe(2);
  });
});

describe("arrived and failed", () => {
  it("the last living traveller dying on the day the end is reached is a failure", () => {
    const c = onLeg("plain", 10, { at: "d", leg: { to: "e", km: 40, kind: "plain" }, health: H(0, 0, 0, 1), day: 5 });
    const r = travelDay(c, pack, route, plan({ pace: "hard", rations: "none" }), P4, NO_PERKS, zero);
    expect(r.reached).toBe(route.end);
    expect(c.health.p4).toBe(0);
    expect(arrived(c, route)).toBe(false);
    expect(failed(c, route)).toBe("all-dead");
  });
  it("reaching the end while playing the deadline day counts as arrived", () => {
    const c = onLeg("plain", 10, { at: "d", leg: { to: "e", km: 40, kind: "plain" }, day: route.deadline });
    travelDay(c, pack, route, plan(), P4, NO_PERKS, never);
    expect(c.day).toBe(route.deadline + 1);
    expect(c.arrivedDay).toBe(route.deadline);
    expect(arrived(c, route)).toBe(true);
    expect(failed(c, route)).toBeNull();
  });
  it("reaching the end a day late is not arrival", () => {
    const c = onLeg("plain", 10, { at: "d", leg: { to: "e", km: 40, kind: "plain" }, day: route.deadline + 1 });
    travelDay(c, pack, route, plan(), P4, NO_PERKS, never);
    expect(arrived(c, route)).toBe(false);
    expect(failed(c, route)).toBe("deadline");
  });
  it("not arriving by the end of the deadline day fails on time", () => {
    const c = onLeg("plain", 90, { day: route.deadline });
    travelDay(c, pack, route, plan(), P4, NO_PERKS, never);
    expect(failed(c, route)).toBe("deadline");
    expect(failed(van({ at: "d", day: route.deadline }), route)).toBeNull();
  });
});

describe("perksUsed", () => {
  it("is true only when the perk cancelled a risk point", () => {
    const both = { driverHardShield: true, cookHalfAsFull: true };
    expect(travelDay(onLeg("plain", 90), pack, route, plan({ pace: "hard", rations: "half" }), P4, both, never).perksUsed).toEqual({ driver: true, cook: true });
    expect(travelDay(onLeg("plain", 90), pack, route, plan(), P4, both, never).perksUsed).toEqual({ driver: false, cook: false });
    expect(travelDay(onLeg("plain", 90), pack, route, plan({ pace: "hard" }), P4, NO_PERKS, never).perksUsed).toEqual({ driver: false, cook: false });
  });
});
