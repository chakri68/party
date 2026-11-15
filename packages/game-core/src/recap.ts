// The party recap: a night's finished games in, a few awards out. Pure, so the
// room, the tests and a self-hosted copy all hand out the same awards.

import type { PartyStats, StatKey } from "./index.ts";

/** One finished game, as the room logged it. Computer players are already left out. */
export interface PartyGame {
  gameId: string;
  endedAt: number;
  /** Who was dealt in, so "won 4 of 6" counts only the games they played. */
  players: string[];
  winnerIds: string[];
  loserIds?: string[];
  stats: PartyStats;
}

export interface PartyLog {
  /** When the first game started. Null until one has. */
  startedAt: number | null;
  games: PartyGame[];
  /** Everyone who finished a game, so a player who left still shows by name. */
  names: Record<string, string>;
  /** Set by End party. */
  endedAt: number | null;
}

export interface RecapAward {
  id: string;
  title: string;
  /** Names, not ids: the recap outlives the seats. */
  who: string[];
  line: string;
}

export interface Recap {
  gamesPlayed: number;
  minutes: number;
  /** The shell turns it into a name, so a host app's own game names show. */
  topGameId: string | null;
  awards: RecapAward[];
  /** Set when no award qualified. */
  quiet: string | null;
}

export const PARTY_LOG_MAX = 50;
const MAX_AWARDS = 5;
const MAX_TIED = 3;

export function emptyPartyLog(): PartyLog {
  return { startedAt: null, games: [], names: {}, endedAt: null };
}

type Totals = Map<string, Partial<Record<StatKey, number>>>;

interface AwardRule {
  id: string;
  title: string;
  min: number;
  score: (id: string, ctx: Ctx) => number;
  line: (who: string[], ctx: Ctx) => string;
}

interface Ctx {
  stat: (id: string, key: StatKey) => number;
  wins: (id: string) => number;
  played: (id: string) => number;
  /** Ranking the liar by lies nobody caught, or (nobody got away with 3) lies told. */
  liarByUncaught: boolean;
}

const RULES: AwardRule[] = [
  {
    id: "champion",
    title: "Champion of the night",
    min: 2,
    score: (id, c) => c.wins(id),
    line: (who, c) => (who.length > 1 ? `Won ${c.wins(who[0]!)} games each.` : `Won ${c.wins(who[0]!)} of ${c.played(who[0]!)} games.`),
  },
  {
    id: "liar",
    title: "Biggest liar",
    min: 3,
    score: (id, c) => c.stat(id, c.liarByUncaught ? "liesUncaught" : "liesTold"),
    line: (who, c) => {
      // A tie only shares the number it was ranked on; say just that.
      if (who.length > 1) {
        return c.liarByUncaught
          ? `Each told ${c.stat(who[0]!, "liesUncaught")} lies nobody caught.`
          : `Each told ${c.stat(who[0]!, "liesTold")} lies.`;
      }
      const uncaught = c.stat(who[0]!, "liesUncaught");
      return `Told ${c.stat(who[0]!, "liesTold")} lies.${uncaught ? ` ${uncaught} were never caught.` : ""}`;
    },
  },
  { id: "eye", title: "Sharpest eye", min: 2, score: (id, c) => c.stat(id, "rightCalls"), line: ([id], c) => `Called ${c.stat(id!, "rightCalls")} bluffs right.` },
  { id: "suspicious", title: "Most suspicious", min: 3, score: (id, c) => c.stat(id, "votesAgainst"), line: ([id], c) => `Got ${c.stat(id!, "votesAgainst")} votes against them.` },
  {
    id: "sneaky",
    title: "Best actor",
    min: 2,
    score: (id, c) => c.stat(id, "survivedAsBad") + c.stat(id, "fooled"),
    line: ([id], c) => `Fooled the table ${c.stat(id!, "survivedAsBad") + c.stat(id!, "fooled")} times.`,
  },
  { id: "bold", title: "Boldest bidder", min: 3, score: (id, c) => c.stat(id, "bigBids"), line: ([id], c) => `Made ${c.stat(id!, "bigBids")} big bids.` },
  { id: "quick", title: "Fastest guesser", min: 2, score: (id, c) => c.stat(id, "firstGuesses"), line: ([id], c) => `Guessed first ${c.stat(id!, "firstGuesses")} times.` },
  { id: "trusting", title: "Too trusting", min: 3, score: (id, c) => c.stat(id, "wrongCalls"), line: ([id], c) => `Called ${c.stat(id!, "wrongCalls")} bluffs wrong.` },
  { id: "doubter", title: "Hardest to convince", min: 5, score: (id, c) => c.stat(id, "noGoVotes"), line: ([id], c) => `Voted No-go ${c.stat(id!, "noGoVotes")} times.` },
];

/** Null when no game finished. `now` stands in for `endedAt` while the party's still on. */
export function buildRecap(log: PartyLog, now: number): Recap | null {
  if (!log.games.length) return null;

  const totals: Totals = new Map();
  const wins = new Map<string, number>();
  const played = new Map<string, number>();
  const plays = new Map<string, { n: number; last: number }>();
  log.games.forEach((g, i) => {
    for (const id of g.players) played.set(id, (played.get(id) ?? 0) + 1);
    for (const id of g.winnerIds) wins.set(id, (wins.get(id) ?? 0) + 1);
    for (const [id, counts] of Object.entries(g.stats)) {
      const mine = totals.get(id) ?? {};
      for (const [k, v] of Object.entries(counts) as [StatKey, number][]) mine[k] = (mine[k] ?? 0) + v;
      totals.set(id, mine);
    }
    const p = plays.get(g.gameId) ?? { n: 0, last: 0 };
    plays.set(g.gameId, { n: p.n + 1, last: i });
  });

  // Everyone the night knows about, in the order they turned up.
  const order = [...new Set([...Object.keys(log.names), ...played.keys(), ...wins.keys(), ...totals.keys()])];
  const stat = (id: string, key: StatKey) => totals.get(id)?.[key] ?? 0;
  const ctx: Ctx = {
    stat,
    wins: (id) => wins.get(id) ?? 0,
    played: (id) => played.get(id) ?? 0,
    liarByUncaught: order.some((id) => stat(id, "liesUncaught") >= 3),
  };

  const awarded = new Set<string>();
  const awards: RecapAward[] = [];
  for (const rule of RULES) {
    if (awards.length >= MAX_AWARDS) break;
    const scored = order.map((id) => ({ id, score: rule.score(id, ctx) })).filter((s) => s.score >= rule.min);
    if (!scored.length) continue;
    const top = Math.max(...scored.map((s) => s.score));
    let pick = top;
    // Spread the night around: if the leaders all have an award already,
    // someone without one who's right behind gets this one.
    // A crowd tied right behind can't share it, so then it stays with the leaders.
    if (scored.filter((s) => s.score === top).every((s) => awarded.has(s.id))) {
      const fresh = scored.filter((s) => !awarded.has(s.id));
      const best = fresh.length ? Math.max(...fresh.map((s) => s.score)) : -Infinity;
      const crowd = fresh.filter((s) => s.score === best).length;
      if (best >= top - 1 && crowd <= MAX_TIED) pick = best;
    }
    const winners = scored
      .filter((s) => s.score === pick && (pick === top || !awarded.has(s.id)))
      .map((s) => s.id);
    if (winners.length > MAX_TIED) continue;
    for (const id of winners) awarded.add(id);
    awards.push({ id: rule.id, title: rule.title, who: winners.map((id) => log.names[id] ?? "Someone"), line: rule.line(winners, ctx) });
  }

  const topGameId = [...plays.entries()].sort((a, b) => b[1].n - a[1].n || b[1].last - a[1].last)[0]![0];
  return {
    gamesPlayed: log.games.length,
    minutes: Math.round(((log.endedAt ?? now) - (log.startedAt ?? log.games[0]!.endedAt)) / 60_000),
    topGameId,
    awards,
    quiet: awards.length ? null : "Quiet night. Play more to earn awards.",
  };
}
