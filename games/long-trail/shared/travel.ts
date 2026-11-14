import { N } from "./numbers.ts";
import { stopById, type Leg, type RouteDef, type SettingPack } from "./pack.ts";
import type { Health, Pace, Plan, Stock, Supply, Trade } from "./types.ts";

/** The part of server state these functions touch. */
export interface Caravan {
  stock: Stock;
  at: string;
  leg: Leg | null; // null while halted at a stop
  kmLeft: number;
  day: number; // the day about to be played, from 1
  health: Record<string, Health>;
  fatigue: number;
  prices: Record<string, Record<string, number>>; // stop id -> good id -> price, rolled at start
  visited: string[];
  starved: boolean; // any day on "none" rations
  arrivedDay: number | null; // the day just played when the end was reached
}
/** Each once per leg; the caller tracks use and sets the flag only when it should apply. */
export interface Perks {
  driverHardShield: boolean;
  cookHalfAsFull: boolean;
}
export interface DayReport {
  km: number;
  reached: string | null;
  used: Partial<Record<Supply, number>>;
  healthChanges: { playerId: string; from: Health; to: Health }[];
  animalLost: boolean;
  shortFood: boolean;
  shortWater: boolean;
  perksUsed: { driver: boolean; cook: boolean }; // true only when the perk cancelled a risk point
}

type RandomInt = (n: number) => number;

/** A chance roll. A randomInt that always returns 0 means every roll with p > 0 hits. */
export function roll(p: number, randomInt: RandomInt): boolean {
  return randomInt(1000) < Math.round(p * 1000);
}

export function rollPrices(route: RouteDef, randomInt: RandomInt): Caravan["prices"] {
  const out: Caravan["prices"] = {};
  for (const stop of route.stops) {
    if (!stop.market) continue;
    const row: Record<string, number> = {};
    for (const [good, [lo, hi]] of Object.entries(stop.market.goods)) row[good] = lo + randomInt(hi - lo + 1);
    out[stop.id] = row;
  }
  return out;
}

const SUPPLIES: Supply[] = ["food", "water", "medicine", "animals"];
const isSupply = (item: string): item is Supply => (SUPPLIES as string[]).includes(item);
const alive = (c: Caravan, travellers: string[]) => travellers.filter((id) => (c.health[id] ?? 0) > 0);

/** Fixed supply price at the stop the caravan is at, from the pack's routes. */
function supplyPrice(c: Caravan, pack: SettingPack, item: Supply): number | undefined {
  for (const route of Object.values(pack.routes)) {
    const stop = route.stops.find((s) => s.id === c.at);
    if (stop?.market) return stop.market.supplies[item];
  }
  return undefined;
}
/** Base price of an item at the current stop, or undefined if it isn't sold there. */
function priceOf(c: Caravan, pack: SettingPack, item: string): number | undefined {
  if (isSupply(item)) return supplyPrice(c, pack, item);
  return c.prices[c.at]?.[item];
}

/** What the caravan pays (qty > 0) or gets (qty < 0) per unit. The one price function for plans and trades. */
function unitPrice(c: Caravan, pack: SettingPack, item: string, buying: boolean, traderLeads: boolean): number | undefined {
  const base = buying ? priceOf(c, pack, item) : isSupply(item) ? undefined : c.prices[c.at]?.[item];
  if (base === undefined) return undefined;
  if (!traderLeads) return base;
  return buying ? Math.floor(base * (1 - N.traderEdge)) : Math.ceil(base * (1 + N.traderEdge));
}

export function planProblem(
  c: Caravan,
  pack: SettingPack,
  route: RouteDef,
  plan: Plan,
  travellers: string[],
  ctx: { healerAlive: boolean; traderLeads: boolean },
): string | null {
  const stop = stopById(route, c.at);
  const atStop = c.leg === null;
  const forkDay = atStop && stop.next.length === 2;
  if (plan.fork !== null) {
    if (!forkDay) return "No fork today.";
    if (!stop.next.some((l) => l.to === plan.fork)) return "That is not a way forward.";
  } else if (forkDay && !plan.rest) {
    return "Pick a way at the fork.";
  }

  let cost = 0;
  let revenue = 0;
  const sold: Record<string, number> = {};
  for (const t of plan.trades) {
    if (!atStop || !stop.market) return "No market here.";
    if (!Number.isInteger(t.qty) || t.qty === 0) return "Bad trade amount.";
    const isGood = pack.goods.some((g) => g.id === t.item);
    if (!isGood && !isSupply(t.item)) return "Unknown item.";
    if (t.qty > 0) {
      const price = unitPrice(c, pack, t.item, true, ctx.traderLeads);
      if (price === undefined) return "Not sold here.";
      cost += price * t.qty;
    } else {
      if (!isGood) return "Only goods can be sold.";
      const price = unitPrice(c, pack, t.item, false, ctx.traderLeads);
      if (price === undefined) return "Not bought here.";
      revenue += price * -t.qty;
      const total = (sold[t.item] ?? 0) - t.qty;
      sold[t.item] = total;
      if (total > (c.stock.cargo[t.item] ?? 0)) return "Not enough to sell.";
    }
  }
  if (cost > c.stock.coins + revenue) return "Not enough coins.";

  if (plan.doses.length > c.stock.medicine) return "Not enough medicine.";
  for (const id of plan.doses) {
    if (!travellers.includes(id) || (c.health[id] ?? 0) <= 0) return "That traveller cannot take a dose.";
  }
  if (plan.doses.length > 0 && !plan.rest && !ctx.healerAlive) return "Only the Healer can give a dose on a moving day.";
  return null;
}

/** Sells first, then buys, so the coins from a sale can pay for a purchase. Skips what can't be done. */
export function applyTrades(c: Caravan, pack: SettingPack, trades: Trade[], traderLeads: boolean): void {
  for (const t of trades) {
    if (t.qty >= 0) continue;
    const price = unitPrice(c, pack, t.item, false, traderLeads);
    const held = c.stock.cargo[t.item] ?? 0;
    if (price === undefined) continue;
    const qty = Math.min(-t.qty, held);
    c.stock.cargo[t.item] = held - qty;
    c.stock.coins += price * qty;
  }
  for (const t of trades) {
    if (t.qty <= 0) continue;
    const price = unitPrice(c, pack, t.item, true, traderLeads);
    if (price === undefined) continue;
    const qty = price > 0 ? Math.min(t.qty, Math.floor(c.stock.coins / price)) : t.qty;
    c.stock.coins -= price * qty;
    if (isSupply(t.item)) c.stock[t.item] += qty;
    else c.stock.cargo[t.item] = (c.stock.cargo[t.item] ?? 0) + qty;
  }
}

export function overCapacity(c: Caravan, pack: SettingPack): boolean {
  const total = Object.values(c.stock.cargo).reduce((a, b) => a + b, 0);
  return total > c.stock.animals * pack.capacityPerAnimal;
}

/** Point the caravan down a leg from the stop it is at. */
export function startLeg(c: Caravan, route: RouteDef, toStopId: string): void {
  const leg = stopById(route, c.at).next.find((l) => l.to === toStopId);
  if (!leg) throw new Error(`no leg from ${c.at} to ${toStopId}`);
  c.leg = leg;
  c.kmLeft = leg.km;
}

const SLOWER: Record<Pace, Pace> = { hard: "steady", steady: "slow", slow: "slow" };

export function travelDay(
  c: Caravan,
  pack: SettingPack,
  route: RouteDef,
  plan: Plan,
  travellers: string[],
  perks: Perks,
  randomInt: RandomInt,
): DayReport {
  const living = alive(c, travellers);
  const report: DayReport = { km: 0, reached: null, used: {}, healthChanges: [], animalLost: false, shortFood: false, shortWater: false, perksUsed: { driver: false, cook: false } };
  const startHealth = { ...c.health };

  const legKind = c.leg?.kind; // read before a halt clears the leg
  // Movement
  let pace: Pace | null = null;
  if (plan.rest) {
    c.fatigue = Math.max(0, c.fatigue + N.animalFatigue.rest);
  } else {
    if (!c.leg) throw new Error("travelDay on a moving day needs a leg; call startLeg first");
    pace = overCapacity(c, pack) ? SLOWER[plan.pace] : plan.pace;
    if (pace === "hard") {
      if (c.fatigue >= N.animalFatigue.max) {
        report.animalLost = c.stock.animals > 0;
        c.stock.animals = Math.max(0, c.stock.animals - 1);
        c.fatigue = 0;
      } else {
        c.fatigue += N.animalFatigue.hard;
      }
    }
    const km = Math.min(N.kmPerDay[pace], c.kmLeft);
    report.km = km;
    c.kmLeft -= km;
    if (c.kmLeft <= 0) {
      report.reached = c.leg.to;
      c.at = c.leg.to;
      c.leg = null;
      c.kmLeft = 0;
      if (!c.visited.includes(c.at)) c.visited.push(c.at);
    }
  }

  // Food and water
  const desert = legKind === "desert";
  const foodNeed = living.length * N.foodPerTraveller[plan.rations];
  const waterNeed = living.length * N.waterPerTraveller[desert ? "desert" : "other"];
  const food = Math.min(foodNeed, c.stock.food);
  const water = Math.min(waterNeed, c.stock.water);
  c.stock.food -= food;
  c.stock.water -= water;
  report.used = { food, water };
  report.shortFood = food < foodNeed;
  report.shortWater = water < waterNeed;
  if (plan.rations === "none") c.starved = true;

  // Health
  const effRations = plan.rations === "half" && perks.cookHalfAsFull ? "full" : plan.rations;
  report.perksUsed = {
    driver: living.length > 0 && pace === "hard" && perks.driverHardShield,
    cook: living.length > 0 && plan.rations === "half" && perks.cookHalfAsFull,
  };
  for (const id of living) {
    const was = startHealth[id] ?? 0;
    let h: Health = was;
    if (plan.rest && effRations === "full" && h < 3 && roll(N.restHealChance, randomInt)) h = (h + 1) as Health;
    let risk = 0;
    if (pace === "hard" && !perks.driverHardShield) risk += N.risk.hard;
    if (effRations === "half") risk += N.risk.half;
    if (effRations === "none") risk += N.risk.none;
    if (report.shortWater) risk += N.risk.thirst;
    if (report.shortFood) risk += N.risk.hungry;
    if (was < 3) risk += N.risk.sick;
    if (roll(Math.min(1, risk * N.riskStepChance), randomInt)) h = Math.max(0, h - 1) as Health;
    c.health[id] = h;
    if (h !== was) report.healthChanges.push({ playerId: id, from: was, to: h });
  }

  if (report.reached === route.end) c.arrivedDay = c.day;
  c.day += 1;
  return report;
}

export function arrived(c: Caravan, route: RouteDef): boolean {
  return c.arrivedDay !== null && c.arrivedDay <= route.deadline && Object.values(c.health).some((h) => h > 0);
}

export function failed(c: Caravan, route: RouteDef): "all-dead" | "deadline" | null {
  if (!Object.values(c.health).some((h) => h > 0)) return "all-dead";
  if (!arrived(c, route) && c.day > route.deadline) return "deadline";
  return null;
}
