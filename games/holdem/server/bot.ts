import type { BotContext, GameBot } from "@games/game-core";
import { makeDeck } from "../shared/rules.ts";
import type { Card, HoldemAction, HoldemPrivateState, HoldemPublicState, LegalActions } from "../shared/types.ts";

/** About 1 decision in this many is a random legal one, as a person's slip would be. */
const RANDOM_MOVE_ODDS = 10;
/** Most Monte Carlo deals per decision. */
export const EQUITY_TRIALS = 200;
/** Under this many big blinds (stack plus bet), preflop is push or fold. */
const SHORT_STACK_BB = 8;
/** Preflop: an unopened raise is to this many big blinds. */
const OPEN_BB = 3;
/** Preflop: the most a playable hand (tier 3) calls, and a marginal one (tier 4), in big blinds. */
const PLAYABLE_CALL_BB = 4;
const MARGINAL_CALL_BB = 2;
/** Preflop: a strong hand (tier 2) calls a raise up to this many big blinds. */
const STRONG_CALL_BB = 10;
/** Percent: a playable hand raises an unopened pot; trash calls a cheap bet. */
const PLAYABLE_RAISE = 20;
const TRASH_CALL = 15;
/** After the flop: raise over this equity (heads-up, or more opponents), go all-in over the last. */
const RAISE_EQUITY_HEADS_UP = 0.5;
const RAISE_EQUITY = 0.65;
const ALL_IN_EQUITY = 0.8;
/** Facing a bet, a raise back needs this much more equity: it stops raise wars. */
const RERAISE_MARGIN = 0.15;
/** Calls when equity is at least this share of the pot odds: about 10% looser than break-even. */
const CALL_LOOSENESS = 0.9;
/** Percent: a bet when checked to with one or two opponents, whatever the cards. */
const BLUFF = 9;
/** A raise this close to the whole stack goes all-in instead. */
const COMMIT_SHARE = 0.6;

// ---------------------------------------------------------------------------
// Hand scores: the same order as `bestHand` + `compareHands`, as one number,
// fast enough for a few hundred deals per decision.
// ---------------------------------------------------------------------------

const BASE = 16;
const pack = (category: number, ranks: readonly number[]): number => {
  let n = category;
  for (let i = 0; i < 5; i++) n = n * BASE + (ranks[i] ?? 0);
  return n;
};

/** Highest straight in a rank bitmask (bit r for rank r, Ace also at bit 1), or 0. */
function straightIn(mask: number): number {
  const m = mask & (1 << 14) ? mask | 2 : mask;
  for (let high = 14; high >= 5; high--) {
    const run = 0b11111 << (high - 4);
    if ((m & run) === run) return high;
  }
  return 0;
}

const topRanks = (mask: number, count: number): number[] => {
  const out: number[] = [];
  for (let r = 14; r >= 2 && out.length < count; r--) if (mask & (1 << r)) out.push(r);
  return out;
};

/** Best five of five to seven cards, as a number: higher wins, equal ties. */
export function handScore(cards: readonly Card[]): number {
  const counts = new Array<number>(15).fill(0);
  const suitMask: Record<string, number> = {};
  const suitCount: Record<string, number> = {};
  let mask = 0;
  for (const c of cards) {
    counts[c.rank]!++;
    mask |= 1 << c.rank;
    suitMask[c.suit] = (suitMask[c.suit] ?? 0) | (1 << c.rank);
    suitCount[c.suit] = (suitCount[c.suit] ?? 0) + 1;
  }
  let flushMask = 0;
  for (const s in suitCount) if (suitCount[s]! >= 5) flushMask = suitMask[s]!;
  if (flushMask) {
    const sf = straightIn(flushMask);
    if (sf) return pack(8, [sf]);
  }
  const quads: number[] = [];
  const trips: number[] = [];
  const pairs: number[] = [];
  for (let r = 14; r >= 2; r--) {
    if (counts[r] === 4) quads.push(r);
    else if (counts[r] === 3) trips.push(r);
    else if (counts[r] === 2) pairs.push(r);
  }
  const kickers = (skip: number[], count: number) => topRanks(skip.reduce((m, r) => m & ~(1 << r), mask), count);
  if (quads.length) return pack(7, [quads[0]!, ...kickers([quads[0]!], 1)]);
  if (trips.length && trips.length + pairs.length >= 2) {
    const pair = Math.max(trips[1] ?? 0, pairs[0] ?? 0);
    return pack(6, [trips[0]!, pair]);
  }
  if (flushMask) return pack(5, topRanks(flushMask, 5));
  const straight = straightIn(mask);
  if (straight) return pack(4, [straight]);
  if (trips.length) return pack(3, [trips[0]!, ...kickers([trips[0]!], 2)]);
  if (pairs.length >= 2) return pack(2, [pairs[0]!, pairs[1]!, ...kickers([pairs[0]!, pairs[1]!], 1)]);
  if (pairs.length) return pack(1, [pairs[0]!, ...kickers([pairs[0]!], 3)]);
  return pack(0, topRanks(mask, 5));
}

/**
 * My share of the pot against these opponents, by random deals of the cards
 * nobody can see. `opponents` holds face-up cards, or null for a hidden hand.
 */
export function equity(
  hole: readonly Card[],
  board: readonly Card[],
  opponents: readonly (readonly Card[] | null)[],
  trials: number,
  randomInt: (max: number) => number,
): number {
  const known = new Set([...hole, ...board, ...opponents.flatMap((o) => o ?? [])].map((c) => c.id));
  const deck = makeDeck().filter((c) => !known.has(c.id));
  const hidden = opponents.filter((o) => o === null).length;
  const need = 5 - board.length + 2 * hidden;
  const full = [...board];
  const fixedMine = board.length === 5 ? handScore([...hole, ...board]) : 0;
  let total = 0;
  for (let t = 0; t < trials; t++) {
    // Draw `need` cards to the front of the deck.
    for (let i = 0; i < need; i++) {
      const j = i + randomInt(deck.length - i);
      const tmp = deck[i]!;
      deck[i] = deck[j]!;
      deck[j] = tmp;
    }
    let next = 0;
    full.length = board.length;
    while (full.length < 5) full.push(deck[next++]!);
    const me = board.length === 5 ? fixedMine : handScore([...hole, ...full]);
    let tied = 0;
    let lost = false;
    for (let k = 0; k < opponents.length; k++) {
      const face = opponents[k];
      const hand = face ? [...face, ...full] : [deck[next++]!, deck[next++]!, ...full];
      const s = handScore(hand);
      if (s > me) {
        lost = true;
        break;
      }
      if (s === me) tied++;
    }
    if (!lost) total += 1 / (1 + tied);
  }
  return total / trials;
}

// ---------------------------------------------------------------------------
// Preflop
// ---------------------------------------------------------------------------

/** 1 is the best (TT+, AK, AQ suited), 5 is trash. */
export function preflopTier(a: Card, b: Card): 1 | 2 | 3 | 4 | 5 {
  const hi = Math.max(a.rank, b.rank);
  const lo = Math.min(a.rank, b.rank);
  const suited = a.suit === b.suit;
  const gap = hi - lo;
  if (gap === 0) return hi >= 10 ? 1 : hi >= 7 ? 2 : 3;
  if (hi === 14) {
    if (lo === 13 || (lo === 12 && suited)) return 1;
    if (lo === 12 || (lo === 11 && suited)) return 2;
    if (lo >= 10 || suited) return 3;
    return 4;
  }
  if (lo >= 10) return hi === 13 && lo === 12 && suited ? 2 : 3;
  if (suited && (hi === 13 || (gap <= 2 && lo >= 5))) return 4;
  if (gap === 1 && lo >= 7) return 4;
  return 5;
}

// ---------------------------------------------------------------------------
// Moves
// ---------------------------------------------------------------------------

const CHECK: HoldemAction = { type: "check" };
const FOLD: HoldemAction = { type: "fold" };
const CALL: HoldemAction = { type: "call" };
const ALL_IN: HoldemAction = { type: "all-in" };

/** Check when free, else fold. */
const giveUp = (legal: LegalActions): HoldemAction => (legal.check ? CHECK : FOLD);
/** Check when free, else call. Never a call for nothing. */
const stay = (legal: LegalActions): HoldemAction => (legal.call > 0 ? CALL : CHECK);
/** Everything in: all-in when a raise is open, else call (or check). */
const shove = (legal: LegalActions): HoldemAction => (legal.maxRaiseTo !== null ? ALL_IN : stay(legal));

/** A raise to about `to`, kept to whole chips inside what the table allows. */
function raiseTo(legal: LegalActions, to: number): HoldemAction {
  const { minRaiseTo: min, maxRaiseTo: max } = legal;
  if (min === null || max === null) return stay(legal);
  const size = Math.min(max, Math.max(min, Math.round(to)));
  if (size >= max || size >= COMMIT_SHARE * max) return ALL_IN;
  return { type: "raise", to: size };
}

/** A slip: any legal move, the raise at its smallest. */
function randomMove(legal: LegalActions, ctx: BotContext): HoldemAction {
  const options: HoldemAction[] = legal.check ? [CHECK] : [FOLD, CALL];
  if (legal.minRaiseTo !== null) options.push({ type: "raise", to: legal.minRaiseTo });
  return options[ctx.randomInt(options.length)]!;
}

function preflop(pub: HoldemPublicState, priv: HoldemPrivateState, legal: LegalActions, stack: number, ctx: BotContext): HoldemAction {
  const bb = pub.bb;
  const dealt = pub.players.filter((p) => p.inHand).length;
  let tier = preflopTier(priv.hole[0]!, priv.hole[1]!);
  // Fewer players, so weaker hands are worth playing.
  if (dealt <= 3) tier = Math.max(1, tier - 1) as typeof tier;
  if (stack < SHORT_STACK_BB * bb) return tier <= 3 ? shove(legal) : giveUp(legal);

  const opened = pub.currentBet > bb;
  switch (tier) {
    case 1:
      return raiseTo(legal, opened ? 3 * pub.currentBet : OPEN_BB * bb);
    case 2:
      if (!opened) return raiseTo(legal, OPEN_BB * bb);
      return pub.currentBet <= STRONG_CALL_BB * bb ? stay(legal) : giveUp(legal);
    case 3:
      if (!opened) return ctx.randomInt(100) < PLAYABLE_RAISE ? raiseTo(legal, OPEN_BB * bb) : stay(legal);
      return pub.currentBet <= PLAYABLE_CALL_BB * bb ? stay(legal) : giveUp(legal);
    case 4:
      return pub.currentBet <= MARGINAL_CALL_BB * bb ? stay(legal) : giveUp(legal);
    default:
      if (legal.check) return CHECK;
      return legal.call <= bb && ctx.randomInt(100) < TRASH_CALL ? CALL : FOLD;
  }
}

function postflop(playerId: string, pub: HoldemPublicState, priv: HoldemPrivateState, legal: LegalActions, ctx: BotContext): HoldemAction {
  const opponents = pub.players.filter((p) => p.id !== playerId && p.inHand && !p.folded);
  const eq = equity(priv.hole, pub.board, opponents.map((p) => p.cards), EQUITY_TRIALS, ctx.randomInt);
  const owed = legal.call;
  const pot = pub.pot;
  if (eq > ALL_IN_EQUITY) return shove(legal);
  const raiseAt = (opponents.length === 1 ? RAISE_EQUITY_HEADS_UP : RAISE_EQUITY) + (owed > 0 ? RERAISE_MARGIN : 0);
  if (eq > raiseAt && legal.minRaiseTo !== null) {
    const share = 0.5 + ctx.randomInt(26) / 100;
    return raiseTo(legal, pub.currentBet + share * (pot + owed));
  }
  if (owed === 0) {
    const bluff = opponents.length <= 2 && pub.currentBet === 0 && legal.minRaiseTo !== null && ctx.randomInt(100) < BLUFF;
    return bluff ? raiseTo(legal, pot / 2) : CHECK;
  }
  return eq < CALL_LOOSENESS * (owed / (pot + owed)) ? FOLD : CALL;
}

/**
 * Hold'em: a hand table before the flop, then equity by random deals against
 * the players still in, set against the pot odds. Rebuys and comes back
 * whenever it may.
 */
export const holdemBot: GameBot<HoldemPublicState, HoldemPrivateState, HoldemAction> = {
  decide({ playerId, public: pub, private: priv }, ctx) {
    const legal = priv.legal;
    if (legal === null) {
      if (priv.canRebuy) return { type: "rebuy" };
      if (priv.canBack) return { type: "back" };
      return null;
    }
    if (ctx.randomInt(RANDOM_MOVE_ODDS) === 0) return randomMove(legal, ctx);
    const me = pub.players.find((p) => p.id === playerId);
    const stack = (me?.stack ?? 0) + (me?.bet ?? 0);
    if (priv.hole.length < 2) return giveUp(legal);
    if (pub.board.length === 0) return preflop(pub, priv, legal, stack, ctx);
    return postflop(playerId, pub, priv, legal, ctx);
  },
};
