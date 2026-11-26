// The party recap: a night's finished games in, a few awards out. Pure, so the
// room, the tests and a self-hosted copy all hand out the same awards.

import type { PartyStats, StatKey } from "./index.ts";
import type { TableKey, TableLog } from "./table.ts";

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
  /** Talk, sounds and chat around the games. Missing on a log stored before it existed. */
  table?: TableLog;
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
  /** Awards for the room around the games: talk, sounds, chat. */
  table: RecapAward[];
  /** Most people talking at once, when it was at least 3. */
  moment: { count: number; gameId: string | null } | null;
  /** Set when no award qualified, in either list. */
  quiet: string | null;
}

export const PARTY_LOG_MAX = 50;
const MAX_AWARDS = 5;
const MAX_TIED = 3;
const MAX_TABLE = 3;
/** Of the table awards, how many may be about voice, so a room award can still show. */
const MAX_VOICE = 2;
const MOMENT_MIN = 3;

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
  /** Whether someone without an award at `best` is close enough behind `top` to take it. Default: one behind. */
  near?: (top: number, best: number) => boolean;
  /** Scored from voice: only seats that had counting on. */
  voice?: true;
  /** Who may score at all, beyond the minimum. */
  eligible?: (id: string, ctx: Ctx) => boolean;
}

interface Ctx {
  stat: (id: string, key: StatKey) => number;
  wins: (id: string) => number;
  played: (id: string) => number;
  /** Longest run of wins in a row, over the games they were dealt into. */
  streak: (id: string) => number;
  table: (id: string, key: TableKey) => number;
  counted: Set<string>;
  name: (id: string) => string;
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
  { id: "blame", title: "Not my problem", min: 3, score: (id, c) => c.stat(id, "problemsPassed"), line: ([id], c) => `Passed ${c.stat(id!, "problemsPassed")} Problems on.` },
  { id: "backstab", title: "Backstabber", min: 2, score: (id, c) => c.stat(id, "pushedOver"), line: ([id], c) => `Pushed ${c.stat(id!, "pushedOver")} players over the limit.` },
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
  { id: "rescuer", title: "Always there", min: 2, score: (id, c) => c.stat(id, "rescues"), line: ([id], c) => `Got ${c.stat(id!, "rescues")} friends back up.` },
  { id: "fire", title: "Fire starter", min: 2, score: (id, c) => c.stat(id, "firesLit"), line: ([id], c) => `Lit ${c.stat(id!, "firesLit")} fires.` },
];

const STREAK: AwardRule = {
  id: "streak",
  title: "On a roll",
  min: 3,
  score: (id, c) => c.streak(id),
  line: ([id], c) => `Won ${c.streak(id!)} games in a row.`,
};

const withinTenth = (top: number, best: number) => best >= top * 0.9;
const minutes = (ms: number) => Math.floor(ms / 60_000);

const TABLE_RULES: AwardRule[] = [
  {
    id: "chatty",
    title: "Most talkative",
    min: 180_000,
    voice: true,
    near: withinTenth,
    score: (id, c) => c.table(id, "talkMs"),
    line: ([id], c) => `Talked for ${minutes(c.table(id!, "talkMs"))} minutes.`,
  },
  {
    id: "overtalk",
    title: "Talks over people",
    min: 8,
    voice: true,
    score: (id, c) => c.table(id, "overTalks"),
    line: ([id], c) => `Started talking over someone ${c.table(id!, "overTalks")} times.`,
  },
  {
    id: "backseat",
    title: "Backseat player",
    min: 120_000,
    voice: true,
    near: withinTenth,
    score: (id, c) => c.table(id, "offTurnMs"),
    line: ([id], c) => `Talked for ${minutes(c.table(id!, "offTurnMs"))} minutes on other people's turns.`,
  },
  { id: "dj", title: "DJ of the night", min: 10, score: (id, c) => c.table(id, "sounds"), line: ([id], c) => `Played ${c.table(id!, "sounds")} sounds.` },
  {
    id: "shout",
    title: "Biggest shout",
    // Any peak above 0, from someone who talked at least a minute.
    min: Number.MIN_VALUE,
    voice: true,
    // In hundredths, so 0.20 against 0.15 is near despite float error.
    near: (top, best) => Math.round((top - best) * 100) <= 5,
    eligible: (id, c) => c.table(id, "talkMs") >= 60_000,
    score: (id, c) => c.table(id, "peak"),
    line: () => "Had the loudest shout of the night.",
  },
  {
    id: "speech",
    title: "Victory speech",
    min: 30_000,
    voice: true,
    near: withinTenth,
    score: (id, c) => c.table(id, "winTalkMs"),
    line: () => "Talked the most after winning.",
  },
  { id: "hype", title: "Most excited", min: 10, score: (id, c) => c.table(id, "reactions"), line: ([id], c) => `Sent ${c.table(id!, "reactions")} reactions.` },
  { id: "typist", title: "Most messages", min: 15, score: (id, c) => c.table(id, "chats"), line: ([id], c) => `Sent ${c.table(id!, "chats")} chat messages.` },
];

/**
 * Hands out `rules` in order until `limit`, at most `voiceLimit` of them voice
 * rules. `awarded` is shared, so the spread rule counts every list.
 */
function pickAwards(
  rules: AwardRule[],
  order: string[],
  ctx: Ctx,
  awarded: Set<string>,
  limit: number,
  voiceLimit = Infinity,
  voiced = new Set<string>(),
): RecapAward[] {
  const awards: RecapAward[] = [];
  let voice = 0;
  for (const rule of rules) {
    if (awards.length >= limit) break;
    if (rule.voice && voice >= voiceLimit) continue;
    const scored = order
      .filter((id) => (!rule.voice || ctx.counted.has(id)) && (!rule.eligible || rule.eligible(id, ctx)))
      .map((id) => ({ id, score: rule.score(id, ctx) }))
      .filter((s) => s.score >= rule.min);
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
      const near = rule.near ?? ((t, b) => b >= t - 1);
      if (near(top, best) && crowd <= MAX_TIED) pick = best;
    }
    const winners = scored
      .filter((s) => s.score === pick && (pick === top || !awarded.has(s.id)))
      .map((s) => s.id);
    if (winners.length > MAX_TIED) continue;
    for (const id of winners) awarded.add(id);
    if (rule.voice) {
      voice++;
      for (const id of winners) voiced.add(id);
    }
    awards.push({ id: rule.id, title: rule.title, who: winners.map(ctx.name), line: rule.line(winners, ctx) });
  }
  return awards;
}

/**
 * Two players who each beat the other at least twice, in games both played.
 * The pair with the highest smaller count; then the larger total; then the
 * earlier pair. The one with more wins over the other comes first. Both go
 * into `awarded`.
 */
function rivals(games: PartyGame[], order: string[], ctx: Ctx, awarded: Set<string>): RecapAward | null {
  const beat = new Map<string, number>();
  const key = (w: string, l: string) => `${w}\n${l}`;
  for (const g of games) {
    for (const w of g.winnerIds) {
      if (!g.players.includes(w)) continue;
      for (const l of g.players) if (!g.winnerIds.includes(l)) beat.set(key(w, l), (beat.get(key(w, l)) ?? 0) + 1);
    }
  }
  let found: { who: [string, string]; low: number; sum: number; high: number } | null = null;
  for (let i = 0; i < order.length; i++) {
    for (let j = i + 1; j < order.length; j++) {
      const a = order[i]!;
      const b = order[j]!;
      const ab = beat.get(key(a, b)) ?? 0;
      const ba = beat.get(key(b, a)) ?? 0;
      const low = Math.min(ab, ba);
      if (low < 2) continue;
      const sum = ab + ba;
      if (found && (low < found.low || (low === found.low && sum <= found.sum))) continue;
      found = { who: ba > ab ? [b, a] : [a, b], low, sum, high: Math.max(ab, ba) };
    }
  }
  if (!found) return null;
  for (const id of found.who) awarded.add(id);
  return {
    id: "rivals",
    title: "Rivals",
    who: found.who.map(ctx.name),
    line: found.high === found.low ? `Beat each other ${found.low} times each.` : `Beat each other ${found.high} and ${found.low} times.`,
  };
}

/** Null when no game finished. `now` stands in for `endedAt` while the party's still on. */
export function buildRecap(log: PartyLog, now: number): Recap | null {
  if (!log.games.length) return null;

  const totals: Totals = new Map();
  const wins = new Map<string, number>();
  const played = new Map<string, number>();
  const plays = new Map<string, { n: number; last: number }>();
  const run = new Map<string, number>();
  const streak = new Map<string, number>();
  log.games.forEach((g, i) => {
    for (const id of g.players) {
      played.set(id, (played.get(id) ?? 0) + 1);
      const now = g.winnerIds.includes(id) ? (run.get(id) ?? 0) + 1 : 0;
      run.set(id, now);
      streak.set(id, Math.max(streak.get(id) ?? 0, now));
    }
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
  const seats = log.table?.seats ?? {};
  const order = [...new Set([...Object.keys(log.names), ...played.keys(), ...wins.keys(), ...totals.keys(), ...Object.keys(seats)])];
  const stat = (id: string, key: StatKey) => totals.get(id)?.[key] ?? 0;
  const ctx: Ctx = {
    stat,
    wins: (id) => wins.get(id) ?? 0,
    played: (id) => played.get(id) ?? 0,
    streak: (id) => streak.get(id) ?? 0,
    table: (id, key) => seats[id]?.[key] ?? 0,
    counted: new Set(log.table?.counted ?? []),
    name: (id) => log.names[id] ?? "Someone",
    liarByUncaught: order.some((id) => stat(id, "liesUncaught") >= 3),
  };

  const awarded = new Set<string>();
  const awards = pickAwards([...RULES, STREAK], order, ctx, awarded, MAX_AWARDS);
  const rival = awards.length < MAX_AWARDS ? rivals(log.games, order, ctx, awarded) : null;
  if (rival) awards.push(rival);

  const voiced = new Set<string>();
  const table = pickAwards(TABLE_RULES, order, ctx, awarded, MAX_TABLE, MAX_VOICE, voiced);
  const quiet = quietButStrong(order, ctx, voiced);
  if (quiet && table.length < MAX_TABLE && table.filter((a) => isVoice(a.id)).length < MAX_VOICE) table.push(quiet);

  const loudest = log.table?.loudest ?? null;

  const topGameId = [...plays.entries()].sort((a, b) => b[1].n - a[1].n || b[1].last - a[1].last)[0]![0];
  return {
    gamesPlayed: log.games.length,
    minutes: Math.round(((log.endedAt ?? now) - (log.startedAt ?? log.games[0]!.endedAt)) / 60_000),
    topGameId,
    awards,
    table,
    moment: loudest && loudest.count >= MOMENT_MIN ? { count: loudest.count, gameId: loudest.gameId } : null,
    quiet: awards.length || table.length ? null : "Quiet night. Play more to earn awards.",
  };
}

const isVoice = (id: string) => id === "quiet" || TABLE_RULES.some((r) => r.id === id && r.voice);

/**
 * The counted seat that talked the least of all those in voice 15 minutes (at
 * least 2 of them), if it won at least 2 games. It isn't passed on to someone
 * close behind. Seats with a voice award (`voiced`) are skipped; among tied
 * seats, only those with the most wins are named.
 */
function quietButStrong(order: string[], ctx: Ctx, voiced: Set<string>): RecapAward | null {
  const fit = order.filter((id) => ctx.counted.has(id) && ctx.table(id, "voiceMs") >= 900_000);
  if (fit.length < 2) return null;
  const low = Math.min(...fit.map((id) => ctx.table(id, "talkMs")));
  const lowest = fit.filter((id) => ctx.table(id, "talkMs") === low && !voiced.has(id));
  if (!lowest.length) return null;
  const most = Math.max(...lowest.map(ctx.wins));
  const who = lowest.filter((id) => ctx.wins(id) === most);
  if (most < 2 || who.length > MAX_TIED) return null;
  return { id: "quiet", title: "Quiet but strong", who: who.map(ctx.name), line: `Said the least, and still won ${most} games.` };
}
