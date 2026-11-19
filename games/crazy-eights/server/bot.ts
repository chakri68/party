import type { GameBot } from "@games/game-core";
import {
  EIGHT,
  SUITS,
  type Card,
  type CrazyEightsAction,
  type CrazyEightsPrivateState,
  type CrazyEightsPublicState,
  type Suit,
} from "../shared/types.ts";

/** About 1 move in this many, the bot plays any playable card instead of its best one. */
const RANDOM_MOVE_ODDS = 8;

/** How many cards of `suit` it holds, 8s left out. */
function held(hand: readonly Card[], suit: Suit): number {
  return hand.filter((c) => c.suit === suit && c.rank !== EIGHT).length;
}

/** The suit it holds most of, 8s left out. Ties go to the first in `SUITS`. */
function bestSuit(hand: readonly Card[]): Suit {
  return SUITS.reduce((best, suit) => (held(hand, suit) > held(hand, best) ? suit : best));
}

function play(card: Card, hand: readonly Card[]): CrazyEightsAction {
  return card.rank === EIGHT
    ? { type: "play-card", cardId: card.id, suit: bestSuit(hand) }
    : { type: "play-card", cardId: card.id };
}

/**
 * An average player: follows with the suit it holds most of, high cards
 * first, and keeps its 8s until nothing else plays. Now and then it just
 * plays any card that fits.
 */
export const crazyEightsBot: GameBot<CrazyEightsPublicState, CrazyEightsPrivateState, CrazyEightsAction> = {
  decide({ playerId, public: pub, private: me }, ctx) {
    if (pub.currentPlayerId !== playerId) return null;
    const playable = me.hand.filter((c) => me.playableCardIds.includes(c.id));
    if (playable.length === 0) return me.canDraw ? { type: "draw" } : null;

    if (ctx.randomInt(RANDOM_MOVE_ODDS) === 0) return play(playable[ctx.randomInt(playable.length)]!, me.hand);

    const others = playable
      .filter((c) => c.rank !== EIGHT)
      .sort((a, b) => held(me.hand, b.suit) - held(me.hand, a.suit) || b.rank - a.rank);
    return play(others[0] ?? playable[0]!, me.hand);
  },
};
