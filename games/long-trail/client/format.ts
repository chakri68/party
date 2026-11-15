// Pure words and numbers for the Long Trail view. No DOM here.
import type { JobInfo } from "../shared/info.ts";
import { stopById, type Danger, type RouteDef, type SettingPack } from "../shared/pack.ts";
import { arriveByDay, GRADE_LABEL } from "../shared/scoring.ts";
import { unitPrice, type Caravan } from "../shared/travel.ts";
import type { ArmableJob, Band, Goal, Grade, Health, LongTrailPublicState, Pace, Plan, Rations, Supply, Trade } from "../shared/types.ts";

type Pub = LongTrailPublicState;
type Names = (id: string) => string;

export const PACE_LABEL: Record<Pace, string> = { slow: "Slow", steady: "Steady", hard: "Hard" };
export const RATIONS_LABEL: Record<Rations, string> = { full: "Full", half: "Half", none: "None" };
export const HEALTH_LABEL: Record<Health, string> = { 3: "Well", 2: "Sick", 1: "Badly hurt", 0: "Dead" };
export const BAND_LABEL: Record<Band, string> = { plenty: "plenty", some: "some", low: "low", out: "out" };
/** Filled bars out of 4, for the stock meter. */
export const BAND_BARS: Record<Band, number> = { plenty: 4, some: 3, low: 2, out: 0 };
const DANGER_LABEL: Record<Danger, string> = { 0: "calm", 1: "rough", 2: "dangerous" };

export const SUPPLIES: Supply[] = ["food", "water", "medicine", "animals"];

export const pct = (p: number) => `${Math.round(p * 100)}%`;
export const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/** A name inside a sentence: "you", not "You". */
export const inSentence = (name: string) => (name === "You" ? "you" : name);

/** "A and B", "A, B and C". */
export function list(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

export function gradeLabel(g: Grade | null): string {
  return g ? GRADE_LABEL[g] : "No grade";
}

/** The parts of a Caravan the shared plan and price checks read, rebuilt from public state. */
export function caravanOf(game: Pub): Caravan {
  return {
    stock: { food: 0, water: 0, medicine: game.stock.medicine, coins: game.stock.coins, animals: game.stock.animals, cargo: { ...game.stock.cargo } },
    at: game.at,
    leg: game.leg ? { to: game.leg.to, km: game.leg.km, kind: game.leg.kind } : null,
    kmLeft: game.leg?.kmLeft ?? 0,
    day: game.day,
    health: Object.fromEntries(game.travellers.map((t) => [t.id, t.health])),
    fatigue: 0,
    prices: game.prices ? { [game.at]: { ...game.prices.goods } } : {},
    visited: [...game.visited],
    starved: false,
    arrivedDay: null,
  };
}

export function itemName(pack: SettingPack, item: string): string {
  if ((SUPPLIES as string[]).includes(item)) return pack.labels[item as Supply];
  return pack.goods.find((g) => g.id === item)?.name ?? item;
}

export interface TradeTotals {
  cost: number;
  revenue: number;
  coinsAfter: number;
  cargoAfter: number;
  capacityAfter: number;
}

/** Coins and load after the trades, at the shared prices (so the Trader's edge counts). */
export function tradeTotals(c: Caravan, pack: SettingPack, route: RouteDef, trades: Trade[], traderLeads: boolean): TradeTotals {
  let cost = 0;
  let revenue = 0;
  let cargo = Object.values(c.stock.cargo).reduce((a, b) => a + b, 0);
  let animals = c.stock.animals;
  for (const t of trades) {
    const price = unitPrice(c, route, t.item, t.qty > 0, traderLeads) ?? 0;
    if (t.qty > 0) cost += price * t.qty;
    else revenue += price * -t.qty;
    if (t.item === "animals") animals += t.qty;
    else if (!(SUPPLIES as string[]).includes(t.item)) cargo += t.qty;
  }
  return { cost, revenue, coinsAfter: c.stock.coins + revenue - cost, cargoAfter: cargo, capacityAfter: animals * pack.capacityPerAnimal };
}

/** One plan as short lines, for the vote preview and the day report. */
export function planLines(plan: Plan, pack: SettingPack, route: RouteDef, names: Names): string[] {
  const out = [plan.rest ? `Rest today. ${RATIONS_LABEL[plan.rations]} rations.` : `${PACE_LABEL[plan.pace]} pace. ${RATIONS_LABEL[plan.rations]} rations.`];
  if (plan.fork && !plan.rest) out.push(`Go to ${stopById(route, plan.fork).name}.`);
  if (plan.doses.length) out.push(`Medicine for ${list(plan.doses.map((id) => inSentence(names(id))))}.`);
  const buys = plan.trades.filter((t) => t.qty > 0).map((t) => `${t.qty} ${itemName(pack, t.item)}`);
  const sells = plan.trades.filter((t) => t.qty < 0).map((t) => `${-t.qty} ${itemName(pack, t.item)}`);
  if (buys.length) out.push(`Buy ${list(buys)}.`);
  if (sells.length) out.push(`Sell ${list(sells)}.`);
  return out;
}

/** What the job sees, in short sentences. */
export function infoLines(info: JobInfo, pack: SettingPack, route: RouteDef, names: Names, choiceLabels: string[] = []): string[] {
  const stop = (id: string) => stopById(route, id).name;
  switch (info.job) {
    case "guide": {
      if (info.fork) {
        const ways = Object.entries(info.fork.ways).map(([to, d]) => (d === null ? `The way by ${stop(to)}: not known.` : `The way by ${stop(to)} looks ${DANGER_LABEL[d]}.`));
        return [`Fork at ${stop(info.fork.stop)}.`, ...ways];
      }
      return [info.nextLeg === null ? "No more legs ahead." : `The next leg looks ${DANGER_LABEL[info.nextLeg]}.`];
    }
    case "healer": {
      const rows = Object.entries(info.worsenChance);
      return rows.length ? rows.map(([id, p]) => `${names(id)}: ${pct(p)} chance to get worse today.`) : ["Nobody is sick."];
    }
    case "trader": {
      const prices = (m: { prices: Record<string, number> }) => pack.goods.map((g) => `${g.name} ${m.prices[g.id] ?? "-"}`).join(", ");
      if (info.fork) {
        const ways = Object.entries(info.fork.ways).map(([to, m]) =>
          m === null ? `The way by ${stop(to)}: no market ahead.` : `The way by ${stop(to)}: next market ${stop(m.stop)}. ${prices(m)}.`,
        );
        return [`Fork at ${stop(info.fork.stop)}.`, ...ways];
      }
      if (!info.nextMarket) return ["No more markets ahead."];
      return [`Next market: ${stop(info.nextMarket.stop)}.`, `${prices(info.nextMarket)}.`];
    }
    case "quartermaster":
      return [`Food for ${info.foodDays} days. Water for ${info.waterDays} days.`];
    case "scout": {
      if (!info.nextFork) return ["No more forks ahead."];
      const ways = Object.entries(info.nextFork.km).map(([to, km]) => `by ${stop(to)} ${km} km`);
      return [`Fork at ${stop(info.nextFork.stop)}: ${list(ways)}.`];
    }
    case "driver":
      return [`${pack.labels.animals} are tired: ${info.fatigue} of ${info.max}. At ${info.max}, the next hard pace day kills one of the ${pack.labels.animals.toLowerCase()}.`];
    case "cook":
      return [`Food lasts ${info.foodDays.full} days on full rations, or ${info.foodDays.half} days on half rations.`];
    case "lookout":
      if (!info.odds) return ["No choice to look at now."];
      return info.odds.map((o) => {
        const label = choiceLabels[o.option] ?? `Option ${o.option + 1}`;
        return o.p > 0 ? `${label}: ${pct(o.p)} chance it goes well.` : `${label}: always the same result.`;
      });
  }
}

const FIRED: Record<ArmableJob, string> = {
  guide: "The Guide changed an event.",
  scout: "The Scout saved lost time.",
  quartermaster: "The Quartermaster found hidden food.",
  lookout: "The Lookout changed the choice.",
};
export const firedLine = (job: ArmableJob) => FIRED[job];

/** The goal card, with the named traveller or the last allowed day filled in. */
export function goalLine(text: string, goal: Goal | null | undefined, names: Names, deadlineDay: number): string {
  if (goal?.kind === "protect") return `${text} (${names(goal.target)})`;
  if (goal?.kind === "arrive-by") return `${text} (by day ${arriveByDay(goal.share, deadlineDay)})`;
  return text;
}

/** Stock changes as "Food -6, Coins +10". */
export function deltaLine(pack: SettingPack, stock: Partial<Record<Supply | "coins", number>>, cargo: Record<string, number>): string {
  const parts: string[] = [];
  for (const k of [...SUPPLIES, "coins"] as const) {
    const n = stock[k];
    if (n) parts.push(`${pack.labels[k]} ${signed(n)}`);
  }
  for (const g of pack.goods) {
    const n = cargo[g.id];
    if (n) parts.push(`${g.name} ${signed(n)}`);
  }
  return parts.join(", ");
}
