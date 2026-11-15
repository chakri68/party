import { seededRandomInt, type GameContext } from "@games/game-core";
import { describe, expect, it } from "vitest";
import { longTrailGame as g } from "../server/game.ts";
import { legOut, openPlan } from "../server/world.ts";
import { N } from "../shared/numbers.ts";
import { packFor, stopById, type RouteDef, type StopDef } from "../shared/pack.ts";
import { wealth } from "../shared/scoring.ts";
import { failed } from "../shared/travel.ts";
import type { Grade, Length, LongTrailServerState, Pace, Plan, Rations, Trade } from "../shared/types.ts";

// Three bots play whole games through longTrailGame, seeded, and the table has to land in the bands.
// The bots act on the public and private views; the sensible ones also read exact stock off the
// server state, since they stand in for a table that can count. The table prints with
// `pnpm vitest run games/long-trail/test/balance.test.ts --reporter=verbose`.
//
// - sensible: steady; full rations while food covers this leg, else half; rest when someone is
//   Badly hurt and the margin is 3+ days; dose the Badly hurt; choice option 0; arm everything on
//   day 1. At a market: sell every good priced above its pack-wide range middle; buy food and water
//   to reach the next market plus 2 days, selling more goods (dearest here first) if coins fall
//   short; then buy the good with the best expected margin (the best range middle at any market
//   still ahead on the safe path, minus the price here), up to capacity, keeping back the coins
//   the next market's supplies will cost.
// - no-trade: the same, but never buys or sells goods. Trading has to beat it on wealth.
// - careless: random pace, rations, forks and choices; no trades, rests or doses.
//
// Calls the brief leaves open: at a fork the sensible bots take the safe branch (the open plan's);
// they don't rebuy a good they are selling, and trade only on days they move.

type S = LongTrailServerState;
type Bot = "sensible" | "no-trade" | "careless";

const GAMES = 300;
const SIDE_GAMES = 40; // 3 and 8 players, printed only (kept small for time)
const LENGTHS: Length[] = ["short", "normal", "epic"];
const ARMABLE = ["guide", "scout", "quartermaster", "lookout"];
const pack = packFor("trade-route");

const daysFor = (km: number) => Math.ceil(km / N.kmPerDay.steady);

/** Each good's pack-wide range middle: halfway between its lowest and highest price anywhere. */
function packMid(): Record<string, number> {
  const lo: Record<string, number> = {};
  const hi: Record<string, number> = {};
  for (const route of Object.values(pack.routes))
    for (const stop of route.stops)
      for (const [good, [a, b]] of Object.entries(stop.market?.goods ?? {})) {
        lo[good] = Math.min(lo[good] ?? a, a);
        hi[good] = Math.max(hi[good] ?? b, b);
      }
  return Object.fromEntries(Object.keys(lo).map((good) => [good, (lo[good]! + hi[good]!) / 2]));
}
const MID = packMid();

/** Days of steady walking left to the end, on the safe branch at every fork still ahead. */
function daysToEnd(s: S, route: RouteDef): number {
  const c = s.caravan;
  let days = 0;
  let at = c.at;
  if (c.leg) {
    days += daysFor(c.kmLeft);
    at = c.leg.to;
  }
  while (at !== route.end) {
    const leg = legOut(route, at, null)!;
    days += daysFor(leg.km);
    at = leg.to;
  }
  return days;
}

/**
 * Food and water to reach the next stop with a market, plus 2 days, walking the safe branch
 * from the leg the caravan is on (or about to take). The 2 extra days drink at the last leg's rate.
 */
function coverNeeds(s: S, route: RouteDef, fork: string | null, living: number): { food: number; water: number } {
  const c = s.caravan;
  const rate = (kind: string) => N.waterPerTraveller[kind === "desert" ? "desert" : "other"];
  let leg = c.leg ?? legOut(route, c.at, fork)!;
  let days = daysFor(c.leg ? c.kmLeft : leg.km);
  let water = days * rate(leg.kind);
  while (!stopById(route, leg.to).market && leg.to !== route.end) {
    leg = legOut(route, leg.to, null)!;
    days += daysFor(leg.km);
    water += daysFor(leg.km) * rate(leg.kind);
  }
  days += 2;
  water += 2 * rate(leg.kind);
  return { food: living * N.foodPerTraveller.full * days, water: living * water };
}

/** Market stops ahead on the safe path, nearest first, ending with the end stop. */
function marketsAhead(route: RouteDef, from: string): StopDef[] {
  const out: StopDef[] = [];
  for (let at = from; at !== route.end; ) {
    at = legOut(route, at, null)!.to;
    const stop = stopById(route, at);
    if (stop.market) out.push(stop);
  }
  return out;
}

/** Food and water from a halted stop to the next market on the safe path, plus 2 days (the buy rule). */
function coverFrom(route: RouteDef, from: string, living: number): { food: number; water: number } {
  const rate = (kind: string) => N.waterPerTraveller[kind === "desert" ? "desert" : "other"];
  let days = 0;
  let water = 0;
  for (let at = from; ; ) {
    const leg = legOut(route, at, null)!;
    days += daysFor(leg.km);
    water += daysFor(leg.km) * rate(leg.kind);
    at = leg.to;
    if (stopById(route, at).market || at === route.end) {
      days += 2;
      water += 2 * rate(leg.kind);
      break;
    }
  }
  return { food: living * N.foodPerTraveller.full * days, water: living * water };
}

function sensiblePlan(s: S, route: RouteDef, tradeGoods: boolean): Plan {
  const pub = g.getPublicState(s);
  const c = s.caravan;
  const open = openPlan(s); // server side: keeps the safe branch at a fork
  const living = pub.travellers.filter((t) => t.health > 0);
  const hurt = living.filter((t) => t.health === 1).map((t) => t.id);
  const leg = c.leg ?? legOut(route, c.at, open.fork)!;
  const legDays = daysFor(c.leg ? c.kmLeft : leg.km);

  const margin = route.deadline - c.day + 1 - daysToEnd(s, route);
  const rest = hurt.length > 0 && margin >= 3;
  const healer = pub.players.some((p) => p.job === "healer" && living.some((t) => t.id === p.id));
  const doses = rest || healer ? hurt.slice(0, c.stock.medicine) : [];

  const trades: Trade[] = [];
  let food = c.stock.food;
  if (pub.prices && !rest) {
    const leader = pub.leader;
    const traderLeads = s.jobs[leader] === "trader" && living.some((t) => t.id === leader);
    const buyAt = (p: number) => (traderLeads ? Math.max(1, Math.floor(p * (1 - N.traderEdge))) : p); // same as unitPrice
    const sellAt = (p: number) => (traderLeads ? Math.ceil(p * (1 + N.traderEdge)) : p);
    let coins = c.stock.coins;
    let cargo = Object.values(c.stock.cargo).reduce((a, b) => a + b, 0);
    for (const [good, price] of Object.entries(tradeGoods ? pub.prices.goods : {})) {
      const held = c.stock.cargo[good] ?? 0;
      if (held > 0 && price > MID[good]!) {
        trades.push({ item: good, qty: -held });
        coins += sellAt(price) * held;
        cargo -= held;
      }
    }
    const cover = coverNeeds(s, route, open.fork, living.length);
    const needs = { food: cover.food - c.stock.food, water: cover.water - c.stock.water };
    if (tradeGoods) {
      // Short of coins for supplies: sell more goods, dearest here first.
      const supplyCost = (["food", "water"] as const).reduce((sum, item) => sum + Math.max(0, needs[item]) * buyAt(pub.prices!.supplies[item] ?? 0), 0);
      let short = supplyCost - coins;
      for (const [good, price] of Object.entries(pub.prices.goods).sort((a, b) => b[1] - a[1])) {
        const left = (c.stock.cargo[good] ?? 0) + trades.filter((t) => t.item === good).reduce((a, t) => a + t.qty, 0);
        if (short <= 0 || left <= 0) continue;
        const qty = Math.min(left, Math.ceil(short / Math.max(1, sellAt(price))));
        const sold = trades.find((t) => t.item === good);
        if (sold) sold.qty -= qty;
        else trades.push({ item: good, qty: -qty });
        coins += sellAt(price) * qty;
        cargo -= qty;
        short -= sellAt(price) * qty;
      }
    }
    for (const item of ["food", "water"] as const) {
      const price = pub.prices.supplies[item];
      if (price === undefined || needs[item] <= 0) continue;
      const unit = buyAt(price);
      const qty = unit > 0 ? Math.min(needs[item], Math.floor(coins / unit)) : needs[item];
      if (qty <= 0) continue;
      trades.push({ item, qty });
      coins -= unit * qty;
      if (item === "food") food += qty;
    }
    if (tradeGoods) {
      // Keep back what the next market's supplies will cost, at its own prices.
      const ahead = marketsAhead(route, c.at);
      const next = ahead[0];
      let reserve = 0;
      if (next && next.id !== route.end) {
        const need = coverFrom(route, next.id, living.length);
        reserve = need.food * (next.market!.supplies.food ?? 0) + need.water * (next.market!.supplies.water ?? 0);
      }
      let best: { good: string; price: number; margin: number } | null = null;
      for (const [good, here] of Object.entries(pub.prices.goods)) {
        if (trades.some((t) => t.item === good)) continue;
        const price = buyAt(here);
        const sell = Math.max(...ahead.map((m) => (m.market!.goods[good]![0] + m.market!.goods[good]![1]) / 2));
        if (sell - price > (best?.margin ?? 0)) best = { good, price, margin: sell - price };
      }
      if (best && best.price > 0) {
        const qty = Math.min(pub.capacity - cargo, Math.floor((coins - reserve) / best.price));
        if (qty > 0) trades.push({ item: best.good, qty });
      }
    }
  }
  const rations: Rations = food >= living.length * N.foodPerTraveller.full * legDays ? "full" : "half";
  return { pace: "steady", rations, rest, fork: open.fork, doses, trades };
}

function carelessPlan(s: S, route: RouteDef, rnd: (n: number) => number): Plan {
  const paces: Pace[] = ["slow", "steady", "hard"];
  const rations: Rations[] = ["full", "half", "none"];
  const stop = stopById(route, s.caravan.at);
  const fork = s.caravan.leg === null && stop.next.length === 2 ? stop.next[rnd(2)]!.to : null;
  return { pace: paces[rnd(3)]!, rations: rations[rnd(3)]!, rest: false, fork, doses: [], trades: [] };
}

interface Result {
  arrived: boolean;
  dead: boolean;
  day: number;
  grade: Grade | null;
  wealth: number;
  sold: boolean; // sold, before the end stop, a good bought on the way
}

function play(bot: Bot, length: Length, players: number, seed: number): Result {
  const route = pack.routes[length];
  const rnd = seededRandomInt(seed);
  const botRnd = seededRandomInt(seed + 7919);
  const ctx = (now: number): GameContext => ({ now, randomInt: rnd, hostId: "p0" });
  const ids = Array.from({ length: players }, (_, i) => `p${i}`);
  let s = g.createGame(ids.map((id) => ({ id })), { setting: "trade-route", length }, { roundNumber: 1, dealerSeat: 0 }, ctx(0)).state;
  const act = (id: string, action: unknown) => {
    const parsed = g.parseAction(action);
    if (!parsed) throw new Error(`unparsed ${JSON.stringify(action)}`);
    const r = g.handleAction(s, id, parsed, ctx(s.deadline - 1000));
    if (!r.ok) throw new Error(`${bot} ${length} seed ${seed}: ${r.error.code} ${r.error.message}`);
    s = r.transition.state;
  };
  const ring = () => {
    s = g.onTimer!(s, "phase", ctx(s.deadline)).state;
  };

  // Everyone but p0 is away, so p0's vote closes a ballot at once. Away players still lead.
  for (const id of ids.slice(1)) s = g.onPlayerDisconnected!(s, id, ctx(0)).state;
  ring(); // the reveal ends, a leader is picked
  if (bot !== "careless") for (const id of ids) if (g.getPrivateState(s, id).ability?.canArm && ARMABLE.includes(s.jobs[id]!)) act(id, { type: "arm", on: true });
  for (let guard = 0; guard < 1000 && s.phase !== "recap"; guard++) {
    if (s.phase === "plan") {
      const leader = g.getPublicState(s).leader;
      act(leader, { type: "propose", plan: bot === "careless" ? carelessPlan(s, route, botRnd) : sensiblePlan(s, route, bot === "sensible") });
      act("p0", { type: "vote", vote: "go" }); // one Go is a majority of the votes cast
    } else if (s.phase === "choice") act("p0", { type: "choose", option: bot === "careless" ? botRnd(2) : 0 });
    else if (s.phase === "summary") act("p0", { type: "next" });
    else ring();
  }
  const end = s.end!;
  const bought = new Set<string>();
  let sold = false;
  for (const day of s.log)
    for (const t of day.plan.trades) {
      if (t.qty > 0) bought.add(t.item);
      else if (bought.has(t.item)) sold = true;
    }
  return { arrived: end.arrived, dead: failed(s.caravan, route) === "all-dead", day: end.day, grade: end.grade, wealth: wealth(s.caravan, route), sold };
}

interface Row {
  bot: Bot;
  length: Length;
  players: number;
  arrive: number;
  dead: number;
  broke: number;
  fair: number;
  rich: number;
  legendary: number;
  fairRich: number;
  fairUp: number; // fair, rich or legendary: arrived with at least the start wealth
  sold: number; // share of games that sold a bought good on the way
  medianDay: number;
  deadline: number;
  wealth: number; // median among arrivals
}

function run(bot: Bot, length: Length, players: number, games: number): Row {
  const results = Array.from({ length: games }, (_, i) => play(bot, length, players, 1000 + i));
  const made = results.filter((r) => r.arrived);
  const share = (grade: Grade) => (made.length ? made.filter((r) => r.grade === grade).length / made.length : 0);
  const days = made.map((r) => r.day).sort((a, b) => a - b);
  const round = (x: number) => Math.round(x * 100) / 100;
  return {
    bot,
    length,
    players,
    arrive: round(made.length / games),
    dead: round(results.filter((r) => r.dead).length / games),
    broke: round(share("broke")),
    fair: round(share("fair")),
    rich: round(share("rich")),
    legendary: round(share("legendary")),
    fairRich: round(share("fair") + share("rich")),
    fairUp: round(share("fair") + share("rich") + share("legendary")),
    sold: round(results.filter((r) => r.sold).length / games),
    medianDay: days.length ? days[Math.floor((days.length - 1) / 2)]! : NaN,
    deadline: pack.routes[length].deadline,
    wealth: made.length ? made.map((r) => r.wealth).sort((a, b) => a - b)[Math.floor((made.length - 1) / 2)]! : NaN,
  };
}

describe("balance", () => {
  it("lands each bot in its bands, and trading pays", () => {
    const rows = LENGTHS.flatMap((length) => (["sensible", "no-trade", "careless"] as const).map((bot) => run(bot, length, 5, GAMES)));
    const side = LENGTHS.flatMap((length) => [run("sensible", length, 3, SIDE_GAMES), run("sensible", length, 8, SIDE_GAMES)]);
    console.table([...rows, ...side]);
    for (const r of rows) {
      const name = `${r.length} ${r.bot}`;
      if (r.bot === "careless") {
        expect(r.arrive, `${name} arrival`).toBeLessThanOrEqual(0.35);
        expect(r.fairUp, `${name} fair or better`).toBeLessThanOrEqual(0.35);
      } else if (r.bot === "no-trade") {
        const sensible = rows.find((x) => x.length === r.length && x.bot === "sensible")!;
        expect(r.fairUp, `${name} fair or better, against sensible's ${sensible.fairUp}`).toBeLessThanOrEqual(sensible.fairUp - 0.25);
      } else {
        expect(r.arrive, `${name} arrival`).toBeGreaterThanOrEqual(0.55);
        expect(r.arrive, `${name} arrival`).toBeLessThanOrEqual(0.8);
        expect(r.fairRich, `${name} fair + rich`).toBeGreaterThanOrEqual(0.5);
        expect(r.legendary, `${name} legendary`).toBeGreaterThanOrEqual(0.02);
        expect(r.legendary, `${name} legendary`).toBeLessThanOrEqual(0.15);
        expect(r.sold, `${name} sells on the way`).toBeGreaterThanOrEqual(0.3);
        expect(r.medianDay, `${name} median day`).toBeGreaterThanOrEqual(r.deadline - 5);
        expect(r.medianDay, `${name} median day`).toBeLessThanOrEqual(r.deadline - 1);
      }
    }
  }, 120_000);
});
