import type { GameOutcome } from "@games/game-core";
import { pathsOf, type RouteDef, type SettingPack } from "./pack.ts";
import type { Caravan } from "./travel.ts";
import type { Goal, Grade } from "./types.ts";

type RandomInt = (n: number) => number;

const GRADES: Grade[] = ["broke", "fair", "rich", "legendary"];

/** How the caravan ended, as the scoring and the recap see it. */
export interface EndView {
  arrived: boolean;
  day: number; // the arrival day when arrived, otherwise the last day played
  deadline: number;
  coins: number;
  cargo: Record<string, number>;
  /** good id -> price at the end stop. Cargo sells here. */
  endPrices: Record<string, number>;
  grade: Grade | null; // null when not arrived
  alive: Record<string, boolean>;
  removed: string[];
  visited: string[];
  starved: boolean;
  deaths: number; // among travellers still in the game
}

export const POINTS = { arrived: 5, grade: { broke: 0, fair: 2, rich: 4, legendary: 6 }, goal: 3, alive: 2 } as const;

function shuffle<T>(items: T[], randomInt: RandomInt): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Stops on some paths but not all: they lie on one branch of a fork. */
export function branchStops(route: RouteDef): string[] {
  const paths = pathsOf(route);
  return route.stops.map((s) => s.id).filter((id) => {
    const hits = paths.filter((p) => p.includes(id)).length;
    return hits > 0 && hits < paths.length;
  });
}

/**
 * One goal per player. Cards are distinct while the deck lasts. If there are more players
 * than usable cards, the deck is reshuffled, never putting the same card twice in a row.
 * Cards that can't be used on this route (a visit goal with no branch stop) are skipped.
 */
export function dealGoals(pack: SettingPack, route: RouteDef, playerIds: string[], randomInt: RandomInt): Record<string, Goal> {
  const branches = branchStops(route);
  const usable = pack.goals.filter((card) => {
    if (typeof card.goal !== "string" && card.goal.kind === "visit") return branches.length > 0;
    if (card.goal === "protect-someone") return playerIds.length > 1;
    return true;
  });
  if (usable.length === 0) throw new Error("no usable goal cards");
  const out: Record<string, Goal> = {};
  let deck: typeof usable = [];
  let last: string | null = null;
  for (const id of playerIds) {
    if (deck.length === 0) {
      deck = shuffle(usable, randomInt);
      const first = deck[deck.length - 1];
      // The next card is popped from the end; swap it away if it repeats the last one.
      if (first && first.id === last && deck.length > 1) [deck[0], deck[deck.length - 1]] = [deck[deck.length - 1]!, deck[0]!];
    }
    const card = deck.pop()!;
    last = card.id;
    if (card.goal === "protect-someone") {
      const others = playerIds.filter((p) => p !== id);
      out[id] = { kind: "protect", target: others[randomInt(others.length)]! };
    } else if (card.goal.kind === "visit") {
      out[id] = { kind: "visit", stop: branches[randomInt(branches.length)]! };
    } else {
      out[id] = { ...card.goal };
    }
  }
  return out;
}

export function cargoSale(cargo: Record<string, number>, endPrices: Record<string, number>): number {
  let sum = 0;
  for (const [good, n] of Object.entries(cargo)) sum += n * (endPrices[good] ?? 0);
  return sum;
}

/** Coins plus cargo sold at the end stop's rolled prices. */
export function wealth(c: Caravan, route: RouteDef): number {
  return c.stock.coins + cargoSale(c.stock.cargo, c.prices[route.end] ?? {});
}

export function gradeOf(pack: SettingPack, w: number): Grade {
  let best: Grade = "broke";
  for (const g of GRADES) if (w >= pack.grades[g]) best = g;
  return best;
}

export function goalMet(goal: Goal, end: EndView): boolean {
  switch (goal.kind) {
    case "coins":
      return end.arrived && end.coins >= goal.atLeast;
    case "cargo":
      return end.arrived && (end.cargo[goal.good] ?? 0) >= goal.atLeast;
    case "arrive-by":
      return end.arrived && end.day <= Math.ceil(goal.share * end.deadline);
    case "grade":
      return end.arrived && end.grade !== null && GRADES.indexOf(end.grade) >= GRADES.indexOf(goal.atLeast);
    case "protect":
      return end.alive[goal.target] === true || end.removed.includes(goal.target);
    case "nobody-dies":
      return end.deaths === 0;
    case "never-starve":
      return !end.starved;
    case "visit":
      return end.visited.includes(goal.stop);
  }
}

export function points(playerId: string, goal: Goal, end: EndView): number {
  if (end.removed.includes(playerId)) return 0;
  let p = 0;
  if (end.arrived) p += POINTS.arrived + (end.grade ? POINTS.grade[end.grade] : 0);
  if (goalMet(goal, end)) p += POINTS.goal;
  if (end.alive[playerId]) p += POINTS.alive;
  return p;
}

export function outcome(players: string[], goals: Record<string, Goal>, end: EndView, _pack: SettingPack, dayCount: number): GameOutcome {
  const inGame = players.filter((id) => !end.removed.includes(id));
  const standings = inGame.map((playerId) => {
    const goal = goals[playerId];
    const value = goal ? points(playerId, goal, end) : 0;
    const met = goal ? goalMet(goal, end) : false;
    return { playerId, value, label: `${value} pts · goal ${met ? "met" : "missed"}` };
  });
  if (!end.arrived) {
    const anyAlive = inGame.some((id) => end.alive[id]);
    return {
      winnerIds: [],
      standings,
      headline: anyAlive ? `The season ended on day ${dayCount}` : "Everyone died on the trail",
    };
  }
  const top = Math.max(...standings.map((s) => s.value));
  return {
    winnerIds: standings.filter((s) => s.value === top).map((s) => s.playerId),
    standings,
    headline: `Arrived ${end.grade ?? "broke"}, day ${end.day}`,
  };
}
