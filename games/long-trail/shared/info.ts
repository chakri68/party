import { N } from "./numbers.ts";
import { stopById, type ChoiceEvent, type Danger, type Leg, type LegKind, type RouteDef, type SettingPack } from "./pack.ts";
import { effectivePace, riskPoints, type Caravan } from "./travel.ts";
import type { JobId, Plan, Rations } from "./types.ts";

export type MarketView = { stop: string; prices: Record<string, number> };

// At a fork, info that looks past it shows every way, keyed by the way's first stop, so
// nothing a job sees depends on which way is safe (R15, R17).
export type JobInfo =
  | { job: "guide"; nextLeg: Danger | null; fork: { stop: string; ways: Record<string, Danger | null> } | null }
  | { job: "healer"; worsenChance: Record<string, number> } // per sick or hurt traveller, today's chance at the current plan
  | { job: "trader"; nextMarket: MarketView | null; fork: { stop: string; ways: Record<string, MarketView | null> } | null }
  // Food days at the plan's rations (full rations when the plan eats nothing), water at today's leg kind.
  | { job: "quartermaster"; foodDays: number; rations: "full" | "half"; waterDays: number }
  | { job: "scout"; nextFork: { stop: string; km: Record<string, number> } | null } // total km on each branch to where the branches meet
  | { job: "driver"; fatigue: number; max: number }
  | { job: "cook"; foodDays: Record<Rations, number> }
  | { job: "lookout"; odds: { option: 0 | 1; p: number }[] | null }; // today's choice event, while it's open

export interface InfoState {
  dangers: Record<string, Danger>;
  plan: Plan;
  travellers: string[];
  choice: ChoiceEvent | null;
}

/** Days are capped so "no food needed" stays a plain number. */
const MAX_DAYS = 99;

/** The one way out of a stop; undefined at a fork or the end. Never picks a branch. */
const only = (route: RouteDef, id: string): Leg | undefined => {
  const next = stopById(route, id).next;
  return next.length === 1 ? next[0] : undefined;
};

/** Where the look-ahead starts: the current leg's destination, or the stop we are halted at. */
const origin = (c: Caravan): string => c.leg?.to ?? c.at;

/**
 * The kind of leg walked today: the current leg, or the leg the plan takes out of the stop.
 * At a fork with no way picked, none (the normal water rate), so nothing follows the safe way.
 */
export function todayKind(c: Caravan, route: RouteDef, plan: Plan): LegKind | undefined {
  if (c.leg) return c.leg.kind;
  if (plan.rest) return undefined;
  const next = stopById(route, c.at).next;
  return next.length === 2 ? next.find((l) => l.to === plan.fork)?.kind : next[0]?.kind;
}

/** The first market from a stop on, without passing a fork. "fork" when a fork comes first. */
function marketFrom(c: Caravan, route: RouteDef, from: string): MarketView | { fork: string } | null {
  for (let id: string | undefined = from; id !== undefined; id = only(route, id)?.to) {
    const stop = stopById(route, id);
    if (stop.market) return { stop: id, prices: { ...(c.prices[id] ?? {}) } };
    if (stop.next.length === 2) return { fork: id };
  }
  return null;
}

const daysOf = (stock: number, perDay: number) => (perDay <= 0 ? MAX_DAYS : Math.min(MAX_DAYS, Math.floor(stock / perDay)));

export function jobInfo(job: JobId, c: Caravan, pack: SettingPack, route: RouteDef, state: InfoState): JobInfo {
  const living = state.travellers.filter((id) => (c.health[id] ?? 0) > 0);
  const waterPer = (kind: LegKind | undefined) => living.length * N.waterPerTraveller[kind === "desert" ? "desert" : "other"];
  const foodPer = (rations: Rations) => living.length * N.foodPerTraveller[rations];

  switch (job) {
    case "guide": {
      const from = origin(c);
      const next = stopById(route, from).next;
      const danger = (to: string) => state.dangers[`${from}>${to}`] ?? null;
      if (next.length === 2) return { job, nextLeg: null, fork: { stop: from, ways: Object.fromEntries(next.map((l) => [l.to, danger(l.to)])) } };
      return { job, nextLeg: next[0] ? danger(next[0].to) : null, fork: null };
    }
    case "healer": {
      const pace = effectivePace(c, pack, state.plan);
      const legKind = todayKind(c, route, state.plan);
      const shortFood = foodPer(state.plan.rations) > c.stock.food;
      const shortWater = waterPer(legKind) > c.stock.water;
      const worsenChance: Record<string, number> = {};
      for (const id of living) {
        if ((c.health[id] ?? 0) >= 3) continue;
        const risk = riskPoints({ pace, rations: state.plan.rations, shortFood, shortWater, sick: true, driverShield: false });
        worsenChance[id] = Math.min(1, risk * N.riskStepChance);
      }
      return { job, worsenChance };
    }
    case "trader": {
      const found = marketFrom(c, route, origin(c));
      if (!found || !("fork" in found)) return { job, nextMarket: found, fork: null };
      // A fork comes first: the next market on each way. A second fork on a way ends its look.
      const ways: Record<string, MarketView | null> = {};
      for (const l of stopById(route, found.fork).next) {
        const m = marketFrom(c, route, l.to);
        ways[l.to] = m && !("fork" in m) ? m : null;
      }
      return { job, nextMarket: null, fork: { stop: found.fork, ways } };
    }
    case "quartermaster": {
      const kind = todayKind(c, route, state.plan);
      // No rations eat nothing, so "days left" would be endless: count full rations, like the food band.
      const rations = state.plan.rations === "none" ? "full" : state.plan.rations;
      return { job, foodDays: daysOf(c.stock.food, foodPer(rations)), rations, waterDays: daysOf(c.stock.water, waterPer(kind)) };
    }
    case "scout": {
      for (let id: string | undefined = origin(c); id !== undefined; id = only(route, id)?.to) {
        const stop = stopById(route, id);
        if (stop.next.length !== 2) continue;
        const paths = stop.next.map((first) => {
          const stops: { id: string; km: number }[] = [];
          let km = 0;
          for (let leg: Leg | undefined = first; leg; leg = only(route, leg.to)) {
            km += leg.km;
            stops.push({ id: leg.to, km });
          }
          return { first: first.to, stops };
        });
        const [a, b] = paths;
        const meet = a?.stops.find((s) => b?.stops.some((t) => t.id === s.id));
        const out: Record<string, number> = {};
        for (const p of paths) out[p.first] = p.stops.find((s) => s.id === meet?.id)?.km ?? p.stops[p.stops.length - 1]?.km ?? 0;
        return { job, nextFork: { stop: id, km: out } };
      }
      return { job, nextFork: null };
    }
    case "driver":
      return { job, fatigue: c.fatigue, max: N.animalFatigue.max };
    case "cook":
      return {
        job,
        foodDays: {
          full: daysOf(c.stock.food, foodPer("full")),
          half: daysOf(c.stock.food, foodPer("half")),
          none: daysOf(c.stock.food, foodPer("none")),
        },
      };
    case "lookout":
      return { job, odds: state.choice ? state.choice.options.map((o, i) => ({ option: i as 0 | 1, p: o.effect.chance?.p ?? 0 })) : null };
  }
}
