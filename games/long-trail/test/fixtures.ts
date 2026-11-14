import type { RouteDef, SettingPack } from "../shared/pack.ts";
import type { Plan } from "../shared/types.ts";
import type { Caravan, Perks } from "../shared/travel.ts";

// Fixture: a -> b (fork) -> c (desert, safe) | d (plain) -> e. a and d are markets.
export const route: RouteDef = {
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
export const pack = {
  id: "trade-route",
  goods: [{ id: "silk", name: "Silk" }],
  capacityPerAnimal: 10,
  routes: { short: route, normal: route, epic: route },
} as unknown as SettingPack;

export const P4 = ["p1", "p2", "p3", "p4"];
export const NO_PERKS: Perks = { driverHardShield: false, cookHalfAsFull: false };
export const plan = (o: Partial<Plan> = {}): Plan => ({ pace: "steady", rations: "full", rest: false, fork: null, doses: [], trades: [], ...o });
export const zero = () => 0;
export const never = () => 999;

export function van(o: Partial<Caravan> = {}): Caravan {
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
export function onLeg(kind: "desert" | "plain", kmLeft: number, o: Partial<Caravan> = {}): Caravan {
  return van({ at: "b", leg: { to: kind === "desert" ? "c" : "d", km: 90, kind }, kmLeft, ...o });
}
/** Seeded rng for stable tests. */
export function seeded(seed: number) {
  let s = seed;
  return (n: number) => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return Math.floor((s / 4294967296) * n);
  };
}
/** Returns the given values in order, then 999 (every later roll misses). */
export const seq = (...v: number[]) => {
  let i = 0;
  return () => v[i++] ?? 999;
};
