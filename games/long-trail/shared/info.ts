import { N } from "./numbers.ts";
import { stopById, type ChoiceEvent, type Danger, type Leg, type LegKind, type RouteDef, type SettingPack } from "./pack.ts";
import { effectivePace, riskPoints, type Caravan } from "./travel.ts";
import type { JobId, Plan, Rations } from "./types.ts";

export type JobInfo =
  | { job: "guide"; nextLeg: Danger | null }
  | { job: "healer"; worsenChance: Record<string, number> } // per sick or hurt traveller, today's chance at the current plan
  | { job: "trader"; nextMarket: { stop: string; prices: Record<string, number> } | null }
  | { job: "quartermaster"; foodDays: number; waterDays: number } // at current rations and the next leg's kind
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

/** The way forward from a stop; at a fork, the safe branch. */
const forward = (route: RouteDef, id: string): Leg | undefined => {
  const next = stopById(route, id).next;
  return next.length === 2 ? (next.find((l) => l.safe) ?? next[0]) : next[0];
};

/** Where the look-ahead starts: the current leg's destination, or the stop we are halted at. */
const origin = (c: Caravan): string => c.leg?.to ?? c.at;

/** The leg after the one we're on, or the one leaving the stop we're halted at. */
function nextLeg(c: Caravan, route: RouteDef): { from: string; leg: Leg } | null {
  const from = origin(c);
  const leg = forward(route, from);
  return leg ? { from, leg } : null;
}

const daysOf = (stock: number, perDay: number) => (perDay <= 0 ? MAX_DAYS : Math.min(MAX_DAYS, Math.floor(stock / perDay)));

export function jobInfo(job: JobId, c: Caravan, pack: SettingPack, route: RouteDef, state: InfoState): JobInfo {
  const living = state.travellers.filter((id) => (c.health[id] ?? 0) > 0);
  const waterPer = (kind: LegKind | undefined) => living.length * N.waterPerTraveller[kind === "desert" ? "desert" : "other"];
  const foodPer = (rations: Rations) => living.length * N.foodPerTraveller[rations];

  switch (job) {
    case "guide": {
      const n = nextLeg(c, route);
      return { job, nextLeg: n ? (state.dangers[`${n.from}>${n.leg.to}`] ?? null) : null };
    }
    case "healer": {
      const pace = effectivePace(c, pack, state.plan);
      const legKind = c.leg?.kind ?? (state.plan.rest ? undefined : (stopById(route, c.at).next.find((l) => l.to === state.plan.fork) ?? forward(route, c.at))?.kind);
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
      for (let id: string | undefined = origin(c); id !== undefined; id = forward(route, id)?.to) {
        if (stopById(route, id).market) return { job, nextMarket: { stop: id, prices: { ...(c.prices[id] ?? {}) } } };
      }
      return { job, nextMarket: null };
    }
    case "quartermaster": {
      const kind = nextLeg(c, route)?.leg.kind;
      return { job, foodDays: daysOf(c.stock.food, foodPer(state.plan.rations)), waterDays: daysOf(c.stock.water, waterPer(kind)) };
    }
    case "scout": {
      for (let id: string | undefined = origin(c); id !== undefined; id = forward(route, id)?.to) {
        const stop = stopById(route, id);
        if (stop.next.length !== 2) continue;
        const paths = stop.next.map((first) => {
          const stops: { id: string; km: number }[] = [];
          let km = 0;
          for (let leg: Leg | undefined = first; leg; leg = forward(route, leg.to)) {
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
