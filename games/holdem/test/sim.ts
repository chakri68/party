// A cash-table simulation for tuning the computer player. Not shipped: tests
// and the tuning report (sim-report.test.ts) use it.
//
// Every hand starts with every stack reset to the same depth, at the first
// blinds, so each hand is one clean sample. Cards come from their own seeded
// random source, apart from the bots' rolls: the same seed deals the same
// cards whoever sits where, so two runs with the seats swapped can be paired.

import { seededRandomInt, stableHash, type BotContext, type GameBot, type GameContext } from "@games/game-core";
import { STEP_TIMER, holdemGame } from "../server/game.ts";
import { DEFAULT_SETTINGS, type HoldemAction, type HoldemPrivateState, type HoldemPublicState, type HoldemServerState, type Street, type Variant } from "../shared/types.ts";

type Bot = GameBot<HoldemPublicState, HoldemPrivateState, HoldemAction>;
const POSTFLOP: readonly Street[] = ["flop", "turn", "river"];

/** Counts for one seat, or several seats added together. */
export interface SeatStats {
  hands: number;
  /** Hands with a voluntary call, bet or raise before the flop. */
  vpip: number;
  /** Hands with a bet or raise before the flop. */
  pfr: number;
  /** After the flop, by street: bets and raises, and calls. */
  aggressive: Record<string, number>;
  calls: Record<string, number>;
  sawFlop: number;
  showdowns: number;
  wonAtShowdown: number;
  /** After the flop: times facing a bet, and folds to one. */
  facedBet: number;
  foldedToBet: number;
  allIns: number;
  /** After the flop: bets with nothing to call. */
  bets: number;
  /** Chips won or lost, in big blinds. */
  netBB: number;
}

export const emptyStats = (): SeatStats => ({
  hands: 0,
  vpip: 0,
  pfr: 0,
  aggressive: { flop: 0, turn: 0, river: 0 },
  calls: { flop: 0, turn: 0, river: 0 },
  sawFlop: 0,
  showdowns: 0,
  wonAtShowdown: 0,
  facedBet: 0,
  foldedToBet: 0,
  allIns: 0,
  bets: 0,
  netBB: 0,
});

export function addStats(into: SeatStats, from: SeatStats): SeatStats {
  for (const k of ["hands", "vpip", "pfr", "sawFlop", "showdowns", "wonAtShowdown", "facedBet", "foldedToBet", "allIns", "bets", "netBB"] as const) {
    into[k] += from[k];
  }
  for (const s of POSTFLOP) {
    into.aggressive[s]! += from.aggressive[s]!;
    into.calls[s]! += from.calls[s]!;
  }
  return into;
}

export interface SimResult {
  /** Per seat. */
  seats: SeatStats[];
  /** Per hand, each seat's result in big blinds. */
  results: number[][];
  /** Moves per hand, on average. */
  movesPerHand: number;
  /** Share of hands that reach the flop, and the river. */
  flopShare: number;
  riverShare: number;
  /** Moves the game refused: always 0 for a sound bot. */
  rejected: number;
}

/**
 * Plays `hands` hands with these bots in these seats. Stacks reset to
 * `stackBB` big blinds before every hand; the blinds stay at the first level.
 */
export function simulate(opts: { variant: Variant; bots: Bot[]; hands: number; seed: number; stackBB?: number }): SimResult {
  const n = opts.bots.length;
  const dealRandom = seededRandomInt(opts.seed);
  const botRandom = seededRandomInt(opts.seed * 7919 + 17);
  let now = 1_000_000;
  const ctx = (): GameContext => ({ now, randomInt: dealRandom, hostId: "p0" });
  const ids = Array.from({ length: n }, (_, i) => `p${i}`);
  // As the room does: one answer per seat, game and key.
  const botCtx = ids.map((id): BotContext => ({ randomInt: botRandom, chance: (key) => stableHash(`${opts.seed}:${id}:${key}`) % 100 }));

  const settings = { ...DEFAULT_SETTINGS, variant: opts.variant };
  let state: HoldemServerState = holdemGame.createGame(ids.map((id) => ({ id })), settings, { roundNumber: 1, dealerSeat: 0 }, ctx()).state as HoldemServerState;
  // Blinds never go up.
  state.settings.handsPerLevel = 1e9;
  const bb = 20;
  const stack = (opts.stackBB ?? 75) * bb;

  const seats = ids.map(emptyStats);
  const results: number[][] = [];
  let moves = 0;
  let flops = 0;
  let rivers = 0;
  let rejected = 0;
  // Per hand flags, per seat.
  let flags = ids.map(() => ({ vpip: false, pfr: false, foldedPreflop: false }));

  // The first hand was dealt at the starting chips; reset and count from the next.
  let counting = false;
  while (results.length < opts.hands) {
    const s = state;
    const betting = s.phase === "playing" && (POSTFLOP as string[]).concat("preflop").includes(s.step) && !s.runout && s.turnIndex >= 0;
    if (betting) {
      const seat = s.turnIndex;
      const id = ids[seat]!;
      const pub = holdemGame.getPublicState(s) as HoldemPublicState;
      const priv = holdemGame.getPrivateState(s, id) as HoldemPrivateState;
      const legal = priv.legal!;
      const action = opts.bots[seat]!.decide({ playerId: id, public: pub, private: priv }, botCtx[seat]!);
      if (!action) throw new Error(`seat ${seat} gave no move`);
      if (counting) {
        const st = seats[seat]!;
        const raise = action.type === "raise" || (action.type === "all-in" && legal.maxRaiseTo !== null);
        const call = action.type === "call" || (action.type === "all-in" && legal.maxRaiseTo === null && legal.call > 0);
        if (s.step === "preflop") {
          if (raise) flags[seat]!.pfr = true;
          if (raise || call) flags[seat]!.vpip = true;
          if (action.type === "fold") flags[seat]!.foldedPreflop = true;
        } else {
          if (raise) st.aggressive[s.step]!++;
          if (call) st.calls[s.step]!++;
          if (raise && legal.call === 0) st.bets++;
          if (legal.call > 0) {
            st.facedBet++;
            if (action.type === "fold") st.foldedToBet++;
          }
        }
        moves++;
      }
      const res = holdemGame.handleAction(s, id, action, ctx());
      if (!res.ok) {
        rejected++;
        const fold = holdemGame.handleAction(s, id, legal.check ? { type: "check" } : { type: "fold" }, ctx());
        if (!fold.ok) throw new Error(fold.error.code);
        state = fold.transition.state as HoldemServerState;
      } else state = res.transition.state as HoldemServerState;
      continue;
    }
    if (s.phase !== "playing") throw new Error("the game ended");
    if (s.step === "showdown" || s.step === "awarded") {
      const next = structuredClone(s);
      if (counting) {
        const row = next.players.map((p) => (p.stack - p.startStack) / bb);
        results.push(row);
        const summary = next.lastHand!;
        next.players.forEach((p, i) => {
          if (!p.inHand) return;
          const st = seats[i]!;
          st.hands++;
          st.netBB += row[i]!;
          if (flags[i]!.vpip) st.vpip++;
          if (flags[i]!.pfr) st.pfr++;
          if (p.allIn) st.allIns++;
          if (next.board.length >= 3 && !flags[i]!.foldedPreflop) st.sawFlop++;
        });
        if (next.board.length >= 3) flops++;
        if (next.board.length === 5) rivers++;
        if (!summary.byFold) {
          for (const pid of summary.order) {
            const st = seats[ids.indexOf(pid)]!;
            st.showdowns++;
            if ((summary.won[pid] ?? 0) > 0) st.wonAtShowdown++;
          }
        }
      }
      counting = true;
      flags = ids.map(() => ({ vpip: false, pfr: false, foldedPreflop: false }));
      for (const p of next.players) p.stack = stack;
      state = next;
    }
    now += 60_000;
    const t = holdemGame.onTimer!(state, STEP_TIMER, ctx());
    state = t.state as HoldemServerState;
  }
  return { seats, results, movesPerHand: moves / opts.hands, flopShare: flops / opts.hands, riverShare: rivers / opts.hands, rejected };
}

/** The usual poker figures, in percent (aggression as a ratio), from counts. */
export function summarize(st: SeatStats) {
  const pct = (a: number, b: number) => (b ? Math.round((1000 * a) / b) / 10 : 0);
  const ratio = (a: number, b: number) => (b ? Math.round((100 * a) / b) / 100 : 0);
  const agg = (k: string) => ratio(st.aggressive[k]!, st.calls[k]!);
  return {
    vpip: pct(st.vpip, st.hands),
    pfr: pct(st.pfr, st.hands),
    afFlop: agg("flop"),
    afTurn: agg("turn"),
    afRiver: agg("river"),
    wtsd: pct(st.showdowns, st.sawFlop),
    wsd: pct(st.wonAtShowdown, st.showdowns),
    foldToBet: pct(st.foldedToBet, st.facedBet),
    allIn: pct(st.allIns, st.hands),
    bbPer100: Math.round((100 * st.netBB) / Math.max(1, st.hands)),
  };
}

/**
 * Candidate against baseline at an even-sized table, dealt twice: once with
 * the candidates in the even seats, once with the seats swapped, on the same
 * cards. Each hand's sample is the candidates' average result per seat over
 * both deals, in big blinds.
 */
export function headToHead(opts: { variant: Variant; candidate: Bot; baseline: Bot; players: number; hands: number; seed: number; stackBB?: number }) {
  if (opts.players % 2) throw new Error("headToHead: an even table");
  const seats = (first: Bot, second: Bot) => Array.from({ length: opts.players }, (_, i) => (i % 2 === 0 ? first : second));
  const a = simulate({ ...opts, bots: seats(opts.candidate, opts.baseline) });
  const b = simulate({ ...opts, bots: seats(opts.baseline, opts.candidate) });
  const samples = a.results.map((row, h) => {
    let sum = 0;
    row.forEach((v, i) => (sum += i % 2 === 0 ? v : 0));
    b.results[h]!.forEach((v, i) => (sum += i % 2 === 1 ? v : 0));
    return sum / opts.players;
  });
  return { samples, rejected: a.rejected + b.rejected };
}

/** Mean and 95% interval of per-hand samples, in big blinds per 100 hands. */
export function interval(samples: readonly number[]) {
  const n = samples.length;
  const mean = samples.reduce((x, y) => x + y, 0) / n;
  const variance = samples.reduce((x, y) => x + (y - mean) ** 2, 0) / (n - 1);
  const half = 1.96 * Math.sqrt(variance / n);
  return { n, mean: 100 * mean, low: 100 * (mean - half), high: 100 * (mean + half) };
}

/**
 * How a person might push the bot around after the flop, whatever their cards:
 * "half" bets half the pot and "pot" the pot whenever nothing is owed; "cbet"
 * bets the pot on the flop only. Otherwise it plays like `bot`.
 */
export type Exploit = "half" | "pot" | "cbet";

export function exploiter(bot: Bot, kind: Exploit): Bot {
  return {
    decide(view, ctx) {
      const { public: pub, private: priv } = view;
      const legal = priv.legal;
      const open = legal && pub.board.length >= 3 && legal.call === 0 && legal.minRaiseTo !== null && legal.maxRaiseTo !== null;
      if (!open || (kind === "cbet" && pub.board.length !== 3)) return bot.decide(view, ctx);
      const to = Math.round(pub.currentBet + (kind === "half" ? 0.5 : 1) * pub.pot);
      const size = Math.max(legal.minRaiseTo!, to);
      if (size >= legal.maxRaiseTo!) return legal.maxIsAllIn ? { type: "all-in" } : { type: "raise", to: legal.maxRaiseTo! };
      return { type: "raise", to: size };
    },
  };
}

/**
 * One exploiter in seat 0 against `bot` everywhere else, paired with the same
 * deals where seat 0 plays `bot` too. Each hand's sample is seat 0's result
 * with the exploiter less its result as the bot, in big blinds.
 */
export function exploit(opts: { variant: Variant; bot: Bot; kind: Exploit; players: number; hands: number; seed: number; stackBB?: number }) {
  const others = Array.from({ length: opts.players - 1 }, () => opts.bot);
  const a = simulate({ ...opts, bots: [exploiter(opts.bot, opts.kind), ...others] });
  const b = simulate({ ...opts, bots: [opts.bot, ...others] });
  const samples = a.results.map((row, h) => row[0]! - b.results[h]![0]!);
  return { samples, rejected: a.rejected + b.rejected };
}
