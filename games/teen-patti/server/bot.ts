import type { BotContext, GameBot } from "@games/game-core";
import { handScore, makeDeck } from "../shared/rules.ts";
import type { Card, LegalMoves, TeenPattiAction, TeenPattiPrivateState, TeenPattiPublicState } from "../shared/types.ts";

/** Percent, each turn while Blind: look at the cards now. */
export const SEE_CHANCE = 40;
/** Blind, the bot always looks once the stake is this many boots, or the pot is this many. */
const SEE_STAKE_BOOTS = 4;
const SEE_POT_BOOTS = 12;
/** Percent: a Blind bot doubles the stake. */
const BLIND_DOUBLE = 6;
/** Percent: a Seen bot bets on a hand it would pack. */
export const BLUFF = 8;
/** The share of hands a Seen bot packs at the start, before the stake goes up. */
const PACK_BASE = 0.35;
/** Packs more hands each time the stake doubles, and for each Seen player against it. */
const PACK_PER_DOUBLE = 0.06;
const PACK_PER_SEEN = 0.04;
/** Heads-up it packs less. */
const PACK_HEADS_UP = 0.1;
/** Doubles with a hand better than this share of hands (percent chance). */
const DOUBLE_ABOVE = 0.9;
const DOUBLE_CHANCE = 40;
/** Asks for a Sideshow with a middle hand, this often. */
const SIDESHOW_BELOW = 0.75;
const SIDESHOW_CHANCE = 35;
/** With 2 left: asks for a Show above this hand strength, less as the pot grows. */
const SHOW_ABOVE = 0.6;
/** Pot boots at which the Show line drops by its full amount. */
const SHOW_POT_BOOTS = 60;
const SHOW_DROP = 0.3;
/** Says yes to a Sideshow with a hand at least this good (give or take a little). */
const ACCEPT_ABOVE = 0.55;

/**
 * Every 3-card hand's score, sorted: 22,100 of them. Built once when the
 * module loads, so a decision is one binary search.
 */
const ALL_SCORES: Float64Array = (() => {
  const deck = makeDeck();
  const scores: number[] = [];
  for (let a = 0; a < deck.length; a++)
    for (let b = a + 1; b < deck.length; b++)
      for (let c = b + 1; c < deck.length; c++) scores.push(handScore([deck[a]!, deck[b]!, deck[c]!]));
  return Float64Array.from(scores).sort();
})();

/** First index with a score at least `s`. */
function lowerBound(s: number): number {
  let lo = 0;
  let hi = ALL_SCORES.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ALL_SCORES[mid]! < s) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The share of all hands this one beats, ties counting half: 0 to 1. */
export function handStrength(cards: readonly Card[]): number {
  const s = handScore(cards);
  const below = lowerBound(s);
  const equal = lowerBound(s + 1) - below;
  return (below + equal / 2) / ALL_SCORES.length;
}

const PACK: TeenPattiAction = { type: "pack" };
const CHAAL: TeenPattiAction = { type: "chaal" };
const DOUBLE: TeenPattiAction = { type: "double" };
const ALL_IN: TeenPattiAction = { type: "all-in" };
const SHOW: TeenPattiAction = { type: "show" };

/** The line under which a Seen bot packs. */
export function packLine(stakeBoots: number, seenOpponents: number, opponents: number): number {
  const doubles = Math.log2(Math.max(1, stakeBoots));
  const line = PACK_BASE + PACK_PER_DOUBLE * doubles + PACK_PER_SEEN * seenOpponents - (opponents === 1 ? PACK_HEADS_UP : 0);
  return Math.min(0.9, Math.max(0.15, line));
}

/** The line over which a Seen bot asks for a Show: lower with a bigger pot. */
export function showLine(potBoots: number): number {
  return SHOW_ABOVE - SHOW_DROP * Math.min(1, potBoots / SHOW_POT_BOOTS);
}

/** Still Blind: look, or bet cheap. */
function blind(pub: TeenPattiPublicState, legal: LegalMoves, ctx: BotContext): TeenPattiAction {
  const look =
    legal.chaal === null ||
    pub.stake >= SEE_STAKE_BOOTS * pub.boot ||
    pub.pot >= SEE_POT_BOOTS * pub.boot ||
    ctx.randomInt(100) < SEE_CHANCE;
  if (look) return { type: "see" };
  if (legal.double !== null && ctx.randomInt(100) < BLIND_DOUBLE) return DOUBLE;
  return CHAAL;
}

function seen(playerId: string, pub: TeenPattiPublicState, priv: TeenPattiPrivateState, legal: LegalMoves, ctx: BotContext): TeenPattiAction {
  const strength = handStrength(priv.cards);
  const others = pub.players.filter((p) => p.id !== playerId && p.inHand && !p.packed);
  const line = packLine(pub.stake / pub.boot, others.filter((p) => p.seen).length, others.length);
  const good = strength >= line || ctx.randomInt(100) < BLUFF;

  if (legal.chaal === null) return good ? ALL_IN : PACK;
  if (legal.show !== null) {
    if (!good) return PACK;
    if (strength >= DOUBLE_ABOVE && legal.double !== null && ctx.randomInt(100) < DOUBLE_CHANCE) return DOUBLE;
    return strength >= showLine(pub.pot / pub.boot) ? SHOW : CHAAL;
  }
  if (!good) return PACK;
  if (legal.sideshow && strength < SIDESHOW_BELOW && ctx.randomInt(100) < SIDESHOW_CHANCE) return { type: "sideshow" };
  if (strength >= DOUBLE_ABOVE && legal.double !== null && ctx.randomInt(100) < DOUBLE_CHANCE) return DOUBLE;
  return CHAAL;
}

/**
 * Plays by hand strength: the share of all hands its 3 cards beat. Blind, it
 * bets cheap and looks soon. Seen, it packs weak hands (more as the stake
 * climbs), bluffs now and then, asks for a Show more readily in a big pot,
 * and answers a Sideshow by its hand. No dealing out of random hands: a
 * decision is a table lookup.
 */
export const teenPattiBot: GameBot<TeenPattiPublicState, TeenPattiPrivateState, TeenPattiAction> = {
  decide({ playerId, public: pub, private: priv }, ctx) {
    if (priv.answer) {
      // Asked on every update while it waits, so the answer comes from `chance`, fixed for this request.
      const key = `sideshow:${pub.handNumber}:${priv.answer.fromId}:${pub.pot}`;
      const wobble = (ctx.chance(key) - 50) / 500;
      return handStrength(priv.cards) + wobble >= ACCEPT_ABOVE ? { type: "accept" } : { type: "refuse" };
    }
    const legal = priv.legal;
    if (!legal) return priv.canBack ? { type: "back" } : null;
    if (priv.canSee) return blind(pub, legal, ctx);
    return seen(playerId, pub, priv, legal, ctx);
  },
};
