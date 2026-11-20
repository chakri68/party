import type { GameBot } from "@games/game-core";
import { power, worstCards } from "../shared/rules.ts";
import type { Card, PresidentAction, PresidentPrivateState, PresidentPublicState, Rank } from "../shared/types.ts";

/** About 1 move in this many is any legal play, as a person's slip would be. */
const RANDOM_MOVE_ODDS = 8;
/** Aces and 2s: the cards that win a trick. A person saves them. */
const POWER = power(1);
/** Above this many cards, a person passes rather than spend a power card. */
const BIG_HAND = 5;
/** Out of 10: how often a big hand passes instead of spending a power card. */
const HOLD_BACK_IN_10 = 6;
/** With this many cards or fewer, a person starts spending power cards. */
const SMALL_HAND = 3;

function setOf(hand: readonly Card[], rank: Rank, count: number): PresidentAction {
  return { type: "play", cardIds: hand.filter((c) => c.rank === rank).slice(0, count).map((c) => c.id) };
}

/**
 * President: give back the lowest cards in the exchange. Lead the lowest
 * rank with all its copies, keeping Aces and 2s until the hand is small.
 * Follow with the lowest rank that beats the pile; with a big hand it
 * often passes rather than spend an Ace or a 2.
 */
export const presidentBot: GameBot<PresidentPublicState, PresidentPrivateState, PresidentAction> = {
  decide({ playerId, public: pub, private: priv }, ctx) {
    if (pub.phase === "finished") return null;

    if (pub.phase === "exchange") {
      if (priv.mustGive <= 0) return null;
      return { type: "give", cardIds: worstCards(priv.hand, priv.mustGive).map((c) => c.id) };
    }

    if (pub.currentPlayerId !== playerId || !priv.playableRanks.length) {
      return pub.currentPlayerId === playerId && priv.canPass ? { type: "pass" } : null;
    }
    const ranks = priv.playableRanks;
    const hand = priv.hand;
    const copies = (rank: Rank) => hand.filter((c) => c.rank === rank).length;
    const need = pub.top?.cards.length ?? 0;

    if (ctx.randomInt(RANDOM_MOVE_ODDS) === 0) {
      const rank = ranks[ctx.randomInt(ranks.length)]!;
      return setOf(hand, rank, need || 1 + ctx.randomInt(copies(rank)));
    }

    if (!pub.top) {
      const saved = hand.length <= SMALL_HAND ? ranks : ranks.filter((r) => power(r) < POWER);
      const rank = (saved.length ? saved : ranks)[0]!;
      return setOf(hand, rank, copies(rank));
    }

    const rank = ranks[0]!;
    if (power(rank) >= POWER && hand.length > BIG_HAND && priv.canPass && ctx.randomInt(10) < HOLD_BACK_IN_10) {
      return { type: "pass" };
    }
    return setOf(hand, rank, need);
  },
};
