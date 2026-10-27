import { shuffle } from "@games/game-core";
import { type DontSayItCarry, type DontSayItPlayerState, other, type TeamId } from "../shared/types.ts";

// Two teams, nothing else to them: who's on which. Pure functions over the
// player list; game.ts decides when to call them.

type Player = DontSayItPlayerState;
type Rand = (maxExclusive: number) => number;

const live = (p: Player) => !p.removed;
const bySeat = (a: Player, b: Player) => a.seat - b.seat;

/** A team's players still in the game, in seat order. */
export function members(players: readonly Player[], team: TeamId): Player[] {
  return players.filter((p) => live(p) && p.team === team).sort(bySeat);
}

export function sizes(players: readonly Player[]): [number, number] {
  return [members(players, 0).length, members(players, 1).length];
}

/** A random split, sizes within 1; which team gets the odd one out is random too. */
export function balancedSplit(ids: readonly string[], rand: Rand): Map<string, TeamId> {
  const order = shuffle([...ids], rand);
  const first: TeamId = rand(2) === 0 ? 0 : 1;
  const half = Math.ceil(order.length / 2);
  return new Map(order.map((id, i) => [id, i < half ? first : other(first)]));
}

/**
 * Moving one player off `from` is fine if the sizes end within 1, or closer
 * than they were (a leaver can leave them 2 apart).
 */
export function canSwitch(current: [number, number], from: TeamId): boolean {
  const to = other(from);
  const before = Math.abs(current[0] - current[1]);
  const after = [...current] as [number, number];
  after[from]--;
  after[to]++;
  const gap = Math.abs(after[0] - after[1]);
  return gap <= 1 || gap < before;
}

/** Reads a carry defensively: it's whatever the last match stored. */
export function parseCarry(carry: unknown): DontSayItCarry | null {
  if (typeof carry !== "object" || carry === null) return null;
  const c = carry as Partial<DontSayItCarry>;
  const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
  if (!Array.isArray(c.teams) || c.teams.length !== 2 || !strings(c.teams[0]) || !strings(c.teams[1])) return null;
  return { teams: [c.teams[0], c.teams[1]], used: strings(c.used) ? c.used : [] };
}

/**
 * Last match's teams, for whoever's still here. Newcomers go to the smaller
 * side, and if that's still more than 1 apart, random players from the bigger
 * side cross until it isn't.
 */
export function restoreTeams(ids: readonly string[], carry: DontSayItCarry | null, rand: Rand): Map<string, TeamId> {
  if (!carry) return balancedSplit(ids, rand);
  const out = new Map<string, TeamId>();
  const fresh: string[] = [];
  for (const id of ids) {
    const t = carry.teams[0].includes(id) ? 0 : carry.teams[1].includes(id) ? 1 : null;
    if (t === null) fresh.push(id);
    else out.set(id, t);
  }
  const count = (t: TeamId) => [...out.values()].filter((x) => x === t).length;
  for (const id of shuffle(fresh, rand)) out.set(id, count(0) <= count(1) ? 0 : 1);
  while (Math.abs(count(0) - count(1)) > 1) {
    const big: TeamId = count(0) > count(1) ? 0 : 1;
    const pool = [...out.keys()].filter((id) => out.get(id) === big);
    out.set(pool[rand(pool.length)]!, other(big));
  }
  return out;
}

/**
 * The first of a team by seat order who's still in and connected; if nobody's
 * connected, the first still in. `skip` passes over someone (a captain who's
 * just dropped).
 */
export function captainOf(players: readonly Player[], team: TeamId, skip: readonly string[] = []): string | null {
  const pool = members(players, team).filter((p) => !skip.includes(p.id));
  return (pool.find((p) => !p.away) ?? pool[0])?.id ?? null;
}

/**
 * Whoever on the team has described the fewest turns, ties by seat order,
 * connected players first. `skip` passes over people (a describer who's just
 * dropped or been skipped).
 */
export function pickDescriber(players: readonly Player[], team: TeamId, skip: readonly string[] = []): string | null {
  const pool = members(players, team).filter((p) => !skip.includes(p.id));
  const here = pool.filter((p) => !p.away);
  const from = here.length ? here : pool;
  const least = Math.min(...from.map((p) => p.described));
  return from.find((p) => p.described === least)?.id ?? null;
}
