import type { BotContext, GameBot } from "@games/game-core";
import { handScoreFor, makeDeck } from "../shared/rules.ts";
import { HOLE_CARDS, type Card, type HoldemAction, type HoldemPrivateState, type HoldemPublicState, type LegalActions, type Variant } from "../shared/types.ts";

/** About 1 decision in this many is a random legal one, as a person's slip would be. */
const RANDOM_MOVE_ODDS = 10;
/** Most Monte Carlo deals per decision. */
export const EQUITY_TRIALS = 200;
/**
 * Reading one Omaha hand checks 60 fives. So Omaha gets a budget of hand
 * reads per decision (mine and each opponent's, every deal) instead of a fixed
 * number of deals: 150 deals heads-up, 33 against 8. It keeps the worst case
 * under about 5 ms.
 */
export const OMAHA_HAND_READS = 300;

/** Deals for one decision against this many opponents. */
export function equityTrials(variant: Variant, opponents: number): number {
  if (variant !== "omaha") return EQUITY_TRIALS;
  return Math.min(EQUITY_TRIALS, Math.floor(OMAHA_HAND_READS / (opponents + 1)));
}
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
/** A raise always needs at least this much less equity than all-in does. */
const RAISE_BELOW_ALL_IN = 0.05;
/** Calls when equity is at least this share of the pot odds: about 10% looser than break-even. */
const CALL_LOOSENESS = 0.9;
/** Percent: a bet when checked to with one or two opponents, whatever the cards. */
const BLUFF = 9;
/** A raise this close to the whole stack goes all-in instead. */
const COMMIT_SHARE = 0.6;

/**
 * My share of the pot against these opponents, by random deals of the cards
 * nobody can see. `opponents` holds face-up cards, or null for a hidden hand.
 * Hands are read by the variant's rule (Omaha: 2 private + 3 shared).
 */
export function equity(
  variant: Variant,
  hole: readonly Card[],
  board: readonly Card[],
  opponents: readonly (readonly Card[] | null)[],
  trials: number,
  randomInt: (max: number) => number,
): number {
  const known = new Set([...hole, ...board, ...opponents.flatMap((o) => o ?? [])].map((c) => c.id));
  const deck = makeDeck().filter((c) => !known.has(c.id));
  const holeCards = HOLE_CARDS[variant];
  const hidden = opponents.filter((o) => o === null).length;
  const need = 5 - board.length + holeCards * hidden;
  const full = [...board];
  const theirs: Card[] = [];
  const fixedMine = board.length === 5 ? handScoreFor(variant, hole, board) : 0;
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
    const me = board.length === 5 ? fixedMine : handScoreFor(variant, hole, full);
    let tied = 0;
    let lost = false;
    for (let k = 0; k < opponents.length; k++) {
      let face = opponents[k];
      if (!face) {
        theirs.length = 0;
        for (let i = 0; i < holeCards; i++) theirs.push(deck[next++]!);
        face = theirs;
      }
      const s = handScoreFor(variant, face, full);
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

/** Omaha points for one high card: Aces and Kings make the best flushes and straights. */
const OMAHA_HIGH: Record<number, number> = { 14: 4, 13: 3, 12: 2, 11: 2, 10: 1 };
/** Runs with both cards at this rank or under make the lowest straights, which lose to higher ones: fewer points. */
const OMAHA_LOW_RUN = 5;

/** Omaha points: pairs, two-card suits, ranks close together, high cards, across all 4. */
export function omahaPoints(hole: readonly Card[]): number {
  let points = 0;
  const byRank = new Map<number, number>();
  const bySuit = new Map<string, number[]>();
  for (const c of hole) {
    byRank.set(c.rank, (byRank.get(c.rank) ?? 0) + 1);
    bySuit.set(c.suit, [...(bySuit.get(c.suit) ?? []), c.rank]);
    points += OMAHA_HIGH[c.rank] ?? 0;
  }
  // A pair can make a set, best when high. Three or four of a rank: those cards block each other.
  for (const [rank, n] of byRank) {
    if (n === 2) points += rank === 14 ? 10 : rank >= 12 ? 7 : rank >= 10 ? 5 : rank >= 7 ? 3 : 2;
    else if (n > 2) points -= 8;
  }
  // Two of a suit can make a flush, best with the Ace or King. A third of it adds nothing.
  for (const ranks of bySuit.values()) {
    if (ranks.length === 2) points += ranks.includes(14) ? 5 : ranks.includes(13) ? 3 : 2;
  }
  // Ranks close together make straights. Low ones count less.
  const ranks = [...byRank.keys()].sort((a, b) => b - a);
  for (let i = 1; i < ranks.length; i++) {
    const gap = ranks[i - 1]! - ranks[i]!;
    if (gap > 3) continue;
    points += Math.max(0, 4 - gap - (ranks[i - 1]! <= OMAHA_LOW_RUN ? 1 : 0));
  }
  return points;
}

/**
 * Omaha start tiers, 1 to 5 like Hold'em's. Of all 4-card hands: tier 1 about
 * 4%, tier 2 10%, tier 3 21%, tier 4 18%, tier 5 47%.
 */
export function omahaPreflopTier(hole: readonly Card[]): 1 | 2 | 3 | 4 | 5 {
  const p = omahaPoints(hole);
  return p >= 21 ? 1 : p >= 16 ? 2 : p >= 12 ? 3 : p >= 10 ? 4 : 5;
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
/** The biggest raise the table allows: all-in, or Omaha's pot-sized raise. */
const top = (legal: LegalActions): HoldemAction => (legal.maxIsAllIn ? ALL_IN : { type: "raise", to: legal.maxRaiseTo! });
/** Everything it may: the top raise when a raise is open, else call (or check). */
const shove = (legal: LegalActions): HoldemAction => (legal.maxRaiseTo !== null ? top(legal) : stay(legal));

/** A raise to about `to`, kept to whole chips inside what the table allows. */
function raiseTo(legal: LegalActions, to: number): HoldemAction {
  const { minRaiseTo: min, maxRaiseTo: max } = legal;
  if (min === null || max === null) return stay(legal);
  const size = Math.min(max, Math.max(min, Math.round(to)));
  if (size >= max || (legal.maxIsAllIn && size >= COMMIT_SHARE * max)) return top(legal);
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
  let tier = pub.variant === "omaha" ? omahaPreflopTier(priv.hole) : preflopTier(priv.hole[0]!, priv.hole[1]!);
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

/** After the flop: the equity a raise needs, by opponents still in and chips owed. */
export function raiseThreshold(opponents: number, owed: number): number {
  const base = opponents === 1 ? RAISE_EQUITY_HEADS_UP : RAISE_EQUITY;
  // Kept under the all-in line, so a raise back is not only ever all-in.
  return Math.min(ALL_IN_EQUITY - RAISE_BELOW_ALL_IN, base + (owed > 0 ? RERAISE_MARGIN : 0));
}

function postflop(playerId: string, pub: HoldemPublicState, priv: HoldemPrivateState, legal: LegalActions, ctx: BotContext): HoldemAction {
  const opponents = pub.players.filter((p) => p.id !== playerId && p.inHand && !p.folded);
  const trials = equityTrials(pub.variant, opponents.length);
  const eq = equity(pub.variant, priv.hole, pub.board, opponents.map((p) => p.cards), trials, ctx.randomInt);
  const owed = legal.call;
  const pot = pub.pot;
  if (eq > ALL_IN_EQUITY) return shove(legal);
  if (eq > raiseThreshold(opponents.length, owed) && legal.minRaiseTo !== null) {
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
 * Hold'em and Omaha: a hand table before the flop, then equity by random deals against
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
    if (priv.hole.length < HOLE_CARDS[pub.variant]) return giveUp(legal);
    if (pub.board.length === 0) return preflop(pub, priv, legal, stack, ctx);
    return postflop(playerId, pub, priv, legal, ctx);
  },
};
